/**
 * Site Condition Profile — normalized vector for the Plant Matching Engine.
 *
 * Built after fecundity + satellite/soil/wetlands so hardiness is the hard filter
 * and fecundity levers / microclimate act as soft scoring modifiers.
 *
 * Architecture:
 *   Site AOI + Fecundity Report → Site Condition Profile → Plant Matching Engine
 */

import { normalizePlantGoals } from './plant-goals.js';

/**
 * @param {object} site — siteInput / record-like (climate, soil, hydrology, terrain, vegetation)
 * @param {{
 *   fecundity?: object,
 *   hardiness?: object,
 *   soil_survey?: object,
 *   satellite?: object,
 *   wetlands?: object,
 *   wind_rose?: object,
 *   tree_cover?: object,
 *   goals?: string[],
 * }} extras
 */
export function buildSiteConditionProfile(site = {}, extras = {}) {
  const climate = site.climate || {};
  const soil = site.soil || {};
  const hydro = site.hydrology || {};
  const terrain = site.terrain || {};
  const veg = site.existing_vegetation || {};
  const fec = extras.fecundity || null;
  const ss = extras.soil_survey || site.soil_survey || null;
  const sat = extras.satellite || site.satellite || fec?.satellite || null;
  const wet = extras.wetlands || site.wetlands || fec?.wetlands || null;
  const smallWater = extras.small_water || site.small_water || fec?.smallWater || null;
  const wind = extras.wind_rose || site.wind_rose || null;
  const hard = extras.hardiness || site.hardiness || null;

  const zoneRaw =
    hard?.hardiness_zone ||
    climate.plant_hardiness_zone ||
    null;
  const zone = normalizeZone(zoneRaw) || '3a';

  // Microclimate zone push (± half step): sheltered/wetland edges warmer; frost pools colder
  const frostPool =
    extras.frostPoolingHint ||
    (terrain.landform_position === 'depression'
      ? 'high'
      : terrain.landform_position === 'valley_floor'
        ? 'moderate'
        : 'low');
  const windExposure =
    extras.windExposureHint ||
    (wind?.mean_speed_ms != null
      ? wind.mean_speed_ms >= 5
        ? 'open'
        : wind.mean_speed_ms >= 3.5
          ? 'partial'
          : 'sheltered'
      : extras.tree_cover?.tree_cover_pct > 40
        ? 'sheltered'
        : extras.tree_cover?.tree_cover_pct > 15
          ? 'partial'
          : 'open');

  let microclimatePush = 0; // zone index half-steps as 0.5
  if (frostPool === 'high') microclimatePush -= 0.5;
  else if (frostPool === 'moderate') microclimatePush -= 0.25;
  if (windExposure === 'sheltered') microclimatePush += 0.25;
  if (wet?.has_wetland_on_site || hydro.wetland_class) microclimatePush += 0.25;
  // Cap ±0.5 zone as specified
  microclimatePush = Math.max(-0.5, Math.min(0.5, microclimatePush));

  const effectiveZone = shiftZone(zone, microclimatePush);

  // Soil physical
  const texture =
    ss?.characteristics?.texture_class ||
    ss?.sample_summary?.texture_class ||
    soil.texture ||
    'loam';
  const drainage =
    ss?.characteristics?.drainage ||
    soil.drainage_class ||
    'well';
  const ph =
    num(ss?.characteristics?.ph_h2o_mean) ??
    num(ss?.sample_summary?.mean_ph) ??
    num(soil.ph);

  // Water regime
  const precip =
    num(hydro.annual_precipitation_mm) ??
    num(climate.annual_precipitation_mm) ??
    450;
  const moistureProxy =
    num(sat?.soil_moisture_proxy?.relative_index) ??
    num(sat?.ndmi?.median != null ? clamp01((sat.ndmi.median + 0.2) / 0.6) : null);
  const swSum = smallWater?.summary || {};
  let waterRegime = 'mesic';
  if (
    wet?.has_wetland_on_site ||
    swSum.has_confirmed_water ||
    (moistureProxy != null && moistureProxy >= 0.7)
  ) {
    waterRegime = 'wet';
  } else if (swSum.has_possible_small_water || (swSum.water_density_score || 0) > 0.35) {
    waterRegime = 'mesic_wet';
  } else if (precip < 350 || (moistureProxy != null && moistureProxy < 0.35)) {
    waterRegime = 'dry';
  } else if (precip > 550 || (moistureProxy != null && moistureProxy >= 0.55)) {
    waterRegime = 'mesic_wet';
  }

  // Fecundity lever scores
  const leverScores = {};
  const weakest = [];
  if (fec?.categories?.length) {
    for (const c of fec.categories) {
      if (c.category) leverScores[c.category] = c.score;
    }
  } else if (fec?.weakestCategories) {
    /* scores may only be in weakest */
  }
  for (const w of fec?.weakestCategories || []) {
    weakest.push({
      category: w.category,
      label: w.label,
      score: w.score,
    });
    if (leverScores[w.category] == null) leverScores[w.category] = w.score;
  }

  // Succession / vegetative structure
  const succession =
    veg.successional_stage ||
    mapLandCoverToSuccession(extras.landCoverClass) ||
    'early_successional';
  const ndviMedian = num(sat?.ndvi?.median) ?? num(sat?.ndviMedian);
  const vegetationVigor =
    sat?.vegetationVigor ||
    (ndviMedian != null
      ? ndviMedian >= 0.55
        ? 'high'
        : ndviMedian >= 0.35
          ? 'moderate'
          : ndviMedian >= 0.15
            ? 'low'
            : 'very_low'
      : null);
  const layersPresent = inferLayersPresent(succession, extras.tree_cover, vegetationVigor);
  const missingLayers = ['canopy', 'understory', 'shrub', 'herbaceous', 'groundcover', 'root'].filter(
    (l) => !layersPresent.includes(l)
  );

  // Goals — user selection (max food, max N, lowest cost, …) or weak-lever defaults
  let goals = normalizePlantGoals(extras.goals, {
    from_weak_levers: !extras.goals || (Array.isArray(extras.goals) && !extras.goals.length),
    weakest,
  });
  // Prefer wetland-edge species when small water / wetlands detected
  if (
    (swSum.has_confirmed_water || swSum.has_possible_small_water || wet?.has_wetland_on_site) &&
    !goals.includes('wetland_buffer')
  ) {
    if (goals.length === 1 && goals[0] === 'balanced') {
      goals = ['balanced', 'wetland_buffer'];
    } else if (!goals.includes('balanced')) {
      goals = [...goals, 'wetland_buffer'].slice(0, 8);
    }
  }

  const profile = {
    version: 'site-condition-profile-v1',
    hardiness: {
      zone,
      effective_zone: effectiveZone,
      microclimate_push: microclimatePush,
      frost_free_days: num(hard?.frost_free_days_estimate) ?? num(climate.frost_free_days) ?? 120,
      source: hard?.hardiness_zone ? 'NRCan plant hardiness' : 'climate / preset',
    },
    microclimate: {
      wind_exposure: windExposure,
      frost_pooling: frostPool,
      prevailing_wind: wind?.primary_direction || climate.prevailing_wind_direction || null,
      secondary_wind: wind?.secondary_direction || climate.secondary_wind_direction || null,
      mean_wind_speed_ms: wind?.mean_speed_ms ?? null,
      chinook_exposure: climate.chinook_exposure === true,
      aspect: terrain.aspect || null,
      slope_percent: num(terrain.slope_percent),
      landform_position: terrain.landform_position || null,
      wetland_proximity: wet?.has_wetland_on_site
        ? 'on_site'
        : wet?.nearest_wetland_distance_m != null && wet.nearest_wetland_distance_m < 200
          ? 'near'
          : 'distant',
      ndvi_vigor: vegetationVigor,
      ndvi_median: ndviMedian,
    },
    soil: {
      texture: normalizeTexture(texture),
      drainage: normalizeDrainage(drainage),
      ph,
      structure_score: leverScores.soilStructure ?? null,
      organic_matter_level: ss?.soil_zone_info?.organic_matter_level || null,
      soil_zone: ss?.land_system?.soil_zone || null,
      clay_pct: num(ss?.sample_summary?.mean_clay_pct) ?? num(ss?.characteristics?.clay_pct_mean),
      sand_pct: num(ss?.sample_summary?.mean_sand_pct) ?? num(ss?.characteristics?.sand_pct_mean),
    },
    water: {
      annual_precip_mm: precip,
      regime: waterRegime,
      infiltration_retention_score: leverScores.water ?? null,
      wetland_on_site: !!(wet?.has_wetland_on_site || hydro.wetland_class),
      wetland_types: wet?.wetland_types || (hydro.wetland_class ? [hydro.wetland_class] : []),
      moisture_proxy: moistureProxy,
      small_water: {
        has_confirmed: !!swSum.has_confirmed_water,
        has_possible: !!swSum.has_possible_small_water,
        density_score: swSum.water_density_score ?? null,
        nearest_m: swSum.nearest_water_distance_m ?? null,
        confirmed_area_m2: swSum.total_confirmed_area_m2 ?? null,
        possible_area_m2: swSum.total_possible_area_m2 ?? null,
      },
    },
    nutrient_biology: {
      nutrient_score: leverScores.soilBiology ?? null,
      biology_score: leverScores.soilBiology ?? null,
      status: leverScores.soilBiology == null ? 'unknown' : 'inferred',
    },
    vegetation: {
      successional_stage: succession,
      vegetative_structure_score: leverScores.vegetativeStructure ?? null,
      layers_present: layersPresent,
      missing_layers: missingLayers,
      cover_type: veg.cover_type || null,
      tree_cover_pct: extras.tree_cover?.tree_cover_pct ?? null,
    },
    fauna: {
      score: leverScores.faunaIntegration ?? null,
    },
    fecundity: {
      overall: fec?.overallScore ?? null,
      completeness: fec?.dataCompleteness ?? null,
      lever_scores: leverScores,
      weakest,
    },
    goals,
    footprint_ha: Math.max(num(site.footprint_ha) || 0.1, 0.01),
    _meta: {
      generated_at: new Date().toISOString(),
      sources: [
        'NRCan hardiness / climate',
        'AGRASID/AGRASIS + SoilGrids samples',
        'Fecundity levers',
        sat?.available ? 'Sentinel-2 / SoilGrids satellite' : null,
        wet?.available || wet?.has_wetland_on_site != null ? 'AMWI wetlands' : null,
        wind?.available ? 'NASA POWER wind' : null,
      ].filter(Boolean),
    },
  };

  return profile;
}

