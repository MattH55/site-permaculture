/**
 * Water Collection Estimation — full water budget.
 *
 * Combines:
 *   1. Roof / building catchment (rainwater harvesting)
 *   2. Swale capture (contour earthworks intercepting runoff)
 *   3. Pond storage (impoundment volume from earthworks)
 *
 * All volumes in litres.  Precipitation from NASA POWER monthly means.
 */

/** Default roof catchment scenarios (m² of catchment surface). */
const ROOF_SCENARIOS = [
  { id: 'small_house', label: 'Small house / cabin', area_m2: 80 },
  { id: 'house_barn', label: 'House + barn / garage', area_m2: 180 },
  { id: 'farmstead', label: 'Full farmstead', area_m2: 350 },
];

/**
 * Estimate the full water collection budget for a parcel.
 *
 * @param {object} opts
 * @param {object} opts.precipitation — monthly_mm (object: Jan..Dec → mm)
 * @param {number} opts.parcel_area_m2 — parcel footprint in m²
 * @param {number} opts.slope_percent — avg slope
 * @param {Array}  opts.design_elements — from rules engine (swale, pond, water_harvesting_earthwork)
 * @param {object} opts.swale_analysis — { meters, recommended } from rate-engine
 * @param {object} opts.soil — { drainage_class, texture }
 * @param {object} opts.wetlands — { present, wetland_class }
 * @param {object} opts.small_water — { summary: { has_any_water } }
 * @returns {object} water budget
 */
export function estimateWaterCollection(opts = {}) {
  const monthlyMm = opts.precipitation?.monthly_mm
    || opts.precipitation?.monthly
    || buildMonthlyFromAnnual(opts.precipitation?.mean_annual_mm);

  const annualMm = opts.precipitation?.mean_annual_mm
    || (monthlyMm ? Object.values(monthlyMm).reduce((s, v) => s + Number(v || 0), 0) : null);

  if (!annualMm || annualMm <= 0) {
    return {
      available: false,
      error: 'No precipitation data available for water collection estimate.',
      disclaimer: WATER_DISCLAIMER,
    };
  }

  const parcelM2 = opts.parcel_area_m2 || 10_000;
  const swaleMeters = opts.swale_analysis?.meters || 0;
  const swaleRecommended = !!opts.swale_analysis?.recommended;
  const designElements = opts.design_elements || [];

  // ── 1. Roof catchment ──────────────────────────────────────────────
  const roofScenarios = ROOF_SCENARIOS.map((sc) => {
    const monthlyLitres = computeRoofMonthly(monthlyMm, sc.area_m2);
    const annualLitres = sumValues(monthlyLitres);
    return {
      id: sc.id,
      label: sc.label,
      catchment_m2: sc.area_m2,
      annual_litres: Math.round(annualLitres),
      monthly_litres: monthlyLitres,
      // 1000L IBC tote equiv
      annual_ibc_totes: Math.round(annualLitres / 1000),
      // Recommended tank: 3-month dry-season buffer
      recommended_tank_litres: recommendTank(monthlyLitres),
    };
  });

  // ── 2. Swale capture ───────────────────────────────────────────────
  const swaleCapture = estimateSwaleCapture({
    swaleMeters,
    monthlyMm,
    slopePercent: opts.slope_percent,
    soilDrainage: opts.soil?.drainage_class,
    parcelAreaM2: parcelM2,
  });

  // ── 3. Pond storage ────────────────────────────────────────────────
  const pondElements = designElements.filter(
    (e) => e.element_type === 'pond' || e.element_type === 'water_harvesting_earthwork'
  );
  const pondStorage = estimatePondStorage(pondElements, opts);

  // ── 4. Whole-parcel runoff (for context) ───────────────────────────
  const runoffCoeff = runoffCoefficient(opts.soil?.drainage_class, opts.wetlands);
  const parcelRunoffLitres = Math.round(annualMm * parcelM2 * runoffCoeff);

  // ── Summary ────────────────────────────────────────────────────────
  // Use the "house + barn" scenario as the primary display
  const primaryRoof = roofScenarios.find((s) => s.id === 'house_barn') || roofScenarios[0];
  const totalAnnualLitres = primaryRoof.annual_litres
    + swaleCapture.annual_litres
    + pondStorage.annual_litres;

  // Identify dry months (lowest 3 months of precip)
  const sortedMonths = Object.entries(monthlyMm || {})
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const dryMonths = sortedMonths.slice(0, 3).map(([m]) => m);
  const wetMonths = sortedMonths.slice(-3).map(([m]) => m);

  // Monthly budget for the primary scenario
  const monthlyBudget = {};
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (const m of monthNames) {
    const precipMm = Number(monthlyMm?.[m] || 0);
    const roofL = Math.round(precipMm * primaryRoof.catchment_m2 * 0.85);
    const swaleL = swaleCapture.monthly_litres?.[m] || 0;
    monthlyBudget[m] = {
      precip_mm: precipMm,
      roof_litres: roofL,
      swale_litres: swaleL,
      total_litres: roofL + swaleL,
    };
  }

  return {
    available: true,
    annual_precipitation_mm: Math.round(annualMm),
    parcel_area_m2: Math.round(parcelM2),
    runoff_coefficient: Math.round(runoffCoeff * 100) / 100,

    // Roof catchment scenarios
    roof_scenarios: roofScenarios,

    // Swale capture
    swale_capture: swaleCapture,

    // Pond storage
    pond_storage: pondStorage,

    // Parcel runoff context
    parcel_runoff_litres: parcelRunoffLitres,

    // Primary summary (house + barn scenario + swales + pond)
    total_annual_litres: Math.round(totalAnnualLitres),
    total_annual_m3: Math.round(totalAnnualLitres / 1000),
    total_annual_gallons: Math.round(totalAnnualLitres * 0.264172),

    // Monthly breakdown for primary scenario
    monthly_budget: monthlyBudget,

    // Seasonal insights
    dry_months: dryMonths,
    wet_months: wetMonths,
    recommended_tank_litres: primaryRoof.recommended_tank_litres,

    // Water features context
    has_existing_water: !!(opts.wetlands?.present || opts.small_water?.summary?.has_any_water),

    source: 'NASA POWER precipitation × parcel geometry × standard catchment coefficients',
    disclaimer: WATER_DISCLAIMER,
  };
}

