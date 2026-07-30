/**
 * High-level service package recommendation engine.
 *
 * Site analysis (rules, wells, solar, fecundity) feeds four client-facing
 * pillars — Food, Water, Energy, Shelter — each with priced packages EE sells.
 *
 * Categories (user-facing order):
 *   1. Water   — wells, swales, ponds
 *   2. Food    — food forest, soil-carbon building interventions
 *   3. Energy  — solar + generator packages
 *   4. Shelter — off-grid garage (fixed $250k offer) + wind/snow belts
 */

import { estimate } from './rate-engine.js';

/** Fixed public offer for the turnkey off-grid garage package (CAD). */
export const OFF_GRID_GARAGE_PRICE_CAD = 250_000;

/**
 * Canonical package catalog. IDs are stable for UI, quotes, and CTAs.
 */
export const PACKAGE_CATALOG = {
  // ── Water ──────────────────────────────────────────────
  well_drilling: {
    id: 'well_drilling',
    category: 'water',
    label: 'Groundwater well',
    blurb:
      'Licensed drill to a hydrology-based completion depth from nearby well records. Planning cost ≈ 92×depth(ft)+4600 CAD (+15% mid formula; min ~$11,500). Yield measured on site.',
    cta: 'Plan a well',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    related_element_types: ['groundwater_well'],
  },
  swale_package: {
    id: 'swale_package',
    category: 'water',
    label: 'Contour swales',
    blurb: 'On-contour water harvest so rainfall soaks in instead of leaving the parcel.',
    cta: 'Size swales',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    related_element_types: ['swale'],
    rate_service_id: 'swale',
  },
  pond_package: {
    id: 'pond_package',
    category: 'water',
    label: 'Pond / dam',
    blurb: 'Valley-floor storage for drought buffer, wildlife, and microclimate.',
    cta: 'Size a pond',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    related_element_types: ['pond', 'water_harvesting_earthwork'],
    rate_service_id: 'pond',
  },

  // ── Food ───────────────────────────────────────────────
  food_forest_package: {
    id: 'food_forest_package',
    category: 'food',
    label: 'Food forest guilds',
    blurb: 'Layered perennial polyculture for kitchen and market yield once soil-building is underway.',
    cta: 'Plan food forest',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    related_element_types: ['food_forest_guild'],
    rate_service_id: 'foodforest',
  },
  soil_carbon_package: {
    id: 'soil_carbon_package',
    category: 'food',
    label: 'Soil carbon building',
    blurb:
      'Hügelkultur, cover crops, compost, and nitrogen-fixers to build organic matter. Lab SOC required for any carbon credit claim — this package sells the interventions.',
    cta: 'Build soil carbon',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    related_element_types: ['hugelkultur_mound'],
    // Planning-level fixed package (not a day-rate line yet)
    fixed_price_cad: 8_500,
    fixed_label: 'Soil-building starter package (planning estimate)',
  },
  zone1_garden_package: {
    id: 'zone1_garden_package',
    category: 'food',
    label: 'Zone 1 kitchen garden',
    blurb: 'Herb spiral, keyhole beds, and intensive daily-use layout near the house.',
    cta: 'Design Zone 1',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'low',
    related_element_types: ['herb_spiral', 'keyhole_bed'],
    fixed_price_cad: 3_200,
    fixed_label: 'Zone 1 intensive beds (planning estimate)',
  },

  // ── Energy ─────────────────────────────────────────────
  solar_cabin: {
    id: 'solar_cabin',
    category: 'energy',
    label: 'Basic package (solar)',
    blurb: '1.3 kW array + 5 kWh battery — weekend lights and small loads.',
    cta: 'View solar package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    solar_tier: 0,
  },
  solar_small_cabin: {
    id: 'solar_small_cabin',
    category: 'energy',
    label: 'Standard package (solar)',
    blurb: '2.2 kW array + 5 kWh battery + portable generator backup.',
    cta: 'View solar package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    solar_tier: 1,
  },
  solar_home: {
    id: 'solar_home',
    category: 'energy',
    label: 'Plus package (solar)',
    blurb: '5.3 kW array + 15 kWh battery + propane auto-start generator.',
    cta: 'View solar package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    solar_tier: 2,
  },
  solar_family: {
    id: 'solar_family',
    category: 'energy',
    label: 'Total package (solar)',
    blurb: '8.8 kW hybrid + 26 kWh battery + 10–12 kW standby generator.',
    cta: 'View solar package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    solar_tier: 3,
  },
  solar_shop: {
    id: 'solar_shop',
    category: 'energy',
    label: 'Complete package (solar)',
    blurb: '14 kW stacked hybrid + 41 kWh battery + 15–20 kW propane standby.',
    cta: 'View solar package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    solar_tier: 4,
  },

  // ── Shelter ────────────────────────────────────────────
  off_grid_garage: {
    id: 'off_grid_garage',
    category: 'shelter',
    label: 'Off-grid garage',
    blurb:
      'Turnkey insulated garage / workshop shell sized for rural Alberta — power-ready for solar, well pump space, and cold-climate detailing. Fixed package offer.',
    cta: 'Reserve garage package',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'high',
    fixed_price_cad: OFF_GRID_GARAGE_PRICE_CAD,
    fixed_label: 'Off-grid garage package (fixed offer)',
    featured: true,
  },
  shelterbelt_package: {
    id: 'shelterbelt_package',
    category: 'shelter',
    label: 'Wind & snow shelterbelt',
    blurb: 'Multi-row belt upwind of house and yard — wind reduction and snow management.',
    cta: 'Design shelterbelt',
    href: 'https://www.expandingedge.ca/services-landing',
    effort: 'medium',
    related_element_types: ['windbreak', 'shelterbelt_zone'],
    rate_service_id: 'shelterbelt',
  },
};

