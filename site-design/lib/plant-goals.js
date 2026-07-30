/**
 * Planting planner goals — user-selectable objectives that drive soft scoring
 * and ranking in the Plant Recommendation + Economics Engine.
 *
 * Ecological goals stack (multi-select). Economic strategies are exclusive
 * (lowest cost / max revenue / fastest payback) and control secondary sort.
 */

/** @typedef {{ id: string, label: string, short: string, description: string, kind: 'ecological'|'economic'|'balanced', exclusive?: boolean }} PlantGoal */

/** @type {PlantGoal[]} */
export const PLANT_GOALS = [
  {
    id: 'balanced',
    label: 'Balanced',
    short: 'Balanced',
    description: 'Multi-function fit — food, soil, wildlife, and site levers together.',
    kind: 'balanced',
    exclusive: true,
  },
  {
    id: 'max_food',
    label: 'Max food',
    short: 'Max food',
    description: 'Prioritize edible crops and food-forest species with strong yield potential.',
    kind: 'ecological',
  },
  {
    id: 'max_nitrogen',
    label: 'Max nitrogen',
    short: 'Max N',
    description: 'Favor nitrogen-fixers and fertility-building species.',
    kind: 'ecological',
  },
  {
    id: 'soil_building',
    label: 'Soil building',
    short: 'Soil',
    description: 'Cover crops, dynamic accumulators, and structure-building plants.',
    kind: 'ecological',
  },
  {
    id: 'windbreak',
    label: 'Windbreak',
    short: 'Wind',
    description: 'Shelterbelt and wind-tolerant woody species for open sites.',
    kind: 'ecological',
  },
  {
    id: 'wildlife',
    label: 'Wildlife',
    short: 'Wildlife',
    description: 'Native and habitat plants for birds, pollinators, and biodiversity.',
    kind: 'ecological',
  },
  {
    id: 'pollinator',
    label: 'Pollinators',
    short: 'Pollinate',
    description: 'Flowering and pollinator-support species.',
    kind: 'ecological',
  },
  {
    id: 'medicinal',
    label: 'Medicinal / herbal',
    short: 'Herbal',
    description: 'Medicinal herbs and dual-purpose herbals.',
    kind: 'ecological',
  },
  {
    id: 'wetland_buffer',
    label: 'Wetland buffer',
    short: 'Wetland',
    description: 'Edge and moisture-tolerant species for wetland margins.',
    kind: 'ecological',
  },
  {
    id: 'fodder',
    label: 'Fodder / forage',
    short: 'Fodder',
    description: 'Livestock forage and fodder species.',
    kind: 'ecological',
  },
  {
    id: 'lowest_cost',
    label: 'Lowest cost',
    short: 'Low cost',
    description: 'Best fit per establishment dollar — favor cheaper packs and efficient density.',
    kind: 'economic',
    exclusive: true,
  },
  {
    id: 'max_revenue',
    label: 'Max revenue',
    short: 'Max $',
    description: 'Rank by expected gross revenue at maturity (planning ranges).',
    kind: 'economic',
    exclusive: true,
  },
  {
    id: 'fastest_payback',
    label: 'Fastest payback',
    short: 'Payback',
    description: 'Prefer shorter years-to-payback where cash models exist.',
    kind: 'economic',
    exclusive: true,
  },
];

const GOAL_BY_ID = Object.fromEntries(PLANT_GOALS.map((g) => [g.id, g]));

/**
 * Normalize user goal ids — exclusive economic/balanced modes, ecological stack.
 * @param {string[]|string|null|undefined} raw
 * @param {{ from_weak_levers?: boolean, weakest?: object[] }} [opts]
 * @returns {string[]}
 */
