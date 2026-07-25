/**
 * Phase 3 — slim recommendation payload for expandingedge.ca embed / API.
 *
 * Full map→geospatial pipeline remains POST /api/report.
 * This path accepts site fields or an Alberta preset and returns
 * value-first design + planting for widgets and partner pages.
 */

import { ALBERTA_PRESETS } from './alberta-presets.js';
import { buildSiteRecord } from './rules.js';
import { planPlantings } from './planting.js';
import {
  VALUE_TAXONOMY,
  EE_SERVICES,
  valueLabel,
} from './recommendation-values.js';

/**
 * Build embeddable recommendation response.
 * @param {object} body
 * @param {{ preset_id?: string, site_name?: string, footprint_ha?: number, include_plants?: boolean, plant_limit?: number, terrain?: object, climate?: object, soil?: object, hydrology?: object, existing_vegetation?: object, location?: object }} body
 */
export function buildEmbedRecommendations(body = {}) {
  const includePlants = body.include_plants !== false;
  const plantLimit = Math.min(Math.max(Number(body.plant_limit) || 10, 1), 24);
  const preset = body.preset_id
    ? ALBERTA_PRESETS.find((p) => p.id === body.preset_id)
    : null;

  const input = mergeSiteInput(body, preset);
  const record = buildSiteRecord(input);
  const planting = includePlants
    ? planPlantings(input, { limit: plantLimit })
    : null;

  const rec = record.recommendations || {
    summary_sentence: '',
    priority_ordered: record.design_elements || [],
    by_value: {},
    value_counts: [],
    related_services: [],
  };

  return {
    engine: 'ee-recommendation-embed-v1',
    brand: {
      name: 'Expanding Edge Permaculture',
      url: 'https://www.expandingedge.ca/',
      services_url: 'https://www.expandingedge.ca/services-landing',
      phone: '(780) 236-3630',
      email: 'info@expandingedge.ca',
    },
    site: {
      site_id: record.site_id,
      site_name: record.site_name,
      location: record.location,
      footprint_ha: record._meta?.footprint_ha ?? input.footprint_ha ?? null,
      climate: {
        plant_hardiness_zone: record.climate?.plant_hardiness_zone,
        frost_free_days: record.climate?.frost_free_days,
        prevailing_wind_direction: record.climate?.prevailing_wind_direction,
        chinook_exposure: record.climate?.chinook_exposure,
      },
      terrain: {
        slope_percent: record.terrain?.slope_percent,
        landform_position: record.terrain?.landform_position,
        aspect: record.terrain?.aspect,
      },
      soil: {
        drainage_class: record.soil?.drainage_class,
        texture: record.soil?.texture,
      },
      preset_id: preset?.id || body.preset_id || null,
    },
    summary_sentence: rec.summary_sentence,
    design_elements: (rec.priority_ordered || record.design_elements || []).map(
      slimElement
    ),
    recommendations: {
      summary_sentence: rec.summary_sentence,
      value_counts: rec.value_counts || [],
      related_services: rec.related_services || [],
      by_value: Object.fromEntries(
        Object.entries(rec.by_value || {}).map(([k, list]) => [
          k,
          list.map(slimElement),
        ])
      ),
    },
    planting: planting
      ? {
          phase_note: planting.phase_note,
          recommended: (planting.recommended || []).map(slimPlant),
          by_value: planting.by_value || {},
          value_counts: planting.value_counts || [],
          site_filters: planting.site_filters,
          totals: planting.totals,
        }
      : null,
    flags: record._meta?.flags || [],
    full_tool_url: fullToolUrl(),
    generated_at: new Date().toISOString(),
  };
}

/** Public taxonomy for embed clients (filters, copy). */
export function getTaxonomyPayload() {
  return {
    engine: 'ee-recommendation-embed-v1',
    values: Object.values(VALUE_TAXONOMY).map((v) => ({
      id: v.id,
      label: v.label,
      client: v.client,
    })),
    services: Object.values(EE_SERVICES).map((s) => ({
      id: s.id,
      label: s.label,
      blurb: s.blurb,
      href: s.href,
      cta: s.cta,
    })),
    presets: ALBERTA_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      municipality: p.municipality,
      plant_hardiness_zone: p.climate?.plant_hardiness_zone,
    })),
    brand: {
      name: 'Expanding Edge Permaculture',
      url: 'https://www.expandingedge.ca/',
      services_url: 'https://www.expandingedge.ca/services-landing',
    },
  };
}

