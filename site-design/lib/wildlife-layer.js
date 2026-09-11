/**
 * Wildlife layer: expected species (range overlap) vs confirmed nearby
 * observations. See wildlife-layer-instructions.md.
 *
 * Alberta-first catalog (FWMIS/COSEWIC stand-ins) → GBIF + iNaturalist
 * observations. ACIMS element occurrences are not queried: those locations
 * are withheld, and we never try to reconstruct them.
 */

import fs from 'node:fs';
import path from 'node:path';
import { haversineM } from './suitability-common.js';
import { lookupWmu } from './wildlife-enrich.js';

const CACHE_DIR = path.join(import.meta.dirname, '..', 'data', 'cache', 'wildlife');
const CATALOG_PATH = path.join(import.meta.dirname, '..', 'data', 'wildlife', 'alberta-expected-ranges.json');

export const BUFFER_RADIUS_M = 5000;
export const OBS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90; // quarterly
export const EXPECTED_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 365;

const FETCH_MS = 12_000;
const USER_AGENT = 'LandIntelligencePermaculture/1.0 (wildlife-layer)';

const ICONIC_TO_GROUP = {
  1: 'mammal',
  3: 'bird',
  26036: 'reptile',
  20978: 'amphibian',
  47178: 'fish',
  47158: 'insect',
  47126: 'plant',
};

let catalogCache;

