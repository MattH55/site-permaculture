/**
 * If→then placement ruleset for Alberta-first permaculture site design.
 * Companion to schema/site-design-schema.json and design-rules-and-data-sources.md.
 */

const DRAINAGE_SWALE_OK = new Set(['well', 'moderately_well', 'imperfect']);
const POOR_CLI = new Set(['5', '6', '7']);
const EARLY_SUCCESSION = new Set(['pioneer', 'early_successional']);
const READY_SUCCESSION = new Set(['mid_successional', 'climax']);

const ELEMENT_META = {
  swale: {
    label: 'Contour swale',
    zone: 2,
    summary: 'On-contour water-harvesting berm and trench for sheet flow.',
  },
  terrace: {
    label: 'Terrace',
    zone: 2,
    summary: 'Levelled bench on steep ground — preferred over swales above ~15% slope.',
  },
  keyline_cultivation: {
    label: 'Keyline cultivation',
    zone: 3,
    summary: 'Cultivation pattern running off-contour from a keypoint toward the ridge.',
  },
  pond: {
    label: 'Pond / dam',
    zone: 3,
    summary: 'Valley-floor water storage where wetlands and flood hazard do not constrain siting.',
  },
  water_harvesting_earthwork: {
    label: 'Water-harvesting earthwork',
    zone: 3,
    summary: 'Broader earthworks package (bunds, diversion, storage) for valley floor harvest.',
  },
  hugelkultur_mound: {
    label: 'Hügelkultur / raised bed',
    zone: 1,
    summary: 'Builds planting depth and organic matter where native soil is shallow or poor.',
  },
  windbreak: {
    label: 'Windbreak',
    zone: 2,
    summary: 'Tree/shrub strip perpendicular to prevailing wind, upwind of Zones 1–2.',
  },
  shelterbelt_zone: {
    label: 'Shelterbelt zone',
    zone: 4,
    summary: 'Multi-row shelterbelt on open Alberta exposure — often west / northwest facing.',
  },
  food_forest_guild: {
    label: 'Food forest guild',
    zone: 2,
    summary: 'Layered perennial polyculture once soil-building succession is underway.',
  },
  herb_spiral: {
    label: 'Herb spiral',
    zone: 1,
    summary: 'Compact Zone 1 microclimate stack for high diversity on a small footprint.',
  },
  keyhole_bed: {
    label: 'Keyhole bed',
    zone: 1,
    summary: 'Intensive Zone 1 bed with centre access path for efficient daily harvest.',
  },
};

/**
 * @param {object} site — partial site record (location, terrain, hydrology, soil, climate, existing_vegetation, footprint_ha?)
 * @returns {{ design_elements: object[], flags: object[] }}
 */