function mergeSiteInput(body, preset) {
  const p = preset || {};
  return {
    site_name:
      body.site_name ||
      (preset ? `${preset.label} parcel` : 'Expanding Edge site'),
    location: {
      latitude: body.location?.latitude ?? p.latitude ?? 53.55,
      longitude: body.location?.longitude ?? p.longitude ?? -113.5,
      municipality:
        body.location?.municipality || p.municipality || 'Alberta',
      nearest_town:
        body.location?.nearest_town || p.nearest_town || undefined,
      elevation_m: body.location?.elevation_m ?? p.elevation_m,
    },
    terrain: {
      slope_percent: body.terrain?.slope_percent ?? 5,
      aspect: body.terrain?.aspect || 'S',
      landform_position: body.terrain?.landform_position || 'mid_slope',
      keypoint_present: body.terrain?.keypoint_present ?? false,
      erosion_risk: body.terrain?.erosion_risk || 'low',
    },
    soil: {
      drainage_class: body.soil?.drainage_class || 'well',
      texture: body.soil?.texture || 'loam',
      cli_agricultural_capability_class:
        body.soil?.cli_agricultural_capability_class || '3',
      depth_to_bedrock_cm: body.soil?.depth_to_bedrock_cm,
    },
    climate: {
      plant_hardiness_zone:
        body.climate?.plant_hardiness_zone ||
        p.climate?.plant_hardiness_zone ||
        '3b',
      frost_free_days:
        body.climate?.frost_free_days ?? p.climate?.frost_free_days ?? 135,
      growing_degree_days_base5:
        body.climate?.growing_degree_days_base5 ??
        p.climate?.growing_degree_days_base5,
      prevailing_wind_direction:
        body.climate?.prevailing_wind_direction ||
        p.climate?.prevailing_wind_direction ||
        'NW',
      chinook_exposure:
        body.climate?.chinook_exposure ??
        p.climate?.chinook_exposure ??
        false,
    },
    hydrology: {
      annual_precipitation_mm:
        body.hydrology?.annual_precipitation_mm ??
        p.hydrology?.annual_precipitation_mm ??
        450,
      seasonal_distribution:
        body.hydrology?.seasonal_distribution ||
        p.hydrology?.seasonal_distribution ||
        'summer_peak',
      wetland_class: body.hydrology?.wetland_class ?? null,
      flood_risk_zone: body.hydrology?.flood_risk_zone ?? false,
      watershed: body.hydrology?.watershed || p.hydrology?.watershed,
    },
    existing_vegetation: {
      cover_type:
        body.existing_vegetation?.cover_type || 'tame_pasture',
      successional_stage:
        body.existing_vegetation?.successional_stage ||
        'early_successional',
    },
    footprint_ha: body.footprint_ha ?? 1,
    _preset_id: preset?.id || body.preset_id,
  };
}

function slimElement(e) {
  if (!e) return e;
  return {
    element_type: e.element_type,
    primary_value: e.primary_value,
    secondary_values: e.secondary_values || [],
    value_headline: e.value_headline,
    technique_label: e.technique_label || valueLabel(e.primary_value),
    condition_basis: e.condition_basis,
    placement_notes: e.placement_notes,
    zone: e.zone,
    confidence: e.confidence,
    effort: e.effort,
    season_hint: e.season_hint,
    related_services: e.related_services || [],
    priority: e.priority,
  };
}

function slimPlant(p) {
  if (!p) return p;
  return {
    id: p.id,
    common_name: p.common_name,
    scientific_name: p.scientific_name,
    category: p.category,
    guild_layer: p.guild_layer,
    score: p.score,
    suitability: p.suitability,
    primary_value: p.primary_value,
    secondary_values: p.secondary_values || [],
    value_headline: p.value_headline,
    nitrogen_fixer: p.nitrogen_fixer,
    alberta_native: p.alberta_native,
    hardiness_min: p.hardiness_min,
    hardiness_max: p.hardiness_max,
    reasons: (p.reasons || []).slice(0, 4),
  };
}

function fullToolUrl() {
  const base = process.env.PUBLIC_BASE_URL || '';
  if (base) return base.replace(/\/$/, '');
  return 'https://site-permaculture.onrender.com';
}
