/**
 * Expanding Edge Permaculture — Fecundity Report Generator
 * -------------------------------------------------------------
 * Sits on top of fecundity_assessment.js. Takes whatever RAW data
 * the pipeline has collected — direct site measurements plus the
 * broader data sources already wired into this pipeline (topography,
 * regional soil survey, land cover, wildlife pulls) — infers
 * reasonable estimates for indicators that weren't directly
 * measured, then produces a client-facing narrative report per
 * lever with a clear MEASURED vs INFERRED vs UNKNOWN tag on every
 * data point, so nothing is presented with more certainty than it
 * deserves.
 *
 * Requires fecundity_assessment.js in the same environment
 * (Node: require both; browser: load both <script> tags in order).
 * -------------------------------------------------------------
 */

const FecundityAssessment =
  (typeof require !== 'undefined') ? require('./fecundity_assessment.js') :
  (typeof window !== 'undefined') ? window.FecundityAssessment : null;

// ---------------------------------------------------------------
// Inference layer
// ---------------------------------------------------------------
// Takes a broader `rawData` object (see shape below) and returns
// { siteData, provenance } where siteData matches the shape
// fecundity_assessment.js expects, and provenance records how each
// field was obtained: 'measured' (from an actual site test),
// 'inferred' (derived from a broader data source below), or absent
// entirely if nothing was available.
//
// Expected rawData shape (all optional):
//   measured: { ...any fecundity_assessment.js siteData fields
//                collected directly on-site, e.g. from soil tests }
//   topoData: { avgSlopePercent, contourLines, ... }              — from the topography/LiDAR pipeline
//   regionalSoilTexture: 'loam' | 'sandy' | 'clay' | ...          — from a soil survey lookup (e.g. AGRASID) for the area
//   ndviCoverPct: number (0-100)                                  — canopy/vegetation cover from multispectral imagery
//   landCoverClass: 'grassland'|'shrubland'|'forest'|'cropland'|'bare' — from a land-cover layer (e.g. ABMI)
//   wildlifeObservations: string[]                                — species names from the wildlife-data pull step
//   windExposureHint: 'open'|'partial'|'sheltered'                — from tree-cover density / topography shielding
// ---------------------------------------------------------------
function inferIndicators(rawData = {}) {
  const measured = rawData.measured || {};
  const siteData = { ...measured };
  const provenance = {};
  Object.keys(measured).forEach(k => { provenance[k] = 'measured'; });

  const setIfMissing = (key, value, confidence) => {
    if (siteData[key] === undefined && value !== undefined && value !== null) {
      siteData[key] = value;
      provenance[key] = `inferred (${confidence})`;
    }
  };

  // --- Water ---
  if (rawData.topoData?.avgSlopePercent !== undefined) {
    setIfMissing('avgSlopePercent', rawData.topoData.avgSlopePercent, 'high confidence — direct topography reading');
  }

  // --- Soil structure ---
  if (rawData.regionalSoilTexture) {
    setIfMissing('soilTexture', rawData.regionalSoilTexture, 'moderate confidence — regional soil survey, not a site-specific sample');
  }

  // --- Vegetative structure ---
  if (rawData.ndviCoverPct !== undefined) {
    setIfMissing('bareGroundPct', Math.max(0, 100 - rawData.ndviCoverPct), 'moderate confidence — derived from canopy cover imagery, not a ground survey');
  }
  if (rawData.landCoverClass) {
    const stageMap = { bare: 'bare', cropland: 'pioneer', grassland: 'pioneer', shrubland: 'intermediate', forest: 'climax' };
    setIfMissing('successionalStage', stageMap[rawData.landCoverClass], 'low-moderate confidence — coarse land-cover classification');
    const layerMap = { bare: 0, cropland: 1, grassland: 1, shrubland: 3, forest: 5 };
    setIfMissing('observedLayerCount', layerMap[rawData.landCoverClass], 'low confidence — estimated from land-cover class, not a field walk');
  }

  // --- Fauna integration ---
  if (Array.isArray(rawData.wildlifeObservations)) {
    const predators = ['fox', 'red fox', 'coyote', 'hawk', 'red-tailed hawk', 'owl', 'great horned owl', 'eagle', 'bald eagle'];
    const pollinatorIndicators = ['bee', 'bumblebee', 'butterfly', 'hummingbird'];
    const obs = rawData.wildlifeObservations.map(s => s.toLowerCase());
    setIfMissing('naturalPredatorPresence', predators.some(p => obs.includes(p)), 'moderate confidence — recent regional wildlife observations, not confirmed on-property');
    setIfMissing('pollinatorActivityObserved', pollinatorIndicators.some(p => obs.some(o => o.includes(p))), 'low confidence — inferred from regional species records only');
  }

  // --- Microclimate ---
  if (rawData.windExposureHint) {
    setIfMissing('windExposure', rawData.windExposureHint, 'moderate confidence — derived from tree cover/topography, not a wind-rose measurement');
  }

  return { siteData, provenance };
}

