/**
 * Expanding Edge Permaculture — Fecundity Assessment
 * -------------------------------------------------------------
 * Scores a property (0-100 per category) across the levers that
 * actually drive land productivity, then flags the weakest levers
 * and suggests which services in rate_engine.js's SERVICES address
 * them. Designed to sit between the site-data-collection step
 * (topography, soil tests, wildlife pull) and buildQuote() in the
 * AI site report pipeline.
 *
 * This module is deliberately decoupled from rate_engine.js — it
 * only returns SERVICE ID STRINGS that happen to match keys in
 * rate_engine's SERVICES object, not estimate objects. The calling
 * app still owns sizing (e.g. recommendSwaleMeters()) and whether
 * to actually include a suggestion in the final quote.
 *
 * Every indicator is OPTIONAL. Missing data just drops that
 * indicator from its category's average rather than penalizing the
 * score — an incomplete site visit should never look artificially
 * unproductive. A category with zero available indicators returns
 * null, not 0, and is excluded from the overall score.
 * -------------------------------------------------------------
 */

// Relative weight of each category in the overall score. Adjust as
// field experience shows which levers actually predict outcomes.
const CATEGORY_WEIGHTS = {
  water: 0.20,
  soilStructure: 0.15,
  soilBiology: 0.15,
  nutrientCycling: 0.15,
  vegetativeStructure: 0.20,
  faunaIntegration: 0.05,
  microclimate: 0.10
};

