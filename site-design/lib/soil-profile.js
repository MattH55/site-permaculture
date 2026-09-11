/**
 * Soil profile for the report: SoilGrids depth unpacking, TWI drainage
 * refinement, RUSLE-lite erosion screening, and a lab-test override cache.
 *
 * See report-layer-soil-solar-planting-instructions.md Part 2.
 */

import fs from 'node:fs';
import path from 'node:path';
import { computeFlowAccumulation } from './flow-accumulation.js';
import { scoreBand } from './suitability-common.js';

const LAB_CACHE_DIR = path.join(import.meta.dirname, '..', 'data', 'cache', 'soil-tests');

const DEPTH_TOPSOIL = ['0-5cm', '5-15cm', '15-30cm'];
const DEPTH_SUBSOIL = ['30-60cm', '60-100cm', '100-200cm'];

const K_BY_TEXTURE = {
  sand: 0.15,
  loamy_sand: 0.17,
  sandy_loam: 0.25,
  loam: 0.32,
  silt_loam: 0.42,
  silt: 0.48,
  silty_clay_loam: 0.37,
  clay_loam: 0.28,
  sandy_clay: 0.24,
  clay: 0.22,
};

/**
 * Unpack a SoilGrids properties.layers payload into averaged surface values
 * plus a by-depth map. Pure — no fetch.
 */
export function unpackSoilGridsLayers(layers = []) {
  const byDepth = {};
  const avg = {};
  for (const layer of layers) {
    if (!layer?.name) continue;
    const factor = layer.unit_measure?.d_factor || 1;
    const entries = [];
    for (const d of layer.depths || []) {
      const raw = d.values?.mean;
      if (raw == null || !Number.isFinite(raw)) continue;
      const label = normalizeDepthLabel(d.label || d.range || d.depth || '');
      const value = raw / factor;
      if (label) {
        if (!byDepth[label]) byDepth[label] = {};
        byDepth[label][layer.name] = value;
      }
      entries.push(value);
    }
    if (entries.length) avg[layer.name] = entries.reduce((a, b) => a + b, 0) / entries.length;
  }
  return { by_depth: byDepth, averages: avg };
}

export function horizonFromDepths(byDepth, names, key, { fix } = {}) {
  const vals = [];
  const weights = [];
  for (const name of names) {
    const raw = byDepth[name]?.[key];
    if (raw == null || !Number.isFinite(raw)) continue;
    vals.push(fix ? fix(raw) : raw);
    weights.push(depthSpanCm(name));
  }
  if (!vals.length) return null;
  const wsum = weights.reduce((a, b) => a + b, 0) || vals.length;
  return vals.reduce((s, v, i) => s + v * (weights[i] / wsum), 0);
}

export function textureFromFractions(sand, silt, clay) {
  if (sand == null || clay == null) return null;
  if (sand >= 70 && clay < 15) return sand >= 85 ? 'sand' : 'loamy_sand';
  if (sand >= 45 && clay < 20 && (silt ?? 0) < 50) return 'sandy_loam';
  if (clay >= 40) return 'clay';
  if (clay >= 27 && sand <= 45) return 'clay_loam';
  if ((silt ?? 0) >= 50 && clay < 27) return 'silt_loam';
  return 'loam';
}

export function kFactorFromTexture(texture) {
  if (!texture) return 0.3;
  const key = String(texture).toLowerCase().replace(/\s+/g, '_');
  return K_BY_TEXTURE[key] ?? 0.3;
}

/** LS-like slope factor from percent slope (simplified RUSLE slope term). */
export function slopeFactor(slopePct) {
  const s = Math.max(0, Number(slopePct) || 0);
  return Math.min(1.5, 0.065 + 0.045 * s + 0.0065 * s * s);
}

/** Rainfall erosivity proxy: annual precip normalized around 450 mm. */
export function rainfallErosivityProxy(annualPrecipMm) {
  const p = Number(annualPrecipMm);
  if (!Number.isFinite(p) || p <= 0) return 1;
  return Math.max(0.3, Math.min(2.2, p / 450));
}

/**
 * Relative erosion screening score 0–100 (higher = more erosion).
 * Band is inverted so high erosion = poor.
 */
export function rusleLite({ texture, slope_pct, annual_precip_mm }) {
  const k = kFactorFromTexture(texture);
  const ls = slopeFactor(slope_pct);
  const r = rainfallErosivityProxy(annual_precip_mm);
  const raw = k * ls * r * 80;
  const score = Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  const inverted = 100 - score; // suitability-style: high = better (less erosion)
  return {
    erosion_risk_score: score,
    erosion_risk_band: scoreBand(inverted) || 'fair',
    k_factor: round2(k),
    slope_factor: round2(ls),
    rainfall_erosivity_proxy: round2(r),
    note: 'RUSLE-lite screening proxy (K × slope × rainfall). Cover-management and support-practice factors are not included — not a full RUSLE estimate.',
  };
}

