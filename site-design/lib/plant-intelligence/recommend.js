import { loadCanonical } from './store.js';
import { scorePlant, DEFAULT_WEIGHTS } from './suitability.js';
import { enrichRecommendation, rankRecommendations } from './economics.js';

const PURPOSE_FILTERS = {
  food: (p) => p.uses?.edible === true || /fruit|nut|crop|vegetable/i.test(p.taxon?.common_names?.[0] || ''),
  fruit: (p) => p.uses?.edible === true || /fruit|berry|apple|plum|cherry/i.test(`${p.taxon?.common_names?.[0]} ${p.morphology?.growth_form}`),
  nut: (p) => /nut|hazel|walnut|oak/i.test(p.taxon?.common_names?.[0] || p.taxon?.scientific_name || ''),
  shade: (p) => /tree|canopy/i.test(p.morphology?.growth_form || ''),
  privacy: (p) => /shrub|tree|hedge/i.test(p.morphology?.growth_form || ''),
  windbreak: (p) => /tree|shrub/i.test(p.morphology?.growth_form || ''),
  pollinator: (p) => p.ecology?.pollinator_value || p.uses?.pollinator === true,
  native: (p) => (p.ecology?.native_regions || []).length > 0,
  ornamental: (p) => p.uses?.ornamental === true,
  'erosion-control': (p) => p.ecology?.erosion_control || p.uses?.erosion_control === true,
  wildlife: (p) => p.ecology?.wildlife_value || p.uses?.wildlife === true,
};

export function siteFromQuery(q = {}) {
  const n = (k) => (q[k] != null && q[k] !== '' ? Number(q[k]) : null);
  return {
    property_id: q.property_id || null,
    latitude: n('latitude'),
    longitude: n('longitude'),
    elevation_m: n('elevation_m') ?? n('elevation'),
    annual_solar_kwh_m2: n('annual_solar_kwh_m2'),
    growing_season_solar_kwh_m2: n('growing_season_solar_kwh_m2'),
    temperature_min_c: n('temperature_min_c'),
    temperature_max_c: n('temperature_max_c'),
    annual_precipitation_mm: n('annual_precipitation_mm'),
    growing_degree_days: n('growing_degree_days'),
    frost_free_days: n('frost_free_days'),
    soil_ph: n('soil_ph'),
    soil_texture: q.soil_texture || null,
    soil_drainage: q.soil_drainage || null,
    soil_moisture: q.soil_moisture || null,
    available_rooting_depth_cm: n('available_rooting_depth_cm'),
    available_space_m: n('available_space_m') ?? n('radius'),
    available_vertical_m: n('available_vertical_m'),
    hardiness_zone: q.hardiness_zone || null,
    region: q.region || 'Alberta',
    light_class: q.light_class || null,
  };
}

export function recommendPlants(site = {}, opts = {}) {
  const db = opts.db || loadCanonical();
  const plants = db.plants || [];
  const max = Number(opts.max_results) || 20;
  const purpose = opts.purpose || null;
  const filt = purpose && PURPOSE_FILTERS[purpose];
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };

  const ranked = [];
  for (const plant of plants) {
    if (filt && !filt(plant)) continue;
    const row = scorePlant(plant, site, weights);
    if (row.hard_fail) continue;
    ranked.push({
      ...row,
      family: plant.taxon?.family || null,
      growth_form: plant.morphology?.growth_form || null,
      provenance: (plant.provenance || []).slice(0, 8),
    });
  }
  ranked.sort((a, b) => b.suitability - a.suitability || b.confidence - a.confidence);
  const plantById = Object.fromEntries(plants.map((p) => [p.taxon?.id, p]));
  const composite = ranked.map((bio) => {
    const plant = plantById[bio.taxon_id];
    return plant ? enrichRecommendation(plant, bio, site) : { biological: bio, plant: { taxon_id: bio.taxon_id, scientific_name: bio.scientific_name, common_name: bio.common_name } };
  });
  const mode = opts.rank || opts.ranking || 'overall';
  const ordered = rankRecommendations(composite, mode).slice(0, max);
  return {
    location: site,
    catalog_size: plants.length,
    scored: ranked.length,
    rank: mode,
    ranking_modes: ['biological', 'cost', 'return', 'utility_per_dollar', 'food', 'overall'],
    recommendations: ordered,
    engine: 'plant-intelligence-3d-economics-v1',
    note: 'Biological suitability, commercial cost, market return, and landscape utility are scored separately.',
  };
}
