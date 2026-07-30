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
import { generateContourLines } from './contours.js';
import { predictWellDepth } from './well-depth.js';
import { buildServiceQuote } from './quote.js';
import { planPlantings } from './planting.js';
import {
  enrichDesignElementsWithPlants,
  plantingPlanInterventionValue,
  plantingReportTable,
} from './plant-interventions.js';
import { assessSolar } from './solar.js';
import { fetchNearestEpsCrimes } from './crime.js';
import { assessLandValue } from './land-value.js';
import { queryHardiness } from './hardiness.js';
import { queryFloodHazard } from './flood.js';
import { resolveZoningContext } from './zoning.js';
import { buildSiteRecord } from './rules.js';
import { groupRecommendationsByValue } from './recommendation-values.js';
import { assessTemperature } from './climate.js';
import { assessWildlife } from './wildlife.js';
import { checkWildlifeSensitivity, queryGbig, lookupWmu } from './wildlife-enrich.js';
import { estimateTreeCover, generateTreeSampleGrid } from './trees.js';
import { assessAccess } from './access.js';
import { demographicsHeuristic } from './demographics.js';
import { latLngToAts } from './ats.js';
import { queryProvincialContours } from './provincial-contours.js';
import { queryDepthToWater, queryPredictedStreams } from './wet-areas.js';
import { assessBiodiversity } from './biodiversity.js';
import { getWindRose } from './wind-rose.js';
import { generateFecundityReport } from './fecundity-report.js';
import { fetchSatelliteIndices, toFecundityPatch } from './satellite-indices.js';
import { fetchWetlands, toFecundityWetlandPatch } from './wetlands.js';
import { fetchSmallWater, toFecunditySmallWaterPatch } from './small-water.js';
import { recommendServicePackages } from './service-packages.js';
import { querySturgeonCounty, interpretLandUse } from './sturgeon-county.js';
import { querySoilSurvey } from './soil-survey.js';
import { buildSiteMapFeatures } from './site-map-features.js';
import { buildActionMenu } from './action-menu.js';

const cache = new Map();

const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const CACHE_MAX = 200;

