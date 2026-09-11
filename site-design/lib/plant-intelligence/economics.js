/**
 * Alberta economics overlay: establishment cost, utility, market return.
 * These three stay separate. Ranking modes combine them without erasing them.
 */

import { bestOffer } from './products.js';
import { canonicalName } from './taxonomy.js';

const DISCOUNT = 0.05;
const DEFAULT_HORIZON = 10;

const ESTABLISH_DEFAULTS = {
  tree: { plant: 45, labor: 35, excavation: 25, amendment: 18, staking: 12, guard: 8, mulch: 10, maint: 25 },
  shrub: { plant: 12, labor: 12, excavation: 8, amendment: 8, staking: 0, guard: 4, mulch: 6, maint: 12 },
  herb: { plant: 7, labor: 4, excavation: 2, amendment: 3, staking: 0, guard: 0, mulch: 2, maint: 4 },
  other: { plant: 15, labor: 10, excavation: 8, amendment: 6, staking: 0, guard: 4, mulch: 5, maint: 8 },
};

/** Alberta ag planning yields/prices (CAD) — ranges, not forecasts. */
const AG_PROFILES = {
  'malus-domestica': { yield_kg: { low: 15, high: 45 }, price_kg: { low: 1.5, high: 3 }, start_year: 5, life: 25, labor: 'medium' },
  'amelanchier-alnifolia': { yield_kg: { low: 2, high: 8 }, price_kg: { low: 4, high: 8 }, start_year: 3, life: 20, labor: 'medium' },
  'prunus-virginiana': { yield_kg: { low: 2, high: 6 }, price_kg: { low: 3, high: 7 }, start_year: 3, life: 20, labor: 'medium' },
  'prunus-pensylvanica': { yield_kg: { low: 1.5, high: 5 }, price_kg: { low: 3, high: 6 }, start_year: 3, life: 18, labor: 'medium' },
  'prunus-cerasus': { yield_kg: { low: 8, high: 25 }, price_kg: { low: 2.5, high: 5 }, start_year: 4, life: 20, labor: 'medium' },
};

export function formClass(plant) {
  const g = `${plant.morphology?.growth_form || ''} ${plant.taxon?.common_names?.[0] || ''}`.toLowerCase();
  if (/spruce|pine|fir|tree|canopy|maple|elm|birch|poplar|larch/.test(g)) return 'tree';
  if (/shrub|berry|saskatoon|cherry|buffaloberry|caragana|lilac/.test(g)) return 'shrub';
  if (/herb|perennial|yarrow|grass|forb/.test(g)) return 'herb';
  return 'other';
}

export function utilityValue(plant) {
  const form = formClass(plant);
  const name = `${plant.taxon?.scientific_name || ''} ${plant.taxon?.common_names?.[0] || ''}`.toLowerCase();
  const native = (plant.ecology?.native_regions || []).length > 0;
  const u = {
    shade: form === 'tree' ? 0.75 : 0.15,
    privacy: form === 'tree' ? 0.55 : form === 'shrub' ? 0.65 : 0.1,
    windbreak: /spruce|pine|caragana|poplar/.test(name) ? 0.9 : form === 'tree' ? 0.55 : 0.2,
    erosion_control: form === 'herb' || /buffaloberry|willow/.test(name) ? 0.7 : 0.3,
    pollinator: /yarrow|cherry|saskatoon|amelanchier|willow/.test(name) ? 0.8 : 0.35,
    wildlife: native || /saskatoon|chokecherry|buffaloberry/.test(name) ? 0.85 : 0.35,
    aesthetic: 0.5,
    food: /malus|prunus|amelanchier|berry|apple/.test(name) ? 0.85 : 0.1,
    soil_improvement: /caragana|shepherdia|alnus/.test(name) ? 0.7 : 0.2,
  };
  if (/picea|spruce/.test(name)) {
    u.privacy = 0.92;
    u.windbreak = 0.95;
    u.food = 0.05;
  }
  return u;
}

