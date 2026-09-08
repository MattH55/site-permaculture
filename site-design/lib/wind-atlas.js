/**
 * Regional wind-resource baseline — Global Wind Atlas (free, ~250 m
 * resolution, global mean wind speed @ 50 m/100 m/200 m hub heights).
 *
 * Sampled once per parcel as the starting regional value; suitability-wind.js
 * modulates this locally with terrain exposure and obstruction rather than
 * replacing it (see location-suitability-scoring-instructions.md).
 *
 * The Global Wind Atlas API surface has shifted over the product's life and
 * isn't vendored/documented in this repo the way NASA POWER or NRCan are —
 * so this follows the same defensive fetch-then-fallback shape as
 * wind-rose.js/surface-water.js: try the configured endpoint, and if it's
 * unreachable or its shape doesn't match, fall back to the site's own NASA
 * POWER wind-rose mean speed (already fetched for the shelterbelt work) as
 * a regional proxy, with confidence dropped a notch and the fallback
 * flagged explicitly rather than silently presented as the wind-atlas figure.
 *
 * Per the spec, this value changes essentially never for a given location,
 * so it's cached indefinitely per rounded lat/lon (not per-parcel-version
 * like the rest of the suitability caching).
 */

const GWA_API_URL = process.env.GWA_API_URL || 'https://api.globalwindatlas.info/data/point';
const UA = 'LandIntelligenceAlberta/1.0 (site-design; research)';
const FETCH_MS = 15_000;
const CACHE_PRECISION = 3; // ~110 m grid — matches "changes essentially never" indefinite cache

/** @type {Map<string, object>} */
const cache = new Map();

/**
 * @param {{latitude:number, longitude:number}} centre
 * @param {object} [opts]
 * @param {object} [opts.wind_rose] getWindRose() result, used as the fallback baseline
 * @param {number} [opts.height_m=100] Hub height to sample
 * @param {Function} [opts.fetchImpl] Injectable fetch, for tests
 */
export async function getWindAtlasBaseline(centre, opts = {}) {
  const lat = centre?.latitude;
  const lon = centre?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { available: false, error: 'Invalid centre coordinates' };
  }

  const key = `${lat.toFixed(CACHE_PRECISION)},${lon.toFixed(CACHE_PRECISION)}@${opts.height_m || 100}`;
  if (cache.has(key)) return cache.get(key);

  const result = await fetchGwaPoint(lat, lon, opts).catch((e) => ({ ok: false, error: e.message }));

  let value;
  if (result?.ok && Number.isFinite(result.mean_speed_ms)) {
    value = {
      available: true,
      source: 'GLOBAL_WIND_ATLAS',
      mean_speed_ms: round2(result.mean_speed_ms),
      height_m: opts.height_m || 100,
      resolution_m: 250,
      confidence: 'moderate',
      confidence_note: 'Global Wind Atlas resolution (~250 m) is coarse relative to parcel scale — a regional baseline, not a parcel-specific reading.',
      source_url: 'https://globalwindatlas.info/',
    };
  } else {
    const fallbackSpeed = opts.wind_rose?.available ? opts.wind_rose.mean_speed_ms : null;
    value = fallbackSpeed != null
      ? {
        available: true,
        source: 'NASA_POWER_WIND_ROSE_FALLBACK',
        mean_speed_ms: round2(fallbackSpeed),
        height_m: 10, // NASA POWER WS10M — not directly comparable to a 100 m hub-height figure
        resolution_m: null,
        confidence: 'low',
        confidence_note: `Global Wind Atlas baseline unavailable (${result?.error || 'no response'}) — fell back to the site's own NASA POWER 10 m wind-rose mean speed as a regional proxy. This is not hub-height-corrected and should be treated as a rough placeholder until the atlas is reachable.`,
        source_url: 'https://power.larc.nasa.gov/',
      }
      : {
        available: false,
        error: result?.error || 'No Global Wind Atlas data and no wind-rose fallback available',
      };
  }

  cache.set(key, value);
  return value;
}

async function fetchGwaPoint(lat, lon, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), height: String(opts.height_m || 100) });
  const url = `${GWA_API_URL}?${params}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) return { ok: false, error: `Global Wind Atlas HTTP ${res.status}` };
    const data = await res.json();
    const meanSpeed = Number(data?.mean_wind_speed ?? data?.wind_speed_mean ?? data?.value ?? data?.WS);
    if (!Number.isFinite(meanSpeed)) return { ok: false, error: 'Global Wind Atlas response missing a recognizable mean-speed field' };
    return { ok: true, mean_speed_ms: meanSpeed };
  } finally {
    clearTimeout(timer);
  }
}

export function clearWindAtlasCache() { cache.clear(); }

function round2(v) { return Math.round(v * 100) / 100; }