export function applyRules(site = {}) {
  const terrain = site.terrain || {};
  const hydro = site.hydrology || {};
  const soil = site.soil || {};
  const climate = site.climate || {};
  const veg = site.existing_vegetation || {};
  const slope = num(terrain.slope_percent);
  const elements = [];
  const flags = [];

  // Rule 5 first — wetland presence blocks earthworks and needs regulatory review
  if (hydro.wetland_class != null && hydro.wetland_class !== '') {
    flags.push({
      code: 'wetland_water_act',
      severity: 'block',
      message:
        'Regulated wetland present (Alberta Merged Wetland Inventory class). No earthworks recommended until Water Act review. Flag needs_site_visit.',
    });
    elements.push(
      element('swale', {
        condition_basis: `wetland_class = ${hydro.wetland_class}`,
        placement_notes:
          'Do not construct swales, ponds, or water-harvesting earthworks until Alberta Water Act approvals are confirmed. Schedule a site visit with a qualified wetland assessor.',
        confidence: 'needs_site_visit',
        zone: 5,
      })
    );
    // Still allow non-earthwork recommendations below where safe
  }

  const wetlandBlocksEarthworks =
    hydro.wetland_class != null && hydro.wetland_class !== '';

  // Rule 12 — high erosion risk softens confidence on earthworks
  const erosionHigh = terrain.erosion_risk === 'high';
  if (erosionHigh) {
    flags.push({
      code: 'erosion_high',
      severity: 'caution',
      message:
        'High erosion risk: establish groundcover before swale/terrace construction; earthworks confidence capped at needs_site_visit.',
    });
  }

  const earthworkConfidence = erosionHigh
    ? 'needs_site_visit'
    : 'rule_based_high';

  // Rule 1 & 2 — swale vs terrace by slope
  if (!wetlandBlocksEarthworks && slope != null) {
    if (slope > 15) {
      elements.push(
        element('terrace', {
          condition_basis: `slope_percent ${slope} > 15`,
          placement_notes:
            'Alberta foothill/coulee pattern: use terraces rather than swales on steep ground. Stabilise cuts with deep-rooted perennial cover before full build-out.',
          confidence: earthworkConfidence,
          zone: 2,
        })
      );
    } else if (
      slope >= 2 &&
      slope <= 15 &&
      DRAINAGE_SWALE_OK.has(soil.drainage_class)
    ) {
      elements.push(
        element('swale', {
          condition_basis: `slope_percent ${slope} in 2–15 AND drainage_class ${soil.drainage_class}`,
          placement_notes:
            'Place on true contour. Below 2% swales harvest little; above ~15% berms destabilise. Size for summer-peak convective storms typical of Alberta.',
          confidence: earthworkConfidence,
          zone: 2,
        })
      );
    }
  }

  // Rule 3 — keyline
  if (!wetlandBlocksEarthworks && terrain.keypoint_present === true) {
    elements.push(
      element('keyline_cultivation', {
        condition_basis: 'keypoint_present = true',
        placement_notes:
          'Run cultivation off-contour from the keypoint (slope inflection convex→concave) toward the ridge to spread water across the landscape.',
        confidence: erosionHigh ? 'needs_site_visit' : 'rule_based_high',
        zone: 3,
      })
    );
  }

  // Rule 4 — pond / water harvesting on valley floor
  if (
    !wetlandBlocksEarthworks &&
    terrain.landform_position === 'valley_floor' &&
    hydro.flood_risk_zone !== true
  ) {
    elements.push(
      element('pond', {
        condition_basis:
          'landform_position = valley_floor AND wetland_class null AND flood_risk_zone = false',
        placement_notes:
          'Valley-floor storage candidate. Confirm clay core / sealing, inlet control, and Alberta Water Act / Fisheries approvals before construction. Prefer passive fill from diversion rather than pumped systems.',
        confidence: erosionHigh ? 'needs_site_visit' : 'rule_based_moderate',
        zone: 3,
      })
    );
    elements.push(
      element('water_harvesting_earthwork', {
        condition_basis:
          'landform_position = valley_floor AND wetland_class null AND flood_risk_zone = false',
        placement_notes:
          'Complement pond with diversion bunds and overflow spillways sized for Alberta summer peak storms.',
        confidence: erosionHigh ? 'needs_site_visit' : 'rule_based_moderate',
        zone: 3,
      })
    );
  }

  // Rule 6 — shallow soil or poor CLI → hügelkultur / raised beds
  const shallow =
    soil.depth_to_bedrock_cm != null && num(soil.depth_to_bedrock_cm) < 30;
  const poorCli = POOR_CLI.has(String(soil.cli_agricultural_capability_class));
  if (shallow || poorCli) {
    const parts = [];
    if (shallow) parts.push(`depth_to_bedrock_cm ${soil.depth_to_bedrock_cm} < 30`);
    if (poorCli)
      parts.push(
        `cli_agricultural_capability_class ${soil.cli_agricultural_capability_class}`
      );
    elements.push(
      element('hugelkultur_mound', {
        condition_basis: parts.join(' OR '),
        placement_notes:
          'Build soil depth and organic matter where native profile is shallow or CLI class 5–7. Orient mounds for solar gain; mulch heavily against Alberta freeze–thaw.',
        confidence: 'rule_based_high',
        zone: 1,
      })
    );
  }

  // Rule 7 & 8 — windbreak / shelterbelt
  if (climate.prevailing_wind_direction) {
    const chinookNote = climate.chinook_exposure
      ? ' Chinook corridor: prioritise windbreak and avoid early-flowering woody species regardless of hardiness zone — freeze–thaw cycling damages plants a hardiness lookup alone would not flag.'
      : '';
    elements.push(
      element('windbreak', {
        condition_basis: `prevailing_wind_direction = ${climate.prevailing_wind_direction}${
          climate.chinook_exposure ? ' AND chinook_exposure = true' : ''
        }`,
        placement_notes: `Place perpendicular to ${climate.prevailing_wind_direction} winds, upwind of Zones 1–2. In Alberta this is very often a west/northwest-facing shelterbelt.${chinookNote}`,
        confidence: climate.chinook_exposure
          ? 'rule_based_high'
          : 'rule_based_moderate',
        zone: 2,
      })
    );
    elements.push(
      element('shelterbelt_zone', {
        condition_basis: `prevailing_wind_direction = ${climate.prevailing_wind_direction}`,
        placement_notes:
          'Multi-row shelterbelt on the open-exposure sector. Mix deciduous and coniferous rows for year-round structure; leave snow-trap gaps where winter access is needed.',
        confidence: 'rule_based_moderate',
        zone: 4,
      })
    );
  } else if (climate.chinook_exposure === true) {
    elements.push(
      element('windbreak', {
        condition_basis: 'chinook_exposure = true',
        placement_notes:
          'Chinook exposure without a listed wind direction — default west/northwest shelterbelt. Avoid early-flowering woody species; hardiness zone alone understates freeze–thaw risk.',
        confidence: 'rule_based_high',
        zone: 2,
      })
    );
  }

  // Rule 9 & 10 — succession gating for food forest
  if (EARLY_SUCCESSION.has(veg.successional_stage)) {
    flags.push({
      code: 'succession_build_soil_first',
      severity: 'info',
      message:
        'Pioneer / early-successional cover: defer food forest; run nitrogen-fixer and groundcover cover-crop phase first.',
    });
  } else if (READY_SUCCESSION.has(veg.successional_stage)) {
    const zoneNote = climate.plant_hardiness_zone
      ? ` Filter guild species to hardiness zone ${climate.plant_hardiness_zone}`
      : '';
    const ffd = climate.frost_free_days
      ? ` and ~${climate.frost_free_days} frost-free days.`
      : '.';
    elements.push(
      element('food_forest_guild', {
        condition_basis: `successional_stage = ${veg.successional_stage}`,
        placement_notes: `Soil-building phase complete enough for layered polyculture.${zoneNote}${ffd} Join against the EcoCrop crop-suitability schema for species selection.`,
        confidence: climate.plant_hardiness_zone
          ? 'rule_based_high'
          : 'rule_based_moderate',
        zone: 2,
      })
    );
  } else if (!veg.successional_stage) {
    // No succession data — moderate recommendation with visit note
    if (veg.cover_type && veg.cover_type !== 'bare_disturbed') {
      elements.push(
        element('food_forest_guild', {
          condition_basis: `cover_type = ${veg.cover_type} (successional_stage unknown)`,
          placement_notes:
            'Successional stage not assessed. Treat as provisional: confirm cover and soil organic matter on site before committing canopy layers.',
          confidence: 'needs_site_visit',
          zone: 2,
        })
      );
    }
  }

  // Rule 11 — small footprint intensive Zone 1
  const footprint = num(site.footprint_ha);
  if (footprint != null && footprint < 0.1) {
    elements.push(
      element('herb_spiral', {
        condition_basis: `footprint_ha ${footprint} < 0.1`,
        placement_notes:
          'Small footprint + high desired diversity: herb spiral near the kitchen door (Zone 1). Stone mass buffers Alberta diurnal temperature swings.',
        confidence: 'rule_based_high',
        zone: 1,
      })
    );
    elements.push(
      element('keyhole_bed', {
        condition_basis: `footprint_ha ${footprint} < 0.1`,
        placement_notes:
          'Keyhole geometry maximises edge and access on tight parcels. Mulch paths; compost at the keyhole centre.',
        confidence: 'rule_based_high',
        zone: 1,
      })
    );
  }

  // De-duplicate element_type keeping highest-priority / first
  const seen = new Set();
  const design_elements = [];
  for (const el of elements) {
    // wetland "block" swale is advisory only if we already have a real swale — allow both notes by keying on condition
    const key = `${el.element_type}::${el.confidence}`;
    if (seen.has(el.element_type) && el.element_type !== 'swale') continue;
    if (seen.has(el.element_type) && wetlandBlocksEarthworks) {
      // replace earlier swale with blocked advisory
      const idx = design_elements.findIndex((d) => d.element_type === 'swale');
      if (idx >= 0 && el.confidence === 'needs_site_visit') {
        design_elements[idx] = el;
      }
      continue;
    }
    seen.add(el.element_type);
    design_elements.push(el);
  }

  return { design_elements, flags };
}

