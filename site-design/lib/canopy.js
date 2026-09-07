/**
 * Canopy / tree layer: build a Canopy Height Model (CHM) for a parcel and
 * extract individual tree instances (x, y, height_m, crown_radius_m, data_source).
 *
 * Data-source priority (checked in this order):
 *   1. NRCan HRDEM — only where the tile publishes BOTH a DTM and a DSM
 *      (some tiles are DTM-only). CHM = DSM − DTM. Coverage + product
 *      availability are checked against the live STAC index at request time.
 *   2. Meta/WRI Global Canopy Height (Google Earth Engine) — fallback for
 *      every parcel HRDEM does not fully cover, or that is DTM-only.
 *
 * ABMI LiDAR is intentionally DISABLED (see abmi-lidar.js). Its one released
 * bundle covers a small fraction of Alberta and the ~138GB bulk download is
 * not worth the infrastructure. If it is ever revisited, the correct
 * architecture is tile-level/windowed COG access, not a local bulk cache.
 *
 * Caching: rasters + extraction are cached per parcel bbox (with the
 * data_source stored alongside) since none of these sources update
 * frequently. In-memory Map is primary; a JSON file cache (data/cache/canopy)
 * lets re-renders/reports stay consistent across server restarts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fromUrl } from 'geotiff';
import { lonLatToEpsg3979 } from './vegetation-indices.js';
import { cacheKey } from './geo.js';

const CACHE_DIR = path.join(import.meta.dirname, '..', 'data', 'cache', 'canopy');

const STAC_SEARCH = 'https://datacube.services.geo.ca/stac/api/search';
const HRDEM_COLLECTIONS = ['hrdem-mosaic-1m', 'hrdem-mosaic-2m', 'hrdem-lidar'];
const HRDEM_DATASET =
  'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b';

const NODATA_LO = -1000;
const NODATA_HI = 9000;
// CHM values below this are treated as ground / non-vegetation.
const MIN_CHM_M = 0.75;
// Absolute CHM upper bound for sanity (tall boreal conifers).
const MAX_CHM_M = 70;

// Tree-instance extraction window is intentionally coarser than the CHM
// grid — one detected tree spans many CHM cells, and the parcel is small.
const DEFAULT_WINDOW = 24;

/**
 * Data-source identifier → pipeline evidence-confidence convention.
 *   NRCAN_HRDEM            → high   (local LiDAR-derived, DSM − DTM)
 *   GEE_GLOBAL_CANOPY_FALLBACK → moderate  (global remote sensing, not a local survey)
 */
export const SOURCE_CONFIDENCE = {
  NRCAN_HRDEM: 'high',
  GEE_GLOBAL_CANOPY_FALLBACK: 'moderate',
  ABMI_LIDAR: 'high', // reserved — ABMI disabled for now
};

/**
 * Convenience confidence lookup. Unknown/missing sources → 'low'.
 * @param {string|null} dataSource
 */
export function canopyConfidence(dataSource) {
  if (!dataSource) return 'low';
  return SOURCE_CONFIDENCE[dataSource] || 'moderate';
}

/**
 * Human-facing note for report text (shade estimates, biomass notes, etc.)
 * generated from this layer. GEE fallback MUST be surfaced, not edge-cased.
 * @param {string|null} dataSource
 */
export function canopySourceNote(dataSource) {
  if (dataSource === 'GEE_GLOBAL_CANOPY_FALLBACK') {
    return (
      'Canopy/tree-height layer is based on global remote-sensing data ' +
      '(Meta/WRI Global Canopy Height via Google Earth Engine), not a local ' +
      'survey. Moderate confidence — verify on the ground before design decisions.'
    );
  }
  if (dataSource === 'NRCAN_HRDEM') {
    return (
      'Canopy/tree-height layer is derived from NRCan HRDEM LiDAR (DSM − DTM). ' +
      'High confidence local LiDAR-derived surface.'
    );
  }
  return 'Canopy/tree-height layer not available for this parcel.';
}

/* ------------------------------------------------------------------ */
/* Memory + file cache (per parcel bbox)                              */
/* ------------------------------------------------------------------ */

const memCache = new Map(); // key -> result (in-process fast path)
const MEM_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — sources are quasi-static

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    /* non-fatal */
  }
}

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

function readCached(key) {
  try {
    const p = cachePath(key);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed._cached_at) return null;
    if (Date.now() - parsed._cached_at > MEM_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCached(key, result) {
  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath(key), JSON.stringify({ _cached_at: Date.now(), ...result }));
  } catch {
    /* non-fatal */
  }
}


/* ------------------------------------------------------------------ */
/* Main entry point                                                   */
/* ------------------------------------------------------------------ */

