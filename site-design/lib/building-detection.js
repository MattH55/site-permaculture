/**
 * Building detection: existing structures on the parcel, with height and a
 * rough type inference, as data for the 3D twin to render — see
 * building-detection-3d-instructions.md. Mirrors the tree pipeline's shape
 * (detect → get dimensions → render): this module does detect + dimensions;
 * public/app.js does the actual 3D rendering (procedural extrusion, with an
 * asset swap-in for recognized farm-structure types where a matching model
 * is available).
 *
 * Footprints come from structures.js (Microsoft Canadian Building
 * Footprints + OSM, merged) — reuse that one fetch, don't re-query.
 *
 * Height reuses the canopy layer's CHM (= DSM − DTM, sampled from the
 * HRDEM terrain pipeline) rather than re-fetching DSM/DTM: a building
 * footprint sampled against that same raster reads its roof height above
 * ground exactly the way a tree's crown height does — it's the identical
 * calculation, just applied to a different polygon. No new elevation
 * fetch.
 */

import { sampleRasterAtLatLon, weakestConfidence, cachedSuitability, round0, round1 } from './suitability-common.js';

// Simple, documented footprint-shape heuristic (spec: "keep this heuristic
// simple and documented, and always tag its output as inferred"). Areas are
// planning-scale buckets, not a substitute for an actual tagged building=*.
const SHED_MAX_AREA_M2 = 20;
const HOUSE_MAX_AREA_M2 = 280;
const BARN_MIN_AREA_M2 = 150;
const BARN_MIN_ASPECT = 2.2;

const ASSET_CANDIDATE_TYPES = new Set(['barn', 'shed', 'garage', 'farm_auxiliary']);

/**
 * @param {object} opts
 * @param {object} opts.structures getStructureFootprints() result
 * @param {{west:number,south:number,east:number,north:number}} [opts.bbox]
 *   The same parcel bbox the canopy layer was built against — canopy.chm's
 *   grid spans this bbox exactly (see canopy.js), so it's needed to sample
 *   the CHM raster by lat/lon rather than assuming grid alignment.
 * @param {object} [opts.canopy] buildCanopyLayer() result (chm used for height)
 * @param {string} [opts.parcel_id] Enables per-parcel caching
 */
export function computeBuildingDetection(opts = {}) {
  const compute = () => computeUncached(opts);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(opts.parcel_id, [
    'buildings', opts.structures?.source_counts?.merged, opts.canopy?.data_source, opts.canopy?._meta?.cache,
  ], compute);
}

function computeUncached(opts) {
  const footprints = opts.structures?.footprints || [];
  if (!footprints.length) {
    return {
      available: false,
      buildings: [],
      data_source: { footprints: opts.structures?.data_source || 'not supplied', height: opts.canopy?.data_source || 'not supplied' },
      confidence: 'unavailable',
      reason: opts.structures?.available === false ? (opts.structures.reason || 'No structure footprints available for this parcel.') : 'No structures detected on this parcel.',
    };
  }

  const chmRaster = opts.canopy?.chm?.values_m?.length && opts.bbox
    ? { rows: opts.canopy.chm.rows, cols: opts.canopy.chm.cols, bbox: opts.bbox, values: opts.canopy.chm.values_m }
    : null;

  const buildings = footprints.map((fp) => buildOne(fp, opts, chmRaster));

  return {
    available: buildings.length > 0,
    buildings,
    data_source: {
      footprints: opts.structures?.data_source || {},
      height: opts.canopy?.available ? `CHM (DSM − DTM), ${opts.canopy.data_source}` : 'not supplied',
    },
    confidence: weakestConfidence(buildings.map((b) => weakestConfidence([b.confidence.footprint, b.confidence.height]))),
  };
}

function buildOne(fp, opts, chmRaster) {
  const ring = fp.geometry?.coordinates?.[0] || [];
  const { area_m2, aspectRatio } = footprintShape(ring);
  const heightSamples = sampleFootprintHeights(ring, fp.centroid, chmRaster);
  const heightM = percentile(heightSamples, 0.9);

  const tagged = fp.building_type_tag && fp.building_type_tag !== 'yes';
  const buildingType = tagged ? normalizeTag(fp.building_type_tag) : inferType(area_m2, aspectRatio);
  const typeConfidence = tagged ? 'tagged' : 'inferred';

  const footprintConfidence = fp.source === 'MICROSOFT_FOOTPRINTS' ? 'high' : 'moderate';
  const heightConfidence = heightM != null ? (opts.canopy?.confidence || 'moderate') : 'unavailable';
  const materials = inferMaterials(buildingType, area_m2);
  const roofType = inferRoofType(ring, fp.roof_shape_tag, heightSamples, aspectRatio);
  // Missing/unreliable height → box LOD (the degraded-data path). Quaternius
  // farm assets are the visual fallback when present under
  // /assets/quaternius-farm/; until then the box is a flat-capped extrusion.
  const lod = heightM != null ? 'detailed' : 'box';

  return {
    footprint_id: fp.footprint_id,
    geometry: fp.geometry,
    footprint: fp.geometry,
    area_m2: round0(area_m2),
    height_m: heightM != null ? round1(heightM) : null,
    building_type: buildingType,
    type_confidence: typeConfidence,
    roof_shape: fp.roof_shape_tag || null,
    roof_type: roofType,
    wall_material: materials.wall,
    roof_material: materials.roof,
    lod,
    // Advisory only — public/app.js makes the authoritative asset-vs-
    // extrusion call at render time, since that depends on whether a
    // matching GLB variant is actually available and fits the footprint's
    // measured bounding box (spec: don't force a mismatched asset on).
    render_mode_hint: ASSET_CANDIDATE_TYPES.has(buildingType) ? 'asset' : 'extrusion',
    data_source: { footprint: fp.source, height: heightM != null ? 'CHM (DSM − DTM)' : 'unavailable' },
    confidence: { footprint: footprintConfidence, height: heightConfidence, type: typeConfidence === 'tagged' ? 'high' : 'lower' },
  };
}