/** TWI = ln(a / tan β); a = specific catchment area (m). */
export function topographicWetnessIndex(contributingAreaM2, slopePercent, cellWidthM) {
  const a = Math.max(Number(contributingAreaM2) || 0, 1) / Math.max(Number(cellWidthM) || 1, 1);
  const beta = Math.atan(Math.max(Number(slopePercent) || 0, 0) / 100);
  const tanB = Math.max(Math.tan(beta), 0.001);
  return Math.log(a / tanB);
}

export function twiToDrainageClass(twi) {
  if (twi == null || !Number.isFinite(twi)) return null;
  if (twi >= 12) return 'poor';
  if (twi >= 9) return 'imperfect';
  if (twi >= 6.5) return 'moderately_well';
  if (twi >= 4) return 'well';
  return 'rapid';
}

export function blendDrainage(surveyClass, twiClass) {
  if (!surveyClass && !twiClass) return { class: null, driver: 'none' };
  if (!twiClass) return { class: normalizeDrain(surveyClass), driver: 'survey' };
  if (!surveyClass) return { class: twiClass, driver: 'twi' };
  const survey = normalizeDrain(surveyClass);
  const order = ['rapid', 'well', 'moderately_well', 'imperfect', 'poor', 'very_poor'];
  const si = Math.max(0, order.indexOf(survey));
  const ti = Math.max(0, order.indexOf(twiClass));
  if (Math.abs(si - ti) <= 1) return { class: survey, driver: 'survey' };
  // Split the difference toward the wetter of the two.
  const wetter = si > ti ? survey : twiClass;
  return { class: wetter, driver: si > ti ? 'survey' : 'twi' };
}

export function computeTwiGrid(flow) {
  if (!flow?.available) return { available: false, values: [], mean: null };
  const values = flow.contributing_area_m2.map((a, i) => {
    const s = flow.slope_percent[i];
    if (!Number.isFinite(s) || a == null) return null;
    return round2(topographicWetnessIndex(a, s, flow.cellWidthM));
  });
  const nums = values.filter((v) => v != null);
  const mean = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
  return { available: nums.length > 0, values, mean: mean != null ? round2(mean) : null, rows: flow.rows, cols: flow.cols };
}

export function computeErosionRaster(flow, { texture, annual_precip_mm }) {
  if (!flow?.available) return { available: false, values: [] };
  const k = kFactorFromTexture(texture);
  const r = rainfallErosivityProxy(annual_precip_mm);
  const values = flow.slope_percent.map((s) => {
    if (!Number.isFinite(s)) return null;
    const score = Math.max(0, Math.min(100, k * slopeFactor(s) * r * 80));
    return round1(score);
  });
  return { available: true, values, rows: flow.rows, cols: flow.cols, bbox: flow.bbox };
}

/**
 * Assemble the report-facing soil_profile object.
 */