// ── Roof catchment ─────────────────────────────────────────────────────

/**
 * 1 mm of rain on 1 m² = 1 litre.  Multiply by catchment efficiency (0.85).
 */
function computeRoofMonthly(monthlyMm, areaM2) {
  const result = {};
  for (const [month, mm] of Object.entries(monthlyMm || {})) {
    result[month] = Math.round(Number(mm || 0) * areaM2 * 0.85);
  }
  return result;
}

/**
 * Recommend a tank size: 3 months of the driest quarter's collection.
 */
function recommendTank(monthlyLitres) {
  const sorted = Object.values(monthlyLitres).sort((a, b) => a - b);
  const driest3 = sorted.slice(0, 3);
  const buffer = driest3.reduce((s, v) => s + v, 0);
  // Round up to nearest 1000L, minimum 5000L
  return Math.max(5000, Math.ceil(buffer / 1000) * 1000);
}

// ── Swale capture ──────────────────────────────────────────────────────

/**
 * Estimate how much stormwater swales intercept.
 *
 * A contour swale captures runoff from the upslope catchment area.
 * Volume ≈ swale_length × capture_depth × vertical_interval × runoff_coeff
 * Simplified: swale acts as a linear sponge — each metre of swale intercepts
 * runoff from (vertical_interval / slope) × 1m width of upslope area.
 */
function estimateSwaleCapture({ swaleMeters, monthlyMm, slopePercent, soilDrainage, parcelAreaM2 }) {
  if (!swaleMeters || swaleMeters <= 0) {
    return {
      recommended: false,
      swale_meters: 0,
      annual_litres: 0,
      monthly_litres: {},
      note: 'No swales recommended for this parcel.',
    };
  }

  const slope = slopePercent || 5;
  // Vertical interval between swales (metres) — typical 0.3–1.5m
  const verticalIntervalM = Math.max(0.3, Math.min(1.5, slope * 0.08));
  // Upslope catchment per metre of swale (m²/m)
  // catchment_width = vertical_interval / (slope/100)
  const catchmentWidthM = verticalIntervalM / (slope / 100);
  const catchmentPerMetreM2 = catchmentWidthM * 1; // 1m depth of soil strip

  // Runoff coefficient (portion of precip that becomes surface runoff)
  const rc = runoffCoefficient(soilDrainage);

  // Each swale can hold ~0.15 m³ per metre of length (cross-section estimate)
  const swaleCapacityPerMetreLitres = 150; // 0.15 m³ = 150 L

  const monthlyLitres = {};
  let annualLitres = 0;

  for (const [month, mm] of Object.entries(monthlyMm || {})) {
    const precipM = Number(mm || 0) / 1000; // convert mm to m
    // Volume intercepted = catchment_area × precip × runoff_coeff
    // But capped by swale capacity per event (assume 3 major events/month)
    const catchmentM2 = catchmentPerMetreM2 * swaleMeters;
    const runoffLitres = catchmentM2 * precipM * 1000 * rc;
    // Swale can hold this much per storm event
    const swaleCapacity = swaleCapacityPerMetreLitres * swaleMeters;
    // Assume 3 rain events/month; swale drains between events
    const effectiveCapture = Math.min(runoffLitres, swaleCapacity * 3);
    monthlyLitres[month] = Math.round(effectiveCapture);
    annualLitres += effectiveCapture;
  }

  return {
    recommended: true,
    swale_meters: swaleMeters,
    vertical_interval_m: Math.round(verticalIntervalM * 100) / 100,
    catchment_per_metre_m2: Math.round(catchmentPerMetreM2),
    runoff_coefficient: Math.round(rc * 100) / 100,
    annual_litres: Math.round(annualLitres),
    annual_m3: Math.round(annualLitres / 1000),
    monthly_litres: monthlyLitres,
    note: `Each metre of swale intercepts runoff from ~${Math.round(catchmentPerMetreM2)} m² of upslope catchment.`,
  };
}

