/**
 * Value-first recommendation framing for Expanding Edge.
 *
 * If→then rules stay in rules.js; this module maps techniques → client outcomes
 * (water storage, wind protection, food, etc.) and builds value headlines.
 */

import { shelterbeltValueHeadline } from './shelterbelt-palette.js';

/** Stable value taxonomy for schema, UI chips, and EE marketing filters. */
export const VALUE_TAXONOMY = {
  water_storage: {
    id: 'water_storage',
    label: 'Water storage',
    client: 'Hold more water on site; less drought stress',
  },
  water_harvest: {
    id: 'water_harvest',
    label: 'Water harvest',
    client: 'Capture runoff before it leaves the property',
  },
  erosion_control: {
    id: 'erosion_control',
    label: 'Erosion control',
    client: 'Hold soil on slopes and in storms',
  },
  wind_protection: {
    id: 'wind_protection',
    label: 'Wind protection',
    client: 'Shelter gardens, livestock, and structures',
  },
  snow_management: {
    id: 'snow_management',
    label: 'Snow management',
    client: 'Trap snow where it recharges soil',
  },
  microclimate: {
    id: 'microclimate',
    label: 'Microclimate',
    client: 'Buffer frost, heat, and chinook swings',
  },
  shade: {
    id: 'shade',
    label: 'Shade',
    client: 'Summer cooling and understory niches',
  },
  food_production: {
    id: 'food_production',
    label: 'Food',
    client: 'Kitchen, market, or homestead yield',
  },
  medicinal: {
    id: 'medicinal',
    label: 'Medicinal / herbal',
    client: 'Kitchen pharmacy and secondary crops',
  },
  soil_building: {
    id: 'soil_building',
    label: 'Soil building',
    client: 'Organic matter, structure, fertility over seasons',
  },
  nitrogen_fixing: {
    id: 'nitrogen_fixing',
    label: 'Nitrogen fixing',
    client: 'Fertility without synthetic nitrogen',
  },
  biodiversity: {
    id: 'biodiversity',
    label: 'Habitat / biodiversity',
    client: 'Pollinators, wildlife, system resilience',
  },
  beauty_access: {
    id: 'beauty_access',
    label: 'Beauty & access',
    client: 'Daily use, paths, enjoyment',
  },
  compliance_safety: {
    id: 'compliance_safety',
    label: 'Compliance & risk',
    client: 'Avoid illegal earthworks or flood conflict',
  },
};