/** Display order and labels for the four pillars. */
export const CATEGORY_META = {
  water: {
    id: 'water',
    label: 'Water',
    order: 1,
    color: 'var(--h3)',
    client: 'Wells, swales, and ponds — hold and secure water on site',
  },
  food: {
    id: 'food',
    label: 'Food',
    order: 2,
    color: 'var(--h5)',
    client: 'Food forests and soil-carbon building interventions',
  },
  energy: {
    id: 'energy',
    label: 'Energy',
    order: 3,
    color: 'var(--h6)',
    client: 'Solar power packages with generator backup',
  },
  shelter: {
    id: 'shelter',
    label: 'Shelter',
    order: 4,
    color: 'var(--h4)',
    client: 'Off-grid garage and wind protection',
  },
};

/**
 * Solar hardware tiers (CAD installed planning totals, markup included).
 * Kept in sync with public/app.js solarCapacitySection tiers.
 */
export const SOLAR_TIERS = [
  {
    id: 'solar_cabin',
    name: 'Basic package',
    arrayKw: 1.32,
    batteryKwh: 5.12,
    designLoadKwh: 3,
    generator: null,
    total_cad: Math.round((594 + 1890 + 2190 + 450 + 250) * 1.5),
  },
  {
    id: 'solar_small_cabin',
    name: 'Standard package',
    arrayKw: 2.2,
    batteryKwh: 5.12,
    designLoadKwh: 5,
    generator: '3–4 kW portable',
    total_cad: Math.round((990 + 1890 + 2190 + 1162 + 340 + 1500) * 1.5),
  },
  {
    id: 'solar_home',
    name: 'Plus package',
    arrayKw: 5.28,
    batteryKwh: 15.36,
    designLoadKwh: 10,
    generator: '6–8 kW propane, auto-start',
    total_cad: Math.round((2376 + 1890 + 6570 + 1700 + 500 + 3500) * 1.5),
  },
  {
    id: 'solar_family',
    name: 'Total package',
    arrayKw: 8.8,
    batteryKwh: 25.6,
    designLoadKwh: 15,
    generator: '10–12 kW propane standby',
    total_cad: Math.round((3960 + 6490 + 10950 + 2400 + 650 + 6000) * 1.5),
  },
  {
    id: 'solar_shop',
    name: 'Complete package',
    arrayKw: 14.1,
    batteryKwh: 40.96,
    designLoadKwh: 25,
    generator: '15–20 kW propane standby',
    total_cad: Math.round((6336 + 12980 + 17520 + 3800 + 900 + 9000) * 1.5),
  },
];

/**
 * Recommend service packages from assembled site signals.
 *
 * @param {object} ctx
 * @param {object[]} [ctx.design_elements]
 * @param {object|null} [ctx.predicted_well_depth]
 * @param {object|null} [ctx.solar]
 * @param {object|null} [ctx.fecundity]
 * @param {number|null} [ctx.footprint_ha]
 * @param {number|null} [ctx.slope_percent]
 * @param {object|null} [ctx.hydrology]
 * @param {object|null} [ctx.service_quote] existing rate-engine quote (for line costs)
 * @param {number|null} [ctx.travel_km]
 * @param {string} [ctx.propertyLabel]
 */
