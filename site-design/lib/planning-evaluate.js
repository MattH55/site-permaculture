/**
 * Click-to-place live evaluation for interactive planning mode — see
 * interactive-planning-mode-instructions.md. A user clicks any point on the
 * 3D twin (not just inside a pre-computed optimal zone) and picks a feature
 * type; this runs the real underlying model scoped to that one point,
 * rather than a stripped-down interactive-only approximation.
 *
 * Deliberately reuses the exact same model functions the full report runs
 * (computeSolarHorizonShading, modelPondWaterBalance) so a user-placed
 * candidate carries the same confidence/assumption flags as a pre-computed
 * one (spec: "Confidence flagging").
 *
 * Planting is scoped down from the full spec: this codebase has no
 * zone-level crop-suitability breakdown with polygon geometry (planting.js
 * produces one parcel-wide ranked list, not per-zone ones), so "does this
 * point fall inside an identified plantable zone" is answered from the
 * dense-canopy / surface-water exclusions already computed elsewhere
 * (canopy.js render_zones, surface_water.js), and a hit returns the
 * parcel-wide top recommendations rather than a zone-specific list. That's
 * flagged explicitly in the response (`zone_specific: false`) rather than
 * presented as more precise than it is.
 */

import { computeSolarHorizonShading } from './solar-horizon-shading.js';
import { modelPondWaterBalance } from './pond-water-balance.js';

/**
 * @param {object} params
 * @param {'solar'|'pond'|'planting'} params.feature_type
 * @param {{lat:number, lon:number}} params.position
 * @param {object} [params.user_params]
 * @param {object} params.context Slices of the full site report needed to
 *   run the point evaluation — the same data the 3D twin already holds in
 *   the browser (terrain grid, canopy, soil, wind rose, solar, precipitation).
 */
export function evaluatePlanningClick({ feature_type, position, user_params = {}, context = {} }) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) {
    return { available: false, error: 'A valid {lat, lon} position is required.' };
  }

  switch (feature_type) {
    case 'solar':
      return evaluateSolarPoint(position, context);
    case 'pond':
      return evaluatePondPoint(position, user_params, context);
    case 'planting':
      return evaluatePlantingPoint(position, context);
    default:
      return { available: false, error: `Unknown feature_type "${feature_type}" — expected solar, pond, or planting.` };
  }
}

function evaluateSolarPoint(position, context) {
  const result = computeSolarHorizonShading({
    elevations: context.elevations || [],
    rows: context.rows || 0,
    cols: context.cols || 0,
    bbox: context.bbox,
    latitude: context.latitude,
    longitude: context.longitude,
    canopy: context.canopy,
    year: context.year,
    dem_confidence: context.dem_confidence,
    data_source: context.data_source,
    candidatePoints: [position],
  });
  if (!result.available) {
    return { available: false, reason: result.note || 'Insufficient terrain data for a solar evaluation at this point.' };
  }
  const point = (result.per_point || [])[0] || null;
  return {
    available: !!point,
    point,
    canopy_shading_assumption: result.canopy_shading_assumption,
    canopy_shading_note: result.canopy_shading_note,
    methodology: result.methodology,
    data_source: result.data_source,
    confidence: result.confidence,
  };
}

function evaluatePondPoint(position, userParams, context) {
  const result = modelPondWaterBalance({
    elevations: context.elevations || [],
    rows: context.rows || 0,
    cols: context.cols || 0,
    bbox: context.bbox,
    precipitation: context.precipitation,
    parcel_area_m2: context.parcel_area_m2,
    soil_data: context.soil_data,
    canopy: context.canopy,
    wind_rose: context.wind_rose,
    solar: context.solar,
    liner_assumption: userParams.liner_assumption,
    target_use_volume_m3: userParams.target_use_volume_m3,
    pond_point: { lat: position.lat, lon: position.lon },
    catchment_area_m2: userParams.catchment_area_m2,
    assumed_surface_area_m2: userParams.assumed_surface_area_m2 || 300, // medium-tier default; user-adjustable
  });
  return {
    available: result.available,
    tiers: result.tiers,
    catchment_area_m2: result.catchment_area_m2,
    catchment_landcover_breakdown: result.catchment_landcover_breakdown,
    hydrologic_soil_group: result.hydrologic_soil_group,
    liner_assumption: result.liner_assumption,
    evaporation_exposure_factor: result.evaporation_exposure_factor,
    confidence: result.confidence,
    assumptions: result.assumptions,
    data_source: result.data_source,
  };
}

function evaluatePlantingPoint(position, context) {
  const denseZones = (context.canopy?.available ? context.canopy.render_zones || [] : [])
    .filter((z) => z.render_mode === 'billboard_impostor');
  if (denseZones.some((z) => pointInPolygon(position.lon, position.lat, z.geometry?.coordinates?.[0] || []))) {
    return { available: false, reason: 'This point falls inside existing dense canopy/woodlot — not open plantable ground.' };
  }
  const waterBodies = context.surface_water?.water_bodies || [];
  if (waterBodies.some((w) => pointInPolygon(position.lon, position.lat, w.geometry?.coordinates?.[0] || []))) {
    return { available: false, reason: 'This point falls on mapped surface water — not plantable ground.' };
  }

  const topPlantings = (context.recommended_plantings || context.planting_plan?.recommended || [])
    .slice(0, 8);
  if (!topPlantings.length) {
    return { available: false, reason: 'No planting recommendations are available for this parcel yet.' };
  }
  return {
    available: true,
    zone_specific: false,
    note: 'Parcel-wide top recommendations — this build does not yet break planting suitability down by zone/polygon, so the same ranked list is shown wherever you click on open ground.',
    recommendations: topPlantings,
  };
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