/** Default primary/secondary values per technique (element_type). */
export const ELEMENT_VALUE_MAP = {
  swale: {
    primary_value: 'water_harvest',
    secondary_values: ['erosion_control', 'soil_building'],
    effort: 'medium',
    season_hint: 'Build after groundcover establishes; avoid frozen soils',
    related_services: ['water_earthworks_consult', 'full_site_design'],
  },
  terrace: {
    primary_value: 'erosion_control',
    secondary_values: ['water_harvest', 'food_production'],
    effort: 'high',
    season_hint: 'Stabilize cuts with perennial cover before full build-out',
    related_services: ['water_earthworks_consult', 'full_site_design'],
  },
  keyline_cultivation: {
    primary_value: 'water_harvest',
    secondary_values: ['soil_building', 'erosion_control'],
    effort: 'medium',
    season_hint: 'Mark keypoint on site before cultivation season',
    related_services: ['full_site_design'],
  },
  pond: {
    primary_value: 'water_storage',
    secondary_values: ['biodiversity', 'microclimate'],
    effort: 'high',
    season_hint: 'Confirm approvals and clay seal before excavation',
    related_services: ['water_earthworks_consult', 'full_site_design'],
  },
  water_harvesting_earthwork: {
    primary_value: 'water_harvest',
    secondary_values: ['water_storage', 'erosion_control'],
    effort: 'high',
    season_hint: 'Size spillways for Alberta summer-peak storms',
    related_services: ['water_earthworks_consult'],
  },
  hugelkultur_mound: {
    primary_value: 'soil_building',
    secondary_values: ['food_production', 'microclimate'],
    effort: 'medium',
    season_hint: 'Build with woody debris before freeze-up; plant next season',
    related_services: ['soil_carbon_building', 'food_forest_design', 'full_site_design'],
  },
  windbreak: {
    primary_value: 'wind_protection',
    secondary_values: ['snow_management', 'microclimate', 'biodiversity'],
    effort: 'medium',
    season_hint: 'Plant dormant stock in spring; mulch against chinook heave',
    related_services: ['shelterbelt_design', 'off_grid_garage', 'full_site_design'],
  },
  shelterbelt_zone: {
    primary_value: 'wind_protection',
    secondary_values: ['snow_management', 'microclimate', 'biodiversity'],
    effort: 'medium',
    season_hint: 'Multi-row layout; leave access gaps for snow and equipment',
    related_services: ['shelterbelt_design', 'off_grid_garage'],
  },
  food_forest_guild: {
    primary_value: 'food_production',
    secondary_values: ['biodiversity', 'soil_building', 'shade'],
    effort: 'medium',
    season_hint: 'Plant after soil-building cover phase; water establishment years',
    related_services: ['food_forest_design', 'soil_carbon_building', 'full_site_design'],
  },
  herb_spiral: {
    primary_value: 'medicinal',
    secondary_values: ['microclimate', 'beauty_access'],
    effort: 'low',
    season_hint: 'Build near kitchen door; stone mass for diurnal buffering',
    related_services: ['kitchen_garden_design'],
  },
  keyhole_bed: {
    primary_value: 'food_production',
    secondary_values: ['beauty_access', 'soil_building'],
    effort: 'low',
    season_hint: 'Mulch paths; compost at keyhole centre',
    related_services: ['kitchen_garden_design'],
  },
  groundwater_well: {
    primary_value: 'water_storage',
    secondary_values: ['water_harvest', 'compliance_safety'],
    effort: 'high',
    season_hint: 'Drill after frost leaves the ground; budget for pump, pressure tank, and water test',
    related_services: ['well_drilling', 'water_earthworks_consult', 'full_site_design'],
  },
};

/**
 * @param {string} valueId
 * @returns {string}
 */
export function valueLabel(valueId) {
  return VALUE_TAXONOMY[valueId]?.label || valueId;
}

/**
 * Build value-first fields for a design element.
 * @param {string} elementType
 * @param {object} site — terrain/hydro/soil/climate/footprint for templates
 * @param {{ condition_basis?: string, confidence?: string, wetland_block?: boolean }} ctx
 */
export function enrichElementValues(elementType, site = {}, ctx = {}) {
  const map = ELEMENT_VALUE_MAP[elementType] || {
    primary_value: 'beauty_access',
    secondary_values: [],
    effort: 'medium',
    season_hint: null,
    related_services: ['full_site_design'],
  };

  // Wetland / regulatory block on swale → compliance primary
  let primary = map.primary_value;
  let secondary = [...(map.secondary_values || [])];
  if (ctx.wetland_block || ctx.confidence === 'needs_site_visit' && elementType === 'swale' && /wetland/i.test(ctx.condition_basis || '')) {
    primary = 'compliance_safety';
    secondary = ['water_storage', 'biodiversity'].filter((v) => v !== primary);
  }

  // Chinook: emphasise microclimate / snow on windbreaks
  const chinook = site.climate?.chinook_exposure === true;
  if (elementType === 'windbreak' && chinook) {
    secondary = unique(['microclimate', 'snow_management', ...secondary]).slice(0, 3);
  }

  return {
    primary_value: primary,
    secondary_values: secondary.filter((v) => v !== primary).slice(0, 3),
    value_headline: buildValueHeadline(elementType, primary, site, ctx),
    technique_label: techniqueLabel(elementType),
    effort: map.effort || 'medium',
    season_hint: map.season_hint || null,
    related_services: map.related_services || [],
  };
}