export function recommendServicePackages(ctx = {}) {
  const elements = ctx.design_elements || [];
  const elementTypes = new Set(elements.map((e) => e.element_type));
  const well = ctx.predicted_well_depth;
  const solar = ctx.solar;
  const fecundity = ctx.fecundity;
  const footprint = num(ctx.footprint_ha);
  const hydrology = ctx.hydrology || {};
  const quoteItems = ctx.service_quote?.items || [];
  const travelKm = ctx.travel_km ?? ctx.service_quote?.sizing_basis?.travel_km_one_way ?? 40;

  const packages = [];

  // ── Water ──
  if (
    elementTypes.has('groundwater_well') ||
    (well?.estimated_depth_m != null &&
      (hydrology.distance_to_nearest_watercourse_m == null ||
        hydrology.distance_to_nearest_watercourse_m > 250))
  ) {
    packages.push(
      packageRec('well_drilling', {
        priority: 1,
        confidence: well?.confidence === 'well_control_dense' ? 'high' : 'moderate',
        reason: wellDepthReason(well),
        site_facts: {
          estimated_depth_m: well?.estimated_depth_m ?? null,
          static_water_level_m: well?.estimated_static_water_level_m ?? null,
          nearby_well_count: well?.nearby_well_count ?? null,
        },
        // Drill cost is highly local — show depth-driven planning band only
        price: wellPlanningPrice(well),
      })
    );
  }

  if (elementTypes.has('swale') && !wetlandBlocked(elements, 'swale')) {
    const swaleQuote = quoteItems.find((i) => i.service === 'swale');
    packages.push(
      packageRec('swale_package', {
        priority: 2,
        confidence: 'moderate',
        reason: 'Slope and drainage support contour swales for water harvest.',
        price: fromRateQuote(swaleQuote),
        size: swaleQuote?.size,
        unit: swaleQuote?.unit,
      })
    );
  }

  if (elementTypes.has('pond') || elementTypes.has('water_harvesting_earthwork')) {
    const pondQuote = quoteItems.find((i) => i.service === 'pond');
    packages.push(
      packageRec('pond_package', {
        priority: 2,
        confidence: 'moderate',
        reason: 'Landform supports valley-floor storage / water-harvesting earthworks.',
        price: fromRateQuote(pondQuote),
        size: pondQuote?.size,
        unit: pondQuote?.unit,
      })
    );
  }

  // ── Food ──
  if (elementTypes.has('food_forest_guild') || shouldSuggestFoodForest(fecundity, footprint)) {
    const ffQuote = quoteItems.find((i) => i.service === 'foodforest');
    packages.push(
      packageRec('food_forest_package', {
        priority: elementTypes.has('food_forest_guild') ? 2 : 4,
        confidence: elementTypes.has('food_forest_guild') ? 'moderate' : 'low-moderate',
        reason: elementTypes.has('food_forest_guild')
          ? 'Succession / cover supports layered perennial food production.'
          : 'Parcel size and climate allow a staged food-forest introduction after soil building.',
        price: fromRateQuote(ffQuote) || fixedPrice(PACKAGE_CATALOG.food_forest_package),
        size: ffQuote?.size,
        unit: ffQuote?.unit,
      })
    );
  }

  const weakSoil =
    fecundity?.categories?.find((c) => c.category === 'soilStructure' || c.category === 'soilBiology')
      ?.score != null &&
    fecundity.categories.some(
      (c) =>
        (c.category === 'soilStructure' || c.category === 'soilBiology' || c.category === 'nutrientCycling') &&
        c.score != null &&
        c.score < 55
    );
  if (elementTypes.has('hugelkultur_mound') || weakSoil || elementTypes.has('food_forest_guild')) {
    packages.push(
      packageRec('soil_carbon_package', {
        priority: weakSoil || elementTypes.has('hugelkultur_mound') ? 2 : 4,
        confidence: 'moderate',
        reason: weakSoil
          ? 'Fecundity soil levers are weak — soil-building interventions raise long-term food capacity.'
          : elementTypes.has('hugelkultur_mound')
            ? 'Shallow or low-capability soil triggers raised beds / hügelkultur.'
            : 'Pair food forest establishment with organic-matter building (no satellite SOC claims).',
        price: fixedPrice(PACKAGE_CATALOG.soil_carbon_package),
        claims_note:
          'Sells interventions (hugel, cover, compost, N-fixers). No numeric SOC claim without laboratory verification.',
      })
    );
  }

  if (elementTypes.has('herb_spiral') || elementTypes.has('keyhole_bed') || (footprint != null && footprint < 0.25)) {
    packages.push(
      packageRec('zone1_garden_package', {
        priority: 3,
        confidence: 'moderate',
        reason:
          footprint != null && footprint < 0.1
            ? 'Small footprint favors intensive Zone 1 production near daily use.'
            : 'Compact kitchen garden package complements larger food-forest work.',
        price: fixedPrice(PACKAGE_CATALOG.zone1_garden_package),
      })
    );
  }

  // ── Energy (always offer best-fit solar when resource data exists) ──
  if (solar?.available !== false) {
    const tierIndices = pickSolarTiers(footprint, solar);
    for (const idx of tierIndices) {
      const tier = SOLAR_TIERS[idx];
      const cat = PACKAGE_CATALOG[tier.id];
      if (!cat) continue;
      packages.push(
        packageRec(tier.id, {
          priority: idx === tierIndices[0] ? 2 : 5,
          confidence: solar?.viability?.band === 'excellent' || solar?.viability?.band === 'good' ? 'high' : 'moderate',
          reason: solarEnergyReason(solar, tier),
          price: {
            kind: 'package',
            amount_cad: tier.total_cad,
            currency: 'CAD',
            label: `${tier.name} — solar${tier.generator ? ' + generator' : ''}`,
            range_low_cad: Math.round(tier.total_cad * 0.92),
            range_high_cad: Math.round(tier.total_cad * 1.18),
          },
          site_facts: {
            array_kw: tier.arrayKw,
            battery_kwh: tier.batteryKwh,
            design_load_kwh_day: tier.designLoadKwh,
            days_on_battery:
              tier.batteryKwh != null && tier.designLoadKwh
                ? Math.round(((tier.batteryKwh * 0.9) / tier.designLoadKwh) * 10) / 10
                : null,
            generator: tier.generator,
            insolation_kwh_m2_day:
              solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt ?? null,
            viability_band: solar?.viability?.band ?? null,
          },
          featured: idx === tierIndices[0],
        })
      );
    }
  }

  // ── Shelter ──
  // Off-grid garage is available for rural parcels but never auto-featured / never default-selected
  if (footprint == null || footprint >= 0.2) {
    packages.push(
      packageRec('off_grid_garage', {
        priority: 8,
        confidence: 'high',
        reason:
          'Optional fixed-price off-grid garage package — shell ready for solar, well gear, and cold-climate use. Not included by default.',
        price: fixedPrice(PACKAGE_CATALOG.off_grid_garage),
        featured: false,
        default_selected: false,
        optional: true,
      })
    );
  }

  // Shelterbelt: offer when windbreak fires OR as a default rural microclimate option
  if (
    elementTypes.has('windbreak') ||
    elementTypes.has('shelterbelt_zone') ||
    footprint == null ||
    footprint >= 0.4
  ) {
    const sbQuote = quoteItems.find((i) => i.service === 'shelterbelt');
    packages.push(
      packageRec('shelterbelt_package', {
        priority: elementTypes.has('windbreak') || elementTypes.has('shelterbelt_zone') ? 2 : 3,
        confidence: elementTypes.has('windbreak') ? 'moderate-high' : 'moderate',
        reason: elementTypes.has('windbreak') || elementTypes.has('shelterbelt_zone')
          ? 'Prevailing wind / chinook exposure supports multi-row shelter upwind of living zones.'
          : 'Most Alberta rural parcels benefit from a windward shelterbelt for microclimate and snow control.',
        price: fromRateQuote(sbQuote),
        size: sbQuote?.size,
        unit: sbQuote?.unit,
        default_selected: true,
      })
    );
  }

  // Sort within catalog priority, then category order
  packages.sort(
    (a, b) =>
      (a.priority ?? 9) - (b.priority ?? 9) ||
      (CATEGORY_META[a.category]?.order ?? 9) - (CATEGORY_META[b.category]?.order ?? 9)
  );

  const by_category = groupByCategory(packages);
  const summary = buildPackageSummary(packages, by_category);
  const total_planning_cad = packages.reduce((s, p) => s + (p.price?.amount_cad || 0), 0);

  return {
    summary_sentence: summary,
    packages,
    by_category,
    categories: Object.values(CATEGORY_META).sort((a, b) => a.order - b.order),
    featured: packages.filter((p) => p.featured),
    totals: {
      package_count: packages.length,
      planning_subtotal_cad: Math.round(total_planning_cad),
      currency: 'CAD',
      note: 'Sum of recommended package planning estimates — not a firm quote. Mix and match pillars.',
    },
    flow: [
      { step: 1, id: 'value', label: 'Your site insights', description: 'Map, water, soil, climate — free analysis' },
      { step: 2, id: 'choose', label: 'Choose interventions', description: 'Select planting, shelter, water options' },
      { step: 3, id: 'report', label: 'Full report', description: 'Download with your email' },
      { step: 4, id: 'estimate', label: 'Estimate & inquire', description: 'Itemized planning costs → talk to EE' },
    ],
    propertyLabel: ctx.propertyLabel || null,
    generatedAt: new Date().toISOString(),
  };
}

