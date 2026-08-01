/**
 * Predicted well depth from subsurface hydrology + nearby AWWI control.
 *
 * Primary signals (in priority order for completion depth):
 *   1. Screen interval bottom (where the well is actually completed)
 *   2. Water-bearing lithology zones (first wet interval + completion allowance)
 *   3. Static water level + typical productive interval from nearby pump tests
 *   4. Finished / total drilled depth only as a weak fallback
 *
 * Covariates: surface elevation, AGS bedrock-thickness proxy, Alberta Wet Areas
 * Mapping depth-to-water (near-surface groundwater context).
 *
 * Units: AWWI bulk export stores depths/elevations in feet. We convert to metres
 * on load (seed-control.json is already in metres).
 *
 * Method: inverse-distance weighting (IDW) over hydrostratigraphic targets —
 * not the min–max of total drilled depths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RADIUS_KM = 5;
const DENSE_MIN = 8;
const FT_TO_M = 0.3048;
/** Typical domestic completion below water table when only SWL is known (m). */
const TYPICAL_COMPLETION_BELOW_SWL_M = 12;
/** Minimum practical domestic well depth (m). */
const MIN_WELL_M = 8;

// ---------- Well data loader ----------

let wellsCache = null;

function loadWells() {
  if (wellsCache) return wellsCache;

  // 1. Prefer full AWWI extract
  const albertaWellsPath = path.join(__dirname, '..', 'data', 'wells', 'alberta-wells.json');
  if (fs.existsSync(albertaWellsPath)) {
    try {
      const raw = fs.readFileSync(albertaWellsPath, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length) {
        wellsCache = normalizeAwwiUnits(list);
        wellsCache._source = 'alberta-wells.json';
        return wellsCache;
      }
    } catch (e) {
      console.warn('Failed to load alberta-wells.json:', e.message);
    }
  }

  // 2. Seed / local (already metres)
  for (const p of [
    process.env.WATER_WELLS_PATH,
    path.join(__dirname, '..', 'data', 'wells', 'local-wells.json'),
    path.join(__dirname, '..', 'data', 'wells', 'seed-control.json'),
  ].filter(Boolean)) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.wells || [];
      wellsCache = list
        .map((w) => ({
          i: String(w.Well_ID || w.well_id || w.i || ''),
          la: round5(w.lat ?? w.latitude ?? w.la),
          lo: round5(w.lng ?? w.longitude ?? w.lon ?? w.lo),
          dp: round1(w.depth_m ?? w.depth ?? w.well_depth_m ?? w.dp),
          el: num(w.elev ?? w.elevation_m ?? w.el),
          yd: num(w.yield ?? w.yd),
          aq: w.formation || w.aquifer || w.aq || null,
          pt:
            w.pt ||
            (w.swl_m != null
              ? { swl_m: num(w.swl_m) }
              : w.static_water_level_m != null
                ? { swl_m: num(w.static_water_level_m) }
                : null),
          sc: w.sc || null,
          lx: w.lx || null,
        }))
        .filter((w) => Number.isFinite(w.la) && Number.isFinite(w.lo) && w.dp > 0);
      wellsCache._source = path.basename(p);
      wellsCache._units = 'm';
      return wellsCache;
    } catch {
      /* try next */
    }
  }

  wellsCache = [];
  wellsCache._source = 'none';
  wellsCache._units = 'm';
  return wellsCache;
}

/**
 * AWWI Access export: Total_Depth_Drilled, Static_Water_Level, Elevation, screen
 * intervals, and lithology depths are imperial (feet). Seed data is already m.
 * Detect by median drilled depth of a sample (feet medians sit well above 80).
 */