export function normalizePlantGoals(raw, opts = {}) {
  let list = [];
  if (Array.isArray(raw)) list = raw.map(String);
  else if (typeof raw === 'string' && raw.trim()) list = raw.split(/[,|]/).map((s) => s.trim());

  const out = [];
  let economic = null;
  let balanced = false;

  for (const item of list) {
    let id = String(item).toLowerCase().trim().replace(/[\s-]+/g, '_');

    // Alias map (exact ids)
    const aliases = {
      food: 'max_food',
      maxfood: 'max_food',
      maximize_food: 'max_food',
      food_max: 'max_food',
      nitrogen: 'max_nitrogen',
      nitrogen_fixing: 'max_nitrogen',
      n_fix: 'max_nitrogen',
      max_n: 'max_nitrogen',
      cost: 'lowest_cost',
      lowcost: 'lowest_cost',
      low_cost: 'lowest_cost',
      cheap: 'lowest_cost',
      cheapest: 'lowest_cost',
      revenue: 'max_revenue',
      cash: 'max_revenue',
      max_cash: 'max_revenue',
      highest_revenue: 'max_revenue',
      payback: 'fastest_payback',
      roi: 'fastest_payback',
      shelter: 'windbreak',
      shelterbelt: 'windbreak',
      wind: 'windbreak',
      habitat: 'wildlife',
      bees: 'pollinator',
      herbs: 'medicinal',
      forage: 'fodder',
    };
    const resolved = aliases[id] || id;
    if (!GOAL_BY_ID[resolved]) continue;

    const def = GOAL_BY_ID[resolved];
    if (def.kind === 'balanced') {
      balanced = true;
      continue;
    }
    if (def.kind === 'economic') {
      economic = resolved; // last economic wins
      continue;
    }
    if (!out.includes(resolved)) out.push(resolved);
  }

  if (balanced && !out.length && !economic) {
    return ['balanced'];
  }

  // Optional weak-lever suggestions only when no explicit goals
  if (!out.length && !economic && opts.from_weak_levers && opts.weakest?.length) {
    for (const w of opts.weakest) {
      const map = {
        water: 'soil_building',
        soilStructure: 'soil_building',
        soilBiology: 'soil_building',
        nutrientCycling: 'max_nitrogen',
        vegetativeStructure: 'max_food',
        faunaIntegration: 'wildlife',
        microclimate: 'windbreak',
      };
      const g = map[w.category];
      if (g && !out.includes(g)) out.push(g);
    }
    if (!out.length) out.push('balanced');
  }

  if (!out.length && !economic) out.push('balanced');

  // Economic strategy last so UI can show it as active mode
  if (economic) out.push(economic);
  return out.slice(0, 8);
}

/**
 * Soft score bonus for a plant under active goals (0–40-ish).
 * @param {object} crop — scored plant / catalog row mid-score
 * @param {object} signals — { edible, nFix, windish, soilish, medicinal, fodder, wetland, native, pollinator }
 * @param {string[]} goals
 * @param {object} [econ] — economics after attach
 */
export function goalScoreBonus(crop, signals, goals, econ = null) {
  if (!goals?.length || goals.includes('balanced') && goals.length === 1) {
    // Light multi-function nudge
    let b = 0;
    if (signals.edible) b += 2;
    if (signals.nFix) b += 2;
    if (signals.native) b += 1;
    return b;
  }

  let bonus = 0;
  const has = (id) => goals.includes(id);

  if (has('max_food')) {
    if (signals.edible) bonus += 18;
    if (crop.primary_value === 'food_production') bonus += 8;
    if (econ?.gross_revenue_cad?.mid > 0) bonus += 6;
    if (crop.guild_layer === 'canopy' || crop.guild_layer === 'shrub') bonus += 3;
  }
  if (has('max_nitrogen')) {
    if (signals.nFix) bonus += 22;
    if (crop.primary_value === 'nitrogen_fixing') bonus += 10;
    if (crop.category === 'cover_crop') bonus += 6;
  }
  if (has('soil_building')) {
    if (signals.soilish) bonus += 16;
    if (crop.primary_value === 'soil_building') bonus += 10;
    if (crop.category === 'cover_crop' || crop.guild_layer === 'groundcover') bonus += 5;
  }
  if (has('windbreak')) {
    if (signals.windish) bonus += 20;
    if (crop.primary_value === 'wind_protection') bonus += 10;
  }
  if (has('wildlife')) {
    if (signals.native) bonus += 14;
    if (crop.primary_value === 'biodiversity') bonus += 8;
    if (signals.edible && signals.native) bonus += 4;
  }
  if (has('pollinator')) {
    if (signals.pollinator) bonus += 18;
    if (/flower|bloom|bee|nectar/i.test(`${crop.common_name} ${crop.notes || ''}`)) bonus += 6;
  }
  if (has('medicinal')) {
    if (signals.medicinal) bonus += 20;
    if (crop.primary_value === 'medicinal') bonus += 10;
  }
  if (has('wetland_buffer')) {
    if (signals.wetland) bonus += 18;
  }
  if (has('fodder')) {
    if (signals.fodder) bonus += 18;
    if (/forage|fodder|hay|pasture|alfalfa|clover/i.test(`${crop.common_name} ${crop.category} ${crop.notes || ''}`))
      bonus += 8;
  }

  // Economic goals also give a small score tilt before sort
  if (has('lowest_cost') && econ?.establishment_cost_cad?.total != null) {
    const t = econ.establishment_cost_cad.total;
    if (t < 500) bonus += 10;
    else if (t < 1500) bonus += 5;
    else if (t > 5000) bonus -= 6;
  }
  if (has('max_revenue') && econ?.gross_revenue_cad?.mid) {
    bonus += Math.min(15, Math.round(econ.gross_revenue_cad.mid / 5000));
  }
  if (has('fastest_payback') && econ?.payback_years != null) {
    if (econ.payback_years <= 3) bonus += 12;
    else if (econ.payback_years <= 5) bonus += 6;
    else if (econ.payback_years > 8) bonus -= 4;
  }

  return bonus;
}

