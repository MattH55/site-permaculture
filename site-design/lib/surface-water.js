/**
 * Confirmed surface-water layer.
 *
 * This is deliberately separate from Wet Areas Mapping: WAM describes
 * predicted drainage / groundwater conditions, whereas this module returns
 * mapped water-body and watercourse geometry suitable for the map and report.
 */

import { esriEnvelope } from './geo.js';
import { queryPredictedStreamFeatures } from './wet-areas.js';

const ALTA_SERVICE =
  'https://geospatial.alberta.ca/titan/rest/services/environment/inland_base_hydrography_update_10tm_nad83_aep/MapServer';
// The public NHN service can be overridden if NRCan changes its endpoint.
const NHN_SERVICE = process.env.NHN_MAPSERVER_URL ||
  'https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/nhn_rhn_en/MapServer';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const cache = new Map();

/**
 * Fetch surface-water features for a parcel plus a distance-search buffer.
 * Geometry is returned in WGS84 GeoJSON so both Leaflet and the 3D overlay can
 * consume it without lossy reprojection. `local_geometry` is parcel-centred
 * metres for a mesh builder that needs local coordinates.
 */
export async function getSurfaceWaterLayer(parcelBbox, opts = {}) {
  if (!validBbox(parcelBbox)) return empty('invalid_bbox');
  const buffer_m = clamp(Number(opts.buffer_m ?? 750), 500, 1000);
  const searchBbox = expandBbox(parcelBbox, buffer_m);
  const key = `${roundBox(parcelBbox)}:${buffer_m}`;
  if (!opts.skipCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, _meta: { ...hit.value._meta, cache: 'hit' } };
  }

  const centre = opts.centre || bboxCentre(parcelBbox);
  let primary = await fetchAltaLis(searchBbox, opts).catch((e) => unavailable('ALTALIS_WATER_BODIES', e));
  if (!primary.usable) primary = await fetchNhn(searchBbox, opts).catch((e) => unavailable('NHN_FEDERAL', e));
  if (!primary.usable) primary = await fetchJrc(searchBbox, opts).catch((e) => unavailable('JRC_GLOBAL_SURFACE_WATER_FALLBACK', e));

  const predicted = await (typeof opts.fetchPredictedStreams === 'function'
    ? opts.fetchPredictedStreams(searchBbox)
    : queryPredictedStreamFeatures(searchBbox)).catch((e) => ({
    available: false, features: [], error: e.message, source: 'WAM',
  }));
  const water_bodies = (primary.features || []).map((f) => normalizeFeature(f, primary.data_source, centre));
  const predicted_streams = (predicted.features || []).map((f) => ({
    geometry: f.geometry,
    local_geometry: toLocalGeometry(f.geometry, centre),
    data_source: 'WAM',
    confidence: 'high',
  }));
  const nearest = nearestWater(centre, water_bodies, predicted_streams);
  const value = {
    available: primary.usable || predicted.available,
    water_bodies,
    predicted_streams,
    distance_to_nearest_water_m: nearest?.distance_m ?? null,
    nearest_water_source_type: nearest?.type ?? null,
    data_source: primary.data_source,
    confidence: primary.data_source === 'JRC_GLOBAL_SURFACE_WATER_FALLBACK' ? 'moderate_low' : primary.usable ? 'high' : null,
    search_bbox: searchBbox,
    buffer_m,
    source_status: primary.status,
    _meta: { cache: 'miss', fetched_at: new Date().toISOString() },
  };
  if (!opts.skipCache) cache.set(key, { at: Date.now(), value });
  return value;
}

/** Live AltaLIS coverage and vintage check; no province-wide assumption. */
export async function checkAltaLisCoverage(bbox, opts = {}) {
  const fetcher = opts.fetch || fetch;
  const metadata = await json(`${ALTA_SERVICE}?f=json`, fetcher);
  // Index layer 2 identifies HUC8 update coverage. Querying it is the actual
  // coverage check; service availability or an Alberta envelope alone is not.
  const index = await queryArcgis(ALTA_SERVICE, 2, bbox, { countOnly: true, fetcher });
  const lastRevised = parseDate(metadata?.documentInfo?.ModifiedDate || metadata?.editingInfo?.lastEditDate);
  const current = !!lastRevised && Date.now() - lastRevised.getTime() <= 10 * 365.25 * 864e5;
  return {
    covers: Number(index.count || 0) > 0,
    current,
    last_revised: lastRevised?.toISOString() || null,
    checked_at: new Date().toISOString(),
    service_url: ALTA_SERVICE,
    note: metadata?.serviceDescription || null,
  };
}

async function fetchAltaLis(bbox, opts) {
  const status = await checkAltaLisCoverage(bbox, opts);
  if (!status.covers || !status.current) return { usable: false, data_source: 'ALTALIS_WATER_BODIES', status, features: [] };
  // Live service layer IDs: 9 = water-body polygons, 11 = single-line network.
  const [polys, lines] = await Promise.all([
    queryArcgis(ALTA_SERVICE, 9, bbox, { fetcher: opts.fetch }),
    queryArcgis(ALTA_SERVICE, 11, bbox, { fetcher: opts.fetch }),
  ]);
  return { usable: true, data_source: 'ALTALIS_WATER_BODIES', status, features: [...polys.features, ...lines.features] };
}

