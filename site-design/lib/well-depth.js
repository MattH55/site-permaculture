/**
 * Predicted well depth + enriched well data from the Alberta Water Wells DB.
 *
 * Primary: nearby drilled well records from data/wells/alberta-wells.json
 *   (extracted from the Access MDB via scripts/extract-alberta-wells.mjs).
 * Fallback: seed-control.json for small/offline deployments.
 * Method: inverse-distance weighting (IDW) with bedrock covariate.
 *
 * Returns:
 *   - predicted depth (IDW range)
 *   - nearby wells with pump test, chemistry, lithology, geophysics metadata
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RADIUS_KM = 5;
const DENSE_MIN = 8;

// ---------- Well data loader ----------

let wellsCache = null;

function loadWells() {
  if (wellsCache) return wellsCache;

  // 1. Try the compact alberta-wells.json
  const albertaWellsPath = path.join(__dirname, '..', 'data', 'wells', 'alberta-wells.json');
  if (fs.existsSync(albertaWellsPath)) {
    try {
      const raw = fs.readFileSync(albertaWellsPath, 'utf8');
      wellsCache = JSON.parse(raw);
      wellsCache._source = 'alberta-wells.json';
      return wellsCache;
    } catch (e) {
      console.warn('Failed to load alberta-wells.json:', e.message);
    }
  }

  // 2. Try seed-control.json
  for (const p of [
    path.join(__dirname, '..', 'data', 'wells', 'local-wells.json'),
    path.join(__dirname, '..', 'data', 'wells', 'seed-control.json'),
  ]) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.wells || [];
      wellsCache = list
        .map((w) => ({
          i: String(w.Well_ID || w.well_id || ''),
          la: round5(w.lat ?? w.latitude),
          lo: round5(w.lng ?? w.longitude ?? w.lon),
          dp: round1(w.depth_m ?? w.depth ?? w.well_depth_m),
        }))
        .filter((w) => Number.isFinite(w.la) && Number.isFinite(w.lo) && w.dp > 0);
      wellsCache._source = path.basename(p);
      return wellsCache;
    } catch { /* try next */ }
  }

  wellsCache = [];
  wellsCache._source = 'none';
  return wellsCache;
}

// ---------- Haversine ----------

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Public API ----------

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ elevation_m?: number|null, search_radius_km?: number }} opts
 */