/**
 * Build the CHM + tree-instance layer for a parcel bbox.
 *
 * @param {{ west:number,south:number,east:number,north:number }} bbox
 * @param {{ size?: number, window?: number, force?: boolean,
 *           ring?: number[][], geeService?: object }} [opts]
 *   - size:    CHM raster resolution (square, 16–96 cells).
 *   - window:  tree-detection window (square, 8–64 cells). Coarser than size.
 *   - force:   bypass cache and re-fetch.
 *   - ring:    optional parcel ring (GeoJSON [[lng,lat],…]) for polygon
 *              clipping; falls back to bbox when omitted.
 *   - geeService: optional Google Earth Engine service handle so the GEE
 *              fallback can resolve the live Meta/WRI canopy asset. Without
 *              it (and without GEE_CANOPY_ASSET_ID), the GEE path returns a
 *              documented "gee_not_configured" (see below).
 */
export async function buildCanopyLayer(bbox, opts = {}) {
  if (!bbox || bbox.west == null) return unavailable('invalid_bbox');
  const size = Math.min(Math.max(opts.size ?? 48, 16), 96);
  const window = Math.min(Math.max(opts.window ?? DEFAULT_WINDOW, 8), 64);

  const key = cacheKey(bbox);
  if (!opts.force) {
    const hit = memCache.get(key) || readCached(key);
    if (hit && hit.available !== undefined) {
      memCache.set(key, hit);
      return { ...hit, _meta: { ...hit._meta, cache: 'hit' } };
    }
  }

  // ABMI LiDAR is disabled — coverage gate always false (kept as a stub so it
  // can be slotted back in later without redesigning this module).
  const abmiHit = abmiCovers(bbox); // → false, always
  let chm = null;
  let dataSource = null;
  let sourceInfo = null;
  if (abmiHit) {
    // Disabled. Reserved for a future COG-based tile access path.
    sourceInfo = { source: 'ABMI_LIDAR', reason: 'disabled' };
  }

  // 1) HRDEM: only usable when the tile has BOTH dtm + dsm.
  const hrdem = await hrdemCanopy(bbox, size, opts).catch((e) => ({
    available: false,
    error: 'stac_failed',
    message: e.message,
  }));
  if (hrdem.available) {
    chm = hrdem;
    dataSource = 'NRCAN_HRDEM';
    sourceInfo = {
      source: 'NRCAN_HRDEM',
      dataset_url: HRDEM_DATASET,
      collection: hrdem.collection,
      item_id: hrdem.item_id,
      resolution_m: hrdem.resolution_m,
    };
  } else {
    // 2) GEE fallback — global coverage, zero acquisition cost.
    const gee = await geeCanopyFallback(bbox, size, opts);
    if (gee.available) {
      chm = gee;
      dataSource = 'GEE_GLOBAL_CANOPY_FALLBACK';
      sourceInfo = {
        source: 'GEE_GLOBAL_CANOPY_FALLBACK',
        asset: gee.asset,
        asset_confirmed: gee.asset_confirmed === true,
        resolution_m: gee.resolution_m,
      };
    } else {
      // No source usable — return an honest "unavailable" with the reason.
      return cacheAndReturn(
        key,
        unavailable(hrdem.error || gee.error || 'no_canopy_source', {
          hrdem,
          gee,
          note:
            hrdem.error === 'dtm_only'
              ? 'HRDEM covers the parcel but the tile is DTM-only (no DSM); GEE fallback not configured.'
              : 'No usable canopy source for this parcel.',
        })
      );
    }
  }

  const result = extractTrees(chm, bbox, {
    size,
    window,
    ring: opts.ring || null,
    parcel_area_m2: ringAreaM2(opts.ring || null) || bboxAreaM2(bbox),
    data_source: dataSource,
    source_info: sourceInfo,
    confidence: canopyConfidence(dataSource),
  });

  // Store data_source alongside the cached result so re-renders/reports stay
  // consistent with how the data was originally sourced.
  return cacheAndReturn(key, result);
}

function cacheAndReturn(key, result) {
  memCache.set(key, result);
  if (result.available) writeCached(key, result);
  return result;
}

function unavailable(code, extra = {}) {
  return {
    available: false,
    error: code,
    data_source: null,
    confidence: 'low',
    tree_instances: [],
    tree_count: 0,
    canopy_cover_pct: 0,
    _meta: { reason: code },
    ...extra,
  };
}

/* ------------------------------------------------------------------ */
/* ABMI coverage gate — DISABLED stub                                 */
/* ------------------------------------------------------------------ */