function normalizeAwwiUnits(list) {
  const sample = [];
  for (let i = 0; i < list.length && sample.length < 800; i += Math.max(1, Math.floor(list.length / 800))) {
    if (list[i]?.dp > 0) sample.push(list[i].dp);
  }
  const med = sample.length ? median(sample) : 0;
  const fromFeet = med > 80;

  if (!fromFeet) {
    list._units = 'm';
    return list;
  }

  for (const w of list) {
    if (w.dp != null) w.dp = round1(w.dp * FT_TO_M);
    if (w.el != null && w.el > 0) w.el = round1(w.el * FT_TO_M);
    if (w.pt) {
      if (w.pt.swl_m != null) w.pt.swl_m = round2(w.pt.swl_m * FT_TO_M);
      if (w.pt.end_wl_m != null) w.pt.end_wl_m = round2(w.pt.end_wl_m * FT_TO_M);
      if (w.pt.drawdown_m != null) w.pt.drawdown_m = round2(w.pt.drawdown_m * FT_TO_M);
    }
    if (w.sc) {
      if (w.sc.t != null) w.sc.t = round1(w.sc.t * FT_TO_M);
      if (w.sc.b != null) w.sc.b = round1(w.sc.b * FT_TO_M);
    }
    if (w.lx?.wet_at_m?.length) {
      w.lx.wet_at_m = w.lx.wet_at_m.map((d) => round1(d * FT_TO_M));
    }
  }
  list._units = 'm';
  list._converted_from = 'ft';
  return list;
}

// ---------- Hydrostratigraphic target per well ----------

/**
 * Best estimate of productive completion depth (m bgs) for one control well.
 * Prefers screen / wet lithology / SWL+interval over total drilled depth.
 */
function aquiferCompletionDepthM(w) {
  // 1. Screen bottom — true completion interval
  if (w.sc?.b != null && w.sc.b > 0) return w.sc.b;

  // 2. Water-bearing lithology — first wet zone + short completion allowance
  if (w.lx?.wet_at_m?.length) {
    const wet = w.lx.wet_at_m.filter((d) => d != null && d > 0);
    if (wet.length) return Math.min(...wet) + 5;
  }

  // 3. SWL + typical productive interval (clamp to drilled depth when known)
  const swl = w.pt?.swl_m;
  if (swl != null && swl > 0) {
    const target = swl + TYPICAL_COMPLETION_BELOW_SWL_M;
    if (w.dp != null && w.dp > 0) {
      // Domestic wells often over-drill; stay between SWL+8 and 90% of total
      return clamp(target, swl + 8, Math.max(swl + 8, w.dp * 0.9));
    }
    return target;
  }

  // 4. Weak fallback — total drilled (not preferred for display as "range")
  return w.dp != null && w.dp > 0 ? w.dp : null;
}

function wellHydrologySignals(w) {
  const completion = aquiferCompletionDepthM(w);
  const swl = w.pt?.swl_m != null && w.pt.swl_m > 0 ? w.pt.swl_m : null;
  const screenTop = w.sc?.t != null && w.sc.t > 0 ? w.sc.t : null;
  const screenBot = w.sc?.b != null && w.sc.b > 0 ? w.sc.b : null;
  const wetTop =
    w.lx?.wet_at_m?.length
      ? Math.min(...w.lx.wet_at_m.filter((d) => d > 0))
      : null;
  return { completion, swl, screenTop, screenBot, wetTop, drilled: w.dp };
}

// ---------- Public API ----------

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{
 *   elevation_m?: number|null,
 *   search_radius_km?: number,
 *   depth_to_water_m?: number|null,
 *   depth_to_water_category?: object|null,
 * }} opts
 */