function inferLayersPresent(succession, treeCover, vigor) {
  const layers = ['herbaceous'];
  const cover = num(treeCover?.tree_cover_pct) ?? 0;
  if (cover > 5 || succession === 'mid_successional' || succession === 'climax') {
    layers.push('shrub');
  }
  if (cover > 15 || succession === 'climax') layers.push('canopy', 'understory');
  if (cover > 25) layers.push('groundcover');
  if (vigor === 'high' || vigor === 'moderate') {
    if (!layers.includes('groundcover')) layers.push('groundcover');
  }
  // Roots always "present" as soil
  layers.push('root');
  return [...new Set(layers)];
}

function mapLandCoverToSuccession(lc) {
  if (!lc) return null;
  const m = {
    bare: 'pioneer',
    cropland: 'early_successional',
    grassland: 'early_successional',
    tame_pasture: 'early_successional',
    shrubland: 'mid_successional',
    forest: 'climax',
    wetland_vegetation: 'mid_successional',
  };
  return m[lc] || null;
}

function normalizeTexture(t) {
  if (!t) return 'loam';
  const s = String(t).toLowerCase().replace(/-/g, ' ').trim();
  if (s.includes('sand') && s.includes('loam')) return 'sandy_loam';
  if (s.includes('clay') && s.includes('loam')) return 'clay_loam';
  if (s.includes('silt')) return 'silt_loam';
  if (s.includes('clay')) return 'clay';
  if (s.includes('sand') && !s.includes('loam')) return 'sand';
  if (s.includes('loam')) return 'loam';
  return s.replace(/\s+/g, '_');
}