export function buildSoilProfile(opts = {}) {
  const soilData = opts.soil_data || {};
  const unit = soilData.soil_units?.[0] || {};
  const sg = opts.soilgrids_point || unit.soilgrids || null;
  const byDepth = sg?.by_depth || unpackSoilGridsLayers(sg?.layers || []).by_depth;
  const flow = opts.flow || (opts.elevations
    ? computeFlowAccumulation({ elevations: opts.elevations, rows: opts.rows, cols: opts.cols, bbox: opts.bbox })
    : null);
  const twi = computeTwiGrid(flow);
  const slopePct = Number.isFinite(opts.slope_pct)
    ? opts.slope_pct
    : meanOf(flow?.slope_percent);
  const precip = opts.annual_precip_mm ?? 450;
  const texture = unit.texture_class || textureFromFractions(fixPct(sg?.sand_pct), fixPct(sg?.silt_pct), fixPct(sg?.clay_pct));

  const topPh = horizonFromDepths(byDepth, DEPTH_TOPSOIL, 'phh2o', { fix: fixPh }) ?? unit.ph ?? sg?.ph_h2o ?? null;
  const topSoc = horizonFromDepths(byDepth, DEPTH_TOPSOIL, 'soc', { fix: fixSoc }) ?? unit.organic_carbon_pct ?? (sg?.soc_g_kg != null ? sg.soc_g_kg / 10 : null);
  const topClay = horizonFromDepths(byDepth, DEPTH_TOPSOIL, 'clay', { fix: fixPct });
  const topSand = horizonFromDepths(byDepth, DEPTH_TOPSOIL, 'sand', { fix: fixPct });
  const topSilt = horizonFromDepths(byDepth, DEPTH_TOPSOIL, 'silt', { fix: fixPct });
  const topTexture = textureFromFractions(topSand, topSilt, topClay) || texture;

  const subBd = horizonFromDepths(byDepth, DEPTH_SUBSOIL, 'bdod', { fix: (v) => (v > 4 ? v / 100 : v) });
  const subClay = horizonFromDepths(byDepth, DEPTH_SUBSOIL, 'clay', { fix: fixPct });
  const subSand = horizonFromDepths(byDepth, DEPTH_SUBSOIL, 'sand', { fix: fixPct });
  const subSilt = horizonFromDepths(byDepth, DEPTH_SUBSOIL, 'silt', { fix: fixPct });
  const subTexture = textureFromFractions(subSand, subSilt, subClay);

  const surveyDrain = unit.drainage_class || null;
  const twiDrain = twiToDrainageClass(twi.mean);
  const blended = blendDrainage(surveyDrain, twiDrain);
  const erosion = rusleLite({ texture: topTexture, slope_pct: slopePct, annual_precip_mm: precip });
  const erosionRaster = computeErosionRaster(flow, { texture: topTexture, annual_precip_mm: precip });

  const lab = opts.lab_test_override || readLabOverride(opts.parcel_id);
  const profile = {
    topsoil_0_30cm: {
      texture: lab?.texture || topTexture || null,
      organic_carbon_pct: lab?.organic_matter_pct ?? (topSoc != null ? round2(topSoc) : null),
      ph: lab?.ph ?? (topPh != null ? round2(topPh) : null),
    },
    subsoil_30cm_plus: {
      texture: subTexture || null,
      bulk_density: subBd != null ? round2(subBd) : null,
    },
    drainage_class_survey: surveyDrain,
    twi_adjusted_drainage: blended.class,
    twi_mean: twi.mean,
    twi_drainage_class: twiDrain,
    drainage_driver: blended.driver,
    erosion_risk_score: erosion.erosion_risk_score,
    erosion_risk_band: erosion.erosion_risk_band,
    erosion_components: {
      k_factor: erosion.k_factor,
      slope_factor: erosion.slope_factor,
      rainfall_erosivity_proxy: erosion.rainfall_erosivity_proxy,
    },
    erosion_raster: erosionRaster.available ? erosionRaster : null,
    lab_test_override: lab || null,
    data_source: {
      topsoil: lab ? 'lab_test_override' : (Object.keys(byDepth).length ? 'SoilGrids depth profile' : (soilData.soil_data_source || 'unavailable')),
      subsoil: Object.keys(byDepth).some((k) => DEPTH_SUBSOIL.includes(k)) ? 'SoilGrids depth profile' : 'not unpacked (surface-only sample)',
      twi: twi.available ? 'computed' : 'unavailable',
      survey: soilData.soil_data_source || 'unavailable',
    },
    confidence: lab ? 'high' : (soilData.confidence || 'moderate'),
    note: erosion.note,
  };
  return profile;
}

export function writeLabOverride(parcelId, test) {
  if (!parcelId || !test) return null;
  try {
    if (!fs.existsSync(LAB_CACHE_DIR)) fs.mkdirSync(LAB_CACHE_DIR, { recursive: true });
    const rec = {
      texture: test.texture || null,
      ph: test.ph != null ? Number(test.ph) : null,
      organic_matter_pct: test.organic_matter_pct != null ? Number(test.organic_matter_pct) : null,
      nutrients: test.nutrients || null,
      submitted_at: new Date().toISOString(),
      parcel_id: parcelId,
    };
    fs.writeFileSync(path.join(LAB_CACHE_DIR, `${safeKey(parcelId)}.json`), JSON.stringify(rec));
    return rec;
  } catch {
    return null;
  }
}

export function readLabOverride(parcelId) {
  if (!parcelId) return null;
  try {
    const p = path.join(LAB_CACHE_DIR, `${safeKey(parcelId)}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeDepthLabel(s) {
  const m = String(s).toLowerCase().replace(/\s+/g, '').match(/(\d+)-(\d+)cm/);
  return m ? `${m[1]}-${m[2]}cm` : String(s).toLowerCase().replace(/\s+/g, '');
}
function depthSpanCm(label) {
  const m = String(label).match(/(\d+)-(\d+)/);
  if (!m) return 10;
  return Math.max(1, Number(m[2]) - Number(m[1]));
}
function normalizeDrain(s) {
  if (!s) return null;
  const t = String(s).toLowerCase().replace(/\s+/g, '_');
  if (/very.?poor/.test(t)) return 'very_poor';
  if (/poor/.test(t)) return 'poor';
  if (/imperfect/.test(t)) return 'imperfect';
  if (/moderat/.test(t)) return 'moderately_well';
  if (/rapid|excessive/.test(t)) return 'rapid';
  if (/well/.test(t)) return 'well';
  return t;
}
function fixPct(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return v > 100 ? v / 10 : v;
}
function fixPh(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return v > 14 ? v / 10 : v;
}
function fixSoc(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const gkg = v > 200 ? v / 10 : v;
  return gkg / 10; // g/kg → %
}
function meanOf(arr) {
  if (!Array.isArray(arr)) return null;
  const nums = arr.filter((v) => Number.isFinite(v));
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function safeKey(id) { return String(id).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80); }
