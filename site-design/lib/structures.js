/**
 * Structure footprints: Microsoft Canadian Building Footprints (primary,
 * where configured) merged with OpenStreetMap buildings via Overpass
 * (fallback/supplement everywhere, primary outside Canada) — same
 * merge-not-strict-fallback pattern already used by the roads/amenities
 * layer (roads-layer.js, access.js): dedupe overlapping footprints between
 * the two sources rather than picking one exclusively.
 *
 * Shared by plantable-area.js (exclusion geometry) and
 * building-detection.js (3D building models) — both fetch through this one
 * module so a parcel's footprints are only ever queried once.
 *
 * Microsoft's Canadian Building Footprints dataset (github.com/microsoft/
 * CanadianBuildingFootprints) ships as province-sized static files, not a
 * bbox-queryable API — there's no live endpoint to vendor here. This
 * follows the same defensive convention as wind-atlas.js: try a
 * configurable endpoint (for a self-hosted tile/API service in front of
 * that dataset, if one is ever stood up) and degrade gracefully to
 * OSM-only when it's unset or unreachable, rather than failing the layer.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Read lazily (not a module-load-time const) so it can be configured/tested
// per-call rather than locked in at first import.
function msFootprintsUrl() { return process.env.MS_BUILDING_FOOTPRINTS_URL || null; }
const DEDUPE_RADIUS_M = 15; // two footprints whose centroids fall within this are treated as the same building

const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const cache = new Map();

/**
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {{force?:boolean, fetchImpl?:Function}} [opts]
 */
export async function getStructureFootprints(bbox, opts = {}) {
  if (!bbox || bbox.west == null) return unavailable('invalid_bbox');
  const key = `${bbox.west.toFixed(5)},${bbox.south.toFixed(5)},${bbox.east.toFixed(5)},${bbox.north.toFixed(5)}`;
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, _meta: { ...hit.value._meta, cache: 'hit' } };
  }

  const [ms, osm] = await Promise.all([
    fetchMsFootprints(bbox, opts).catch((e) => ({ available: false, error: e.message, footprints: [] })),
    fetchOsmBuildings(bbox, opts).catch((e) => ({ available: false, error: e.message, footprints: [] })),
  ]);

  const { merged, dupesDropped } = mergeDedupe(ms.footprints || [], osm.footprints || []);

  const value = {
    available: merged.length > 0,
    footprints: merged,
    source_counts: {
      microsoft: (ms.footprints || []).length,
      osm: (osm.footprints || []).length,
      merged: merged.length,
      duplicates_dropped: dupesDropped,
    },
    data_source: {
      microsoft: ms.available ? 'MICROSOFT_FOOTPRINTS' : (ms.error || 'not_configured'),
      osm: osm.available ? 'OSM' : (osm.error || 'unavailable'),
    },
    confidence: ms.available ? 'high' : (osm.available ? 'moderate' : 'unavailable'),
    note: ms.available
      ? null
      : 'Microsoft Canadian Building Footprints endpoint not configured (MS_BUILDING_FOOTPRINTS_URL) or unreachable — footprints are OSM-only, which is sparse outside towns for rural/acreage buildings.',
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}

function unavailable(reason) {
  return {
    available: false,
    footprints: [],
    source_counts: { microsoft: 0, osm: 0, merged: 0, duplicates_dropped: 0 },
    data_source: {},
    confidence: 'unavailable',
    reason,
  };
}

async function fetchMsFootprints(bbox, opts) {
  const url = msFootprintsUrl();
  if (!url) return { available: false, error: 'not_configured', footprints: [] };
  const fetchImpl = opts.fetchImpl || fetch;
  const params = new URLSearchParams({
    bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetchImpl(`${url}?${params}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { available: false, error: `ms_footprints_http_${res.status}`, footprints: [] };
    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    const footprints = features
      .map((f, i) => normalizeFootprint(f.geometry, { id: `ms-${i}`, source: 'MICROSOFT_FOOTPRINTS' }))
      .filter(Boolean);
    return { available: footprints.length > 0, footprints };
  } catch (e) {
    return { available: false, error: e.name === 'AbortError' ? 'timeout' : e.message, footprints: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOsmBuildings(bbox, opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const query = `
[out:json][timeout:20];
(
  way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out geom;
`.trim();

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        body: query,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const footprints = (data.elements || [])
        .filter((el) => el.type === 'way' && el.geometry?.length >= 3)
        .map((el) => normalizeFootprint(
          { type: 'Polygon', coordinates: [el.geometry.map((pt) => [pt.lon, pt.lat])] },
          { id: `osm-${el.id}`, source: 'OSM', osm_id: el.id, building_type: el.tags?.building && el.tags.building !== 'yes' ? el.tags.building : null, roof_shape: el.tags?.['roof:shape'] || null }
        ))
        .filter(Boolean);
      return { available: true, footprints };
    } catch {
      continue;
    }
  }
  return { available: false, error: 'overpass_unreachable', footprints: [] };
}

function normalizeFootprint(geometry, meta) {
  const ring = geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  return {
    footprint_id: meta.id,
    source: meta.source,
    osm_id: meta.osm_id ?? null,
    building_type_tag: meta.building_type || null,
    roof_shape_tag: meta.roof_shape || null,
    geometry: { type: 'Polygon', coordinates: [ring] },
    centroid: ringCentroid(ring),
  };
}

function ringCentroid(ring) {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  const lon = closed.reduce((s, p) => s + p[0], 0) / closed.length;
  const lat = closed.reduce((s, p) => s + p[1], 0) / closed.length;
  return { lat, lon };
}

/**
 * Prefer Microsoft footprints (per spec, primary for Alberta parcels);
 * drop any OSM footprint whose centroid falls within DEDUPE_RADIUS_M of an
 * MS footprint's centroid (same building, detected twice), but keep OSM's
 * footprint otherwise — it's the only source likely to carry a
 * building=* type tag or roof:shape, so an unmatched OSM footprint is kept
 * in full, tag and all.
 */
function mergeDedupe(msFootprints, osmFootprints) {
  const merged = [...msFootprints];
  let dupesDropped = 0;
  for (const osmFp of osmFootprints) {
    const isDupe = msFootprints.some((msFp) => haversineM(osmFp.centroid.lat, osmFp.centroid.lon, msFp.centroid.lat, msFp.centroid.lon) <= DEDUPE_RADIUS_M);
    if (isDupe) { dupesDropped++; continue; }
    merged.push(osmFp);
  }
  return { merged, dupesDropped };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function deg2rad(d) { return (d * Math.PI) / 180; }

export function clearStructureFootprintsCache() { cache.clear(); }
