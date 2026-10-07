/**
 * Pond precipitation-scenario engine — "will this pond still hold water in a
 * drought, and how much can I safely draw from it?"
 *
 * modelPondWaterBalance() answers one question: the net balance of an average
 * year. Landowners need the other ones — a dry year, a 1-in-25 drought, the
 * multi-year droughts that actually empty prairie ponds (2000–2002, 2021 in
 * Alberta), and a wet year's spill — plus how much water each pond size can
 * supply to livestock or a garden through those years. This module runs the
 * same runoff/evaporation/seepage physics (shared from pond-water-balance.js
 * via _pondBalanceInternals) month by month across 3-year scenario sequences.
 *
 * One deliberate physics addition over the annual model: SNOWPACK. On the
 * prairies most pond/dugout recharge is spring snowmelt running off frozen
 * ground, not summer rain — summer storms mostly soak into thawed soil.
 * Treating winter precipitation as same-month rain (as the annual model does)
 * misplaces the fill in time and understates the spring pulse. Here,
 * precipitation in sub-zero months accumulates as snow water equivalent
 * (minus a sublimation/wind-redistribution loss) and melts across the first
 * thawing months, running off at frozen-ground coefficients.
 *
 * Every assumption is listed in the output's `assumptions` array.
 */

import { _pondBalanceInternals as I } from './pond-water-balance.js';
import { findOptimalPondLocation, POND_HYDROLOGY_TIERS } from './pond-hydrology.js';

const { MONTHS, DAYS_IN_MONTH, ANNUAL_PAN_EVAP_MM, EVAP_MONTHLY_FRACTION } = I;

/**
 * Scenario definitions — per-year precipitation multipliers on the site's own
 * monthly normals, plus an evaporation multiplier (dry years are hotter and
 * sunnier, so open-water evaporation rises while inflow falls — the two
 * compound, which is why droughts empty ponds faster than rainfall alone
 * suggests). Return-period labels are planning approximations for central
 * Alberta annual precipitation variability (CV ~20–25%), not a site-specific
 * frequency analysis.
 */
export const PRECIP_SCENARIOS = Object.freeze([
  { id: 'normal', label: 'Normal years', years: [1.0, 1.0, 1.0], evap_factor: 1.0,
    description: "Three average years at the site's monthly precipitation normals." },
  { id: 'wet', label: 'Wet years', years: [1.3, 1.3, 1.3], evap_factor: 0.9,
    description: 'Three years at ~130% of normal — tests overflow/spillway capacity.' },
  { id: 'dry_year', label: 'Dry year (~1-in-10)', years: [1.0, 0.7, 1.0], evap_factor: 1.1,
    description: 'One ~70%-of-normal year between two normal years.' },
  { id: 'severe_drought', label: 'Severe drought (~1-in-25)', years: [1.0, 0.55, 1.0], evap_factor: 1.2,
    description: 'One ~55%-of-normal year — the kind that empties shallow dugouts.' },
  { id: 'multi_year_drought', label: 'Multi-year drought', years: [0.7, 0.6, 0.75], evap_factor: 1.15,
    description: 'Three consecutive dry years (cf. Alberta 2000–2002) — the real test of storage.' },
]);

const SCENARIO_YEARS = 3;

/** Fallback snow months for central Alberta when no temperature data. */
const DEFAULT_SNOW_MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
/**
 * A month accumulates snow only if its mean is clearly below freezing.
 * Near-zero means (e.g. a -0.2 °C April from reanalysis data) are melt
 * months on the prairies — daytime highs well above zero drive the melt.
 */
const SNOW_MONTH_MAX_MEAN_C = -1;

/**
 * Pond-bed seepage when no usable soil texture is known. A dug pond's bed
 * sits 1.5–2.5 m down; across the Alberta parkland that is overwhelmingly
 * clay-loam glacial till (the reason dugouts are the standard farm water
 * source there), not the loam topsoil default the annual model falls back
 * to. Planning value for clay loam (pond-water-balance.js SEEPAGE_MM_DAY).
 */
