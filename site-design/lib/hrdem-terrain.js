/**
 * Sample NRCan HRDEM DTM for a parcel bbox → elevation grid for 3D terrain.
 *
 * Dataset: High Resolution Digital Elevation Model Mosaic
 * https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b
 * STAC: hrdem-mosaic-1m / hrdem-mosaic-2m / hrdem-lidar
 * CRS: EPSG:3979 (NAD83 CSRS / Canada Atlas Lambert), 1–2 m cells
 */

import { fromUrl } from 'geotiff';
import { lonLatToEpsg3979 } from './vegetation-indices.js';

const STAC_SEARCH = 'https://datacube.services.geo.ca/stac/api/search';
const HRDEM_DATASET =
  'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b';
const FETCH_MS = 28_000;
const NODATA_LO = -1000;
const NODATA_HI = 9000;

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
    const grid = await sampleCogWindow(assetUrl, bbox, size);
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
      crs: 'EPSG:3979',
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

/**
 * Read a rectangular window from the COG covering the WGS84 bbox, downsample to size×size.
 */
async function sampleCogWindow(href, bbox, size) {
  const tiff = await fromUrl(href, { allowFullFile: false, blockSize: 65536 });
  const img = await tiff.getImage();
  const origin = img.getOrigin();
  const res = img.getResolution();
  const resX = res[0];
  const resY = res[1]; // negative
  const w = img.getWidth();
  const h = img.getHeight();

  // Project bbox corners to EPSG:3979
  const corners = [
    lonLatToEpsg3979(bbox.west, bbox.south),
    lonLatToEpsg3979(bbox.east, bbox.south),
    lonLatToEpsg3979(bbox.west, bbox.north),
    lonLatToEpsg3979(bbox.east, bbox.north),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  // Pad slightly
  const pad = Math.max((x1 - x0) * 0.05, (y1 - y0) * 0.05, 20);
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;

  let c0 = Math.floor((x0 - origin[0]) / resX);
  let c1 = Math.ceil((x1 - origin[0]) / resX);
  let r0 = Math.floor((y1 - origin[1]) / resY); // north → smaller row when resY < 0
  let r1 = Math.ceil((y0 - origin[1]) / resY);
  if (r0 > r1) [r0, r1] = [r1, r0];

  c0 = clamp(c0, 0, w - 1);
  c1 = clamp(c1, c0 + 1, w);
  r0 = clamp(r0, 0, h - 1);
  r1 = clamp(r1, r0 + 1, h);

  // Cap raw read size (~4 M cells max)
  const maxSide = 512;
  let winW = c1 - c0;
  let winH = r1 - r0;
  if (winW > maxSide || winH > maxSide) {
    const scale = Math.max(winW / maxSide, winH / maxSide);
    const nc = Math.floor(winW / scale);
    const nr = Math.floor(winH / scale);
    const midC = Math.floor((c0 + c1) / 2);
    const midR = Math.floor((r0 + r1) / 2);
    c0 = clamp(midC - Math.floor(nc / 2), 0, w - 1);
    c1 = clamp(c0 + nc, 1, w);
    r0 = clamp(midR - Math.floor(nr / 2), 0, h - 1);
    r1 = clamp(r0 + nr, 1, h);
    winW = c1 - c0;
    winH = r1 - r0;
  }

  const ctrlTimeout = setTimeout(() => {}, FETCH_MS); // placeholder for API shape
  clearTimeout(ctrlTimeout);

  const rasters = await img.readRasters({
    window: [c0, r0, c1, r1],
    width: size,
    height: size,
    resampleMethod: 'bilinear',
  });
  const band = rasters[0];
  const elevations_m = new Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < band.length; i++) {
    let z = band[i];
    if (z == null || !Number.isFinite(z) || z < NODATA_LO || z > NODATA_HI) {
      elevations_m[i] = null;
      continue;
    }
    z = round1(z);
    elevations_m[i] = z;
    min = Math.min(min, z);
    max = Math.max(max, z);
    sum += z;
    n++;
  }
  if (!n) return null;
  return {
    rows: size,
    cols: size,
    elevations_m,
    min: round1(min),
    max: round1(max),
    mean: round1(sum / n),
  };
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
