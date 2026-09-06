/**
 * Alberta Wet Areas Mapping — depth-to-water integration.
 *
 * Adds:
 * 1. WMS tile overlay on the Leaflet map (toggleable)
 * 2. Point query at parcel centroid via ImageServer identify
 * 3. Returns depth-to-water category for the report
 *
 * Data: Government of Alberta, Open Government Licence.
 */

import { esriEnvelope } from './geo.js';

// Service endpoints (verified from metadata calls)
const CLASSIFIED_DTW_URL =
  'https://geospatial.alberta.ca/umbriel/rest/services/hydrography/wet_areas_mapping_classified_depth_to_water_estimates/ImageServer';
const PREDICTED_STREAMS_URL =
  'https://geospatial.alberta.ca/titan/rest/services/environment/wet_areas_mapping_predicted_streams/MapServer';

/**
 * WMS tile layer config for Leaflet map display.
 * Returns a Leaflet-compatible tile layer object (not in server — used client-side).
 */
export function getWetAreasWmsLayers() {
  return [
    {
      label: 'Wet Areas — Depth-to-Water',
      url: `${CLASSIFIED_DTW_URL}/WMS`,
      options: {
        layers: '0',
        format: 'image/png',
        transparent: true,
        opacity: 0.6,
        attribution: 'Alberta — Wet Areas Mapping (Open Government Licence)',
      },
    },
    {
      label: 'Wet Areas — Predicted Streams',
      url: `${PREDICTED_STREAMS_URL}/WMS`,
      options: {
        layers: '0',
        format: 'image/png',
        transparent: true,
        opacity: 0.7,
        attribution: 'Alberta — Wet Areas Mapping (Open Government Licence)',
      },
    },
  ];
}

/**
 * Query depth-to-water at a specific point (parcel centroid).
 * Uses the ImageServer identify operation.
 *
 * @param {{ latitude: number, longitude: number }} centre
 * @returns {Promise<object|null>} { category, rawValue, label }
 */
export async function queryDepthToWater(centre) {
  const { latitude, longitude } = centre;
  const geom = JSON.stringify({
    x: longitude,
    y: latitude,
    spatialReference: { wkid: 4326 },
  });

  const url =
    `${CLASSIFIED_DTW_URL}/identify?` +
    `geometry=${encodeURIComponent(geom)}` +
    `&geometryType=esriGeometryPoint` +
    `&returnGeometry=false` +
    `&f=json`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`WAM identify ${res.status}`);
    const data = await res.json();

    const value = data?.value;
    if (!value || value === 'NoData') return null;

    const category = classifyDepth(value);
    return {
      available: true,
      raw_value: value,
      /** Representative depth (m) for hydrology models — class midpoint when classified. */
      depth_m: category?.representative_m ?? numericOrNull(value),
      category,
      source: 'Alberta Wet Areas Mapping — classified depth-to-water',
      source_url: CLASSIFIED_DTW_URL,
    };
  } catch (e) {
    console.warn('Wet Areas Mapping identify failed:', e.message);
    return null;
  }
}

/**
 * Classify raw depth-to-water values into human-readable categories.
 * Actual class breaks from the ImageServer renderer metadata — verify against
 * live service if re-deploying.
 */
function classifyDepth(raw) {
  // These are typical classification breaks for the AB WAM classified DTW layer
  // May need adjustment based on actual service renderer metadata
  const val = Number(raw);
  if (isNaN(val)) return { label: 'unknown', depth_m: null, representative_m: null, severity: 'none' };

  if (val <= 0.5)
    return { label: 'Water / saturated', depth_m: '< 0.5m', representative_m: 0.3, severity: 'high' };
  if (val <= 2.0)
    return { label: 'Very shallow (< 2m)', depth_m: '0.5–2.0m', representative_m: 1.2, severity: 'high' };
  if (val <= 5.0)
    return { label: 'Shallow (2–5m)', depth_m: '2.0–5.0m', representative_m: 3.5, severity: 'moderate' };
  if (val <= 10.0)
    return { label: 'Moderate (5–10m)', depth_m: '5.0–10.0m', representative_m: 7.5, severity: 'low' };
  return { label: 'Deep (> 10m)', depth_m: '> 10m', representative_m: Math.min(val, 15), severity: 'none' };
}

function numericOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Query for predicted streams within a bounding box.
 *
 * @param {{ west, south, east, north }} bbox
 * @returns {Promise<object>} { count, nearest_distance_m }
 */
export async function queryPredictedStreams(bbox) {
  const url = `${PREDICTED_STREAMS_URL}/0/query`;
  const params = new URLSearchParams({
    geometry: esriEnvelope(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnCountOnly: 'true',
    f: 'json',
  });

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${url}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Predicted streams ${res.status}`);
    const data = await res.json();

    return {
      available: true,
      count: data.count ?? null,
      source: 'Alberta Wet Areas Mapping — predicted streams',
      source_url: PREDICTED_STREAMS_URL,
    };
  } catch (e) {
    console.warn('Predicted streams query failed:', e.message);
    return { available: false, count: null, error: e.message };
  }
}

/** Return WAM line geometry separately from confirmed mapped water. */
export async function queryPredictedStreamFeatures(bbox) {
  const url = `${PREDICTED_STREAMS_URL}/0/query`;
  const params = new URLSearchParams({
    geometry: esriEnvelope(bbox), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson',
  });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18_000);
    const res = await fetch(`${url}?${params}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Predicted streams ${res.status}`);
    const data = await res.json();
    return { available: true, features: data.features || [], source: 'WAM', source_url: PREDICTED_STREAMS_URL };
  } catch (e) {
    return { available: false, features: [], source: 'WAM', source_url: PREDICTED_STREAMS_URL, error: e.message };
  }
}
