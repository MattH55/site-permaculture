/**
 * Sample NRCan HRDEM DTM for a parcel bbox → elevation grid for 3D terrain.
 *
 * Dataset: High Resolution Digital Elevation Model Mosaic
 * https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b
 * STAC: hrdem-mosaic-1m / hrdem-mosaic-2m / hrdem-lidar
 * CRS: EPSG:3979 (NAD83 CSRS / Canada Atlas Lambert), 1–2 m cells — resampled
 * here onto a north-up lat/lon grid (cog-lonlat-grid.js).
 */

import { sampleCogToLonLatGrid } from './cog-lonlat-grid.js';

const STAC_SEARCH = 'https://datacube.services.geo.ca/stac/api/search';
const HRDEM_DATASET =
  'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b';
const FETCH_MS = 28_000;

/**
 * @param {{ west:number,south:number,east:number,north:number }} bbox
 * @param {{ size?: number, prefer?: 'dtm'|'dsm' }} [opts]
 */
export async function sampleHrdemTerrain(bbox, opts = {}) {
  if (!bbox || bbox.west == null) {
    return empty('invalid_bbox');
  }

  const size = Math.min(Math.max(opts.size ?? 64, 16), 96);
  const prefer = opts.prefer || 'dtm';

  let assetUrl = null;
  let collection = null;
  let itemId = null;
  try {
    const hit = await findHrdemAsset(bbox, prefer);
    if (!hit) return empty('no_hrdem_coverage');
    assetUrl = hit.href;
    collection = hit.collection;
    itemId = hit.id;
  } catch (e) {
    return empty('stac_failed', e.message);
  }

  try {
    // North-up lat/lon grid — see cog-lonlat-grid.js for why the raw
    // EPSG:3979 window must not be used directly.
    const grid = await sampleCogToLonLatGrid(assetUrl, bbox, size);
    if (!grid || !grid.elevations_m?.some((z) => z != null)) {
      return empty('no_samples');
    }
    return {
      available: true,
      source: 'NRCan HRDEM DTM mosaic',
      dataset_url: HRDEM_DATASET,
      collection,
      item_id: itemId,
      asset: prefer,
      resolution_m: collection?.includes('1m') ? 1 : 2,
      source_crs: 'EPSG:3979',
      crs: 'EPSG:4326',
      grid_orientation: grid.grid_orientation,
      source_grid_convergence_deg: grid.source_grid_convergence_deg,
      rows: grid.rows,
      cols: grid.cols,
      elevations_m: grid.elevations_m,
      elevation_min_m: grid.min,
      elevation_max_m: grid.max,
      elevation_mean_m: grid.mean,
      relief_m: grid.max != null && grid.min != null ? round1(grid.max - grid.min) : null,
      bbox: { ...bbox },
      licence: 'Open Government Licence - Canada',
      note:
        '3D terrain surface sampled from NRCan HRDEM (DTM). Vertical exaggeration is applied in the viewer for readability.',
    };
  } catch (e) {
    return empty('sample_failed', e.message);
  }
}

async function findHrdemAsset(bbox, prefer) {
  const collections = ['hrdem-mosaic-1m', 'hrdem-mosaic-2m', 'hrdem-lidar'];
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `${STAC_SEARCH}?collections=${collections.join(',')}&bbox=${bboxParam}&limit=6`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  let data;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`STAC ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(t);
  }
  const features = data?.features || [];
  if (!features.length) return null;

  // Prefer 1 m mosaic, then 2 m, then lidar project
  const rank = (f) => {
    const c = f.collection || '';
    if (c.includes('1m')) return 3;
    if (c.includes('2m')) return 2;
    if (c.includes('lidar')) return 1;
    return 0;
  };
  features.sort((a, b) => rank(b) - rank(a));

  for (const f of features) {
    const assets = f.assets || {};
    const key =
      prefer === 'dsm'
        ? assets.dsm
          ? 'dsm'
          : assets.dtm
            ? 'dtm'
            : null
        : assets.dtm
          ? 'dtm'
          : assets.dsm
            ? 'dsm'
            : null;
    if (!key || !assets[key]?.href) continue;
    return {
      href: assets[key].href,
      collection: f.collection,
      id: f.id,
      key,
    };
  }
  return null;
}

function empty(code, message) {
  return {
    available: false,
    error: code,
    message: message || code,
    dataset_url: HRDEM_DATASET,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
