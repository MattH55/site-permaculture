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
import { gatherProximity } from './proximity.js';
import { buildTopologyView } from './topology.js';
import { predictWellDepth } from './well-depth.js';
import { planPlantings } from './planting.js';
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

  const centre = centroid(ring);

  const [layers, proximity] = await Promise.all([
    gatherSiteLayers({
      ring,
      bbox,
      site_name: input.site_name,
    }),
    gatherProximity(centre, bbox),
  ]);

  const areaHa = polygonAreaHa(ring);
  const t = layers.terrain;
  const soils = layers.soils || {};
  const climate = layers.climate || {};
  const wetlands = layers.wetlands || {};
  const watershed = layers.watershed || {};
  const wetAreas = layers.wetAreas || {};

  const topology = buildTopologyView(
    layers.elevation?.elevations || [],
    {
      rows: layers.elevation?.rows || 0,
      cols: layers.elevation?.cols || 0,
    },
    t
  );

  // Step 6c — well depth prediction (AWWI nearby + bedrock covariate / IDW)
  const predicted_well_depth = predictWellDepth(centre, {
    elevation_m: t.elevation_m,
    search_radius_km: 5,
  });

  const waterDist =
    proximity.nearest_water_source?.distance_m ??
    (wetAreas.predicted_stream_count > 0 ? 50 : null);

  const erosion_risk = soils.erosion_risk || t.erosion_risk || 'low';
  const drainage_class = inferDrainage(wetlands, soils, t);

  // Prefer live nearest settlement for location labels
  const nearestName =
    proximity.nearest_settlement?.name ||
    proximity.nearest_city?.name ||
    layers.preset?.nearest_town ||
    '';

  const siteInput = {
    site_name: input.site_name || layers.preset?.label || 'Drawn parcel',
    footprint_ha: Math.round(areaHa * 1000) / 1000,
    _preset_id: climate.preset_id || layers.preset?.id,
    location: {
      latitude: centre.latitude,
      longitude: centre.longitude,
      elevation_m: t.elevation_m,
      municipality: layers.preset?.municipality || '',
      nearest_town: nearestName,
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
      distance_to_nearest_watercourse_m: waterDist,
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
      cover_type: wetlands.present ? 'wetland_vegetation' : 'tame_pasture',
      successional_stage: wetlands.present
        ? 'mid_successional'
        : 'early_successional',
    },
    proximity_context: {
      nearest_water_source: proximity.nearest_water_source,
      nearest_city: proximity.nearest_city,
      nearest_settlement: proximity.nearest_settlement,
      amenities: proximity.amenities || [],
      crime_risk: stripCrimeForSchema(proximity.crime_risk),
    },
    predicted_well_depth: stripWellForSchema(predicted_well_depth),
    data_provenance: buildProvenance(layers, proximity, predicted_well_depth),
  };

  // Step 8-style join: EcoCrop / Growing Guide planting plan (after climate+soil assembled)
  const planting_plan = planPlantings(siteInput, { limit: 18 });

  const record = buildSiteRecord(siteInput);

  // Attach full proximity / well blocks (incl. disclaimers) for the UI
  record.proximity_context = {
    ...siteInput.proximity_context,
    crime_risk: proximity.crime_risk,
  };
  record.predicted_well_depth = predicted_well_depth;
  record.planting_plan = planting_plan;

  const report = {
    ...record,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      area_ha: siteInput.footprint_ha,
    },
    topology,
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
      proximity,
      well_depth: predicted_well_depth,
      planting: {
        catalog: planting_plan.growing_guide?.catalog_source,
        recommended_count: planting_plan.recommended?.length || 0,
      },
      alberta: layers.alberta,
    },
    planting_plan,
    _meta: {
      ...record._meta,
      pipeline: 'bbox-live-v4-planting',
      cache: 'miss',
      cache_key: key,
    },
  };

  putCache(key, report);
  return report;
}

function stripCrimeForSchema(crime) {
  if (!crime) return null;
  return {
    reporting_jurisdiction: crime.reporting_jurisdiction,
    crime_severity_index: crime.crime_severity_index,
    rural_or_urban_classification: crime.rural_or_urban_classification,
    data_year: crime.data_year,
  };
}

function stripWellForSchema(w) {
  if (!w) return null;
  return {
    estimated_depth_m: w.estimated_depth_m,
    estimated_depth_range_m: w.estimated_depth_range_m,
    estimated_static_water_level_m: w.estimated_static_water_level_m,
    target_hydrostratigraphic_unit: w.target_hydrostratigraphic_unit,
    nearby_well_count: w.nearby_well_count,
    nearby_well_search_radius_km: w.nearby_well_search_radius_km,
    confidence: w.confidence,
    disclaimer_required: true,
  };
}

function inferDrainage(wetlands, soils, terrain) {
  if (wetlands?.present) return 'imperfect';
  if (soils?.texture === 'sand' || soils?.texture === 'loamy_sand') return 'rapid';
  if (soils?.texture === 'clay' || soils?.texture === 'organic') return 'poor';
  if (terrain?.landform_position === 'depression') return 'imperfect';
  if (terrain?.landform_position === 'valley_floor') return 'moderately_well';
  return 'well';
}

function buildProvenance(layers, proximity, well) {
  const rows = [];
  if (layers.elevation) {
    rows.push({
      field: 'terrain, location.elevation_m, topology',
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
  if (proximity?._sources?.water) {
    rows.push({
      field: 'proximity_context.nearest_water_source',
      source_name: proximity._sources.water,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: 'https://overpass-api.de/',
    });
  }
  if (proximity?._sources?.places) {
    rows.push({
      field: 'proximity_context.nearest_city, nearest_settlement',
      source_name: proximity._sources.places,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: 'https://www12.statcan.gc.ca/',
    });
  }
  if (proximity?._sources?.crime) {
    rows.push({
      field: 'proximity_context.crime_risk',
      source_name: proximity._sources.crime,
      source_date: new Date().toISOString().slice(0, 10),
      source_url:
        'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510017701',
    });
  }
  if (well) {
    rows.push({
      field: 'predicted_well_depth',
      source_name: `Well depth IDW (${well._meta?.well_data_source || 'wells'}) · AGS Map 610 bedrock proxy`,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: 'https://groundwater.alberta.ca/WaterWells/d/',
    });
  }
  rows.push({
    field: 'planting_plan',
    source_name:
      'EcoCrop-style suitability · OpenSourceMed Growing Guide / farmfit catalog approach',
    source_date: new Date().toISOString().slice(0, 10),
    source_url: 'https://opensourcemed.info/',
  });
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
