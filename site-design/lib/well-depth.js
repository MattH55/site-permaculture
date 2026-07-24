/**
 * Predicted well depth (pipeline step 6c).
 *
 * Primary signal: nearby drilled well records (AWWI when imported).
 * Covariates: surface elevation + AGS bedrock-topography proxy.
 * Method: inverse-distance weighting (IDW) first pass; range from well-depth spread.
 *
 * NEVER present a single confident number in the UI — always a range + driller disclaimer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineKm } from './proximity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RADIUS_KM = 5;
const DENSE_MIN = 8;
const POWER = 2;

let wellsCache = null;

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ elevation_m?: number|null }} opts
 */
export function predictWellDepth(centre, opts = {}) {
  const lat = centre.latitude;
  const lng = centre.longitude;
  const surfaceElev = num(opts.elevation_m);
  const radiusKm = num(opts.search_radius_km) || DEFAULT_RADIUS_KM;

  const wells = loadWells();
  const nearby = wells
    .map((w) => ({
      ...w,
      distance_km: haversineKm(lat, lng, w.lat, w.lng),
    }))
    .filter((w) => w.distance_km <= radiusKm && num(w.depth_m) != null)
    .sort((a, b) => a.distance_km - b.distance_km);

  // Expand radius once if sparse
  let usedRadius = radiusKm;
  let used = nearby;
  if (used.length < 3) {
    usedRadius = Math.min(radiusKm * 3, 15);
    used = wells
      .map((w) => ({
        ...w,
        distance_km: haversineKm(lat, lng, w.lat, w.lng),
      }))
      .filter((w) => w.distance_km <= usedRadius && num(w.depth_m) != null)
      .sort((a, b) => a.distance_km - b.distance_km);
  }

  const bedrockElev = bedrockElevationM(lat, lng, surfaceElev);
  const sedimentThickness =
    surfaceElev != null && bedrockElev != null
      ? Math.max(5, surfaceElev - bedrockElev)
      : null;

  const count = used.length;
  let confidence;
  if (count === 0) confidence = 'no_nearby_wells_bedrock_model_only';
  else if (count >= DENSE_MIN) confidence = 'well_control_dense';
  else confidence = 'well_control_sparse';

  let estimated_depth_m = null;
  let estimated_static_water_level_m = null;
  let low_m;
  let high_m;
  let formation = null;

  if (count === 0) {
    // Fallback: regional bedrock / sediment model alone
    const model = regionalDepthModel(lat, lng, surfaceElev, sedimentThickness);
    estimated_depth_m = model.depth_m;
    estimated_static_water_level_m = model.swl_m;
    low_m = model.low_m;
    high_m = model.high_m;
    formation = model.formation;
  } else {
    // IDW on depth and SWL; optional soft pull toward sediment-thickness covariate
    estimated_depth_m = idw(
      used.map((w) => ({ d: w.distance_km, v: w.depth_m }))
    );
    const swlPts = used
      .filter((w) => num(w.swl_m) != null)
      .map((w) => ({ d: w.distance_km, v: w.swl_m }));
    estimated_static_water_level_m = swlPts.length
      ? idw(swlPts)
      : estimated_depth_m != null
        ? round1(estimated_depth_m * 0.4)
        : null;

    // Blend slightly with bedrock-implied thickness when available (regression covariate light touch)
    if (sedimentThickness != null && estimated_depth_m != null) {
      const target = Math.min(sedimentThickness * 0.85, sedimentThickness - 2);
      if (target > 8) {
        estimated_depth_m = round1(0.85 * estimated_depth_m + 0.15 * target);
      }
    }

    // Range from spread of nearby well depths (geological heterogeneity), not just IDW error
    const depths = used.map((w) => w.depth_m);
    const mean = meanOf(depths);
    const std = stdev(depths);
    const minD = Math.min(...depths);
    const maxD = Math.max(...depths);
    // Wider when sparse
    const pad = confidence === 'well_control_dense' ? 0.5 * std : 0.85 * std;
    low_m = round1(Math.max(5, Math.min(minD, estimated_depth_m - pad) - 2));
    high_m = round1(Math.max(maxD, estimated_depth_m + pad) + 3);
    // Ensure estimate sits inside range
    if (estimated_depth_m < low_m) estimated_depth_m = low_m;
    if (estimated_depth_m > high_m) estimated_depth_m = high_m;

    formation =
      modeString(used.map((w) => w.formation).filter(Boolean)) ||
      regionalFormation(lat, lng);
  }

  return {
    estimated_depth_m:
      estimated_depth_m != null ? round1(estimated_depth_m) : null,
    estimated_depth_range_m: {
      low_m: round1(low_m),
      high_m: round1(high_m),
    },
    estimated_static_water_level_m:
      estimated_static_water_level_m != null
        ? round1(estimated_static_water_level_m)
        : null,
    target_hydrostratigraphic_unit: formation,
    nearby_well_count: count,
    nearby_well_search_radius_km: usedRadius,
    confidence,
    disclaimer_required: true,
    disclaimer:
      'Estimated depth range only — not a guaranteed drilled depth. Geological heterogeneity (buried channels, lens pinch-outs) can change well depth over short distances. Consult a local licensed water-well driller for a site-specific quote before any construction decision.',
    _meta: {
      method: count === 0 ? 'bedrock_regional_fallback' : 'idw_nearby_wells',
      surface_elevation_m: surfaceElev,
      bedrock_elevation_m_proxy: bedrockElev,
      sediment_thickness_m_proxy: sedimentThickness,
      well_data_source: wellsSourceLabel(),
    },
  };
}

