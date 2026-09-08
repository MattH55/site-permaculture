/**
 * Pond catchment water balance — SCS/NRCS Curve Number runoff, direct
 * rainfall, exposure-modulated pan-evaporation loss, and seepage, run
 * through the site's monthly rainfall distribution.
 *
 * This replaces the single "expected water-catch" figure in
 * pond-hydrology.js with a proper sized/validated design check, but
 * deliberately reuses that module's DEM-screened pond siting rather than
 * re-deriving a pour point — see findOptimalPondLocation() there. Pond
 * sizes come from the same POND_HYDROLOGY_TIERS (small/medium/large)
 * everywhere else in the pipeline uses, so results for the three standard
 * tiers are always returned side by side; pass assumed_surface_area_m2 to
 * check one specific candidate size instead.
 *
 * See pond-water-balance-instructions.md for the schema this implements.
 */

import { findOptimalPondLocation, findPondCandidateZones, POND_HYDROLOGY_TIERS } from './pond-hydrology.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// --- SCS/NRCS Curve Numbers, AMC II, "good" hydrologic condition ---------
// Published NRCS TR-55 CN table (Table 2-2a/2-2c), condensed to the three
// land-cover buckets the canopy/structure layers can actually distinguish.
const CURVE_NUMBERS = {
  forest: { A: 30, B: 55, C: 70, D: 77 },
  open: { A: 39, B: 61, C: 74, D: 80 }, // pasture / open / bare soil, good condition
  structure: { A: 98, B: 98, C: 98, D: 98 }, // roofs, pavement — effectively impervious
};

// Texture → NRCS hydrologic soil group (standard mapping; organic/unknown
// falls back through drainage_class in hydrologicSoilGroup()).
const TEXTURE_TO_HSG = {
  sand: 'A',
  loamy_sand: 'A',
  sandy_loam: 'B',
  loam: 'B',
  silt_loam: 'B',
  silt: 'B',
  sandy_clay_loam: 'C',
  clay_loam: 'D',
  silty_clay_loam: 'D',
  sandy_clay: 'D',
  silty_clay: 'D',
  clay: 'D',
  organic: 'D',
};

// Planning-stage seepage rates for an unlined/natural pond bed by texture
// (mm/day), typical of the ranges used in agricultural pond-siting guides.
// These are NOT a substitute for a compaction/permeability test at depth.
const SEEPAGE_MM_DAY = {
  sand: 50,
  loamy_sand: 25,
  sandy_loam: 15,
  loam: 6,
  silt_loam: 4,
  silt: 4,
  sandy_clay_loam: 3,
  clay_loam: 2,
  silty_clay_loam: 1.5,
  sandy_clay: 1.5,
  silty_clay: 1,
  clay: 1,
  organic: 1.5,
};

// Regional pan-evaporation baseline for the Alberta prairie/parkland belt
// (typical free-water-surface evaporation normal, mm/yr), distributed
// across the ice-free season. This is the simplification instructed —
// full Penman needs humidity/temperature this pipeline doesn't fetch yet.
const ANNUAL_PAN_EVAP_MM = 600;
const EVAP_MONTHLY_FRACTION = [0, 0, 0.02, 0.08, 0.16, 0.20, 0.22, 0.18, 0.10, 0.04, 0, 0];

// Regional planning-storm depth used for design-storm peak inflow when no
// site-specific IDF curve is wired in (approx. 24-hr, 1-in-25-year depth
// for central Alberta). Flagged explicitly wherever surfaced.
const DESIGN_STORM_24H_MM = 75;

