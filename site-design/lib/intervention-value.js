/**
 * Land Intelligence — Intervention Value Estimation Engine
 *
 * Takes baseline fecundity scores + site context, applies selected interventions,
 * calculates before/after score deltas, translates to physical outcomes, and
 * produces a planning-level value estimate (CAD) over a configurable time horizon.
 *
 * Designed for "remote-only" mode — all inputs are inferred from public data.
 * Site-walk measurements override inferences and raise confidence.
 */

import { assessFecundity, CATEGORY_WEIGHTS } from './fecundity-assessment.js';
import { INTERVENTIONS, COEFFICIENT_VERSION, recommendInterventions } from './intervention-effects.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = {
  timeHorizonYears: 10,
  discountRate: 0.05,          // 5% real discount rate
  scenario: 'mid',             // 'low' | 'mid' | 'high'
};

// Alberta planning-level commodity / service values (CAD, 2026 dollars)
// These are configurable — stored externally in production.
const VALUE_COEFFICIENTS = {
  // Water value: cost of irrigation water avoided ($/m³)
  waterPerM3: { low: 0.15, mid: 0.35, high: 0.60 },

  // Forage / hay value ($/kg dry matter)
  foragePerKg: { low: 0.08, mid: 0.15, high: 0.25 },

  // Crop yield uplift from microclimate improvement ($/ha/yr)
  microclimateYieldPerHa: { low: 50, mid: 120, high: 250 },

  // Soil erosion cost avoided ($/tonne of soil loss prevented)
  erosionCostPerTonne: { low: 5, mid: 12, high: 25 },

  // Carbon credit proxy ($/tonne CO₂e) — conservative planning value
  carbonPerTonne: { low: 15, mid: 30, high: 60 },

  // Pollination ecosystem service value ($/ha/yr)
  pollinationPerHa: { low: 100, mid: 250, high: 500 },

  // Property value uplift from regenerative improvements (% of base, annual)
  propertyUpliftPct: { low: 0.5, mid: 1.0, high: 2.0 },
};

// ---------------------------------------------------------------------------
// What-if engine: apply interventions to baseline
// ---------------------------------------------------------------------------

/**
 * Apply one or more interventions to a baseline set of category scores.
 * Returns before/after scores with per-lever deltas.
 *
 * @param {Record<string, number|null>} baselineScores — from assessFecundity().categoryScores
 * @param {string[]} interventionIds — e.g. ['swale', 'foodforest']
 * @param {'low'|'mid'|'high'} scenario
 * @returns {{ before: Record<string,number|null>, after: Record<string,number>, deltas: Record<string,number>, interventions: object[] }}
 */
export function applyInterventions(baselineScores, interventionIds, scenario = 'mid') {
  const after = { ...baselineScores };
  const deltas = {};
  const applied = [];

  for (const id of interventionIds) {
    const def = INTERVENTIONS[id];
    if (!def) continue;

    const interventionResult = { id: def.id, label: def.label, leverEffects: [] };

    for (const eff of def.affects) {
      const baseline = after[eff.lever];
      if (baseline == null) continue; // skip levers with no baseline data

      const delta = scenarioDelta(eff, scenario);
      const headroom = Math.max(0, 100 - baseline);
      const effectiveDelta = Math.min(delta, headroom);

      if (effectiveDelta > 0) {
        after[eff.lever] = Math.min(100, baseline + effectiveDelta);
        deltas[eff.lever] = (deltas[eff.lever] || 0) + effectiveDelta;
        interventionResult.leverEffects.push({
          lever: eff.lever,
          delta: effectiveDelta,
          before: baseline,
          after: after[eff.lever],
          confidence: eff.confidence,
        });
      }
    }

    applied.push(interventionResult);
  }

  return { before: baselineScores, after, deltas, interventions: applied };
}

function scenarioDelta(eff, scenario) {
  if (scenario === 'low') return eff.deltaMin;
  if (scenario === 'high') return eff.deltaMax;
  // mid = average of min and max
  return Math.round((eff.deltaMin + eff.deltaMax) / 2);
}

/**
 * Recalculate overall fecundity score from category scores, using the
 * same weighted-average formula as assessFecundity.
 */
