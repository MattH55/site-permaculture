/**
 * Wind location-suitability score — new layer, no prior wind-siting model
 * to build on. See location-suitability-scoring-instructions.md.
 *
 * Independently scored from the pond/solar suitability layers; not
 * reconciled against them here.
 *
 * Sub-criteria:
 *  - Regional baseline: Global Wind Atlas mean speed at the parcel
 *    (wind-atlas.js), sampled once and locally modulated rather than
 *    replaced.
 *  - Terrain exposure factor: reuses the horizon-profile geometry already
 *    built for solar shading (solar-horizon-shading.js#horizonProfile) —
 *    "how shielded is this point by surrounding terrain" is the same
 *    question for wind as for sun, just evaluated toward the prevailing
 *    wind sector(s) (from the wind rose) instead of the sun path. Combined
 *    with local relative elevation (a simple TPI).
 *  - Obstruction/turbulence penalty: deducted for nearby tall canopy or
 *    structures within a clearance multiple of their height, but ONLY when
 *    that obstruction sits upwind of the point (a tall stand downwind
 *    doesn't cause the same turbulence problem).
 *
 * Hard exclusions: minimum setback from property boundary/dwellings
 * (PLACEHOLDER distance pending an actual regulatory figure for the
 * jurisdiction — same convention as the pond riparian-setback placeholder),
 * and the tight clearance zone around any obstruction regardless of wind
 * direction (too close is too close either way).
 */

import { horizonProfile, horizonAngleAt } from './solar-horizon-shading.js';
import {
  normalizeLinear, softFalloff, scoreBand, bandSummary, weakestConfidence,
  distanceToNearestFeatureM, topNWellSeparated, cellPolygon,
  cachedSuitability, clamp, round1, haversineM,
} from './suitability-common.js';

const DEFAULT_CONFIG = {
  // PLACEHOLDER — pending an actual regulatory figure for the jurisdiction.
  // A common small-wind-turbine planning rule of thumb (setback ≈ total
  // tip height for residential-scale turbines); used here as a starting
  // planning distance only.
  boundary_dwelling_setback_m: 150,
  boundary_setback_is_placeholder: true,

  // "Too close is too close" clearance, regardless of wind direction.
  hard_clearance_height_multiple: 3,
  // Softer turbulence penalty zone, applied only when the obstruction is
  // upwind of the point.
  turbulence_clearance_height_multiple: 10,
  upwind_tolerance_deg: 45,

  default_structure_height_m: 6, // used only when a structure lacks height_m
  relative_elevation_range_m: 5, // ±this many metres spans the TPI 0-100 score
  baseline_speed_range_ms: [2, 10],

  weights: { baseline: 0.35, terrain_exposure: 0.65 },
  terrain_exposure_weights: { horizon: 0.5, relative_elevation: 0.5 },
};

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {object} opts.wind_atlas getWindAtlasBaseline() result (pre-resolved — this function is sync)
 * @param {object} opts.wind_rose getWindRose() result (prevailing sector)
 * @param {object} [opts.canopy] buildCanopyLayer() result (tree_instances)
 * @param {Array<{geometry:object, height_m?:number}>} [opts.structures]
 * @param {Array<[number,number]>} [opts.parcel_boundary_ring] [lon,lat] ring for the setback exclusion
 * @param {Array<{lat:number,lon:number}>} [opts.dwellings] Dwelling points for the setback exclusion
 * @param {string} [opts.dem_confidence]
 * @param {object} [opts.config]
 * @param {string} [opts.parcel_id]
 * @param {number} [opts.gridSampleStride]
 */
export function computeWindSuitability(opts = {}) {
  const cfg = {
    ...DEFAULT_CONFIG, ...(opts.config || {}),
    weights: { ...DEFAULT_CONFIG.weights, ...(opts.config?.weights || {}) },
    terrain_exposure_weights: { ...DEFAULT_CONFIG.terrain_exposure_weights, ...(opts.config?.terrain_exposure_weights || {}) },
  };
  const compute = () => computeUncached(opts, cfg);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(opts.parcel_id, [
    'wind', opts.rows, opts.cols, opts.dem_confidence,
    opts.wind_atlas?.source, opts.wind_rose?.primary_direction,
    opts.canopy?.data_source, (opts.structures || []).length, (opts.dwellings || []).length,
  ], compute);
}