/**
 * @param {{ polygon: object, site_name?: string, force?: boolean, plant_goals?: string[] }} input
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

  const [layers, proximity, nearest_crimes, hardiness, flood, temperature, wildlife] = await Promise.all([
    gatherSiteLayers({
      ring,
      bbox,
      site_name: input.site_name,
    }),
    gatherProximity(centre, bbox),
    fetchNearestEpsCrimes(centre, { limit: 20, search_radius_m: 8000 }).catch(
      (e) => ({
        available: false,
        nearest: [],
        error: e.message,
      })
    ),
    queryHardiness(centre).catch((e) => ({
      available: false,
      hardiness_zone: null,
      error: e.message,
    })),
    queryFloodHazard(centre, bbox).catch((e) => ({
      available: false,
      flood_hazard_class: 'unknown',
      flood_risk_zone: false,
      error: e.message,
    })),
    assessTemperature(centre).catch((e) => ({
      available: false,
      error: e.message,
    })),
    assessWildlife(bbox, centre).catch((e) => ({
      available: false,
      error: e.message,
    })),
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

  // Wet Areas Mapping first — feeds subsurface hydrology well model
  const [depthToWater, predictedStreams] = await Promise.all([
    queryDepthToWater(centre).catch(() => null),
    queryPredictedStreams(bbox).catch(() => ({ available: false, count: null })),
  ]);

  // Step 6c — well depth from subsurface hydrology (SWL, screens, wet lithology, WAM DTW)
  const predicted_well_depth = predictWellDepth(centre, {
    elevation_m: t.elevation_m,
    search_radius_km: 5,
    depth_to_water_m:
      depthToWater?.depth_m ??
      depthToWater?.category?.representative_m ??
      null,
    depth_to_water_category: depthToWater?.category || null,
  });

  // Contour lines reduced from the same sampled elevation grid — feeds the
  // rate engine's swale-meterage estimate (see lib/quote.js, lib/rate-engine.js).
  const contourLines = generateContourLines(
    layers.elevation?.elevations || [],
    { rows: layers.elevation?.rows || 0, cols: layers.elevation?.cols || 0 },
    bbox
  );

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

  // NRCan municipality solar (local CSV) — property location dependent
  const solar = assessSolar(centre, {
    aspect: t.aspect,
    slope_percent: t.slope_percent,
    nearest_name: nearestName || layers.preset?.municipality,
  });

  // Land value — informational only (does NOT feed placement rules)
  const land_value = await assessLandValue(centre, {
    footprint_ha: Math.round(areaHa * 1000) / 1000,
    nearest_city: proximity.nearest_city,
    nearest_settlement: proximity.nearest_settlement,
    cli_class: soils.cli_class || null,
  }).catch((e) => ({
    land_value_source: 'none',
    error: e.message,
    disclaimer:
      'Land value assessment failed for this parcel. Planning context only — not an appraisal.',
  }));

  // Zoning portal lookup (designation not auto-assigned — municipal bylaws)
  const zoning = resolveZoningContext(centre, {
    nearest_city: proximity.nearest_city,
    nearest_settlement: proximity.nearest_settlement,
    municipality: layers.preset?.municipality,
  });

  // Sturgeon County ArcGIS Property Viewer lookup (parcel, land use, neighbourhood)
  const sturgeonCounty = await querySturgeonCounty(centre.latitude, centre.longitude)
    .catch(() => ({ available: false, error: 'Lookup failed' }));
  const landUseInterpretation = sturgeonCounty?.land_use
    ? interpretLandUse(sturgeonCounty.land_use)
    : null;

  // AGRASID/AGRASIS soil survey + SoilGrids sample grid mapped across parcel
  const soilSurvey = await querySoilSurvey(centre.latitude, centre.longitude, {
    bbox,
    samples: 9,
  }).catch(() => ({ available: false, error: 'Soil survey lookup failed' }));

  // Prefer live NRCan hardiness + frost table over Alberta preset alone
  const hardinessZone =
    hardiness?.hardiness_zone || climate.plant_hardiness_zone;
  const frostFree =
    hardiness?.frost_free_days_estimate ?? climate.frost_free_days;
  const floodRisk = !!flood?.flood_risk_zone;

  const siteInput = {
    site_name: input.site_name || layers.preset?.label || 'Drawn parcel',
    footprint_ha: Math.round(areaHa * 1000) / 1000,
    _preset_id: climate.preset_id || layers.preset?.id,
    location: {
      latitude: centre.latitude,
      longitude: centre.longitude,
      elevation_m: t.elevation_m,
      municipality:
        zoning.municipality || layers.preset?.municipality || '',
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
      // Prefer pump-test SWL (subsurface); WAM DTW is near-surface context only
      water_table_depth_m:
        predicted_well_depth?.estimated_static_water_level_m ??
        depthToWater?.depth_m ??
        null,
      flood_risk_zone: floodRisk,
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
      plant_hardiness_zone: hardinessZone,
      frost_free_days: frostFree,
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
    wildlife_context: wildlife?.available ? {
      deer: wildlife.white_tailed_deer || null,
      sightings: wildlife.recent_sightings || null,
    } : null,
    data_provenance: buildProvenance(
      layers,
      proximity,
      predicted_well_depth,
      solar,
      nearest_crimes,
      land_value,
      hardiness,
      flood,
      zoning,
      temperature,
      wildlife
    ),
  };

  const record = buildSiteRecord(siteInput);

  // Field-cost quote from fired design elements (swale/pond/shelterbelt/food forest)
  const service_quote = buildServiceQuote({
    design_elements: record.design_elements,
    footprint_ha: siteInput.footprint_ha,
    slope_percent: t.slope_percent,
    contourLines,
    siteCentre: centre,
    propertyLabel: siteInput.site_name,
  });

  // Attach full proximity / well / solar / crime / temperature / wildlife blocks for the UI
  record.proximity_context = {
    ...siteInput.proximity_context,
    crime_risk: proximity.crime_risk,
    nearest_crimes,
  };
  record.predicted_well_depth = predicted_well_depth;
  record.solar = solar;
  record.land_value = land_value;
  record.hardiness = hardiness;
  record.flood = flood;
  record.zoning = zoning;
  record.temperature = temperature;
  record.wildlife = wildlife;
  record.sturgeon_county = sturgeonCounty;
  record.land_use_interpretation = landUseInterpretation;
  record.soil_survey = soilSurvey;
  record.wildlife_sensitivity = checkWildlifeSensitivity(centre);
  record.wmu = lookupWmu(centre);

  // GBIF — run async alongside other fetches (fire-and-forget, attach after)
    queryGbig(bbox).then((gbif) => {
      record.gbif_species = gbif;
    }).catch(() => {});

    const nearestCityDist = proximity.nearest_city?.distance_km || null;

    // Await road access so the report does not ship with empty "Loading..." roads
    let access = await assessAccess(centre, nearestCityDist).catch((e) => ({
      available: true,
      nearest_road: {
        available: false,
        error: e.message,
        note: `Road lookup failed (${e.message})`,
      },
      trip_costs_to_city: nearestCityDist
        ? undefined // filled below if needed
        : [],
      nearest_city_distance_km: nearestCityDist,
      gas_price_cad_l: 1.45,
      methodology: 'Access lookup failed',
    }));
    if (access && !access.trip_costs_to_city && nearestCityDist) {
      const { tripCostsForDistance } = await import('./access.js');
      access.trip_costs_to_city = tripCostsForDistance(nearestCityDist);
    }
    // Fallback: Sturgeon County parcel address → road name
    if (
      (!access?.nearest_road?.available || !access?.nearest_road?.named) &&
      sturgeonCounty?.parcel?.full_address
    ) {
      const addr = sturgeonCounty.parcel.full_address;
      const roadMatch = addr.match(/^\d+\s+(.+?)(?:\s*,|\s*$)/);
      const roadName = roadMatch ? roadMatch[1].trim() : null;
      if (roadName) {
        access = {
          ...access,
          available: true,
          nearest_road: {
            name: roadName,
            type: access?.nearest_road?.type || 'road',
            distance_m: access?.nearest_road?.distance_m ?? null,
            available: true,
            named: true,
            source: access?.nearest_road?.available
              ? `${access.nearest_road.source || 'OSM'} + Sturgeon County address`
              : 'Sturgeon County parcel address',
          },
          methodology: (access.methodology || '') + ' + Sturgeon County parcel address fallback',
        };
      }
    }
    record.access = access;

    assessBiodiversity(centre).then((bio) => {
      record.biodiversity = bio;
    }).catch(() => {});

    // NASA POWER wind rose (awaited below with other late enrichments)
    record.demographics = demographicsHeuristic(centre);
    record.ats = latLngToAts(centre);
    record.parcel_address = {
      ats: record.ats,
      centroid: { lat: centre.latitude, lng: centre.longitude },
      nearest_road: access?.nearest_road || null,
      locality: proximity.nearest_settlement?.name || proximity.nearest_city?.name || null,
    };

    const treeCover = estimateTreeCover(layers, proximity);
  record.tree_cover = treeCover;
  record.tree_sample_grid = generateTreeSampleGrid(bbox);
  record.wet_areas_mapping = { depth_to_water: depthToWater, predicted_streams: predictedStreams };

  // Provincial contours — await for report, then attach to record
  const provincialContours = await queryProvincialContours(bbox, { limit: 1500 }).catch(() => ({ features: [] }));
  record._provincial_contours = provincialContours;

  // Satellite vegetation indices (Sentinel-2) + regional SOC (SoilGrids)
  // + NASA POWER wind rose. Tier 1 screening — never precise SOC claims.
  const [satellite, wetlandsDetail, windRose] = await Promise.all([
    fetchSatelliteIndices(
      {
        type: 'Polygon',
        coordinates: [ring],
      },
      { buffer_m: 75 }
    ).catch((e) => ({
      available: false,
      fallbacks: [`satellite fetch failed: ${e.message}`],
      claims: [],
    })),
    // AMWI polygons + area/type for fecundity (first-class wetlands layer)
    fetchWetlands(bbox, {
      buffer_m: 200,
      centre,
    }).catch((e) => ({
      available: false,
      has_wetland_on_site: !!wetlands.present,
      wetland_types: wetlands.wetland_class ? [String(wetlands.wetland_class)] : [],
      error: e.message,
      claims: [],
    })),
    getWindRose(centre, { years: 2 }).catch((e) => ({
      available: false,
      error: e.message,
      source: 'NASA POWER',
    })),
  ]);

  // Small water: inventory + S2 NDWI/MNDWI + S1 + DEM TWI proxy
  // Runs after wetlands so inventory can be reused; elev grid for TWI
  const smallWater = await fetchSmallWater(
    { type: 'Polygon', coordinates: [ring] },
    {
      bufferMeters: 100,
      minPixels: 2,
      ndwiThreshold: 0.15,
      mndwiThreshold: 0.1,
      includeTWI: true,
      wetlands: wetlandsDetail,
      centre,
      elevations: layers.elevation?.elevations,
      elevRows: layers.elevation?.rows,
      elevCols: layers.elevation?.cols,
      elevBbox: bbox,
    }
  ).catch((e) => ({
    available: false,
    summary: { has_any_water: false },
    open_water_features: [],
    possible_small_water_or_seeps: [],
    fallbacks: [`small water failed: ${e.message}`],
    claims: [],
  }));

  const satPatch = toFecundityPatch(satellite);
  const wetPatch = toFecundityWetlandPatch(wetlandsDetail);
  const swPatch = toFecunditySmallWaterPatch(smallWater);
  record.satellite = satellite;
  record.wetlands = wetlandsDetail;
  record.small_water = smallWater;
  record.wind_rose = windRose;
  // Prefer NASA primary wind direction for shelterbelt / climate summary
  if (windRose?.available && windRose.primary_direction) {
    record.climate = {
      ...(record.climate || {}),
      prevailing_wind_direction: windRose.primary_direction,
      secondary_wind_direction: windRose.secondary_direction || null,
      mean_wind_speed_ms: windRose.mean_speed_ms ?? null,
      wind_source: windRose.source,
    };
  }

  // Fecundity assessment — prefer real NDVI cover over coarse tree-cover estimate
  // Wetlands: AMWI inventory preferred over boolean presence alone
  const fecundityReport = generateFecundityReport(
    {
      measured: {}, // no direct site measurements from remote report
      topoData: { avgSlopePercent: t.slope_percent },
      wetlandsPresent:
        wetPatch.wetlandsPresent != null
          ? wetPatch.wetlandsPresent
          : !!wetlands.present,
      hasPondOrWetlandInventory: wetPatch.hasPondOrWetlandInventory,
      wetlandHabitatPresent: wetPatch.wetlandHabitatPresent,
      wetlandProximityBoost: wetPatch.wetlandProximityBoost,
      wetlandTypes: wetPatch.wetlandTypes,
      wetlandAreaHa: wetPatch.wetlandAreaHa,
      wetlands: wetPatch.wetlands || wetlandsDetail,
      // Small water / seeps (satellite + inventory stack) — never regulatory
      hasPondOrDugout: swPatch.hasPondOrDugout,
      hasSmallWaterOrSeep: swPatch.hasSmallWaterOrSeep,
      smallWaterDensity: swPatch.smallWaterDensity,
      smallWaterNearestM: swPatch.smallWaterNearestM,
      smallWaterConfirmedAreaM2: swPatch.smallWaterConfirmedAreaM2,
      smallWaterPossibleAreaM2: swPatch.smallWaterPossibleAreaM2,
      satelliteOpenWater: swPatch.satelliteOpenWater,
      smallWater: swPatch.smallWater || smallWater,
      regionalSoilTexture: soils.texture || null,
      // Satellite first; land-cover / tree-cover remain fallbacks
      ndviCoverPct:
        satPatch.ndviCoverPct ??
        (treeCover?.tree_cover_pct != null ? Number(treeCover.tree_cover_pct) : undefined),
      ndviMedian: satPatch.ndviMedian,
      vegetationVigor: satPatch.vegetationVigor,
      soilMoistureProxy: satPatch.soilMoistureProxy,
      ndviTrendSlope: satPatch.ndviTrendSlope,
      satellite: satPatch.satellite,
      satelliteClaims: satPatch.satelliteClaims,
      regionalSocContext: satPatch.regionalSocContext,
      landCoverClass: wetlands.present
        ? 'shrubland'
        : layers.alberta?.land_cover || null,
      wildlifeObservations: wildlife?.sighting_species || [],
      windExposureHint:
        layers.elevation?.tree_density_hint ||
        (treeCover?.tree_cover_pct > 40
          ? 'sheltered'
          : treeCover?.tree_cover_pct > 15
            ? 'partial'
            : 'open'),
      frostPoolingHint:
        t.landform_position === 'depression'
          ? 'high'
          : t.landform_position === 'valley_floor'
            ? 'moderate'
            : 'low',
      footprintHa: siteInput.footprint_ha,
      annualPrecipMm: climate.annual_precipitation_mm || null,
    },
    { propertyLabel: siteInput.site_name }
  );
  record.fecundity = fecundityReport;

  // Plant Recommendation + Economics Engine (after fecundity → Site Condition Profile)
  // Separate beta offering in the UI — intelligence for the planting planner pane.
  const planting_plan = planPlantings(siteInput, {
    limit: 18,
    scenario: 'market_garden',
    goals: input.plant_goals || input.goals || undefined,
    fecundity: fecundityReport,
    hardiness,
    soil_survey: soilSurvey,
    satellite,
    wetlands: wetlandsDetail,
    small_water: smallWater,
    wind_rose: windRose,
    tree_cover: treeCover,
    windExposureHint:
      treeCover?.tree_cover_pct > 40
        ? 'sheltered'
        : treeCover?.tree_cover_pct > 15
          ? 'partial'
          : 'open',
    frostPoolingHint:
      t.landform_position === 'depression'
        ? 'high'
        : t.landform_position === 'valley_floor'
          ? 'moderate'
          : 'low',
  });
  record.planting_plan = planting_plan;
  record.site_condition_profile = planting_plan.site_condition_profile || null;

  // Species-specific placement notes (shelterbelt / food forest with named plants)
  if (Array.isArray(record.design_elements) && planting_plan?.recommended?.length) {
    record.design_elements = enrichDesignElementsWithPlants(
      record.design_elements,
      planting_plan,
      planting_plan.site_condition_profile
    );
    const recs = groupRecommendationsByValue(record.design_elements);
    record.recommendations = {
      ...(record.recommendations || {}),
      ...recs,
    };
    if (record._meta) {
      record._meta.recommendations = record.recommendations;
    }
  }

  // Planting plan as intervention — lever deltas + cash-flow for value-of-improvements
  const baselineScores = Object.fromEntries(
    (fecundityReport?.categories || []).map((c) => [c.category, c.score])
  );
  let plantingIntervention = null;
  try {
    plantingIntervention = plantingPlanInterventionValue(planting_plan, baselineScores, {
      scenario: 'mid',
      timeHorizonYears: 10,
      footprintHa: siteInput.footprint_ha,
    });
  } catch (e) {
    console.warn('planting intervention value failed', e.message);
  }
  record.planting_intervention_value = plantingIntervention;
  record.recommended_plantings = plantingReportTable(planting_plan, plantingIntervention);
  if (fecundityReport && plantingIntervention) {
    fecundityReport.plantingInterventionValue = plantingIntervention;
    // Merge plant cash into intervention value narrative when earthworks ROI also present
    if (fecundityReport.interventionValue) {
      fecundityReport.interventionValue.planting_plan_overlay = {
        upfrontCost_cad: plantingIntervention.financialSummary?.upfrontCost_cad,
        annualBenefit_cad: plantingIntervention.financialSummary?.annualBenefit_cad,
        npv_cad: plantingIntervention.financialSummary?.npv_cad,
        overall_lever_delta: plantingIntervention.scoreComparison?.deltas?.overall,
        note: 'Separate planting-plan economics; not double-counted in earthworks ROI totals.',
      };
    }
  }

  // High-level service packages: Food · Water · Energy · Shelter
  // fed by design_elements, wells, solar, fecundity, and field quotes
  const service_packages = recommendServicePackages({
    design_elements: record.design_elements,
    predicted_well_depth,
    solar,
    fecundity: fecundityReport,
    footprint_ha: siteInput.footprint_ha,
    slope_percent: t.slope_percent,
    hydrology: siteInput.hydrology,
    service_quote,
    travel_km: service_quote?.sizing_basis?.travel_km_one_way,
    propertyLabel: siteInput.site_name,
  });
  record.service_packages = service_packages;

  record.service_quote = service_quote;

  // Harmonized selectable intervention menu (value-first UX → choose → estimate → inquire)
  try {
    record.action_menu = buildActionMenu({
      service_packages,
      service_quote,
      planting_plan,
      recommended_plantings: record.recommended_plantings,
      wetlands: wetlandsDetail,
      small_water: smallWater,
      proximity,
      proximity_context: record.proximity_context,
      predicted_well_depth,
      terrain: t,
      hydrology: siteInput.hydrology,
    });
  } catch (e) {
    console.warn('action_menu build failed', e.message);
    record.action_menu = { items: [], error: e.message };
  }

  // Unified property map: parcel + elevation/contours + plantings + water + settlements
  // Built from the same drawn ring used for all other spatial displays.
  try {
    record.site_map = buildSiteMapFeatures({
      ring,
      bbox,
      centre,
      topology,
      planting_plan,
      wetlands: wetlandsDetail,
      small_water: smallWater,
      provincial_contours: provincialContours,
      tree_cover: treeCover,
      tree_sample_grid: record.tree_sample_grid,
      proximity,
      climate: record.climate || climate,
      wind_rose: windRose,
      satellite,
    });
  } catch (e) {
    console.warn('site_map build failed', e.message);
    record.site_map = {
      version: 1,
      error: e.message,
      parcel: {
        type: 'Polygon',
        coordinates: [ring],
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      },
    };
  }

  if (Array.isArray(record.data_provenance)) {
    record.data_provenance.push({
      field: 'service_quote',
      source_name: 'Expanding Edge rate engine (2024 rate sheet, +8% est.) applied to fired design_elements',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: null,
    });
    record.data_provenance.push({
      field: 'service_packages',
      source_name:
        'EE service package engine — Food / Water / Energy / Shelter (wells, solar+generator, soil carbon, $250k off-grid garage)',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: null,
    });
    if (wetlandsDetail?.source) {
      record.data_provenance.push({
        field: 'wetlands / fecundity water-fauna-microclimate',
        source_name: wetlandsDetail.source,
        source_date: new Date().toISOString().slice(0, 10),
        source_url: wetlandsDetail.source_url || null,
      });
    }
    if (smallWater?.metadata?.sources?.length) {
      record.data_provenance.push({
        field: 'small_water_detection',
        source_name: smallWater.metadata.sources.join(' + '),
        source_date: smallWater.metadata.processing_date || new Date().toISOString().slice(0, 10),
        source_url: null,
      });
    }
    record.data_provenance.push({
      field: 'site_map',
      source_name:
        'Unified property map — DEM contours, plant placement, AMWI/S2 water, proximity settlements, canopy image analysis (client)',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: null,
    });
  }

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
      solar,
      nearest_crimes,
      land_value,
      hardiness,
      flood,
      zoning,
      temperature,
      wildlife,
      sturgeon_county: sturgeonCounty,
      land_use_interpretation: landUseInterpretation,
      soil_survey: soilSurvey,
      planting: {
        engine: planting_plan.engine,
        catalog: planting_plan.growing_guide?.catalog_source,
        recommended_count: planting_plan.recommended?.length || 0,
        guilds: planting_plan.suggested_guilds?.length || 0,
        plan_economics: planting_plan.plan_economics || null,
        hardiness_zone: planting_plan.site_filters?.plant_hardiness_zone,
        effective_zone: planting_plan.site_filters?.effective_hardiness_zone,
      },
      alberta: layers.alberta,
    },
    planting_plan,
    _meta: {
      ...record._meta,
      pipeline: 'bbox-live-v13-small-water',
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
    estimated_aquifer_top_m: w.estimated_aquifer_top_m ?? null,
    target_hydrostratigraphic_unit: w.target_hydrostratigraphic_unit,
    nearby_well_count: w.nearby_well_count,
    nearby_well_search_radius_km: w.nearby_well_search_radius_km,
    confidence: w.confidence,
    hydrology_basis: w.hydrology_basis || [],
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

function buildProvenance(
  layers, proximity, well, solar, nearest_crimes, land_value, hardiness, flood, zoning, temperature, wildlife
) {
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
      source_url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510017701',
    });
  }
  if (well) {
    rows.push({
      field: 'predicted_well_depth',
      source_name: `Well hydrology IDW (${well._meta?.method || 'idw'}; ${well._meta?.well_data_source || 'wells'}) · SWL/screens/lithology · AGS bedrock proxy`,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: 'https://groundwater.alberta.ca/WaterWells/d/',
    });
  }
  if (solar?.available) {
    rows.push({
      field: 'solar',
      source_name: solar.source_name || 'NRCan photovoltaic / solar resource maps',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: solar.source_url,
    });
  }
  if (nearest_crimes?.available || nearest_crimes?.in_eps_coverage) {
    rows.push({
      field: 'proximity_context.nearest_crimes',
      source_name: nearest_crimes.source_name || 'EPS Community Safety Map (Occurrences CSDP)',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: nearest_crimes.source_url || 'https://experience.arcgis.com/experience/8e2c6c41933e48a79faa90048d9a459d',
    });
  }
  if (land_value && land_value.land_value_source !== 'none') {
    rows.push({
      field: 'land_value',
      source_name: land_value.municipal_sample?.source_name || land_value.rural_aggregate?.source_name || 'Municipal assessment / CLI agricultural land values',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: land_value.municipal_sample?.source_url || land_value.rural_aggregate?.source_url || null,
    });
  }
  if (hardiness?.hardiness_zone || hardiness?.available) {
    rows.push({
      field: 'climate.plant_hardiness_zone',
      source_name: hardiness.source_name || 'NRCan Plant Hardiness Zones',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: hardiness.source_url,
    });
  }
  if (flood?.available !== false) {
    rows.push({
      field: 'hydrology.flood_risk_zone / flood',
      source_name: flood.source_name || 'Alberta FHIP flood hazard mapping',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: flood.source_url,
    });
  }
  if (zoning?.zoning_source_url || zoning?.municipality) {
    rows.push({
      field: 'zoning',
      source_name: `Municipal zoning portal lookup (${zoning.municipality || 'Alberta'})`,
      source_date: new Date().toISOString().slice(0, 10),
      source_url: zoning.zoning_source_url || zoning.zoning_bylaw_url,
    });
  }
  if (temperature?.available) {
    rows.push({
      field: 'climate.temperature_profile',
      source_name: temperature.source_name || 'Open-Meteo daily archive',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: temperature.source_url,
    });
  }
  if (wildlife?.available) {
    rows.push({
      field: 'wildlife',
      source_name: wildlife.source_name || 'iNaturalist + Alberta habitat heuristic',
      source_date: new Date().toISOString().slice(0, 10),
      source_url: wildlife.source_url,
    });
  }
  rows.push({
    field: 'sturgeon_county (parcel, land use, neighbourhood)',
    source_name: 'Sturgeon County Property Viewer (ArcGIS FeatureServer)',
    source_date: new Date().toISOString().slice(0, 10),
    source_url: 'https://sturgeoncounty.maps.arcgis.com/apps/instant/media/index.html?appid=5f73684b6e8c49508b6a153a679ae008',
  });
  rows.push({
    field: 'planting_plan',
    source_name: 'EcoCrop-style suitability · OpenSourceMed Growing Guide / farmfit catalog approach',
    source_date: new Date().toISOString().slice(0, 10),
    source_url: 'https://opensourcemed.info/',
  });
  rows.push({
    field: 'design_elements',
    source_name: 'EE if→then placement ruleset (Alberta-first)',
    source_date: new Date().toISOString().slice(0, 10),
    source_url: 'https://opensourcemed.info/schemas/permaculture-site-design.schema.json',
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