const UNKNOWN_SOIL_POND_BED = { rate_mm_day: 2, texture: 'clay_loam' };
/** Snow lost to sublimation and wind redistribution before melt (prairie typical 20–40%). */
const SNOW_SUBLIMATION_LOSS = 0.3;
/** Fraction of the snowpack that melts in the first thaw month; the rest the next. */
const MELT_FIRST_MONTH_FRACTION = 0.6;
/**
 * Snowmelt runoff coefficients on frozen ground, by landcover. Frozen soil
 * infiltrates little, so melt runs off far more efficiently than summer rain
 * on the same land; forest holds snow and melts it slowly into thawing soil.
 */
const MELT_RUNOFF_COEFF = { open: 0.35, forest: 0.15, structure: 0.9 };

const CATTLE_L_PER_HEAD_DAY = 45; // beef cow, year-round average incl. winter
const GARDEN_IRRIGATION_MM_PER_WEEK = 25; // ~1 inch/week vegetable guideline
const GARDEN_MONTH_FACTOR = { May: 0.5, Jun: 1, Jul: 1, Aug: 1, Sep: 0.5 };
const GROWING_SEASON = ['May', 'Jun', 'Jul', 'Aug', 'Sep'];

/**
 * Rain days (>= 1 mm) per thawed month, approximate central-Alberta normals.
 * The annual model applies the Curve Number equation to each month's total
 * as ONE storm, which badly overstates summer runoff: a 76 mm June usually
 * arrives as ~12 small events, most below the initial abstraction, plus one
 * or two real storms. Here each month is split into one large event (a fixed
 * share of the total) and equal small events, and CN runoff is summed per
 * event — so most summer rain soaks in and snowmelt dominates recharge, as
 * observed in prairie hydrology.
 */
const RAIN_DAYS = { Mar: 4, Apr: 6, May: 9, Jun: 12, Jul: 12, Aug: 10, Sep: 8, Oct: 6, Nov: 4 };
const LARGEST_EVENT_SHARE = 0.35;

function eventRunoffMm(precipMm, cn, month) {
  if (!(precipMm > 0)) return 0;
  const n = Math.max(1, RAIN_DAYS[month] || 5);
  if (n === 1) return I.scsRunoffMm(precipMm, cn);
  const big = precipMm * LARGEST_EVENT_SHARE;
  const small = (precipMm - big) / (n - 1);
  return I.scsRunoffMm(big, cn) + (n - 1) * I.scsRunoffMm(small, cn);
}

/**
 * @param {object} opts Same shape as modelPondWaterBalance's opts, plus:
 * @param {object} [opts.temperature] assessTemperature() result — monthly
 *   avg_mean decides which months accumulate snow
 * @param {object} [opts.soil_profile] soil-profile.js result — the 30 cm+
 *   subsoil texture, when known, is a better proxy for the pond bed than
 *   surface texture
 * @param {{cattle_head?:number, garden_m2?:number}} [opts.demand] optional
 *   withdrawal to test reliability against
 * @param {number} [opts.start_fill_fraction] storage at the start of the
 *   spin-up year (default 0.5). A one-year normal spin-up runs first, so each
 *   scenario starts from a realistic level rather than an assumed-full pond.
 */
