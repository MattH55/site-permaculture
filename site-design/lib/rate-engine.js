/**
 * Expanding Edge Permaculture — Rate Engine
 * -------------------------------------------------------------
 * Pure calculation module, no DOM/UI dependencies. Turns a set of
 * design_elements (from rules.js) into a rough field-cost estimate.
 *
 * Base figures are derived from the company's 2024 rate sheet,
 * increased ~8% to approximate 2026 pricing. Production-rate
 * assumptions (m/day, m3/day, etc.) are planning-level estimates,
 * not firm quotes — tune RATES / SERVICES below as real job data
 * comes in.
 *
 * Booking/payment (Calendly + PayPal deposit capture) intentionally
 * NOT implemented here yet — this module only goes as far as
 * producing a quote object. Wire those in once the payment
 * processor is live.
 * -------------------------------------------------------------
 */

// ---- Base rates (2024 sheet, +8% to approximate current pricing) ----
export const RATES = {
  designerDay: 1025,
  technicianDay: 600,
  crew1Day: 1600,
  crew2Day: 2150,
  excavatorDay: 2700, // 20-30 tonne, "man & machine" incl. operator
  ctlDay: 1300, // CTL/compact excavator, incl. operator
  mobDemob: 275,
  kmRate: 1.85, // per km, round trip applied
  livingOutDay: 240,
};

// ---- Service definitions ----
// Each calc(size) returns { lines: [{ label, cost, days }], materialsPct }
export const SERVICES = {
  assessment: {
    name: 'Site Assessment & Land Report',
    unit: 'flat',
    min: 1, max: 1, def: 1, step: 1,
    note: 'Flat-rate site walk, public topo/well-record pull, and a written summary report.',
    claimRefs: [],
    calc() {
      return {
        lines: [{ label: 'Permaculture Technician · 1 day', cost: RATES.technicianDay, days: 1 }],
        materialsPct: 0.05,
      };
    },
  },

  swale: {
    name: 'Swale Design & Install',
    unit: 'metres of swale',
    min: 20, max: 2000, def: 200, step: 10,
    note: 'Assumes ~150 m/day excavation (CTL excavator, operator included in rate) plus a matched Crew I day for shaping and berm planting, and a fixed 1-day contour layout visit.',
    claimRefs: ['swale'],
    calc(size) {
      const digDays = Math.max(1, Math.ceil(size / 150));
      return {
        lines: [
          { label: 'Permaculture Designer · 1 day (contour layout)', cost: RATES.designerDay, days: 1 },
          { label: `CTL/Compact Excavator · ${digDays} day(s) (incl. operator)`, cost: RATES.ctlDay * digDays, days: digDays },
          { label: `Permaculture Crew I · ${digDays} day(s) (shaping & berm planting)`, cost: RATES.crew1Day * digDays, days: digDays },
        ],
        materialsPct: 0.10,
      };
    },
  },

  pond: {
    name: 'Pond / Dam Excavation',
    unit: 'cubic metres',
    min: 50, max: 5000, def: 600, step: 50,
    note: 'Assumes ~180 m3/day with a 20-30 tonne excavator; the day rate already includes the operator, so no separate machinery-operator line is added.',
    claimRefs: ['pondCatchment', 'aquaculture'],
    calc(size) {
      const days = Math.max(1, Math.ceil(size / 180));
      return {
        lines: [
          { label: `20-30 Tonne Excavator · ${days} day(s) (incl. operator)`, cost: RATES.excavatorDay * days, days },
        ],
        materialsPct: 0.05,
      };
    },
  },

  shelterbelt: {
    name: 'Shelterbelt / Hedgerow Planting',
    unit: 'metres',
    min: 50, max: 3000, def: 300, step: 25,
    note: 'Assumes ~300 m/day hand-planting pace with Crew I, plus a fixed 1-day species selection visit.',
    claimRefs: ['windbreaks'],
    calc(size) {
      const plantDays = Math.max(1, Math.ceil(size / 300));
      return {
        lines: [
          { label: 'Permaculture Designer · 1 day (species selection)', cost: RATES.designerDay, days: 1 },
          { label: `Permaculture Crew I · ${plantDays} day(s)`, cost: RATES.crew1Day * plantDays, days: plantDays },
        ],
        materialsPct: 0.20,
      };
    },
  },

  foodforest: {
    name: 'Food Forest Guild Planting',
    unit: 'guilds',
    min: 1, max: 30, def: 4, step: 1,
    note: 'Assumes ~4 guilds/day with a full Crew II, plus a fixed 1-day layout visit.',
    claimRefs: ['nitrogenFixers'],
    calc(size) {
      const plantDays = Math.max(1, Math.ceil(size / 4));
      return {
        lines: [
          { label: 'Permaculture Designer · 1 day (guild layout)', cost: RATES.designerDay, days: 1 },
          { label: `Permaculture Crew II · ${plantDays} day(s)`, cost: RATES.crew2Day * plantDays, days: plantDays },
        ],
        materialsPct: 0.20,
      };
    },
  },
};

