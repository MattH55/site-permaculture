/**
 * Small Water Source Detection Module
 *
 * Multi-source stack (inventory + Sentinel-2 NDWI/MNDWI + Sentinel-1 + optional TWI)
 * to detect small ponds, dugouts, wet depressions, and possible seeps beyond mapped wetlands.
 *
 * Confidence rules:
 *  - AMWI inventory → high (screening only, never regulatory delineation)
 *  - Clean optical water (NDWI/MNDWI) → medium–high
 *  - Marginal optical / TWI co-location → low–medium (site walk recommended)
 *  - Never claim permanent water or Alberta Wetland Policy delineation from pixels alone
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWetlands } from './wetlands.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const DATA = 'https://planetarycomputer.microsoft.com/api/data/v1';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache', 'small-water');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const FETCH_MS = 45_000;

// NDWI McFeeters: (Green-NIR)/(Green+NIR)  — S2 B03, B08
// MNDWI Xu: (Green-SWIR)/(Green+SWIR) — S2 B03, B11
const NDWI_EXPR = '(B03-B08)/(B03+B08)';
const MNDWI_EXPR = '(B03-B11)/(B03+B11)';

/**
 * Detect small water sources for an AOI.
 *
 * @param {object} aoi — GeoJSON Polygon, ring [[lng,lat]], or {west,south,east,north}
 * @param {{
 *   startDate?: string,
 *   endDate?: string,
 *   bufferMeters?: number,
 *   minPixels?: number,
 *   ndwiThreshold?: number,
 *   mndwiThreshold?: number,
 *   includeTWI?: boolean,
 *   elevations?: number[],
 *   elevRows?: number,
 *   elevCols?: number,
 *   elevBbox?: object,
 *   wetlands?: object,
 *   centre?: {latitude:number,longitude:number},
 *   skipCache?: boolean,
 * }} [options]
 */