/**
 * Assemble a full site record matching the schema.
 */
export function buildSiteRecord(input = {}) {
  const site_id =
    input.site_id ||
    `ee-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const site = {
    site_id,
    site_name: input.site_name || '',
    location: {
      latitude: num(input.location?.latitude),
      longitude: num(input.location?.longitude),
      elevation_m: num(input.location?.elevation_m),
      legal_land_description: input.location?.legal_land_description || undefined,
      municipality: input.location?.municipality || '',
      nearest_town: input.location?.nearest_town || '',
    },
    terrain: {
      slope_percent: num(input.terrain?.slope_percent),
      aspect: input.terrain?.aspect || 'flat',
      landform_position: input.terrain?.landform_position || undefined,
      keypoint_present: bool(input.terrain?.keypoint_present),
      erosion_risk: input.terrain?.erosion_risk || undefined,
    },
    hydrology: {
      annual_precipitation_mm: num(input.hydrology?.annual_precipitation_mm),
      seasonal_distribution:
        input.hydrology?.seasonal_distribution || 'summer_peak',
      distance_to_nearest_watercourse_m: num(
        input.hydrology?.distance_to_nearest_watercourse_m
      ),
      watershed: input.hydrology?.watershed || '',
      wetland_class:
        input.hydrology?.wetland_class === '' ||
        input.hydrology?.wetland_class === 'none'
          ? null
          : input.hydrology?.wetland_class ?? null,
      water_table_depth_m: num(input.hydrology?.water_table_depth_m),
      flood_risk_zone: bool(input.hydrology?.flood_risk_zone) === true,
    },
    soil: {
      soil_series: input.soil?.soil_series || '',
      texture: input.soil?.texture || undefined,
      drainage_class: input.soil?.drainage_class || undefined,
      depth_to_bedrock_cm: num(input.soil?.depth_to_bedrock_cm),
      cli_agricultural_capability_class:
        input.soil?.cli_agricultural_capability_class || undefined,
      organic_matter_percent: num(input.soil?.organic_matter_percent),
      ph: num(input.soil?.ph),
    },
    climate: {
      plant_hardiness_zone: input.climate?.plant_hardiness_zone || '',
      frost_free_days: num(input.climate?.frost_free_days),
      growing_degree_days_base5: num(input.climate?.growing_degree_days_base5),
      prevailing_wind_direction:
        input.climate?.prevailing_wind_direction || undefined,
      chinook_exposure: bool(input.climate?.chinook_exposure) === true,
    },
    existing_vegetation: {
      cover_type: input.existing_vegetation?.cover_type || undefined,
      successional_stage:
        input.existing_vegetation?.successional_stage || undefined,
    },
    footprint_ha: num(input.footprint_ha),
  };

  const { design_elements, flags } = applyRules(site);

  const data_provenance = Array.isArray(input.data_provenance)
    ? input.data_provenance
    : defaultProvenance(input);

  return {
    site_id: site.site_id,
    site_name: site.site_name,
    location: site.location,
    terrain: site.terrain,
    hydrology: site.hydrology,
    soil: site.soil,
    climate: site.climate,
    existing_vegetation: site.existing_vegetation,
    design_elements,
    data_provenance,
    _meta: {
      footprint_ha: site.footprint_ha,
      flags,
      engine: 'ee-site-design-rules-v1',
      region_focus: 'Alberta',
      generated_at: new Date().toISOString(),
    },
  };
}

export function elementLabel(type) {
  return ELEMENT_META[type]?.label || type;
}

export function elementSummary(type) {
  return ELEMENT_META[type]?.summary || '';
}

export { ELEMENT_META };

function element(type, { condition_basis, placement_notes, confidence, zone }) {
  return {
    element_type: type,
    condition_basis,
    placement_notes,
    zone: zone ?? ELEMENT_META[type]?.zone ?? 2,
    confidence: confidence || 'rule_based_moderate',
  };
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return null;
}

function defaultProvenance(input) {
  const rows = [];
  if (input._preset_id) {
    rows.push({
      field: 'climate, hydrology.annual_precipitation_mm',
      source_name: `Expanding Edge Alberta preset: ${input._preset_id}`,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: 'https://www.expandingedge.ca/',
    });
  }
  rows.push({
    field: 'design_elements',
    source_name: 'EE if→then placement ruleset (Alberta-first)',
    source_date: new Date().toISOString().slice(0, 10),
    source_url:
      'https://opensourcemed.info/schemas/permaculture-site-design.schema.json',
  });
  return rows;
}
