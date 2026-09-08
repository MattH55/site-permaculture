/**
 * Pond location-suitability score — a lightweight, parcel-wide screening
 * layer, NOT a substitute for the full CN-based water-balance model
 * (pond-water-balance.js). Its job is to narrow a whole parcel down to a
 * manageable handful of promising candidates; any specific site should
 * still go through modelPondWaterBalance()/rankPondCandidateZones() before
 * being presented as a firm recommendation.
 *
 * Independently scored from the solar/wind suitability layers in this
 * pipeline — see location-suitability-scoring-instructions.md. Where this
 * layer and solar/wind both rate the same spot highly, that's expected and
 * left for a later reconciliation pass.
 *
 * Sub-criteria (each normalized to 0-100 before combining):
 *  - Flow accumulation (log-scale) — proxy for catchment draining through
 *    the cell.
 *  - Local slope — flatter favours siting, falls off sharply above a
 *    configurable threshold.
 *  - Soil holding capacity — poor drainage (clay-heavy) is FAVOURABLE here
 *    (better at holding water in an unlined pond). This is the opposite
 *    sign from septic-siting soil suitability (poor drainage is a red flag
 *    there) — kept as its own local table so the two numbers are never
 *    accidentally interchanged.
 *  - Keyline/valley-network proximity — a soft bonus on top of the base
 *    score, not a weighted sub-criterion.
 */

import { computeFlowAccumulation } from './flow-accumulation.js';
import {
  normalizeLog, softFalloff, scoreBand, bandSummary, weakestConfidence,
  pointInAnyPolygon, distanceToNearestFeatureM, topNWellSeparated, cellPolygon,
  cachedSuitability, clamp, round1,
} from './suitability-common.js';

const DEFAULT_CONFIG = {
  slope_soft_pct: 5,       // full score at/below this
  slope_hard_pct: 10,      // hard-exclusion boundary (also the score-zero point)
  min_catchment_m2: 300,   // hard exclusion: pour point needs at least this much contributing area
  structure_buffer_m: 30,
  keyline_bonus_max: 12,
  keyline_bonus_radius_m: 150,
  weights: { flow: 0.45, slope: 0.30, soil: 0.25 },
};

// Pond-bed water-retention score by texture (higher = holds water better
// unlined). Deliberately separate from any septic infiltration table —
// see module comment.
const TEXTURE_POND_HOLDING_SCORE = {
  clay: 100, silty_clay: 96, sandy_clay: 92, clay_loam: 84, silty_clay_loam: 88,
  silt: 55, silt_loam: 50, sandy_clay_loam: 62, loam: 40,
  sandy_loam: 22, loamy_sand: 10, sand: 3, organic: 45,
};

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {number} opts.parcel_area_m2
 * @param {object} [opts.soil_data] getSoilData() result
 * @param {object} [opts.keyline] deriveKeylineAndFrost().keyline result
 * @param {object} [opts.surface_water] getSurfaceWaterLayer() result (water_bodies[])
 * @param {Array<{geometry:object}>} [opts.structures] Optional structure footprints
 * @param {string} [opts.dem_confidence]
 * @param {object} [opts.config] Overrides for DEFAULT_CONFIG
 * @param {string} [opts.parcel_id] If supplied, enables per-parcel caching
 */
export function computePondSuitability(opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}), weights: { ...DEFAULT_CONFIG.weights, ...(opts.config?.weights || {}) } };
  const compute = () => computeUncached(opts, cfg);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(opts.parcel_id, [
    'pond', opts.rows, opts.cols, opts.dem_confidence,
    opts.soil_data?.soil_data_source, opts.keyline?.data_source,
    opts.surface_water?._meta?.generated_at, (opts.structures || []).length,
  ], compute);
}