/** Footprint area (m²) and long/short bounding-box aspect ratio, from a lon/lat ring. */
function footprintShape(ring) {
  if (ring.length < 3) return { area_m2: 0, aspectRatio: 1 };
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const lat0 = closed.reduce((s, p) => s + p[1], 0) / closed.length;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const local = closed.map(([lon, lat]) => [lon * mPerDegLon, lat * mPerDegLat]);

  let shoelace = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < local.length; i++) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % local.length];
    shoelace += x1 * y2 - x2 * y1;
    minX = Math.min(minX, x1); maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y1); maxY = Math.max(maxY, y1);
  }
  const area_m2 = Math.abs(shoelace) / 2;
  const w = Math.max(maxX - minX, 0.01);
  const h = Math.max(maxY - minY, 0.01);
  const aspectRatio = Math.max(w, h) / Math.min(w, h);
  return { area_m2, aspectRatio };
}

function inferType(area_m2, aspectRatio) {
  if (area_m2 >= BARN_MIN_AREA_M2 && aspectRatio >= BARN_MIN_ASPECT) return 'barn';
  if (area_m2 < SHED_MAX_AREA_M2) return 'shed';
  if (area_m2 <= HOUSE_MAX_AREA_M2 && aspectRatio < BARN_MIN_ASPECT) return 'house';
  return 'unknown';
}

function normalizeTag(tag) {
  const known = new Set(['house', 'barn', 'shed', 'garage', 'farm_auxiliary']);
  if (known.has(tag)) return tag;
  // Fold common OSM building=* values into the schema's coarser bucket set.
  if (['detached', 'residential', 'semidetached_house', 'terrace', 'bungalow', 'cabin'].includes(tag)) return 'house';
  if (['barn', 'stable', 'cowshed', 'sty'].includes(tag)) return 'barn';
  if (['shed', 'hut'].includes(tag)) return 'shed';
  if (['garage', 'garages', 'carport'].includes(tag)) return 'garage';
  if (['farm_auxiliary', 'greenhouse', 'silo'].includes(tag)) return 'farm_auxiliary';
  return 'unknown';
}

/**
 * Sample CHM (DSM − DTM) inside the footprint. Vertices + centroid plus a
 * coarse interior grid (point-in-polygon). Height is the 90th percentile of
 * those samples so a single DSM spike does not inflate the extrusion.
 */
function sampleFootprintHeights(ring, centroid, chmRaster) {
  if (!chmRaster) return [];
  const samples = [];
  const push = (lat, lon) => {
    const v = sampleRasterAtLatLon(chmRaster, lat, lon);
    if (v != null && Number.isFinite(v) && v > 0) samples.push(v);
  };
  if (centroid) push(centroid.lat, centroid.lon);
  for (const [lon, lat] of ring) push(lat, lon);

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const lon = minLon + ((i + 0.5) / steps) * (maxLon - minLon);
      const lat = minLat + ((j + 0.5) / steps) * (maxLat - minLat);
      if (pointInRing(lon, lat, ring)) push(lat, lon);
    }
  }
  return samples;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function inferRoofType(ring, roofShapeTag, heightSamples, aspectRatio) {
  const tagged = String(roofShapeTag || '').toLowerCase();
  if (['flat', 'flat_roof'].includes(tagged)) return 'flat';
  if (['gable', 'gabled', 'hip', 'hipped', 'gambrel', 'pitched'].includes(tagged)) return 'gable';
  if (!isRoughlyRectangular(ring, aspectRatio)) return 'flat';
  if (heightSamples.length >= 4) {
    const mean = heightSamples.reduce((s, v) => s + v, 0) / heightSamples.length;
    if (mean > 0.5) {
      const variance = heightSamples.reduce((s, v) => s + (v - mean) ** 2, 0) / heightSamples.length;
      if (Math.sqrt(variance) / mean > 0.12) return 'gable';
    }
  }
  return 'flat';
}

function isRoughlyRectangular(ring, aspectRatio) {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (closed.length < 4 || closed.length > 6) return false;
  return aspectRatio >= 1.15 && aspectRatio <= 4.5;
}

function inferMaterials(buildingType, area_m2) {
  if (buildingType === 'shed' || area_m2 < SHED_MAX_AREA_M2) {
    return { wall: 'metal', roof: 'metal' };
  }
  if (buildingType === 'barn' || buildingType === 'farm_auxiliary') {
    return { wall: 'siding', roof: 'metal' };
  }
  if (buildingType === 'garage') {
    return { wall: 'siding', roof: 'asphalt_shingle' };
  }
  if (area_m2 > 180) return { wall: 'brick', roof: 'asphalt_shingle' };
  return { wall: 'siding', roof: 'asphalt_shingle' };
}

function pointInRing(px, py, ring) {
  if (!ring || ring.length < 3) return true;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export const _internal = {
  footprintShape,
  inferType,
  normalizeTag,
  inferRoofType,
  inferMaterials,
  percentile,
};
