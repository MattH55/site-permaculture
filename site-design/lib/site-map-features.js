/**
 * Unified property map features for the report UI.
 *
 * Packages the drawn parcel ring, DEM elevation surface + contour polylines,
 * spatially placed planting markers, water layers (inventory + small-water),
 * nearby settlements, and tree-sample hints so one Leaflet map can show
 * everything the designer needs in context.
 *
 * Contour geometry is planning-level (marching-squares on the DEM sample grid),
 * not a substitute for field survey before earthworks.
 */

const M_PER_DEG_LAT = 111_320;

/**
 * Build the site_map payload attached to a pipeline report.
 *
 * @param {object} opts
 * @param {number[][]} opts.ring — closed or open [lng, lat][] parcel ring
 * @param {{ west, south, east, north }} opts.bbox
 * @param {{ latitude, longitude }} opts.centre
 * @param {object} opts.topology — buildTopologyView result
 * @param {object} [opts.planting_plan]
 * @param {object} [opts.wetlands]
 * @param {object} [opts.small_water]
 * @param {object} [opts.provincial_contours]
 * @param {object} [opts.tree_cover]
 * @param {object} [opts.tree_sample_grid]
 * @param {object} [opts.proximity]
 * @param {object} [opts.climate]
 * @param {object} [opts.wind_rose]
 * @param {object} [opts.satellite]
 */
export function buildSiteMapFeatures(opts = {}) {
  const ring = normalizeRing(opts.ring);
  const bbox = opts.bbox || bboxFromRing(ring);
  const centre = opts.centre || centreFromBbox(bbox);
  const topology = opts.topology || {};
  const grid = topology.grid || {};
  const elevations = grid.elevations_m || [];
  const rows = grid.rows || 0;
  const cols = grid.cols || 0;

  const elevationSurface =
    rows && cols && elevations.length
      ? {
          rows,
          cols,
          elevations_m: elevations,
          values: grid.values || null,
          min_m: topology.elevation_min_m,
          max_m: topology.elevation_max_m,
          mean_m: topology.elevation_m,
          bbox: { ...bbox },
        }
      : null;

  const demContours = generateContourGeoJSON(elevations, { rows, cols }, bbox, {
    intervalM: autoContourInterval(topology.elevation_min_m, topology.elevation_max_m),
  });

  const plantings = placePlantingsOnParcel({
    ring,
    bbox,
    centre,
    planting_plan: opts.planting_plan,
    wetlands: opts.wetlands,
    small_water: opts.small_water,
    topology,
    climate: opts.climate,
    wind_rose: opts.wind_rose,
  });

  const water = packageWaterFeatures(opts.wetlands, opts.small_water);
  const settlements = packageSettlements(opts.proximity, centre);
  const trees = packageTreeHints(opts.tree_cover, opts.tree_sample_grid, opts.satellite);

  return {
    version: 1,
    parcel: {
      type: 'Polygon',
      coordinates: ring ? [ring] : null,
      bbox: bbox
        ? [bbox.west, bbox.south, bbox.east, bbox.north]
        : null,
      centre: centre
        ? { lat: centre.latitude, lng: centre.longitude }
        : null,
    },
    elevation: elevationSurface,
    contours: {
      dem: demContours,
      provincial: opts.provincial_contours?.features?.length
        ? {
            type: 'FeatureCollection',
            features: opts.provincial_contours.features.slice(0, 800),
            source: opts.provincial_contours.source || 'Alberta Provincial Elevation',
          }
        : null,
    },
    plantings,
    water,
    settlements,
    trees,
    layers_available: {
      parcel: !!ring,
      elevation: !!elevationSurface,
      dem_contours: !!(demContours?.features?.length),
      provincial_contours: !!(opts.provincial_contours?.features?.length),
      plantings: plantings.features.length > 0,
      wetlands: water.wetlands_count > 0,
      small_water: water.small_water_count > 0,
      settlements: settlements.features.length > 0,
      trees: !!trees.sample_grid || trees.cover_pct != null,
    },
    disclaimer:
      'Planning overlay only. Contours and plant placement are derived from DEM samples and site rules — verify on the ground before earthworks or ordering stock.',
  };
}