// ── helpers ──────────────────────────────────────────────

function packageRec(id, extra = {}) {
  const base = PACKAGE_CATALOG[id];
  if (!base) throw new Error(`Unknown package ${id}`);
  return {
    ...base,
    ...extra,
    category_label: CATEGORY_META[base.category]?.label || base.category,
  };
}

function fixedPrice(cat) {
  if (cat.fixed_price_cad == null) return null;
  return {
    kind: 'package',
    amount_cad: cat.fixed_price_cad,
    currency: 'CAD',
    label: cat.fixed_label || cat.label,
    range_low_cad: Math.round(cat.fixed_price_cad * 0.95),
    range_high_cad: Math.round(cat.fixed_price_cad * 1.1),
  };
}

function fromRateQuote(item) {
  if (!item) return null;
  return {
    kind: 'field_estimate',
    amount_cad: item.subtotal,
    currency: item.currency || 'CAD',
    label: item.serviceName,
    range_low_cad: item.rangeLow,
    range_high_cad: item.rangeHigh,
    field_days: item.fieldDays,
    line_items: (item.lineItems || []).map((l) => ({
      label: l.label,
      cost_cad: l.cost,
    })),
    travel_cost_cad: item.travelCost ?? null,
    materials_cost_cad: item.materialsCost ?? null,
    materials_pct: item.materialsPct ?? null,
  };
}