// Each category lists indicators as { key, score(siteData) -> 0-100 | null, suggestedServices }.
// siteData is one flat object — see the bottom of this file for its expected shape.
const CATEGORIES = {

  water: {
    label: 'Water — infiltration & retention',
    suggestedServices: ['swale', 'pond'],
    indicators: [
      {
        key: 'infiltrationRate',
        fields: ['percolationMinPerInch'],
        // siteData.percolationMinPerInch: lower = faster drainage = generally better, but
        // very fast (>30 min/in is slow; <2 min/in is too fast to hold moisture) is scored as a curve.
        score(d) {
          const m = d.percolationMinPerInch;
          if (m == null) return null;
          if (m < 2) return 40;         // drains too fast to retain moisture
          if (m <= 15) return 90;       // ideal range
          if (m <= 30) return 60;
          return 25;                    // heavy clay, ponds instead of infiltrates
        }
      },
      {
        key: 'slopeSuitability',
        fields: ['avgSlopePercent'],
        score(d) {
          const s = d.avgSlopePercent;
          if (s == null) return null;
          if (s >= 2 && s <= 15) return 90;   // sweet spot for swales
          if (s > 15 && s <= 20) return 55;
          if (s < 2) return 45;               // flat — less runoff to capture, but also less need
          return 20;                          // >20% — erosion risk, hard to work with
        }
      },
      {
        key: 'existingWaterFeatures',
        fields: ['hasPondOrWetland'],
        score(d) {
          if (d.hasPondOrWetland == null) return null;
          return d.hasPondOrWetland ? 85 : 40;
        }
      }
    ]
  },

  soilStructure: {
    label: 'Soil physical structure',
    suggestedServices: ['swale'], // keyline/subsoiling not yet an active service — add here when it is
    indicators: [
      {
        key: 'compaction',
        fields: ['compactionKpa'],
        // siteData.compactionKpa from a penetrometer reading; lower = looser soil
        score(d) {
          const k = d.compactionKpa;
          if (k == null) return null;
          if (k < 1000) return 90;
          if (k < 2000) return 65;
          if (k < 3000) return 35;
          return 15;
        }
      },
      {
        key: 'organicMatter',
        fields: ['organicMatterPct'],
        score(d) {
          const pct = d.organicMatterPct;
          if (pct == null) return null;
          if (pct >= 5) return 95;
          if (pct >= 3) return 75;
          if (pct >= 1.5) return 45;
          return 20;
        }
      },
      {
        key: 'texture',
        fields: ['soilTexture'],
        // siteData.soilTexture: 'loam' | 'sandy' | 'clay' | 'silt' | 'sandy-loam' | 'clay-loam' etc.
        score(d) {
          const t = d.soilTexture;
          if (!t) return null;
          const table = { loam: 90, 'sandy-loam': 75, 'clay-loam': 70, silt: 65, sandy: 40, clay: 40 };
          return table[t] ?? 55;
        }
      }
    ]
  },

  soilBiology: {
    label: 'Soil biology',
    suggestedServices: ['foodforest'],
    indicators: [
      {
        key: 'earthwormCount',
        fields: ['earthwormsPerShovelTest'],
        // siteData.earthwormsPerShovelTest — a simple, low-tech field count
        score(d) {
          const n = d.earthwormsPerShovelTest;
          if (n == null) return null;
          if (n >= 10) return 90;
          if (n >= 5) return 65;
          if (n >= 1) return 35;
          return 10;
        }
      },
      {
        key: 'biocideHistory',
        fields: ['recentBiocideUse'],
        score(d) {
          if (d.recentBiocideUse == null) return null;
          return d.recentBiocideUse ? 25 : 80;
        }
      },
      {
        key: 'visibleFungalNetwork',
        fields: ['fungalNetworkObserved'],
        score(d) {
          if (d.fungalNetworkObserved == null) return null;
          return d.fungalNetworkObserved ? 85 : 45;
        }
      }
    ]
  },

  nutrientCycling: {
    label: 'Nutrient cycling',
    suggestedServices: ['foodforest', 'shelterbelt'],
    indicators: [
      {
        key: 'soilPh',
        fields: ['soilPh'],
        score(d) {
          const ph = d.soilPh;
          if (ph == null) return null;
          if (ph >= 6.0 && ph <= 7.0) return 90;
          if (ph >= 5.5 && ph < 6.0) return 65;
          if (ph > 7.0 && ph <= 7.5) return 65;
          return 30;
        }
      },
      {
        key: 'organicInputHistory',
        fields: ['compostOrManureHistory'],
        score(d) {
          if (d.compostOrManureHistory == null) return null;
          return d.compostOrManureHistory ? 80 : 40;
        }
      }
    ]
  },

  vegetativeStructure: {
    label: 'Vegetative layering & succession',
    suggestedServices: ['foodforest', 'shelterbelt'],
    indicators: [
      {
        key: 'canopyLayers',
        fields: ['observedLayerCount'],
        // siteData.observedLayerCount: how many of canopy/understory/shrub/herb/ground/root are present (0-6)
        score(d) {
          const n = d.observedLayerCount;
          if (n == null) return null;
          return Math.min(100, Math.round((n / 6) * 100));
        }
      },
      {
        key: 'bareGround',
        fields: ['bareGroundPct'],
        score(d) {
          const pct = d.bareGroundPct;
          if (pct == null) return null;
          if (pct <= 10) return 90;
          if (pct <= 30) return 60;
          if (pct <= 60) return 30;
          return 10;
        }
      },
      {
        key: 'successionalStage',
        fields: ['successionalStage'],
        // siteData.successionalStage: 'bare' | 'pioneer' | 'intermediate' | 'climax'
        score(d) {
          const table = { bare: 10, pioneer: 40, intermediate: 70, climax: 95 };
          return table[d.successionalStage] ?? null;
        }
      }
    ]
  },

  faunaIntegration: {
    label: 'Fauna integration',
    suggestedServices: ['shelterbelt'],
    indicators: [
      {
        key: 'pollinatorActivity',
        fields: ['pollinatorActivityObserved'],
        score(d) {
          if (d.pollinatorActivityObserved == null) return null;
          return d.pollinatorActivityObserved ? 85 : 40;
        }
      },
      {
        key: 'naturalPredatorPresence',
        fields: ['naturalPredatorPresence'],
        // can be sourced from the wildlife-data lookup step (fox/raptor presence near the property)
        score(d) {
          if (d.naturalPredatorPresence == null) return null;
          return d.naturalPredatorPresence ? 80 : 50;
        }
      }
    ]
  },

  microclimate: {
    label: 'Microclimate',
    suggestedServices: ['shelterbelt', 'pond'],
    indicators: [
      {
        key: 'windExposure',
        fields: ['windExposure'],
        // siteData.windExposure: 'open' | 'partial' | 'sheltered'
        score(d) {
          const table = { open: 30, partial: 65, sheltered: 90 };
          return table[d.windExposure] ?? null;
        }
      },
      {
        key: 'frostPoolingRisk',
        fields: ['frostPoolingRisk'],
        score(d) {
          if (d.frostPoolingRisk == null) return null;
          // frostPoolingRisk: 'low' | 'moderate' | 'high'
          const table = { low: 85, moderate: 55, high: 25 };
          return table[d.frostPoolingRisk] ?? null;
        }
      }
    ]
  }
};