export function loadExpectedCatalog() {
  if (catalogCache) return catalogCache;
  try {
    catalogCache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch {
    catalogCache = { version: 'missing', species: [] };
  }
  return catalogCache;
}

/**
 * @param {{ bbox: object, centre: {latitude:number, longitude:number}, buffer_m?: number, surface_water?: object, wetlands?: object, skipCache?: boolean, fetchImpl?: Function }} opts
 */
export async function buildWildlifeLayer(opts = {}) {
  const bbox = opts.bbox;
  const centre = opts.centre || {
    latitude: (bbox.south + bbox.north) / 2,
    longitude: (bbox.west + bbox.east) / 2,
  };
  const bufferM = opts.buffer_m || BUFFER_RADIUS_M;
  const fetchImpl = opts.fetchImpl || fetch;

  const cacheKey = wildlifeCacheKey(bbox, bufferM);
  if (!opts.skipCache) {
    const hit = readWildlifeCache(cacheKey);
    if (hit) return hit;
  }

  const searchBbox = expandBbox(bbox, bufferM);
  const catalog = loadExpectedCatalog();
  const wmu = lookupWmu(centre);

  const expected = expectedSpeciesAt(centre, catalog, wmu);
  const [gbifObs, inatObs] = await Promise.all([
    fetchGbifObservations(searchBbox, { fetchImpl, parcelBbox: bbox, centre }).catch(() => []),
    fetchInatObservations(searchBbox, { fetchImpl, parcelBbox: bbox }).catch(() => []),
  ]);

  const observations = mergeObservations([...gbifObs, ...inatObs]).slice(0, 80);
  const sar = speciesAtRiskFlagged(expected, observations);
  const triggers = wildlifeTriggers({
    expected,
    observations,
    sar,
    surface_water: opts.surface_water,
    wetlands: opts.wetlands,
  });
  const flags = wildlifeFlags(triggers, sar);

  const layer = {
    available: true,
    expected_species: expected,
    observations_nearby: observations,
    species_at_risk_flagged: sar,
    buffer_radius_m: bufferM,
    data_snapshot_date: new Date().toISOString().slice(0, 10),
    catalog_version: catalog.version || null,
    wmu,
    triggers,
    flags,
    sampling_note:
      'Absence of nearby observations means the area is under-surveyed, not that species are absent. Crowd-sourced records are biased toward roads and populated places.',
    sensitive_species_note:
      'GBIF, iNaturalist, and ACIMS obscure or withhold coordinates for species vulnerable to disturbance. Obscured records are stored as generalized; this layer never tightens them.',
    source_name: 'Alberta expected-range catalog (FWMIS/COSEWIC) + GBIF + iNaturalist research-grade',
    source_url: 'https://www.gbif.org/',
    acims_note:
      'ACIMS element occurrences are not fetched: precise locations of tracked/rare species are withheld. At-risk flags use published COSEWIC/SARA range descriptions only.',
    white_tailed_deer: deerSummary(expected, observations),
    recent_sightings: {
      count: observations.length,
      last_seen: observations[0]?.observed_date || null,
      source: 'GBIF + iNaturalist (research-grade preferred)',
    },
    sighting_species: [...new Set(observations.map((o) => o.scientific_name).filter(Boolean))],
    methodology_note:
      'Expected = range overlap (could occur). Confirmed nearby = dated sighting within the buffer. Different confidence — do not merge them.',
  };

  if (!opts.skipCache) writeWildlifeCache(cacheKey, layer);
  return layer;
}

export function expectedSpeciesAt(centre, catalog = loadExpectedCatalog(), wmu = null) {
  const lat = centre.latitude;
  const lon = centre.longitude;
  const out = [];
  for (const s of catalog.species || []) {
    if (!inRangeBox(lat, lon, s)) continue;
    const sar = isSarStatus(s.conservation_status) || (s.guilds || []).includes('sar');
    const source = s.range_source || 'IUCN_REDLIST_FALLBACK';
    out.push({
      common_name: s.common_name,
      scientific_name: s.scientific_name,
      taxon_group: s.taxon_group || 'other',
      conservation_status: s.conservation_status || null,
      range_source: source,
      confidence: confidenceForRangeSource(source),
      location_precision: sar ? 'obscured' : 'range_polygon_only',
      guilds: s.guilds || [],
      wmu_code: wmu?.wmu_code || null,
    });
  }
  return out;
}

export function confidenceForRangeSource(source) {
  if (source === 'ACIMS' || source === 'FWMIS' || source === 'COSEWIC') return 'high';
  if (source === 'EBIRD_STATUS_TRENDS' || source === 'IUCN_REDLIST_FALLBACK') return 'low';
  return 'moderate';
}

export function isSarStatus(status) {
  if (!status) return false;
  return /endangered|threatened|special concern|s1|s2|cosewic|sara/i.test(status);
}

export function speciesAtRiskFlagged(expected = [], observations = []) {
  const names = new Set();
  for (const s of expected) {
    if (isSarStatus(s.conservation_status) || (s.guilds || []).includes('sar')) {
      names.add(s.scientific_name);
    }
  }
  for (const o of observations) {
    if (o.at_risk || isSarStatus(o.conservation_status)) names.add(o.scientific_name);
  }
  return [...names];
}

export function wildlifeTriggers({ expected = [], observations = [], sar = [], surface_water, wetlands } = {}) {
  const names = collectNames(expected, observations);
  const ungulates = names.some(isUngulate);
  const predators = names.some(isPredator);
  const pollinators = names.some(isPollinator);
  const wetlandAssoc = names.some(isWetlandAssociated);
  const waterNearby =
    !!wetlands?.present ||
    (surface_water?.distance_to_nearest_water_m != null && surface_water.distance_to_nearest_water_m < 250) ||
    (surface_water?.water_bodies || []).length > 0;
  return {
    ungulates,
    predators,
    pollinators,
    wetland_species: wetlandAssoc,
    riparian_package: wetlandAssoc && waterNearby,
    species_at_risk: sar.length > 0,
    packages: [
      ungulates && 'deer_wildlife_fence',
      predators && 'wildlife_camera_monitoring',
      pollinators && 'pollinator_habitat',
      wetlandAssoc && waterNearby && 'riparian_wetland_restoration',
    ].filter(Boolean),
  };
}

export function wildlifeFlags(triggers, sar) {
  const flags = [];
  if (triggers?.species_at_risk || sar?.length) {
    flags.push({
      code: 'species_at_risk',
      severity: 'caution',
      message:
        `Range/habitat for ${sar.length ? sar.join(', ') : 'one or more at-risk species'} overlaps this parcel. Provincial/federal species-at-risk regulations may apply — recommend a habitat assessment before major ground disturbance. Locations are not pinpointed.`,
    });
  }
  if (triggers?.ungulates) {
    flags.push({
      code: 'ungulate_browse',
      severity: 'info',
      message: 'Deer/elk/moose expected or confirmed nearby — plan browse protection (fence or individual guards) for new plantings.',
    });
  }
  if (triggers?.predators) {
    flags.push({
      code: 'predator_presence',
      severity: 'info',
      message: 'Cougar, bear, and/or coyote expected or confirmed nearby — livestock-guardian practice and wildlife-camera monitoring are recommended.',
    });
  }
  return flags;
}

export function distanceToBboxM(lat, lon, bbox) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !bbox) return null;
  if (lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east) return 0;
  const clat = clamp(lat, bbox.south, bbox.north);
  const clon = clamp(lon, bbox.west, bbox.east);
  return Math.round(haversineM(lat, lon, clat, clon));
}