function wellDepthReason(well) {
  if (!well?.estimated_depth_m) {
    return 'Groundwater supply recommended where surface water is distant or unreliable.';
  }
  const swl =
    well.estimated_static_water_level_m != null
      ? ` static water level ~${well.estimated_static_water_level_m} m`
      : '';
  return `Hydrology-based completion ~${well.estimated_depth_m} m (${well.nearby_well_count || 0} nearby wells).${swl}`;
}

/**
 * Well drill planning cost (CAD).
 *
 * Mid-value formula (+15% on prior AB ballpark):
 *   Cost_mid ≈ 92 × D + 4600
 * where D is completion depth in **feet**.
 * Practical minimum ~$11,500 (was ~$10k before +15%).
 *
 * Examples: 100 ft → ~$13,800 · 150 → ~$18,400 · 200 → ~$23,000 · 300 → ~$32,200
 * Ballpark only — site conditions, geology, access, and full scope change the quote.
 */
const WELL_COST_PER_FT = 92;
const WELL_COST_BASE = 4600;
const WELL_COST_MIN = 11_500; // ~10k × 1.15
const M_TO_FT = 3.280839895;

export function wellCostMidFromDepthFt(depthFt) {
  const d = Math.max(0, Number(depthFt) || 0);
  return Math.max(WELL_COST_MIN, Math.round(WELL_COST_PER_FT * d + WELL_COST_BASE));
}

export function wellCostMidFromDepthM(depthM) {
  return wellCostMidFromDepthFt((Number(depthM) || 0) * M_TO_FT);
}