export function overallFromCategories(categoryScores) {
  let weightedSum = 0;
  let weightUsed = 0;
  for (const [key, score] of Object.entries(categoryScores)) {
    if (score != null && CATEGORY_WEIGHTS[key]) {
      weightedSum += score * CATEGORY_WEIGHTS[key];
      weightUsed += CATEGORY_WEIGHTS[key];
    }
  }
  return weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;
}

// ---------------------------------------------------------------------------
// Physical outcome translation
// ---------------------------------------------------------------------------

/**
 * Translate score deltas + site context → estimated physical outcomes.
 *
 * @param {Record<string,number>} deltas — per-lever score deltas
 * @param {string[]} interventionIds
 * @param {object} siteContext — { footprintHa, slopePercent, annualPrecipMm, soilTexture, ... }
 * @param {'low'|'mid'|'high'} scenario
 * @returns {object} physical outcomes
 */
export function estimatePhysicalOutcomes(deltas, interventionIds, siteContext = {}, scenario = 'mid') {
  const ha = siteContext.footprintHa || 1;
  const slope = siteContext.slopePercent ?? 5;
  const precip = siteContext.annualPrecipMm ?? 400;

  const outcomes = {
    water: {},
    soil: {},
    vegetation: {},
    microclimate: {},
    fauna: {},
    carbon: {},
  };

  // Aggregate physical proxies from selected interventions
  for (const id of interventionIds) {
    const def = INTERVENTIONS[id];
    if (!def) continue;
    const p = def.physical;

    // Water outcomes
    if (p.runoffReductionPct) {
      const val = scenarioRange(p.runoffReductionPct, scenario);
      outcomes.water.runoffReductionPct = Math.max(outcomes.water.runoffReductionPct || 0, val);
    }
    if (p.infiltrationVolume_m3_ha) {
      const val = scenarioRange(p.infiltrationVolume_m3_ha, scenario);
      outcomes.water.infiltrationGain_m3_yr = (outcomes.water.infiltrationGain_m3_yr || 0) + val * ha;
    }
    if (p.waterStorage_m3) {
      const val = scenarioRange(p.waterStorage_m3, scenario);
      outcomes.water.storageCapacity_m3 = (outcomes.water.storageCapacity_m3 || 0) + val;
    }

    // Soil outcomes
    if (p.soilLossReduction_t_ha_yr) {
      const val = scenarioRange(p.soilLossReduction_t_ha_yr, scenario);
      outcomes.soil.erosionReduction_t_yr = (outcomes.soil.erosionReduction_t_yr || 0) + val * ha;
    }
    if (p.organicMatterIncreasePct) {
      const val = scenarioRange(p.organicMatterIncreasePct, scenario);
      outcomes.soil.organicMatterGain_pct = Math.max(outcomes.soil.organicMatterGain_pct || 0, val);
    }

    // Vegetation outcomes
    if (p.canopyCoverGainPct) {
      const val = scenarioRange(p.canopyCoverGainPct, scenario);
      outcomes.vegetation.canopyCoverGain_pct = Math.max(outcomes.vegetation.canopyCoverGain_pct || 0, val);
    }
    if (p.productiveLayersAdded) {
      const val = scenarioRange(p.productiveLayersAdded, scenario);
      outcomes.vegetation.layersAdded = Math.max(outcomes.vegetation.layersAdded || 0, val);
    }
    if (p.forageBiomass_kg_ha_yr) {
      const val = scenarioRange(p.forageBiomass_kg_ha_yr, scenario);
      outcomes.vegetation.forageBiomass_kg_yr = (outcomes.vegetation.forageBiomass_kg_yr || 0) + val * ha;
    }

    // Microclimate outcomes
    if (p.windReductionPct) {
      const val = scenarioRange(p.windReductionPct, scenario);
      outcomes.microclimate.windReduction_pct = Math.max(outcomes.microclimate.windReduction_pct || 0, val);
    }
    if (p.etReductionPct) {
      const val = scenarioRange(p.etReductionPct, scenario);
      outcomes.microclimate.etReduction_pct = Math.max(outcomes.microclimate.etReduction_pct || 0, val);
    }
    if (p.frostBufferRadius_m) {
      const val = scenarioRange(p.frostBufferRadius_m, scenario);
      outcomes.microclimate.frostBuffer_m = Math.max(outcomes.microclimate.frostBuffer_m || 0, val);
    }
    if (p.humidityBoostPct) {
      const val = scenarioRange(p.humidityBoostPct, scenario);
      outcomes.microclimate.humidityBoost_pct = Math.max(outcomes.microclimate.humidityBoost_pct || 0, val);
    }

    // Fauna outcomes
    if (p.pollinatorHabitatGain_m2) {
      const val = scenarioRange(p.pollinatorHabitatGain_m2, scenario);
      outcomes.fauna.pollinatorHabitat_m2 = (outcomes.fauna.pollinatorHabitat_m2 || 0) + val;
    }
    if (p.nestingHabitatGain_m2) {
      const val = scenarioRange(p.nestingHabitatGain_m2, scenario);
      outcomes.fauna.nestingHabitat_m2 = (outcomes.fauna.nestingHabitat_m2 || 0) + val;
    }

    // Carbon
    if (p.carbonSequestration_t_ha_yr) {
      const val = scenarioRange(p.carbonSequestration_t_ha_yr, scenario);
      outcomes.carbon.sequestration_t_yr = (outcomes.carbon.sequestration_t_yr || 0) + val * ha;
    }
  }

  // Round all values
  for (const section of Object.values(outcomes)) {
    for (const [k, v] of Object.entries(section)) {
      if (typeof v === 'number') section[k] = Math.round(v * 100) / 100;
    }
  }

  return outcomes;
}

