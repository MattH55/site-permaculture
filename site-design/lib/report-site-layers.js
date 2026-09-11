/**
 * Report-facing layers built from data already in the pipeline:
 * canopy volume, cut/fill, view corridors, roof-face solar, planting-zone
 * enrichment. See report-layer-soil-solar-planting-instructions.md.
 */

import { horizonProfile } from './solar-horizon-shading.js';
import { scoreBand, weakestConfidence, round0, round1 } from './suitability-common.js';

const BDFT_PER_M3 = 424; // rough conversion, planning estimate only

export function estimateCanopyVolume(canopy, bbox) {
  const chm = canopy?.chm;
  if (!chm?.values_m?.length || !chm.rows || !chm.cols || !bbox) {
    return { available: false, reason: 'No CHM raster available.' };
  }
  const cellW = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (chm.cols - 1 || 1);
  const cellH = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (chm.rows - 1 || 1);
  const cellArea = Math.max(cellW * cellH, 1);
  let volumeM3 = 0;
  let canopyCells = 0;
  for (const h of chm.values_m) {
    if (!Number.isFinite(h) || h < 0.75) continue;
    volumeM3 += h * cellArea;
    canopyCells++;
  }
  const footprintM2 = canopyCells * cellArea;
  return {
    available: true,
    canopy_volume_m3: round0(volumeM3),
    canopy_footprint_m2: round0(footprintM2),
    board_feet_estimate: round0(volumeM3 * BDFT_PER_M3),
    method: 'CHM height × cell area, summed over vegetated cells (CHM ≥ 0.75 m)',
    note: 'Rough planning estimate of standing canopy volume, not a forestry cruise. Do not use for timber sale or harvest volume.',
    data_source: canopy.data_source || 'CHM',
    confidence: canopy.confidence === 'high' ? 'moderate' : 'low',
  };
}

export function estimateCutFill(opts = {}) {
  const { elevations, rows, cols, bbox, footprints } = opts;
  if (!Array.isArray(elevations) || !rows || !cols || !bbox) {
    return { available: false, pads: [], reason: 'No DEM grid supplied.' };
  }
  const rings = (footprints || [])
    .map((f) => f.geometry?.coordinates?.[0] || f.footprint?.coordinates?.[0] || f)
    .filter((r) => Array.isArray(r) && r.length >= 4);
  if (!rings.length) {
    return { available: false, pads: [], reason: 'No pad/driveway footprint selected.' };
  }
  const cellW = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellH = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const cellArea = Math.max(cellW * cellH, 1);
  const pads = rings.map((ring, i) => {
    const samples = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west);
        const lat = bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south);
        if (!pointInRing(lon, lat, ring)) continue;
        const z = elevations[r * cols + c];
        if (Number.isFinite(z)) samples.push(z);
      }
    }
    if (!samples.length) return { pad_index: i, cut_m3: 0, fill_m3: 0, target_grade_m: null, cell_count: 0 };
    const target = samples.reduce((s, z) => s + z, 0) / samples.length;
    let cut = 0, fill = 0;
    for (const z of samples) {
      const d = z - target;
      if (d > 0) cut += d * cellArea;
      else fill += -d * cellArea;
    }
    return {
      pad_index: i,
      target_grade_m: round1(target),
      cut_m3: round0(cut),
      fill_m3: round0(fill),
      net_m3: round0(cut - fill),
      cell_count: samples.length,
    };
  });
  const cut = pads.reduce((s, p) => s + (p.cut_m3 || 0), 0);
  const fill = pads.reduce((s, p) => s + (p.fill_m3 || 0), 0);
  return {
    available: true,
    pads,
    total_cut_m3: cut,
    total_fill_m3: fill,
    method: 'Integral of (DTM − mean grade) over each footprint. Planning estimate, not a grading plan.',
    confidence: 'moderate',
  };
}