// ── Contours (GeoJSON polylines) ────────────────────────────────────────────

function autoContourInterval(minZ, maxZ) {
  if (minZ == null || maxZ == null || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return 1;
  }
  const range = maxZ - minZ;
  if (range < 1) return 0.25;
  if (range < 3) return 0.5;
  if (range < 8) return 1;
  if (range < 20) return 2;
  if (range < 50) return 5;
  return 10;
}

/**
 * Marching-squares contour polylines as GeoJSON FeatureCollection.
 * @returns {{ type: 'FeatureCollection', features: object[], interval_m: number }}
 */
export function generateContourGeoJSON(elevations, meta, bbox, opts = {}) {
  const { rows, cols } = meta || {};
  if (!rows || !cols || !Array.isArray(elevations) || elevations.length < rows * cols || !bbox) {
    return { type: 'FeatureCollection', features: [], interval_m: opts.intervalM || 1 };
  }

  const valid = elevations.filter((z) => z != null && Number.isFinite(z));
  if (valid.length < 4) {
    return { type: 'FeatureCollection', features: [], interval_m: opts.intervalM || 1 };
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const intervalM = opts.intervalM || autoContourInterval(min, max);
  if (max - min < intervalM * 0.5) {
    return { type: 'FeatureCollection', features: [], interval_m: intervalM };
  }

  const levels = [];
  const start = Math.ceil(min / intervalM) * intervalM;
  for (let z = start; z <= max + 1e-9; z += intervalM) {
    levels.push(round2(z));
  }

  const features = [];
  for (const level of levels) {
    const segs = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = elevations[r * cols + c];
        const tr = elevations[r * cols + c + 1];
        const bl = elevations[(r + 1) * cols + c];
        const br = elevations[(r + 1) * cols + c + 1];
        if ([tl, tr, bl, br].some((v) => v == null || !Number.isFinite(v))) continue;
        const cellMin = Math.min(tl, tr, bl, br);
        const cellMax = Math.max(tl, tr, bl, br);
        if (level < cellMin || level > cellMax) continue;
        const pts = cellCrossingPoints(tl, tr, bl, br, level);
        for (const [p0, p1] of pts) {
          const a = gridToLngLat(c + p0[0], r + p0[1], rows, cols, bbox);
          const b = gridToLngLat(c + p1[0], r + p1[1], rows, cols, bbox);
          segs.push([a, b]);
        }
      }
    }
    const lines = stitchSegments(segs);
    for (const line of lines) {
      if (line.length < 2) continue;
      const isIndex = Math.abs(level / intervalM) % 5 < 1e-6 || Math.abs((level / intervalM) % 5 - 5) < 1e-6;
      features.push({
        type: 'Feature',
        properties: {
          elevation_m: level,
          contour_type: isIndex ? 'index' : 'intermediate',
          source: 'dem_sample_grid',
        },
        geometry: {
          type: 'LineString',
          coordinates: line,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
    interval_m: intervalM,
    elevation_min_m: round2(min),
    elevation_max_m: round2(max),
    source: 'DEM sample grid (marching squares)',
  };
}

function cellCrossingPoints(tl, tr, bl, br, level) {
  const idx =
    (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
  // Local cell coords: x 0→1 west→east, y 0→1 north→south (row increases south)
  const pN = () => [lerp(0, 1, tl, tr, level), 0];
  const pS = () => [lerp(0, 1, bl, br, level), 1];
  const pW = () => [0, lerp(0, 1, tl, bl, level)];
  const pE = () => [1, lerp(0, 1, tr, br, level)];

  switch (idx) {
    case 0:
    case 15:
      return [];
    case 1:
    case 14:
      return [[pW(), pS()]];
    case 2:
    case 13:
      return [[pS(), pE()]];
    case 3:
    case 12:
      return [[pW(), pE()]];
    case 4:
    case 11:
      return [[pN(), pE()]];
    case 6:
    case 9:
      return [[pN(), pS()]];
    case 7:
    case 8:
      return [[pN(), pW()]];
    case 5:
      return [
        [pN(), pW()],
        [pS(), pE()],
      ];
    case 10:
      return [
        [pN(), pE()],
        [pW(), pS()],
      ];
    default:
      return [];
  }
}

function lerp(a, b, va, vb, level) {
  if (va === vb) return (a + b) / 2;
  const t = (level - va) / (vb - va);
  return a + Math.max(0, Math.min(1, t)) * (b - a);
}

function gridToLngLat(colF, rowF, rows, cols, bbox) {
  const lng = bbox.west + (colF / Math.max(cols - 1, 1)) * (bbox.east - bbox.west);
  const lat = bbox.north - (rowF / Math.max(rows - 1, 1)) * (bbox.north - bbox.south);
  return [round6(lng), round6(lat)];
}

/** Greedy stitch of short segments into longer polylines. */
function stitchSegments(segs) {
  if (!segs.length) return [];
  const unused = segs.map((s) => s.map((p) => [...p]));
  const lines = [];
  const eps = 1e-7;

  const eq = (a, b) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

  while (unused.length) {
    let line = unused.pop();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = unused.length - 1; i >= 0; i--) {
        const [a, b] = unused[i];
        const head = line[0];
        const tail = line[line.length - 1];
        if (eq(tail, a)) {
          line.push(b);
          unused.splice(i, 1);
          extended = true;
        } else if (eq(tail, b)) {
          line.push(a);
          unused.splice(i, 1);
          extended = true;
        } else if (eq(head, b)) {
          line.unshift(a);
          unused.splice(i, 1);
          extended = true;
        } else if (eq(head, a)) {
          line.unshift(b);
          unused.splice(i, 1);
          extended = true;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}

// ── Planting placement ──────────────────────────────────────────────────────

/**
 * Place recommended plants as point features inside the parcel.
 * Layout rules (planning-level):
 *  - shelter / windbreak → windward edge
 *  - wet / riparian → near water or low elevation
 *  - canopy / food forest → interior
 *  - annuals / herbs → south half (sun + access proxy)
 */
export function placePlantingsOnParcel(opts = {}) {
  const plan = opts.planting_plan || {};
  const plants = (plan.recommended || []).slice(0, 16);
  const ring = normalizeRing(opts.ring);
  const bbox = opts.bbox || bboxFromRing(ring);
  const centre = opts.centre || centreFromBbox(bbox);
  if (!plants.length || !bbox || !centre) {
    return { type: 'FeatureCollection', features: [], note: 'No plantings to place' };
  }

  const windDir =
    opts.wind_rose?.primary_direction ||
    opts.climate?.prevailing_wind_direction ||
    'W';
  const windBearing = windDirToBearing(windDir);

  const waterPoints = collectWaterPoints(opts.wetlands, opts.small_water);
  const lowElev = findLowElevationPoint(opts.topology, bbox);

  const features = [];
  const used = [];

  plants.forEach((p, i) => {
    const role = classifyPlantRole(p);
    let target = { lat: centre.latitude, lng: centre.longitude };

    if (role === 'windbreak') {
      target = pointOnWindwardEdge(bbox, ring, windBearing, 0.18 + (i % 4) * 0.08);
    } else if (role === 'riparian') {
      if (waterPoints.length) {
        const wp = waterPoints[i % waterPoints.length];
        target = offsetToward(wp, centre, 0.35 + (i % 3) * 0.1);
      } else if (lowElev) {
        target = offsetToward(lowElev, centre, 0.25);
      } else {
        target = jitter(centre, bbox, i, 0.25);
      }
    } else if (role === 'canopy' || role === 'shrub') {
      target = jitter(centre, bbox, i + 3, 0.35);
    } else {
      // annuals / herbs / groundcover — south half
      target = {
        lat: bbox.south + (bbox.north - bbox.south) * (0.22 + (i % 5) * 0.06),
        lng: bbox.west + (bbox.east - bbox.west) * (0.25 + ((i * 3) % 7) * 0.08),
      };
    }

    // Keep inside parcel polygon when possible
    if (ring && !pointInRing(target.lng, target.lat, ring)) {
      target = { lat: centre.latitude, lng: centre.longitude };
      target = jitter(target, bbox, i + 11, 0.2);
    }

    // Nudge away from previously used spots
    target = uncrowd(target, used, bbox, 0.04);
    used.push(target);

    const e = p.economics || {};
    features.push({
      type: 'Feature',
      properties: {
        id: p.id || p.common_name || `plant-${i}`,
        common_name: p.common_name || 'Plant',
        scientific_name: p.scientific_name || null,
        role,
        guild_layer: p.guild_layer || null,
        score: p.score ?? null,
        quantity: e.suggested_quantity ?? null,
        establishment_cost_cad: e.establishment_cost_cad?.total ?? null,
        product_yield_mid_kg: e.yield_on_parcel_kg?.mid_kg ?? null,
        cash_yield_mid_cad: e.gross_revenue_cad?.mid ?? null,
        placement_rule: role,
      },
      geometry: {
        type: 'Point',
        coordinates: [round6(target.lng), round6(target.lat)],
      },
    });
  });

  return {
    type: 'FeatureCollection',
    features,
    wind_direction_used: windDir,
    note: 'Indicative placement for planning conversation — adjust after site walk.',
  };
}

function classifyPlantRole(p) {
  const layer = String(p.guild_layer || p.category || '').toLowerCase();
  const name = `${p.common_name || ''} ${p.scientific_name || ''}`.toLowerCase();
  const vals = [
    p.primary_value,
    ...(p.lever_benefits || []),
    ...(p.functions || []),
    ...(p.values || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    /shelter|windbreak|hedgerow|caragana|willow|poplar|spruce|pine|shelterbelt/.test(
      `${layer} ${name} ${vals}`
    ) ||
    layer === 'canopy' && /wind|shelter/.test(vals)
  ) {
    return 'windbreak';
  }
  if (
    /wet|riparian|seep|pond|marsh|sedge|cattail|water.?edge|moisture/.test(
      `${layer} ${name} ${vals}`
    )
  ) {
    return 'riparian';
  }
  if (layer === 'canopy' || layer === 'tree' || /tree|orchard|fruit tree/.test(name + vals)) {
    return 'canopy';
  }
  if (layer === 'shrub' || layer === 'understory' || /berry|shrub/.test(name + vals)) {
    return 'shrub';
  }
  return 'herbaceous';
}

function windDirToBearing(dir) {
  const map = {
    N: 0,
    NNE: 22.5,
    NE: 45,
    ENE: 67.5,
    E: 90,
    ESE: 112.5,
    SE: 135,
    SSE: 157.5,
    S: 180,
    SSW: 202.5,
    SW: 225,
    WSW: 247.5,
    W: 270,
    WNW: 292.5,
    NW: 315,
    NNW: 337.5,
  };
  const key = String(dir || 'W')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return map[key] ?? 270;
}

/** Point along the edge that faces into the wind (windward). */
function pointOnWindwardEdge(bbox, ring, windBearingDeg, t = 0.5) {
  // Wind comes FROM bearing; windward edge is the side the wind hits first
  const rad = ((windBearingDeg - 90) * Math.PI) / 180;
  // Prefer edge midpoint offset into windward side
  const cx = (bbox.west + bbox.east) / 2;
  const cy = (bbox.south + bbox.north) / 2;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Unit vector from centre toward windward (against wind arrival? wind FROM N → windward is north edge)
  // Wind FROM north (0°) hits north edge: move north (+lat)
  const wRad = ((90 - windBearingDeg) * Math.PI) / 180;
  const ux = Math.cos(wRad);
  const uy = Math.sin(wRad);
  const halfW = (bbox.east - bbox.west) / 2;
  const halfH = (bbox.north - bbox.south) / 2;
  // Edge point + along-edge offset
  const along = (t - 0.5) * 1.4;
  const perpX = -uy;
  const perpY = ux;
  let lng = cx + ux * halfW * 0.82 + perpX * halfW * along * 0.6;
  let lat = cy + uy * halfH * 0.82 + perpY * halfH * along * 0.6;
  lng = clamp(lng, bbox.west + halfW * 0.05, bbox.east - halfW * 0.05);
  lat = clamp(lat, bbox.south + halfH * 0.05, bbox.north - halfH * 0.05);
  if (ring && !pointInRing(lng, lat, ring)) {
    return { lat: cy + uy * halfH * 0.35, lng: cx + ux * halfW * 0.35 };
  }
  return { lat, lng };
}

function collectWaterPoints(wetlands, smallWater) {
  const pts = [];
  const pushGeom = (geom) => {
    if (!geom) return;
    if (geom.type === 'Point') {
      pts.push({ lng: geom.coordinates[0], lat: geom.coordinates[1] });
    } else if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
      const c = ringCentroid(geom.coordinates[0]);
      if (c) pts.push(c);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates || []) {
        const c = ringCentroid(poly[0]);
        if (c) pts.push(c);
      }
    }
  };
  for (const f of wetlands?.wetland_polygons?.features || []) pushGeom(f.geometry);
  for (const f of smallWater?.feature_collection?.features || []) pushGeom(f.geometry);
  for (const f of smallWater?.open_water_features || []) {
    if (f.lat != null && f.lng != null) pts.push({ lat: f.lat, lng: f.lng });
    else if (f.centroid) pts.push({ lat: f.centroid.lat, lng: f.centroid.lng });
  }
  return pts;
}

function findLowElevationPoint(topology, bbox) {
  const g = topology?.grid;
  if (!g?.elevations_m?.length || !g.rows || !g.cols || !bbox) return null;
  let minZ = Infinity;
  let minI = -1;
  g.elevations_m.forEach((z, i) => {
    if (z != null && Number.isFinite(z) && z < minZ) {
      minZ = z;
      minI = i;
    }
  });
  if (minI < 0) return null;
  const r = Math.floor(minI / g.cols);
  const c = minI % g.cols;
  const [lng, lat] = gridToLngLat(c, r, g.rows, g.cols, bbox);
  return { lat, lng };
}

function offsetToward(from, toward, t) {
  return {
    lat: from.lat + (toward.latitude - from.lat) * t,
    lng: from.lng + (toward.longitude - from.lng) * t,
  };
}

function jitter(centre, bbox, seed, scale = 0.3) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  const u = s - Math.floor(s);
  const s2 = Math.sin(seed * 78.233) * 43758.5453;
  const v = s2 - Math.floor(s2);
  const halfW = ((bbox.east - bbox.west) / 2) * scale;
  const halfH = ((bbox.north - bbox.south) / 2) * scale;
  return {
    lat: centre.latitude + (v - 0.5) * 2 * halfH,
    lng: centre.longitude + (u - 0.5) * 2 * halfW,
  };
}

function uncrowd(pt, used, bbox, minFrac) {
  if (!used.length) return pt;
  const minD =
    Math.hypot(bbox.east - bbox.west, bbox.north - bbox.south) * (minFrac || 0.04);
  let best = { ...pt };
  for (let attempt = 0; attempt < 8; attempt++) {
    let ok = true;
    for (const u of used) {
      if (Math.hypot(best.lat - u.lat, best.lng - u.lng) < minD) {
        ok = false;
        break;
      }
    }
    if (ok) return best;
    best = {
      lat: pt.lat + (Math.sin(attempt * 2.1) * minD) / 1.2,
      lng: pt.lng + (Math.cos(attempt * 2.1) * minD) / 1.2,
    };
  }
  return best;
}

// ── Water / settlements / trees packaging ──────────────────────────────────

function packageWaterFeatures(wetlands, smallWater) {
  const features = [];
  let wetlands_count = 0;
  let small_water_count = 0;

  for (const f of wetlands?.wetland_polygons?.features || []) {
    wetlands_count++;
    features.push({
      type: 'Feature',
      properties: {
        ...(f.properties || {}),
        class: 'wetland_inventory',
        confidence: 'high',
        layer: 'wetlands',
      },
      geometry: f.geometry,
    });
  }

  for (const f of smallWater?.feature_collection?.features || []) {
    small_water_count++;
    const conf = f.properties?.confidence || '';
    const isPoss =
      f.properties?.class === 'possible' || /low/i.test(String(conf));
    features.push({
      type: 'Feature',
      properties: {
        ...(f.properties || {}),
        class: isPoss ? 'possible' : 'confirmed',
        layer: 'small_water',
      },
      geometry: f.geometry,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    wetlands_count,
    small_water_count,
    has_wetland_on_site: !!wetlands?.has_wetland_on_site,
    nearest_wetland_m: wetlands?.nearest_wetland_distance_m ?? null,
    small_water_summary: smallWater?.summary || null,
    source_note:
      'AMWI inventory (high) + Sentinel NDWI/MNDWI screening (medium/low). Not regulatory delineation.',
  };
}

function packageSettlements(proximity, centre) {
  const features = [];
  const add = (s, kind) => {
    if (!s?.name) return;
    const lat = s.latitude ?? s.lat;
    const lng = s.longitude ?? s.lng ?? s.lon;
    if (lat == null || lng == null) return;
    features.push({
      type: 'Feature',
      properties: {
        name: s.name,
        kind,
        distance_km: s.distance_km ?? null,
        population: s.population ?? null,
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(lng), Number(lat)],
      },
    });
  };
  add(proximity?.nearest_settlement, 'settlement');
  add(proximity?.nearest_city, 'city');
  for (const a of proximity?.amenities || []) {
    if (a.type === 'settlement' || a.category === 'place') add(a, a.type || 'amenity');
  }

  // On-parcel building detection is client-side image analysis; server only
  // provides nearby named places for context.
  return {
    type: 'FeatureCollection',
    features,
    centre: centre
      ? { lat: centre.latitude, lng: centre.longitude }
      : null,
    note: 'Named places from proximity data. On-parcel structures use satellite image analysis in the browser.',
  };
}

function packageTreeHints(treeCover, sampleGrid, satellite) {
  return {
    cover_pct: treeCover?.tree_cover_pct ?? null,
    method: treeCover?.method || null,
    recommendations: treeCover?.recommendations || [],
    sample_grid: sampleGrid || null,
    ndvi_median: satellite?.summary?.ndvi_median ?? satellite?.ndvi_median ?? null,
    vegetation_vigor: satellite?.summary?.vegetation_vigor ?? null,
    note:
      treeCover?.methodology_note ||
      'Tree cover heuristic + optional client-side canopy sampling from satellite imagery.',
  };
}

// ── Geometry helpers ────────────────────────────────────────────────────────

function normalizeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out = ring
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map(([lng, lat]) => [Number(lng), Number(lat)])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (out.length < 3) return null;
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([...a]);
  return out;
}

function bboxFromRing(ring) {
  if (!ring?.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return { west, south, east, north };
}

function centreFromBbox(bbox) {
  if (!bbox) return null;
  return {
    latitude: (bbox.south + bbox.north) / 2,
    longitude: (bbox.west + bbox.east) / 2,
  };
}

function ringCentroid(ring) {
  if (!ring?.length) return null;
  let x = 0;
  let y = 0;
  let n = 0;
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    x += lng;
    y += lat;
    n++;
  }
  if (!n) return null;
  return { lng: x / n, lat: y / n };
}

function pointInRing(lng, lat, ring) {
  // Ray casting
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