export function modelPondScenarios(opts = {}) {
  const placement = opts.pond_point
    ? { available: true, method: 'user-specified point', ...opts.pond_point, catchment_area_m2: opts.catchment_area_m2 || null }
    : findOptimalPondLocation(opts);

  const monthlyMm = I.normalizeMonthly(opts.precipitation);
  if (!monthlyMm) {
    return { available: false, reason: 'No monthly precipitation normals for this site.' };
  }

  const parcelAreaM2 = Math.max(Number(opts.parcel_area_m2) || 10_000, 1);
  const catchmentAreaM2 = Math.max(Number(placement.catchment_area_m2) || parcelAreaM2 * 0.15, 1);
  const linerAssumption = opts.liner_assumption === 'lined' ? 'lined' : 'unlined';
  const landcover = I.landcoverBreakdown(opts.canopy);
  const hsg = I.hydrologicSoilGroup(opts.soil_data);
  const cn = I.effectiveCurveNumber(landcover, hsg);
  const exposure = I.evaporationExposureFactor(opts.wind_rose, opts.solar);
  const seepage = pondBedSeepage(opts, linerAssumption);
  const snow = snowMonths(opts.temperature);
  const meltCoeff = (landcover.open_pct * MELT_RUNOFF_COEFF.open
    + landcover.forest_pct * MELT_RUNOFF_COEFF.forest
    + landcover.structure_pct * MELT_RUNOFF_COEFF.structure) / 100;

  const physics = { monthlyMm, catchmentAreaM2, cn, exposure, seepage, linerAssumption, snow, meltCoeff };
  const demand = demandProfile(opts.demand);
  const startFill = clamp(Number(opts.start_fill_fraction ?? 0.5), 0, 1);

  const tiers = POND_HYDROLOGY_TIERS.map((tier) => {
    const surfaceAreaM2 = tier.capacity_m3 / tier.target_depth_m;
    const geom = { capacityM3: tier.capacity_m3, surfaceAreaM2 };
    const scenarios = PRECIP_SCENARIOS.map((sc) => {
      const run = simulate(sc, geom, physics, demand, startFill);
      const growDraw = maxDraw(sc, geom, physics, startFill, GROWING_SEASON);
      const yearDraw = maxDraw(sc, geom, physics, startFill, MONTHS);
      return {
        scenario_id: sc.id,
        label: sc.label,
        ...run.summary,
        sustainable_growing_season_draw_m3_per_month: round1(growDraw),
        sustainable_year_round_draw_m3_per_month: round1(yearDraw),
        irrigable_garden_m2: round0(growDraw / ((GARDEN_IRRIGATION_MM_PER_WEEK / 1000) * (30.4 / 7))),
        supportable_cattle_head: Math.floor(yearDraw / ((CATTLE_L_PER_HEAD_DAY / 1000) * 30.4)),
        monthly: run.monthly,
      };
    });
    const drought = scenarios.find((s) => s.scenario_id === 'multi_year_drought');
    // What a liner / compacted clay bottom buys on the hardest scenario.
    let ifLined = null;
    if (linerAssumption === 'unlined' && seepage.rate_mm_day > 0) {
      const sc = PRECIP_SCENARIOS.find((x) => x.id === 'multi_year_drought');
      const lp = { ...physics, linerAssumption: 'lined', seepage: { rate_mm_day: 0 } };
      const run = simulate(sc, geom, lp, demand, startFill);
      ifLined = {
        scenario_id: 'multi_year_drought',
        months_empty: run.summary.months_empty,
        min_storage_pct: run.summary.min_storage_pct,
        sustainable_growing_season_draw_m3_per_month: round1(maxDraw(sc, geom, lp, startFill, GROWING_SEASON)),
      };
    }
    return {
      tier_id: tier.id,
      label: tier.label,
      capacity_m3: tier.capacity_m3,
      target_depth_m: tier.target_depth_m,
      surface_area_m2: round0(surfaceAreaM2),
      scenarios,
      drought_resilient: drought ? drought.months_empty === 0 : false,
      annual_seepage_m3: round0(surfaceAreaM2 * seepage.rate_mm_day * 365 / 1000),
      if_lined: ifLined,
    };
  });

  return {
    available: !!placement.available,
    pond_point: placement.available
      ? { lat: placement.lat ?? placement.latitude, lon: placement.lon ?? placement.longitude }
      : null,
    catchment_area_m2: round0(catchmentAreaM2),
    effective_curve_number: cn,
    hydrologic_soil_group: hsg.group,
    seepage_mm_day: seepage.rate_mm_day,
    seepage_basis: seepage.basis,
    snowmelt_runoff_coefficient: round2(meltCoeff),
    snow_months: [...snow.set],
    snow_months_basis: snow.basis,
    demand_tested: demand.description,
    scenarios: PRECIP_SCENARIOS.map(({ id, label, description, years, evap_factor }) => ({
      id, label, description, precipitation_multipliers: years, evaporation_multiplier: evap_factor,
    })),
    tiers,
    recommendation: recommendTier(tiers),
    confidence: I.weakestConfidence([
      opts.soil_data ? I.soilConfidence(opts.soil_data) : 'unavailable',
      opts.canopy?.available === false ? 'unavailable' : 'moderate',
      opts.temperature?.available ? 'moderate' : 'moderate_low',
    ]),
    assumptions: [
      'Each scenario is 3 years, run after a 1-year normal spin-up so it starts from a realistic storage level rather than an assumed-full pond.',
      `Precipitation in months averaging below 0 °C (${snow.basis}) accumulates as snowpack, loses ${Math.round(SNOW_SUBLIMATION_LOSS * 100)}% to sublimation/wind redistribution, and melts ${Math.round(MELT_FIRST_MONTH_FRACTION * 100)}/${Math.round((1 - MELT_FIRST_MONTH_FRACTION) * 100)} over the first two thaw months.`,
      `Snowmelt runs off frozen ground at a landcover-weighted coefficient (open ${MELT_RUNOFF_COEFF.open}, forest ${MELT_RUNOFF_COEFF.forest}, roofs/pavement ${MELT_RUNOFF_COEFF.structure}); rain uses the SCS Curve Number method (CN ${cn}) applied per rain event — each month split into one large storm (${Math.round(LARGEST_EVENT_SHARE * 100)}% of the total) plus typical small rain days — rather than to the monthly total as one storm, which overstates summer runoff.`,
      "Scenario precipitation multipliers and return periods are planning approximations of central-Alberta year-to-year variability, not a frequency analysis of this site's record.",
      'Dry years also raise open-water evaporation (per-scenario evaporation multiplier) — hotter, sunnier summers compound the inflow shortfall.',
      `Sustainable draw = the largest constant monthly withdrawal that never empties the pond across the 3 scenario years. Garden area assumes ${GARDEN_IRRIGATION_MM_PER_WEEK} mm/week irrigation Jun–Aug (half in May/Sep); cattle assume ${CATTLE_L_PER_HEAD_DAY} L/head/day year-round.`,
      `Pond-bed seepage ${seepage.rate_mm_day} mm/day (${seepage.basis}). Seepage is the most uncertain input and often decides whether a pond holds water — dig a test hole to pond depth before committing.`,
      'Ice cover, livestock-access losses, and water-quality limits (algae, salinity) are not modelled — keep a reserve.',
    ],
  };
}