function computeUncached(opts, cfg) {
  const { elevations, rows, cols, bbox } = opts;
  if (!Array.isArray(elevations) || !rows || !cols || elevations.length < rows * cols || !bbox) {
    return emptyResult('No complete DEM grid and bounding box were supplied.');
  }
  if (!opts.wind_atlas?.available) {
    return emptyResult('No wind-atlas regional baseline available (see wind-atlas.js).');
  }

  const sectors = prevailingSectors(opts.wind_rose);
  if (!sectors.length) {
    return emptyResult('No prevailing wind direction available from the wind rose — cannot orient terrain exposure or obstruction checks.');
  }

  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const at = (r, c) => elevations[r * cols + c];
  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];

  const obstructions = buildObstructions(opts.canopy, opts.structures, cfg);
  const baselineSpeed = opts.wind_atlas.mean_speed_ms;
  const baselineNorm = normalizeLinear(baselineSpeed, cfg.baseline_speed_range_ms[0], cfg.baseline_speed_range_ms[1]);

  const stride = Math.max(1, Math.round(opts.gridSampleStride || Math.ceil(Math.max(rows, cols) / 32)));
  const points = [];
  for (let r = 1; r < rows - 1; r += stride) {
    for (let c = 1; c < cols - 1; c += stride) {
      const z = at(r, c);
      if (!Number.isFinite(z)) continue;
      const [lon, lat] = local(r, c);
      points.push({ r, c, lat, lon, elevation_m: z });
    }
  }

  const scores = new Array(points.length).fill(null);
  const bands = new Array(points.length).fill(null);
  const excludedReasons = new Set();
  const candidates = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    const setbackExclusion = setbackHardExclusion(p, opts, cfg);
    if (setbackExclusion) {
      excludedReasons.add(setbackExclusion);
      scores[i] = 0; bands[i] = 'poor';
      continue;
    }

    const clearance = obstructionClearance(p, obstructions, sectors, cfg);
    if (clearance.hardExcluded) {
      excludedReasons.add('obstruction_clearance_zone');
      scores[i] = 0; bands[i] = 'poor';
      continue;
    }

    const profile = horizonProfile({ at, rows, cols, bbox, cellWidthM, cellHeightM, r: p.r, c: p.c, lat: p.lat, lon: p.lon, elevation_m: p.elevation_m });
    const horizonScore = prevailingHorizonScore(profile, sectors);
    const relElevScore = relativeElevationScore(p, { at, rows, cols }, cfg);
    const tw = cfg.terrain_exposure_weights;
    const terrainExposure = tw.horizon * horizonScore + tw.relative_elevation * relElevScore;

    const w = cfg.weights;
    const base = w.baseline * baselineNorm + w.terrain_exposure * terrainExposure;
    const score = clamp(base - clearance.penalty, 0, 100);

    scores[i] = round1(score);
    bands[i] = scoreBand(score);
    candidates.push({
      r: p.r, c: p.c, lat: p.lat, lon: p.lon, score,
      basis: { baseline: round1(baselineNorm), terrain_exposure: round1(terrainExposure), turbulence_penalty: round1(clearance.penalty) },
    });
  }

  const cellHalfLon = ((bbox.east - bbox.west) / (cols - 1)) * stride / 2;
  const cellHalfLat = ((bbox.north - bbox.south) / (rows - 1)) * stride / 2;
  const picked = topNWellSeparated(candidates, 6, 3);
  const topCandidateZones = picked.map((cand, i) => ({
    zone_id: `wind-suitability-${i + 1}`,
    geometry: cellPolygon(cand.lat, cand.lon, cellHalfLat, cellHalfLon),
    score: round1(cand.score),
    band: scoreBand(cand.score),
    basis: topBasisLabels(cand.basis),
  }));

  const confidence = weakestConfidence([
    opts.dem_confidence || 'moderate',
    opts.wind_atlas.confidence,
    opts.wind_rose?.available ? 'high' : 'unavailable',
    opts.canopy?.available === false ? 'unavailable' : 'moderate',
  ]);

  return {
    suitability_type: 'wind',
    available: true,
    suitability_raster: { rows: Math.ceil((rows - 2) / stride), cols: Math.ceil((cols - 2) / stride), stride, bbox, scores, bands },
    band_summary: bandSummary(scores.filter(Number.isFinite)),
    top_candidate_zones: topCandidateZones,
    hard_exclusions_applied: [...excludedReasons],
    data_source: {
      regional_baseline: opts.wind_atlas.source,
      terrain_exposure: 'Radial DEM horizon profile (solar-horizon-shading.js#horizonProfile), reused for wind — new application of existing geometry',
      prevailing_sectors: opts.wind_rose?.source || 'not supplied',
      obstructions: (opts.canopy?.available ? 'canopy.js tree instances' : null),
    },
    confidence,
    weights: cfg.weights,
    thresholds: {
      boundary_dwelling_setback_m: cfg.boundary_dwelling_setback_m,
      boundary_setback_is_placeholder: cfg.boundary_setback_is_placeholder,
      hard_clearance_height_multiple: cfg.hard_clearance_height_multiple,
      turbulence_clearance_height_multiple: cfg.turbulence_clearance_height_multiple,
    },
    prevailing_sectors: sectors.map((s) => ({ direction: s.dir, degrees: s.deg, frequency_pct: s.freq_pct })),
    assumptions: [
      `Boundary/dwelling setback (${cfg.boundary_dwelling_setback_m} m) is a PLACEHOLDER pending an actual regulatory figure for the jurisdiction — same convention as the pond riparian-setback placeholder.`,
      'Obstruction heights default to tree height_m from the canopy layer; structures without a supplied height_m fall back to a generic placeholder height.',
      'Terrain exposure and obstruction geometry are planning-level, not a bankable micrositing wind-resource assessment — confirm any specific site with a met-mast or site-specific wind study before turbine selection.',
    ],
  };
}

