/**
 * Economics overlay for plant recommendations.
 *
 * Establishment cost, yield trajectory, gross revenue, simple payback & NPV.
 * Feeds "value of improvements" / planting plan planning ranges — not a business plan.
 */

const DISCOUNT_RATE = 0.05;
const DEFAULT_HORIZON = 10;

/** Default plant unit costs (CAD) by habit when catalog has no establishment cost. */
const UNIT_COST = {
  canopy: { plant: 35, install: 15 },
  understory: { plant: 28, install: 12 },
  shrub: { plant: 14, install: 8 },
  vine: { plant: 12, install: 6 },
  herbaceous: { plant: 6, install: 3 },
  groundcover: { plant: 4, install: 2 },
  root: { plant: 5, install: 2 },
  other: { plant: 10, install: 5 },
};

/** Suggested planting density (plants/ha) by guild layer for quantity planning. */
const DENSITY_PER_HA = {
  canopy: 80,
  understory: 150,
  shrub: 600,
  vine: 200,
  herbaceous: 4000,
  groundcover: 8000,
  root: 2000,
  other: 500,
};

/**
 * @param {string} cropId
 * @param {object} economics — loadEconomics() result
 * @param {number} areaHa
 * @param {number} suitabilityScore 0–100
 * @param {object|null} inlineEcon
 * @param {{ guild_layer?: string, category?: string, scenario?: string, horizon_years?: number }} meta
 */
