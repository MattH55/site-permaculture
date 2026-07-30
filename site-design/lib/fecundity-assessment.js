/**
 * Expanding Edge Permaculture — Fecundity Assessment
 * Scores a property (0-100 per category) across 7 productivity levers.
 * Every indicator is OPTIONAL — missing data drops out rather than penalizing.
 */

const CATEGORY_WEIGHTS = {
  water: 0.20,
  soilStructure: 0.15,
  soilBiology: 0.15,
  nutrientCycling: 0.15,
  vegetativeStructure: 0.20,
  faunaIntegration: 0.05,
  microclimate: 0.10,
};

const CATEGORIES = {
  water: {
    label: 'Water — infiltration & retention',
    suggestedServices: ['swale', 'pond'],
    indicators: [
      {
        key: 'infiltrationRate',
        fields: ['percolationMinPerInch'],
        score(d) {
          const m = d.percolationMinPerInch;
          if (m == null) return null;
          if (m < 2) return 40;
          if (m <= 15) return 90;
          if (m <= 30) return 60;
          return 25;
        },
      },
      {
        key: 'slopeSuitability',
        fields: ['avgSlopePercent'],
        score(d) {
          const s = d.avgSlopePercent;
          if (s == null) return null;
          if (s >= 2 && s <= 15) return 90;
          if (s > 15 && s <= 20) return 55;
          if (s < 2) return 45;
          return 20;
        },
      },
      {
        key: 'existingWaterFeatures',
        fields: [
          'hasPondOrWetland',
          'hasPondOrWetlandInventory',
          'hasPondOrDugout',
          'satelliteOpenWater',
          'smallWaterNearestM',
        ],
        score(d) {
          // Prefer real detections (inventory / optical) over pure land-cover class
          const dist = d.smallWaterNearestM;
          const decay = distanceDecay(dist); // 1 on-site → 0 at ~300 m+

          if (d.hasPondOrWetlandInventory === true) {
            return Math.round(88 + 4 * decay); // 88–92
          }
          if (d.hasPondOrDugout === true || d.satelliteOpenWater === true) {
            // Confirmed open water — strong positive, distance-weighted
            return Math.round(70 + 18 * decay); // ~70–88
          }
          if (d.hasPondOrWetlandInventory === false && d.hasPondOrDugout === false) {
            // Explicit none from inventory + optical: mild baseline
            if (d.hasPondOrWetland === true) return 55; // land-cover only leftover
            return 40;
          }
          // Land-cover fallback only when no optical/inventory answer
          if (d.hasPondOrWetland == null) return null;
          return d.hasPondOrWetland ? 62 : 38; // lower confidence than detections
        },
      },
      {
        // Supplementary satellite moisture proxy (Sentinel-1 / NDMI) — 0–1 relative
        key: 'satelliteMoistureProxy',
        fields: ['soilMoistureProxy', 'smallWaterDensity'],
        score(d) {
          const v = d.soilMoistureProxy;
          const dens = d.smallWaterDensity;
          let base = null;
          if (v != null) {
            if (v >= 0.65) base = 80;
            else if (v >= 0.4) base = 60;
            else if (v >= 0.2) base = 40;
            else base = 25;
          }
          // Small water density slightly boosts moisture context (capped)
          if (dens != null && dens > 0.15) {
            const boost = Math.round(Math.min(14, dens * 16));
            base = base != null ? Math.min(88, base + boost) : 42 + boost;
          }
          return base;
        },
      },
      {
        // Confirmed vs possible small water — distance decay; never regulatory
        key: 'smallWaterOrSeep',
        fields: [
          'hasSmallWaterOrSeep',
          'smallWaterConfirmedAreaM2',
          'smallWaterPossibleAreaM2',
          'smallWaterNearestM',
          'hasPondOrDugout',
        ],
        score(d) {
          if (
            d.hasSmallWaterOrSeep == null &&
            d.hasPondOrDugout == null &&
            d.smallWaterConfirmedAreaM2 == null &&
            d.smallWaterPossibleAreaM2 == null
          ) {
            return null;
          }
          const confM2 = d.smallWaterConfirmedAreaM2 || 0;
          const possM2 = d.smallWaterPossibleAreaM2 || 0;
          const decay = distanceDecay(d.smallWaterNearestM);
          const hasConf = d.hasPondOrDugout === true || confM2 > 0;
          const hasPoss = d.hasSmallWaterOrSeep === true || possM2 > 0;

          if (!hasConf && !hasPoss) return 36;

          if (hasConf) {
            // Stronger positive for confirmed water, distance-weighted
            let base = confM2 >= 500 ? 84 : confM2 > 0 ? 76 : 74;
            return Math.round(base * (0.75 + 0.25 * decay));
          }
          // Possible only — modest positive + implies field verification
          let base = possM2 >= 200 ? 56 : possM2 > 0 ? 50 : 48;
          return Math.round(base * (0.7 + 0.3 * decay));
        },
      },
      {
        // On-site or nearby wetland storage (inventory) + nearby small water
        key: 'wetlandStorage',
        fields: [
          'wetlandAreaHa',
          'wetlandProximityBoost',
          'smallWaterConfirmedAreaM2',
          'smallWaterNearestM',
        ],
        score(d) {
          if (d.wetlandAreaHa != null && d.wetlandAreaHa > 0) {
            if (d.wetlandAreaHa >= 2) return 92;
            if (d.wetlandAreaHa >= 0.5) return 85;
            return 75;
          }
          if (d.wetlandProximityBoost != null && d.wetlandProximityBoost > 0) {
            return Math.round(45 + d.wetlandProximityBoost * 30);
          }
          // Confirmed open water as storage proxy (weaker than inventory)
          const confM2 = d.smallWaterConfirmedAreaM2 || 0;
          if (confM2 > 0) {
            const decay = distanceDecay(d.smallWaterNearestM);
            return Math.round((confM2 >= 500 ? 72 : 62) * (0.75 + 0.25 * decay));
          }
          return null;
        },
      },
    ],
  },

  soilStructure: {
    label: 'Soil physical structure',
    suggestedServices: ['swale'],
    indicators: [
      {
        key: 'compaction',
        fields: ['compactionKpa'],
        score(d) {
          const k = d.compactionKpa;
          if (k == null) return null;
          if (k < 1000) return 90;
          if (k < 2000) return 65;
          if (k < 3000) return 35;
          return 15;
        },
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
        },
      },
      {
        key: 'texture',
        fields: ['soilTexture'],
        score(d) {
          const t = d.soilTexture;
          if (!t) return null;
          const table = { loam: 90, 'sandy-loam': 75, 'clay-loam': 70, silt: 65, sandy: 40, clay: 40 };
          return table[t] ?? 55;
        },
      },
    ],
  },

  soilBiology: {
    label: 'Soil biology',
    suggestedServices: ['foodforest'],
    indicators: [
      {
        key: 'earthwormCount',
        fields: ['earthwormsPerShovelTest'],
        score(d) {
          const n = d.earthwormsPerShovelTest;
          if (n == null) return null;
          if (n >= 10) return 90;
          if (n >= 5) return 65;
          if (n >= 1) return 35;
          return 10;
        },
      },
      {
        key: 'biocideHistory',
        fields: ['recentBiocideUse'],
        score(d) {
          if (d.recentBiocideUse == null) return null;
          return d.recentBiocideUse ? 25 : 80;
        },
      },
      {
        key: 'visibleFungalNetwork',
        fields: ['fungalNetworkObserved'],
        score(d) {
          if (d.fungalNetworkObserved == null) return null;
          return d.fungalNetworkObserved ? 85 : 45;
        },
      },
    ],
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
        },
      },
      {
        key: 'organicInputHistory',
        fields: ['compostOrManureHistory'],
        score(d) {
          if (d.compostOrManureHistory == null) return null;
          return d.compostOrManureHistory ? 80 : 40;
        },
      },
    ],
  },

  vegetativeStructure: {
    label: 'Vegetative layering & succession',
    suggestedServices: ['foodforest', 'shelterbelt'],
    indicators: [
      {
        key: 'canopyLayers',
        fields: ['observedLayerCount'],
        score(d) {
          const n = d.observedLayerCount;
          if (n == null) return null;
          return Math.min(100, Math.round((n / 6) * 100));
        },
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
        },
      },
      {
        key: 'successionalStage',
        fields: ['successionalStage'],
        score(d) {
          const table = { bare: 10, pioneer: 40, intermediate: 70, climax: 95 };
          return table[d.successionalStage] ?? null;
        },
      },
      {
        // Sentinel-2 NDVI / NDRE vigor (property-scale, medium-high confidence)
        key: 'satelliteVigor',
        fields: ['vegetationVigor', 'ndviMedian'],
        score(d) {
          if (d.ndviMedian != null) {
            const n = d.ndviMedian;
            if (n >= 0.6) return 90;
            if (n >= 0.45) return 75;
            if (n >= 0.3) return 55;
            if (n >= 0.15) return 35;
            return 15;
          }
          const table = { high: 88, moderate: 65, low: 40, very_low: 18 };
          return table[d.vegetationVigor] ?? null;
        },
      },
      {
        // Wetland plant communities add structural diversity
        key: 'wetlandVegetationStructure',
        fields: [
          'hasPondOrWetlandInventory',
          'wetlandTypes',
          'hasPondOrDugout',
          'hasSmallWaterOrSeep',
        ],
        score(d) {
          if (d.hasPondOrWetlandInventory === true) {
            const n = (d.wetlandTypes || []).length;
            return n >= 2 ? 80 : 70;
          }
          // Confirmed open water / possible seeps — modest structure signal
          if (d.hasPondOrDugout === true) return 62;
          if (d.hasSmallWaterOrSeep === true) return 54;
          if (d.hasPondOrWetlandInventory === false) return 45;
          return null;
        },
      },
    ],
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
        },
      },
      {
        key: 'naturalPredatorPresence',
        fields: ['naturalPredatorPresence'],
        score(d) {
          if (d.naturalPredatorPresence == null) return null;
          return d.naturalPredatorPresence ? 80 : 50;
        },
      },
      {
        // Wetland / open-water habitat for amphibians, waterfowl, invertebrates
        key: 'wetlandHabitat',
        fields: [
          'wetlandHabitatPresent',
          'hasPondOrWetlandInventory',
          'hasPondOrDugout',
          'hasSmallWaterOrSeep',
          'smallWaterNearestM',
        ],
        score(d) {
          if (d.hasPondOrWetlandInventory === true) return 88;
          if (d.wetlandHabitatPresent === true) return 72;
          // Small water raises habitat potential (medium confidence)
          if (d.hasPondOrDugout === true) {
            return Math.round(68 * (0.8 + 0.2 * distanceDecay(d.smallWaterNearestM)));
          }
          if (d.hasSmallWaterOrSeep === true) {
            return Math.round(58 * (0.75 + 0.25 * distanceDecay(d.smallWaterNearestM)));
          }
          if (d.hasPondOrWetlandInventory === false && d.wetlandHabitatPresent === false)
            return 45;
          return null;
        },
      },
    ],
  },

  microclimate: {
    label: 'Microclimate',
    suggestedServices: ['shelterbelt', 'pond'],
    indicators: [
      {
        key: 'windExposure',
        fields: ['windExposure'],
        score(d) {
          const table = { open: 30, partial: 65, sheltered: 90 };
          return table[d.windExposure] ?? null;
        },
      },
      {
        key: 'frostPoolingRisk',
        fields: ['frostPoolingRisk'],
        score(d) {
          if (d.frostPoolingRisk == null) return null;
          const table = { low: 85, moderate: 55, high: 25 };
          return table[d.frostPoolingRisk] ?? null;
        },
      },
      {
        // Multi-year Landsat NDVI trend as vigor / microclimate stress screen
        key: 'vegetationTrend',
        fields: ['ndviTrendSlope'],
        score(d) {
          const s = d.ndviTrendSlope;
          if (s == null) return null;
          if (s >= 0.01) return 85;
          if (s >= 0) return 70;
          if (s >= -0.01) return 50;
          return 30;
        },
      },
      {
        // Open water / wet soils moderate humidity and frost swings (medium confidence for satellite)
        key: 'wetlandMicroclimate',
        fields: [
          'hasPondOrWetlandInventory',
          'wetlandAreaHa',
          'hasPondOrDugout',
          'hasSmallWaterOrSeep',
          'smallWaterNearestM',
        ],
        score(d) {
          if (d.hasPondOrWetlandInventory === true) {
            const ha = d.wetlandAreaHa || 0.1;
            return ha >= 1 ? 85 : 75;
          }
          const decay = distanceDecay(d.smallWaterNearestM);
          if (d.hasPondOrDugout === true) {
            return Math.round(70 * (0.75 + 0.25 * decay)); // medium confidence humidity boost
          }
          if (d.hasSmallWaterOrSeep === true) {
            return Math.round(58 * (0.7 + 0.3 * decay)); // modest / low-medium
          }
          if (d.hasPondOrWetlandInventory === false) return 48;
          return null;
        },
      },
    ],
  },
};