const BASELINE_WIND_MS = 4; // regional mean 10 m wind speed used to normalize exposure
const BASELINE_INSOLATION_KWH_M2_DAY = 3.8; // regional mean used to normalize exposure

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations (for pond siting)
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {object} opts.precipitation Monthly precipitation (same shape as climate/precipitation.js)
 * @param {number} opts.parcel_area_m2
 * @param {object} [opts.soil_data] getSoilData() result — used for CN soil group + pond-bed seepage
 * @param {object} [opts.canopy] buildCanopyLayer() result — used for land-cover breakdown
 * @param {object} [opts.wind_rose] getWindRose() result — evaporation exposure modulation
 * @param {object} [opts.solar] assessSolar() result — evaporation exposure modulation
 * @param {'lined'|'unlined'} [opts.liner_assumption='unlined']
 * @param {number} [opts.assumed_surface_area_m2] Check one specific size instead of all standard tiers
 * @param {number} [opts.target_use_volume_m3] Irrigation/livestock/fire-reserve demand to size against
 * @param {{lat:number,lon:number}} [opts.pond_point] Override the DEM-screened site
 */
export function modelPondWaterBalance(opts = {}) {
  const placement = opts.pond_point
    ? { available: true, method: 'user-specified point', ...opts.pond_point, catchment_area_m2: opts.catchment_area_m2 || null }
    : findOptimalPondLocation(opts);

  const parcelAreaM2 = Math.max(Number(opts.parcel_area_m2) || 10_000, 1);
  const catchmentAreaM2 = Math.max(
    Number(placement.catchment_area_m2) || parcelAreaM2 * 0.15,
    1
  );

  const monthlyMm = normalizeMonthly(opts.precipitation);
  const linerAssumption = opts.liner_assumption === 'lined' ? 'lined' : 'unlined';

  const landcover = landcoverBreakdown(opts.canopy);
  const hsg = hydrologicSoilGroup(opts.soil_data);
  const effectiveCN = effectiveCurveNumber(landcover, hsg);

  const exposure = evaporationExposureFactor(opts.wind_rose, opts.solar);

  const seepageInfo = seepageAt(opts.soil_data, linerAssumption);

  const weakestSource = weakestConfidence([
    opts.soil_data?.confidence || opts.soil_data?.soil_data_source ? soilConfidence(opts.soil_data) : 'unavailable',
    opts.canopy?.confidence || (opts.canopy?.available === false ? 'unavailable' : 'moderate'),
    monthlyMm ? 'high' : 'unavailable',
  ]);

  const tiersToRun = opts.assumed_surface_area_m2
    ? [{ id: 'custom', label: 'Custom size', surface_area_m2: opts.assumed_surface_area_m2, capacity_m3: null, target_depth_m: null }]
    : POND_HYDROLOGY_TIERS;

  const tiers = tiersToRun.map((tier) =>
    runTierBalance(tier, {
      catchmentAreaM2,
      monthlyMm,
      effectiveCN,
      hsg,
      exposure,
      seepageInfo,
      linerAssumption,
      targetUseVolumeM3: opts.target_use_volume_m3,
    })
  );

  return {
    available: !!placement.available && !!monthlyMm,
    pond_point: placement.available
      ? { lat: placement.lat ?? placement.latitude, lon: placement.lon ?? placement.longitude }
      : null,
    site_selection: placement,
    catchment_area_m2: round0(catchmentAreaM2),
    catchment_landcover_breakdown: landcover,
    hydrologic_soil_group: hsg.group,
    effective_curve_number: effectiveCN,
    liner_assumption: linerAssumption,
    evaporation_exposure_factor: exposure.factor,
    evaporation_exposure_basis: exposure.basis,
    tiers,
    data_source: {
      terrain: 'Sampled DEM low-point/convergence screen (pond-hydrology.js)',
      soil: opts.soil_data?.soil_data_source || null,
      canopy: opts.canopy?.data_source || null,
      rainfall: monthlyMm ? 'NASA POWER monthly precipitation' : null,
    },
    confidence: weakestSource,
    assumptions: [
      `Runoff via SCS/NRCS Curve Number method (AMC II, "good" condition CN table), applied to each month's total precipitation as a single event — a planning-level simplification given monthly (not event-level) rainfall input.`,
      `Evaporation is a regional pan-evaporation baseline (${ANNUAL_PAN_EVAP_MM} mm/yr) modulated by relative wind and solar exposure, not a full Penman calculation.`,
      linerAssumption === 'unlined'
        ? 'Seepage is a planning-stage estimate from surface soil texture at the pond point; real unlined-pond seepage depends on compaction and clay content at depth beyond what a soil survey captures.'
        : 'Lined pond — seepage treated as effectively zero.',
      `Design-storm peak inflow uses a regional planning-storm depth (${DESIGN_STORM_24H_MM} mm/24h, approx. 1-in-25-year), not a site-specific IDF curve.`,
    ],
  };
}

