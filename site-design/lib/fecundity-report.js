/**
 * Expanding Edge — Fecundity Report Generator
 * Infers missing indicators from pipeline data, runs assessment,
 * produces a client-facing report with provenance tags.
 * Optionally merges satellite vegetation indices (Sentinel-2) and
 * regional SOC context (SoilGrids — low confidence only).
 * Optionally runs intervention value estimation on top of baseline scores.
 */
import { assessFecundity, CATEGORIES } from './fecundity-assessment.js';
import { generateInterventionValueReport } from './intervention-value.js';
import { carbonSafeText, satelliteAttribution } from './satellite-confidence.js';

function inferIndicators(rawData = {}) {
  const measured = rawData.measured || {};
  const siteData = { ...measured };
  const provenance = {};
  Object.keys(measured).forEach((k) => {
    provenance[k] = 'measured';
  });

  const set = (key, value, conf) => {
    if (siteData[key] === undefined && value != null) {
      siteData[key] = value;
      provenance[key] = `inferred (${conf})`;
    }
  };

  // Water
  if (rawData.topoData?.avgSlopePercent != null)
    set('avgSlopePercent', rawData.topoData.avgSlopePercent, 'high — topography');
  if (rawData.wetlandsPresent != null)
    set('hasPondOrWetland', rawData.wetlandsPresent, 'high — wetlands layer');
  if (rawData.soilMoistureProxy != null)
    set(
      'soilMoistureProxy',
      rawData.soilMoistureProxy,
      'low-moderate — Sentinel-1 / NDMI moisture proxy'
    );

  // Soil — texture only from survey; NEVER set organicMatterPct from satellite SOC
  if (rawData.regionalSoilTexture)
    set('soilTexture', rawData.regionalSoilTexture, 'moderate — soil survey');
  if (rawData.labOrganicMatterPct != null)
    set('organicMatterPct', rawData.labOrganicMatterPct, 'high — laboratory');

  // Vegetation — prefer real Sentinel-2 ndviCoverPct over coarse tree-cover estimate
  if (rawData.ndviCoverPct != null) {
    const conf = rawData.satellite?.ndvi
      ? 'medium-high — Sentinel-2 NDVI'
      : 'moderate — canopy imagery';
    set('bareGroundPct', Math.max(0, 100 - rawData.ndviCoverPct), conf);
  }
  if (rawData.ndviMedian != null)
    set('ndviMedian', rawData.ndviMedian, 'medium-high — Sentinel-2 NDVI');
  if (rawData.vegetationVigor != null)
    set('vegetationVigor', rawData.vegetationVigor, 'medium-high — Sentinel-2 vigor class');
  if (rawData.ndviTrendSlope != null)
    set('ndviTrendSlope', rawData.ndviTrendSlope, 'moderate — Landsat multi-year NDVI trend');

  if (rawData.landCoverClass) {
    const sm = {
      bare: 'bare',
      cropland: 'pioneer',
      grassland: 'pioneer',
      shrubland: 'intermediate',
      forest: 'climax',
    };
    set(
      'successionalStage',
      sm[rawData.landCoverClass],
      'low-moderate — land-cover class'
    );
    const lm = { bare: 0, cropland: 1, grassland: 1, shrubland: 3, forest: 5 };
    set('observedLayerCount', lm[rawData.landCoverClass], 'low — land-cover class');
  }

  // Fauna
  if (Array.isArray(rawData.wildlifeObservations)) {
    const obs = rawData.wildlifeObservations.map((s) => s.toLowerCase());
    const preds = [
      'fox',
      'red fox',
      'coyote',
      'hawk',
      'red-tailed hawk',
      'owl',
      'great horned owl',
      'eagle',
      'bald eagle',
    ];
    const polls = ['bee', 'bumblebee', 'butterfly', 'hummingbird'];
    set(
      'naturalPredatorPresence',
      preds.some((p) => obs.includes(p)),
      'moderate — regional wildlife obs'
    );
    set(
      'pollinatorActivityObserved',
      polls.some((p) => obs.some((o) => o.includes(p))),
      'low — regional species records'
    );
  }

  // Microclimate
  if (rawData.windExposureHint)
    set('windExposure', rawData.windExposureHint, 'moderate — tree cover/topo');
  if (rawData.frostPoolingHint)
    set('frostPoolingRisk', rawData.frostPoolingHint, 'moderate — landform position');

  return { siteData, provenance };
}

function scoreBand(score) {
  if (score >= 80)
    return {
      label: 'Strong',
      color: 'var(--ok)',
      tone: 'Working well — maintain current conditions.',
    };
  if (score >= 60)
    return {
      label: 'Solid, with room to optimize',
      color: 'var(--gold)',
      tone: 'Functioning adequately but clear headroom for improvement.',
    };
  if (score >= 35)
    return {
      label: 'Below average',
      color: 'var(--caution)',
      tone: 'A meaningful limiting factor on overall productivity.',
    };
  return {
    label: 'Needs significant improvement',
    color: 'var(--danger)',
    tone: 'One of the biggest constraints on what the land can produce.',
  };
}

