/**
 * Box → report pipeline: geometry → live layers → site-design schema → rules.
 */

import {
  normalizePolygon,
  bboxFromRing,
  polygonAreaHa,
  centroid,
  cacheKey,
} from './geo.js';
import { gatherSiteLayers } from './sources.js';
import { buildSiteRecord } from './rules.js';

const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const CACHE_MAX = 200;

/**
 * @param {{ polygon: object, site_name?: string, force?: boolean }} input
 */
export async function generateSiteReport(input = {}) {
  const ring = normalizePolygon(input.polygon);
  const bbox = bboxFromRing(ring);
  const key = cacheKey(bbox);
  if (!input.force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.report, _meta: { ...hit.report._meta, cache: 'hit' } };
    }
  }

  const layers = await gatherSiteLayers({
    ring,
    bbox,
    site_name: input.site_name,
  });

  const centre = centroid(ring);
  const areaHa = polygonAreaHa(ring);
  const t = layers.terrain;
  const soils = layers.soils || {};
  const climate = layers.climate || {};
  const wetlands = layers.wetlands || {};
  const watershed = layers.watershed || {};
  const wetAreas = layers.wetAreas || {};

  // Prefer atlas erosion if present
  const erosion_risk =
    soils.erosion_risk || t.erosion_risk || 'low';

  const drainage_class = inferDrainage(wetlands, soils, t);

  const siteInput = {
    site_name: input.site_name || layers.preset?.label || 'Drawn parcel',
    footprint_ha: Math.round(areaHa * 1000) / 1000,
    _preset_id: climate.preset_id || layers.preset?.id,
    location: {
      latitude: centre.latitude,
      longitude: centre.longitude,
      elevation_m: t.elevation_m,
      municipality: layers.preset?.municipality || '',
      nearest_town: layers.preset?.nearest_town || '',
    },
    terrain: {
      slope_percent: t.slope_percent,
      aspect: t.aspect || 'flat',
      landform_position: t.landform_position || 'mid_slope',
      keypoint_present: !!t.keypoint_present,
      erosion_risk,
    },
    hydrology: {
      annual_precipitation_mm: climate.annual_precipitation_mm,
      seasonal_distribution: climate.seasonal_distribution || 'summer_peak',
      distance_to_nearest_watercourse_m:
        wetAreas.predicted_stream_count > 0 ? 50 : null,
      watershed: watershed.watershed || layers.preset?.hydrology?.watershed || '',
      wetland_class: wetlands.present ? wetlands.wetland_class : null,
      water_table_depth_m: null,
      flood_risk_zone: false,
    },
    soil: {
      soil_series: soils.soil_group || '',
      texture: soils.texture || 'loam',
      drainage_class,
      depth_to_bedrock_cm: null,
      cli_agricultural_capability_class: null,
      organic_matter_percent: null,
      ph: null,
    },
    climate: {
      plant_hardiness_zone: climate.plant_hardiness_zone,
      frost_free_days: climate.frost_free_days,
      growing_degree_days_base5: climate.growing_degree_days_base5,
      prevailing_wind_direction: climate.prevailing_wind_direction,
      chinook_exposure: climate.chinook_exposure,
    },
    existing_vegetation: {
      // Without land-cover API yet — conservative early succession
      cover_type: wetlands.present ? 'wetland_vegetation' : 'tame_pasture',
      successional_stage: wetlands.present ? 'mid_successional' : 'early_successional',
    },
    data_provenance: buildProvenance(layers),
  };

  const record = buildSiteRecord(siteInput);

  const report = {
    ...record,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      area_ha: siteInput.footprint_ha,
    },
    analysis: {
      elevation: {
        mean_m: t.elevation_m,
        min_m: t.elevation_min_m,
        max_m: t.elevation_max_m,
        source: layers.elevation?.source,
        samples: layers.elevation?.sample_count,
        grid: `${layers.elevation?.rows}×${layers.elevation?.cols}`,
      },
      slope: t.slope_stats,
      hrdem: layers.hrdem,
      wetlands: {
        present: !!wetlands.present,
        class: wetlands.wetland_class,
        counts: wetlands.counts || {},
      },
      wet_areas: wetAreas,
      watershed,
      soils: {
        group: soils.soil_group,
        texture: soils.texture,
        erosion_risk: soils.erosion_risk,
      },
      alberta: layers.alberta,
    },
    _meta: {
      ...record._meta,
      pipeline: 'bbox-live-v1',
      cache: 'miss',
      cache_key: key,
    },
  };

  putCache(key, report);
  return report;
}

function inferDrainage(wetlands, soils, terrain) {
  if (wetlands?.present) return 'imperfect';
  if (soils?.texture === 'sand' || soils?.texture === 'loamy_sand') return 'rapid';
  if (soils?.texture === 'clay' || soils?.texture === 'organic') return 'poor';
  if (terrain?.landform_position === 'depression') return 'imperfect';
  if (terrain?.landform_position === 'valley_floor') return 'moderately_well';
  return 'well';
}

function buildProvenance(layers) {
  const rows = [];
  if (layers.elevation) {
    rows.push({
      field: 'terrain, location.elevation_m',
      source_name: layers.elevation.source,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.elevation.source_url,
    });
  }
  if (layers.hrdem?.available) {
    rows.push({
      field: 'terrain (HRDEM coverage flag)',
      source_name: 'NRCan HRDEM STAC (hrdem-lidar)',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.hrdem.source_url,
    });
  }
  if (layers.wetlands?.source_name) {
    rows.push({
      field: 'hydrology.wetland_class',
      source_name: layers.wetlands.source_name,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.wetlands.source_url,
    });
  }
  if (layers.watershed?.source_name) {
    rows.push({
      field: 'hydrology.watershed',
      source_name: layers.watershed.source_name,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.watershed.source_url,
    });
  }
  if (layers.wetAreas?.source_name) {
    rows.push({
      field: 'hydrology (predicted streams)',
      source_name: layers.wetAreas.source_name,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.wetAreas.source_url,
    });
  }
  if (layers.soils?.source_name) {
    rows.push({
      field: 'soil',
      source_name: layers.soils.source_name,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.soils.source_url,
    });
  }
  if (layers.climate?.source_name) {
    rows.push({
      field: 'climate, hydrology.annual_precipitation_mm',
      source_name: layers.climate.source_name,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: layers.climate.source_url,
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

function putCache(key, report) {
  cache.set(key, { at: Date.now(), report });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}