function emptyResult(reason) {
  return {
    suitability_type: 'wind',
    available: false,
    suitability_raster: null,
    band_summary: null,
    top_candidate_zones: [],
    hard_exclusions_applied: [],
    data_source: {},
    confidence: 'insufficient',
    reason,
  };
}

/** Primary (+ secondary, if frequent enough) wind-rose sectors, as compass degrees. */
function prevailingSectors(windRose) {
  if (!windRose?.available) return [];
  const DIRS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const toDeg = (label) => { const i = DIRS16.indexOf(label); return i >= 0 ? i * 22.5 : null; };
  const sectors = [];
  if (windRose.primary_direction) {
    const deg = toDeg(windRose.primary_direction);
    if (deg != null) sectors.push({ dir: windRose.primary_direction, deg, freq_pct: windRose.primary_frequency_pct ?? 50 });
  }
  if (windRose.secondary_direction && (windRose.secondary_frequency_pct ?? 0) >= 8) {
    const deg = toDeg(windRose.secondary_direction);
    if (deg != null) sectors.push({ dir: windRose.secondary_direction, deg, freq_pct: windRose.secondary_frequency_pct });
  }
  return sectors;
}

/** Frequency-weighted "low obstruction toward the prevailing sector(s)" score, 0-100. */
function prevailingHorizonScore(profile, sectors) {
  const MAX_ANGLE_DEG = 25; // horizon angle at/above this is treated as fully obstructed
  let weightedScore = 0;
  let weightSum = 0;
  for (const s of sectors) {
    const angle = horizonAngleAt(profile, s.deg);
    const score = softFalloff(angle, 0, MAX_ANGLE_DEG);
    weightedScore += score * s.freq_pct;
    weightSum += s.freq_pct;
  }
  return weightSum > 0 ? weightedScore / weightSum : 0;
}