export async function fetchSmallWater(aoi, options = {}) {
  const bufferM = options.bufferMeters ?? 100;
  const minPixels = options.minPixels ?? 2; // ~200 m² at 10 m
  const ndwiThreshold = options.ndwiThreshold ?? 0.15;
  const mndwiThreshold = options.mndwiThreshold ?? 0.1;
  const includeTWI = options.includeTWI !== false;

  const geometry = normalizeGeometry(aoi, bufferM);
  const coreGeom = normalizeGeometry(aoi, 0);
  if (!geometry) {
    return emptyResult('invalid_aoi', 'Could not parse AOI');
  }

  const bbox = bboxOf(geometry);
  const coreBbox = coreGeom ? bboxOf(coreGeom) : bbox;
  const centre =
    options.centre ||
    (bbox
      ? {
          latitude: (bbox.south + bbox.north) / 2,
          longitude: (bbox.west + bbox.east) / 2,
        }
      : null);

  const endDate = options.endDate || isoDate(new Date());
  const startDate = options.startDate || isoDate(addMonths(new Date(endDate), -6));

  const cacheKey = hashKey({
    bbox,
    startDate,
    endDate,
    ndwiThreshold,
    mndwiThreshold,
    minPixels,
  });
  if (!options.skipCache) {
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, _meta: { ...cached._meta, cache: 'hit' } };
  }

  const fallbacks = [];
  const sources = [];

  // 1) Inventory (reuse pre-fetched wetlands or fetch AMWI)
  let wetlands = options.wetlands || null;
  if (!wetlands) {
    try {
      wetlands = await fetchWetlands(coreBbox || bbox, {
        buffer_m: bufferM,
        centre,
      });
      sources.push('Alberta Merged Wetland Inventory (AMWI)');
    } catch (e) {
      fallbacks.push(`AMWI failed: ${e.message}`);
      wetlands = { available: false, has_wetland_on_site: false, wetland_polygons: { features: [] } };
    }
  } else {
    sources.push(wetlands.source || 'Alberta Wetland Inventory');
  }

  const mapped_wetlands = inventoryToMapped(wetlands, centre);

  // 2) Sentinel-2 optical grid detection
  let optical = null;
  try {
    optical = await detectOpticalWater(geometry, bbox, {
      startDate,
      endDate,
      ndwiThreshold,
      mndwiThreshold,
      minPixels,
      fallbacks,
    });
    if (optical) sources.push('Sentinel-2 NDWI/MNDWI (Planetary Computer)');
  } catch (e) {
    fallbacks.push(`Sentinel-2 water failed: ${e.message}`);
  }

  // 3) Sentinel-1 SAR wetness (optional)
  let s1 = null;
  try {
    s1 = await detectSarWetness(geometry, startDate, endDate, fallbacks);
    if (s1) sources.push('Sentinel-1 RTC (Planetary Computer)');
  } catch (e) {
    fallbacks.push(`Sentinel-1 failed: ${e.message}`);
  }

  // 4) TWI from DEM samples if provided
  let twi = null;
  if (includeTWI && options.elevations?.length) {
    twi = computeTwiCandidates(options.elevations, options.elevRows, options.elevCols, options.elevBbox || coreBbox || bbox);
    if (twi?.cells?.length) sources.push('DEM topographic wetness proxy');
  }

  // 5) Merge & classify
  const open_water_features = [];
  const possible_small_water_or_seeps = [];

  // Mapped inventory → confirmed
  for (const f of mapped_wetlands) {
    open_water_features.push({
      ...f,
      permanent_likely: f.confidence === 'high',
    });
  }

  // Optical cells
  const dateRange =
    optical?.date_range ||
    (optical?.date ? `${optical.date}/${optical.date}` : `${startDate}/${endDate}`);

  if (optical?.cells?.length) {
    for (const cell of optical.cells) {
      const area_m2 = cell.area_m2;
      const minArea = minPixels * 100; // 10 m × 10 m
      if (area_m2 < minArea * 0.5) continue;

      const strong =
        (cell.mndwi != null && cell.mndwi >= mndwiThreshold + 0.1) ||
        (cell.ndwi != null && cell.ndwi >= ndwiThreshold + 0.12);
      const sarBoost = s1?.relative_index != null && s1.relative_index >= 0.55;
      const twiHit =
        twi &&
        cell.lat != null &&
        nearestTwiHigh(twi, cell.lat, cell.lng);

      const feat = {
        id: cell.id,
        type: strong ? 'pond_or_dugout' : 'potential_seep_or_wet_depression',
        geometry: cell.geometry,
        centroid: { lat: cell.lat, lng: cell.lng },
        area_m2: Math.round(area_m2),
        ndwi: cell.ndwi,
        mndwi: cell.mndwi,
        source: [
          'Sentinel-2 NDWI/MNDWI',
          sarBoost ? 'Sentinel-1 wetness' : null,
          twiHit ? 'high TWI' : null,
        ]
          .filter(Boolean)
          .join(' + '),
        confidence: strong && (sarBoost || area_m2 >= 500) ? 'medium-high' : strong ? 'medium' : 'low-medium',
        permanent_likely: strong && area_m2 >= 800,
        date_range: dateRange,
        note:
          strong
            ? 'Optical open-water signature — verify permanence and regulatory status on site walk'
            : 'Possible small water / wet depression — site walk recommended',
      };

      // Avoid double-count if already covered by inventory polygon
      if (featureOverlapsInventory(feat, mapped_wetlands)) {
        // Raise inventory confidence note only
        continue;
      }

      if (feat.confidence === 'medium-high' || (feat.confidence === 'medium' && area_m2 >= 400)) {
        open_water_features.push(feat);
      } else {
        possible_small_water_or_seeps.push(feat);
      }
    }
  }

  // TWI-only candidates not already optical
  if (twi?.cells?.length) {
    for (const c of twi.cells.filter((x) => x.high)) {
      if (possible_small_water_or_seeps.some((p) => distM(p.centroid?.lat, p.centroid?.lng, c.lat, c.lng) < 40)) {
        continue;
      }
      if (open_water_features.some((p) => distM(p.centroid?.lat ?? centre?.latitude, p.centroid?.lng ?? centre?.longitude, c.lat, c.lng) < 40)) {
        continue;
      }
      // Only keep if SAR also wet or optical mean elevated
      const opticalMean = optical?.aoi_mndwi ?? optical?.aoi_ndwi;
      if (s1?.relative_index != null && s1.relative_index < 0.45 && (opticalMean == null || opticalMean < 0.05)) {
        continue;
      }
      possible_small_water_or_seeps.push({
        id: `twi-${c.i}-${c.j}`,
        type: 'potential_seep_or_wet_depression',
        geometry: cellPolygon(c.lat, c.lng, c.dLat || 0.0003, c.dLng || 0.0004),
        centroid: { lat: c.lat, lng: c.lng },
        area_m2: Math.round((c.dLat || 0.0003) * 111320 * (c.dLng || 0.0004) * 111320 * Math.cos((c.lat * Math.PI) / 180)),
        source: 'NDWI/SAR context + high TWI',
        confidence: 'low-medium',
        permanent_likely: false,
        date_range: dateRange,
        note: 'Topographic wetness candidate — verify on site walk; not a wetland delineation',
      });
    }
  }

  // Summary metrics
  const confirmedArea = open_water_features.reduce((s, f) => s + (f.area_m2 || 0), 0);
  const possibleArea = possible_small_water_or_seeps.reduce((s, f) => s + (f.area_m2 || 0), 0);
  const has_any_water =
    open_water_features.length > 0 ||
    possible_small_water_or_seeps.length > 0 ||
    !!wetlands?.has_wetland_on_site;

  let nearest_water_distance_m = wetlands?.nearest_wetland_distance_m ?? null;
  if (centre) {
    for (const f of [...open_water_features, ...possible_small_water_or_seeps]) {
      const lat = f.centroid?.lat;
      const lng = f.centroid?.lng;
      if (lat == null) continue;
      const d = distM(centre.latitude, centre.longitude, lat, lng);
      if (nearest_water_distance_m == null || d < nearest_water_distance_m) {
        nearest_water_distance_m = Math.round(d);
      }
    }
    if (wetlands?.has_wetland_on_site) nearest_water_distance_m = 0;
  }

  const aoiAreaM2 = bboxAreaM2(coreBbox || bbox);
  const water_density_score = clamp01(
    (confirmedArea + possibleArea * 0.35) / Math.max(aoiAreaM2 * 0.05, 50)
  );

  // Map layers
  const map_layers = [];
  if (optical?.item_id) {
    const expr = encodeURIComponent(MNDWI_EXPR);
    map_layers.push({
      id: 'mndwi',
      label: 'MNDWI (Sentinel-2)',
      type: 'tilejson',
      url:
        `${DATA}/item/tilejson.json?collection=sentinel-2-l2a` +
        `&item=${encodeURIComponent(optical.item_id)}` +
        `&assets=B03&assets=B11&expression=${expr}&asset_as_band=true` +
        `&rescale=-0.3,0.5&colormap_name=blues`,
      opacity: 0.55,
      confidence: 'medium',
      resolution_m: 10,
      date: optical.date,
      source: 'Sentinel-2 L2A via Planetary Computer',
      legend_note: 'Blue = higher water index (not a wetland boundary)',
    });
  }

  const result = {
    available: has_any_water || !!optical || !!wetlands?.available,
    mapped_wetlands,
    open_water_features,
    possible_small_water_or_seeps,
    summary: {
      has_any_water,
      has_confirmed_water: open_water_features.length > 0,
      has_possible_small_water: possible_small_water_or_seeps.length > 0,
      nearest_water_distance_m,
      total_confirmed_area_m2: Math.round(confirmedArea),
      total_possible_area_m2: Math.round(possibleArea),
      water_density_score: round2(water_density_score),
      aoi_ndwi: optical?.aoi_ndwi ?? null,
      aoi_mndwi: optical?.aoi_mndwi ?? null,
      s1_wetness_index: s1?.relative_index ?? null,
    },
    map_layers,
    feature_collection: {
      type: 'FeatureCollection',
      features: [
        ...open_water_features.map((f) => toFeature(f, 'confirmed')),
        ...possible_small_water_or_seeps.map((f) => toFeature(f, 'possible')),
      ],
    },
    claims: [
      {
        field: 'small_water_detection',
        value: has_any_water,
        source: sources.join(' + ') || 'none',
        confidence: open_water_features.some((f) => f.confidence === 'high')
          ? 'high'
          : open_water_features.length
            ? 'medium-high'
            : possible_small_water_or_seeps.length
              ? 'low-medium'
              : 'none',
        allowed_claim:
          'Screening only for presence of open water or wet depressions. Not a regulatory wetland delineation, permanent water guarantee, or Water Act determination. Small detections require site walk verification.',
      },
    ],
    disclaimer:
      'Small water detections combine inventory polygons with 10 m satellite indices. Low–medium confidence features may be seasonal pools, seeps, or false positives. Always verify on a site walk before design or regulatory decisions. Never treat pixel detections as Alberta Wetland Policy delineations.',
    metadata: {
      sources,
      processing_date: new Date().toISOString().slice(0, 10),
      aoi_buffer_m: bufferM,
      date_range: { start: startDate, end: endDate },
      ndwi_threshold: ndwiThreshold,
      mndwi_threshold: mndwiThreshold,
      min_pixels: minPixels,
      resolution_m: 10,
      fallbacks,
    },
    _meta: {
      method: 'amwi+s2-ndwi/mndwi+s1+twi-grid',
      cache: 'miss',
      cache_key: cacheKey,
      generated_at: new Date().toISOString(),
      optical,
      s1: s1
        ? {
            relative_index: s1.relative_index,
            date: s1.date,
            source: s1.source,
          }
        : null,
    },
  };

  writeCache(cacheKey, result);
  return result;
}

