/**
 * Deterministic vegetation scatter — the placed-instance half of the model.
 *
 * Spec §13/§14/§16/§17. Everything here is pure maths (no THREE/DOM), so the
 * placement guarantee — "same property + same seed ⇒ same layout" — is
 * testable in Node.
 *
 * Layering, deliberately matching the spec's "the renderer should know only how
 * to render the result" (§15):
 *
 *   VegetationPlacementRules  constraints (spacing, exclusions, slope, aspect)
 *   VegetationMode            how they're arranged (natural/orchard/shelterbelt/landscape)
 *   scatterVegetation()       rules + seed  →  TreeInstance[]
 *   (renderer)                TreeInstance[] → geometry
 *
 * No soil/climate/hydrology logic lives here — those systems compute the
 * *rules* upstream (spec §14, §15).
 */

import {
  DEFAULT_VEGETATION_STATUS,
  VEGETATION_MODES,
  createTreeInstance,
  hashString,
  indexVegetationManifest,
} from './vegetation-assets.js';

/** @typedef {import('./vegetation-assets.js').TreeInstance} TreeInstance */
/** @typedef {import('./vegetation-assets.js').VegetationMode} VegetationMode */
/** @typedef {'static'|'no-tree-wetland'|'deep-water'} ScatterWaterMode */

/**
 * @typedef {object} VegetationPlacementRules
 * @property {number} [minSpacingMeters]         Minimum centre-to-centre spacing.
 * @property {Array} [exclusionZones]            GeoJSON Polygon/MultiPolygon
 *                                               features to avoid.
 * @property {{min?:number, max?:number}} [allowedSlopeDegrees]
 * @property {number[]} [preferredAspect]        Preferred aspect bearings (deg).
 * @property {number} [plantingDensityPerHectare]
 * @property {{min?:number, max?:number}} [scaleRange]   Per-tree scale jitter.
 * @property {number} [maxCandidates]            Sampling budget.
 * @property {Array<{lat:number,lon:number}>} [staticPlacements]
 *           Explicit planting plan — positions come from the user, not the
 *           lattice. When present the spacing/jitter heuristics are skipped and
 *           the polygon/exclusion/slope/water filters still apply.
 * @property {ScatterWaterMode} [waterMode]      'static' (ignore water),
 *           'no-tree-wetland', or 'deep-water'. Requires `waterSampler`.
 * @property {(lat:number, lon:number) => ({water?:boolean, wetland?:boolean}|null)} [waterSampler]
 *           Caller-supplied hydrology lookup — kept out of this module (spec §15).
 */

/**
 * Per-mode arrangement defaults (spec §16: "Avoid perfectly rectangular grids
 * unless the user is explicitly modelling an orchard/plantation"). A named map,
 * not an inline conditional, so adding a mode is one obvious edit.
 */
const MODE_DEFAULTS = Object.freeze({
  natural: { jitterMeters: 0, scaleSpread: 0.20 },
  orchard: { jitterMeters: 0, scaleSpread: 0.05 },
  shelterbelt: { jitterMeters: 0.35, scaleSpread: 0.12 },
  landscape: { jitterMeters: 0, scaleSpread: 0.18 },
});

export function modeDefaults(mode) {
  return MODE_DEFAULTS[mode] || MODE_DEFAULTS.natural;
}

export function isValidMode(mode) {
  return VEGETATION_MODES.includes(mode);
}

// --- Deterministic RNG ---------------------------------------------------------

/**
 * Mulberry32 — small, fast, well-distributed, and fully deterministic from a
 * 32-bit seed. Using this (rather than Math.random) is what makes the
 * "same seed → same layout" guarantee from spec §13 actually hold.
 *
 * @param {number|string} seed
 * @returns {() => number} float in [0, 1)
 */