/** 1.0 on-site / 0 m → ~0 beyond 300 m. Used for water feature influence. */
function distanceDecay(nearestM) {
  if (nearestM == null) return 0.85; // unknown distance — slight discount
  if (nearestM <= 0) return 1;
  if (nearestM >= 300) return 0.15;
  return Math.max(0.15, 1 - nearestM / 300);
}

function scoreCategory(categoryKey, siteData) {
  const cat = CATEGORIES[categoryKey];
  const values = cat.indicators
    .map((ind) => ind.score(siteData))
    .filter((v) => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, v) => a + v, 0) / values.length);
}

export function assessFecundity(siteData = {}) {
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

  const weakestCategories = Object.entries(categoryScores)
    .filter(([, v]) => v !== null)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([key, score]) => ({ category: key, label: CATEGORIES[key].label, score }));

  const suggestedServices = [...new Set(
    weakestCategories.flatMap((w) => CATEGORIES[w.category].suggestedServices)
  )];

  const totalIndicators = Object.values(CATEGORIES).reduce((a, c) => a + c.indicators.length, 0);
  const answeredIndicators = Object.values(CATEGORIES)
    .flatMap((c) => c.indicators)
    .filter((ind) => ind.score(siteData) !== null).length;

  return {
    categoryScores,
    overallScore,
    weakestCategories,
    suggestedServices,
    dataCompleteness: Math.round((answeredIndicators / totalIndicators) * 100),
    generatedAt: new Date().toISOString(),
  };
}

export { CATEGORY_WEIGHTS, CATEGORIES };