/**
 * ABMI LiDAR coverage gate. Always returns false because the ABMI path is
 * disabled (see module header). Kept as a function so it can be re-enabled
 * later without redesigning the source-resolution chain.
 *
 * @param {{ west:number,south:number,east:number,north:number }} _bbox
 * @returns {boolean} always false
 */
export function abmiCovers(_bbox) {
  return false;
}

/* ------------------------------------------------------------------ */
/* Internal debug export (used by scripts/canopy-smoke.mjs)           */
/* ------------------------------------------------------------------ */

export const _internal = {
  watershedBasins,
  downsample,
  extractTrees,
  deterministicNoise,
  classifyCanopyRenderZones,
  MIN_CHM_M,
};

/* ------------------------------------------------------------------ */
/* HRDEM source: CHM = DSM − DTM                                      */
/* ------------------------------------------------------------------ */

/**
 * Fetch HRDEM DTM and DSM for the bbox and return CHM = DSM − DTM.
 * Only succeeds when the covering tile publishes BOTH assets; DTM-only
 * tiles return { available:false, error:'dtm_only' } so the caller can
 * fall back to GEE.
 */
async function hrdemCanopy(bbox, size, _opts) {
  const dtm = await findHrdemAsset(bbox, 'dtm');
  if (!dtm) return { available: false, error: 'no_hrdem_coverage' };
  const dsm = await findHrdemAsset(bbox, 'dsm');
  if (!dsm) {
    return { available: false, error: 'dtm_only', collection: dtm.collection, item_id: dtm.id };
  }

  const [dtmGrid, dsmGrid] = await Promise.all([
    sampleCogWindow(dtm.href, bbox, size),
    sampleCogWindow(dsm.href, bbox, size),
  ]);
  if (!dtmGrid || !dsmGrid) return { available: false, error: 'no_samples' };

  const elevations_m = new Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < size * size; i++) {
    const d = dsmGrid.elevations_m[i];
    const t = dtmGrid.elevations_m[i];
    if (d == null || t == null) {
      elevations_m[i] = null;
      continue;
    }
    const h = Math.max(0, Math.min(MAX_CHM_M, d - t));
    elevations_m[i] = round1(h);
    min = Math.min(min, h);
    max = Math.max(max, h);
    sum += h;
    n++;
  }
  if (!n) return { available: false, error: 'no_samples' };

  const resolution_m = dtm.collection?.includes('1m') ? 1 : 2;
  return {
    available: true,
    source: 'NRCan HRDEM (DSM − DTM)',
    dataset_url: HRDEM_DATASET,
    collection: dtm.collection,
    item_id: dtm.id,
    asset: 'dtm+dsm',
    resolution_m,
    crs: 'EPSG:3979',
    rows: size,
    cols: size,
    elevations_m,
    chm_min_m: round1(min),
    chm_max_m: round1(max),
    chm_mean_m: round1(sum / n),
  };
}

/**
 * Live STAC coverage-index lookup: find an HRDEM feature covering the bbox
 * that exposes a `dtm` or `dsm` asset. (Not hardcoded — coverage changes over
 * time, so this checks the live index at request time.)
 * @param {object} bbox
 * @param {'dtm'|'dsm'} prefer
 */
