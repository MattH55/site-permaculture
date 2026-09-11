/**
 * Build a site_environment profile from a Land Intelligence report + click point.
 * This is the interface between the 3D land model and plant intelligence.
 */

import { haversineM } from '../suitability-common.js';

export function buildSiteEnvironment({ report = {}, lat, lon, area_m2 } = {}) {
  const climate = report.climate || {};
  const hydro = report.hydrology || climate;
  const soil = report.soil_profile?.topsoil_0_30cm || report.soil || {};
  const hard = report.hardiness || {};
  const solarR = report.solar_horizon_shading?.solar_exposure_raster;
  const nrcan = report.solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt;
  const annualHours = sampleRaster(solarR, lat, lon, 'annual_insolation_hours');
  const growingHours = sampleRaster(solarR, lat, lon, 'growing_season_insolation_hours');
  const kwhProxy = nrcan != null ? nrcan * 365 : null;

  const elev = sampleElevation(report, lat, lon);
  const slope = report.terrain?.slope_percent != null
    ? Math.atan(report.terrain.slope_percent / 100) * (180 / Math.PI)
    : null;

  return {
    property_id: report._meta?.cache_key || report.site_id || null,
    latitude: lat ?? report.location?.latitude ?? null,
    longitude: lon ?? report.location?.longitude ?? null,
    area_m2: area_m2 ?? (report.geometry?.area_ha != null ? report.geometry.area_ha * 10000 : null),
    elevation_m: elev,
    slope_degrees: slope != null ? round1(slope) : null,
    aspect_degrees: null,
    annual_solar_kwh_m2: kwhProxy,
    growing_season_solar_kwh_m2: growingHours != null && nrcan != null ? round1(nrcan * growingHours * 30) : null,
    annual_insolation_hours: annualHours,
    growing_season_insolation_hours: growingHours,
    annual_precipitation_mm: climate.annual_precipitation_mm || hydro.annual_precipitation_mm || null,
    growing_degree_days: climate.growing_degree_days_base5 || null,
    frost_free_days: hard.frost_free_days_estimate ?? climate.frost_free_days ?? null,
    temperature_min_c: climate.temperature_min_c ?? report.temperature?.mean_january_c ?? null,
    temperature_max_c: climate.temperature_max_c ?? report.temperature?.mean_july_c ?? null,
    hardiness_zone: hard.hardiness_zone || climate.plant_hardiness_zone || null,
    hardiness_zone_canada: hard.hardiness_zone || climate.plant_hardiness_zone || null,
    hardiness_zone_usda: null,
    soil_ph: soil.ph ?? report.soil?.ph ?? null,
    soil_texture: soil.texture || report.soil?.texture || null,
    soil_depth_cm: 30,
    soil_drainage: report.soil_profile?.twi_adjusted_drainage || report.soil?.drainage_class || null,
    soil_moisture: null,
    organic_matter: soil.organic_carbon_pct ?? null,
    available_rooting_depth_cm: report.soil_profile?.subsoil_30cm_plus ? 80 : 40,
    water_availability: hydro.distance_to_nearest_water_m != null && hydro.distance_to_nearest_water_m < 200 ? 'high' : 'moderate',
    irrigation_available: false,
    existing_canopy_cover: report.canopy?.canopy_cover_pct ?? report.tree_cover?.tree_cover_pct ?? null,
    region: 'Alberta',
    light_class: annualHours == null ? null : annualHours >= 6 ? 'full_sun' : annualHours >= 3.5 ? 'part_sun' : 'shade',
  };
}

export function sampleRaster(ras, lat, lon, field = 'annual_insolation_hours') {
  if (lat == null || lon == null || !ras?.[field]?.length || !ras.bbox || !ras.rows || !ras.cols) return null;
  const { bbox, rows, cols } = ras;
  const values = ras[field];
  const u = (lon - bbox.west) / ((bbox.east - bbox.west) || 1);
  const v = (bbox.north - lat) / ((bbox.north - bbox.south) || 1);
  const c = Math.max(0, Math.min(cols - 1, u * (cols - 1)));
  const r = Math.max(0, Math.min(rows - 1, v * (rows - 1)));
  const c0 = Math.min(cols - 2, Math.floor(c));
  const r0 = Math.min(rows - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const at = (rr, cc) => {
    const x = values[rr * cols + cc];
    return Number.isFinite(x) ? x : null;
  };
  const i00 = at(r0, c0);
  const parts = [i00, at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)].filter((x) => x != null);
  if (!parts.length) return null;
  const a = i00 ?? parts[0];
  const b = at(r0, c0 + 1) ?? a;
  const d = at(r0 + 1, c0) ?? a;
  const e = at(r0 + 1, c0 + 1) ?? b;
  return round1(a * (1 - fr) * (1 - fc) + b * (1 - fr) * fc + d * fr * (1 - fc) + e * fr * fc);
}

function sampleElevation(report, lat, lon) {
  const t = report.hrdem_terrain;
  if (!t?.elevations_m?.length || lat == null || lon == null || !t.bbox) {
    return report.location?.elevation_m ?? report.terrain?.elevation_m ?? null;
  }
  const fake = { ...t, annual_insolation_hours: t.elevations_m, rows: t.rows, cols: t.cols };
  return sampleRaster(fake, lat, lon, 'annual_insolation_hours');
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  return haversineM(lat1, lon1, lat2, lon2) / 1000;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