/**
 * Rank a short list of DEM-screened pond candidate points (plus the keyline
 * keypoint, if resolved) by net annual water balance, for the interactive-
 * planning "optimal pond overlay" (interactive-planning-mode-instructions.md)
 * — rather than brute-forcing every point on the parcel, this runs the full
 * water-balance model against the same short candidate list
 * findPondCandidateZones() already narrows the parcel down to.
 *
 * @param {object} opts Same shape as modelPondWaterBalance's opts.
 * @param {{lat:number,lon:number,elevation_m?:number}} [opts.keypoint] The
 *   resolved keyline keypoint (deriveKeylineAndFrost's primary_valleys[0]
 *   .keypoint), included as a candidate tagged source:'keyline_keypoint'.
 * @param {number} [topN=4] How many ranked candidates to return.
 */
export function rankPondCandidateZones(opts = {}, topN = 4) {
  const screened = findPondCandidateZones(opts, { topN: 6 });
  if (!screened.available) {
    return { available: false, reason: screened.reason, candidate_zones: [] };
  }

  const candidates = screened.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    source: c.source,
    lat: c.latitude,
    lon: c.longitude,
    elevation_m: c.elevation_m,
    catchment_area_m2: c.catchment_area_m2,
    site_confidence: c.score,
  }));

  // Fold in the keyline keypoint (the traditional keyline-dam siting spot)
  // as its own candidate, unless it lands on/adjacent to one already found
  // by the convergence screen — the two methods often agree on the same
  // valley low point, and duplicating it as a separate "candidate" would
  // just crowd the ranked list with the same site twice.
  const keypoint = opts.keypoint;
  if (keypoint && Number.isFinite(keypoint.lat) && Number.isFinite(keypoint.lon)) {
    const nearExisting = candidates.some((c) => haversineApproxM(c.lat, c.lon, keypoint.lat, keypoint.lon) < 60);
    if (!nearExisting) {
      candidates.push({
        candidate_id: 'pond-candidate-keyline',
        source: 'keyline_keypoint',
        lat: keypoint.lat,
        lon: keypoint.lon,
        elevation_m: keypoint.elevation_m ?? null,
        catchment_area_m2: null,
        site_confidence: null,
      });
    }
  }

  const evaluated = candidates.map((c) => {
    const result = modelPondWaterBalance({
      ...opts,
      pond_point: { lat: c.lat, lon: c.lon },
      catchment_area_m2: c.catchment_area_m2 || undefined,
    });
    const primaryTier = result.tiers?.[0] || null;
    return {
      ...c,
      available: result.available,
      confidence: result.confidence,
      net_annual_balance_m3: primaryTier?.net_annual_balance_m3 ?? null,
      dry_period_minimum_storage_m3: primaryTier?.dry_period_minimum_storage_m3 ?? null,
      evaluated_tier: primaryTier?.tier_id ?? null,
    };
  }).filter((c) => c.available);

  evaluated.sort((a, b) => (b.net_annual_balance_m3 ?? -Infinity) - (a.net_annual_balance_m3 ?? -Infinity));
  const ranked = evaluated.slice(0, topN);
  ranked.forEach((c, i) => { c.rank = i + 1; });
  if (ranked[0]) ranked[0].top_pick = true;

  return {
    available: ranked.length > 0,
    candidate_zones: ranked,
    evaluated_tier: ranked[0]?.evaluated_tier || (opts.assumed_surface_area_m2 ? 'custom' : 'small'),
    methodology: 'DEM flow-convergence screen (+ keyline keypoint if resolved) narrowed to a short candidate list, each run through the full water-balance model and ranked by net annual balance — not an exhaustive parcel-wide search.',
  };
}

