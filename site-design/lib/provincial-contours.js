/**
 * Query Alberta Provincial Elevation contour service (ArcGIS MapServer).
 *
 * Layers available:
 *   4 — Index Contour (bold, every 5th interval)
 *   5 — Contour (intermediate lines)
 *
 * Product: 1:20 000 cartographic contours from the Provincial Digital Base Mapping
 * Project — the same contour product family browsed commercially on Altalis
 * Map Gallery id=118 (https://www.altalis.com/map;id=118). We use the open
 * Alberta Geospatial Centre Titan MapServer distribution (no Altalis login).
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
  // 4 = Index Contour, 5 = Contour (intermediate). Annotation layer 3 has TEXT elevations.
  const layers = includeIndex ? [4, 5, 3] : [5];

  const allFeatures = [];

  for (const layerId of layers) {
    const url = `${CONTOUR_URL}/${layerId}/query`;

    // ArcGIS query requires geometry in service CRS (EPSG:3400).
    // We send WGS84 and let ArcGIS reproject (pass inSR=4326).
    // outFields must be * — this service has no ELEVATION attribute on line layers
    // (elevation text is on annotation layer 3). Requesting ELEVATION returns 400.
    const params = new URLSearchParams({
      geometry: esriEnvelope(bbox),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
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
      if (data.error) {
        console.warn(`Provincial contours layer ${layerId}:`, data.error.message);
        continue;
      }

      if (!data.features?.length) continue;

      for (const feat of data.features) {
        const coords = feat.geometry?.paths || feat.geometry?.coordinates;
        if (!coords?.length) continue;

        const attrs = feat.attributes || {};
        // Annotation layer carries TEXT="650"; line layers use FEATURE_TYPE only
        const elevRaw = attrs.TEXT ?? attrs.ELEVATION ?? attrs.Elevation ?? null;
        const elev =
          elevRaw != null && elevRaw !== '' && !Number.isNaN(Number(elevRaw))
            ? Number(elevRaw)
            : null;
        const ftype = String(attrs.FEATURE_TYPE || '');
        const isIndex =
          layerId === 4 ||
          layerId === 3 ||
          /INDEX/i.test(ftype);

        // Each "path" is an array of [lng, lat] (ArcGIS returns in WGS84 when outSR=4326)
        for (const path of coords) {
          if (path.length < 2) continue;
          allFeatures.push({
            type: 'Feature',
            properties: {
              elevation_m: elev,
              ELEVATION: elev,
              contour_type: isIndex ? 'index' : 'intermediate',
              feature_type: ftype || null,
              feature_code: attrs.FEATURE_CODE || null,
              source: 'Alberta provincial elevation MapServer (Altalis map 118 family)',
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
    source:
      'Alberta Provincial Elevation MapServer (Titan) — 1:20k contours (Altalis map id=118 product family)',
    source_url: CONTOUR_URL,
    altalis_map_url: 'https://www.altalis.com/map;id=118',
    open_data_url:
      'https://open.alberta.ca/opendata/gda-d57d86ba-41d0-48a0-848b-da30171c44f5',
  };
}