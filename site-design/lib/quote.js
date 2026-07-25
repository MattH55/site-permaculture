/**
 * Turns rules.js's design_elements into a rough field-cost quote via
 * rate-engine.js. This is Steps 1–3A of the rate-engine integration
 * guide (topo → swale meterage, pond tiers, consolidated quote).
 *
 * Steps 3B–D (PayPal deposit capture, Calendly booking unlock) are
 * deliberately NOT implemented — no payment processor is live yet.
 * This module only ever produces a planning-level quote object.
 */

import { haversineKm } from './proximity.js';
import { POND_TIERS, recommendSwaleMeters, buildQuote } from './rate-engine.js';

// Company base for round-trip travel pricing (Stony Plain, AB).
const BASE = { lat: 53.5264, lng: -114.0069 };

/**
 * @param {object} opts
 * @param {object[]} opts.design_elements — from rules.js applyRules()
 * @param {number|null} opts.footprint_ha
 * @param {number|null} opts.slope_percent
 * @param {{elevationM:number, lengthM:number}[]} opts.contourLines
 * @param {{latitude:number, longitude:number}} opts.siteCentre
 * @param {string} [opts.propertyLabel]
 * @returns {object|null} consolidated quote, or null if no priced elements apply
 */
export function buildServiceQuote(opts = {}) {
  const {
    design_elements = [],
    footprint_ha = null,
    slope_percent = null,
    contourLines = [],
    siteCentre,
    propertyLabel,
  } = opts;

  const elementTypes = new Set(design_elements.map((e) => e.element_type));
  const km = siteCentre
    ? haversineKm(BASE.lat, BASE.lng, siteCentre.latitude, siteCentre.longitude)
    : null;
  const travelOpts = { km: km != null ? Math.round(km) : 40 };

  const recommendations = [
    { serviceId: 'assessment', size: 1, opts: travelOpts },
  ];

  // Swale — only quote if a real (non-wetland-blocked) swale element fired,
  // AND the rate-engine's own slope/contour check independently agrees.
  let swaleAnalysis = null;
  const swaleEl = design_elements.find((e) => e.element_type === 'swale');
  const swaleWetlandBlocked = /wetland_class/i.test(swaleEl?.condition_basis || '');
  if (swaleEl && !swaleWetlandBlocked) {
    swaleAnalysis = recommendSwaleMeters({
      avgSlopePercent: slope_percent,
      siteAreaHectares: footprint_ha,
      contourLines,
      coverageFraction: 0.6,
    });
    if (swaleAnalysis.recommended && swaleAnalysis.meters > 0) {
      recommendations.push({ serviceId: 'swale', size: swaleAnalysis.meters, opts: travelOpts });
    }
  }

  // Pond — tier chosen from parcel size; same physical dig covers
  // 'water_harvesting_earthwork' so it isn't priced as a second line.
  let pondTierId = null;
  if (elementTypes.has('pond') || elementTypes.has('water_harvesting_earthwork')) {
    pondTierId = footprint_ha == null ? 'medium' : footprint_ha < 2 ? 'small' : footprint_ha <= 6 ? 'medium' : 'large';
    const tier = POND_TIERS.find((t) => t.id === pondTierId);
    recommendations.push({ serviceId: 'pond', size: tier.cubicMetres, opts: travelOpts });
  }

  // Shelterbelt / windbreak — meterage from one exposed edge of the parcel.
  let shelterbeltMetersBasis = null;
  if (elementTypes.has('windbreak') || elementTypes.has('shelterbelt_zone')) {
    shelterbeltMetersBasis = estimateShelterbeltMeters(footprint_ha);
    recommendations.push({ serviceId: 'shelterbelt', size: shelterbeltMetersBasis, opts: travelOpts });
  }

  // Food forest guilds — planning-level density per hectare.
  let guildCountBasis = null;
  if (elementTypes.has('food_forest_guild')) {
    guildCountBasis = estimateGuildCount(footprint_ha);
    recommendations.push({ serviceId: 'foodforest', size: guildCountBasis, opts: travelOpts });
  }

  const quote = buildQuote(recommendations, { depositPct: 0.15, propertyLabel });

  return {
    ...quote,
    swale_analysis: swaleAnalysis,
    sizing_basis: {
      travel_km_one_way: travelOpts.km,
      pond_tier: pondTierId,
      shelterbelt_meters_basis: shelterbeltMetersBasis,
      food_forest_guilds_basis: guildCountBasis,
    },
    booking_available: false,
    disclaimer:
      'Planning-level cost estimate only, built from 2024 published day rates and rough production-rate assumptions — not a firm quote. Final scope, site conditions, and materials are always confirmed on a site walk before quoting. Online booking and deposit payment are not available yet — call or email to move forward.',
  };
}

function estimateShelterbeltMeters(footprint_ha) {
  if (footprint_ha == null) return 300;
  // One exposed windward edge of a roughly square parcel.
  const sideM = Math.sqrt(footprint_ha * 10_000);
  return Math.round(clamp(sideM, 50, 3000));
}

function estimateGuildCount(footprint_ha) {
  if (footprint_ha == null) return 4;
  // ~3 guilds per hectare of usable Zone 2 planting area, planning-level.
  return Math.round(clamp(footprint_ha * 3, 1, 30));
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
