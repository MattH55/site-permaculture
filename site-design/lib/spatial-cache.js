/**
 * File-based spatial tile cache (PostGIS-free phase 2 index).
 *
 * Stores point samples as JSON tiles on a fixed lat/lng grid so land-value
 * (and future layers) can answer radius queries without a database.
 *
 * Tile size ~0.02° (~1.5–2 km) — enough for neighbourhood samples while
 * keeping files small enough for git-lfs or local-only cache dirs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_ROOT = path.join(__dirname, '..', 'data', 'spatial-cache');

/** Degrees per tile edge */
export const TILE_DEG = 0.02;

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{ tx: number, ty: number, key: string }}
 */
export function tileKey(lat, lng) {
  const ty = Math.floor(lat / TILE_DEG);
  const tx = Math.floor(lng / TILE_DEG);
  return { tx, ty, key: `${tx}_${ty}` };
}

/**
 * All tile keys that intersect a circle (approx via bbox).
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusM
 */
export function tilesForRadius(lat, lng, radiusM) {
  // rough: 1° lat ≈ 111_320 m; lng scales with cos(lat)
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const south = lat - dLat;
  const north = lat + dLat;
  const west = lng - dLng;
  const east = lng + dLng;
  const keys = [];
  const ty0 = Math.floor(south / TILE_DEG);
  const ty1 = Math.floor(north / TILE_DEG);
  const tx0 = Math.floor(west / TILE_DEG);
  const tx1 = Math.floor(east / TILE_DEG);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      keys.push({ tx, ty, key: `${tx}_${ty}` });
    }
  }
  return keys;
}

function layerDir(layer) {
  return path.join(CACHE_ROOT, sanitize(layer));
}

function tilePath(layer, key) {
  return path.join(layerDir(layer), `${key}.json`);
}

function sanitize(s) {
  return String(s).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
}

/**
 * Read one tile. Returns null if missing.
 * @returns {{ meta: object, features: object[] } | null}
 */
export function readTile(layer, key) {
  const p = tilePath(layer, key);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write/replace a tile.
 * @param {string} layer
 * @param {string} key
 * @param {object[]} features — each must have latitude, longitude
 * @param {object} [meta]
 */
export function writeTile(layer, key, features, meta = {}) {
  const dir = layerDir(layer);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    meta: {
      layer,
      key,
      updated_at: new Date().toISOString(),
      feature_count: features.length,
      ...meta,
    },
    features,
  };
  fs.writeFileSync(tilePath(layer, key), JSON.stringify(payload));
  return payload.meta;
}

/**
 * Merge features into a tile (dedupe by id field).
 */
export function upsertTileFeatures(layer, key, features, meta = {}, idField = 'id') {
  const existing = readTile(layer, key);
  const map = new Map();
  for (const f of existing?.features || []) {
    map.set(String(f[idField] ?? `${f.latitude},${f.longitude}`), f);
  }
  for (const f of features) {
    map.set(String(f[idField] ?? `${f.latitude},${f.longitude}`), f);
  }
  return writeTile(layer, key, [...map.values()], {
    ...existing?.meta,
    ...meta,
  });
}

/**
 * Query points within radius from tile cache.
 * @returns {{ features: object[], tiles_hit: number, tiles_missing: number, from_cache: true }}
 */
export function queryRadius(layer, lat, lng, radiusM, opts = {}) {
  const keys = tilesForRadius(lat, lng, radiusM);
  const features = [];
  let tiles_hit = 0;
  let tiles_missing = 0;
  const maxAgeMs = opts.maxAgeMs ?? null;
  const now = Date.now();

  for (const { key } of keys) {
    const tile = readTile(layer, key);
    if (!tile) {
      tiles_missing++;
      continue;
    }
    if (maxAgeMs != null && tile.meta?.updated_at) {
      const age = now - Date.parse(tile.meta.updated_at);
      if (Number.isFinite(age) && age > maxAgeMs) {
        tiles_missing++;
        continue;
      }
    }
    tiles_hit++;
    for (const f of tile.features || []) {
      if (f.latitude == null || f.longitude == null) continue;
      const d = haversineM(lat, lng, f.latitude, f.longitude);
      if (d <= radiusM) {
        features.push({ ...f, distance_m: Math.round(d) });
      }
    }
  }

  features.sort((a, b) => a.distance_m - b.distance_m);
  return {
    features,
    tiles_hit,
    tiles_missing,
    tiles_total: keys.length,
    from_cache: true,
    layer,
    radius_m: radiusM,
  };
}

/**
 * Cache coverage summary for a layer.
 */
export function cacheStats(layer) {
  const dir = layerDir(layer);
  if (!fs.existsSync(dir)) {
    return { layer, tiles: 0, features: 0, path: dir };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let features = 0;
  let oldest = null;
  let newest = null;
  for (const f of files) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      features += t.features?.length || 0;
      const u = t.meta?.updated_at;
      if (u) {
        if (!oldest || u < oldest) oldest = u;
        if (!newest || u > newest) newest = u;
      }
    } catch {
      /* skip */
    }
  }
  return {
    layer,
    tiles: files.length,
    features,
    oldest,
    newest,
    path: dir,
  };
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