function loadWells() {
  if (wellsCache) return wellsCache;
  const candidates = [];
  if (process.env.WATER_WELLS_PATH) candidates.push(process.env.WATER_WELLS_PATH);
  candidates.push(
    path.join(__dirname, '..', 'data', 'wells', 'local-wells.json'),
    path.join(__dirname, '..', 'data', 'wells', 'seed-control.json')
  );

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.wells || [];
      const cleaned = list
        .map((w) => ({
          lat: Number(w.lat ?? w.latitude),
          lng: Number(w.lng ?? w.longitude ?? w.lon),
          depth_m: num(w.depth_m ?? w.depth ?? w.well_depth_m),
          swl_m: num(w.swl_m ?? w.static_water_level_m ?? w.water_level_m),
          formation: w.formation || w.unit || null,
          source: w.source || path.basename(p),
        }))
        .filter(
          (w) =>
            Number.isFinite(w.lat) &&
            Number.isFinite(w.lng) &&
            w.depth_m != null &&
            w.depth_m > 0
        );
      if (cleaned.length) {
        wellsCache = cleaned;
        wellsCache._path = p;
        return wellsCache;
      }
    } catch (e) {
      console.warn('well load failed', p, e.message);
    }
  }
  wellsCache = [];
  wellsCache._path = null;
  return wellsCache;
}

function wellsSourceLabel() {
  const p = wellsCache?._path;
  if (!p) return 'none';
  if (String(p).includes('seed-control')) {
    return 'Interim seed-control.json (replace with AWWI bulk export for production)';
  }
  if (String(p).includes('local-wells') || process.env.WATER_WELLS_PATH) {
    return 'Local / WATER_WELLS_PATH well records (AWWI or derived)';
  }
  return path.basename(p);
}

/**
 * Proxy for AGS Map 610 bedrock topography until the ASCII grid is hosted.
 * Returns approximate bedrock elevation (m asl).
 */
function bedrockElevationM(lat, lng, surfaceElev) {
  if (surfaceElev == null) return null;
  // Typical Quaternary sediment thickness proxy by region
  let thickness = 35;
  if (lat < 50.5) thickness = 45; // south
  else if (lat < 52) thickness = 40;
  else if (lat < 54.5) thickness = 32; // parkland / Edmonton
  else if (lat < 56) thickness = 38; // Peace
  else thickness = 30; // north

  // Foothills (west) — thinner drift, bedrock nearer surface
  if (lng < -114.5 && lat > 50.5 && lat < 53.5) thickness = Math.min(thickness, 25);
  // SE dry prairie — variable
  if (lng > -112 && lat < 51.5) thickness = 50;

  return round1(surfaceElev - thickness);
}

function regionalDepthModel(lat, lng, surfaceElev, sedimentThickness) {
  const thick = sedimentThickness ?? 35;
  // Domestic wells often finish short of full bedrock if a sand/gravel unit is hit earlier
  const depth = Math.min(Math.max(thick * 0.75, 18), thick + 5);
  const low = Math.max(10, depth * 0.55);
  const high = depth * 1.45 + 8;
  return {
    depth_m: round1(depth),
    swl_m: round1(depth * 0.4),
    low_m: round1(low),
    high_m: round1(high),
    formation: regionalFormation(lat, lng),
  };
}

function regionalFormation(lat, lng) {
  if (lng < -114.5 && lat > 50.5 && lat < 53.5) return 'Paskapoo / foothills systems (regional)';
  if (lat < 50.8 && lng > -113) return 'Southern plains aquifers (regional)';
  if (lat > 55) return 'Boreal / northern drift aquifers (regional)';
  if (lat > 54) return 'Peace Country drift aquifers (regional)';
  return 'Quaternary drift / Empress-type buried channel systems (regional parkland)';
}

function idw(points) {
  // points: { d: distance_km, v: value }
  if (!points.length) return null;
  let numW = 0;
  let den = 0;
  for (const p of points) {
    const d = Math.max(p.d, 0.05); // avoid div0 for colocated
    const w = 1 / d ** POWER;
    numW += w * p.v;
    den += w;
  }
  return den > 0 ? numW / den : meanOf(points.map((p) => p.v));
}

function meanOf(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr) {
  if (arr.length < 2) return arr[0] ? arr[0] * 0.2 : 5;
  const m = meanOf(arr);
  const v = meanOf(arr.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

function modeString(arr) {
  if (!arr.length) return null;
  const m = new Map();
  for (const s of arr) m.set(s, (m.get(s) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [k, c] of m) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