function snowMonths(temperature) {
  const monthly = temperature?.monthly;
  if (Array.isArray(monthly) && monthly.some((m) => Number.isFinite(m?.avg_mean))) {
    const set = new Set(monthly.filter((m) => Number.isFinite(m.avg_mean) && m.avg_mean < SNOW_MONTH_MAX_MEAN_C).map((m) => m.month));
    return { set, basis: `site monthly mean temperatures below ${SNOW_MONTH_MAX_MEAN_C} °C` };
  }
  return { set: new Set(DEFAULT_SNOW_MONTHS), basis: 'central-Alberta default Nov–Mar (no site temperature data)' };
}

/**
 * Seepage at the pond bed: subsoil (30 cm+) texture when known, then the
 * surface soil-unit texture, then a glacial-till default — never the
 * annual model's loam fallback, which describes topsoil, not a pond bed.
 */
function pondBedSeepage(opts, linerAssumption) {
  if (linerAssumption === 'lined') return { rate_mm_day: 0, basis: 'lined — effectively zero seepage' };
  const subsoil = opts.soil_profile?.subsoil_30cm_plus?.texture;
  if (subsoil) {
    const viaSub = I.seepageAt({ soil_units: [{ texture_class: subsoil }] }, 'unlined');
    if (!/^no soil texture/.test(viaSub.basis)) {
      return { rate_mm_day: viaSub.rate_mm_day, basis: `subsoil (30 cm+) texture: ${subsoil}` };
    }
  }
  const surface = I.seepageAt(opts.soil_data, 'unlined');
  if (!/^no soil texture/.test(surface.basis)) return surface;
  return {
    rate_mm_day: UNKNOWN_SOIL_POND_BED.rate_mm_day,
    basis: 'no soil texture for this parcel — assumed central-Alberta glacial till (clay loam) at pond-bed depth',
  };
}