function haversineApproxM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111_320;
  const meanLat = ((lat1 + lat2) / 2) * Math.PI / 180;
  const dLon = (lon2 - lon1) * 111_320 * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

function runTierBalance(tier, ctx) {
  const { catchmentAreaM2, monthlyMm, effectiveCN, exposure, seepageInfo, linerAssumption, targetUseVolumeM3 } = ctx;
  const surfaceAreaM2 = tier.surface_area_m2 || (tier.capacity_m3 && tier.target_depth_m ? tier.capacity_m3 / tier.target_depth_m : 0);
  const capacityM3 = tier.capacity_m3 ?? (surfaceAreaM2 * (tier.target_depth_m || 2));

  let annualRunoffM3 = 0;
  let annualDirectM3 = 0;
  let annualEvapM3 = 0;
  let annualSeepM3 = 0;
  const monthlyRows = [];
  let storageM3 = capacityM3; // start full — used for dry-period drawdown search

  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i];
    const precipMm = monthlyMm?.[month] || 0;
    const days = DAYS_IN_MONTH[i];

    // Runoff depth via the SCS CN equation, applied to the month's total as a single event.
    const runoffMm = scsRunoffMm(precipMm, effectiveCN);
    const runoffM3 = catchmentAreaM2 * (runoffMm / 1000);

    const directM3 = surfaceAreaM2 * (precipMm / 1000);

    const evapMm = ANNUAL_PAN_EVAP_MM * EVAP_MONTHLY_FRACTION[i] * exposure.factor;
    const evapM3 = surfaceAreaM2 * (evapMm / 1000);

    const seepM3 = linerAssumption === 'lined' ? 0 : surfaceAreaM2 * (seepageInfo.rate_mm_day * days / 1000);

    const netM3 = runoffM3 + directM3 - evapM3 - seepM3;
    storageM3 = clamp(storageM3 + netM3, 0, capacityM3);

    monthlyRows.push({
      month,
      precipitation_mm: round1(precipMm),
      catchment_runoff_m3: round1(runoffM3),
      direct_rainfall_m3: round1(directM3),
      evaporation_m3: round1(evapM3),
      seepage_m3: round1(seepM3),
      net_change_m3: round1(netM3),
      modelled_storage_m3: round1(storageM3),
    });

    annualRunoffM3 += runoffM3;
    annualDirectM3 += directM3;
    annualEvapM3 += evapM3;
    annualSeepM3 += seepM3;
  }

  const netAnnualBalanceM3 = annualRunoffM3 + annualDirectM3 - annualEvapM3 - annualSeepM3;

  // Design-storm peak inflow: regional planning-storm depth run through the
  // same CN equation (upper tail of the rainfall distribution, not the mean).
  const designRunoffMm = scsRunoffMm(DESIGN_STORM_24H_MM, effectiveCN);
  const designStormPeakInflowM3 = catchmentAreaM2 * (designRunoffMm / 1000) + surfaceAreaM2 * (DESIGN_STORM_24H_MM / 1000);

  // Dry-period minimum: re-run the same monthly cycle starting from a full
  // pond under a dry-year scenario (60% of normal monthly precipitation,
  // evaporation unchanged) and take the lowest storage reached.
  const dryPeriod = dryPeriodMinimum(monthlyMm, {
    catchmentAreaM2, effectiveCN, surfaceAreaM2, exposure, seepageInfo, linerAssumption, capacityM3,
  });

  const sizing = targetUseVolumeM3
    ? sizingValidation(netAnnualBalanceM3, capacityM3, targetUseVolumeM3)
    : null;

  return {
    tier_id: tier.id,
    label: tier.label,
    assumed_surface_area_m2: round1(surfaceAreaM2),
    capacity_m3: round0(capacityM3),
    target_depth_m: tier.target_depth_m ?? null,
    annual_inflow_m3: {
      catchment_runoff: round0(annualRunoffM3),
      direct_rainfall: round0(annualDirectM3),
    },
    design_storm_peak_inflow_m3: round1(designStormPeakInflowM3),
    annual_evaporation_m3: round0(annualEvapM3),
    annual_seepage_m3: round0(annualSeepM3),
    net_annual_balance_m3: round0(netAnnualBalanceM3),
    dry_period_minimum_storage_m3: round0(dryPeriod.minStorageM3),
    dry_period_minimum_month: dryPeriod.minMonth,
    monthly_level_time_series: monthlyRows,
    sizing_validation: sizing,
  };
}