/**
 * Patch for fecundity rawData + plant moisture context.
 */
export function toFecunditySmallWaterPatch(sw) {
  if (!sw?.available && !sw?.summary?.has_any_water) {
    return {
      smallWater: sw || null,
      hasSmallWaterOrSeep: null,
      smallWaterDensity: null,
      hasPondOrWetlandInventory: undefined,
    };
  }
  const sum = sw.summary || {};
  const confirmed = !!sum.has_confirmed_water || (sw.open_water_features || []).length > 0;
  const possible = !!sum.has_possible_small_water;

  return {
    smallWater: sw,
    hasSmallWaterOrSeep: confirmed || possible,
    hasPondOrDugout: confirmed,
    smallWaterDensity: sum.water_density_score ?? null,
    smallWaterNearestM: sum.nearest_water_distance_m ?? null,
    smallWaterConfirmedAreaM2: sum.total_confirmed_area_m2 ?? null,
    smallWaterPossibleAreaM2: sum.total_possible_area_m2 ?? null,
    // Only inventory is high-confidence for hasPondOrWetlandInventory —
    // leave that to wetlands module; expose soft flags here
    satelliteOpenWater: confirmed,
  };
}

// ── Optical detection ────────────────────────────────────

async function detectOpticalWater(geometry, bbox, opts) {
  const { startDate, endDate, ndwiThreshold, mndwiThreshold, minPixels, fallbacks } = opts;

  let scenes = await searchStac({
    collections: ['sentinel-2-l2a'],
    intersects: geometry,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 40 } },
    limit: 12,
    sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
  });

  if (!scenes.length) {
    fallbacks.push('S2 water: no scenes <40% cloud; retrying <70%');
    scenes = await searchStac({
      collections: ['sentinel-2-l2a'],
      intersects: geometry,
      datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: 70 } },
      limit: 12,
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });
  }

  // High cloud / empty → longer composite window (12 months)
  if (!scenes.length) {
    const widerStart = isoDate(addMonths(new Date(endDate), -12));
    fallbacks.push(`S2 water: expanding window to ${widerStart}–${endDate} (cloud fallback)`);
    scenes = await searchStac({
      collections: ['sentinel-2-l2a'],
      intersects: geometry,
      datetime: `${widerStart}T00:00:00Z/${endDate}T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: 80 } },
      limit: 15,
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });
  }

  // Prefer growing-season scenes (May–Sep) for open water vs snow
  const growing = scenes.filter((f) => {
    const m = Number(String(f.properties?.datetime || '').slice(5, 7));
    return m >= 5 && m <= 9;
  });
  const pool = growing.length ? growing : scenes;
  if (!pool.length) {
    fallbacks.push('S2 water: no usable scenes — relying on inventory + Sentinel-1 if available');
    return null;
  }

  const item = pool[0];
  const itemId = item.id;
  const date = (item.properties?.datetime || '').slice(0, 10);

  // AOI-level stats
  let aoi_ndwi = null;
  let aoi_mndwi = null;
  try {
    const n = await pcItemStatistics(itemId, 'sentinel-2-l2a', geometry, ['B03', 'B08'], NDWI_EXPR);
    if (n?.mean != null) aoi_ndwi = round3(n.mean);
  } catch { /* */ }
  try {
    const m = await pcItemStatistics(itemId, 'sentinel-2-l2a', geometry, ['B03', 'B11'], MNDWI_EXPR);
    if (m?.mean != null) aoi_mndwi = round3(m.mean);
  } catch { /* */ }

  // Grid cells for small-feature detection (3×3 = 9 stats calls — keep latency reasonable)
  const grid = makeGrid(bbox, 3);
  const cells = [];
  // Limit concurrency
  const chunk = 3;
  for (let i = 0; i < grid.length; i += chunk) {
    const batch = grid.slice(i, i + chunk);
    const results = await Promise.all(
      batch.map(async (g) => {
        try {
          const [nd, md] = await Promise.all([
            pcItemStatistics(itemId, 'sentinel-2-l2a', g.geometry, ['B03', 'B08'], NDWI_EXPR).catch(() => null),
            pcItemStatistics(itemId, 'sentinel-2-l2a', g.geometry, ['B03', 'B11'], MNDWI_EXPR).catch(() => null),
          ]);
          const ndwi = nd?.mean != null ? round3(nd.mean) : null;
          const mndwi = md?.mean != null ? round3(md.mean) : null;
          const wet =
            (mndwi != null && mndwi >= mndwiThreshold) ||
            (ndwi != null && ndwi >= ndwiThreshold);
          if (!wet) return null;
          return {
            id: `s2-${g.i}-${g.j}`,
            i: g.i,
            j: g.j,
            lat: g.lat,
            lng: g.lng,
            ndwi,
            mndwi,
            geometry: g.geometry,
            area_m2: g.area_m2,
          };
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r) cells.push(r);
  }

  // Merge adjacent wet cells into clusters (simple 4-connectivity)
  const clusters = clusterCells(cells, minPixels);

  return {
    item_id: itemId,
    date,
    date_range: `${date}/${date}`,
    aoi_ndwi,
    aoi_mndwi,
    cells: clusters.length ? clusters : cells,
    n_wet_cells: cells.length,
    cloud_cover_pct: item.properties?.['eo:cloud_cover'] ?? null,
  };
}

function clusterCells(cells, minPixels) {
  if (!cells.length) return [];
  // Index by i,j
  const key = (c) => `${c.i},${c.j}`;
  const map = new Map(cells.map((c) => [key(c), c]));
  const visited = new Set();
  const out = [];
  let cid = 0;

  for (const c of cells) {
    const k0 = key(c);
    if (visited.has(k0)) continue;
    const stack = [c];
    const group = [];
    visited.add(k0);
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = map.get(`${cur.i + di},${cur.j + dj}`);
        if (n && !visited.has(key(n))) {
          visited.add(key(n));
          stack.push(n);
        }
      }
    }
    // Approximate pixel count: each cell ~ (aoi/grid)^2 / 100 m²
    const area = group.reduce((s, g) => s + g.area_m2, 0);
    const approxPixels = area / 100;
    if (approxPixels < minPixels && group.length === 1 && area < minPixels * 80) {
      // keep single marginal cells as small detections (caller classifies)
    }
    const ndwi = avg(group.map((g) => g.ndwi).filter((v) => v != null));
    const mndwi = avg(group.map((g) => g.mndwi).filter((v) => v != null));
    const lats = group.map((g) => g.lat);
    const lngs = group.map((g) => g.lng);
    const lat = avg(lats);
    const lng = avg(lngs);
    // Bounding polygon of cells
    const west = Math.min(...group.map((g) => g.geometry.coordinates[0][0][0]));
    const south = Math.min(...group.map((g) => g.geometry.coordinates[0][0][1]));
    const east = Math.max(...group.map((g) => g.geometry.coordinates[0][2][0]));
    const north = Math.max(...group.map((g) => g.geometry.coordinates[0][2][1]));

    out.push({
      id: `cluster-${cid++}`,
      i: group[0].i,
      j: group[0].j,
      lat,
      lng,
      ndwi: ndwi != null ? round3(ndwi) : null,
      mndwi: mndwi != null ? round3(mndwi) : null,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
      area_m2: Math.round(area),
      n_cells: group.length,
    });
  }
  return out;
}

// ── SAR ──────────────────────────────────────────────────

async function detectSarWetness(geometry, startDate, endDate, fallbacks) {
  const scenes = await searchStac({
    collections: ['sentinel-1-rtc'],
    intersects: geometry,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    limit: 6,
    sortby: [{ field: 'datetime', direction: 'desc' }],
  });
  if (!scenes.length) {
    fallbacks.push('S1: no RTC scenes');
    return null;
  }
  const item = scenes[0];
  let st = null;
  try {
    st = await pcItemStatistics(item.id, 'sentinel-1-rtc', geometry, ['vv'], null);
  } catch {
    try {
      st = await pcItemStatistics(item.id, 'sentinel-1-rtc', geometry, ['VV'], null);
    } catch {
      fallbacks.push('S1: statistics failed');
      return null;
    }
  }
  if (st?.mean == null) return null;
  const mean = st.mean;
  // Lower backscatter often wetter (heuristic relative index)
  const relative = clamp01(1 - (Math.log10(Math.max(mean, 1e-4)) + 2) / 3);
  return {
    relative_index: round3(relative),
    backscatter_mean: round4(mean),
    date: (item.properties?.datetime || '').slice(0, 10),
    source: 'Sentinel-1 RTC',
  };
}

// ── TWI proxy from elevation grid ────────────────────────

/**
 * Simple topographic wetness proxy from DEM samples.
 * High values where elevation is low relative to neighbours and slope is gentle.
 */
export function computeTwiCandidates(elevations, rows, cols, bbox) {
  if (!elevations?.length || !rows || !cols || !bbox) return null;
  if (elevations.length < rows * cols) return null;

  const cells = [];
  const dLat = (bbox.north - bbox.south) / Math.max(rows - 1, 1);
  const dLng = (bbox.east - bbox.west) / Math.max(cols - 1, 1);

  // Compute local relief rank
  const vals = elevations.map((z) => (z == null ? null : Number(z)));
  const valid = vals.filter((v) => v != null);
  if (valid.length < 4) return null;
  const meanZ = avg(valid);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const z = vals[i * cols + j];
      if (z == null) continue;
      // Neighbour slope
      let maxDiff = 0;
      let nLow = 0;
      for (const [di, dj] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= rows || nj >= cols) continue;
        const nz = vals[ni * cols + nj];
        if (nz == null) continue;
        maxDiff = Math.max(maxDiff, Math.abs(z - nz));
        if (z < nz) nLow += 1;
      }
      const depression = nLow >= 3;
      const belowMean = z < meanZ - 0.5;
      const flat = maxDiff < 1.5;
      const high = (depression && flat) || (belowMean && flat && depression);
      if (!high && !belowMean) continue;
      const lat = bbox.north - i * dLat;
      const lng = bbox.west + j * dLng;
      cells.push({
        i,
        j,
        lat,
        lng,
        z,
        high: !!high,
        dLat: dLat * 0.5,
        dLng: dLng * 0.5,
      });
    }
  }

  return {
    cells: cells.filter((c) => c.high).slice(0, 20),
    method: 'local-depression + flat slope proxy (not full TWI)',
  };
}

// ── Inventory helpers ────────────────────────────────────

function inventoryToMapped(wetlands, centre) {
  const feats = wetlands?.wetland_polygons?.features || [];
  return feats.slice(0, 40).map((f, idx) => {
    const p = f.properties || {};
    const area_ha = p.area_ha;
    const area_m2 = area_ha != null ? Math.round(area_ha * 10_000) : null;
    let lat = null;
    let lng = null;
    const ring = f.geometry?.coordinates?.[0];
    if (ring?.length) {
      lng = avg(ring.map((c) => c[0]));
      lat = avg(ring.map((c) => c[1]));
    }
    return {
      id: `amwi-${idx}`,
      type: p.on_parcel ? 'mapped_wetland' : 'mapped_wetland_nearby',
      geometry: f.geometry,
      centroid: lat != null ? { lat, lng } : centre,
      area_m2,
      area_ha,
      source: wetlands.source || 'Alberta Wetland Inventory',
      confidence: 'high',
      permanent_likely: true,
      cwcs_class: p.cwcs_class || p.type,
      on_parcel: !!p.on_parcel,
      note: 'Inventory polygon — screening only, not regulatory delineation',
    };
  });
}

function featureOverlapsInventory(feat, mapped) {
  if (!feat.centroid || !mapped?.length) return false;
  for (const m of mapped) {
    if (m.centroid && distM(feat.centroid.lat, feat.centroid.lng, m.centroid.lat, m.centroid.lng) < 80) {
      return true;
    }
  }
  return false;
}

function nearestTwiHigh(twi, lat, lng) {
  return (twi.cells || []).some((c) => c.high && distM(lat, lng, c.lat, c.lng) < 60);
}

function toFeature(f, className) {
  return {
    type: 'Feature',
    properties: {
      id: f.id,
      class: className,
      type: f.type,
      area_m2: f.area_m2,
      confidence: f.confidence,
      source: f.source,
      note: f.note,
      permanent_likely: f.permanent_likely,
    },
    geometry: f.geometry || null,
  };
}

// ── Planetary Computer ───────────────────────────────────

async function searchStac(body) {
  const res = await fetchJson(`${STAC}/search`, FETCH_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res?.features || [];
}

async function pcItemStatistics(itemId, collection, geometry, assets, expression) {
  const q = new URLSearchParams({ collection, item: itemId, asset_as_band: 'true' });
  for (const a of assets) q.append('assets', a);
  if (expression) q.set('expression', expression);

  const geom = geometry.type === 'Feature' ? geometry.geometry : geometry;
  const fc = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: geom, properties: {} }],
  };

  const res = await fetchJson(`${DATA}/item/statistics?${q.toString()}`, FETCH_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fc),
  });

  const stats = res?.features?.[0]?.properties?.statistics;
  if (!stats) return null;
  const key = expression
    ? Object.keys(stats).find((k) => k.includes('B03') || k.includes('B08') || k.includes('B11')) ||
      Object.keys(stats)[0]
    : Object.keys(stats)[0];
  const s = stats[key] || Object.values(stats)[0];
  if (!s || s.mean == null) return null;
  return { mean: s.mean, min: s.min, max: s.max, std: s.std, count: s.count };
}

// ── Geometry ─────────────────────────────────────────────

function normalizeGeometry(aoi, bufferM = 0) {
  if (!aoi) return null;
  let geom = null;
  if (aoi.type === 'Polygon' || aoi.type === 'MultiPolygon') geom = aoi;
  else if (aoi.type === 'Feature' && aoi.geometry) geom = aoi.geometry;
  else if (Array.isArray(aoi) && Array.isArray(aoi[0])) {
    geom = { type: 'Polygon', coordinates: [closeRing(aoi)] };
  } else if (aoi.west != null) {
    geom = {
      type: 'Polygon',
      coordinates: [
        closeRing([
          [aoi.west, aoi.south],
          [aoi.east, aoi.south],
          [aoi.east, aoi.north],
          [aoi.west, aoi.north],
        ]),
      ],
    };
  } else if (aoi.latitude != null && aoi.longitude != null) {
    const d = 0.002;
    geom = {
      type: 'Polygon',
      coordinates: [
        closeRing([
          [aoi.longitude - d, aoi.latitude - d],
          [aoi.longitude + d, aoi.latitude - d],
          [aoi.longitude + d, aoi.latitude + d],
          [aoi.longitude - d, aoi.latitude + d],
        ]),
      ],
    };
  }
  if (!geom) return null;
  if (!bufferM) return geom;
  const b = bboxOf(geom);
  if (!b) return geom;
  const midLat = (b.south + b.north) / 2;
  const dLat = bufferM / 111_320;
  const dLng = bufferM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [
      closeRing([
        [b.west - dLng, b.south - dLat],
        [b.east + dLng, b.south - dLat],
        [b.east + dLng, b.north + dLat],
        [b.west - dLng, b.north + dLat],
      ]),
    ],
  };
}

function makeGrid(bbox, n = 4) {
  if (!bbox) return [];
  const cells = [];
  const dLat = (bbox.north - bbox.south) / n;
  const dLng = (bbox.east - bbox.west) / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const south = bbox.south + i * dLat;
      const north = south + dLat;
      const west = bbox.west + j * dLng;
      const east = west + dLng;
      const lat = (south + north) / 2;
      const lng = (west + east) / 2;
      const area_m2 = dLat * 111320 * dLng * 111320 * Math.cos((lat * Math.PI) / 180);
      cells.push({
        i,
        j,
        lat,
        lng,
        area_m2,
        geometry: {
          type: 'Polygon',
          coordinates: [
            closeRing([
              [west, south],
              [east, south],
              [east, north],
              [west, north],
            ]),
          ],
        },
      });
    }
  }
  return cells;
}

function cellPolygon(lat, lng, dLat, dLng) {
  return {
    type: 'Polygon',
    coordinates: [
      closeRing([
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
      ]),
    ],
  };
}

function bboxOf(geom) {
  const coords = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') coords.push(c);
    else c.forEach(walk);
  };
  if (geom?.coordinates) walk(geom.coordinates);
  if (!coords.length) return null;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function bboxAreaM2(bbox) {
  if (!bbox) return 1;
  const midLat = ((bbox.south + bbox.north) / 2) * (Math.PI / 180);
  const h = (bbox.north - bbox.south) * 111320;
  const w = (bbox.east - bbox.west) * 111320 * Math.cos(midLat);
  return Math.max(h * w, 1);
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, a];
}

function distM(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lat2 == null) return Infinity;
  const mid = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lng2 - lng1) * 111320 * Math.cos(mid);
  const dy = (lat2 - lat1) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}

function emptyResult(code, message) {
  return {
    available: false,
    mapped_wetlands: [],
    open_water_features: [],
    possible_small_water_or_seeps: [],
    summary: {
      has_any_water: false,
      has_confirmed_water: false,
      has_possible_small_water: false,
      nearest_water_distance_m: null,
      total_confirmed_area_m2: 0,
      total_possible_area_m2: 0,
      water_density_score: 0,
    },
    map_layers: [],
    feature_collection: { type: 'FeatureCollection', features: [] },
    claims: [
      {
        field: 'small_water_detection',
        value: null,
        source: 'none',
        confidence: 'none',
        allowed_claim: 'No small-water claim without inventory or satellite screening.',
      },
    ],
    disclaimer: 'Small water detection unavailable for this AOI.',
    metadata: { sources: [], fallbacks: [`${code}: ${message}`] },
    _meta: { method: 'none', generated_at: new Date().toISOString() },
  };
}

// ── Utils ────────────────────────────────────────────────

async function fetchJson(url, timeoutMs, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function readCache(key) {
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - (j._cached_at || 0) > CACHE_TTL_MS) return null;
    return j.payload;
  } catch {
    return null;
  }
}

function writeCache(key, payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify({ _cached_at: Date.now(), payload }),
      'utf8'
    );
  } catch {
    /* best effort */
  }
}

function hashKey(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 24);
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function avg(a) {
  if (!a?.length) return null;
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}
