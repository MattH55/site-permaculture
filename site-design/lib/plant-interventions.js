/**
 * Planting plan → intervention value + species-specific recommendation notes.
 *
 * Turns ranked plants / guilds into:
 *  1. Enriched design_element placement text (shelterbelt / food forest with species)
 *  2. A "planting_plan" intervention with lever-score deltas + cash-flow from economics
 */

import { CATEGORY_WEIGHTS } from './fecundity-assessment.js';
import { COEFFICIENT_VERSION } from './intervention-effects.js';
import {
  selectShelterbeltMix,
  shelterbeltPlacementNotes,
  isShelterbeltPalettePlant,
  SHELTERBELT_DESIGN_NOTE,
} from './shelterbelt-palette.js';

const LEVER_LABELS = {
  water: 'Water — infiltration & retention',
  soilStructure: 'Soil structure',
  soilBiology: 'Soil biology',
  vegetativeStructure: 'Vegetative layering',
  faunaIntegration: 'Fauna integration',
  microclimate: 'Microclimate',
};

/** Map plant lever_benefits / primary values → fecundity lever keys */
const VALUE_TO_LEVER = {
  wind_protection: 'microclimate',
  snow_management: 'microclimate',
  microclimate: 'microclimate',
  food_production: 'vegetativeStructure',
  nitrogen_fixing: 'soilBiology',
  soil_building: 'soilStructure',
  biodiversity: 'faunaIntegration',
  medicinal: 'faunaIntegration',
  shade: 'microclimate',
  beauty_access: 'faunaIntegration',
};

/**
 * Enrich placement design elements with concrete species from the planting plan.
 *
 * @param {object[]} designElements
 * @param {object} plantingPlan
 * @param {object} [profile] site_condition_profile
 * @returns {object[]} new array (does not mutate originals deeply)
 */
export function enrichDesignElementsWithPlants(designElements = [], plantingPlan = null, profile = null) {
  if (!Array.isArray(designElements) || !plantingPlan?.recommended?.length) {
    return designElements;
  }

  const plants = plantingPlan.recommended;
  const guilds = plantingPlan.suggested_guilds || [];
  const weakest = profile?.fecundity?.weakest || plantingPlan.site_condition_profile?.fecundity?.weakest || [];
  const wind =
    profile?.microclimate?.wind_exposure ||
    plantingPlan.site_filters?.wind_exposure ||
    'partial';
  const windDir =
    profile?.microclimate?.prevailing_wind ||
    plantingPlan.site_condition_profile?.microclimate?.prevailing_wind ||
    null;

  const windPlants = plants
    .filter(
      (p) =>
        p.primary_value === 'wind_protection' ||
        (p.lever_benefits || []).includes('microclimate') ||
        isShelterbeltPalettePlant(p) ||
        /caragana|sea.?buckthorn|buffalo|willow|poplar|spruce|pine|ash|lilac|saskatoon|chokecherry|maple|elm/i.test(
          p.common_name || ''
        )
    )
    .slice(0, 8);

  const foodPlants = plants
    .filter((p) => p.primary_value === 'food_production' || p.edibility_rating != null)
    .slice(0, 5);

  const nfixPlants = plants
    .filter((p) => p.nitrogen_fixer || p.primary_value === 'nitrogen_fixing')
    .slice(0, 4);

  const shelterGuild = guilds.find((g) => g.id === 'shelterbelt_mix' || /shelter/i.test(g.label));
  const foodGuild = guilds.find((g) => g.id === 'food_forest_understory' || /food forest/i.test(g.label));

  const siteForPalette = {
    climate: {
      plant_hardiness_zone: plantingPlan.site_filters?.plant_hardiness_zone,
      prevailing_wind_direction: windDir,
      chinook_exposure: profile?.microclimate?.chinook_exposure,
    },
    soil: {
      ph: profile?.soil?.ph,
      drainage_class: profile?.soil?.drainage,
    },
    water: { regime: profile?.water?.regime },
  };
  const shelterMix = selectShelterbeltMix(siteForPalette, plants);

  const weakPhrase = weakest.length
    ? weakest
        .slice(0, 3)
        .map((w) => `${w.label || LEVER_LABELS[w.category] || w.category} (${w.score})`)
        .join(', ')
    : null;

  return designElements.map((el) => {
    const type = el.element_type || el.type;
    const next = { ...el };

    if (type === 'windbreak' || type === 'shelterbelt_zone') {
      const members = shelterGuild?.members?.length
        ? shelterGuild.members
        : shelterMix.members;
      const names = (members || windPlants)
        .map((p) => p.common_name)
        .filter(Boolean)
        .slice(0, 6);
      if (names.length) {
        const why = [
          wind ? `wind exposure is ${wind}` : null,
          windDir ? `prevailing ${windDir}` : null,
          weakPhrase ? `weak levers: ${weakPhrase}` : null,
          'Alberta prairie multi-row palette',
        ]
          .filter(Boolean)
          .join('; ');
        next.placement_notes = shelterbeltPlacementNotes(siteForPalette, plants);
        next.suggested_species = names;
        next.plant_rationale = why || null;
        next.shelterbelt_rows = shelterMix.by_role || shelterGuild?.by_role || null;
        next.design_note = shelterMix.design_note || SHELTERBELT_DESIGN_NOTE;
        next.improves_levers = uniqueLevers([
          'microclimate',
          ...(windPlants.flatMap((p) => p.lever_benefits || []) || []),
        ]);
        if (shelterGuild) next.linked_guild_id = shelterGuild.id;
      }
    }

    if (type === 'food_forest_guild') {
      const names = (foodGuild?.members || [...foodPlants, ...nfixPlants])
        .map((p) => p.common_name)
        .filter(Boolean)
        .slice(0, 5);
      if (names.length) {
        const list = names.join(' + ');
        const nfix = nfixPlants.map((p) => p.common_name).filter(Boolean).slice(0, 2);
        const why = [
          weakPhrase ? `weak levers: ${weakPhrase}` : null,
          nfix.length ? `N-fixers (${nfix.join(', ')}) for fertility` : null,
          plantingPlan.site_filters?.plant_hardiness_zone
            ? `zone ${plantingPlan.site_filters.plant_hardiness_zone}`
            : null,
        ]
          .filter(Boolean)
          .join('; ');
        next.placement_notes =
          `Food forest guild using ${list}${why ? ` — ${why}` : ''}. ` +
          (el.placement_notes || '').trim();
        next.suggested_species = names;
        next.plant_rationale = why || null;
        next.improves_levers = uniqueLevers([
          'vegetativeStructure',
          'soilBiology',
          'faunaIntegration',
          ...(foodPlants.flatMap((p) => p.lever_benefits || []) || []),
        ]);
        if (foodGuild) next.linked_guild_id = foodGuild.id;
      }
    }

    return next;
  });
}

