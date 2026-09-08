/**
 * Solar location-suitability score — largely a repackaging of the existing
 * horizon-shading model's output (solar-horizon-shading.js) as a formal
 * 0-100 suitability layer, plus a slope/orientation bonus.
 *
 * Independently scored from the pond/wind suitability layers — see
 * location-suitability-scoring-instructions.md. Not reconciled against
 * them here.
 *
 * Sub-criteria:
 *  - Base score: annual insolation hours (from computeSolarHorizonShading's
 *    parcel raster, which already bakes in terrain self-shading), normalized
 *    0-100 across the parcel.
 *  - Canopy shading: already computed inside that raster (canopy-clear vs
 *    terrain-clear hours) — carried through directly, not re-deducted here.
 *  - Slope/orientation bonus (soft): a south-facing slope near the optimal
 *    panel tilt for the site's latitude gets a modest bonus. Flat ground
 *    gets no bonus and no penalty — it's still perfectly viable for solar.
 */

import { computeSolarHorizonShading } from './solar-horizon-shading.js';
import {
  normalizeLinear, scoreBand, bandSummary, weakestConfidence,
  pointInAnyPolygon, distanceToNearestFeatureM, topNWellSeparated, cellPolygon,
  cachedSuitability, clamp, round1,
} from './suitability-common.js';

const DEFAULT_CONFIG = {
  slope_hard_pct: 35,        // steep enough to complicate ground-mount racking
  structure_buffer_m: 5,     // clearance from the structure footprint itself
  orientation_bonus_max: 10,
  south_tolerance_deg: 90,   // bonus reaches 0 at this angular distance from due south
  tilt_tolerance_deg: 30,    // bonus reaches 0 at this difference from latitude-optimal tilt
  min_slope_deg_for_bonus: 2, // below this, terrain is treated as flat (no bonus, no penalty)
};

/**
 * @param {object} opts Same DEM/canopy/latitude/longitude shape as
 *   computeSolarHorizonShading, plus:
 * @param {object} [opts.solar_horizon_shading] A pre-computed
 *   computeSolarHorizonShading() result to reuse instead of recomputing.
 * @param {object} [opts.surface_water] getSurfaceWaterLayer() result
 * @param {Array<{geometry:object}>} [opts.structures] Optional footprints
 * @param {object} [opts.config]
 * @param {string} [opts.parcel_id]
 */
export function computeSolarSuitability(opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const compute = () => computeUncached(opts, cfg);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(opts.parcel_id, [
    'solar', opts.rows, opts.cols, opts.dem_confidence,
    opts.canopy?.data_source, opts.surface_water?._meta?.generated_at, (opts.structures || []).length,
  ], compute);
}

function computeUncached(opts, cfg) {
  const horizon = opts.solar_horizon_shading || computeSolarHorizonShading(opts);
  if (!horizon.available || !horizon.solar_exposure_raster) {
    return emptyResult(horizon.note || 'Insufficient terrain data for solar horizon shading.');
  }

  const raster = horizon.solar_exposure_raster;
  const { rows: fullRows, cols: fullCols, bbox, elevations } = opts;
  const stride = raster.stride;
  const points = gridPoints(fullRows, fullCols, bbox, stride);

  if (points.length !== raster.annual_insolation_hours.length) {
    return emptyResult('Solar raster point count did not match the expected grid stride — cannot align suitability scoring.');
  }

  const hours = raster.annual_insolation_hours;
  const minHours = Math.min(...hours);
  const maxHours = Math.max(...hours);

  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (fullCols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (fullRows - 1 || 1);
  const at = (r, c) => elevations[r * fullCols + c];

  const waterBodies = opts.surface_water?.water_bodies || [];
  const structures = opts.structures || [];
  const latitude = opts.latitude ?? (bbox.north + bbox.south) / 2;

  const scores = new Array(points.length).fill(null);
  const bands = new Array(points.length).fill(null);
  const excludedReasons = new Set();
  const candidates = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const baseScore = normalizeLinear(hours[i], minHours, maxHours);

    const exclusion = hardExclusion({
      lon: p.lon, lat: p.lat, r: p.r, c: p.c, at, fullRows, fullCols,
      cellWidthM, cellHeightM, waterBodies, structures, cfg,
    });
    if (exclusion) {
      excludedReasons.add(exclusion);
      scores[i] = 0;
      bands[i] = 'poor';
      continue;
    }

    const bonus = orientationBonus({ r: p.r, c: p.c, at, fullRows, fullCols, cellWidthM, cellHeightM, latitude, cfg });
    const score = clamp(baseScore + bonus, 0, 100);
    scores[i] = round1(score);
    bands[i] = scoreBand(score);
    candidates.push({ r: p.r, c: p.c, lat: p.lat, lon: p.lon, score, baseScore, bonus });
  }

  const cellHalfLon = ((bbox.east - bbox.west) / (fullCols - 1)) * stride / 2;
  const cellHalfLat = ((bbox.north - bbox.south) / (fullRows - 1)) * stride / 2;
  const picked = topNWellSeparated(candidates, 6, 3);
  const topCandidateZones = picked.map((cand, i) => ({
    zone_id: `solar-suitability-${i + 1}`,
    geometry: cellPolygon(cand.lat, cand.lon, cellHalfLat, cellHalfLon),
    score: round1(cand.score),
    band: scoreBand(cand.score),
    basis: cand.bonus > 0.5
      ? ['annual_insolation', 'south_facing_slope_bonus']
      : ['annual_insolation'],
  }));

  const confidence = weakestConfidence([horizon.confidence, opts.canopy?.available === false ? 'unavailable' : 'moderate']);

  return {
    suitability_type: 'solar',
    available: true,
    suitability_raster: { rows: raster.rows, cols: raster.cols, stride, bbox, scores, bands },
    band_summary: bandSummary(scores.filter(Number.isFinite)),
    top_candidate_zones: topCandidateZones,
    hard_exclusions_applied: [...excludedReasons],
    data_source: {
      base_insolation: horizon.data_source,
      canopy_shading: horizon.canopy_shading_assumption,
      canopy_shading_note: horizon.canopy_shading_note,
    },
    confidence,
    thresholds: { slope_hard_pct: cfg.slope_hard_pct, structure_buffer_m: cfg.structure_buffer_m },
    orientation_bonus: { max: cfg.orientation_bonus_max, note: 'South-facing slope near latitude-optimal tilt adds up to this many points; flat ground gets no bonus and no penalty.' },
    methodology: horizon.methodology,
    assumptions: [
      'Base score is the parcel-relative normalization of annual insolation hours (min-max across this parcel\'s own raster), not an absolute kWh/m² figure — pair with assessSolar() (solar.js) for the municipality-level absolute insolation estimate.',
      'Canopy shading is the horizon-shading model\'s terrain+canopy-clear hours, carried through as-is — not re-deducted here.',
    ],
  };
}