function techniqueLabel(type) {
  const labels = {
    swale: 'Contour swale',
    terrace: 'Terrace',
    keyline_cultivation: 'Keyline cultivation',
    pond: 'Pond / dam',
    water_harvesting_earthwork: 'Water-harvesting earthwork',
    hugelkultur_mound: 'Hügelkultur / raised bed',
    windbreak: 'Windbreak / shelterbelt',
    shelterbelt_zone: 'Shelterbelt zone',
    food_forest_guild: 'Food forest guild',
    herb_spiral: 'Herb spiral',
    keyhole_bed: 'Keyhole bed',
    groundwater_well: 'Groundwater well',
  };
  return labels[type] || type;
}

/**
 * One client-facing outcome sentence; include site facts when available.
 */
export function buildValueHeadline(elementType, primaryValue, site = {}, ctx = {}) {
  const terrain = site.terrain || {};
  const climate = site.climate || {};
  const hydro = site.hydrology || {};
  const soil = site.soil || {};
  const slope = num(terrain.slope_percent);
  const wind = climate.prevailing_wind_direction;
  const landform = (terrain.landform_position || '').replace(/_/g, ' ');
  const ffd = num(climate.frost_free_days);
  const zone = climate.plant_hardiness_zone;
  const footprint = num(site.footprint_ha);

  // Regulatory swale block — keep earthworks off mapped wet areas (details in placement notes)
  if (
    elementType === 'swale' &&
    (ctx.wetland_block || /wetland/i.test(ctx.condition_basis || ''))
  ) {
    return 'Mapped wet areas stay in place — redesign water features around the wetland edge.';
  }

  switch (elementType) {
    case 'swale':
      return slope != null
        ? `Capture sheet flow on your ${fmtNum(slope)}% slope so moisture soaks in instead of running off.`
        : 'Capture sheet flow on contour so moisture soaks in instead of running off.';
    case 'terrace':
      return slope != null
        ? `Hold soil and create level planting ground on your ${fmtNum(slope)}% slope.`
        : 'Hold soil and create level planting ground on steep terrain.';
    case 'keyline_cultivation':
      return 'Spread water from the keypoint across the landscape so ridges stay productive longer.';
    case 'pond':
      return landform
        ? `Store water on the ${landform} for drought buffer, habitat, and microclimate.`
        : 'Store water on the valley floor for drought buffer, habitat, and microclimate.';
    case 'water_harvesting_earthwork':
      return 'Harvest and divert peak summer storms into storage before they leave the property.';
    case 'hugelkultur_mound':
      return soil.cli_agricultural_capability_class
        ? 'Build planting depth and organic matter where the native soil profile is thin or low-capability.'
        : 'Build planting depth and organic matter for productive Zone 1 beds.';
    case 'windbreak':
    case 'shelterbelt_zone':
      return shelterbeltValueHeadline(site);
    case 'food_forest_guild': {
      const z = zone ? ` in zone ${zone}` : '';
      const days = ffd != null ? ` (~${ffd} frost-free days)` : '';
      return `Grow layered perennial food${z}${days} once soil-building succession is underway.`;
    }
    case 'herb_spiral':
      return footprint != null
        ? `Stack herbal diversity in a compact Zone 1 spiral on your ${fmtNum(footprint)} ha parcel.`
        : 'Stack herbal diversity in a compact Zone 1 spiral near daily use.';
    case 'keyhole_bed':
      return 'Maximise food yield and easy harvest access on a tight footprint.';
    case 'groundwater_well': {
      const depth = num(site.predicted_well_depth?.estimated_depth_m);
      if (depth != null) {
        return `Groundwater option indicated by nearby well records (local completion depths vary).`;
      }
      return 'Assess groundwater where surface water is distant or unreliable.';
    }
    default: {
      const label = VALUE_TAXONOMY[primaryValue]?.label || 'site benefit';
      return `Deliver ${label.toLowerCase()} suited to this parcel’s measured conditions.`;
    }
  }
}

