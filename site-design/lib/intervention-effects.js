/**
 * Land Intelligence — Intervention Effects Registry
 *
 * Defines how each design intervention (swale, pond, foodforest, shelterbelt)
 * affects the 6 fecundity levers. Every effect is a *delta* on the baseline
 * score (0–100 scale). Physical proxies and cost models are included so the
 * value-estimation engine can translate score changes into real-world outcomes.
 *
 * All coefficients are version-stamped so the report can show
 * "estimated with 2026 coefficients".
 */

export const COEFFICIENT_VERSION = '2026.1';

/**
 * Each intervention:
 *   id          – matches serviceId in fecundity-report / rules.js
 *   label       – human-readable name
 *   affects[]   – lever deltas (min..max range for low/mid/high scenarios)
 *   physical    – measurable physical proxies
 *   cost        – rough cost model (CAD) for planning-level quotes
 *   timeToEffect – years until full lever delta is realized
 */
export const INTERVENTIONS = {
  swale: {
    id: 'swale',
    label: 'Swale / contour trench',
    affects: [
      { lever: 'water',             deltaMin: 12, deltaMax: 25, confidence: 'high' },
      { lever: 'soilStructure',     deltaMin: 2,  deltaMax: 8,  confidence: 'moderate' },
      { lever: 'microclimate',      deltaMin: 2,  deltaMax: 6,  confidence: 'low-moderate' },
      { lever: 'soilBiology',       deltaMin: 1,  deltaMax: 4,  confidence: 'low' },
    ],
    physical: {
      runoffReductionPct:        { min: 30, max: 60 },
      infiltrationVolume_m3_ha:  { min: 80, max: 250 },
      soilLossReduction_t_ha_yr: { min: 2,  max: 8 },
      groundwaterRechargeHint:   true,
    },
    cost: {
      earthworksPerM:    { min: 12, max: 25 },  // $/linear meter of swale
      surveyPerHa:       { min: 200, max: 400 },
      typicalLength_m:   { min: 80, max: 300 },  // depends on slope + area
      note: 'Includes excavation, spoil shaping, seed/mulch on berm. Excludes rock/armour.',
    },
    timeToEffect: { partial: 1, full: 3 },
  },

  pond: {
    id: 'pond',
    label: 'Retention pond / dugout',
    affects: [
      { lever: 'water',             deltaMin: 10, deltaMax: 20, confidence: 'high' },
      { lever: 'microclimate',      deltaMin: 5,  deltaMax: 12, confidence: 'moderate' },
      { lever: 'faunaIntegration',  deltaMin: 5,  deltaMax: 15, confidence: 'moderate' },
      { lever: 'soilBiology',       deltaMin: 2,  deltaMax: 6,  confidence: 'low-moderate' },
    ],
    physical: {
      waterStorage_m3:           { min: 200, max: 2000 },
      humidityBoostPct:          { min: 3, max: 10 },
      pollinatorHabitatGain_m2:  { min: 500, max: 3000 },
      frostBufferRadius_m:       { min: 30, max: 80 },
    },
    cost: {
      excavationPerM3:     { min: 3, max: 8 },
      linerPerM2:          { min: 8, max: 18 },  // if clay seal insufficient
      typicalVolume_m3:    { min: 200, max: 1500 },
      note: 'Excavation + shaping + inlet/outlet. Liner only if soil is sandy/gravelly.',
    },
    timeToEffect: { partial: 0, full: 1 },
  },

  foodforest: {
    id: 'foodforest',
    label: 'Food forest / polyculture planting',
    affects: [
      { lever: 'vegetativeStructure', deltaMin: 15, deltaMax: 35, confidence: 'high' },
      { lever: 'soilBiology',         deltaMin: 10, deltaMax: 24, confidence: 'moderate' },
      { lever: 'faunaIntegration',    deltaMin: 5,  deltaMax: 15, confidence: 'moderate' },
      { lever: 'soilStructure',       deltaMin: 3,  deltaMax: 10, confidence: 'low-moderate' },
      { lever: 'microclimate',        deltaMin: 3,  deltaMax: 8,  confidence: 'low-moderate' },
    ],
    physical: {
      canopyCoverGainPct:        { min: 15, max: 50 },
      productiveLayersAdded:     { min: 2,  max: 4 },
      organicMatterIncreasePct:  { min: 0.5, max: 2.0 },
      carbonSequestration_t_ha_yr: { min: 2, max: 8 },
      forageBiomass_kg_ha_yr:    { min: 500, max: 3000 },
    },
    cost: {
      treesPerHa:        { min: 150, max: 400 },
      costPerTree:       { min: 8, max: 35 },  // includes guard, mulch, establishment
      sitePrepPerHa:     { min: 800, max: 2500 },
      note: 'Stock + guards + mulch + planting labour. Mature maintenance not included.',
    },
    timeToEffect: { partial: 3, full: 8 },
  },

  shelterbelt: {
    id: 'shelterbelt',
    label: 'Shelterbelt / windbreak planting',
    affects: [
      { lever: 'microclimate',        deltaMin: 10, deltaMax: 25, confidence: 'high' },
      { lever: 'vegetativeStructure', deltaMin: 5,  deltaMax: 15, confidence: 'moderate' },
      { lever: 'faunaIntegration',    deltaMin: 5,  deltaMax: 15, confidence: 'moderate' },
      { lever: 'soilBiology',         deltaMin: 3,  deltaMax: 8,  confidence: 'low-moderate' },
      { lever: 'soilStructure',       deltaMin: 2,  deltaMax: 6,  confidence: 'low' },
    ],
    physical: {
      windReductionPct:            { min: 30, max: 60 },
      etReductionPct:              { min: 10, max: 25 },
      snowTrapDepthGain_cm:        { min: 20, max: 80 },
      effectiveShelterWidth_m:     { min: 50, max: 150 },  // 10–20× tree height
      nestingHabitatGain_m2:       { min: 200, max: 2000 },
    },
    cost: {
      treesPerRow:         { min: 300, max: 600 },  // per km of belt
      rows:                { min: 2, max: 5 },
      costPerTree:         { min: 5, max: 20 },
      note: 'Multi-row native species mix. Lower cost if using whips / bare-root stock.',
    },
    timeToEffect: { partial: 2, full: 6 },
  },
};