export function locationPrecisionFromRecord({ geoprivacy, issues, uncertaintyM } = {}) {
  if (geoprivacy === 'obscured' || geoprivacy === 'private') return 'obscured';
  const issueStr = Array.isArray(issues) ? issues.join(' ') : String(issues || '');
  if (/GEOPRIVACY|COORDINATE_ROUNDED/i.test(issueStr)) return 'generalized';
  if (Number.isFinite(uncertaintyM) && uncertaintyM >= 10_000) return 'generalized';
  if (Number.isFinite(uncertaintyM) && uncertaintyM >= 1000) return 'generalized';
  return 'exact';
}

export function expandBbox(bbox, bufferM) {
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = bufferM / 111_320;
  const dLng = bufferM / (111_320 * Math.cos((midLat * Math.PI) / 180) || 1);
  return {
    west: bbox.west - dLng,
    south: bbox.south - dLat,
    east: bbox.east + dLng,
    north: bbox.north + dLat,
  };
}

export function wildlifeCacheKey(bbox, bufferM) {
  const q = (n) => Number(n).toFixed(4);
  return `${q(bbox.west)}_${q(bbox.south)}_${q(bbox.east)}_${q(bbox.north)}_${bufferM}`;
}

export function observationCacheFresh(rec, now = Date.now()) {
  if (!rec?._cached_at) return false;
  return now - rec._cached_at < OBS_CACHE_TTL_MS;
}

export function expectedCacheFresh(rec, now = Date.now()) {
  if (!rec?._cached_at) return false;
  return now - rec._cached_at < EXPECTED_CACHE_TTL_MS;
}

