/**
 * Query Alberta Provincial Elevation contour service (ArcGIS MapServer).
 *
 * Layers available:
 *   4 — Index Contour (bold, every 5th interval)
 *   5 — Contour (intermediate lines)
 *
 * Uses the Titan ArcGIS REST API — same as other Alberta geospatial sources.
 * CRS: EPSG:3400 (Alberta 10TM Forest, NAD83 CSRS).
 *
 * Each contour polyline has an ELEVATION attribute (metres).
 */

import { esriEnvelope } from './geo.js';

const CONTOUR_URL =
  'https://geospatial.alberta.ca/titan/rest/services/elevation/provincial_elevation/MapServer';

/**
 * Query provincial contours within a bounding box.
 *
 * @param {{ west: number, south: number, east: number, north: number }} bbox - WGS84
 * @param {{ limit?: number, includeIndex?: boolean }} opts
 * @returns {Promise<{ type: 'FeatureCollection', features: Array }>}
 */
export async function queryProvincialContours(bbox, opts = {}) {
  const limit = opts.limit || 2000;
  const includeIndex = opts.includeIndex !== false;
  const layers = includeIndex ? [4, 5] : [5];

  const allFeatures = [];

  for (const layerId of layers) {
    const url = `${CONTOUR_URL}/${layerId}/query`;

    // ArcGIS query requires geometry in service CRS (EPSG:3400).
    // We send WGS84 and let ArcGIS reproject (pass inSR=4326).
    const params = new URLSearchParams({
      geometry: esriEnvelope(bbox),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ELEVATION',
      returnGeometry: 'true',
      outSR: '4326', // Return in WGS84 for Leaflet
      f: 'json',
      resultRecordCount: String(limit),
      where: '1=1',
    });

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const res = await fetch(`${url}?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(t);

      if (!res.ok) continue;
      const data = await res.json();

      if (!data.features?.length) continue;

      for (const feat of data.features) {
        const coords = feat.geometry?.paths || feat.geometry?.coordinates;
        if (!coords?.length) continue;

        const elev = feat.attributes?.ELEVATION;
        const isIndex = layerId === 4;

        // Each "path" is an array of [lng, lat] (ArcGIS returns in WGS84 when outSR=4326)
        for (const path of coords) {
          if (path.length < 2) continue;
          allFeatures.push({
            type: 'Feature',
            properties: {
              elevation_m: elev != null ? Number(elev) : null,
              ELEVATION: elev != null ? Number(elev) : null,
              contour_type: isIndex ? 'index' : 'intermediate',
              source: 'Alberta provincial elevation MapServer',
              licence: 'Open Government Licence - Alberta',
            },
            geometry: {
              type: 'LineString',
              coordinates: path, // [[lng, lat], ...]
            },
          });
          if (allFeatures.length >= limit) break;
        }
        if (allFeatures.length >= limit) break;
      }
    } catch (e) {
      console.warn(`Provincial contours layer ${layerId} query failed:`, e.message);
    }
  }

  return {
    type: 'FeatureCollection',
    features: allFeatures.slice(0, limit),
    source: 'Alberta Provincial Elevation MapServer (Titan ArcGIS REST)',
    source_url: CONTOUR_URL,
  };
}