function normalizeDrainage(d) {
  if (!d) return 'well';
  const s = String(d).toLowerCase().replace(/-/g, '_').replace(/\s+/g, '_');
  if (s.includes('rapid') || s.includes('excessive')) return 'rapid';
  if (s.includes('moderately') || s.includes('mod_well')) return 'moderately_well';
  if (s.includes('imperfect') || s.includes('somewhat')) return 'imperfect';
  if (s.includes('poor') && !s.includes('imperfect')) return 'poor';
  if (s.includes('well')) return 'well';
  return s;
}

const ZONE_ORDER = [
  '1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', '5a', '5b',
  '6a', '6b', '7a', '7b', '8a', '8b', '9a', '9b',
];

export function normalizeZone(z) {
  if (!z) return null;
  const s = String(z).trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})([ab])?$/);
  if (!m) return s;
  return `${m[1]}${m[2] || 'a'}`;
}

export function zoneIndex(z) {
  const n = normalizeZone(z);
  const i = ZONE_ORDER.indexOf(n);
  if (i >= 0) return i;
  const m = String(n || '').match(/^(\d+)/);
  return m ? ZONE_ORDER.indexOf(`${m[1]}a`) : 6;
}

/** Shift zone by half-steps (e.g. +0.5 → one sub-zone warmer). */
export function shiftZone(zone, halfSteps) {
  const i = zoneIndex(zone);
  if (i < 0) return zone;
  // halfSteps of 0.5 → +1 index
  const delta = Math.round(halfSteps * 2);
  const j = Math.max(0, Math.min(ZONE_ORDER.length - 1, i + delta));
  return ZONE_ORDER[j];
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export { ZONE_ORDER };