/**
 * Get the list of intervention IDs.
 */
export function getInterventionIds() {
  return Object.keys(INTERVENTIONS);
}

/**
 * Get a specific intervention definition.
 */
export function getIntervention(id) {
  return INTERVENTIONS[id] || null;
}

/**
 * For a given set of baseline category scores, return which interventions
 * are most relevant (prioritized by potential delta on weakest categories).
 *
 * @param {Record<string, number|null>} baselineScores
 * @param {string[]} [exclude] — intervention IDs to skip
 * @returns {{ id: string, label: string, priority: number, topLever: string, maxDelta: number }[]}
 */
export function recommendInterventions(baselineScores, exclude = []) {
  const scored = [];

  for (const [id, intervention] of Object.entries(INTERVENTIONS)) {
    if (exclude.includes(id)) continue;

    let totalPotential = 0;
    let topLever = null;
    let maxDelta = 0;

    for (const eff of intervention.affects) {
      const baseline = baselineScores[eff.lever];
      // Only count improvement if baseline is below 100
      const headroom = baseline != null ? Math.max(0, 100 - baseline) : 50;
      const effectiveDelta = Math.min(eff.deltaMax, headroom);
      totalPotential += effectiveDelta;
      if (effectiveDelta > maxDelta) {
        maxDelta = effectiveDelta;
        topLever = eff.lever;
      }
    }

    scored.push({
      id,
      label: intervention.label,
      priority: totalPotential,
      topLever,
      maxDelta,
    });
  }

  return scored.sort((a, b) => b.priority - a.priority);
}