function demandProfile(demand) {
  const head = Math.max(0, Number(demand?.cattle_head) || 0);
  const gardenM2 = Math.max(0, Number(demand?.garden_m2) || 0);
  const monthly = {};
  for (let i = 0; i < 12; i++) {
    const m = MONTHS[i];
    const cattle = head * (CATTLE_L_PER_HEAD_DAY / 1000) * DAYS_IN_MONTH[i];
    const garden = gardenM2 * (GARDEN_IRRIGATION_MM_PER_WEEK / 1000) * (DAYS_IN_MONTH[i] / 7) * (GARDEN_MONTH_FACTOR[m] || 0);
    monthly[m] = cattle + garden;
  }
  const parts = [];
  if (head) parts.push(`${head} cattle`);
  if (gardenM2) parts.push(`${gardenM2} m² irrigated garden`);
  return { monthly, description: parts.length ? parts.join(' + ') : 'none (storage only)' };
}

/**
 * Month-by-month storage simulation: 1 normal spin-up year, then the
 * scenario's years. `draw` (optional) replaces demand with a constant
 * withdrawal over the given months — used by maxDraw().
 */
function simulate(sc, geom, p, demand, startFill, draw = null) {
  const { capacityM3, surfaceAreaM2 } = geom;
  let storage = capacityM3 * startFill;
  let snowpackMm = 0;
  let thawCount = 0;
  const yearFactors = [1.0, ...sc.years];
  const rows = [];
  let demandTotal = 0;
  let demandMet = 0;
  let spillTotal = 0;
  let monthsEmpty = 0;
  let monthsLow = 0;
  let minStorage = Infinity;
  let minLabel = null;

  for (let y = 0; y < yearFactors.length; y++) {
    const spinUp = y === 0;
    const pf = yearFactors[y];
    const ef = spinUp ? 1 : sc.evap_factor;
    for (let i = 0; i < 12; i++) {
      const m = MONTHS[i];
      const precipMm = (p.monthlyMm[m] || 0) * pf;
      let inflowM3 = 0;
      if (p.snow.set.has(m)) {
        // Snow accumulates on the catchment and on the frozen pond itself.
        snowpackMm += precipMm * (1 - SNOW_SUBLIMATION_LOSS);
        thawCount = 0;
      } else {
        let meltMm = 0;
        if (snowpackMm > 0) {
          meltMm = thawCount === 0 ? snowpackMm * MELT_FIRST_MONTH_FRACTION : snowpackMm;
          snowpackMm -= meltMm;
        }
        thawCount++;
        const runoffMm = eventRunoffMm(precipMm, p.cn, m) + meltMm * p.meltCoeff;
        inflowM3 = p.catchmentAreaM2 * runoffMm / 1000 + surfaceAreaM2 * (precipMm + meltMm) / 1000;
      }
      const evapM3 = surfaceAreaM2 * (ANNUAL_PAN_EVAP_MM * EVAP_MONTHLY_FRACTION[i] * p.exposure.factor * ef) / 1000;
      const seepM3 = p.linerAssumption === 'lined' ? 0 : surfaceAreaM2 * (p.seepage.rate_mm_day * DAYS_IN_MONTH[i]) / 1000;

      const want = draw ? (draw.months.includes(m) ? draw.m3 : 0) : demand.monthly[m];
      let s = storage + inflowM3 - evapM3 - seepM3;
      const spill = Math.max(0, s - capacityM3);
      s = Math.min(s, capacityM3);
      const met = Math.min(want, Math.max(0, s));
      storage = Math.max(0, s - met);

      if (spinUp) continue;
      demandTotal += want;
      demandMet += met;
      spillTotal += spill;
      if (storage <= capacityM3 * 0.01) monthsEmpty++;
      if (storage < capacityM3 * 0.25) monthsLow++;
      if (storage < minStorage) { minStorage = storage; minLabel = `Year ${y} ${m}`; }
      if (!draw) {
        rows.push({
          year: y,
          month: m,
          precipitation_mm: round1(precipMm),
          inflow_m3: round1(inflowM3),
          losses_m3: round1(evapM3 + seepM3),
          withdrawal_m3: round1(met),
          shortfall_m3: round1(want - met),
          spill_m3: round1(spill),
          storage_m3: round1(storage),
          pct_full: Math.round((storage / capacityM3) * 100),
        });
      }
    }
  }
  const totalMonths = SCENARIO_YEARS * 12;
  return {
    neverEmpty: monthsEmpty === 0,
    summary: {
      min_storage_m3: round0(minStorage),
      min_storage_pct: Math.round((minStorage / capacityM3) * 100),
      min_storage_when: minLabel,
      months_empty: monthsEmpty,
      months_below_quarter_full: monthsLow,
      pct_months_above_quarter_full: Math.round(((totalMonths - monthsLow) / totalMonths) * 100),
      end_storage_m3: round0(storage),
      total_spill_m3: round0(spillTotal),
      demand_reliability_pct: demandTotal > 0 ? Math.round((demandMet / demandTotal) * 100) : null,
    },
    monthly: rows,
  };
}

