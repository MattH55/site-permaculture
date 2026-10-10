/**
 * Roads/Access layer: fetch road geometries near a parcel for 3D map rendering.
 *
 * Sources (by priority, per roads-access-layer-instructions.md):
 * 1. AltaLIS / Alberta Transportation — classified road network (AB only)
 * 2. OpenStreetMap Overpass — primary fallback everywhere
 * 3. Overture Maps — last-resort gap-fill
 *
 * Returns GeoJSON FeatureCollection of LineString road segments with
 * classification tags (highway type, surface, name).
 */


import { overpassQuery } from './overpass.js';

/**
 * Fetch road ways from OSM Overpass within a bounding box.
 * @param {{west:number, south:number, east:number, north:number}} bbox
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export async function fetchRoadsOsm(bbox, timeoutMs = 15_000) {
  const query = `
[out:json][timeout:12];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out geom;
`.trim();

  const r = await overpassQuery(query, { timeoutMs, deadlineMs: timeoutMs * 2 });
  if (r.ok) return osmToGeoJSON(r.data);
  console.warn('[roads] Overpass failed:', r.error);
  return { type: 'FeatureCollection', features: [], error: r.error };
}

function osmToGeoJSON(osmData) {
  const features = [];
  const elements = osmData.elements || [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    const coords = el.geometry.map((pt) => [pt.lon, pt.lat]);
    const tags = el.tags || {};
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        osm_id: el.id,
        highway: tags.highway || 'road',
        name: tags.name || tags.ref || null,
        surface: tags.surface || null,
        lanes: tags.lanes ? parseInt(tags.lanes, 10) : null,
        oneway: tags.oneway === 'yes',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Fetch roads for a parcel bbox. Currently OSM-only; AltaLIS and Overture
 * fallbacks are specified but not yet wired.
 */
export async function fetchRoadsLayer(bbox) {
  return fetchRoadsOsm(bbox);
}