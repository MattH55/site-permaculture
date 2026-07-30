/**
 * Expanding Edge — Fecundity Report Generator
 * Infers missing indicators from pipeline data, runs assessment,
 * produces a client-facing report with provenance tags.
 */
import { assessFecundity, CATEGORIES } from './fecundity-assessment.js';

function inferIndicators(rawData = {}) {
  const measured = rawData.measured || {};
  const siteData = { ...measured };
  const provenance = {};
  Object.keys(measured).forEach((k) => { provenance[k] = 'measured'; });

  const set = (key, value, conf) => {
    if (siteData[key] === undefined && value != null) {
      siteData[key] = value;
      provenance[key] = `inferred (${conf})`;
    }
  };

  // Water
  if (rawData.topoData?.avgSlopePercent != null) set('avgSlopePercent', rawData.topoData.avgSlopePercent, 'high — topography');
  if (rawData.wetlandsPresent != null) set('hasPondOrWetland', rawData.wetlandsPresent, 'high — wetlands layer');

  // Soil
  if (rawData.regionalSoilTexture) set('soilTexture', rawData.regionalSoilTexture, 'moderate — soil survey');

  // Vegetation
  if (rawData.ndviCoverPct != null) set('bareGroundPct', Math.max(0, 100 - rawData.ndviCoverPct), 'moderate — canopy imagery');
  if (rawData.landCoverClass) {
    const sm = { bare: 'bare', cropland: 'pioneer', grassland: 'pioneer', shrubland: 'intermediate', forest: 'climax' };
    set('successionalStage', sm[rawData.landCoverClass], 'low-moderate — land-cover class');
    const lm = { bare: 0, cropland: 1, grassland: 1, shrubland: 3, forest: 5 };
    set('observedLayerCount', lm[rawData.landCoverClass], 'low — land-cover class');
  }

  // Fauna
  if (Array.isArray(rawData.wildlifeObservations)) {
    const obs = rawData.wildlifeObservations.map((s) => s.toLowerCase());
    const preds = ['fox', 'red fox', 'coyote', 'hawk', 'red-tailed hawk', 'owl', 'great horned owl', 'eagle', 'bald eagle'];
    const polls = ['bee', 'bumblebee', 'butterfly', 'hummingbird'];
    set('naturalPredatorPresence', preds.some((p) => obs.includes(p)), 'moderate — regional wildlife obs');
    set('pollinatorActivityObserved', polls.some((p) => obs.some((o) => o.includes(p))), 'low — regional species records');
  }

  // Microclimate
  if (rawData.windExposureHint) set('windExposure', rawData.windExposureHint, 'moderate — tree cover/topo');
  if (rawData.frostPoolingHint) set('frostPoolingRisk', rawData.frostPoolingHint, 'moderate — landform position');

  return { siteData, provenance };
}

function scoreBand(score) {
  if (score >= 80) return { label: 'Strong', color: 'var(--ok)', tone: 'Working well — maintain current conditions.' };
  if (score >= 60) return { label: 'Solid, with room to optimize', color: 'var(--gold)', tone: 'Functioning adequately but clear headroom for improvement.' };
  if (score >= 35) return { label: 'Below average', color: 'var(--caution)', tone: 'A meaningful limiting factor on overall productivity.' };
  return { label: 'Needs significant improvement', color: 'var(--danger)', tone: 'One of the biggest constraints on what the land can produce.' };
}

const SERVICE_RATIONALE = {
  swale: 'Captures and slows runoff so water infiltrates instead of leaving the property.',
  pond: 'Adds a passive water reserve and raises local humidity.',
  shelterbelt: 'Reduces wind exposure and evapotranspiration while adding a nitrogen-fixing planting layer.',
  foodforest: 'Builds vegetative layering and long-term soil biology through a designed polyculture.',
  assessment: 'Establishes a measured baseline where one doesn\'t exist yet.',
};

export function generateFecundityReport(rawData = {}, opts = {}) {
  const { siteData, provenance } = inferIndicators(rawData);
  const assessment = assessFecundity(siteData);

  const categories = Object.keys(CATEGORIES).map((key) => {
    const cfg = CATEGORIES[key];
    const score = assessment.categoryScores[key];
    const band = score !== null ? scoreBand(score) : null;

    const fieldSources = cfg.indicators
      .flatMap((ind) => ind.fields)
      .filter((f) => provenance[f])
      .map((f) => `${f}: ${provenance[f]}`);

    const recommendations = score !== null && score < 70
      ? cfg.suggestedServices.map((id) => ({ serviceId: id, rationale: SERVICE_RATIONALE[id] || 'addresses this lever directly.' }))
      : [];

    return {
      category: key,
      label: cfg.label,
      score,
      status: band ? band.label : 'Insufficient data',
      color: band ? band.color : 'var(--ink-soft)',
      narrative: score !== null ? band.tone : 'No measured or inferable data — recommend a targeted site assessment.',
      dataBasis: fieldSources.length ? fieldSources : ['no data available'],
      recommendations,
    };
  });

  return {
    propertyLabel: opts.propertyLabel || null,
    overallScore: assessment.overallScore,
    dataCompleteness: assessment.dataCompleteness,
    weakestCategories: assessment.weakestCategories,
    suggestedServices: assessment.suggestedServices,
    categories,
    generatedAt: new Date().toISOString(),
  };
}