/** SCS/NRCS CN runoff equation. P and returned depth in mm. */
function scsRunoffMm(precipMm, cn) {
  if (!(precipMm > 0)) return 0;
  const cnClamped = clamp(cn, 30, 98);
  const sMm = (25400 / cnClamped) - 254; // potential maximum retention, mm
  const ia = 0.2 * sMm; // initial abstraction
  if (precipMm <= ia) return 0;
  return Math.pow(precipMm - ia, 2) / (precipMm - ia + sMm);
}

function dryPeriodMinimum(monthlyMm, ctx) {
  const { catchmentAreaM2, effectiveCN, surfaceAreaM2, exposure, seepageInfo, linerAssumption, capacityM3 } = ctx;
  const DRY_YEAR_FACTOR = 0.6;
  let storage = capacityM3;
  let minStorage = storage;
  let minMonth = null;
  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i];
    const precipMm = (monthlyMm?.[month] || 0) * DRY_YEAR_FACTOR;
    const days = DAYS_IN_MONTH[i];
    const runoffM3 = catchmentAreaM2 * (scsRunoffMm(precipMm, effectiveCN) / 1000);
    const directM3 = surfaceAreaM2 * (precipMm / 1000);
    const evapMm = ANNUAL_PAN_EVAP_MM * EVAP_MONTHLY_FRACTION[i] * exposure.factor;
    const evapM3 = surfaceAreaM2 * (evapMm / 1000);
    const seepM3 = linerAssumption === 'lined' ? 0 : surfaceAreaM2 * (seepageInfo.rate_mm_day * days / 1000);
    storage = clamp(storage + runoffM3 + directM3 - evapM3 - seepM3, 0, capacityM3);
    if (storage < minStorage) { minStorage = storage; minMonth = month; }
  }
  return { minStorageM3: minStorage, minMonth };
}

function sizingValidation(netAnnualBalanceM3, capacityM3, targetUseVolumeM3) {
  const margin = netAnnualBalanceM3 - targetUseVolumeM3;
  let flag;
  if (netAnnualBalanceM3 <= 0) flag = 'undersized_no_net_inflow';
  else if (margin < 0) flag = 'undersized';
  else if (margin > targetUseVolumeM3 * 1.5) flag = 'oversized';
  else flag = 'adequate';
  return {
    target_use_volume_m3: round0(targetUseVolumeM3),
    net_annual_balance_m3: round0(netAnnualBalanceM3),
    capacity_m3: round0(capacityM3),
    margin_m3: round0(margin),
    flag,
  };
}

function landcoverBreakdown(canopy) {
  const forestPct = canopy?.available ? clamp(Number(canopy.canopy_cover_pct) || 0, 0, 100) : 0;
  const structurePct = 0; // no structure-footprint layer wired into the catchment yet
  const openPct = clamp(100 - forestPct - structurePct, 0, 100);
  return { forest_pct: round1(forestPct), open_pct: round1(openPct), structure_pct: round1(structurePct) };
}