function computeUncached(opts, cfg) {
  const flow = computeFlowAccumulation({ elevations: opts.elevations, rows: opts.rows, cols: opts.cols, bbox: opts.bbox });
  if (!flow.available) {
    return emptyResult(flow.reason || 'No complete DEM grid supplied.');
  }
  const { rows, cols, bbox, accumulation_cells, contributing_area_m2, slope_percent } = flow;

  const maxContributingArea = Math.max(...contributing_area_m2.filter(Number.isFinite), 1);
  const waterBodies = opts.surface_water?.water_bodies || [];
  const structures = opts.structures || [];
  const keylineFeatures = keylineLineFeatures(opts.keyline);
  const soil = soilHolding(opts.soil_data);

  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];

  const cellScores = new Array(rows * cols).fill(null);
  const cellBands = new Array(rows * cols).fill(null);
  const excludedReasons = new Set();
  const candidates = [];

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      const slope = slope_percent[idx];
      if (!Number.isFinite(slope)) continue;
      const [lon, lat] = local(r, c);

      const exclusion = hardExclusion({
        lon, lat, slope, contributingAreaM2: contributing_area_m2[idx],
        waterBodies, structures, cfg,
      });
      if (exclusion) {
        excludedReasons.add(exclusion);
        cellScores[idx] = 0;
        cellBands[idx] = 'poor';
        continue;
      }

      const flowScore = normalizeLog(contributing_area_m2[idx], maxContributingArea);
      const slopeScore = softFalloff(slope, cfg.slope_soft_pct, cfg.slope_hard_pct);
      const w = cfg.weights;
      const base = w.flow * flowScore + w.slope * slopeScore + w.soil * soil.score;

      const keylineDistM = keylineFeatures.length ? distanceToNearestFeatureM(lat, lon, keylineFeatures) : Infinity;
      const keylineBonus = Number.isFinite(keylineDistM) && keylineDistM <= cfg.keyline_bonus_radius_m
        ? cfg.keyline_bonus_max * (1 - keylineDistM / cfg.keyline_bonus_radius_m)
        : 0;

      const score = clamp(base + keylineBonus, 0, 100);
      cellScores[idx] = round1(score);
      cellBands[idx] = scoreBand(score);

      candidates.push({
        r, c, lat, lon, score,
        basis: {
          flow_accumulation: round1(flowScore),
          slope: round1(slopeScore),
          soil_holding: round1(soil.score),
          keyline_bonus: round1(keylineBonus),
        },
      });
    }
  }

  const stride = 1;
  const cellHalfLon = ((bbox.east - bbox.west) / (cols - 1)) / 2;
  const cellHalfLat = ((bbox.north - bbox.south) / (rows - 1)) / 2;
  const picked = topNWellSeparated(candidates, 6, Math.max(3, Math.round(Math.min(rows, cols) / 15)));

  const topCandidateZones = picked.map((cand, i) => ({
    zone_id: `pond-suitability-${i + 1}`,
    geometry: cellPolygon(cand.lat, cand.lon, cellHalfLat, cellHalfLon),
    score: round1(cand.score),
    band: scoreBand(cand.score),
    basis: topBasisLabels(cand.basis),
  }));

  const demConfidence = opts.dem_confidence || 'moderate';
  const confidence = weakestConfidence([demConfidence, soil.confidence, keylineFeatures.length ? 'high' : 'moderate']);

  return {
    suitability_type: 'pond',
    available: true,
    suitability_raster: { rows, cols, stride, bbox, scores: cellScores, bands: cellBands },
    band_summary: bandSummary(cellScores.filter(Number.isFinite)),
    top_candidate_zones: topCandidateZones,
    hard_exclusions_applied: [...excludedReasons],
    data_source: {
      flow_accumulation: 'D8 flow routing over the sampled DEM (flow-accumulation.js) — new, no prior grid to reuse',
      slope: 'Steepest-descent slope from the same D8 pass',
      keyline_proximity: opts.keyline?.data_source || 'not supplied',
      soil_holding: opts.soil_data?.soil_data_source || 'not supplied',
      water_bodies: opts.surface_water?.source_name || opts.surface_water?._meta?.primary_source || 'not supplied',
    },
    confidence,
    weights: cfg.weights,
    thresholds: { slope_soft_pct: cfg.slope_soft_pct, slope_hard_pct: cfg.slope_hard_pct, min_catchment_m2: cfg.min_catchment_m2, structure_buffer_m: cfg.structure_buffer_m },
    assumptions: [
      'Screening layer only — narrows the parcel to candidates. Run modelPondWaterBalance()/rankPondCandidateZones() on any specific site before treating a number as a firm recommendation.',
      'Flow accumulation is single-flow-direction (D8) with no pit-filling pass — a planning-level approximation, not a hydrologically conditioned flow network.',
      'Soil holding capacity is sampled once per parcel from soil_data.soil_units[0] (not truly per-cell) — the same limitation modelPondWaterBalance already carries.',
      soil.note,
    ],
  };
}

function emptyResult(reason) {
  return {
    suitability_type: 'pond',
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

function hardExclusion({ lon, lat, slope, contributingAreaM2, waterBodies, structures, cfg }) {
  if (pointInAnyPolygon(lon, lat, waterBodies)) return 'existing_water';
  if (structures.length && pointNearAnyStructure(lon, lat, structures, cfg.structure_buffer_m)) return 'structure_buffer';
  if (slope >= cfg.slope_hard_pct) return 'steep_slope';
  if (contributingAreaM2 < cfg.min_catchment_m2) return 'insufficient_catchment';
  return null;
}

function pointNearAnyStructure(lon, lat, structures, bufferM) {
  return structures.some((s) => {
    const ring = s?.geometry?.coordinates?.[0];
    if (!Array.isArray(ring)) return false;
    return distanceToNearestFeatureM(lat, lon, [{ geometry: { type: 'LineString', coordinates: ring } }]) <= bufferM;
  });
}

function keylineLineFeatures(keyline) {
  const valleys = keyline?.primary_valleys || [];
  const features = [];
  for (const v of valleys) {
    if (v.keyline) features.push({ geometry: v.keyline });
    for (const g of v.guide_lines || []) if (g.geometry) features.push({ geometry: g.geometry });
  }
  return features;
}

function soilHolding(soilData) {
  const unit = soilData?.soil_units?.[0];
  const texture = unit?.texture_class;
  if (texture && TEXTURE_POND_HOLDING_SCORE[texture] != null) {
    return {
      score: TEXTURE_POND_HOLDING_SCORE[texture],
      confidence: soilData.soil_data_source === 'AGRASID' ? 'high' : 'moderate_low',
      note: `Soil holding capacity from texture:${texture} (higher score = poorer drainage = better unlined-pond retention — the opposite sign from septic-siting soil suitability).`,
    };
  }
  const drainage = unit?.drainage_class;
  const byDrainage = { rapid: 5, well: 22, moderately_well: 40, imperfect: 62, poor: 84, very_poor: 96 };
  if (drainage && byDrainage[drainage] != null) {
    return { score: byDrainage[drainage], confidence: 'moderate_low', note: `Soil holding capacity inferred from drainage_class:${drainage} (no texture data).` };
  }
  return { score: 40, confidence: 'unavailable', note: 'No soil data available — defaulted to a loam-equivalent (moderate) holding score.' };
}

function topBasisLabels(basis) {
  return Object.entries(basis)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
}

export const _internal = { DEFAULT_CONFIG, TEXTURE_POND_HOLDING_SCORE };