// ── Pond storage ───────────────────────────────────────────────────────

/**
 * Estimate impoundment volume from pond/earthwork elements.
 * Pond tiers from rate-engine: small (~50 m³), medium (~200 m³), large (~500 m³).
 */
function estimatePondStorage(pondElements, opts) {
  if (!pondElements.length) {
    return {
      recommended: false,
      annual_litres: 0,
      note: 'No ponds or water-harvesting earthworks recommended.',
    };
  }

  // Estimate pond volume from footprint
  const areaHa = (opts.parcel_area_m2 || 10_000) / 10_000;
  const tier = areaHa < 2 ? 'small' : areaHa <= 6 ? 'medium' : 'large';
  const volumeM3 = { small: 50, medium: 200, large: 500 }[tier] || 200;
  const volumeLitres = volumeM3 * 1000;

  // Annual inflow: depends on catchment area feeding the pond
  // Assume pond captures from ~15% of parcel area
  const catchmentM2 = (opts.parcel_area_m2 || 10_000) * 0.15;
  const annualMm = opts.precipitation?.mean_annual_mm || 450;
  const rc = runoffCoefficient(opts.soil?.drainage_class);
  const annualInflowLitres = Math.round(catchmentM2 * (annualMm / 1000) * 1000 * rc);

  return {
    recommended: true,
    tier,
    pond_count: pondElements.length,
    estimated_volume_m3: volumeM3,
    estimated_volume_litres: volumeLitres,
    annual_inflow_litres: annualInflowLitres,
    annual_litres: Math.min(volumeLitres, annualInflowLitres), // effective capture
    note: `${tier} pond (~${volumeM3} m³ capacity) capturing runoff from ~${Math.round(catchmentM2)} m² upslope.`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Runoff coefficient: fraction of rainfall that becomes surface runoff.
 * Sandy/well-drained soils → low; clay/poorly-drained → high.
 */
function runoffCoefficient(drainageClass, wetlands) {
  if (wetlands?.present) return 0.45;
  const map = {
    rapid: 0.15,
    well: 0.25,
    moderately_well: 0.30,
    imperfect: 0.38,
    poor: 0.45,
    very_poor: 0.50,
  };
  return map[drainageClass] || 0.28;
}

function buildMonthlyFromAnnual(annualMm) {
  if (!annualMm || annualMm <= 0) return null;
  // Alberta typical monthly distribution (Edmonton-ish, % of annual)
  const pct = {
    Jan: 0.04, Feb: 0.03, Mar: 0.05, Apr: 0.07, May: 0.11, Jun: 0.17,
    Jul: 0.16, Aug: 0.14, Sep: 0.10, Oct: 0.06, Nov: 0.04, Dec: 0.03,
  };
  const result = {};
  for (const [m, p] of Object.entries(pct)) {
    result[m] = Math.round(annualMm * p);
  }
  return result;
}

function sumValues(obj) {
  return Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0);
}

const WATER_DISCLAIMER =
  'Water collection estimates are planning-level only. Actual yields depend on roof material, gutter design, '
  + 'first-flush diversion, swale construction quality, soil infiltration rates, and evaporation losses. '
  + 'Consult a licensed water-well driller or civil engineer before sizing storage or designing earthworks. '
  + 'Alberta Water Act approvals may be required for ponds and diversions.';