// ---------------------------------------------------------------
// Marketing claims reference — confidence-rated value language for
// each service. Rule of thumb: high confidence → safe to state a
// specific number; moderate → mechanism + range, never a single
// pinned percentage; low → mechanism/consensus only, no numbers.
// Includes entries for currently-inactive services (well, solar,
// security) so they're ready to wire in if those offerings return.
// ---------------------------------------------------------------
export const CLAIMS = {
  swale: {
    confidence: 'moderate',
    headline: 'Substantially reduces runoff and increases infiltration during normal rainfall events.',
    caveat: 'Effectiveness drops sharply in extreme storms; site-specific to soil, slope, and watershed. Never quote a single pinned percentage without a site-specific study.',
  },
  keylineSubsoiling: {
    confidence: 'low-moderate',
    headline: 'Improves infiltration by decompacting subsoil.',
    caveat: 'Mostly practitioner-reported; avoid stating a specific improvement number.',
  },
  hugelkultur: {
    confidence: 'low on nutrients, moderate on water retention',
    headline: 'Buffers soil moisture over multiple years as buried wood acts as a sponge.',
    caveat: 'No credible nutrient-release numbers exist — sell on water retention only, not fertility. Fresh wood ties up nitrogen for roughly the first season.',
  },
  checkDams: {
    confidence: 'low',
    headline: 'Reduces channel erosion and traps sediment.',
    caveat: 'Magnitude is entirely site- and design-dependent; no general-purpose percentage exists.',
  },
  pondCatchment: {
    confidence: 'high',
    headline: 'Harvestable volume is calculated directly for this property (catchment area × rainfall × runoff coefficient), not estimated generically.',
    caveat: null,
  },
  aquaculture: {
    confidence: 'moderate-high',
    headline: 'Unfed ponds typically yield ~50-100 lbs of trout per surface acre on natural food alone; fed ponds can exceed 1,000 lbs/acre with regular pelleted feed.',
    caveat: 'Present as a range, not a guarantee — local water quality and management heavily affect real results. In an Edmonton-area climate, 4-6 ft minimum depth (ideally below the local frost line) is needed for cold-hardy species to overwinter without active aeration/de-icing.',
  },
  nitrogenFixers: {
    confidence: 'moderate',
    headline: 'Nitrogen-fixing support species build soil fertility over the planting\'s life as roots and leaf litter break down.',
    caveat: 'Rate varies hugely by species, climate, and soil — name the mechanism, don\'t attach a universal number.',
  },
  windbreaks: {
    confidence: 'moderate-high',
    headline: 'Reduces wind speed and evapotranspiration in a zone extending roughly 10x the windbreak\'s height downwind.',
    caveat: null,
  },
  well: {
    confidence: 'high',
    headline: 'Yield (gallons/minute) is measured directly during drilling and quoted from the client\'s actual result.',
    caveat: 'Never state a generic yield estimate before drilling.',
  },
  solarBattery: {
    confidence: 'high',
    headline: 'System size is calculated directly from daily load, panel output, and battery capacity for this property.',
    caveat: null,
  },
  cameras: {
    confidence: 'moderate-high on the academic figure, low on vendor-style stats',
    headline: 'Actively monitored camera systems show a real measured deterrent effect (~15%, rising to ~34% layered with lighting/signage); passive record-only systems show no significant deterrent effect.',
    caveat: 'Never repeat unsourced vendor numbers like "300% safer" or "67% reduction" — sell monitoring capability, not the camera hardware alone. Roughly 15-20% of deterred crime displaces to a neighboring unprotected property.',
  },
  fencing: {
    confidence: 'moderate on mechanism, low on any percentage',
    headline: 'Increases the time, effort, and exposure required for a break-in attempt, rather than adding surveillance/identification risk the way cameras do.',
    caveat: 'Never attach an unsourced percentage. Design specifics matter more than "having a fence": 6+ ft height, solid/reinforced material, open sightlines (opaque fencing can backfire by hiding an intruder once inside), anti-climb features.',
  },
  combinedSecurity: {
    confidence: 'moderate',
    headline: 'Layered security (fencing + cameras + lighting) shows roughly double the deterrent effect (~34%) of monitored cameras alone.',
    caveat: null,
  },
};