export function attachPlantEconomics(
  cropId,
  economics,
  areaHa,
  suitabilityScore,
  inlineEcon,
  meta = {}
) {
  const e = {
    ...(economics?.items?.[cropId] || {}),
    ...(inlineEcon || {}),
  };
  if (
    !e ||
    (!e.yield_kg_per_ha &&
      !e.price_wholesale_cad_per_kg &&
      !e.non_cash_value &&
      !e.price_retail_cad_per_kg &&
      !e.establishment_cost_cad_per_plant)
  ) {
    // Still return establishment-only estimate when plant is recommended
    return establishmentOnly(meta, areaHa, suitabilityScore, economics);
  }

  const layer = meta.guild_layer || 'other';
  const scenario = meta.scenario || 'market_garden'; // market_garden | home_use | fodder
  const horizon = meta.horizon_years || DEFAULT_HORIZON;

  const yLo = rangeVal(e.yield_kg_per_ha, 'low');
  const yHi = rangeVal(e.yield_kg_per_ha, 'high');
  const wLo = rangeVal(e.price_wholesale_cad_per_kg, 'low');
  const wHi = rangeVal(e.price_wholesale_cad_per_kg, 'high');
  const rLo = rangeVal(e.price_retail_cad_per_kg, 'low');
  const rHi = rangeVal(e.price_retail_cad_per_kg, 'high');

  const hasCash = yHi > 0 && ((wHi > 0 && wLo > 0) || (rHi > 0 && rLo > 0));

  const suitFactor =
    suitabilityScore >= 80
      ? 1
      : suitabilityScore >= 65
        ? 0.9
        : suitabilityScore >= 50
          ? 0.75
          : 0.55;

  // Scenario price path
  let pLo = wLo;
  let pHi = wHi;
  let priceNote = 'wholesale planning range';
  if (scenario === 'home_use') {
    // Home use: retail avoided-purchase value at ~60% of retail mid (conservative)
    pLo = rLo > 0 ? rLo * 0.55 : wLo * 1.2;
    pHi = rHi > 0 ? rHi * 0.65 : wHi * 1.4;
    priceNote = 'home-use avoided retail (conservative)';
  } else if (scenario === 'fodder') {
    pLo = Math.min(wLo, 0.15);
    pHi = Math.min(wHi || 0.3, 0.35);
    priceNote = 'fodder/forage proxy';
  } else if (!(wHi > 0) && rHi > 0) {
    pLo = rLo;
    pHi = rHi;
    priceNote = 'retail planning range';
  }

  const yieldParcel = hasCash
    ? {
        low_kg: round1(yLo * areaHa * suitFactor),
        high_kg: round1(yHi * areaHa * suitFactor),
        mid_kg: round1(((yLo + yHi) / 2) * areaHa * suitFactor),
      }
    : null;

  const gross = hasCash
    ? {
        low: round0(yLo * areaHa * suitFactor * pLo),
        high: round0(yHi * areaHa * suitFactor * pHi),
        mid: round0(((yLo + yHi) / 2) * areaHa * suitFactor * ((pLo + pHi) / 2)),
      }
    : null;

  const density = DENSITY_PER_HA[layer] || DENSITY_PER_HA.other;
  // Partial planting: small polyculture share + hard caps so multi-species plans stay realistic
  const polycultureShare = layer === 'herbaceous' || layer === 'groundcover' ? 0.05 : 0.12;
  const rawQty = Math.round(density * areaHa * polycultureShare);
  const cap =
    layer === 'canopy' || layer === 'understory'
      ? 40
      : layer === 'shrub' || layer === 'vine'
        ? 80
        : layer === 'herbaceous' || layer === 'groundcover'
          ? 200
          : 60;
  const quantity = Math.max(1, Math.min(cap, rawQty || 1));

  const unitCosts = UNIT_COST[layer] || UNIT_COST.other;
  const plantUnit =
    num(e.establishment_cost_cad_per_plant) ??
    num(e.plant_cost_cad) ??
    unitCosts.plant;
  const installUnit = unitCosts.install;
  const establishment_cost_cad = {
    plant_unit: plantUnit,
    install_unit: installUnit,
    quantity,
    plants_cad: round0(plantUnit * quantity),
    install_cad: round0(installUnit * quantity),
    materials_cad: round0(quantity * 2.5), // mulch / protection allowance
    total: round0((plantUnit + installUnit + 2.5) * quantity),
    density_per_ha: density,
    polyculture_share: polycultureShare,
  };

  const establishYears = num(e.establishment_years) ?? (layer === 'canopy' ? 5 : layer === 'shrub' ? 3 : 2);

  // Yield trajectory: 0 until establishYears, then ramp 50% → 100% over 2 years
  const cashflows = [];
  let cum = -establishment_cost_cad.total;
  let payback = null;
  let npv = -establishment_cost_cad.total;
  const annualGrossMid = gross?.mid || 0;
  // Annual opex ~8% of establishment (pruning, harvest labour light)
  const annualOpex = establishment_cost_cad.total * 0.08;

  for (let y = 1; y <= horizon; y++) {
    let yieldFrac = 0;
    if (y > establishYears + 1) yieldFrac = 1;
    else if (y > establishYears) yieldFrac = 0.5;
    else if (y === establishYears) yieldFrac = 0.2;
    const rev = annualGrossMid * yieldFrac;
    const net = rev - annualOpex * (y >= 1 ? 1 : 0);
    cashflows.push({ year: y, yield_frac: yieldFrac, gross_cad: round0(rev), net_cad: round0(net) });
    cum += net;
    if (payback == null && cum >= 0) payback = y;
    npv += net / Math.pow(1 + DISCOUNT_RATE, y);
  }

  const ladder = Array.isArray(e.processing_ladder) ? e.processing_ladder : [];
  const topStep = ladder.length ? ladder[ladder.length - 1] : null;
  const valueAdd =
    gross && topStep?.value_add_multiplier > 1
      ? {
          product: topStep.output_product || topStep.name,
          multiplier: topStep.value_add_multiplier,
          gross_mid_cad: round0((gross.mid || 0) * Number(topStep.value_add_multiplier)),
        }
      : null;

  const grossWholesale =
    hasCash && wHi > 0
      ? {
          low: round0(yLo * areaHa * suitFactor * wLo),
          high: round0(yHi * areaHa * suitFactor * wHi),
          mid: round0(((yLo + yHi) / 2) * areaHa * suitFactor * ((wLo + wHi) / 2)),
        }
      : null;
  const grossRetail =
    hasCash && rHi > 0
      ? {
          low: round0(yLo * areaHa * suitFactor * rLo),
          high: round0(yHi * areaHa * suitFactor * rHi),
          mid: round0(((yLo + yHi) / 2) * areaHa * suitFactor * ((rLo + rHi) / 2)),
        }
      : null;

  return {
    currency: economics?.currency || 'CAD',
    unit: e.unit || 'kg',
    scenario,
    price_basis: priceNote,
    yield_kg_per_ha: e.yield_kg_per_ha || null,
    price_wholesale_cad_per_kg: e.price_wholesale_cad_per_kg || null,
    price_retail_cad_per_kg: e.price_retail_cad_per_kg || null,
    market_channels: e.market_channels || [],
    establishment_years: establishYears,
    labour_intensity: e.labour_intensity || null,
    non_cash_value: e.non_cash_value || null,
    processing_ladder: ladder,
    value_add: valueAdd,
    parcel_area_ha: round2(areaHa),
    suitability_yield_factor: suitFactor,
    yield_on_parcel_kg: yieldParcel,
    suggested_quantity: quantity,
    establishment_cost_cad,
    gross_revenue_wholesale_cad: grossWholesale,
    gross_revenue_retail_cad: grossRetail,
    gross_revenue_cad: gross,
    annual_opex_cad_est: round0(annualOpex),
    cashflow_years: cashflows,
    payback_years: payback,
    npv_cad: {
      horizon_years: horizon,
      discount_rate: DISCOUNT_RATE,
      mid: round0(npv),
      note: 'Simple NPV of gross mid revenue minus light opex after establishment — planning only',
    },
    cumulative_net_at_horizon_cad: round0(cum),
    notes:
      'Gross revenue before full labour, packaging, and marketing. Establishment and NPV are planning ranges for conversation, not a business plan. Confirm markets before planting at scale.',
  };
}

