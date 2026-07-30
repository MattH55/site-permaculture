/**
 * Economics overlay for plant recommendations.
 *
 * Establishment cost, yield trajectory, gross revenue, simple payback & NPV.
 * Planning ranges only — not a business plan.
 *
 * Design rules (keep estimates conservative):
 *  - Yield applies to effective planted area (polyculture share of parcel), not full ha.
 *  - Realization factor discounts theoretical farm-max yields (market access, skill, weather).
 *  - Opex is a meaningful share of gross (harvest labour), not a token %.
 *  - Plan rollups apply competition discount so multi-species lists don’t sum to “full farm” each.
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
 * Fraction of parcel devoted to this species in a mixed polyculture.
 * Much smaller than a monoculture field.
 */
function polycultureShareFor(layer, category) {
  const cat = String(category || '').toLowerCase();
  if (cat === 'cover_crop') return 0.08;
  if (layer === 'herbaceous' || layer === 'groundcover' || layer === 'root') return 0.04;
  if (layer === 'shrub' || layer === 'vine') return 0.06;
  if (layer === 'canopy' || layer === 'understory') return 0.08;
  return 0.05;
}

/**
 * How much of theoretical yield×price is realistically realized at small scale.
 * Specialty herbs with high $/kg are heavily discounted (thin markets).
 */