export function viewCorridorCheck(opts = {}) {
  const { elevations, rows, cols, bbox, origin, search_radius_m = 400 } = opts;
  if (!origin || !Array.isArray(elevations) || !rows || !cols || !bbox) {
    return { available: false, reason: 'Need an origin point and a DEM grid.' };
  }
  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const at = (r, c) => elevations[r * cols + c];
  const sc = Math.round(((origin.lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1));
  const sr = Math.round(((bbox.north - origin.lat) / (bbox.north - bbox.south)) * (rows - 1));
  const elevation_m = Number.isFinite(at(sr, sc)) ? at(sr, sc) : origin.elevation_m || 0;
  const profile = horizonProfile({
    at, rows, cols, bbox, cellWidthM, cellHeightM,
    r: sr, c: sc, lat: origin.lat, lon: origin.lon, elevation_m,
  });
  const blockedThresholdDeg = 2;
  const bearings = profile.map((p) => ({
    azimuth_deg: p.azimuth,
    horizon_angle_deg: p.angle_deg,
    blocked: p.angle_deg >= blockedThresholdDeg,
    compass: compass8(p.azimuth),
  }));
  const blocked = bearings.filter((b) => b.blocked).map((b) => b.compass);
  const open = [...new Set(bearings.filter((b) => !b.blocked).map((b) => b.compass))];
  return {
    available: true,
    origin,
    search_radius_m,
    bearings,
    blocked_compass: [...new Set(blocked)],
    open_compass: open,
    method: 'Horizon-shading radial DEM sample (same machinery as solar self-shading). Blocked = horizon angle ≥ 2° within the search radius.',
    confidence: 'moderate',
  };
}

export function computeRoofFaceSolar(buildings, solarOpts = {}, meanDailyKwh) {
  const list = buildings?.available ? (buildings.buildings || []) : [];
  if (!list.length) return { available: false, roofs: [] };
  const faces = [];
  for (const b of list) {
    for (const face of roofFacesFromBuilding(b)) {
      faces.push({ building: b, ...face });
    }
  }
  if (!faces.length) return { available: false, roofs: [] };
  // Sample the already-computed parcel solar raster — do not re-run horizon
  // shading (that second pass was blowing /api/report past host timeouts).
  const raster = solarOpts.solar_exposure_raster || solarOpts.solar_raster || null;
  const kwhPerHour = meanDailyKwh != null ? meanDailyKwh / 12 : 0.18;
  const roofs = faces.map((f) => {
    const sampled = sampleSolarAt(raster, f.centroid.lat, f.centroid.lon, 'annual_insolation_hours') ?? 0;
    const hours = round1(sampled * roofOrientationFactor(f.aspect_deg, f.tilt_deg));
    const kwh = round1(hours * kwhPerHour);
    return {
      footprint_id: f.building.footprint_id,
      building_type: f.building.building_type,
      roof_type: f.building.roof_type || 'flat',
      face_id: f.face_id,
      aspect_deg: f.aspect_deg,
      tilt_deg: f.tilt_deg,
      annual_hours: hours,
      annual_kwh_m2: kwh,
    };
  });
  const best = [...roofs].sort((a, b) => b.annual_kwh_m2 - a.annual_kwh_m2)[0] || null;
  if (best) best.best_oriented_face = true;
  return {
    available: true,
    roofs,
    best_face: best,
    kwh_conversion_note: meanDailyKwh != null
      ? 'kWh/m² scaled from NRCan mean daily insolation × modelled sun hours, adjusted for roof aspect/tilt.'
      : 'kWh/m² uses a 0.18 kW/m² mean-irradiance proxy when no municipality insolation is available.',
    confidence: raster ? 'moderate' : 'low',
    method: 'Sample solar_exposure_raster at roof centroid, then scale by aspect/tilt (south + ~30° tilt = 1.0).',
  };
}

/** South-facing ~30° tilt ≈ 1.0; north faces drop toward 0.3. */
export function roofOrientationFactor(aspectDeg, tiltDeg) {
  const aspect = Number.isFinite(aspectDeg) ? aspectDeg : 180;
  const tilt = Number.isFinite(tiltDeg) ? tiltDeg : 30;
  const aspectRad = ((aspect - 180) * Math.PI) / 180;
  const aspectF = 0.65 + 0.35 * Math.cos(aspectRad);
  const tiltF = 0.85 + 0.15 * Math.cos(((tilt - 30) * Math.PI) / 180);
  return aspectF * tiltF;
}

export function roofFacesFromBuilding(b) {
  const ring = b.geometry?.coordinates?.[0] || b.footprint?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const cx = closed.reduce((s, p) => s + p[0], 0) / closed.length;
  const cy = closed.reduce((s, p) => s + p[1], 0) / closed.length;
  const centroid = { lon: cx, lat: cy };
  if ((b.roof_type || 'flat') !== 'gable') {
    return [{ face_id: 'flat', aspect_deg: 180, tilt_deg: 5, centroid }];
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of closed) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const alongLon = (maxX - minX) >= (maxY - minY);
  const a1 = alongLon ? 0 : 90;
  const a2 = alongLon ? 180 : 270;
  return [
    { face_id: 'gable_a', aspect_deg: a1, tilt_deg: 30, centroid },
    { face_id: 'gable_b', aspect_deg: a2, tilt_deg: 30, centroid },
  ];
}

export function sampleSolarAt(raster, lat, lon, field = 'annual_insolation_hours') {
  if (!raster?.[field]?.length || !raster.bbox || !raster.rows || !raster.cols) return null;
  const { bbox, rows, cols } = raster;
  const c = clamp(Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1)), 0, cols - 1);
  const r = clamp(Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (rows - 1)), 0, rows - 1);
  const v = raster[field][r * cols + c];
  return Number.isFinite(v) ? v : null;
}

