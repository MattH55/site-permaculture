/**
 * Phase 4 — plant recommendations share the same value taxonomy
 * as placement (lib/recommendation-values.js).
 *
 * Eligibility/scoring stays EcoCrop-style in planting.js; this module
 * only frames outcomes (food, N-fix, windbreak, soil, etc.).
 */

import {
  VALUE_TAXONOMY,
  valueLabel,
  recommendationPriority,
} from './recommendation-values.js';

/** Species / id hints that primarily deliver wind or shelter. */
const WINDBREAK_RE =
  /caragana|sea.?buckthorn|buffalo.?berry|wolf.?willow|willow|poplar|aspen|spruce|pine|larch|shelter|windbreak|hedge|green.?ash|manchurian/i;

const MEDICINAL_RE =
  /medicinal|echinacea|yarrow|calendula|chamomile|mint|thyme|oregano|sage|lavender|comfrey|valerian|st\.?\s*john|nettle|lemon.?balm/i;

const SOIL_RE =
  /clover|vetch|alfalfa|buckwheat|rye|oat cover|field.?pea|fava|lupine|mustard cover|cover.?crop/i;

/**
 * Assign primary/secondary values for a scored plant or catalog crop.
 * @param {object} plant — crop row or scored planting recommendation
 * @returns {{ primary_value: string, secondary_values: string[], value_headline: string, technique_label: string }}
 */
export function enrichPlantValues(plant = {}) {
  const name = `${plant.common_name || ''} ${plant.scientific_name || ''} ${plant.id || ''}`;
  const cat = String(plant.category || '').toLowerCase();
  const layer = String(plant.guild_layer || '').toLowerCase();
  const notes = String(plant.notes || '');
  const nFix =
    plant.nitrogen_fixer === true ||
    plant.plant_specs?.nitrogen_fixer === true;
  const edible =
    plant.edibility_rating != null ||
    plant.plant_specs?.edibility_rating != null ||
    plant.plant_specs?.edible === true ||
    /fruit|berry|vegetable|nut|grain|orchard|edible/i.test(name + notes);
  const foodForest =
    plant.food_forest === true || plant.plant_specs?.food_forest === true;

  let primary = 'food_production';
  let secondary = [];

  if (cat === 'cover_crop' || SOIL_RE.test(name + notes)) {
    primary = nFix ? 'nitrogen_fixing' : 'soil_building';
    secondary = nFix
      ? ['soil_building', 'biodiversity']
      : ['nitrogen_fixing', 'biodiversity'];
  } else if (WINDBREAK_RE.test(name) || /windbreak|shelterbelt/i.test(notes)) {
    primary = 'wind_protection';
    secondary = ['snow_management', 'biodiversity', 'microclimate'];
    if (nFix) secondary.unshift('nitrogen_fixing');
  } else if (
    cat === 'herb' ||
    MEDICINAL_RE.test(name + notes) ||
    cat === 'medicinal'
  ) {
    primary = 'medicinal';
    secondary = ['beauty_access', 'biodiversity'];
    if (edible) secondary.push('food_production');
  } else if (nFix && (cat === 'shrub' || cat === 'tree' || layer === 'shrub')) {
    primary = 'nitrogen_fixing';
    secondary = ['soil_building', 'biodiversity'];
    if (edible) secondary.push('food_production');
  } else if (cat === 'tree' && layer === 'canopy') {
    primary = edible ? 'food_production' : 'shade';
    secondary = edible
      ? ['shade', 'microclimate', 'biodiversity']
      : ['microclimate', 'biodiversity'];
  } else if (foodForest || cat === 'shrub' || cat === 'tree' || cat === 'vine') {
    primary = edible ? 'food_production' : 'biodiversity';
    secondary = edible
      ? ['biodiversity', 'soil_building']
      : ['beauty_access', 'microclimate'];
  } else if (cat === 'groundcover' || layer === 'groundcover') {
    primary = 'soil_building';
    secondary = ['biodiversity', 'beauty_access'];
  } else if (edible || cat === 'vegetable' || cat === 'fruit' || cat === 'annual') {
    primary = 'food_production';
    secondary = ['beauty_access'];
  } else {
    primary = 'biodiversity';
    secondary = ['beauty_access'];
  }

  if (plant.alberta_native) {
    secondary = unique([...secondary, 'biodiversity']);
  }

  secondary = secondary.filter((v) => v !== primary).slice(0, 3);

  return {
    primary_value: primary,
    secondary_values: secondary,
    value_headline: buildPlantValueHeadline(plant, primary),
    technique_label: plant.common_name || plant.id || 'Plant',
  };
}

/**
 * @param {object} plant
 * @param {string} primary
 */
export function buildPlantValueHeadline(plant, primary) {
  const name = plant.common_name || 'This plant';
  const zone =
    plant.hardiness_min || plant.hardiness_max
      ? ` (zones ${plant.hardiness_min || '?'}${
          plant.hardiness_max ? `–${plant.hardiness_max}` : ''
        })`
      : '';

  switch (primary) {
    case 'nitrogen_fixing':
      return `${name} fixes nitrogen to build fertility without synthetic N${zone}.`;
    case 'soil_building':
      return `${name} builds organic matter and soil structure on this parcel${zone}.`;
    case 'wind_protection':
      return `${name} anchors multi-row shelter and buffers wind and snow${zone}.`;
    case 'medicinal':
      return `${name} supplies kitchen-pharmacy and herbal diversity in Zone 1–2${zone}.`;
    case 'shade':
      return `${name} creates canopy shade and microclimate for understory guilds${zone}.`;
    case 'biodiversity':
      return `${name} supports pollinators, wildlife, and system resilience${zone}.`;
    case 'food_production':
    default:
      return `${name} delivers hardy food yield suited to this site’s climate${zone}.`;
  }
}

/**
 * Group plants by primary_value (same shape spirit as placement by_value).
 * @param {object[]} plants
 */
export function groupPlantsByValue(plants = []) {
  const by_value = {};
  const ordered = [...plants].sort(
    (a, b) =>
      (b.score || 0) - (a.score || 0) ||
      (a.priority ?? 9) - (b.priority ?? 9)
  );
  for (const p of ordered) {
    const v = p.primary_value || 'food_production';
    if (!by_value[v]) by_value[v] = [];
    by_value[v].push(p);
  }
  const value_counts = Object.entries(by_value)
    .map(([id, list]) => ({
      id,
      label: valueLabel(id),
      count: list.length,
      min_priority: Math.min(
        ...list.map((x) => x.priority ?? recommendationPriority({ primary_value: id }))
      ),
    }))
    .sort((a, b) => a.min_priority - b.min_priority || b.count - a.count);

  return { by_value, value_counts, priority_ordered: ordered };
}

/**
 * Filter plants by primary or secondary value.
 * @param {object[]} plants
 * @param {string|null} valueId
 */
export function filterPlantsByValue(plants = [], valueId = null) {
  if (!valueId || valueId === 'all') return [...plants];
  return plants.filter(
    (p) =>
      p.primary_value === valueId ||
      (p.secondary_values || []).includes(valueId)
  );
}

export { VALUE_TAXONOMY, valueLabel };

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}