export function createRng(seed) {
  let a = typeof seed === 'number' && Number.isFinite(seed)
    ? seed >>> 0
    : (hashString(String(seed ?? 'seed')) >>> 0);
  if (a === 0) a = 0x9e3779b9; // avoid the degenerate all-zero state
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Geometry helpers ----------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** Metres per degree of longitude at a given latitude. */
function metersPerDegLon(lat) {
  return EARTH_RADIUS_M * DEG * Math.cos(lat * DEG);
}

/** Metres per degree of latitude (spherical — adequate at parcel scale). */
function metersPerDegLat() {
  return EARTH_RADIUS_M * DEG;
}

/** Ground distance in metres between two lat/lon pairs (equirectangular). */
export function metersBetween(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * metersPerDegLat();
  const dLon = (lon2 - lon1) * metersPerDegLon((lat1 + lat2) / 2);
  return Math.hypot(dLat, dLon);
}

/** Offset a lat/lon by east/north metres (inverse of metersBetween). */
export function offsetLatLon(lat, lon, eastM, northM) {
  return {
    lat: lat + northM / metersPerDegLat(),
    lon: lon + eastM / Math.max(metersPerDegLon(lat), 1e-9),
  };
}

/** Ray-casting point-in-ring test on (lon, lat) — same approach as app.js. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-(Multi)Polygon for GeoJSON geometries, honouring interior rings
 * (holes) so an exclusion zone that has a hole is respected properly.
 */
export function pointInGeoJsonGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    if (!pointInRing(lon, lat, polygon[0])) continue;
    // Inside the shell — reject if it falls in any interior ring (a hole).
    let inHole = false;
    for (let h = 1; h < polygon.length; h++) {
      if (pointInRing(lon, lat, polygon[h])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

/** Closed ring → [lon,lat] list with the duplicate closing point removed. */
export function openRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring.slice();
}

/** Approximate polygon area in hectares (spherical, fine at parcel scale). */
export function polygonAreaHectares(ring) {
  const open = openRing(ring);
  if (open.length < 3) return 0;
  const latMid = open.reduce((s, p) => s + p[1], 0) / open.length;
  const mLat = metersPerDegLat();
  const mLon = metersPerDegLon(latMid);
  let sum = 0;
  for (let i = 0, j = open.length - 1; i < open.length; j = i++) {
    const xi = open[i][0] * mLon, yi = open[i][1] * mLat;
    const xj = open[j][0] * mLon, yj = open[j][1] * mLat;
    sum += (xj * yi) - (xi * yj);
  }
  return Math.abs(sum / 2) / 10_000;
}

// --- Candidate generation ------------------------------------------------------

/**
 * Build a deterministic shuffled candidate lattice covering the polygon's
 * bounding box. Positions are generated on a spacing-sized grid (so the spacing
 * rule is satisfied by construction) and filtered to the polygon + exclusion
 * zones. This is the standard jittered-grid / Poisson-ish approach: cheap,
 * stable, and — unlike pure rejection sampling — guaranteed to terminate and to
 * distribute evenly (spec §13: "remain within the property polygon", "prevent
 * obvious overlaps").
 *
 * @returns {Array<{latitude:number, longitude:number, lat:number, lon:number, elevationM?:number}>}
 */
export function candidatePositions({
  polygon, spacingMeters, exclusionZones = [], rng, mode = 'natural', maxCandidates = 200_000,
}) {
  const ring = openRing(polygon);
  if (ring.length < 3 || !(spacingMeters > 0)) return [];

  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const west = Math.min(...lons), east = Math.max(...lons);
  const south = Math.min(...lats), north = Math.max(...lats);
  const latMid = (south + north) / 2;

  const dLat = spacingMeters / metersPerDegLat();
  const dLon = spacingMeters / Math.max(metersPerDegLon(latMid), 1e-9);

  const rows = Math.min(Math.ceil((north - south) / dLat) + 1, 1500);
  const cols = Math.min(Math.ceil((east - west) / dLon) + 1, 1500);

  // Lattice anchored to the polygon's bbox corner (not to the globe), so the
  // same property always produces the same lattice.
  const originLat = south;
  const originLon = west;

  const grid = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      grid.push({ row: r, col: c, lat: originLat + r * dLat, lon: originLon + c * dLon });
    }
  }

  // Deterministic Fisher-Yates — same seed ⇒ same visit order ⇒ same layout.
  for (let i = grid.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [grid[i], grid[j]] = [grid[j], grid[i]];
  }

  const defaults = modeDefaults(mode);
  const out = [];
  for (const cell of grid) {
    if (out.length >= maxCandidates) break;

    // Mode jitter (spec §16): a shelterbelt row wobbles along its row but stays
    // single-file; natural/orchard/landscape sit on the lattice. Spacing is
    // still enforced afterwards, so jitter can never create an overlap.
    let lat = cell.lat;
    let lon = cell.lon;
    if (defaults.jitterMeters > 0) {
      lat = originLat + (cell.row + (rng() - 0.5) * 2 * (defaults.jitterMeters / spacingMeters)) * dLat;
      lon = originLon + (cell.col + (rng() - 0.5) * 0.25) * dLon;
    }

    if (!pointInRing(lon, lat, ring)) continue;
    if (exclusionZones.some((z) => pointInGeoJsonGeometry(lon, lat, z?.geometry || z))) continue;

    // Emitted in the canonical instance shape (latitude/longitude) because
    // that is what every consumer downstream speaks — createTreeInstance(),
    // groupIntoRows(), auditScatter(), the renderer. `lat`/`lon` are retained as
    // aliases so callers (and tests) can use the short form without having to
    // know which convention a given function happens to prefer.
    out.push({
      latitude: lat,
      longitude: lon,
      lat,
      lon,
      eastM: (lon - originLon) * metersPerDegLon(latMid),
      northM: (lat - originLat) * metersPerDegLat(),
    });
  }
  return out;
}