export function predictWellDepth(centre, opts = {}) {
  const lat = centre.latitude;
  const lng = centre.longitude;
  const surfaceElev = num(opts.elevation_m);
  const radiusKm = num(opts.search_radius_km) || DEFAULT_RADIUS_KM;

  const allWells = loadWells();
  const sourceLabel = allWells._source || 'none';

  // Filter nearby
  const nearby = [];
  for (const w of allWells) {
    const dkm = haversineKm(lat, lng, w.la, w.lo);
    if (dkm <= radiusKm) {
      nearby.push({ ...w, distance_km: round1(dkm) });
    }
  }
  nearby.sort((a, b) => a.distance_km - b.distance_km);

  // Expand radius if sparse
  let usedRadius = radiusKm;
  let used = nearby;
  if (used.length < 3) {
    usedRadius = Math.min(radiusKm * 3, 15);
    used = [];
    for (const w of allWells) {
      const dkm = haversineKm(lat, lng, w.la, w.lo);
      if (dkm <= usedRadius) {
        used.push({ ...w, distance_km: round1(dkm) });
      }
    }
    used.sort((a, b) => a.distance_km - b.distance_km);
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
  let low_m, high_m;
  let formation = null;

  if (count === 0) {
    const model = regionalDepthModel(lat, lng, surfaceElev, sedimentThickness);
    estimated_depth_m = model.depth_m;
    estimated_static_water_level_m = model.swl_m;
    low_m = model.low_m;
    high_m = model.high_m;
    formation = model.formation;
  } else {
    const depthPoints = used.map((w) => ({ d: w.distance_km, v: w.dp }));
    estimated_depth_m = idw(depthPoints);

    // SWL from pump tests if available
    const swlPts = used
      .filter((w) => w.pt?.swl_m != null)
      .map((w) => ({ d: w.distance_km, v: w.pt.swl_m }));
    estimated_static_water_level_m = swlPts.length
      ? idw(swlPts)
      : estimated_depth_m != null
        ? round1(estimated_depth_m * 0.4)
        : null;

    if (sedimentThickness != null && estimated_depth_m != null) {
      const target = Math.min(sedimentThickness * 0.85, sedimentThickness - 2);
      if (target > 8) {
        estimated_depth_m = round1(0.85 * estimated_depth_m + 0.15 * target);
      }
    }

    const depths = used.map((w) => w.dp);
    const mn = meanOf(depths);
    const std = stdev(depths);
    const minD = Math.min(...depths);
    const maxD = Math.max(...depths);
    const pad = confidence === 'well_control_dense' ? 0.5 * std : 0.85 * std;
    low_m = round1(Math.max(5, Math.min(minD, estimated_depth_m - pad) - 2));
    high_m = round1(Math.max(maxD, estimated_depth_m + pad) + 3);
    if (estimated_depth_m < low_m) estimated_depth_m = low_m;
    if (estimated_depth_m > high_m) estimated_depth_m = high_m;

    formation = modeString(used.map((w) => w.aq).filter(Boolean)) || regionalFormation(lat, lng);
  }

  // Enrich: build summary stats from nearby wells
  const yieldList = used.map((w) => w.yd).filter((v) => v != null && v > 0);
  const pumpWells = used.filter((w) => w.pt);
  const chemWells = used.filter((w) => w.ch);
  const lithWells = used.filter((w) => w.lx);
  const geoWells = used.filter((w) => w.gp);

  return {
    estimated_depth_m: estimated_depth_m != null ? round1(estimated_depth_m) : null,
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
    nearby_wells: used.slice(0, 40).map((w) => ({
      lat: w.la,
      lng: w.lo,
      depth_m: w.dp,
      distance_km: w.distance_km,
    })),
    confidence,
    // Enriched stats
    yield_summary: yieldList.length
      ? {
          count: yieldList.length,
          mean: round1(meanOf(yieldList)),
          max: round1(Math.max(...yieldList)),
          min: round1(Math.min(...yieldList)),
          unit: 'rate (varies)',
        }
      : null,
    pump_test_summary: pumpWells.length
      ? {
          count: pumpWells.length,
          swl_range_m: { low: round1(minBy(pumpWells, 'pt.swl_m')), high: round1(maxBy(pumpWells, 'pt.swl_m')) },
          yield_range: pumpWells.some((w) => w.pt?.rate)
            ? {
                low: round1(minBy(pumpWells.filter((w) => w.pt?.rate), 'pt.rate')),
                high: round1(maxBy(pumpWells.filter((w) => w.pt?.rate), 'pt.rate')),
              }
            : null,
        }
      : null,
    chemistry_summary: chemWells.length
      ? {
          count: chemWells.length,
          elements: mergeChemElements(chemWells),
        }
      : null,
    lithology_summary: lithWells.length
      ? {
          count: lithWells.length,
          top_materials: modeStringList(lithWells.map((w) => w.lx?.top_mat).filter(Boolean)),
        }
      : null,
    geophysics_available: geoWells.length,
    disclaimer_required: true,
    disclaimer:
      'Estimated depth range only — not a guaranteed drilled depth. Geological heterogeneity (buried channels, lens pinch-outs) can change well depth over short distances. Consult a local licensed water-well driller for a site-specific quote.',
    _meta: {
      method: count === 0 ? 'bedrock_regional_fallback' : 'idw_nearby_wells',
      surface_elevation_m: surfaceElev,
      bedrock_elevation_m_proxy: bedrockElev,
      sediment_thickness_m_proxy: sedimentThickness,
      well_data_source: sourceLabel,
    },
  };
}

// ---------- Chemistry merge ----------

function mergeChemElements(chemWells) {
  const merged = {};
  for (const w of chemWells) {
    if (!w.ch?.elems) continue;
    for (const [k, v] of Object.entries(w.ch.elems)) {
      if (!merged[k]) merged[k] = [];
      merged[k].push(v);
    }
  }
  const result = {};
  for (const [k, vals] of Object.entries(merged)) {
    result[k] = {
      mean: round2(meanOf(vals)),
      min: round2(Math.min(...vals)),
      max: round2(Math.max(...vals)),
      n: vals.length,
    };
  }
  return result;
}

// ---------- Helpers ----------

function bedrockElevationM(lat, lng, surfaceElev) {
  if (surfaceElev == null) return null;
  let thickness = 35;
  if (lat < 50.5) thickness = 45;
  else if (lat < 52) thickness = 40;
  else if (lat < 54.5) thickness = 32;
  else if (lat < 56) thickness = 38;
  else thickness = 30;
  if (lng < -114.5 && lat > 50.5 && lat < 53.5) thickness = Math.min(thickness, 25);
  if (lng > -112 && lat < 51.5) thickness = 50;
  return round1(surfaceElev - thickness);
}

function regionalDepthModel(lat, lng, surfaceElev, sedimentThickness) {
  const thick = sedimentThickness ?? 35;
  const depth = Math.min(Math.max(thick * 0.75, 18), thick + 5);
  return {
    depth_m: round1(depth),
    swl_m: round1(depth * 0.4),
    low_m: round1(Math.max(10, depth * 0.55)),
    high_m: round1(depth * 1.45 + 8),
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
  if (!points.length) return null;
  let numW = 0, den = 0;
  for (const p of points) {
    const d = Math.max(p.d, 0.05);
    const w = 1 / (d * d);
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
  return Math.sqrt(meanOf(arr.map((x) => (x - m) ** 2)));
}

function modeString(arr) {
  const m = new Map();
  for (const s of arr) m.set(s, (m.get(s) || 0) + 1);
  let best = null, n = 0;
  for (const [k, c] of m) { if (c > n) { best = k; n = c; } }
  return best;
}

function modeStringList(arr) {
  const counts = new Map();
  for (const s of arr) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
}

function minBy(arr, path) {
  let best = Infinity;
  for (const obj of arr) {
    const v = getPath(obj, path);
    if (v != null && v < best) best = v;
  }
  return best === Infinity ? null : best;
}

function maxBy(arr, path) {
  let best = -Infinity;
  for (const obj of arr) {
    const v = getPath(obj, path);
    if (v != null && v > best) best = v;
  }
  return best === -Infinity ? null : best;
}

function getPath(obj, dotPath) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function round5(n) { return Math.round(n * 100000) / 100000; }