/**
 * Expanding Edge service catalog for CTAs (phase 2 recommendation engine).
 * Tags on elements map here; URLs point at public EE pages.
 */
export const EE_SERVICES = {
  water_earthworks_consult: {
    id: 'water_earthworks_consult',
    label: 'Water & earthworks consult',
    blurb: 'Swales, ponds, keyline, and diversion sized for Alberta storms and Water Act reality.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Talk earthworks',
    pillar: 'water',
  },
  well_drilling: {
    id: 'well_drilling',
    label: 'Groundwater well',
    blurb: 'Hydrology-based completion depth from nearby well records; licensed drill + pump package.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Plan a well',
    pillar: 'water',
  },
  shelterbelt_design: {
    id: 'shelterbelt_design',
    label: 'Shelterbelt design',
    blurb: 'Multi-row wind and snow belts placed for your exposure and chinook risk.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Design a shelterbelt',
    pillar: 'shelter',
  },
  food_forest_design: {
    id: 'food_forest_design',
    label: 'Food forest design',
    blurb: 'Layered perennial polyculture sequenced after soil-building phases.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Plan a food forest',
    pillar: 'food',
  },
  soil_carbon_building: {
    id: 'soil_carbon_building',
    label: 'Soil carbon building',
    blurb: 'Hügelkultur, cover crops, compost, and N-fixers — interventions only; lab for SOC claims.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Build soil carbon',
    pillar: 'food',
  },
  kitchen_garden_design: {
    id: 'kitchen_garden_design',
    label: 'Kitchen garden design',
    blurb: 'Zone 1 intensive beds, herb spirals, and daily-use layouts.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Design Zone 1',
    pillar: 'food',
  },
  solar_energy_package: {
    id: 'solar_energy_package',
    label: 'Solar + generator package',
    blurb: 'Off-grid solar tiers sized to parcel load with optional propane generator backup.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'View energy packages',
    pillar: 'energy',
  },
  off_grid_garage: {
    id: 'off_grid_garage',
    label: 'Off-grid garage ($250k)',
    blurb: 'Fixed-price insulated garage / workshop shell ready for solar and well gear.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Reserve garage package',
    pillar: 'shelter',
  },
  full_site_design: {
    id: 'full_site_design',
    label: 'Full site design',
    blurb: 'Whole-property plan across Food, Water, Energy, and Shelter pillars.',
    href: 'https://www.expandingedge.ca/services-landing',
    cta: 'Book full design',
    pillar: 'shelter',
  },
};

/**
 * Priority rank for recommendation engine sorting (lower = sooner).
 * Regulatory / risk first, then water, wind, soil, food, intensive.
 */
export function recommendationPriority(element) {
  const primary = element.primary_value;
  const conf = element.confidence;
  if (primary === 'compliance_safety' || conf === 'needs_site_visit' && primary === 'compliance_safety')
    return 1;
  if (primary === 'compliance_safety') return 1;
  if (element.element_type === 'swale' && conf === 'needs_site_visit') return 1;
  if (primary === 'erosion_control') return 2;
  if (element.element_type === 'groundwater_well') return 3;
  if (primary === 'water_harvest' || primary === 'water_storage') return 3;
  if (primary === 'wind_protection' || primary === 'snow_management') return 4;
  if (primary === 'soil_building' || primary === 'nitrogen_fixing') return 5;
  if (primary === 'food_production' || primary === 'medicinal') return 6;
  if (primary === 'microclimate' || primary === 'shade' || primary === 'biodiversity')
    return 7;
  return 8;
}