/**
 * Score one category from siteData, averaging only its available indicators.
 * @returns {number|null} 0-100, or null if no indicators had data.
 */
function scoreCategory(categoryKey, siteData) {
  const cat = CATEGORIES[categoryKey];
  const values = cat.indicators
    .map(ind => ind.score(siteData))
    .filter(v => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, v) => a + v, 0) / values.length);
}

/**
 * Full fecundity assessment for a property.
 * @param {object} siteData - flat object; see field list below.
 * @returns {object} { categoryScores, overallScore, weakestCategories, suggestedServices, dataCompleteness }
 *
 * Expected siteData fields (all optional):
 *   avgSlopePercent, percolationMinPerInch, hasPondOrWetland,
 *   compactionKpa, organicMatterPct, soilTexture,
 *   earthwormsPerShovelTest, recentBiocideUse, fungalNetworkObserved,
 *   soilPh, compostOrManureHistory,
 *   observedLayerCount, bareGroundPct, successionalStage,
 *   pollinatorActivityObserved, naturalPredatorPresence,
 *   windExposure, frostPoolingRisk
 */
function assessFecundity(siteData = {}) {
  const categoryScores = {};
  let weightedSum = 0;
  let weightUsed = 0;

  for (const key of Object.keys(CATEGORIES)) {
    const score = scoreCategory(key, siteData);
    categoryScores[key] = score;
    if (score !== null) {
      weightedSum += score * CATEGORY_WEIGHTS[key];
      weightUsed += CATEGORY_WEIGHTS[key];
    }
  }

  const overallScore = weightUsed > 0 ? Math.round(weightedSum / weightUsed) : null;

  // Weakest categories with real data, lowest first, capped at the bottom 3.
  const weakestCategories = Object.entries(categoryScores)
    .filter(([, v]) => v !== null)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([key, score]) => ({ category: key, label: CATEGORIES[key].label, score }));

  // Deduplicated service suggestions drawn from the weakest categories, weakest first.
  const suggestedServices = [...new Set(
    weakestCategories.flatMap(w => CATEGORIES[w.category].suggestedServices)
  )];

  const totalIndicators = Object.values(CATEGORIES).reduce((a, c) => a + c.indicators.length, 0);
  const answeredIndicators = Object.values(CATEGORIES)
    .flatMap(c => c.indicators)
    .filter(ind => ind.score(siteData) !== null).length;

  return {
    categoryScores,
    overallScore,
    weakestCategories,
    suggestedServices,
    dataCompleteness: Math.round((answeredIndicators / totalIndicators) * 100),
    generatedAt: new Date().toISOString()
  };
}

const FecundityAssessment = { CATEGORY_WEIGHTS, CATEGORIES, assessFecundity };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FecundityAssessment;
}
if (typeof window !== 'undefined') {
  window.FecundityAssessment = FecundityAssessment;
}