function realizationFactor({ scenario, labour, wholesaleMid, yieldMidKgHa, unit }) {
  let f = 0.45; // baseline: mixed polyculture, learning curve, weather

  if (scenario === 'home_use') f = 0.3; // garden-scale, partial self-use
  if (scenario === 'fodder') f = 0.55;

  const labourL = String(labour || 'medium').toLowerCase();
  if (labourL === 'high') f *= 0.75;
  if (labourL === 'low') f *= 1.05;

  // High-value herbs / essential oils: published yields often industrial biomass
  if (wholesaleMid >= 12 || (wholesaleMid >= 8 && yieldMidKgHa >= 8000)) {
    f *= 0.35;
  } else if (wholesaleMid >= 6) {
    f *= 0.55;
  }

  // Cap extreme catalog yields (e.g. 40 t/ha peppermint biomass)
  if (yieldMidKgHa >= 20000) f *= 0.4;
  else if (yieldMidKgHa >= 12000) f *= 0.55;

  if (/oil|dried|tincture/i.test(String(unit || ''))) f *= 0.5;

  return clamp(f, 0.08, 0.65);
}

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
    return establishmentOnly(meta, areaHa, suitabilityScore, economics);
  }

  const layer = meta.guild_layer || 'other';
  const category = meta.category || '';
  const scenario = meta.scenario || 'market_garden';
  const horizon = meta.horizon_years || DEFAULT_HORIZON;
  const parcelHa = Math.max(num(areaHa) || 0.1, 0.01);

  const yLo = rangeVal(e.yield_kg_per_ha, 'low');
  const yHi = rangeVal(e.yield_kg_per_ha, 'high');
  const wLo = rangeVal(e.price_wholesale_cad_per_kg, 'low');
  const wHi = rangeVal(e.price_wholesale_cad_per_kg, 'high');
  const rLo = rangeVal(e.price_retail_cad_per_kg, 'low');
  const rHi = rangeVal(e.price_retail_cad_per_kg, 'high');

  const hasCash = yHi > 0 && ((wHi > 0 && wLo > 0) || (rHi > 0 && rLo > 0));

  const suitFactor =
    suitabilityScore >= 80
      ? 0.95
      : suitabilityScore >= 65
        ? 0.8
        : suitabilityScore >= 50
          ? 0.65
          : 0.45;

  // Scenario price path — prefer wholesale for commercial; never use top retail as primary
  let pLo = wLo;
  let pHi = wHi;
  let priceNote = 'wholesale planning range (conservative)';
  if (scenario === 'home_use') {
    // Avoided purchase: partial retail, not full farmers-market top
    pLo = rLo > 0 ? rLo * 0.35 : wLo * 0.9;
    pHi = rHi > 0 ? rHi * 0.45 : wHi * 1.1;
    priceNote = 'home-use avoided retail (partial, conservative)';
  } else if (scenario === 'fodder') {
    pLo = Math.min(wLo || 0.08, 0.12);
    pHi = Math.min(wHi || 0.2, 0.25);
    priceNote = 'fodder/forage proxy';
  } else if (!(wHi > 0) && rHi > 0) {
    // No wholesale: use discounted retail (not full retail)
    pLo = rLo * 0.4;
    pHi = rHi * 0.5;
    priceNote = 'discounted retail proxy (no wholesale ladder)';
  }

  const polyShare = polycultureShareFor(layer, category);
  const effectiveAreaHa = parcelHa * polyShare;

  const yieldMidHa = (yLo + yHi) / 2;
  const priceMid = (pLo + pHi) / 2;
  const realization = realizationFactor({
    scenario,
    labour: e.labour_intensity,
    wholesaleMid: wHi > 0 ? (wLo + wHi) / 2 : priceMid,
    yieldMidKgHa: yieldMidHa,
    unit: e.unit,
  });

  // Scale: effective patch × suitability × realization
  const scale = effectiveAreaHa * suitFactor * realization;

  const yieldParcel = hasCash
    ? {
        low_kg: round1(yLo * scale),
        high_kg: round1(yHi * scale),
        mid_kg: round1(yieldMidHa * scale),
      }
    : null;

  let gross = hasCash
    ? {
        low: round0(yLo * scale * pLo),
        high: round0(yHi * scale * pHi),
        mid: round0(yieldMidHa * scale * priceMid),
      }
    : null;

  // Absolute sanity cap: $/species-patch/year at maturity (CAD)
  // Prevents runaway herb/oil numbers on multi-acre parcels
  const grossCap = Math.round(
    Math.min(45000, Math.max(2500, 8000 + effectiveAreaHa * 12000))
  );
  if (gross) {
    const midBefore = gross.mid;
    gross = {
      low: Math.min(gross.low, Math.round(grossCap * 0.45)),
      high: Math.min(gross.high, Math.round(grossCap * 1.35)),
      mid: Math.min(gross.mid, grossCap),
    };
    if (midBefore > gross.mid) {
      priceNote += ` · revenue capped at ~$${grossCap.toLocaleString('en-CA')}/yr for this patch`;
    }
  }

  const density = DENSITY_PER_HA[layer] || DENSITY_PER_HA.other;
  const rawQty = Math.round(density * effectiveAreaHa);
  const cap =
    layer === 'canopy' || layer === 'understory'
      ? 35
      : layer === 'shrub' || layer === 'vine'
        ? 60
        : layer === 'herbaceous' || layer === 'groundcover'
          ? 120
          : 50;
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
    materials_cad: round0(quantity * 2.5),
    total: round0((plantUnit + installUnit + 2.5) * quantity),
    density_per_ha: density,
    polyculture_share: polyShare,
    effective_area_ha: round3(effectiveAreaHa),
  };

  const establishYears =
    num(e.establishment_years) ?? (layer === 'canopy' ? 5 : layer === 'shrub' ? 3 : 2);

  // Harvest + marketing opex as share of gross (not just 8% of plant cost)
  const labourL = String(e.labour_intensity || 'medium').toLowerCase();
  const opexShare =
    labourL === 'high' ? 0.55 : labourL === 'low' ? 0.3 : 0.42;

  const cashflows = [];
  let cum = -establishment_cost_cad.total;
  let payback = null;
  let npv = -establishment_cost_cad.total;
  const annualGrossMid = gross?.mid || 0;

  for (let y = 1; y <= horizon; y++) {
    let yieldFrac = 0;
    if (y > establishYears + 2) yieldFrac = 1;
    else if (y > establishYears + 1) yieldFrac = 0.7;
    else if (y > establishYears) yieldFrac = 0.4;
    else if (y === establishYears) yieldFrac = 0.15;
    const rev = annualGrossMid * yieldFrac;
    const opex = rev * opexShare + establishment_cost_cad.total * 0.03; // light fixed maintain
    const net = rev - opex;
    cashflows.push({
      year: y,
      yield_frac: yieldFrac,
      gross_cad: round0(rev),
      opex_cad: round0(opex),
      net_cad: round0(net),
    });
    cum += net;
    if (payback == null && cum >= 0) payback = y;
    npv += net / Math.pow(1 + DISCOUNT_RATE, y);
  }

  // If never pays back within horizon, leave null (more honest than short payback)
  if (payback != null && payback > horizon) payback = null;

  const ladder = Array.isArray(e.processing_ladder) ? e.processing_ladder : [];
  const topStep = ladder.length ? ladder[ladder.length - 1] : null;
  // Value-add only as optional note at conservative multiplier (not primary gross)
  const valueAdd =
    gross && topStep?.value_add_multiplier > 1
      ? {
          product: topStep.output_product || topStep.name,
          multiplier: topStep.value_add_multiplier,
          gross_mid_cad: round0((gross.mid || 0) * Math.min(1.5, Number(topStep.value_add_multiplier) * 0.4)),
          note: 'Value-add requires extra capital, labour, and markets — shown at conservative partial capture only',
        }
      : null;

  const grossWholesale =
    hasCash && wHi > 0
      ? {
          low: round0(yLo * scale * wLo),
          high: round0(yHi * scale * wHi),
          mid: round0(yieldMidHa * scale * ((wLo + wHi) / 2)),
        }
      : null;
  const grossRetail =
    hasCash && rHi > 0
      ? {
          low: round0(yLo * scale * rLo * 0.4),
          high: round0(yHi * scale * rHi * 0.5),
          mid: round0(yieldMidHa * scale * ((rLo + rHi) / 2) * 0.45),
        }
      : null;

  // Cap wholesale/retail display the same way
  if (grossWholesale) {
    grossWholesale.mid = Math.min(grossWholesale.mid, grossCap);
    grossWholesale.high = Math.min(grossWholesale.high, Math.round(grossCap * 1.35));
    grossWholesale.low = Math.min(grossWholesale.low, Math.round(grossCap * 0.45));
  }

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
    parcel_area_ha: round2(parcelHa),
    effective_area_ha: round3(effectiveAreaHa),
    polyculture_share: polyShare,
    suitability_yield_factor: suitFactor,
    realization_factor: round2(realization),
    yield_on_parcel_kg: yieldParcel,
    suggested_quantity: quantity,
    establishment_cost_cad,
    gross_revenue_wholesale_cad: grossWholesale,
    gross_revenue_retail_cad: grossRetail,
    /** Primary planning gross — already scaled to patch + realization + cap */
    gross_revenue_cad: gross,
    annual_opex_share: opexShare,
    annual_opex_cad_est: round0((gross?.mid || 0) * opexShare),
    cashflow_years: cashflows,
    payback_years: payback,
    npv_cad: {
      horizon_years: horizon,
      discount_rate: DISCOUNT_RATE,
      mid: round0(npv),
      note:
        'NPV of net cashflow (gross − harvest opex − light maintain) after establishment — planning only, highly uncertain',
    },
    cumulative_net_at_horizon_cad: round0(cum),
    notes:
      'Conservative patch-scale estimate: yield is for polyculture share of the parcel only, with a realization discount for market access and skill. Gross is before land cost and fixed overhead. Not a business plan — confirm markets before planting.',
  };
}