/**
 * Filter elements by primary or secondary value (null/'' = all).
 * @param {object[]} elements
 * @param {string|null} valueId
 */
export function filterElementsByValue(elements = [], valueId = null) {
  if (!valueId || valueId === 'all') return [...elements];
  return elements.filter((el) => {
    if (el.primary_value === valueId) return true;
    return (el.secondary_values || []).includes(valueId);
  });
}

/**
 * Counts of primary values present (for filter chips), sorted by engine priority.
 * @param {object[]} elements
 * @returns {{ id: string, label: string, count: number, min_priority: number }[]}
 */
export function valueCounts(elements = []) {
  const map = new Map();
  for (const el of elements) {
    const id = el.primary_value || 'beauty_access';
    if (!map.has(id)) {
      map.set(id, {
        id,
        label: valueLabel(id),
        count: 0,
        min_priority: el.priority ?? recommendationPriority(el),
      });
    }
    const row = map.get(id);
    row.count += 1;
    const p = el.priority ?? recommendationPriority(el);
    if (p < row.min_priority) row.min_priority = p;
  }
  return [...map.values()].sort(
    (a, b) => a.min_priority - b.min_priority || b.count - a.count
  );
}

/**
 * Unique EE services implied by recommendation set, ranked by how often tagged
 * and by element priority (earlier outcomes first).
 * @param {object[]} elements
 * @returns {object[]} service catalog rows with hit_count
 */
export function collectRelatedServices(elements = []) {
  const hits = new Map(); // serviceId -> { count, bestPriority }
  for (const el of elements) {
    const p = el.priority ?? recommendationPriority(el);
    for (const sid of el.related_services || []) {
      if (!EE_SERVICES[sid]) continue;
      if (!hits.has(sid)) hits.set(sid, { count: 0, bestPriority: p });
      const h = hits.get(sid);
      h.count += 1;
      if (p < h.bestPriority) h.bestPriority = p;
    }
  }
  return [...hits.entries()]
    .map(([id, h]) => ({
      ...EE_SERVICES[id],
      hit_count: h.count,
      best_priority: h.bestPriority,
    }))
    .sort(
      (a, b) =>
        a.best_priority - b.best_priority ||
        b.hit_count - a.hit_count ||
        a.label.localeCompare(b.label)
    );
}

/**
 * Resolve service catalog rows for a single element (card CTAs).
 * @param {object} element
 */
export function servicesForElement(element = {}) {
  return (element.related_services || [])
    .map((id) => EE_SERVICES[id])
    .filter(Boolean);
}

/**
 * Group design elements by primary_value for the recommendation engine envelope.
 * Phase 2 also returns value_counts and related_services for filters/CTAs.
 * @param {object[]} elements
 */
export function groupRecommendationsByValue(elements = []) {
  const by_value = {};
  const priority_ordered = [...elements].sort(
    (a, b) =>
      (a.priority ?? recommendationPriority(a)) -
        (b.priority ?? recommendationPriority(b)) ||
      (a.zone ?? 3) - (b.zone ?? 3)
  );

  for (const el of priority_ordered) {
    const v = el.primary_value || 'beauty_access';
    if (!by_value[v]) by_value[v] = [];
    by_value[v].push(el);
  }

  const top = priority_ordered.slice(0, 3);
  const labels = top.map((e) => valueLabel(e.primary_value).toLowerCase());
  let summary_sentence = 'Recommendations match this parcel’s measured conditions.';
  if (labels.length === 1) {
    summary_sentence = `On this parcel we prioritize ${labels[0]} first.`;
  } else if (labels.length > 1) {
    const last = labels.pop();
    summary_sentence = `On this parcel we prioritize ${labels.join(', ')} and ${last} first.`;
  }

  return {
    by_value,
    priority_ordered,
    summary_sentence,
    value_counts: valueCounts(priority_ordered),
    related_services: collectRelatedServices(priority_ordered),
  };
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n) {
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