/** Windowed TPI (~30 m radius, same convention as keyline-frost.js) → 0-100. */
function relativeElevationScore(point, { at, rows, cols }, cfg) {
  const radius = 2; // fixed small window in grid cells — matches the DEM's native sampling grain
  const window = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (!dr && !dc) continue;
      const rr = point.r + dr, cc = point.c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const v = at(rr, cc);
      if (Number.isFinite(v)) window.push(v);
    }
  }
  if (!window.length) return 50;
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const rel = point.elevation_m - mean;
  return normalizeLinear(rel, -cfg.relative_elevation_range_m, cfg.relative_elevation_range_m);
}

function buildObstructions(canopy, structures, cfg) {
  const list = [];
  if (canopy?.available && Array.isArray(canopy.tree_instances)) {
    for (const t of canopy.tree_instances) {
      const lat = t.x ?? t.lat, lon = t.y ?? t.lon; // canopy.js stores {x:lat,y:lon} — see solar-horizon-shading.js note
      if (lat == null || lon == null || !(t.height_m > 0)) continue;
      list.push({ lat, lon, height_m: t.height_m });
    }
  }
  for (const s of structures || []) {
    const ring = s?.geometry?.coordinates?.[0];
    if (!Array.isArray(ring)) continue;
    // Approximate each structure as its centroid for clearance/bearing purposes.
    const lon = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    list.push({ lat, lon, height_m: s.height_m > 0 ? s.height_m : cfg.default_structure_height_m });
  }
  return list;
}

function obstructionClearance(point, obstructions, sectors, cfg) {
  let hardExcluded = false;
  let penalty = 0;
  for (const o of obstructions) {
    const distM = haversineM(point.lat, point.lon, o.lat, o.lon);
    const hardRadius = o.height_m * cfg.hard_clearance_height_multiple;
    if (distM <= hardRadius) { hardExcluded = true; continue; }

    const turbulenceRadius = o.height_m * cfg.turbulence_clearance_height_multiple;
    if (distM > turbulenceRadius) continue;

    // Only penalize when the obstruction sits upwind of this point (bearing
    // from the point back to the obstruction ≈ a prevailing "from" direction).
    const bearingToObstruction = bearingDeg(point.lat, point.lon, o.lat, o.lon);
    const isUpwind = sectors.some((s) => angularDiff(bearingToObstruction, s.deg) <= cfg.upwind_tolerance_deg);
    if (!isUpwind) continue;

    const closeness = 1 - distM / turbulenceRadius; // 0 at the turbulence radius, 1 at the hard radius
    penalty += 25 * closeness; // up to 25 pts per nearby upwind obstruction, summed
  }
  return { hardExcluded, penalty: clamp(penalty, 0, 60) };
}

function setbackHardExclusion(point, opts, cfg) {
  const setbackM = cfg.boundary_dwelling_setback_m;
  if (Array.isArray(opts.parcel_boundary_ring) && opts.parcel_boundary_ring.length >= 3) {
    const d = distanceToNearestFeatureM(point.lat, point.lon, [{ geometry: { type: 'LineString', coordinates: opts.parcel_boundary_ring } }]);
    if (d <= setbackM) return 'setback_violation';
  }
  for (const dwelling of opts.dwellings || []) {
    if (dwelling.lat == null || dwelling.lon == null) continue;
    if (haversineM(point.lat, point.lon, dwelling.lat, dwelling.lon) <= setbackM) return 'setback_violation';
  }
  return null;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dNorth = (lat2 - lat1) * metersPerDegLat;
  const dEast = (lon2 - lon1) * metersPerDegLon;
  return normalizeDeg((Math.atan2(dEast, dNorth) * 180) / Math.PI);
}

function angularDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function normalizeDeg(d) { return ((d % 360) + 360) % 360; }

function topBasisLabels(basis) {
  return Object.entries(basis)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
}

export const _internal = { DEFAULT_CONFIG, prevailingSectors };