function establishmentOnly(meta, areaHa, suitabilityScore, economics) {
  const layer = meta.guild_layer || 'other';
  const density = DENSITY_PER_HA[layer] || DENSITY_PER_HA.other;
  const share = polycultureShareFor(layer, meta.category);
  const parcelHa = Math.max(num(areaHa) || 0.1, 0.01);
  const effectiveAreaHa = parcelHa * share;
  const cap =
    layer === 'canopy' || layer === 'understory'
      ? 35
      : layer === 'shrub' || layer === 'vine'
        ? 60
        : 120;
  const quantity = Math.max(1, Math.min(cap, Math.round(density * effectiveAreaHa) || 1));
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
      polyculture_share: share,
      effective_area_ha: round3(effectiveAreaHa),
    },
    suitability_yield_factor:
      suitabilityScore >= 80 ? 0.95 : suitabilityScore >= 65 ? 0.8 : 0.65,
    parcel_area_ha: round2(parcelHa),
    effective_area_ha: round3(effectiveAreaHa),
    gross_revenue_cad: null,
    payback_years: null,
    npv_cad: null,
    notes: 'Establishment cost estimate only — no price/yield ladder for this species.',
  };
}

/**
 * Roll up economics across a planting plan selection.
 * Applies competition discount so N independent full-patch estimates aren't summed raw.
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

  // Multi-species polyculture cannot realize every crop's full patch revenue at once
  const competition =
    withCash <= 1 ? 1 : withCash === 2 ? 0.75 : withCash <= 4 ? 0.55 : 0.4;

  return {
    n_plants: (plants || []).length,
    n_with_cash_model: withCash,
    establishment_total_cad: round0(est),
    annual_gross_mid_at_maturity_cad: round0(grossMid * competition),
    annual_gross_sum_uncapped_cad: round0(grossMid),
    polyculture_competition_factor: competition,
    npv_sum_cad: round0(npv * competition),
    horizon_years: horizon,
    discount_rate: DISCOUNT_RATE,
    disclaimer:
      'Plan totals are conservative: each crop uses only a polyculture share of the parcel, yields are realization-discounted, and multi-species sums apply a competition factor so you do not double-count land. Not additive farm-income forecasts.',
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
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

export { DENSITY_PER_HA, UNIT_COST, DISCOUNT_RATE, polycultureShareFor, realizationFactor };
