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

  // Water — AMWI inventory preferred over coarse land-cover wetland flags
  if (rawData.topoData?.avgSlopePercent != null)
    set('avgSlopePercent', rawData.topoData.avgSlopePercent, 'high — topography');
  if (rawData.hasPondOrWetlandInventory != null) {
    set(
      'hasPondOrWetlandInventory',
      rawData.hasPondOrWetlandInventory,
      'high — Alberta Merged Wetland Inventory'
    );
  }
  // Prefer real detections (inventory / optical) over pure land-cover for hasPondOrWetland
  if (rawData.hasPondOrWetlandInventory === true) {
    set('hasPondOrWetland', true, 'high — Alberta Merged Wetland Inventory');
  } else if (rawData.hasPondOrDugout === true || rawData.satelliteOpenWater === true) {
    set(
      'hasPondOrWetland',
      true,
      'medium-high — confirmed open water (inventory/optical screening, not regulatory wetland)'
    );
  } else if (rawData.hasSmallWaterOrSeep === true) {
    set(
      'hasPondOrWetland',
      true,
      'low-medium — possible small water/seep; field verification recommended'
    );
  } else if (rawData.hasPondOrWetlandInventory === false && rawData.hasPondOrDugout === false) {
    set(
      'hasPondOrWetland',
      false,
      'medium — no inventory or optical open water on AOI (land-cover may still flag moisture)'
    );
  } else if (rawData.wetlandsPresent != null) {
    set('hasPondOrWetland', rawData.wetlandsPresent, 'moderate — wetlands layer / land-cover fallback');
  }
  if (rawData.wetlandAreaHa != null)
    set('wetlandAreaHa', rawData.wetlandAreaHa, 'high — AMWI polygon area');
  if (rawData.wetlandProximityBoost != null)
    set(
      'wetlandProximityBoost',
      rawData.wetlandProximityBoost,
      'high — AMWI proximity'
    );
  if (rawData.wetlandHabitatPresent != null)
    set(
      'wetlandHabitatPresent',
      rawData.wetlandHabitatPresent,
      'high — AMWI habitat screen'
    );
  if (rawData.wetlandTypes?.length)
    set('wetlandTypes', rawData.wetlandTypes, 'high — AMWI CWCS class');
  if (rawData.soilMoistureProxy != null)
    set(
      'soilMoistureProxy',
      rawData.soilMoistureProxy,
      'low-moderate — Sentinel-1 / NDMI moisture proxy'
    );
  if (rawData.hasSmallWaterOrSeep != null)
    set(
      'hasSmallWaterOrSeep',
      rawData.hasSmallWaterOrSeep,
      'low-medium — S2 NDWI/MNDWI + optional S1/TWI (site walk recommended)'
    );
  if (rawData.hasPondOrDugout != null)
    set(
      'hasPondOrDugout',
      rawData.hasPondOrDugout,
      'medium — optical/inventory open water screening'
    );
  if (rawData.satelliteOpenWater != null)
    set(
      'satelliteOpenWater',
      rawData.satelliteOpenWater,
      'medium — Sentinel-2 water index'
    );
  if (rawData.smallWaterDensity != null)
    set(
      'smallWaterDensity',
      rawData.smallWaterDensity,
      'low-medium — water density score (screening)'
    );
  if (rawData.smallWaterConfirmedAreaM2 != null)
    set(
      'smallWaterConfirmedAreaM2',
      rawData.smallWaterConfirmedAreaM2,
      'medium — confirmed open-water area m²'
    );
  if (rawData.smallWaterPossibleAreaM2 != null)
    set(
      'smallWaterPossibleAreaM2',
      rawData.smallWaterPossibleAreaM2,
      'low-medium — possible seeps/depressions m²'
    );
  if (rawData.smallWaterNearestM != null)
    set(
      'smallWaterNearestM',
      rawData.smallWaterNearestM,
      'medium — nearest detected water distance (m)'
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
  const hasWetlands = !!(
    rawData.wetlands?.available ||
    rawData.hasPondOrWetlandInventory != null ||
    rawData.wetlandsPresent
  );

  const categories = Object.keys(CATEGORIES).map((key) => {
    const cfg = CATEGORIES[key];
    const score = assessment.categoryScores[key];
    const band = score !== null ? scoreBand(score) : null;

    const fieldSources = cfg.indicators
      .flatMap((ind) => ind.fields)
      .filter((f) => provenance[f])
      .map((f) => `${f}: ${provenance[f]}`);

    let recommendations =
      score !== null && score < 70
        ? cfg.suggestedServices.map((id) => ({
            serviceId: id,
            rationale: SERVICE_RATIONALE[id] || 'addresses this lever directly.',
          }))
        : [];

    // Wetland-specific guidance on water / fauna levers
    if (key === 'water' && rawData.hasPondOrWetlandInventory === true) {
      recommendations = [
        {
          serviceId: 'wetland_protect',
          rationale:
            'Mapped wetland intersects the parcel — keep earthworks clear and enhance the wet edge with native moisture-loving species.',
        },
        ...recommendations.filter((r) => r.serviceId !== 'swale' && r.serviceId !== 'pond'),
      ];
    } else if (
      key === 'water' &&
      (rawData.hasSmallWaterOrSeep || rawData.smallWater?.summary?.has_possible_small_water) &&
      !rawData.hasPondOrWetlandInventory
    ) {
      recommendations = [
        {
          serviceId: 'assessment',
          rationale:
            'Possible small water or seeps detected — field verification recommended before relying on water features in design.',
        },
        ...recommendations,
      ];
    }

    let narrative =
      score !== null
        ? band.tone
        : 'No measured or inferable data — recommend a targeted site assessment.';

    if (key === 'water') {
      narrative = waterLeverNarrative(rawData, narrative);
    }
    if (key === 'microclimate' || key === 'faunaIntegration') {
      narrative = microclimateFaunaWaterNote(rawData, key, narrative);
    }

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

  // CLAIMS envelope — SOC never numeric from satellite alone; wetlands not regulatory
  const claims = [
    ...(Array.isArray(rawData.satelliteClaims) ? rawData.satelliteClaims : []),
    ...(Array.isArray(rawData.wetlands?.claims) ? rawData.wetlands.claims : []),
    ...(Array.isArray(rawData.smallWater?.claims) ? rawData.smallWater.claims : []),
  ];

  const regionalContext =
    rawData.regionalSocContext ||
    rawData.satellite?.regional_soc ||
    claims.find((c) => c.field === 'soil_organic_carbon')?.regional_context ||
    null;

  const bits = [];
  if (hasSatellite) {
    bits.push(
      'Satellite vegetation indices improve vegetative and water screening but do not replace soil tests for carbon or biology'
    );
  }
  if (hasWetlands) {
    bits.push(
      'Wetland inventory polygons improve water, microclimate, and fauna inferences for screening only — not a formal Alberta Wetland Policy delineation'
    );
  }
  if (rawData.smallWater?.summary?.has_possible_small_water || rawData.hasSmallWaterOrSeep) {
    bits.push(
      'Small water / seep detections are screening only — site walk recommended; not permanent water or regulatory wetlands'
    );
  }
  bits.push('A site walk remains the high-confidence path for design and regulatory decisions');
  const disclaimer =
    bits.join('. ') +
    (hasSatellite || hasWetlands
      ? '.'
      : ' This fecundity score is inferred from topography, soil survey, canopy cover, land-cover class, and regional wildlife observations.');

  // Explicit water-feature summary for UI / planting
  const waterFeatureSummary = buildWaterFeatureSummary(rawData);

  return {
    propertyLabel: opts.propertyLabel || null,
    overallScore: assessment.overallScore,
    dataCompleteness: assessment.dataCompleteness,
    weakestCategories: assessment.weakestCategories,
    suggestedServices: assessment.suggestedServices,
    waterFeatureSummary,
    categories,
    interventionValue,
    satellite: rawData.satellite || null,
    wetlands: rawData.wetlands || null,
    smallWater: rawData.smallWater || null,
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

/**
 * Water lever narrative: confirmed vs possible small water + inventory.
 */
function waterLeverNarrative(rawData, base) {
  const parts = [];
  const sw = rawData.smallWater?.summary || {};
  const w = rawData.wetlands;

  if (w?.has_wetland_on_site) {
    parts.push(
      `Confirmed water features detected: mapped wetland on site (${(w.wetland_types || []).join(', ') || 'classed'}${
        w.wetland_area_ha != null ? ` · ~${w.wetland_area_ha} ha` : ''
      }). Inventory screening only — not a formal delineation.`
    );
  } else if (rawData.hasPondOrDugout || sw.has_confirmed_water) {
    const area = sw.total_confirmed_area_m2;
    const near = sw.nearest_water_distance_m;
    parts.push(
      `Confirmed water features detected${area != null ? ` (~${area} m² open-water signature)` : ''}${
        near != null && near > 0 ? ` · nearest ~${near} m` : near === 0 ? ' on/near parcel' : ''
      }. Screening from inventory and/or Sentinel-2 — not a permanent-water guarantee.`
    );
  }

  if (sw.has_possible_small_water || (rawData.hasSmallWaterOrSeep && !rawData.hasPondOrDugout && !w?.has_wetland_on_site)) {
    parts.push(
      'Possible small water sources or seeps detected (low-medium confidence) — site walk recommended to verify.'
    );
  }

  if (!parts.length && w?.nearest_wetland_distance_m != null && !w.has_wetland_on_site) {
    parts.push(`No AMWI wetland on the parcel; nearest mapped wetland ~${w.nearest_wetland_distance_m} m.`);
  }

  if (!parts.length) return base;
  return `${parts.join(' ')} ${base}`;
}

function microclimateFaunaWaterNote(rawData, key, base) {
  const sw = rawData.smallWater?.summary || {};
  if (rawData.hasPondOrDugout || sw.has_confirmed_water || rawData.hasPondOrWetlandInventory) {
    const note =
      key === 'microclimate'
        ? ' Nearby open water can raise local humidity and moderate temperature swings (medium confidence).'
        : ' Open water or wetland edge increases habitat potential for amphibians, invertebrates, and waterfowl (medium confidence).';
    return base + note;
  }
  if (rawData.hasSmallWaterOrSeep || sw.has_possible_small_water) {
    const note =
      key === 'microclimate'
        ? ' Possible seeps/wet depressions may slightly raise local moisture (low-medium confidence — verify on site).'
        : ' Possible small water may support edge habitat if confirmed (low-medium confidence — field verification recommended).';
    return base + note;
  }
  return base;
}

function buildWaterFeatureSummary(rawData) {
  const sw = rawData.smallWater?.summary || {};
  const confirmed =
    !!rawData.hasPondOrWetlandInventory ||
    !!rawData.hasPondOrDugout ||
    !!sw.has_confirmed_water ||
    !!rawData.wetlands?.has_wetland_on_site;
  const possible =
    !!sw.has_possible_small_water ||
    (!!rawData.hasSmallWaterOrSeep && !confirmed);

  const lines = [];
  if (confirmed) {
    lines.push(
      'Confirmed water features detected (inventory and/or optical open-water screening). Not a regulatory wetland delineation or permanent-water guarantee.'
    );
  }
  if (possible) {
    lines.push(
      'Possible small water sources or seeps detected (low-medium confidence) — site walk recommended to verify.'
    );
  }
  if (!confirmed && !possible) {
    lines.push(
      'No confirmed open water or small-water detections on the AOI. Water lever may still use precipitation, slope, and moisture proxies.'
    );
  }

  return {
    has_confirmed: confirmed,
    has_possible: possible,
    nearest_m: sw.nearest_water_distance_m ?? rawData.smallWaterNearestM ?? null,
    confirmed_area_m2: sw.total_confirmed_area_m2 ?? rawData.smallWaterConfirmedAreaM2 ?? null,
    possible_area_m2: sw.total_possible_area_m2 ?? rawData.smallWaterPossibleAreaM2 ?? null,
    density_score: sw.water_density_score ?? rawData.smallWaterDensity ?? null,
    lines,
    field_verification_recommended: possible || (!confirmed && !!rawData.hasSmallWaterOrSeep),
  };
}