async function fetchNhn(bbox, opts) {
  const fetcher = opts.fetch || fetch;
  const metadata = await json(`${NHN_SERVICE}?f=json`, fetcher);
  const layers = (metadata?.layers || []).filter((l) => /water|hydro|lake|river|stream/i.test(l.name || ''));
  if (!layers.length) return { usable: false, data_source: 'NHN_FEDERAL', status: { checked_at: new Date().toISOString(), reason: 'No queryable NHN water layers' }, features: [] };
  const results = await Promise.all(layers.slice(0, 8).map((l) => queryArcgis(NHN_SERVICE, l.id, bbox, { fetcher }).catch(() => ({ features: [] }))));
  return {
    // A successful service + water layers establishes national coverage even
    // when this particular buffered area has no feature.
    usable: true, data_source: 'NHN_FEDERAL',
    status: { covers: true, current: true, checked_at: new Date().toISOString(), service_url: NHN_SERVICE },
    features: results.flatMap((r) => r.features),
  };
}

async function fetchJrc(bbox, opts) {
  // JRC requests require an Earth Engine credential/export URL. An application
  // can supply a small GeoJSON endpoint without changing this decision logic.
  if (typeof opts.fetchJrc !== 'function') {
    return { usable: false, data_source: 'JRC_GLOBAL_SURFACE_WATER_FALLBACK', status: { checked_at: new Date().toISOString(), reason: 'JRC export endpoint is not configured' }, features: [] };
  }
  const features = await opts.fetchJrc(bbox);
  return { usable: true, data_source: 'JRC_GLOBAL_SURFACE_WATER_FALLBACK', status: { covers: true, current: true, checked_at: new Date().toISOString() }, features: features || [] };
}

async function queryArcgis(service, layer, bbox, { countOnly = false, fetcher = fetch } = {}) {
  const params = new URLSearchParams({
    geometry: esriEnvelope(bbox), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', outSR: '4326',
    outFields: '*', f: countOnly ? 'json' : 'geojson',
  });
  if (countOnly) params.set('returnCountOnly', 'true');
  const data = await json(`${service}/${layer}/query?${params}`, fetcher);
  return countOnly ? { count: data?.count ?? 0 } : { features: data?.features || [] };
}

function normalizeFeature(feature, data_source, centre) {
  const p = feature.properties || {};
  const text = `${p.FEATURE_TYPE || ''} ${p.TYPE || ''} ${p.NAME || ''}`.toLowerCase();
  const type = /wet/.test(text) ? 'wetland' : /pond|reservoir|dugout/.test(text) ? 'pond' : /river|stream|creek|canal/.test(text) || /LineString/.test(feature.geometry?.type) ? 'river' : 'lake';
  return { type, geometry: feature.geometry, local_geometry: toLocalGeometry(feature.geometry, centre), data_source, confidence: data_source === 'JRC_GLOBAL_SURFACE_WATER_FALLBACK' ? 'moderate_low' : 'high', name: p.NAME || p.name || null };
}

function nearestWater(centre, bodies, streams) {
  const candidates = [];
  for (const f of bodies) candidates.push({ type: f.type, distance_m: distanceToGeometry(centre, f.geometry) });
  for (const f of streams) candidates.push({ type: 'predicted_stream', distance_m: distanceToGeometry(centre, f.geometry) });
  return candidates.filter((x) => Number.isFinite(x.distance_m)).sort((a, b) => a.distance_m - b.distance_m)[0] || null;
}

function distanceToGeometry(point, geometry) {
  const paths = flattenCoords(geometry?.coordinates);
  if (!paths.length) return null;
  let best = Infinity;
  for (const [lng, lat] of paths) best = Math.min(best, haversine(point.latitude, point.longitude, lat, lng));
  return Math.round(best);
}

function flattenCoords(coords, out = []) { if (!Array.isArray(coords)) return out; if (typeof coords[0] === 'number') out.push(coords); else for (const c of coords) flattenCoords(c, out); return out; }
function toLocalGeometry(geometry, centre) {
  if (!geometry?.coordinates) return null;
  const mLng = 111320 * Math.cos(centre.latitude * Math.PI / 180);
  const map = (c) => typeof c[0] === 'number' ? [Math.round((c[0] - centre.longitude) * mLng * 100) / 100, Math.round((c[1] - centre.latitude) * 111320 * 100) / 100] : c.map(map);
  return { type: geometry.type, coordinates: map(geometry.coordinates), coordinate_system: 'parcel-centred metres (east,north)' };
}
function expandBbox(b, m) { const lat = (b.south + b.north) / 2; const dLat = m / 111320; const dLng = m / (111320 * Math.cos(lat * Math.PI / 180)); return { west: b.west - dLng, south: b.south - dLat, east: b.east + dLng, north: b.north + dLat }; }
function bboxCentre(b) { return { latitude: (b.south + b.north) / 2, longitude: (b.west + b.east) / 2 }; }
function validBbox(b) { return b && ['west', 'south', 'east', 'north'].every((k) => Number.isFinite(b[k])); }
function clamp(n, lo, hi) { return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
function roundBox(b) { return [b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(','); }
function parseDate(v) { const n = Number(v); const d = Number.isFinite(n) && n > 1e11 ? new Date(n) : v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }
async function json(url, fetcher) { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 18000); try { const r = await fetcher(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); } finally { clearTimeout(t); } }
function unavailable(data_source, error) { return { usable: false, data_source, status: { checked_at: new Date().toISOString(), error: error.message }, features: [] }; }
function empty(error) { return { available: false, water_bodies: [], predicted_streams: [], distance_to_nearest_water_m: null, nearest_water_source_type: null, data_source: null, error }; }
function haversine(a, b, c, d) { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r, q = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(q)); }