export function establishmentCost(plant, site = {}, offer = null) {
  const form = formClass(plant);
  const d = ESTABLISH_DEFAULTS[form] || ESTABLISH_DEFAULTS.other;
  const quote = offer || bestOffer(plant.taxon?.scientific_name, site);
  const plantMaterial = quote?.price_cad ?? d.plant;
  const delivery = quote?.delivery_cad ?? 0;
  const lines = {
    plant_material_cost: plantMaterial,
    delivery_cost: delivery,
    excavation_cost: d.excavation,
    soil_amendment_cost: d.amendment,
    compost_cost: Math.round(d.amendment * 0.4),
    mulch_cost: d.mulch,
    planting_labor_cost: d.labor,
    staking_cost: d.staking,
    guard_cost: d.guard,
    irrigation_cost: site.irrigation_available ? 40 : 8,
  };
  const total = Object.values(lines).reduce((s, n) => s + (Number(n) || 0), 0);
  return {
    ...lines,
    total_initial_cost: round0(total),
    first_year_maintenance_cost: d.maint,
    currency: 'CAD',
    scenario: 'estimate',
    offer,
    assumption: 'Alberta residential landscape install, pickup vs published delivery. Not a contractor quote.',
  };
}

export function marketProfile(plant, site = {}, establish) {
  const id = plant.taxon?.id;
  const ag = AG_PROFILES[id];
  if (!ag) {
    return {
      kind: 'landscape',
      yield: null,
      revenue_annual: null,
      npv: null,
      payback_year: null,
      note: 'No agricultural revenue profile — landscape utility only.',
    };
  }
  const area = site.area_m2 || 25;
  const plants = Math.max(1, Math.floor(area / 12));
  const yMid = ((ag.yield_kg.low + ag.yield_kg.high) / 2) * plants;
  const pMid = (ag.price_kg.low + ag.price_kg.high) / 2;
  const revLow = ag.yield_kg.low * plants * ag.price_kg.low;
  const revHigh = ag.yield_kg.high * plants * ag.price_kg.high;
  const revMid = yMid * pMid;
  const opex = revMid * 0.45;
  const init = establish?.total_initial_cost || 0;
  const horizon = DEFAULT_HORIZON;
  let npv = -init;
  let payback = null;
  let cum = -init;
  for (let y = 1; y <= horizon; y++) {
    const factor = y < ag.start_year ? 0 : Math.min(1, (y - ag.start_year + 1) / 3);
    const net = (revMid * factor) - opex * (0.4 + 0.6 * factor);
    npv += net / (1 + DISCOUNT) ** y;
    cum += net;
    if (payback == null && cum >= 0) payback = y;
  }
  return {
    kind: 'productive',
    production_system: 'small-patch polyculture / u-pick planning',
    region: 'Alberta',
    yield: { low_kg: round1(ag.yield_kg.low * plants), high_kg: round1(ag.yield_kg.high * plants), mid_kg: round1(yMid), unit: 'kg/year at maturity', plants },
    revenue_annual: { low: round0(revLow), mid: round0(revMid), high: round0(revHigh), currency: 'CAD', label: 'farm-gate / wholesale planning range' },
    annual_operating_cost: round0(opex),
    npv: { mid: round0(npv), horizon_years: horizon, discount_rate: DISCOUNT, label: 'scenario estimate — not a forecast' },
    payback_year: payback,
    first_harvest_year: ag.start_year,
    productive_lifespan_years: ag.life,
    source: 'Alberta / prairie planning ranges (Cropping Alternatives–style), not AgriProfit$ farm books',
  };
}

export function geometryPreview(plant) {
  const form = formClass(plant);
  const h = plant.morphology?.mature_height_max_m || (form === 'tree' ? 12 : form === 'shrub' ? 3 : 0.6);
  const w = plant.morphology?.mature_width_max_m || h * 0.6;
  return {
    current: { height_m: round2(h * 0.08), width_m: round2(w * 0.08) },
    year_5: { height_m: round2(h * 0.35), width_m: round2(w * 0.35) },
    year_10: { height_m: round2(h * 0.65), width_m: round2(w * 0.65) },
    mature: { height_m: round2(h), width_m: round2(w), root_zone_m: round2(w * 0.8) },
  };
}