// ---------------------------------------------------------------
// Narrative generation
// ---------------------------------------------------------------
function scoreBand(score) {
  if (score >= 80) return { label: 'Strong', tone: 'This lever is working well — the main task here is maintaining current conditions, not overhauling them.' };
  if (score >= 60) return { label: 'Solid, with room to optimize', tone: 'This lever is functioning adequately but has clear headroom for improvement.' };
  if (score >= 35) return { label: 'Below average', tone: 'This is a meaningful limiting factor on the property\'s overall productivity right now.' };
  return { label: 'Needs significant improvement', tone: 'This is currently one of the biggest constraints on what the land can produce.' };
}

const SERVICE_RATIONALE = {
  swale: 'captures and slows runoff so water infiltrates instead of leaving the property, directly improving both the water and soil-structure levers.',
  pond: 'adds a passive water reserve and raises local humidity, supporting the water and microclimate levers together.',
  shelterbelt: 'reduces wind exposure and evapotranspiration while adding a nitrogen-fixing planting layer — a rare intervention that helps microclimate, nutrient cycling, and fauna integration all at once.',
  foodforest: 'builds vegetative layering and long-term soil biology through a designed polyculture, the most direct lever for the vegetative-structure and soil-biology scores.',
  assessment: 'establishes a measured baseline where one doesn\'t exist yet — useful when a lever\'s data is currently only inferred.'
};

/**
 * Build a full client-facing fecundity report.
 * @param {object} rawData - see inferIndicators() above for shape.
 * @param {object} [opts]
 * @param {string} [opts.propertyLabel]
 * @returns {object} structured report; pass to renderReportMarkdown() for client-ready text.
 */
function generateFecundityReport(rawData = {}, opts = {}) {
  const { siteData, provenance } = inferIndicators(rawData);
  const assessment = FecundityAssessment.assessFecundity(siteData);

  const categories = Object.keys(FecundityAssessment.CATEGORIES).map(key => {
    const cfg = FecundityAssessment.CATEGORIES[key];
    const score = assessment.categoryScores[key];
    const band = score !== null ? scoreBand(score) : null;

    // which fields in this category actually had data, and how
    const fieldSources = cfg.indicators
      .flatMap(ind => ind.fields)
      .filter(f => provenance[f])
      .map(f => `${f}: ${provenance[f]}`);

    const recommendations = score !== null && score < 70
      ? cfg.suggestedServices.map(id => ({
          serviceId: id,
          rationale: SERVICE_RATIONALE[id] || 'addresses this lever directly.'
        }))
      : [];

    return {
      category: key,
      label: cfg.label,
      score,
      status: band ? band.label : 'Insufficient data',
      narrative: score !== null
        ? band.tone
        : 'No measured or inferable data was available for this lever — recommend a targeted site assessment before drawing conclusions.',
      dataBasis: fieldSources.length ? fieldSources : ['no data available'],
      recommendations
    };
  });

  return {
    propertyLabel: opts.propertyLabel || null,
    overallScore: assessment.overallScore,
    dataCompleteness: assessment.dataCompleteness,
    categories,
    generatedAt: new Date().toISOString()
  };
}

/** Render a generateFecundityReport() result as client-ready Markdown. */
function renderReportMarkdown(report) {
  const lines = [];
  lines.push(`# Land Fecundity Report${report.propertyLabel ? ' — ' + report.propertyLabel : ''}`);
  lines.push('');
  lines.push(report.overallScore !== null
    ? `**Overall fecundity score: ${report.overallScore}/100** (based on ${report.dataCompleteness}% of possible indicators — see notes below on what's measured vs. estimated)`
    : '**Overall score unavailable** — not enough data was collected or inferable yet.');
  lines.push('');

  report.categories
    .slice()
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
    .forEach(cat => {
      lines.push(`## ${cat.label}${cat.score !== null ? ` — ${cat.score}/100 (${cat.status})` : ' — insufficient data'}`);
      lines.push(cat.narrative);
      lines.push('');
      lines.push(`*Basis: ${cat.dataBasis.join('; ')}*`);
      if (cat.recommendations.length) {
        lines.push('');
        lines.push('**Suggested next steps:**');
        cat.recommendations.forEach(r => lines.push(`- **${r.serviceId}** — ${r.rationale}`));
      }
      lines.push('');
    });

  lines.push('---');
  lines.push('*This report combines direct site measurements with inferred estimates from regional and remote data sources where a direct measurement wasn\'t yet taken. Inferred figures are planning-level estimates, not substitutes for a targeted site test.*');

  return lines.join('\n');
}

const FecundityReport = { inferIndicators, generateFecundityReport, renderReportMarkdown };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FecundityReport;
}
if (typeof window !== 'undefined') {
  window.FecundityReport = FecundityReport;
}