/**
 * Build intervention-style value report from a planting plan.
 *
 * @param {object} plantingPlan
 * @param {Record<string, number|null>} baselineScores
 * @param {{ scenario?: string, timeHorizonYears?: number, footprintHa?: number }} [opts]
 */
export function plantingPlanInterventionValue(plantingPlan, baselineScores = {}, opts = {}) {
  const plants = plantingPlan?.recommended || [];
  if (!plants.length) return null;

  const scenario = opts.scenario || 'mid';
  const horizon = opts.timeHorizonYears || 10;
  const pe = plantingPlan.plan_economics || {};

  // Aggregate lever hits from plant benefits
  const leverHits = {};
  for (const p of plants) {
    const levers = [
      ...(p.lever_benefits || []),
      VALUE_TO_LEVER[p.primary_value],
      ...(p.secondary_values || []).map((v) => VALUE_TO_LEVER[v]),
    ].filter(Boolean);
    for (const L of uniqueLevers(levers)) {
      leverHits[L] = (leverHits[L] || 0) + 1;
    }
  }

  // Deltas scale with how many recommended plants target each lever (capped)
  const deltas = {};
  const after = { ...baselineScores };
  for (const lever of Object.keys(CATEGORY_WEIGHTS)) {
    const hits = leverHits[lever] || 0;
    if (!hits || baselineScores[lever] == null) {
      deltas[lever] = 0;
      continue;
    }
    // 3–8 points per hit, diminishing after 3 plants, scenario-scaled
    const base = Math.min(22, 4 + hits * 3.5);
    const scale = scenario === 'high' ? 1.15 : scenario === 'low' ? 0.7 : 1;
    const headroom = Math.max(0, 100 - (baselineScores[lever] || 0));
    const d = Math.min(headroom, Math.round(base * scale));
    deltas[lever] = d;
    after[lever] = Math.min(100, (baselineScores[lever] || 0) + d);
  }

  const beforeOverall = weightedOverall(baselineScores);
  const afterOverall = weightedOverall(after);
  const overallDelta =
    beforeOverall != null && afterOverall != null ? round1(afterOverall - beforeOverall) : null;

  // Cash from planting economics
  const estCost = pe.establishment_total_cad ?? sumEstablishment(plants);
  const annualGross = pe.annual_gross_mid_at_maturity_cad ?? sumGross(plants);
  const npv = pe.npv_sum_cad ?? null;

  // Simple payback from plan cashflows if available
  let payback = null;
  if (estCost > 0 && annualGross > 0) {
    // Rough: establishment years average + cost/gross
    const avgEstY =
      plants.reduce((s, p) => s + (p.economics?.establishment_years || 3), 0) / plants.length;
    payback = Math.ceil(avgEstY + estCost / Math.max(annualGross * 0.5, 1));
  }
  // Prefer min of plant paybacks when present
  const plantPaybacks = plants.map((p) => p.economics?.payback_years).filter((y) => y != null);
  if (plantPaybacks.length) {
    const med = plantPaybacks.sort((a, b) => a - b)[Math.floor(plantPaybacks.length / 2)];
    payback = payback != null ? Math.round((payback + med) / 2) : med;
  }

  const improves = Object.entries(deltas)
    .filter(([, d]) => d > 0)
    .map(([lever, d]) => ({
      lever,
      label: LEVER_LABELS[lever] || lever,
      delta: d,
      plants_targeting: leverHits[lever] || 0,
    }))
    .sort((a, b) => b.delta - a.delta);

  const speciesLines = plants.slice(0, 12).map((p) => {
    const e = p.economics || {};
    const y = e.yield_on_parcel_kg;
    const g = e.gross_revenue_cad;
    return {
      id: p.id,
      common_name: p.common_name,
      scientific_name: p.scientific_name,
      score: p.score,
      suitability: p.suitability,
      primary_value: p.primary_value,
      functions: buildFunctions(p),
      quantity: e.suggested_quantity ?? null,
      unit: e.unit || 'kg',
      /** Physical product yield on patch at maturity (kg/yr) */
      product_yield_kg: y
        ? { low: y.low_kg, mid: y.mid_kg, high: y.high_kg, unit: e.unit || 'kg' }
        : null,
      /** Cash yield = gross revenue on patch at maturity (CAD/yr) */
      cash_yield_cad: g
        ? { low: g.low, mid: g.mid, high: g.high, opex_mid: e.annual_opex_cad_est ?? null }
        : null,
      establishment_cost_cad: e.establishment_cost_cad?.total ?? null,
      gross_revenue_mid_cad: g?.mid ?? null,
      product_yield_mid_kg: y?.mid_kg ?? null,
      payback_years: e.payback_years ?? null,
      npv_mid_cad: e.npv_cad?.mid ?? null,
      improves_levers: uniqueLevers([
        ...(p.lever_benefits || []),
        VALUE_TO_LEVER[p.primary_value],
      ]).map((L) => LEVER_LABELS[L] || L),
      confidence: {
        hardiness: 'high',
        soil_moisture: p.limits?.some((l) => /texture|drainage|dry|wet/i.test(l))
          ? 'medium'
          : 'medium-high',
        yield_price: g ? 'medium' : 'low',
      },
    };
  });

  return {
    type: 'planting_plan',
    label: 'Recommended plantings (selected plan)',
    coefficientVersion: COEFFICIENT_VERSION,
    scenario,
    timeHorizonYears: horizon,
    goals: plantingPlan.goals || [],
    goals_label: plantingPlan.goals_label || null,
    scoreComparison: {
      before: { categories: { ...baselineScores }, overall: beforeOverall },
      after: { categories: after, overall: afterOverall },
      deltas: { ...deltas, overall: overallDelta },
    },
    improves_levers: improves,
    financialSummary: {
      upfrontCost_cad: estCost,
      annualBenefit_cad: annualGross,
      npv_cad: npv,
      paybackYears: payback,
      note:
        'Cash figures from plant economics overlay (partial polyculture densities). Yield/price = medium confidence planning ranges.',
    },
    species: speciesLines,
    guilds: (plantingPlan.suggested_guilds || []).map((g) => ({
      id: g.id,
      label: g.label,
      rationale: g.rationale,
      members: (g.members || []).map((m) => m.common_name),
      lever_targets: g.lever_targets || [],
    })),
    plan_economics: pe,
    disclaimers: [
      'Planting intervention value is a planning-level overlay — not an appraisal or farm business plan.',
      'Lever deltas estimate directional improvement from multi-function plantings; confirm on site walk.',
      'Hardiness match = high confidence; soil/moisture fit = medium–high; yield & price = medium (ranges only).',
      `Estimated with ${COEFFICIENT_VERSION} coefficients + plant-economics-v2.`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Compact table rows for PDF / report section.
 */
export function plantingReportTable(plantingPlan, interventionValue = null) {
  const species =
    interventionValue?.species ||
    (plantingPlan?.recommended || []).map((p) => {
      const e = p.economics || {};
      const y = e.yield_on_parcel_kg;
      const g = e.gross_revenue_cad;
      return {
        common_name: p.common_name,
        scientific_name: p.scientific_name,
        score: p.score,
        functions: buildFunctions(p),
        quantity: e.suggested_quantity,
        unit: e.unit || 'kg',
        product_yield_kg: y
          ? { low: y.low_kg, mid: y.mid_kg, high: y.high_kg, unit: e.unit || 'kg' }
          : null,
        cash_yield_cad: g
          ? { low: g.low, mid: g.mid, high: g.high, opex_mid: e.annual_opex_cad_est ?? null }
          : null,
        product_yield_mid_kg: y?.mid_kg ?? null,
        establishment_cost_cad: e.establishment_cost_cad?.total,
        gross_revenue_mid_cad: g?.mid,
        payback_years: e.payback_years,
        improves_levers: (p.lever_benefits || []).map((L) => LEVER_LABELS[L] || L),
      };
    });

  return {
    title: 'Recommended Plantings',
    goals_label: plantingPlan?.goals_label || null,
    hardiness: plantingPlan?.site_filters?.plant_hardiness_zone || null,
    effective_zone: plantingPlan?.site_filters?.effective_hardiness_zone || null,
    weakest:
      plantingPlan?.site_condition_profile?.fecundity?.weakest ||
      interventionValue?.improves_levers ||
      [],
    rows: species,
    summary: plantingPlan?.plan_economics || interventionValue?.financialSummary || null,
    guilds: interventionValue?.guilds || plantingPlan?.suggested_guilds || [],
    intervention: interventionValue
      ? {
          overall_delta: interventionValue.scoreComparison?.deltas?.overall,
          improves: interventionValue.improves_levers,
          financial: interventionValue.financialSummary,
        }
      : null,
  };
}

function buildFunctions(p) {
  const fn = [];
  if (p.nitrogen_fixer || p.primary_value === 'nitrogen_fixing') fn.push('N-fixer');
  if (p.primary_value === 'food_production' || p.edibility_rating != null) fn.push('food');
  if (p.primary_value === 'wind_protection') fn.push('windbreak');
  if (p.primary_value === 'soil_building' || p.category === 'cover_crop') fn.push('soil');
  if (p.primary_value === 'biodiversity' || p.alberta_native) fn.push('wildlife');
  if (p.primary_value === 'medicinal') fn.push('medicinal');
  if (p.primary_value === 'microclimate') fn.push('microclimate');
  for (const v of p.secondary_values || []) {
    if (v === 'nitrogen_fixing' && !fn.includes('N-fixer')) fn.push('N-fixer');
    if (v === 'wind_protection' && !fn.includes('windbreak')) fn.push('windbreak');
    if (v === 'biodiversity' && !fn.includes('wildlife')) fn.push('wildlife');
  }
  return fn.slice(0, 5);
}

function uniqueLevers(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function weightedOverall(scores) {
  let sum = 0;
  let w = 0;
  for (const [k, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    if (scores[k] != null && Number.isFinite(scores[k])) {
      sum += scores[k] * weight;
      w += weight;
    }
  }
  return w > 0 ? round1(sum / w) : null;
}

function sumEstablishment(plants) {
  return Math.round(
    plants.reduce((s, p) => s + (p.economics?.establishment_cost_cad?.total || 0), 0)
  );
}
function sumGross(plants) {
  return Math.round(
    plants.reduce((s, p) => s + (p.economics?.gross_revenue_cad?.mid || 0), 0)
  );
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

export { LEVER_LABELS, VALUE_TO_LEVER };