/** Look up claim entries by id, returning only what's needed for client-facing copy. */
export function getClaims(claimRefs = []) {
  return claimRefs
    .map((id) => CLAIMS[id])
    .filter(Boolean)
    .map((c) => ({ confidence: c.confidence, headline: c.headline, caveat: c.caveat }));
}

// ---------------------------------------------------------------
// Pond price tiers — fixed sizes with plain-language descriptions.
// The calling app (or a human) picks a tier; each maps to a size
// fed into the existing 'pond' service calc().
// ---------------------------------------------------------------
export const POND_TIERS = [
  {
    id: 'small',
    label: 'Small — Reserve Pond',
    cubicMetres: 150,
    description: 'A seasonal water reserve suited to drip-irrigating roughly 1-2 acres, plus a small wildlife/pollinator habitat feature. Lowest-cost entry point; ~1 excavation day.',
  },
  {
    id: 'medium',
    label: 'Medium — Farm Pond',
    cubicMetres: 600,
    description: 'A general-purpose pond sized for passive irrigation across roughly 3-5 acres, a fire-suppression water reserve, and a more established aquatic/wildlife habitat. The most common install size.',
  },
  {
    id: 'large',
    label: 'Large — Reservoir',
    cubicMetres: 2000,
    description: 'A multi-purpose reservoir supporting irrigation for 10+ acres, livestock watering, a meaningful fire-suppression reserve, and enough volume for basic aquaculture or recreational use.',
  },
];

/** Return the pond tier list with a computed estimate attached to each, given shared opts (km, overnight). */
export function pondTierQuotes(opts = {}) {
  return POND_TIERS.map((tier) => ({
    ...tier,
    estimate: estimate('pond', tier.cubicMetres, opts),
  }));
}

// ---------------------------------------------------------------
// Topography-based swale length estimation.
// Expects topoData shaped like:
//   {
//     avgSlopePercent: number,
//     siteAreaHectares: number,        // optional, for context/logging
//     contourLines: [                  // from the topography file/DEM
//       { elevationM: number, lengthM: number }, ...
//     ],
//     coverageFraction: number         // optional, default 0.6
//   }
// This is a first-pass heuristic, not a substitute for a designer
// walking the contour lines — it exists so the pipeline can produce
// a defensible starting number and a recommend/don't flag before a
// human reviews it.
// ---------------------------------------------------------------
export function recommendSwaleMeters(topoData) {
  const slope = topoData.avgSlopePercent;
  const coverage = topoData.coverageFraction ?? 0.6;

  if (slope == null) {
    return { recommended: false, meters: 0, reasoning: 'No slope data provided — cannot assess swale suitability.' };
  }
  if (slope < 2) {
    return { recommended: false, meters: 0, reasoning: `Average slope ${slope}% is too flat for swales to meaningfully intercept runoff.` };
  }
  if (slope > 20) {
    return { recommended: false, meters: 0, reasoning: `Average slope ${slope}% exceeds the safe threshold for standard swale construction — landslide/blowout risk. Consider check dams or terracing instead.` };
  }

  let verticalIntervalM;
  if (slope < 5) verticalIntervalM = 2.0;
  else if (slope < 10) verticalIntervalM = 1.5;
  else verticalIntervalM = 1.0;

  const lines = Array.isArray(topoData.contourLines) ? topoData.contourLines : [];
  if (lines.length === 0) {
    return { recommended: true, meters: 0, reasoning: 'Slope is within swale range but no contour-line data was supplied — cannot compute meterage. Provide contourLines from the topography file.' };
  }

  const sorted = [...lines].sort((a, b) => a.elevationM - b.elevationM);
  const selected = [];
  let lastElevation = null;
  for (const line of sorted) {
    if (lastElevation === null || (line.elevationM - lastElevation) >= verticalIntervalM) {
      selected.push(line);
      lastElevation = line.elevationM;
    }
  }

  const totalLength = selected.reduce((a, l) => a + l.lengthM, 0);
  const meters = Math.round(totalLength * coverage);

  return {
    recommended: meters > 0,
    meters,
    verticalIntervalM,
    contourLinesUsed: selected.length,
    coverageFraction: coverage,
    reasoning: meters > 0
      ? `Slope ${slope}% supports swales at ~${verticalIntervalM}m vertical spacing; ${selected.length} contour line(s) used, ${coverage * 100}% coverage applied.`
      : 'Contour lines were supplied but summed to zero usable length after filtering.',
  };
}