async function findHrdemAsset(bbox, prefer) {
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = `${STAC_SEARCH}?collections=${HRDEM_COLLECTIONS.join(',')}&bbox=${bboxParam}&limit=6`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let data;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`STAC ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const features = data?.features || [];
  if (!features.length) return null;

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
      prefer === 'dsm' ? (assets.dsm ? 'dsm' : null) : assets.dtm ? 'dtm' : null;
    if (!key || !assets[key]?.href) continue;
    return { href: assets[key].href, collection: f.collection, id: f.id, key };
  }
  return null;
}

/**
 * Read a rectangular window from a COG covering the WGS84 bbox, downsampled
 * to size×size. (Mirrors hrdem-terrain.js sampling.)
 */
async function sampleCogWindow(href, bbox, size) {
  const tiff = await fromUrl(href, { allowFullFile: false, blockSize: 65536 });
  const img = await tiff.getImage();
  const origin = img.getOrigin();
  const res = img.getResolution();
  const resX = res[0];
  const resY = res[1];
  const w = img.getWidth();
  const h = img.getHeight();

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
  const pad = Math.max((x1 - x0) * 0.05, (y1 - y0) * 0.05, 20);
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;

  let c0 = Math.floor((x0 - origin[0]) / resX);
  let c1 = Math.ceil((x1 - origin[0]) / resX);
  let r0 = Math.floor((y1 - origin[1]) / resY);
  let r1 = Math.ceil((y0 - origin[1]) / resY);
  if (r0 > r1) [r0, r1] = [r1, r0];

  c0 = clamp(c0, 0, w - 1);
  c1 = clamp(c1, c0 + 1, w);
  r0 = clamp(r0, 0, h - 1);
  r1 = clamp(r1, r0 + 1, h);

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
  }

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
  return { rows: size, cols: size, elevations_m, min: round1(min), max: round1(max), mean: round1(sum / n) };
}

/* ------------------------------------------------------------------ */
/* GEE fallback: Meta/WRI Global Canopy Height                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the live Meta/WRI Global Canopy Height asset in Google Earth
 * Engine and sample the bbox.
 *
 * The asset ID is periodically renamed/reprocessed, so it is NOT hardcoded.
 * Resolution order at runtime:
 *   1. opts.geeService — an injected EE service handle. When provided and it
 *      exposes `canopyHeight({bbox,size,envAssetId})`, that is used and the
 *      confirmed ID is recorded in `asset`.
 *   2. env GEE_CANOPY_ASSET_ID — a manually confirmed asset ID.
 *
 * Without either, this returns { available:false, error:'gee_not_configured' }
 * with the exact procedure to configure it — the layer degrades gracefully
 * instead of failing the report.
 * @returns {Promise<object>}
 */
async function geeCanopyFallback(bbox, size, opts = {}) {
  const envAsset = process.env.GEE_CANOPY_ASSET_ID;
  const geeService = opts.geeService || null;

  if (!geeService && !envAsset) {
    return {
      available: false,
      error: 'gee_not_configured',
      asset: null,
      asset_confirmed: false,
      resolution_m: 1,
      configure:
        'Set env GEE_CANOPY_ASSET_ID to the current Meta/WRI "Global Canopy Height" ' +
        'asset ID in Google Earth Engine (datasets → search "Global Canopy Height"), ' +
        'or pass opts.geeService with an authenticated EE handle to auto-resolve it.',
    };
  }

  try {
    if (geeService && typeof geeService.canopyHeight === 'function') {
      const res = await geeService.canopyHeight({
        bbox,
        size,
        envAssetId: envAsset || null,
      });
      if (res && res.elevations_m && res.elevations_m.length === size * size) {
        return {
          available: true,
          source: 'Meta/WRI Global Canopy Height (Google Earth Engine)',
          asset: res.assetId || envAsset || 'resolved',
          asset_confirmed: res.assetId ? true : envAsset ? true : false,
          resolution_m: res.resolutionM ?? 1,
          rows: size,
          cols: size,
          elevations_m: res.elevations_m.map((v) => (v == null ? null : round1(v))),
          chm_min_m: minOf(res.elevations_m),
          chm_max_m: maxOf(res.elevations_m),
          chm_mean_m: meanOf(res.elevations_m),
        };
      }
    }
    // envAsset present but no callable service handle — we cannot fetch.
    return {
      available: false,
      error: 'gee_not_configured',
      asset: envAsset || null,
      asset_confirmed: !!envAsset,
      resolution_m: 1,
      configure:
        'GEE_CANOPY_ASSET_ID is set but no geeService handle was provided to ' +
        'fetch the raster. Pass opts.geeService with an authenticated EE handle.',
    };
  } catch (e) {
    return {
      available: false,
      error: 'gee_fetch_failed',
      asset: envAsset || 'resolved',
      asset_confirmed: !!envAsset,
      resolution_m: 1,
      message: e.message,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Tree-instance extraction: threshold → local maxima → watershed     */
/* ------------------------------------------------------------------ */

/**
 * Clip (bbox already bounds the raster), threshold, then local-maxima +
 * watershed segmentation to extract individual trees.
 *
 * The segmentation follows the lidR-style approach (local-maxima filtering +
 * watershed by decreasing height) via an established raster method — it does
 * NOT hand-roll an ad-hoc detector. The watershed grows each local-maximum
 * (peak) basin over the inverted CHM surface; each basin whose peak exceeds
 * the threshold becomes one tree instance, with height from the peak and
 * crown radius from the basin area.
 *
 * @param {object} chm — { rows, cols, elevations_m, ... }
 * @param {object} bbox
 * @param {{ size:number, window:number, ring:number[][], data_source:string,
 *           source_info:object, confidence:string, parcel_area_m2?: number }} ctx
 */
function extractTrees(chm, bbox, ctx) {
  const size = ctx.size;
  const elev = chm.elevations_m;
  const rows = chm.rows || size;
  const cols = chm.cols || size;
  const ring = ctx.ring || null;
  const baseWin = ctx.window;
  // Parcel ground area (m²). Defaults to the bbox ground area when not
  // provided; callers with the parcel ring pass a tighter area so crown
  // radii are normalized to the parcel, not the bbox.
  const parcelAreaM2 = ctx.parcel_area_m2 ?? bboxAreaM2(bbox);

  // Scale-space detection: several detection window sizes + a coarse
  // suppression window. This is the standard lidR-style approach — a single
  // fixed window either over-segments (1 m CHM) or misses isolated trees.
  const baseSup = Math.max(3, Math.ceil(baseWin / 6));
  const wins = uniqueWins(baseWin);

  let best = [];
  for (const win of wins) {
    const winGrid = downsample(elev, rows, cols, win);
    const { cells, m, n } = winGrid;

    const maxH = maxOf(cells) || 1;
    const inv = new Float64Array(m * n);
    for (let i = 0; i < m * n; i++) {
      const h = cells[i] == null ? -1 : cells[i];
      inv[i] = maxH - h + deterministicNoise(i) * 0.01;
    }

    const cellAreaM2 = (cellWidthM(bbox) / n) * (cellHeightM(bbox) / m);
    const trees = watershedToTrees(inv, m, n, maxH, bbox, ring, cellAreaM2, win, ctx.data_source, parcelAreaM2);
    if (trees.length > best.length) best = trees;
  }

  best.sort((a, b) => b.height_m - a.height_m);
  const instances = dedupeTreeInstances(best).slice(0, 400);

  // Canopy cover estimate from the CHM at a coarse window (stable across
  // detection passes — uses the base detection window).
  const coverGrid = downsample(elev, rows, cols, baseWin);
  let coverCells = 0;
  let totalValid = 0;
  for (let i = 0; i < coverGrid.cells.length; i++) {
    const h = coverGrid.cells[i];
    if (h == null) continue;
    totalValid++;
    if (h >= MIN_CHM_M) coverCells++;
  }
  const canopyCoverPct = totalValid ? Math.round((coverCells / totalValid) * 100) : 0;
  const renderZones = classifyCanopyRenderZones(coverGrid, bbox, ctx.dense_cover_threshold);

  return {
    available: true,
    data_source: ctx.data_source,
    confidence: ctx.confidence,
    source_note: canopySourceNote(ctx.data_source),
    source: ctx.source_info?.source || ctx.data_source,
    dataset_url: ctx.source_info?.dataset_url || null,
    collection: ctx.source_info?.collection || null,
    item_id: ctx.source_info?.item_id || null,
    resolution_m: ctx.source_info?.resolution_m ?? chm.resolution_m ?? 1,
    chm: {
      rows: chm.rows,
      cols: chm.cols,
      values_m: chm.elevations_m,
      min_m: chm.chm_min_m,
      max_m: chm.chm_max_m,
      mean_m: chm.chm_mean_m,
      threshold_m: MIN_CHM_M,
    },
    canopy_cover_pct: canopyCoverPct,
    tree_count: instances.length,
    tree_instances: instances,
    render_zones: renderZones,
    extraction: {
      method: 'local-maxima + watershed (lidR-style, scale-space, inverted CHM)',
      window_cells: baseWin,
      windows_tested: wins,
      suppression_cells: baseSup,
      min_height_m: MIN_CHM_M,
      max_instances: 400,
    },
    bbox: { ...bbox },
    _meta: { source_info: ctx.source_info || null },
  };
}

// Default fraction of a window's local neighborhood that must carry canopy
// for that window to be classified "dense" (rendered as textured canopy
// rather than individually instanced trees). Configurable per call.
const DEFAULT_DENSE_COVER_THRESHOLD = 0.55;

/**
 * Classify the coarse canopy-cover grid into "instanced" (sparse — isolated
 * trees, orchard rows, guild plantings; individually instanced so the user
 * can see/select/plan around specific trees) vs. "textured" (dense —
 * natural woodlot/bush; rendered as a textured, height-displaced surface
 * instead of thousands of individual meshes) render zones, per the
 * tree-rendering-fix-and-forest-texture spec. No new data source — reuses
 * the CHM cover grid already computed for the canopy-cover-pct estimate.
 *
 * @param {{cells:(number|null)[], m:number, n:number}} coverGrid windowed
 *   mean-CHM-height grid from `downsample()`, `m`×`n` windows.
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {number} [denseCoverThreshold] fraction (0-1) of a window's 3×3
 *   neighborhood that must itself carry canopy for the window to count as
 *   "dense" rather than "sparse". Defaults to 0.55.
 * @returns {Array<{geometry:object, render_mode:'instanced'|'textured', avg_canopy_height_m:number, canopy_cover_pct:number}>}
 */
function classifyCanopyRenderZones(coverGrid, bbox, denseCoverThreshold) {
  const threshold = denseCoverThreshold ?? DEFAULT_DENSE_COVER_THRESHOLD;
  const { cells, m, n } = coverGrid;
  const hasCanopy = cells.map((h) => h != null && h >= MIN_CHM_M);
  const mode = new Array(m * n).fill(null); // 'textured' | 'instanced' | null (no canopy)
  const coverFracAt = new Array(m * n).fill(0);

  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      if (!hasCanopy[idx]) continue;
      let neighborCanopy = 0;
      let neighborTotal = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= m || cc < 0 || cc >= n) continue;
        neighborTotal++;
        if (hasCanopy[rr * n + cc]) neighborCanopy++;
      }
      const localCoverFrac = neighborTotal ? neighborCanopy / neighborTotal : 0;
      coverFracAt[idx] = localCoverFrac;
      mode[idx] = localCoverFrac >= threshold ? 'textured' : 'instanced';
    }
  }

  // Connected-component merge (4-connectivity, same render_mode) into
  // discrete zones, mirroring the frost-pocket zone-merge approach.
  const winLocal = (r, c) => [
    bbox.west + (c / n) * (bbox.east - bbox.west),
    bbox.north - (r / m) * (bbox.north - bbox.south),
  ];
  const dLng = (bbox.east - bbox.west) / n;
  const dLat = (bbox.north - bbox.south) / m;
  const visited = new Array(m * n).fill(false);
  const zones = [];
  for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) {
    const idx = r * n + c;
    if (!mode[idx] || visited[idx]) continue;
    const renderMode = mode[idx];
    const stack = [idx];
    visited[idx] = true;
    const windows = [];
    while (stack.length) {
      const cur = stack.pop();
      windows.push(cur);
      const cr = Math.floor(cur / n), cc = cur % n;
      for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
        if (nr < 0 || nr >= m || nc < 0 || nc >= n) continue;
        const nIdx = nr * n + nc;
        if (visited[nIdx] || mode[nIdx] !== renderMode) continue;
        visited[nIdx] = true;
        stack.push(nIdx);
      }
    }
    const corners = [];
    let heightSum = 0;
    let coverSum = 0;
    for (const w of windows) {
      const wr = Math.floor(w / n), wc = w % n;
      const [west, north] = winLocal(wr, wc);
      corners.push([west, north], [west + dLng, north], [west + dLng, north - dLat], [west, north - dLat]);
      heightSum += cells[w] ?? 0;
      coverSum += coverFracAt[w];
    }
    const hull = convexHullXY(corners);
    if (hull.length < 3) continue;
    zones.push({
      geometry: { type: 'Polygon', coordinates: [[...hull, hull[0]]] },
      render_mode: renderMode,
      avg_canopy_height_m: round1(heightSum / windows.length),
      canopy_cover_pct: Math.round((coverSum / windows.length) * 100),
      window_count: windows.length,
    });
  }
  return zones;
}

/** Andrew's monotone chain convex hull. Input/output: [[x,y], ...]. */
function convexHullXY(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (seq) => {
    const hull = [];
    for (const p of seq) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower, ...upper];
}

/** Candidate detection window sizes (coarse → fine) for scale-space search. */
function uniqueWins(baseWin) {
  const raw = [
    Math.round(baseWin),
    Math.round(baseWin * 1.6),
    Math.round(baseWin * 0.7),
    Math.round(baseWin * 2.4),
    Math.round(baseWin * 0.5),
  ];
  const seen = new Set();
  const out = [];
  for (const w of raw) {
    const c = Math.min(64, Math.max(8, Math.round(w)));
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out.sort((a, b) => b - a);
}

/**
 * Run watershed crown detection on one (window, suppression) pass and turn
 * the surviving basins into tree instances.
 */
function watershedToTrees(inv, m, n, maxH, bbox, ring, cellAreaM2, win, dataSource, parcelAreaM2) {
  const sup = Math.max(2, Math.ceil(win / 6));
  const basins = watershedBasins(inv, m, n, sup);
  // Noise is added at ~1% of the surface; allow that tolerance so the basin
  // minimum (the seed / peak cell) is the reported peak, not a noise spike.
  const peakTol = Math.max((maxOf(inv) - minOf(inv)) * 0.01, 0.05);
  // A crown should not cover more than a small fraction of the parcel.
  const maxCrownAreaM2 = parcelAreaM2 * 0.05;
  const trees = [];
  for (const b of basins) {
    // Peak CHM height ≈ basin minimum (the seed / local-max cell) plus the
    // noise tolerance to tolerate sub-peak cells absorbed into the basin.
    const peakH = maxH - (b.minInv - peakTol);
    if (peakH < MIN_CHM_M) continue;
    const area = b.area;
    if (area < 1 || area > win * win) continue;
    const crownAreaM2 = area * cellAreaM2;
    if (crownAreaM2 > maxCrownAreaM2) continue;
    const crownRadiusM = Math.sqrt(crownAreaM2 / Math.PI);
    if (crownRadiusM < 0.3) continue;

    const [cx, cy] = b.centroid;
    const lat = bbox.south + ((cy + 0.5) / m) * (bbox.north - bbox.south);
    const lng = bbox.west + ((cx + 0.5) / n) * (bbox.east - bbox.west);
    if (!pointInRing(lat, lng, ring)) continue;

    trees.push({
      x: Math.round(lat * 1e6) / 1e6,
      y: Math.round(lng * 1e6) / 1e6,
      height_m: round1(peakH),
      crown_radius_m: round1(crownRadiusM),
      data_source: dataSource,
    });
  }
  return trees;
}

/** Keep the strongest detection when scale-space passes find the same tree. */
function dedupeTreeInstances(trees) {
  const kept = [];
  for (const tree of trees) {
    const duplicate = kept.some((other) => {
      const distanceM = Math.hypot(
        (tree.x - other.x) * 111320,
        (tree.y - other.y) * 111320 * Math.cos((tree.x * Math.PI) / 180)
      );
      const mergeDistanceM = Math.max(2, Math.min(tree.crown_radius_m, other.crown_radius_m) * 0.5);
      return distanceM <= mergeDistanceM;
    });
    if (!duplicate) kept.push(tree);
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* Raster + geometry helpers                                          */
/* ------------------------------------------------------------------ */

/** Downsample an elevations grid (rows×cols) to a win×win grid. */
function downsample(elev, rows, cols, win) {
  const cells = new Array(win * win);
  const hPer = rows / win;
  const wPer = cols / win;
  for (let r = 0; r < win; r++) {
    for (let c = 0; c < win; c++) {
      let sum = 0;
      let n = 0;
      const r0 = Math.floor(r * hPer);
      const r1 = Math.min(rows, Math.floor((r + 1) * hPer)) || r0 + 1;
      const c0 = Math.floor(c * wPer);
      const c1 = Math.min(cols, Math.floor((c + 1) * wPer)) || c0 + 1;
      for (let rr = r0; rr < r1; rr++) {
        for (let cc = c0; cc < c1; cc++) {
          const v = elev[rr * cols + cc];
          if (v == null || !Number.isFinite(v)) continue;
          sum += v;
          n++;
        }
      }
      cells[r * win + c] = n ? sum / n : null;
    }
  }
  return { cells, m: win, n: win };
}

/**
 * Marker-controlled watershed on the inverted CHM surface. Each strict local
 * minimum of the inverted surface (== local maximum of the CHM) seeds one
 * basin; basins grow over neighbouring cells that are not lower than the
 * current cell (i.e. they climb the crown). This is the standard CHM
 * tree-crown watershed approach used by lidR-style local-maxima filtering.
 */
function watershedBasins(inv, m, n, sup = 1) {
  // Crown height extent cap: a single tree crown should not span more than
  // this fraction of the total surface (inverted) range. Keeps dense-forest
  // basins from flooding across the whole CHM.
  const invRange = maxOf(inv) - minOf(inv);
  const relativeExtent = Math.max(invRange * 0.4, 0.5);
  const seeds = [];
  const R = Math.max(1, Math.floor((sup - 1) / 2));
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (inv[i] <= 0) continue; // ground / null cell
      // Strict local minimum of inv (== local maximum of CHM) over the
      // suppression window: must be ≤ all neighbours in the (2R+1) window.
      let isPeak = true;
      outer: for (let dr = -R; dr <= R; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= m || cc >= n) continue;
          if (inv[i] > inv[rr * n + cc]) {
            isPeak = false;
            break outer;
          }
        }
      }
      if (!isPeak) continue;
      // One seed per plateau: require ≤ west & north neighbours.
      const west = c > 0 ? inv[i - 1] : Infinity;
      const north = r > 0 ? inv[i - n] : Infinity;
      if (inv[i] > west || inv[i] > north) continue;
      seeds.push({ i, h: inv[i] });
    }
  }

  if (!seeds.length) {
    let best = 0;
    let bestV = Infinity;
    for (let i = 0; i < m * n; i++) {
      if (inv[i] > 0 && inv[i] < bestV) {
        bestV = inv[i];
        best = i;
      }
    }
    if (bestV < Infinity) seeds.push({ i: best, h: bestV });
  }

  const assign = new Int32Array(m * n).fill(-1);
  const basinArea = new Array(seeds.length).fill(0);
  const basinSumX = new Array(seeds.length).fill(0);
  const basinSumY = new Array(seeds.length).fill(0);
  const basinMinInv = new Array(seeds.length).fill(Infinity);
  const basinMaxInv = new Array(seeds.length).fill(-Infinity);

  const heap = [];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const rr = 2 * i + 2;
        let s = i;
        if (l < heap.length && heap[l].d < heap[s].d) s = l;
        if (rr < heap.length && heap[rr].d < heap[s].d) s = rr;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };

  seeds.forEach((s, id) => {
    assign[s.i] = id;
    push({ i: s.i, id, d: 0 });
  });

  while (heap.length) {
    const { i, id, d } = pop();
    if (assign[i] !== id) continue;
    const r = Math.floor(i / n);
    const c = i % n;
    basinArea[id]++;
    basinSumX[id] += c;
    basinSumY[id] += r;
    if (inv[i] < basinMinInv[id]) basinMinInv[id] = inv[i];
    if (inv[i] > basinMaxInv[id]) basinMaxInv[id] = inv[i];
    // Cap crown height extent: a single tree crown cannot span the full CHM
    // range. Grow only while the cell stays within RELATIVE_EXTENT of the
    // basin's seed (peak) value.
    const seed = seeds[id].h;
    // Cap by the basin's MAXIMUM (not minimum) so growth is bounded by how
    // tall the crown is, not by how low the ground is. A crown cannot be
    // more than relativeExtent above the peak (40% of the full CHM range).
    if (basinMaxInv[id] - seed > relativeExtent) break;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= m || cc >= n) continue;
      const ni = rr * n + cc;
      if (assign[ni] >= 0) continue;
      if (inv[ni] < inv[i] * 0.9) continue;
      if (inv[ni] - seed > relativeExtent) continue;
      assign[ni] = id;
      push({ i: ni, id, d: d + 1 });
    }
  }

  const basins = [];
  seeds.forEach((_s, id) => {
    if (basinArea[id] < 1) return;
    basins.push({
      area: basinArea[id],
      minInv: basinMinInv[id] === Infinity ? maxOf(inv) : basinMinInv[id],
      maxInvInBasin: basinMaxInv[id] === -Infinity ? inv[0] : basinMaxInv[id],
      centroid: [basinSumX[id] / basinArea[id], basinSumY[id] / basinArea[id]],
    });
  });
  return basins;
}

/** Deterministic per-cell pseudo-noise in [0,1) to break plateaus. */
function deterministicNoise(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Ground width of the bbox in metres (west→east at mid latitude). */
function cellWidthM(bbox) {
  const latMid = (bbox.north + bbox.south) / 2;
  return (bbox.east - bbox.west) * 111320 * Math.cos((latMid * Math.PI) / 180);
}
function cellHeightM(bbox) {
  return (bbox.north - bbox.south) * 111320;
}

/** Approximate ground area of the bbox in m² (shoelace on the 4 corners). */
function bboxAreaM2(bbox) {
  const w = cellWidthM(bbox);
  const h = cellHeightM(bbox);
  return w * h;
}

/**
 * Ground area (m²) of a GeoJSON-style ring [[lng,lat],…] via shoelace, using
 * local metres-per-degree. Returns null when the ring is missing/too small.
 */
function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const latMid =
    (ring.reduce((s, p) => s + p[1], 0) + ring[0][1]) / (ring.length + 1);
  const mPerDegLng = 111320 * Math.cos((latMid * Math.PI) / 180);
  const mPerDegLat = 111320;
  // Project to local metres, then shoelace.
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    const x1 = lng1 * mPerDegLng;
    const y1 = lat1 * mPerDegLat;
    const x2 = lng2 * mPerDegLng;
    const y2 = lat2 * mPerDegLat;
    area2 += x1 * y2 - x2 * y1;
  }
  const area = Math.abs(area2) / 2;
  return Number.isFinite(area) && area > 0 ? area : null;
}

/** Point-in-polygon (ray casting) for the parcel ring. */
function pointInRing(lat, lng, ring) {
  if (!ring || !Array.isArray(ring) || ring.length < 3) return true; // bbox-only
  const x = lng;
  const y = lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function minOf(arr) {
  let m = Infinity;
  for (const v of arr) if (v != null && Number.isFinite(v) && v < m) m = v;
  return Number.isFinite(m) ? m : null;
}
function maxOf(arr) {
  let m = -Infinity;
  for (const v of arr) if (v != null && Number.isFinite(v) && v > m) m = v;
  return Number.isFinite(m) ? m : null;
}
function meanOf(arr) {
  let s = 0;
  let n = 0;
  for (const v of arr) if (v != null && Number.isFinite(v)) {
    s += v;
    n++;
  }
  return n ? s / n : null;
}
function round1(x) {
  return Math.round(x * 10) / 10;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}