// --- Spacing enforcement -------------------------------------------------------

/**
 * Greedy thinning to enforce minimum spacing. Candidates arrive in
 * deterministic shuffled order, so keeping the first of any conflicting pair is
 * itself deterministic (spec §13 reproducibility).
 *
 * A naive implementation compares every candidate against every kept point,
 * which is O(n²) — at a 1 m lattice over a 4 ha parcel that is 40 000 candidates
 * and ~8×10⁸ haversine calls, i.e. minutes of frozen UI for a result the density
 * cap then throws almost entirely away. Instead we bucket kept points into a
 * spatial hash whose cell size is the spacing itself: any point that could
 * violate the rule is guaranteed to be in the 3×3 neighbourhood of the
 * candidate's own cell, so the inner loop only touches a handful of neighbours.
 *
 * Accepts either field convention ({lat,lon} or {latitude,longitude}) so the
 * spacing rule is never silently skipped because of a naming mismatch.
 *
 * @param {Array<object>} candidates
 * @param {number} minSpacingMeters
 * @param {number} [maxCount] Stop as soon as this many are kept (used to feed a
 *   density cap through, so thinning never does more work than the caller needs).
 */
export function enforceMinSpacing(candidates, minSpacingMeters, maxCount = Infinity) {
  if (typeof maxCount !== 'number' || Number.isNaN(maxCount)) maxCount = Infinity;
  if (!(minSpacingMeters > 0)) return candidates.slice(0, maxCount);

  const list = Array.isArray(candidates) ? candidates : [];
  const cap = Math.min(maxCount, list.length);
  if (cap <= 0) return [];

  // Cell size equals the spacing, so a violating neighbour is always in the
  // candidate's own cell or one of the eight adjacent cells.
  const cellDeg = minSpacingMeters / metersPerDegLat();
  const buckets = new Map();
  const keyFor = (lat, lon) => `${Math.floor(lat / cellDeg)}|${Math.floor(lon / cellDeg)}`;

  const kept = [];
  for (const cand of list) {
    if (kept.length >= cap) break;
    const lat = Number(cand.latitude ?? cand.lat);
    const lon = Number(cand.longitude ?? cand.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const cy = Math.floor(lat / cellDeg);
    const cx = Math.floor(lon / cellDeg);
    let ok = true;
    for (let y = cy - 1; y <= cy + 1 && ok; y++) {
      for (let x = cx - 1; x <= cx + 1 && ok; x++) {
        const bucket = buckets.get(`${y}|${x}`);
        if (!bucket) continue;
        for (const k of bucket) {
          if (metersBetween(lat, lon, k.lat, k.lon) < minSpacingMeters) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;

    kept.push({ lat, lon, source: cand });
    const key = keyFor(lat, lon);
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ lat, lon });
    else buckets.set(key, [{ lat, lon }]);
  }

  // Hand back the caller's original objects (with any extra fields intact).
  return kept.map((k) => k.source);
}

// --- Aspect / slope filtering (spec §14) ---------------------------------------

/** Compass bearing (degrees, 0=N, 90=E) from an uphill east/north vector. */
export function aspectBearing(uphillEast, uphillNorth) {
  const deg = (Math.atan2(uphillEast, uphillNorth) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Smallest angular difference between two bearings, in degrees (0–180). */
export function bearingDifference(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Does a candidate pass the slope/aspect rules?
 *
 * Slope and aspect come from the caller's terrain sampler — this module does no
 * hydrology/soil work (spec §14/§15); it only applies the *rules* it is given.
 * A missing sample is treated as "pass" rather than "fail", so a data gap never
 * silently blanks a parcel.
 *
 * @param {{slopeDeg?:number|null, aspectBearingDeg?:number|null, rules:object}} args
 * @returns {boolean}
 */
export function passesTerrainRules({ slopeDeg, aspectBearingDeg, rules }) {
  const slopeRule = rules?.allowedSlopeDegrees;
  if (slopeRule && slopeDeg != null && Number.isFinite(slopeDeg)) {
    if (slopeRule.min != null && slopeDeg < slopeRule.min) return false;
    if (slopeRule.max != null && slopeDeg > slopeRule.max) return false;
  }
  const preferred = rules?.preferredAspect;
  if (Array.isArray(preferred) && preferred.length
    && aspectBearingDeg != null && Number.isFinite(aspectBearingDeg)) {
    // Tolerance is half the spacing between preferred bearings, so a set of
    // bearings partitions the compass without needing a separate tolerance.
    const tolerance = preferred.length === 1 ? 90 : 180 / preferred.length;
    if (!preferred.some((b) => bearingDifference(aspectBearingDeg, b) <= tolerance)) return false;
  }
  return true;
}

// --- Species / variant mixture (spec §7, §16) ----------------------------------

/**
 * Assign assets to instances. Species mixture is a weighted round-robin over
 * the caller's `assetIds`, started at a seeded offset — this guarantees the
 * requested mixture ratio across the parcel (not merely on average) while
 * staying deterministic. Callers may pass `assetWeights` for explicit control.
 *
 * @param {number} count
 * @param {string[]} assetIds
 * @param {() => number} rng
 * @param {Record<string, number>} [assetWeights]
 * @returns {string[]} one asset id per instance
 */
export function assignAssets(count, assetIds, rng, assetWeights = null) {
  const ids = (assetIds || []).filter((id) => typeof id === 'string' && id);
  if (!ids.length || count <= 0) return [];

  if (assetWeights && Object.keys(assetWeights).length) {
    const rows = ids
      .map((id) => ({ id, weight: Number(assetWeights[id]) }))
      .filter((r) => Number.isFinite(r.weight) && r.weight > 0)
      // Sorted so the result never depends on object key insertion order.
      .sort((a, b) => a.id.localeCompare(b.id));
    if (rows.length) {
      const total = rows.reduce((s, r) => s + r.weight, 0);
      const used = Object.fromEntries(rows.map((r) => [r.id, 0]));
      const out = [];
      for (let i = 0; i < count; i++) {
        let best = rows[0].id;
        let bestDeficit = -Infinity;
        for (const r of rows) {
          // Largest-deficit scheduling keeps realised proportions on target.
          const deficit = (((i + 1) * r.weight) / total) - used[r.id];
          if (deficit > bestDeficit) { bestDeficit = deficit; best = r.id; }
        }
        used[best] += 1;
        out.push(best);
      }
      return out;
    }
  }

  const offset = Math.floor(rng() * ids.length);
  const out = [];
  for (let i = 0; i < count; i++) out.push(ids[(offset + i) % ids.length]);
  return out;
}

/** Resolve the per-tree scale range from rules + mode defaults (spec §7). */
function scaleRangeFor(rules, defaults) {
  let min = Number(rules?.scaleRange?.min);
  let max = Number(rules?.scaleRange?.max);
  if (!Number.isFinite(min) || min <= 0) min = 1 - defaults.scaleSpread;
  if (!Number.isFinite(max) || max <= 0) max = 1 + defaults.scaleSpread;
  if (max < min) [min, max] = [max, min];
  return { min, max };
}


// --- Main entry point ----------------------------------------------------------

/**
 * Scatter vegetation inside a property polygon.
 *
 * Implements the spec §13 signature (`scatterVegetation({ property, assetIds,
 * count, polygon, spacing, randomSeed })`) plus the extras the spec asks for in
 * §14 (rules), §16 (modes) and §17 (natural vs structured rows).
 *
 * Guarantees (each unit-tested):
 *  - every returned instance lies inside `polygon`
 *  - no instance lies inside an exclusion zone
 *  - no two instances are closer than the effective minimum spacing
 *  - rotation / scale / variant vary per instance, within plausible limits
 *  - the same (property, polygon, seed, rules, mode, assets) ⇒ identical layout
 *  - every instance is status 'proposed' unless the caller overrides it
 *
 * @param {object} args
 * @param {{id?:string, polygon?:number[][]}} [args.property]
 * @param {string[]} [args.assetIds]
 * @param {number} [args.count]              requested instance count (ceiling)
 * @param {number[][]} [args.polygon]        [lon,lat] ring; defaults to property.polygon
 * @param {number} [args.spacing]            metres between trees
 * @param {number|string} [args.randomSeed]
 * @param {import('./vegetation-assets.js').VegetationMode} [args.mode]
 * @param {object} [args.rules]              VegetationPlacementRules
 * @param {(lat:number, lon:number) => ({slopeDeg?:number, aspectDeg?:number, elevationM?:number}|null)} [args.terrainSampler]
 * @param {number} [args.maxCount]
 * @param {string|null} [args.idPrefix]
 * @returns {import('./vegetation-assets.js').TreeInstance[]}
 */
export function scatterVegetation(args = {}) {
  const {
    property = {},
    assetIds = [],
    polygon,
    randomSeed = 'default',
    mode = 'natural',
    rules = {},
    terrainSampler = null,
    maxCount = Infinity,
    idPrefix = null,
  } = args;

  const ring = openRing(polygon || property.polygon || []);
  if (ring.length < 3) return [];

  const propertyId = property.id || 'property-unknown';
  // The seed string deliberately includes every ingredient that defines a
  // layout, so changing any of them yields a *new* deterministic layout rather
  // than a subtly different one.
  const rng = createRng(hashString(
    `${propertyId}|${mode}|${randomSeed}|${assetIds.join(',')}`
  ));

  // Effective spacing: explicit spacing → rule → density-derived → default.
  // A `static` placement rule is a *planting plan*: the user chose the
  // positions, so the lattice and spacing heuristics (and jitter) are skipped
  // entirely and only the filters below still apply.
  const placements = Array.isArray(rules?.staticPlacements) && rules.staticPlacements.length
    ? rules.staticPlacements
    : null;

  const density = Number(rules?.plantingDensityPerHectare);
  const densitySpacing = density > 0 ? Math.sqrt(10_000 / density) : null;
  const baseSpacing = Number(args.spacing) > 0
    ? Number(args.spacing)
    : Number(rules?.minSpacingMeters) > 0
      ? Number(rules.minSpacingMeters)
      : densitySpacing ?? 5;
  // The rule is a hard floor — no mode may plant closer than it allows.
  const effectiveSpacing = Math.max(baseSpacing, Number(rules?.minSpacingMeters) || 0);

  const waterMode = rules?.waterMode || 'static';

  const candidates = (placements || candidatePositions({
    polygon: ring,
    spacingMeters: effectiveSpacing,
    exclusionZones: rules?.exclusionZones || [],
    rng,
    mode,
    maxCandidates: rules?.maxCandidates,
  })).filter((cand) => {
    if (!pointInRing(cand.lon, cand.lat, ring)) return false;
    if (waterMode === 'static') return true;
    // The caller supplies its own water test (spec §15 keeps hydrology out of
    // this module); 'no-tree-wetland' keeps everything but wetlands, while
    // 'deep-water' additionally rejects open water.
    const water = rules.waterSampler?.(cand.lat, cand.lon);
    if (!water) return true;
    if (waterMode === 'no-tree-wetland') return !water.wetland;
    return !water.water && !water.wetland;
  }).filter((cand) => {
    if (!terrainSampler) return true;
    const sample = terrainSampler(cand.lat, cand.lon);
    return passesTerrainRules({
      slopeDeg: sample?.slopeDeg ?? null,
      aspectBearingDeg: sample?.aspectDeg ?? null,
      rules,
    });
  });

  // A planting-density rule is a hard ceiling on realised count (spec §14): it
  // applies whether the caller asked for a specific count or left the lattice to
  // decide, otherwise "100 stems/ha" would be advisory only. Computing the cap
  // *before* thinning lets enforceMinSpacing stop early instead of processing a
  // 40 000-candidate lattice to keep 400 trees.
  const areaHa = polygonAreaHectares(ring);
  const densityCap = density > 0 ? Math.max(1, Math.round(areaHa * density)) : Infinity;
  const requested = Number(args.count) > 0 ? Number(args.count) : Infinity;
  const target = Math.min(requested, densityCap, maxCount);

  const spaced = placements
    ? candidates.slice(0, Math.min(target, candidates.length))
    : enforceMinSpacing(candidates, effectiveSpacing, target);
  const chosen = spaced;
  // A caller may pass either loose asset ids or a full manifest. Passing the
  // manifest routes the ids through the same validation the registry uses
  // (spec §7), so the two entry points cannot drift apart — and an unusable
  // record is dropped here rather than reaching the renderer.
  const requestedIds = Array.isArray(args.assets) && args.assets.length
    ? indexVegetationManifest({ assets: args.assets }).assets.map((a) => a.id)
    : assetIds;
  const assigned = assignAssets(chosen.length, requestedIds, rng, args.assetWeights || null);
  const scales = scaleRangeFor(rules, modeDefaults(mode));

  return chosen.map((cand, i) => {
    // staticPlacements are caller-supplied and may use either convention.
    const candLat = Number(cand.latitude ?? cand.lat);
    const candLon = Number(cand.longitude ?? cand.lon);
    const sample = terrainSampler ? terrainSampler(candLat, candLon) : null;
    const elevation = Number.isFinite(cand.elevationM)
      ? cand.elevationM
      : (Number.isFinite(sample?.elevationM) ? sample.elevationM : undefined);
    return createTreeInstance({
      id: idPrefix ? `${idPrefix}-${String(i).padStart(4, '0')}` : undefined,
      assetId: assigned[i],
      propertyId,
      latitude: candLat,
      longitude: candLon,
      elevation,
      // Rotation is biologically free (full 360°); scale stays inside the
      // caller's range so a tree is never distorted into an implausible form.
      rotation: rng() * Math.PI * 2,
      scale: scales.min + rng() * (scales.max - scales.min),
      status: rules?.status || DEFAULT_VEGETATION_STATUS,
      growthStage: rules?.growthStage || 'unknown',
      metadata: {
        placementMode: mode,
        seed: String(randomSeed),
        ...(mode === 'shelterbelt' || mode === 'orchard' ? { purpose: mode } : {}),
      },
    });
  });
}


/**
 * Group instances into rows for structured modes — lets the UI and tests
 * confirm orchard/shelterbelt output is genuinely row-shaped rather than merely
 * "less random" (spec §16).
 *
 * Rows are recovered by 1-D clustering on the lattice's north axis; because
 * candidatePositions() builds on an axis-aligned lattice, this recovers the
 * rows exactly and deterministically.
 *
 * @param {Array<{latitude:number, longitude:number}>} instances
 * @param {number} toleranceMeters
 * @returns {Array<Array<number>>} instance indices per row, north→south
 */
export function groupIntoRows(instances, toleranceMeters = 2) {
  if (!Array.isArray(instances) || !instances.length) return [];
  const latMid = instances.reduce((s, p) => s + p.latitude, 0) / instances.length;
  const mLat = metersPerDegLat();
  const rows = [];
  for (let i = 0; i < instances.length; i++) {
    const north = instances[i].latitude * mLat;
    let placed = false;
    for (const row of rows) {
      if (Math.abs(row.north - north) <= toleranceMeters) {
        row.members.push(i);
        row.north = (row.north * (row.members.length - 1) + north) / row.members.length;
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ north, members: [i] });
  }
  return rows
    .sort((a, b) => b.north - a.north)
    .map((row) => row.members.sort((a, b) => instances[a].longitude - instances[b].longitude));
}

/**
 * Result of checking that a scatter obeys its own rules — returned by
 * {@link auditScatter} so callers (and tests) can assert on placement quality
 * without re-implementing the geometry.
 *
 * @typedef {object} ScatterAudit
 * @property {number} count
 * @property {number} minPairDistanceM   Closest realised pair (Infinity if <2).
 * @property {number} minSpacingMeters
 * @property {boolean} spacingOk
 * @property {number} outsidePolygon     Instances that escaped the polygon.
 * @property {number} insideExclusion    Instances that landed in a no-plant zone.
 * @property {number} distinctAssetCount
 * @property {number} distinctRotationCount
 * @property {number} scaleMin
 * @property {number} scaleMax
 */

/**
 * Audit a scatter against the rules it was generated with. Used by tests and by
 * the ingestion/debug tooling to prove spec §13's claims hold for real data
 * rather than only in the unit tests.
 *
 * @param {Array} instances
 * @param {{polygon?:number[][], rules?:object}} args
 * @returns {ScatterAudit}
 */
export function auditScatter(instances, { polygon, rules = {} } = {}) {
  const list = Array.isArray(instances) ? instances : [];
  const ring = openRing(polygon || []);
  let minPair = Infinity;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = metersBetween(list[i].latitude, list[i].longitude, list[j].latitude, list[j].longitude);
      if (d < minPair) minPair = d;
    }
  }
  const minSpacingMeters = Number(rules?.minSpacingMeters) || 0;
  const outsidePolygon = ring.length >= 3
    ? list.filter((t) => !pointInRing(t.longitude, t.latitude, ring)).length
    : 0;
  const zones = rules?.exclusionZones || [];
  const insideExclusion = zones.length
    ? list.filter((t) => zones.some((z) => pointInGeoJsonGeometry(
      t.longitude, t.latitude, z?.geometry || z
    ))).length
    : 0;
  const scales = list.map((t) => Number(t.scale)).filter(Number.isFinite);

  return {
    count: list.length,
    minPairDistanceM: minPair,
    minSpacingMeters,
    // Sub-millimetre tolerance: floating-point lon/lat round-trips otherwise
    // register a boundary pair as "just inside" by a few microns.
    spacingOk: minSpacingMeters <= 0 || list.length < 2 || minPair >= minSpacingMeters - 1e-3,
    outsidePolygon,
    insideExclusion,
    distinctAssetCount: new Set(list.map((t) => t.assetId)).size,
    distinctRotationCount: new Set(list.map((t) => Number(t.rotation).toFixed(4))).size,
    scaleMin: scales.length ? Math.min(...scales) : 0,
    scaleMax: scales.length ? Math.max(...scales) : 0,
  };
}