export function enrichPlantingZones(opts = {}) {
  const zones = opts.plantable_area?.planting_zones || [];
  const soilProfile = opts.soil_profile || {};
  const solar = opts.solar_horizon_shading?.solar_exposure_raster;
  const catalog = (opts.planting_plan?.recommended || []).slice(0, 5);

  return zones.map((z) => {
    const ring = z.geometry?.coordinates?.[0] || [];
    const cx = ring.length ? ring.reduce((s, p) => s + p[0], 0) / ring.length : null;
    const cy = ring.length ? ring.reduce((s, p) => s + p[1], 0) / ring.length : null;
    const growingSun = (cx != null && solar)
      ? sampleSolarAt(solar, cy, cx, 'growing_season_insolation_hours')
        ?? sampleSolarAt(solar, cy, cx, 'summer_insolation_hours')
      : null;
    const frostPocket = z.frost_risk_level === 'high' || z.frost_risk_level === 'moderate';
    const scp = {
      soil: {
        texture: soilProfile.topsoil_0_30cm?.texture || z.soil_texture_class || null,
        ph: soilProfile.topsoil_0_30cm?.ph ?? null,
        organic_carbon_pct: soilProfile.topsoil_0_30cm?.organic_carbon_pct ?? null,
        drainage: soilProfile.twi_adjusted_drainage || soilProfile.drainage_class_survey || null,
      },
      growing_season_sun_hours: growingSun,
      frost_pocket: frostPocket,
      slope_pct: z.avg_slope_pct,
      aspect_deg: z.dominant_aspect || null,
      distance_to_water_m: z.distance_to_water_m,
    };

    let score = 72;
    if (frostPocket) score -= z.frost_risk_level === 'high' ? 22 : 10;
    if ((z.avg_slope_pct || 0) > 15) score -= 12;
    else if ((z.avg_slope_pct || 0) > 8) score -= 5;
    if (growingSun != null) {
      if (growingSun < 4) score -= 18;
      else if (growingSun < 6) score -= 8;
      else if (growingSun >= 8) score += 6;
    }
    if (z.constraints?.includes('steep_terracing_required')) score -= 8;
    score = Math.max(0, Math.min(100, score));
    const suitability_band = scoreBand(score) || 'fair';
    const factors = compactFactors(scp, z);

    // Reuse the parcel planting plan — calling planPlantings() per zone
    // re-scored the catalog and was a common cause of /api/report timeouts.
    const recommended = catalog.map((p) => ({
      species_or_guild: p.common_name || p.name || p.id || p.species_or_guild,
      latin: p.latin_name || p.latin || null,
      confidence: p.score >= 75 ? 'high' : p.score >= 55 ? 'moderate' : 'low',
      score: p.score,
      suitability: p.suitability,
      driving_factors: factors,
    }));

    return {
      geometry: z.geometry,
      area_m2: z.area_m2,
      suitability_band,
      suitability_score: score,
      site_condition_profile: scp,
      recommended_plantings: recommended,
      driving_factors: factors,
      confidence: z.confidence || weakestConfidence(['moderate', soilProfile.confidence]),
      constraints: z.constraints || [],
    };
  });
}

function compactFactors(scp, z) {
  return {
    soil_texture: scp.soil?.texture || z.soil_texture_class,
    growing_season_sun_hours: scp.growing_season_sun_hours,
    frost_pocket: scp.frost_pocket,
    slope_pct: scp.slope_pct,
    aspect: z.dominant_aspect,
    distance_to_water_m: z.distance_to_water_m,
  };
}

function compass8(az) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}
function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
