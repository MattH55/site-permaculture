/**
 * Shared framework for the independent location-suitability scoring layers
 * (suitability-pond.js, suitability-solar.js, suitability-wind.js) — see
 * location-suitability-scoring-instructions.md. Deliberately NOT a
 * combined/reconciled score: each layer scores its own criteria and this
 * module only carries the plumbing every layer needs the same way
 * (0-100 normalization, band classification, hard-exclusion geometry
 * tests, top-N candidate-zone extraction, confidence-weakest-source
 * rollup, per-parcel caching), so that plumbing isn't tripled three times.
 */

// --- Bands -----------------------------------------------------------------

export const SUITABILITY_BANDS = [
  { id: 'poor', min: 0 },
  { id: 'fair', min: 40 },
  { id: 'good', min: 65 },
  { id: 'excellent', min: 85 },
];

export function scoreBand(score) {
  if (!Number.isFinite(score)) return null;
  let band = SUITABILITY_BANDS[0].id;
  for (const b of SUITABILITY_BANDS) if (score >= b.min) band = b.id;
  return band;
}

export function bandSummary(scores) {
  const counts = { poor: 0, fair: 0, good: 0, excellent: 0 };
  let n = 0;
  for (const s of scores) {
    if (!Number.isFinite(s)) continue;
    counts[scoreBand(s)]++;
    n++;
  }
  if (!n) return { poor: 0, fair: 0, good: 0, excellent: 0 };
  const out = {};
  for (const k of Object.keys(counts)) out[k] = round1((counts[k] / n) * 100);
  return out;
}

// --- Normalization -----------------------------------------------------------

/** Linear 0-100 normalization, clamped. */
export function normalizeLinear(value, min, max) {
  if (!Number.isFinite(value) || !(max > min)) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/**
 * Log-scale 0-100 normalization for heavily right-skewed values (e.g. flow
 * accumulation, where a handful of cells carry almost all of the parcel's
 * contributing area).
 */
export function normalizeLog(value, maxValue) {
  if (!Number.isFinite(value) || value <= 0 || !(maxValue > 0)) return 0;
  const num = Math.log1p(value);
  const den = Math.log1p(maxValue);
  return den > 0 ? clamp((num / den) * 100, 0, 100) : 0;
}

/**
 * Falls off from 100 (at or below `soft`) to 0 (at or above `hard`), i.e. a
 * threshold-based score that stays high until a soft threshold and then
 * drops sharply to the hard exclusion boundary. Used for "flatter is
 * better, but fine below a threshold" criteria like pond/wind slope.
 */
export function softFalloff(value, soft, hard) {
  if (!Number.isFinite(value)) return 0;
  if (value <= soft) return 100;
  if (value >= hard) return 0;
  return clamp(100 * (1 - (value - soft) / (hard - soft)), 0, 100);
}

// --- Confidence --------------------------------------------------------------

const CONFIDENCE_ORDER = ['insufficient', 'unavailable', 'low', 'moderate_low', 'moderate', 'high'];

/** Same weakest-contributing-source rule used by pond-water-balance.js etc. */
export function weakestConfidence(levels) {
  let weakest = 'high';
  for (const l of levels) {
    if (!l) continue;
    const li = CONFIDENCE_ORDER.indexOf(l);
    const wi = CONFIDENCE_ORDER.indexOf(weakest);
    if (li >= 0 && li < wi) weakest = l;
  }
  return weakest;
}

// --- Geometry / hard exclusions ----------------------------------------------

export function pointInPolygon(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInAnyPolygon(lon, lat, polygons) {
  return (polygons || []).some((p) => {
    const ring = p?.geometry?.coordinates?.[0] || p?.coordinates?.[0];
    return Array.isArray(ring) && pointInPolygon(lon, lat, ring);
  });
}

/** Distance in metres from a point to the nearest vertex of a polygon/line ring. */
export function distanceToRingM(lat, lon, ring) {
  let best = Infinity;
  for (const [x, y] of ring) {
    const d = haversineM(lat, lon, y, x);
    if (d < best) best = d;
  }
  return best;
}

export function distanceToNearestFeatureM(lat, lon, features) {
  let best = Infinity;
  for (const f of features || []) {
    const geom = f?.geometry || f;
    const rings = geom?.type === 'LineString' ? [geom.coordinates] : (geom?.coordinates || []);
    for (const ring of rings) {
      if (!Array.isArray(ring)) continue;
      const d = distanceToRingM(lat, lon, ring);
      if (d < best) best = d;
    }
  }
  return best;
}

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// --- Top-N candidate-zone extraction -----------------------------------------

/**
 * Top-N well-separated candidate points from a scored, indexable cell list —
 * same "don't just slice the sorted list" pattern as
 * pond-hydrology.js#findPondCandidateZones and solar-horizon-shading.js
 * #extractCandidateZones (a plain top-N tends to return a cluster of
 * adjacent cells around the single best point).
 *
 * @param {Array<{r:number,c:number,score:number}>} cells Candidates, already
 *   excluding hard-excluded cells.
 * @param {number} topN
 * @param {number} minSeparationCells
 */
export function topNWellSeparated(cells, topN = 6, minSeparationCells = 3) {
  const sorted = [...cells].sort((a, b) => b.score - a.score);
  const picked = [];
  for (const cand of sorted) {
    if (picked.length >= topN) break;
    const tooClose = picked.some((p) => Math.hypot(p.r - cand.r, p.c - cand.c) < minSeparationCells);
    if (tooClose) continue;
    picked.push(cand);
  }
  return picked;
}

export function cellPolygon(lat, lon, halfLat, halfLon) {
  return {
    type: 'Polygon',
    coordinates: [[
      [lon - halfLon, lat - halfLat],
      [lon + halfLon, lat - halfLat],
      [lon + halfLon, lat + halfLat],
      [lon - halfLon, lat + halfLat],
      [lon - halfLon, lat - halfLat],
    ]],
  };
}

// --- Per-parcel cache (versions of every contributing layer) ----------------

const cache = new Map();
const CACHE_LIMIT = 200; // small in-memory bound; not a persistent store

/**
 * Cache keyed to the parcel plus the version/identity of every contributing
 * layer — same invalidation pattern used throughout (recompute whenever any
 * input actually changed, not on a blanket TTL).
 */
export function cachedSuitability(parcelKey, versionParts, compute) {
  const key = `${parcelKey}::${versionParts.filter((v) => v != null).join('|')}`;
  if (cache.has(key)) return cache.get(key);
  const value = compute();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

export function clearSuitabilityCache() { cache.clear(); }

// --- misc ---------------------------------------------------------------------

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function round0(v) { return Math.round(v); }
export function round1(v) { return Math.round(v * 10) / 10; }
export function round2(v) { return Math.round(v * 100) / 100; }
function deg2rad(d) { return (d * Math.PI) / 180; }