function scenarioRange(range, scenario) {
  if (scenario === 'low') return range.min;
  if (scenario === 'high') return range.max;
  return (range.min + range.max) / 2;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the cost of implementing selected interventions.
 *
 * @param {string[]} interventionIds
 * @param {object} siteContext — { footprintHa, slopePercent, soilTexture, ... }
 * @param {'low'|'mid'|'high'} scenario
 * @returns {{ total: number, breakdown: object[] }}
 */
export function estimateInterventionCosts(interventionIds, siteContext = {}, scenario = 'mid') {
  const ha = siteContext.footprintHa || 1;
  const breakdown = [];
  let total = 0;

  for (const id of interventionIds) {
    const def = INTERVENTIONS[id];
    if (!def) continue;
    const c = def.cost;
    let cost = 0;
    let basis = '';

    switch (id) {
      case 'swale': {
        const lengthM = scenarioRange(c.typicalLength_m, scenario);
        const perM = scenarioRange(c.earthworksPerM, scenario);
        const survey = scenarioRange(c.surveyPerHa, scenario) * ha;
        cost = lengthM * perM + survey;
        basis = `${lengthM}m swale × $${perM}/m + survey`;
        break;
      }
      case 'pond': {
        const vol = scenarioRange(c.typicalVolume_m3, scenario);
        const perM3 = scenarioRange(c.excavationPerM3, scenario);
        cost = vol * perM3;
        basis = `${vol}m³ excavation × $${perM3}/m³`;
        break;
      }
      case 'foodforest': {
        const trees = scenarioRange(c.treesPerHa, scenario) * ha;
        const perTree = scenarioRange(c.costPerTree, scenario);
        const prep = scenarioRange(c.sitePrepPerHa, scenario) * ha;
        cost = trees * perTree + prep;
        basis = `${Math.round(trees)} trees × $${perTree} + site prep`;
        break;
      }
      case 'shelterbelt': {
        // Assume shelterbelt runs along property perimeter
        const perKm = scenarioRange(c.treesPerRow, scenario) * scenarioRange(c.rows, scenario);
        const perTree = scenarioRange(c.costPerTree, scenario);
        // Rough perimeter estimate: sqrt(ha * 10000) * 4 for square parcel
        const perimeterKm = Math.sqrt(ha * 10000) * 4 / 1000;
        const trees = Math.round(perKm * perimeterKm);
        cost = trees * perTree;
        basis = `~${Math.round(perimeterKm * 1000)}m perimeter, ${trees} trees × $${perTree}`;
        break;
      }
    }

    cost = Math.round(cost);
    total += cost;
    breakdown.push({ id, label: def.label, cost, basis });
  }

  return { total, breakdown };
}

// ---------------------------------------------------------------------------
// Value estimation: physical outcomes → $/yr
// ---------------------------------------------------------------------------

/**
 * Estimate annual value ($CAD) from physical outcomes.
 *
 * @param {object} outcomes — from estimatePhysicalOutcomes()
 * @param {object} siteContext
 * @param {'low'|'mid'|'high'} scenario
 * @returns {{ totalAnnual: number, components: object[] }}
 */
export function estimateAnnualValue(outcomes, siteContext = {}, scenario = 'mid') {
  const vc = VALUE_COEFFICIENTS;
  const components = [];
  let total = 0;

  // Water value (infiltration + storage → irrigation cost avoided)
  const waterM3 = (outcomes.water.infiltrationGain_m3_yr || 0) +
                  (outcomes.water.storageCapacity_m3 || 0) * 0.7; // 70% effective refill
  if (waterM3 > 0) {
    const val = Math.round(waterM3 * scenarioRange(vc.waterPerM3, scenario));
    components.push({
      label: 'Water retention value',
      value: val,
      basis: `${Math.round(waterM3)} m³/yr × $${scenarioRange(vc.waterPerM3, scenario)}/m³`,
    });
    total += val;
  }

  // Forage / biomass value
  const forage = outcomes.vegetation.forageBiomass_kg_yr || 0;
  if (forage > 0) {
    const val = Math.round(forage * scenarioRange(vc.foragePerKg, scenario));
    components.push({
      label: 'Forage / biomass production',
      value: val,
      basis: `${Math.round(forage)} kg/yr × $${scenarioRange(vc.foragePerKg, scenario)}/kg`,
    });
    total += val;
  }

  // Microclimate yield uplift
  if (outcomes.microclimate.windReduction_pct || outcomes.microclimate.etReduction_pct) {
    const ha = siteContext.footprintHa || 1;
    const val = Math.round(ha * scenarioRange(vc.microclimateYieldPerHa, scenario));
    components.push({
      label: 'Microclimate yield uplift',
      value: val,
      basis: `${ha} ha × $${scenarioRange(vc.microclimateYieldPerHa, scenario)}/ha/yr`,
    });
    total += val;
  }

  // Erosion cost avoided
  const erosion = outcomes.soil.erosionReduction_t_yr || 0;
  if (erosion > 0) {
    const val = Math.round(erosion * scenarioRange(vc.erosionCostPerTonne, scenario));
    components.push({
      label: 'Soil erosion cost avoided',
      value: val,
      basis: `${Math.round(erosion)} tonnes/yr × $${scenarioRange(vc.erosionCostPerTonne, scenario)}/t`,
    });
    total += val;
  }

  // Carbon sequestration
  const carbon = outcomes.carbon.sequestration_t_yr || 0;
  if (carbon > 0) {
    const val = Math.round(carbon * scenarioRange(vc.carbonPerTonne, scenario));
    components.push({
      label: 'Carbon sequestration (proxy)',
      value: val,
      basis: `${Math.round(carbon * 10) / 10} tCO₂e/yr × $${scenarioRange(vc.carbonPerTonne, scenario)}/t`,
    });
    total += val;
  }

  // Pollination ecosystem service
  const pollHa = (outcomes.fauna.pollinatorHabitat_m2 || 0) / 10000;
  if (pollHa > 0.05) {
    const val = Math.round(pollHa * scenarioRange(vc.pollinationPerHa, scenario));
    components.push({
      label: 'Pollination ecosystem service',
      value: val,
      basis: `${Math.round(pollHa * 100) / 100} ha habitat × $${scenarioRange(vc.pollinationPerHa, scenario)}/ha/yr`,
    });
    total += val;
  }

  return { totalAnnual: total, components };
}

// ---------------------------------------------------------------------------
// NPV / ROI / payback
// ---------------------------------------------------------------------------

/**
 * Calculate NPV, ROI, and payback period for a set of interventions.
 *
 * @param {number} totalCost — upfront cost (CAD)
 * @param {number} annualValue — annual benefit (CAD/yr)
 * @param {object} opts — { timeHorizonYears, discountRate }
 * @returns {{ npv: number, roi: number, paybackYears: number|null, cumulativeCashflow: number[] }}
 */
export function calculateROI(totalCost, annualValue, opts = {}) {
  const years = opts.timeHorizonYears || DEFAULTS.timeHorizonYears;
  const rate = opts.discountRate ?? DEFAULTS.discountRate;

  let npv = -totalCost;
  const cumulative = [-totalCost];
  let paybackYears = null;

  for (let y = 1; y <= years; y++) {
    const discounted = annualValue / Math.pow(1 + rate, y);
    npv += discounted;
    const prev = cumulative[y - 1] || -totalCost;
    cumulative.push(Math.round(prev + annualValue));
    if (paybackYears === null && cumulative[y] >= 0) {
      // Linear interpolation for partial year
      const prevCum = cumulative[y - 1];
      const fraction = Math.abs(prevCum) / annualValue;
      paybackYears = Math.round((y - 1 + fraction) * 10) / 10;
    }
  }

  const roi = totalCost > 0 ? Math.round(((npv / totalCost) * 100)) : null;

  return {
    npv: Math.round(npv),
    roi,
    paybackYears,
    cumulativeCashflow: cumulative,
  };
}

// ---------------------------------------------------------------------------
// Main entry point: full intervention value report
// ---------------------------------------------------------------------------

/**
 * Generate a complete intervention value estimation for a site.
 *
 * @param {object} params
 * @param {object} params.baselineScores — { water: 45, soilStructure: 60, ... } from assessFecundity
 * @param {string[]} [params.interventionIds] — if omitted, auto-recommends top interventions
 * @param {object} [params.siteContext] — { footprintHa, slopePercent, annualPrecipMm, soilTexture }
 * @param {'low'|'mid'|'high'} [params.scenario]
 * @param {number} [params.timeHorizonYears]
 * @returns {object}
 */
export function generateInterventionValueReport(params = {}) {
  const {
    baselineScores,
    interventionIds: requestedIds,
    siteContext = {},
    scenario = DEFAULTS.scenario,
    timeHorizonYears = DEFAULTS.timeHorizonYears,
  } = params;

  // If no interventions specified, recommend based on weakest categories
  const interventionIds = requestedIds || recommendInterventions(baselineScores).slice(0, 3).map((r) => r.id);

  // Step 1: Apply interventions to baseline
  const scoreResult = applyInterventions(baselineScores, interventionIds, scenario);

  // Step 2: Recalculate overall scores
  const beforeOverall = overallFromCategories(scoreResult.before);
  const afterOverall = overallFromCategories(scoreResult.after);
  const overallDelta = (afterOverall != null && beforeOverall != null) ? afterOverall - beforeOverall : null;

  // Step 3: Physical outcomes
  const physical = estimatePhysicalOutcomes(scoreResult.deltas, interventionIds, siteContext, scenario);

  // Step 4: Cost estimate
  const costs = estimateInterventionCosts(interventionIds, siteContext, scenario);

  // Step 5: Annual value
  const value = estimateAnnualValue(physical, siteContext, scenario);

  // Step 6: ROI
  const roi = calculateROI(costs.total, value.totalAnnual, { timeHorizonYears, discountRate: DEFAULTS.discountRate });

  return {
    coefficientVersion: COEFFICIENT_VERSION,
    scenario,
    timeHorizonYears,
    interventions: interventionIds,
    scoreComparison: {
      before: { categories: scoreResult.before, overall: beforeOverall },
      after:  { categories: scoreResult.after,  overall: afterOverall },
      deltas: { ...scoreResult.deltas, overall: overallDelta },
    },
    physicalOutcomes: physical,
    costEstimate: costs,
    annualValue: value,
    financialSummary: {
      upfrontCost_cad: costs.total,
      annualBenefit_cad: value.totalAnnual,
      npv_cad: roi.npv,
      roi_pct: roi.roi,
      paybackYears: roi.paybackYears,
    },
    interventionDetails: scoreResult.interventions,
    disclaimers: [
      'Planning-level estimate only — not a formal appraisal or engineering design.',
      'Coefficients are Alberta-calibrated defaults. Site walk + soil testing will improve accuracy.',
      'Value estimates assume full establishment and maintenance of interventions.',
      `Estimated with ${COEFFICIENT_VERSION} coefficients.`,
    ],
    generatedAt: new Date().toISOString(),
  };
}