/**
 * Compute a full estimate for one service.
 * @param {string} serviceId - key from SERVICES
 * @param {number} size - quantity in the service's unit (ignored for 'flat' services)
 * @param {object} [opts]
 * @param {number} [opts.km=0] - one-way travel distance in km; billed round trip
 * @param {boolean} [opts.overnight=false] - whether living-out allowance applies
 * @returns {object} structured estimate, safe to JSON.stringify for another app
 */
export function estimate(serviceId, size, opts = {}) {
  const svc = SERVICES[serviceId];
  if (!svc) throw new Error(`Unknown service id: ${serviceId}`);

  const km = opts.km || 0;
  const overnight = !!opts.overnight;
  const clampedSize = svc.unit === 'flat' ? 1 : Math.min(svc.max, Math.max(svc.min, size));

  const result = svc.calc(clampedSize);
  const totalDays = result.lines.reduce((a, l) => Math.max(a, l.days || 0), 0);
  const labor = result.lines.reduce((a, l) => a + l.cost, 0);
  const materials = labor * result.materialsPct;
  const travel = RATES.mobDemob + km * RATES.kmRate * 2;
  const livingOut = overnight ? RATES.livingOutDay * totalDays : 0;

  const subtotal = labor + materials + travel + livingOut;

  return {
    service: serviceId,
    serviceName: svc.name,
    unit: svc.unit,
    size: clampedSize,
    fieldDays: totalDays,
    lineItems: result.lines.map((l) => ({ label: l.label, cost: Math.round(l.cost) })),
    materialsPct: result.materialsPct,
    materialsCost: Math.round(materials),
    travelCost: Math.round(travel),
    livingOutCost: Math.round(livingOut),
    subtotal: Math.round(subtotal),
    rangeLow: Math.round(subtotal * 0.9),
    rangeHigh: Math.round(subtotal * 1.25),
    valueProps: getClaims(svc.claimRefs),
    currency: 'CAD',
    ratesVersion: '2026-est-v1',
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build a single consolidated quote from a set of already-decided
 * recommendations. The calling app decides WHICH services to
 * include — this function only totals what it's given.
 *
 * @param {Array<{serviceId: string, size: number, opts?: object}>} recommendations
 * @param {object} [quoteOpts]
 * @param {number} [quoteOpts.depositPct=0.15] - fraction of subtotal noted as a deposit (informational — no payment processor wired up yet)
 * @param {string} [quoteOpts.clientName]
 * @param {string} [quoteOpts.propertyLabel]
 * @returns {object} consolidated quote
 */
export function buildQuote(recommendations, quoteOpts = {}) {
  const depositPct = quoteOpts.depositPct ?? 0.15;
  const items = recommendations.map((r) => estimate(r.serviceId, r.size, r.opts || {}));

  const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
  const rangeLow = items.reduce((a, i) => a + i.rangeLow, 0);
  const rangeHigh = items.reduce((a, i) => a + i.rangeHigh, 0);
  const totalFieldDays = items.reduce((a, i) => a + i.fieldDays, 0);
  const depositAmount = Math.round(subtotal * depositPct);

  return {
    quoteId: `EEP-${Date.now()}`,
    clientName: quoteOpts.clientName || null,
    propertyLabel: quoteOpts.propertyLabel || null,
    items,
    itemCount: items.length,
    totalFieldDays,
    subtotal: Math.round(subtotal),
    rangeLow: Math.round(rangeLow),
    rangeHigh: Math.round(rangeHigh),
    depositPct,
    depositAmount,
    balanceDueOnCompletion: Math.round(subtotal - depositAmount),
    currency: 'CAD',
    ratesVersion: '2026-est-v1',
    generatedAt: new Date().toISOString(),
  };
}

/** List available service ids with basic metadata — useful for building a picker elsewhere. */
export function listServices() {
  return Object.entries(SERVICES).map(([id, s]) => ({
    id, name: s.name, unit: s.unit, min: s.min, max: s.max, def: s.def, step: s.step, note: s.note,
  }));
}