export function predictWellDepth(centre, opts = {}) {
  const lat = centre.latitude;
  const lng = centre.longitude;
  const surfaceElev = num(opts.elevation_m);
  const radiusKm = num(opts.search_radius_km) || DEFAULT_RADIUS_KM;
  const wamDtwM = num(opts.depth_to_water_m);

  const allWells = loadWells();
  const sourceLabel = allWells._source || 'none';

  let used = collectNearby(allWells, lat, lng, radiusKm);
  let usedRadius = radiusKm;
  if (used.length < 3) {
    usedRadius = Math.min(radiusKm * 3, 15);
    used = collectNearby(allWells, lat, lng, usedRadius);
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

  // Hydro signals from nearby control
  const signals = used.map((w) => ({
    d: w.distance_km,
    ...wellHydrologySignals(w),
  }));

  const completionPts = signals
    .filter((s) => s.completion != null)
    .map((s) => ({ d: s.d, v: s.completion }));
  const swlPts = signals
    .filter((s) => s.swl != null)
    .map((s) => ({ d: s.d, v: s.swl }));
  const screenBotPts = signals
    .filter((s) => s.screenBot != null)
    .map((s) => ({ d: s.d, v: s.screenBot }));
  const wetTopPts = signals
    .filter((s) => s.wetTop != null)
    .map((s) => ({ d: s.d, v: s.wetTop }));

  let estimated_depth_m = null;
  let estimated_static_water_level_m = null;
  let aquifer_top_m = null;
  let low_m;
  let high_m;
  let formation = null;
  let method = 'bedrock_regional_fallback';
  let hydro_basis = [];

  if (count === 0) {
    const model = regionalDepthModel(lat, lng, surfaceElev, sedimentThickness, wamDtwM);
    estimated_depth_m = model.depth_m;
    estimated_static_water_level_m = model.swl_m;
    aquifer_top_m = model.aquifer_top_m;
    low_m = model.low_m;
    high_m = model.high_m;
    formation = model.formation;
    hydro_basis = model.basis;
  } else {
    // Static water level — pure subsurface hydrology signal
    if (swlPts.length) {
      estimated_static_water_level_m = idw(swlPts);
      hydro_basis.push(`SWL IDW from ${swlPts.length} pump tests`);
    }

    // Aquifer top: wet lithology → else SWL (unconfined) → else WAM DTW
    if (wetTopPts.length) {
      aquifer_top_m = idw(wetTopPts);
      hydro_basis.push(`water-bearing lithology top (${wetTopPts.length} logs)`);
    } else if (estimated_static_water_level_m != null) {
      aquifer_top_m = estimated_static_water_level_m;
      hydro_basis.push('aquifer top ≈ static water level');
    } else if (wamDtwM != null) {
      aquifer_top_m = wamDtwM;
      hydro_basis.push('aquifer top from Wet Areas Mapping depth-to-water');
    }

    // Completion depth: IDW of per-well aquifer targets (each well already
    // prefers its own screen → wet lithology → SWL+interval → drilled depth).
    // Pure screen-only IDW needs enough control to beat the blended target.
    if (screenBotPts.length >= 6) {
      estimated_depth_m = idw(screenBotPts);
      method = 'idw_screen_completion';
      hydro_basis.push(`screen-bottom IDW (${screenBotPts.length} wells)`);
    } else if (completionPts.length) {
      estimated_depth_m = idw(completionPts);
      method = 'idw_aquifer_completion';
      hydro_basis.push(
        `aquifer-completion IDW (${completionPts.length} wells` +
          (screenBotPts.length ? `; ${screenBotPts.length} with screens` : '') +
          ')'
      );
    }

    // Blend shallow WAM context only when wells are sparse and WAM is shallow
    if (
      wamDtwM != null &&
      estimated_static_water_level_m == null &&
      count < DENSE_MIN
    ) {
      estimated_static_water_level_m = wamDtwM;
      hydro_basis.push('SWL seeded from Wet Areas Mapping (sparse well SWL)');
    }

    // Ensure completion sits below water table with a productive interval
    if (estimated_depth_m != null && estimated_static_water_level_m != null) {
      const minComplete =
        estimated_static_water_level_m + Math.min(TYPICAL_COMPLETION_BELOW_SWL_M, 8);
      if (estimated_depth_m < minComplete) {
        estimated_depth_m = minComplete;
        hydro_basis.push('raised completion below SWL for productive interval');
      }
    } else if (estimated_depth_m == null && estimated_static_water_level_m != null) {
      estimated_depth_m =
        estimated_static_water_level_m + TYPICAL_COMPLETION_BELOW_SWL_M;
      method = 'swl_plus_completion_interval';
      hydro_basis.push('completion = SWL + typical productive interval');
    }

    // Bedrock / drift thickness as soft upper bound for shallow drift aquifers
    if (
      sedimentThickness != null &&
      estimated_depth_m != null &&
      sedimentThickness < 80 &&
      estimated_depth_m > sedimentThickness * 1.15
    ) {
      // Prefer staying in drift unless nearby wells clearly go deeper into bedrock
      const deepBedrockShare =
        completionPts.filter((p) => p.v > sedimentThickness).length /
        Math.max(completionPts.length, 1);
      if (deepBedrockShare < 0.35) {
        estimated_depth_m = round1(
          0.7 * estimated_depth_m + 0.3 * Math.max(MIN_WELL_M, sedimentThickness * 0.85)
        );
        hydro_basis.push('soft-bound by drift thickness (bedrock proxy)');
      }
    }

    // Confidence band from completion-depth scatter (not raw drilled min–max)
    const completionVals = completionPts.map((p) => p.v);
    if (completionVals.length >= 2) {
      const std = stdev(completionVals);
      const pad = confidence === 'well_control_dense' ? 0.55 * std : 0.9 * std;
      low_m = round1(Math.max(MIN_WELL_M, estimated_depth_m - pad - 2));
      high_m = round1(estimated_depth_m + pad + 3);
    } else if (estimated_depth_m != null) {
      const spread = confidence === 'well_control_dense' ? 0.18 : 0.32;
      low_m = round1(Math.max(MIN_WELL_M, estimated_depth_m * (1 - spread)));
      high_m = round1(estimated_depth_m * (1 + spread) + 4);
    } else {
      const model = regionalDepthModel(lat, lng, surfaceElev, sedimentThickness, wamDtwM);
      estimated_depth_m = model.depth_m;
      estimated_static_water_level_m = estimated_static_water_level_m ?? model.swl_m;
      aquifer_top_m = aquifer_top_m ?? model.aquifer_top_m;
      low_m = model.low_m;
      high_m = model.high_m;
      method = 'bedrock_regional_fallback';
      hydro_basis = model.basis;
    }

    if (estimated_depth_m != null) {
      estimated_depth_m = round1(Math.max(MIN_WELL_M, estimated_depth_m));
      if (estimated_depth_m < low_m) low_m = estimated_depth_m;
      if (estimated_depth_m > high_m) high_m = estimated_depth_m;
    }

    formation =
      modeString(used.map((w) => w.aq).filter(Boolean)) || regionalFormation(lat, lng);
  }

  // Enrich summaries
  const yieldList = used.map((w) => w.yd).filter((v) => v != null && v > 0);
  const pumpWells = used.filter((w) => w.pt);
  const chemWells = used.filter((w) => w.ch);
  const lithWells = used.filter((w) => w.lx);
  const geoWells = used.filter((w) => w.gp);
  const screenWells = used.filter((w) => w.sc?.b != null);

  const nearby_wells = used.slice(0, 40).map((w) => {
    const sig = wellHydrologySignals(w);
    return {
      lat: w.la,
      lng: w.lo,
      depth_m: w.dp,
      completion_depth_m: sig.completion != null ? round1(sig.completion) : null,
      static_water_level_m: sig.swl != null ? round1(sig.swl) : null,
      screen_bottom_m: sig.screenBot != null ? round1(sig.screenBot) : null,
      distance_km: w.distance_km,
    };
  });

  return {
    // Primary recommendation — hydrostratigraphic completion depth
    estimated_depth_m: estimated_depth_m != null ? round1(estimated_depth_m) : null,
    estimated_depth_range_m: {
      low_m: round1(low_m),
      high_m: round1(high_m),
    },
    estimated_static_water_level_m:
      estimated_static_water_level_m != null
        ? round1(estimated_static_water_level_m)
        : null,
    estimated_aquifer_top_m: aquifer_top_m != null ? round1(aquifer_top_m) : null,
    target_hydrostratigraphic_unit: formation,
    nearby_well_count: count,
    nearby_well_search_radius_km: usedRadius,
    nearby_wells,
    confidence,
    hydrology_basis: hydro_basis,
    yield_summary: yieldList.length
      ? {
          count: yieldList.length,
          mean: round1(meanOf(yieldList)),
          max: round1(Math.max(...yieldList)),
          min: round1(Math.min(...yieldList)),
           unit: 'gpm (reported well yield)',
        }
      : null,
    pump_test_summary: pumpWells.length
      ? {
          count: pumpWells.length,
          swl_range_m: {
            low: round1(minBy(pumpWells, 'pt.swl_m')),
            high: round1(maxBy(pumpWells, 'pt.swl_m')),
          },
          yield_range: pumpWells.some((w) => w.pt?.rate)
            ? {
                low: round1(minBy(pumpWells.filter((w) => w.pt?.rate), 'pt.rate')),
                high: round1(maxBy(pumpWells.filter((w) => w.pt?.rate), 'pt.rate')),
                unit: 'gpm',
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
    screen_control_count: screenWells.length,
    geophysics_available: geoWells.length,
    disclaimer_required: true,
    disclaimer:
      'Hydrology-based estimate from nearby pump tests, screen intervals, and water-bearing lithology — not a guaranteed drilled depth. Geological heterogeneity (buried channels, lens pinch-outs) can change well depth over short distances. Consult a local licensed water-well driller for a site-specific quote.',
    _meta: {
      method,
      surface_elevation_m: surfaceElev,
      bedrock_elevation_m_proxy: bedrockElev,
      sediment_thickness_m_proxy: sedimentThickness,
      wet_areas_depth_to_water_m: wamDtwM,
      well_data_source: sourceLabel,
      units: allWells._units || 'm',
      converted_from: allWells._converted_from || null,
      hydro_signals: {
        swl_control: swlPts.length,
        screen_control: screenBotPts.length,
        wet_lithology_control: wetTopPts.length,
        completion_control: completionPts.length,
      },
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
      if (typeof v === 'number' && v >= 0) merged[k].push(v);
    }
  }
  const result = {};
  for (const [k, vals] of Object.entries(merged)) {
    if (!vals.length) continue;
    result[k] = {
      mean: round2(meanOf(vals)),
      min: round2(Math.min(...vals)),
      max: round2(Math.max(...vals)),
      n: vals.length,
    };
  }
  return result;
}

// ---------- Spatial / regional ----------

function collectNearby(allWells, lat, lng, radiusKm) {
  const nearby = [];
  for (const w of allWells) {
    if (w.la == null || w.lo == null) continue;
    const dkm = haversineKm(lat, lng, w.la, w.lo);
    if (dkm <= radiusKm) nearby.push({ ...w, distance_km: round1(dkm) });
  }
  nearby.sort((a, b) => a.distance_km - b.distance_km);
  return nearby;
}

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

function regionalDepthModel(lat, lng, surfaceElev, sedimentThickness, wamDtwM) {
  const thick = sedimentThickness ?? 35;
  const basis = ['regional hydrostratigraphic fallback'];
  let swl =
    wamDtwM != null
      ? wamDtwM
      : round1(Math.min(Math.max(thick * 0.28, 6), 25));
  if (wamDtwM != null) basis.push('Wet Areas Mapping depth-to-water');
  const depth = round1(
    Math.min(Math.max(swl + TYPICAL_COMPLETION_BELOW_SWL_M, thick * 0.55, MIN_WELL_M), thick + 8)
  );
  return {
    depth_m: depth,
    swl_m: round1(swl),
    aquifer_top_m: round1(swl),
    low_m: round1(Math.max(MIN_WELL_M, depth * 0.55)),
    high_m: round1(depth * 1.4 + 6),
    formation: regionalFormation(lat, lng),
    basis,
  };
}

function regionalFormation(lat, lng) {
  if (lng < -114.5 && lat > 50.5 && lat < 53.5) return 'Paskapoo / foothills systems (regional)';
  if (lat < 50.8 && lng > -113) return 'Southern plains aquifers (regional)';
  if (lat > 55) return 'Boreal / northern drift aquifers (regional)';
  if (lat > 54) return 'Peace Country drift aquifers (regional)';
  return 'Quaternary drift / Empress-type buried channel systems (regional parkland)';
}

// ---------- Stats helpers ----------

function idw(points) {
  if (!points.length) return null;
  let numW = 0;
  let den = 0;
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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(arr) {
  if (arr.length < 2) return arr[0] ? arr[0] * 0.15 : 5;
  const m = meanOf(arr);
  return Math.sqrt(meanOf(arr.map((x) => (x - m) ** 2)));
}

function modeString(arr) {
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

function modeStringList(arr) {
  const counts = new Map();
  for (const s of arr) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round5(n) {
  return Math.round(n * 100000) / 100000;
}