const SERVICE_RATIONALE = {
  swale: 'Captures and slows runoff so water infiltrates instead of leaving the property.',
  pond: 'Adds a passive water reserve and raises local humidity.',
  shelterbelt:
    'Reduces wind exposure and evapotranspiration while adding a nitrogen-fixing planting layer.',
  foodforest:
    'Builds vegetative layering and long-term soil biology through a designed polyculture.',
  assessment: "Establishes a measured baseline where one doesn't exist yet.",
};

export function generateFecundityReport(rawData = {}, opts = {}) {
  const { siteData, provenance } = inferIndicators(rawData);
  const assessment = assessFecundity(siteData);

  const hasSatellite =
    !!(rawData.satellite?.available || rawData.ndviMedian != null || rawData.ndviCoverPct != null);

  const categories = Object.keys(CATEGORIES).map((key) => {
    const cfg = CATEGORIES[key];
    const score = assessment.categoryScores[key];
    const band = score !== null ? scoreBand(score) : null;

    const fieldSources = cfg.indicators
      .flatMap((ind) => ind.fields)
      .filter((f) => provenance[f])
      .map((f) => `${f}: ${provenance[f]}`);

    const recommendations =
      score !== null && score < 70
        ? cfg.suggestedServices.map((id) => ({
            serviceId: id,
            rationale: SERVICE_RATIONALE[id] || 'addresses this lever directly.',
          }))
        : [];

    let narrative =
      score !== null
        ? band.tone
        : 'No measured or inferable data — recommend a targeted site assessment.';

    // Enforce carbon-safe language on soil structure / nutrient narratives
    if (key === 'soilStructure' || key === 'nutrientCycling' || key === 'soilBiology') {
      narrative = carbonSafeText(rawData.satelliteClaims?.find((c) => c.field === 'soil_organic_carbon'), narrative);
    }

    return {
      category: key,
      label: cfg.label,
      score,
      status: band ? band.label : 'Insufficient data',
      color: band ? band.color : 'var(--ink-soft)',
      narrative,
      dataBasis: fieldSources.length ? fieldSources : ['no data available'],
      recommendations,
    };
  });

  // Intervention value estimation — runs on top of baseline scores
  const siteContext = {
    footprintHa: rawData.footprintHa || opts.footprintHa || null,
    slopePercent: rawData.topoData?.avgSlopePercent ?? opts.slopePercent ?? null,
    annualPrecipMm: rawData.annualPrecipMm || opts.annualPrecipMm || null,
    soilTexture: rawData.regionalSoilTexture || opts.soilTexture || null,
  };

  let interventionValue = null;
  try {
    interventionValue = generateInterventionValueReport({
      baselineScores: assessment.categoryScores,
      siteContext,
      scenario: opts.scenario || 'mid',
      timeHorizonYears: opts.timeHorizonYears || 10,
    });
  } catch {
    // Value estimation is best-effort — don't break the fecundity report
  }

  // CLAIMS envelope — SOC never numeric from satellite alone
  const claims = Array.isArray(rawData.satelliteClaims)
    ? rawData.satelliteClaims
    : [];

  const regionalContext =
    rawData.regionalSocContext ||
    rawData.satellite?.regional_soc ||
    claims.find((c) => c.field === 'soil_organic_carbon')?.regional_context ||
    null;

  const disclaimer = hasSatellite
    ? 'Satellite vegetation indices (Sentinel-2) improve vegetative and water screening at property scale, but do not replace soil tests for carbon or biology. Regional SOC layers are context only (low–moderate confidence). A site walk with lab tests remains the high-confidence path.'
    : 'This fecundity score is inferred from topography, soil survey, canopy cover, land-cover class, and regional wildlife observations. A direct site walk with soil tests, penetrometer readings, and field observations will significantly improve accuracy. No measured indicators were collected for this remote report.';

  return {
    propertyLabel: opts.propertyLabel || null,
    overallScore: assessment.overallScore,
    dataCompleteness: assessment.dataCompleteness,
    weakestCategories: assessment.weakestCategories,
    suggestedServices: assessment.suggestedServices,
    categories,
    interventionValue,
    satellite: rawData.satellite || null,
    claims,
    regional_context: regionalContext
      ? {
          soil_organic_carbon: regionalContext,
          banner:
            'Regional SOC context only — low to moderate confidence. Not a property-scale measurement.',
        }
      : null,
    disclaimer,
    attribution: hasSatellite
      ? rawData.satellite?.attribution || satelliteAttribution()
      : null,
    generatedAt: new Date().toISOString(),
  };
}
