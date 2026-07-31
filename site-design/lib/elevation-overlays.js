/**
 * Elevation overlays for maps:
 *
 * Contours — Alberta 1:20 000 cartographic contour polylines (same product family
 *   as Altalis Map Gallery id=118). Distributed openly via Alberta Titan
 *   provincial_elevation MapServer (not Altalis' commercial portal).
 *   Altalis viewer: https://www.altalis.com/map;id=118
 *
 * HRDEM — High Resolution Digital Elevation Model Mosaic (NRCan CanElevation)
 *   Open Canada dataset: https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b
 *   WMS: https://datacube.services.geo.ca/ows/elevation
 *   STAC: hrdem-lidar + hrdem-mosaic-1m/2m
 */

import { queryProvincialContours } from './provincial-contours.js';

const HRDEM_WMS = 'https://datacube.services.geo.ca/ows/elevation';
const HRDEM_DATASET =
  'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b';
const HRDEM_STAC = 'https://datacube.services.geo.ca/stac/api/search';
const ALTALIS_CONTOUR_MAP = 'https://www.altalis.com/map;id=118';

/**
 * Full elevation overlay payload for report maps.
 * @param {{ west:number,south:number,east:number,north:number }} bbox
 * @param {{ limit?: number, hrdem_hint?: object }} [opts]
 */
export async function buildElevationOverlays(bbox, opts = {}) {
  const [contours, hrdem] = await Promise.all([
    queryProvincialContours(bbox, {
      limit: opts.limit ?? 1200,
      includeIndex: true,
    }).catch((e) => ({
      type: 'FeatureCollection',
      features: [],
      error: e.message,
      source: 'Alberta provincial elevation',
    })),
    assessHrdemForMap(bbox, opts.hrdem_hint).catch((e) => ({
      available: false,
      error: e.message,
    })),
  ]);

  // Tag contours with Altalis / open-data provenance for the UI
  if (contours && Array.isArray(contours.features)) {
    contours.altalis_map_url = ALTALIS_CONTOUR_MAP;
    contours.product_note =
      'Alberta 1:20 000 cartographic contours (provincial base mapping). ' +
      'Open access via Alberta Geospatial Centre Titan MapServer; commercial browse also on Altalis Map Gallery id=118.';
    contours.source =
      contours.source ||
      'Alberta Provincial Elevation MapServer (Titan) — same product family as Altalis map id=118';
  }

  return {
    contours,
    hrdem,
    sources: {
      contours_open:
        'https://geospatial.alberta.ca/titan/rest/services/elevation/provincial_elevation/MapServer',
      contours_altalis: ALTALIS_CONTOUR_MAP,
      hrdem_dataset: HRDEM_DATASET,
      hrdem_wms: HRDEM_WMS,
    },
  };
}

/**
 * STAC coverage + WMS tile config for Leaflet when HRDEM exists for the AOI.
 */
export async function assessHrdemForMap(bbox, hint) {
  // Prefer live STAC; fall back to pipeline hint from gatherSiteLayers
  const collections = ['hrdem-lidar', 'hrdem-mosaic-1m', 'hrdem-mosaic-2m'];
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `${HRDEM_STAC}?collections=${collections.join(',')}&bbox=${bboxParam}&limit=8`;

  let items = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      items = data.features || [];
    }
  } catch {
    /* use hint */
  }

  const available = items.length > 0 || !!hint?.available;
  const collectionsHit = [
    ...new Set(items.map((f) => f.collection).filter(Boolean)),
  ];
  const hasLidar =
    collectionsHit.includes('hrdem-lidar') ||
    (hint?.projects?.length > 0 && !collectionsHit.length);
  const hasMosaic = collectionsHit.some((c) => String(c).includes('mosaic'));

  // Prefer DTM hillshade for terrain reading; DSM hillshade if only surface available
  const primaryLayer = hasLidar || hasMosaic ? 'dtm-hillshade' : 'dtm-hillshade';

  return {
    available,
    count: items.length || hint?.count || 0,
    collections: collectionsHit.length ? collectionsHit : hint?.projects || [],
    projects: items.map((f) => f.id).slice(0, 6),
    // Leaflet L.tileLayer.wms config (client applies)
    wms: available
      ? {
          url: HRDEM_WMS,
          layers: primaryLayer,
          format: 'image/png',
          transparent: true,
          version: '1.3.0',
          opacity: 0.55,
          attribution:
            'HRDEM Mosaic © His Majesty the King in Right of Canada (NRCan) — Open Government Licence – Canada',
          // Secondary optional layers the UI may toggle
          optional_layers: [
            { id: 'dtm-hillshade', label: 'HRDEM DTM hillshade' },
            { id: 'dsm-hillshade', label: 'HRDEM DSM hillshade' },
            { id: 'dtm-slope', label: 'HRDEM DTM slope' },
          ],
        }
      : null,
    dataset_url: HRDEM_DATASET,
    source_url: HRDEM_STAC,
    note: available
      ? 'HRDEM coverage present — hillshade overlay available on maps (NRCan CanElevation mosaic / LiDAR).'
      : 'No HRDEM mosaic/LiDAR tile in STAC for this box; provincial contours + regional DEM only.',
    licence: 'Open Government Licence - Canada',
  };
}