function establishmentOnly(meta, areaHa, suitabilityScore, economics) {
  const layer = meta.guild_layer || 'other';
  const density = DENSITY_PER_HA[layer] || DENSITY_PER_HA.other;
  const share = layer === 'herbaceous' || layer === 'groundcover' ? 0.05 : 0.12;
  const cap =
    layer === 'canopy' || layer === 'understory'
      ? 40
      : layer === 'shrub' || layer === 'vine'
        ? 80
        : 200;
  const quantity = Math.max(1, Math.min(cap, Math.round(density * areaHa * share) || 1));
  const unitCosts = UNIT_COST[layer] || UNIT_COST.other;
  const total = round0((unitCosts.plant + unitCosts.install + 2.5) * quantity);
  return {
    currency: economics?.currency || 'CAD',
    scenario: meta.scenario || 'market_garden',
    non_cash_value: 'Ecological / multi-function value — no cash yield model for this species',
    suggested_quantity: quantity,
    establishment_cost_cad: {
      plant_unit: unitCosts.plant,
      install_unit: unitCosts.install,
      quantity,
      plants_cad: round0(unitCosts.plant * quantity),
      install_cad: round0(unitCosts.install * quantity),
      materials_cad: round0(quantity * 2.5),
      total,
      density_per_ha: density,
      polyculture_share: 0.2,
    },
    suitability_yield_factor:
      suitabilityScore >= 80 ? 1 : suitabilityScore >= 65 ? 0.9 : 0.75,
    parcel_area_ha: round2(areaHa),
    gross_revenue_cad: null,
    payback_years: null,
    npv_cad: null,
    notes: 'Establishment cost estimate only — no price/yield ladder for this species.',
  };
}

/**
 * Roll up economics across a planting plan selection.
 */
export function summarizePlanEconomics(plants, opts = {}) {
  const horizon = opts.horizon_years || DEFAULT_HORIZON;
  let est = 0;
  let grossMid = 0;
  let npv = 0;
  let withCash = 0;
  for (const p of plants || []) {
    const e = p.economics;
    if (!e) continue;
    if (e.establishment_cost_cad?.total) est += e.establishment_cost_cad.total;
    if (e.gross_revenue_cad?.mid) {
      grossMid += e.gross_revenue_cad.mid;
      withCash += 1;
    }
    if (e.npv_cad?.mid != null) npv += e.npv_cad.mid;
  }
  return {
    n_plants: (plants || []).length,
    n_with_cash_model: withCash,
    establishment_total_cad: round0(est),
    annual_gross_mid_at_maturity_cad: round0(grossMid),
    npv_sum_cad: round0(npv),
    horizon_years: horizon,
    discount_rate: DISCOUNT_RATE,
    disclaimer:
      'Plan totals assume partial polyculture densities and independent cashflows (no interaction). Planning conversation only.',
  };
}

function rangeVal(r, which) {
  if (r == null) return 0;
  if (typeof r === 'number') return r;
  return num(r[which]) ?? 0;
}
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round0(n) {
  return Math.round(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

export { DENSITY_PER_HA, UNIT_COST, DISCOUNT_RATE };