function hydrologicSoilGroup(soilData) {
  const unit = soilData?.soil_units?.[0];
  const texture = unit?.texture_class;
  if (texture && TEXTURE_TO_HSG[texture]) {
    return { group: TEXTURE_TO_HSG[texture], basis: `texture:${texture}` };
  }
  const drainage = unit?.drainage_class;
  const byDrainage = { rapid: 'A', well: 'B', moderately_well: 'B', imperfect: 'C', poor: 'D', very_poor: 'D' };
  if (drainage && byDrainage[drainage]) return { group: byDrainage[drainage], basis: `drainage_class:${drainage}` };
  return { group: 'B', basis: 'no soil data — defaulted to B (moderate infiltration)' };
}

function effectiveCurveNumber(landcover, hsg) {
  const g = hsg.group;
  const cn =
    (landcover.forest_pct / 100) * CURVE_NUMBERS.forest[g] +
    (landcover.open_pct / 100) * CURVE_NUMBERS.open[g] +
    (landcover.structure_pct / 100) * CURVE_NUMBERS.structure[g];
  return round1(cn);
}

function seepageAt(soilData, linerAssumption) {
  if (linerAssumption === 'lined') return { rate_mm_day: 0, basis: 'lined — assumed effectively zero seepage' };
  const unit = soilData?.soil_units?.[0];
  const texture = unit?.texture_class;
  if (texture && SEEPAGE_MM_DAY[texture] != null) {
    return { rate_mm_day: SEEPAGE_MM_DAY[texture], basis: `texture:${texture} (parcel-level sample, not sampled at the pond bed itself)` };
  }
  return { rate_mm_day: SEEPAGE_MM_DAY.loam, basis: 'no soil texture available — defaulted to loam-equivalent seepage rate' };
}

function soilConfidence(soilData) {
  if (!soilData) return 'unavailable';
  if (soilData.soil_data_source === 'AGRASID') return 'high';
  if (soilData.soil_data_source === 'SOILGRIDS_FALLBACK') return 'moderate_low';
  return 'unavailable';
}

function weakestConfidence(levels) {
  const order = ['unavailable', 'low', 'moderate_low', 'moderate', 'high'];
  let weakest = 'high';
  for (const l of levels) {
    if (!l) continue;
    if (order.indexOf(l) < order.indexOf(weakest)) weakest = l;
  }
  return weakest;
}

function evaporationExposureFactor(windRose, solar) {
  const meanSpeed = windRose?.summary?.mean_speed_ms;
  const insolation = solar?.mean_daily_global_insolation_kwh_m2?.horizontal_0 ?? solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt;
  const windRatio = Number.isFinite(meanSpeed) ? meanSpeed / BASELINE_WIND_MS : 1;
  const solarRatio = Number.isFinite(insolation) ? insolation / BASELINE_INSOLATION_KWH_M2_DAY : 1;
  const factor = clamp(0.7 * windRatio + 0.3 * solarRatio, 0.6, 1.6);
  return {
    factor: round3(factor),
    basis: {
      wind_ratio_to_regional_mean: Number.isFinite(meanSpeed) ? round2(windRatio) : null,
      solar_ratio_to_regional_mean: Number.isFinite(insolation) ? round2(solarRatio) : null,
      note: 'A sheltered/shaded site models lower evaporation than an exposed, sun-baked one of the same size.',
    },
  };
}

function normalizeMonthly(precipitation) {
  const source = precipitation?.monthly_mm || precipitation?.monthly;
  if (source && typeof source === 'object') {
    const out = {};
    for (const month of MONTHS) out[month] = Math.max(0, Number(source[month] || 0));
    return out;
  }
  const annual = Number(precipitation?.mean_annual_mm || precipitation?.annual_precipitation_mm || 0);
  if (!annual) return null;
  const fractions = [0.04, 0.03, 0.05, 0.07, 0.11, 0.17, 0.16, 0.14, 0.10, 0.06, 0.04, 0.03];
  return Object.fromEntries(MONTHS.map((month, i) => [month, annual * fractions[i]]));
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round0(value) { return Math.round(value); }
function round1(value) { return Math.round(value * 10) / 10; }
function round2(value) { return Math.round(value * 100) / 100; }
function round3(value) { return Math.round(value * 1000) / 1000; }