function wellPlanningPrice(well) {
  const depthM = well?.estimated_depth_m ?? 35;
  const depthFt = round1(depthM * M_TO_FT);
  const mid = wellCostMidFromDepthFt(depthFt);

  // Band from hydrology depth range when available; else ±12% / +22% around mid
  const lowM = well?.estimated_depth_range_m?.low_m;
  const highM = well?.estimated_depth_range_m?.high_m;
  let low =
    lowM != null
      ? wellCostMidFromDepthM(lowM)
      : Math.round(mid * 0.88);
  let high =
    highM != null
      ? wellCostMidFromDepthM(highM)
      : Math.round(mid * 1.22);
  low = Math.min(low, mid);
  high = Math.max(high, mid);

  return {
    kind: 'planning_band',
    amount_cad: mid,
    currency: 'CAD',
    label: `Well drill package (~${depthFt} ft / ${round1(depthM)} m)`,
    range_low_cad: low,
    range_high_cad: high,
    depth_ft: depthFt,
    depth_m: round1(depthM),
    formula: 'Cost_mid ≈ 92×D_ft + 4600 (CAD, +15% on prior mid; min ~$11,500)',
    note:
      'Ballpark estimate only. Actual quotes depend on site conditions, geology, access, and the full scope of work. Licensed driller quote required. Depth from hydrology model.',
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function wetlandBlocked(elements, type) {
  const el = elements.find((e) => e.element_type === type);
  return /wetland/i.test(el?.condition_basis || '') || el?.confidence === 'needs_site_visit' && /wetland/i.test(el?.placement_notes || '');
}

function shouldSuggestFoodForest(fecundity, footprint) {
  if (footprint != null && footprint < 0.15) return false;
  const veg = fecundity?.categories?.find((c) => c.category === 'vegetativeStructure');
  if (veg?.score != null && veg.score < 70) return true;
  return footprint != null && footprint >= 0.5;
}

/**
 * Pick primary + alternate solar tiers from footprint and insolation.
 * Returns array of indices into SOLAR_TIERS (primary first).
 */
function pickSolarTiers(footprint, solar) {
  let primary = 2; // modest home default
  if (footprint != null) {
    if (footprint < 0.15) primary = 0;
    else if (footprint < 0.5) primary = 1;
    else if (footprint < 2) primary = 2;
    else if (footprint < 8) primary = 3;
    else primary = 4;
  }
  // Bump one tier if excellent solar resource
  const band = solar?.viability?.band;
  if (band === 'excellent' && primary < 4) primary += 0; // keep footprint-driven
  if (band === 'limited' && primary > 0) primary = Math.max(0, primary - 1);

  const alts = [];
  if (primary > 0) alts.push(primary - 1);
  if (primary < SOLAR_TIERS.length - 1) alts.push(primary + 1);
  return [primary, ...alts].slice(0, 3);
}

function solarEnergyReason(solar, tier) {
  const ins = solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt;
  const band = solar?.viability?.band;
  const muni = solar?.municipality;
  const parts = [];
  if (ins != null) parts.push(`${ins} kWh/m²·d latitude-tilt insolation`);
  if (band) parts.push(`${band} PV viability`);
  if (muni) parts.push(muni);
  const head = parts.length ? parts.join(' · ') + '. ' : '';
  return (
    head +
    `Package: ${tier.arrayKw} kW array, ${tier.batteryKwh} kWh battery` +
    (tier.generator ? `, backup ${tier.generator}` : '') +
    '.'
  );
}

function groupByCategory(packages) {
  const by = {};
  for (const cat of Object.keys(CATEGORY_META)) by[cat] = [];
  for (const p of packages) {
    if (!by[p.category]) by[p.category] = [];
    by[p.category].push(p);
  }
  return by;
}

function buildPackageSummary(packages, by_category) {
  const pillars = Object.values(CATEGORY_META)
    .filter((c) => (by_category[c.id] || []).length)
    .map((c) => c.label);
  if (!pillars.length) return 'No service packages matched this parcel yet — draw a larger area or request a site walk.';
  if (pillars.length === 1) return `On this parcel we lead with ${pillars[0]} packages.`;
  const last = pillars.pop();
  return `On this parcel we recommend packages across ${pillars.join(', ')} and ${last}.`;
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map package list into rate-engine style quote lines for packages that
 * already have amount_cad (fixed / solar / well planning).
 */
export function packagesToQuoteItems(packages = []) {
  return packages
    .filter((p) => p.price?.amount_cad != null)
    .map((p) => ({
      service: p.id,
      serviceName: p.label,
      unit: p.unit || 'package',
      size: p.size ?? 1,
      fieldDays: p.price.field_days ?? 0,
      lineItems: [{ label: p.price.label || p.label, cost: p.price.amount_cad }],
      materialsPct: 0,
      materialsCost: 0,
      travelCost: 0,
      livingOutCost: 0,
      subtotal: p.price.amount_cad,
      rangeLow: p.price.range_low_cad ?? p.price.amount_cad,
      rangeHigh: p.price.range_high_cad ?? p.price.amount_cad,
      valueProps: p.claims_note
        ? [{ confidence: 'moderate', headline: p.blurb, caveat: p.claims_note }]
        : [{ confidence: p.confidence || 'moderate', headline: p.blurb, caveat: null }],
      currency: 'CAD',
      category: p.category,
    }));
}