function emptyResult(reason) {
  return {
    suitability_type: 'solar',
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

function gridPoints(rows, cols, bbox, stride) {
  const points = [];
  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];
  for (let r = 1; r < rows - 1; r += stride) {
    for (let c = 1; c < cols - 1; c += stride) {
      const [lon, lat] = local(r, c);
      points.push({ r, c, lat, lon });
    }
  }
  return points;
}

function hardExclusion({ lon, lat, r, c, at, fullRows, fullCols, cellWidthM, cellHeightM, waterBodies, structures, cfg }) {
  if (pointInAnyPolygon(lon, lat, waterBodies)) return 'existing_water';
  if (structures.length && nearAnyStructure(lat, lon, structures, cfg.structure_buffer_m)) return 'structure_footprint';
  const { slopePercent } = slopeAspect({ r, c, at, fullRows, fullCols, cellWidthM, cellHeightM });
  if (slopePercent >= cfg.slope_hard_pct) return 'steep_slope';
  return null;
}

function nearAnyStructure(lat, lon, structures, bufferM) {
  return structures.some((s) => {
    const ring = s?.geometry?.coordinates?.[0];
    if (!Array.isArray(ring)) return false;
    return distanceToNearestFeatureM(lat, lon, [{ geometry: { type: 'LineString', coordinates: ring } }]) <= bufferM;
  });
}

function orientationBonus({ r, c, at, fullRows, fullCols, cellWidthM, cellHeightM, latitude, cfg }) {
  const { slopePercent, aspectDeg } = slopeAspect({ r, c, at, fullRows, fullCols, cellWidthM, cellHeightM });
  const slopeDeg = Math.atan(slopePercent / 100) * (180 / Math.PI);
  if (slopeDeg < cfg.min_slope_deg_for_bonus || aspectDeg == null) return 0;

  const southDiff = angularDiff(aspectDeg, 180);
  const southAlignment = clamp(1 - southDiff / cfg.south_tolerance_deg, 0, 1);

  const optimalTilt = Math.abs(latitude); // rule-of-thumb: tilt ≈ site latitude
  const tiltDiff = Math.abs(slopeDeg - optimalTilt);
  const tiltAlignment = clamp(1 - tiltDiff / cfg.tilt_tolerance_deg, 0, 1);

  return cfg.orientation_bonus_max * southAlignment * tiltAlignment;
}

/** Central-difference slope (%) and downslope-facing aspect (° from N, compass). */
function slopeAspect({ r, c, at, fullRows, fullCols, cellWidthM, cellHeightM }) {
  if (r <= 0 || r >= fullRows - 1 || c <= 0 || c >= fullCols - 1) return { slopePercent: 0, aspectDeg: null };
  const zE = at(r, c + 1), zW = at(r, c - 1), zN = at(r - 1, c), zS = at(r + 1, c);
  if (![zE, zW, zN, zS].every(Number.isFinite)) return { slopePercent: 0, aspectDeg: null };
  const dzdx = (zE - zW) / (2 * cellWidthM);   // east-positive gradient
  const dzdy = (zN - zS) / (2 * cellHeightM);  // north-positive gradient (row decreases northward)
  const slopePercent = Math.hypot(dzdx, dzdy) * 100;
  if (slopePercent < 0.5) return { slopePercent, aspectDeg: null }; // effectively flat — no defined aspect
  const aspectDeg = normalizeDeg((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI);
  return { slopePercent, aspectDeg };
}

function angularDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function normalizeDeg(d) { return ((d % 360) + 360) % 360; }

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function deg2rad(d) { return (d * Math.PI) / 180; }

export const _internal = { DEFAULT_CONFIG, slopeAspect };