/**
 * Comparator for ranking plants under active goals.
 * @param {object} a
 * @param {object} b
 * @param {string[]} goals
 */
export function compareByGoals(a, b, goals = []) {
  const g = goals || [];
  const has = (id) => g.includes(id);

  if (has('lowest_cost')) {
    // Higher score per establishment dollar first
    const eff = (p) => {
      const cost = p.economics?.establishment_cost_cad?.total || 1;
      return (p.score || 0) / Math.max(cost, 50);
    };
    const d = eff(b) - eff(a);
    if (Math.abs(d) > 1e-9) return d;
    const c =
      (a.economics?.establishment_cost_cad?.total || 9e9) -
      (b.economics?.establishment_cost_cad?.total || 9e9);
    if (c) return c;
  }

  if (has('max_revenue')) {
    const d =
      (b.economics?.gross_revenue_cad?.mid || 0) - (a.economics?.gross_revenue_cad?.mid || 0);
    if (d) return d;
  }

  if (has('fastest_payback')) {
    const pa = a.economics?.payback_years;
    const pb = b.economics?.payback_years;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
  }

  if (has('max_food')) {
    const food = (p) =>
      (p.primary_value === 'food_production' ? 20 : 0) +
      (p.edibility_rating || p.plant_specs?.edibility_rating || 0) * 2 +
      (p.economics?.gross_revenue_cad?.mid || 0) / 10000;
    const d = food(b) - food(a);
    if (Math.abs(d) > 0.01) return d;
  }

  if (has('max_nitrogen')) {
    const n = (p) =>
      (p.nitrogen_fixer || p.plant_specs?.nitrogen_fixer ? 30 : 0) +
      (p.primary_value === 'nitrogen_fixing' ? 20 : 0) +
      (p.category === 'cover_crop' ? 10 : 0) +
      (p.goal_bonus || 0);
    const d = n(b) - n(a);
    if (d) return d;
  }

  if (has('windbreak')) {
    const w = (p) =>
      (p.primary_value === 'wind_protection' ? 40 : 0) +
      (/caragana|sea.?buckthorn|buffalo|willow|poplar|spruce|pine|ash|shelter|wind/i.test(
        `${p.common_name || ''} ${p.id || ''}`
      )
        ? 30
        : 0) +
      (p.goal_bonus || 0);
    const d = w(b) - w(a);
    if (d) return d;
  }

  if (has('soil_building')) {
    const s = (p) =>
      (p.primary_value === 'soil_building' ? 30 : 0) +
      (p.category === 'cover_crop' ? 25 : 0) +
      (p.nitrogen_fixer ? 10 : 0) +
      (p.goal_bonus || 0);
    const d = s(b) - s(a);
    if (d) return d;
  }

  if (has('wildlife') || has('pollinator')) {
    const h = (p) =>
      (p.alberta_native ? 20 : 0) +
      (p.primary_value === 'biodiversity' ? 15 : 0) +
      (has('pollinator') && /pollinator|bee|flower|nectar/i.test(`${p.common_name} ${p.notes || ''}`)
        ? 15
        : 0) +
      (p.goal_bonus || 0);
    const d = h(b) - h(a);
    if (d) return d;
  }

  if (has('medicinal')) {
    const m = (p) =>
      (p.primary_value === 'medicinal' ? 30 : 0) +
      (p.category === 'herb' || p.category === 'medicinal' ? 20 : 0) +
      (p.goal_bonus || 0);
    const d = m(b) - m(a);
    if (d) return d;
  }

  // Prefer higher goal_bonus when base scores are capped at 100
  const gb = (b.goal_bonus || 0) - (a.goal_bonus || 0);
  if (gb) return gb;

  // Default: score then revenue
  return (
    (b.score || 0) - (a.score || 0) ||
    (b.economics?.gross_revenue_cad?.mid || 0) - (a.economics?.gross_revenue_cad?.mid || 0) ||
    String(a.common_name || '').localeCompare(String(b.common_name || ''))
  );
}

/**
 * Human label for active goals (phase note / UI).
 */
export function goalsLabel(goals = []) {
  if (!goals?.length) return 'Balanced';
  return goals.map((id) => GOAL_BY_ID[id]?.label || id).join(' · ');
}

/**
 * Payload for UI / API discovery.
 */
export function getPlantGoalsPayload() {
  return {
    goals: PLANT_GOALS,
    default: ['balanced'],
    notes:
      'Ecological goals can stack. Economic goals (lowest cost, max revenue, fastest payback) are exclusive strategies for ranking.',
  };
}

export { GOAL_BY_ID };