/** Largest constant monthly draw (over `months`) that never empties the pond. Bisection. */
function maxDraw(sc, geom, p, startFill, months) {
  if (!simulate(sc, geom, p, null, startFill, { m3: 0, months }).neverEmpty) return 0;
  let lo = 0;
  let hi = geom.capacityM3;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (simulate(sc, geom, p, null, startFill, { m3: mid, months }).neverEmpty) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Smallest tier that never runs dry in the multi-year drought; if none do,
 * the tier that holds out longest — and say so plainly.
 */
function recommendTier(tiers) {
  const drought = (t) => t.scenarios.find((s) => s.scenario_id === 'multi_year_drought');
  const resilient = tiers.filter((t) => t.drought_resilient);
  if (resilient.length) {
    const t = resilient[0];
    return {
      tier_id: t.tier_id,
      drought_resilient: true,
      reason: `${t.label} (${t.capacity_m3} m³) is the smallest standard size that keeps water through a 3-year drought on this catchment, still supplying ~${drought(t).sustainable_growing_season_draw_m3_per_month} m³/month in the growing season.`,
    };
  }
  const best = [...tiers].sort((a, b) => drought(b).min_storage_pct - drought(a).min_storage_pct
    || drought(a).months_empty - drought(b).months_empty)[0];
  return {
    tier_id: best?.tier_id || null,
    drought_resilient: false,
    reason: best
      ? `No standard size stays wet through a 3-year drought on this catchment — ${best.label} holds out longest. Options: dig deeper (less evaporating surface per m³), line the pond, or enlarge the catchment with a diversion swale.`
      : 'No pond tiers evaluated.',
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function round0(v) { return Math.round(v); }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