export function plantingDensity(plant, areaM2) {
  const w = geometryPreview(plant).mature.width_m || 2;
  const spacing = Math.max(0.4, w * 0.9);
  const n = Math.max(1, Math.floor((areaM2 || 25) / (spacing * spacing)));
  return { spacing_m: round2(spacing), count: n, area_m2: areaM2 || 25 };
}

export function enrichRecommendation(plant, bio, site = {}) {
  const offer = bestOffer(plant.taxon?.scientific_name, site);
  const commercial = establishmentCost(plant, site, offer);
  const utility = utilityValue(plant);
  const economic = marketProfile(plant, site, commercial);
  const density = plantingDensity(plant, site.area_m2);
  const utilSum = Object.values(utility).reduce((s, v) => s + v, 0);
  const utilityPerDollar = commercial.total_initial_cost > 0 ? utilSum / commercial.total_initial_cost : 0;
  return {
    plant: {
      taxon_id: plant.taxon?.id,
      scientific_name: plant.taxon?.scientific_name,
      common_name: plant.taxon?.common_names?.[0] || null,
      cultivar: offer?.cultivar || null,
    },
    location: { lat: site.latitude, lon: site.longitude, area_m2: site.area_m2 || null },
    biological: {
      suitability: bio.suitability,
      climate: bio.scores?.climate,
      solar: bio.scores?.solar,
      soil: bio.scores?.soil,
      water: bio.scores?.water,
      space: bio.scores?.space,
      ecological: bio.scores?.ecological,
    },
    commercial: {
      plant_price_cad: commercial.plant_material_cost,
      delivery_cad: commercial.delivery_cost,
      establishment_cost_cad: commercial.total_initial_cost,
      maintenance_cost_annual_cad: commercial.first_year_maintenance_cost,
      freshness: offer?.freshness || 'no_observation',
      vendor_name: offer?.vendor_name || null,
      price_class: offer?.price_class || null,
      size: offer?.size || null,
    },
    economic: {
      yield: economic.yield,
      revenue_annual: economic.revenue_annual,
      npv: economic.npv,
      payback_year: economic.payback_year,
      kind: economic.kind,
      first_harvest_year: economic.first_harvest_year || null,
      note: economic.note || economic.source,
    },
    utility,
    utility_per_dollar: utilityPerDollar,
    geometry: geometryPreview(plant),
    density,
    confidence: bio.confidence,
    reasons: bio.reasons,
    constraints: bio.constraints,
    sources: bio.sources,
  };
}

export function rankRecommendations(rows, mode = 'overall') {
  const copy = [...rows];
  const key = {
    biological: (a, b) => b.biological.suitability - a.biological.suitability,
    cost: (a, b) => a.commercial.establishment_cost_cad - b.commercial.establishment_cost_cad,
    return: (a, b) => (b.economic.npv?.mid ?? -1e9) - (a.economic.npv?.mid ?? -1e9),
    utility_per_dollar: (a, b) => b.utility_per_dollar - a.utility_per_dollar,
    food: (a, b) => (b.utility.food || 0) - (a.utility.food || 0) || (b.economic.revenue_annual?.mid || 0) - (a.economic.revenue_annual?.mid || 0),
    overall: (a, b) => overallScore(b) - overallScore(a),
  }[mode] || ((a, b) => overallScore(b) - overallScore(a));
  copy.sort(key);
  return copy;
}

function overallScore(r) {
  const bio = r.biological.suitability || 0;
  const cost = 1 / (1 + (r.commercial.establishment_cost_cad || 0) / 400);
  const util = Object.values(r.utility || {}).reduce((s, v) => s + v, 0) / 9;
  const npv = r.economic.npv?.mid != null ? Math.min(1, Math.max(0, (r.economic.npv.mid + 500) / 4000)) : util;
  return 0.45 * bio + 0.2 * cost + 0.2 * npv + 0.15 * util;
}

function round0(n) { return Math.round(n); }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
export { canonicalName };