function readWildlifeCache(key) {
  const p = path.join(CACHE_DIR, `${safeKey(key)}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!observationCacheFresh(rec)) return null;
    return { ...rec, _meta: { ...(rec._meta || {}), cache: 'hit' } };
  } catch {
    return null;
  }
}

function writeWildlifeCache(key, layer) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, `${safeKey(key)}.json`),
      JSON.stringify({ ...layer, _cached_at: Date.now() })
    );
  } catch {
    /* cache is best-effort */
  }
}

function safeKey(s) {
  return String(s).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);
}

async function fetchGbifObservations(bbox, { fetchImpl, parcelBbox }) {
  const year = `${new Date().getUTCFullYear() - 5},${new Date().getUTCFullYear()}`;
  const url =
    `https://api.gbif.org/v1/occurrence/search?` +
    `decimalLatitude=${bbox.south},${bbox.north}` +
    `&decimalLongitude=${bbox.west},${bbox.east}` +
    `&year=${year}&hasCoordinate=true&limit=80`;
  const data = await jsonFetch(fetchImpl, url);
  const results = data?.results || [];
  return results.map((r) => {
    const lat = Number(r.decimalLatitude);
    const lon = Number(r.decimalLongitude);
    const precision = locationPrecisionFromRecord({
      issues: r.issues,
      uncertaintyM: r.coordinateUncertaintyInMeters,
    });
    const dataset = String(r.datasetName || r.publishingOrgKey || '');
    const source = /ebird/i.test(dataset) || r.institutionCode === 'CLO' ? 'EBIRD' : 'GBIF';
    return {
      common_name: r.vernacularName || null,
      scientific_name: r.species || r.scientificName || 'Unknown',
      observed_date: (r.eventDate || '').slice(0, 10) || null,
      source,
      research_grade: r.identificationVerificationStatus === 'RESEARCH_GRADE' || source === 'EBIRD' || !!r.species,
      distance_from_parcel_m: precision === 'obscured' ? null : distanceToBboxM(lat, lon, parcelBbox),
      location_precision: precision,
      taxon_group: gbifTaxonGroup(r),
      at_risk: /endangered|threatened|vulnerable/i.test(r.iucnRedListCategory || ''),
      conservation_status: r.iucnRedListCategory || null,
    };
  });
}

async function fetchInatObservations(bbox, { fetchImpl, parcelBbox }) {
  const d1 = new Date();
  d1.setFullYear(d1.getFullYear() - 5);
  const url =
    `https://api.inaturalist.org/v1/observations?` +
    `swlat=${bbox.south}&swlng=${bbox.west}&nelat=${bbox.north}&nelng=${bbox.east}` +
    `&per_page=80&order_by=observed_on&order=desc` +
    `&quality_grade=research` +
    `&d1=${d1.toISOString().slice(0, 10)}`;
  const data = await jsonFetch(fetchImpl, url);
  return (data?.results || []).map((r) => {
    const privacy = r.geoprivacy || r.taxon_geoprivacy;
    const precision = locationPrecisionFromRecord({ geoprivacy: privacy });
    let lat = null;
    let lon = null;
    if (precision !== 'obscured' && r.location) {
      const [la, lo] = r.location.split(',').map(Number);
      lat = la;
      lon = lo;
    }
    return {
      common_name: r.taxon?.preferred_common_name || null,
      scientific_name: r.taxon?.name || 'Unknown',
      observed_date: r.observed_on || (r.time_observed_at || '').slice(0, 10) || null,
      source: 'INATURALIST',
      research_grade: r.quality_grade === 'research',
      distance_from_parcel_m: precision === 'obscured' ? null : distanceToBboxM(lat, lon, parcelBbox),
      location_precision: precision,
      taxon_group: ICONIC_TO_GROUP[r.taxon?.iconic_taxon_id] || 'other',
      at_risk: !!r.taxon?.threatened,
    };
  });
}

async function jsonFetch(fetchImpl, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function mergeObservations(list) {
  const seen = new Set();
  const out = [];
  for (const o of list) {
    const key = `${(o.scientific_name || '').toLowerCase()}|${o.observed_date || ''}|${o.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  out.sort((a, b) => String(b.observed_date || '').localeCompare(String(a.observed_date || '')));
  return out;
}

function deerSummary(expected, observations) {
  const deerObs = observations.filter((o) => isUngulate(o.scientific_name) || isUngulate(o.common_name));
  const expectedDeer = expected.some((s) => isUngulate(s.scientific_name));
  const count = deerObs.length;
  let pressure_score = expectedDeer ? 0.55 : 0.4;
  if (count >= 10) pressure_score = 0.85;
  else if (count >= 3) pressure_score = 0.7;
  else if (count >= 1) pressure_score = 0.62;
  const pressure_label =
    pressure_score >= 0.8
      ? 'Confirmed high ungulate activity (recent sightings)'
      : pressure_score >= 0.65
        ? 'Confirmed ungulate presence (recent sightings)'
        : expectedDeer
          ? 'Ungulates expected in range — rural Alberta browse pressure'
          : 'Lower recorded density — still assume some browse';
  const recommendations = [];
  if (pressure_score >= 0.55) {
    recommendations.push('Plan for deer fencing or individual tree guards on new plantings');
    recommendations.push('Keep Zone 1 food plants close to buildings (deer avoid activity)');
  }
  return {
    pressure_score: Math.round(pressure_score * 100) / 100,
    pressure_label,
    sightings_count: count,
    last_sighting: deerObs[0]?.observed_date || null,
    recommendations,
  };
}

function collectNames(expected, observations) {
  const names = [];
  for (const s of expected) names.push(s.scientific_name, s.common_name);
  for (const o of observations) names.push(o.scientific_name, o.common_name);
  return names.filter(Boolean);
}

export function isUngulate(name) {
  return /odocoileus|cervus|alces|rangifer|deer|elk|moose|caribou|wapiti/i.test(name || '');
}
export function isPredator(name) {
  return /puma|ursus|canis latrans|canis lupus|cougar|bear|coyote|wolf|lynx/i.test(name || '');
}
export function isPollinator(name) {
  return /bombus|apis|papilio|danaus|bee|bumble|butterfly|swallowtail|monarch|pollinator/i.test(name || '');
}
export function isWetlandAssociated(name) {
  return /castor|anas|cygnus|charadrius|pseudacris|ambystoma|beaver|mallard|swan|plover|frog|salamander|wetland|duck/i.test(name || '');
}

function inRangeBox(lat, lon, s) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (s.lat_min != null && lat < s.lat_min) return false;
  if (s.lat_max != null && lat > s.lat_max) return false;
  if (s.lon_min != null && lon < s.lon_min) return false;
  if (s.lon_max != null && lon > s.lon_max) return false;
  return true;
}

function gbifTaxonGroup(r) {
  const c = String(r.class || r.kingdom || '').toLowerCase();
  if (c.includes('mammal')) return 'mammal';
  if (c.includes('aves') || c.includes('bird')) return 'bird';
  if (c.includes('reptil')) return 'reptile';
  if (c.includes('amphib')) return 'amphibian';
  if (c.includes('actinopter') || c.includes('fish')) return 'fish';
  if (c.includes('insect')) return 'insect';
  if (c.includes('plant')) return 'plant';
  return 'other';
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
