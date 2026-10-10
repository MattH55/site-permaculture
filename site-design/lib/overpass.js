/**
 * Shared OpenStreetMap Overpass client — every Overpass query in the pipeline
 * goes through here.
 *
 * Why it exists: the public Overpass servers reject anonymous requests. With
 * no User-Agent, overpass-api.de answers 406 Not Acceptable and the mirrors
 * answer 429 "Please include a meaningful User-Agent string". roads-layer.js,
 * structures.js, semantic-terrain.js and geo-overlays.js sent no User-Agent,
 * so on the live server buildings, roads and mapped features silently came
 * back empty (every failure path returned an empty layer), which emptied the
 * 3D map's buildings/roads and starved FireSmart and planting-area exclusions.
 *
 * It also enforces the servers' usage policy: overpass-api.de allows ~2
 * concurrent queries per IP, and one report fires half a dozen. Queries are
 * queued through a small concurrency limiter, and a 429 / 503 / 504 is
 * retried once with backoff before falling through to the next endpoint.
 *
 * Successful responses are cached on disk (data/cache/overpass/, keyed by a
 * hash of the query). A cached answer younger than CACHE_FRESH_MS is served
 * without touching the network; when every endpoint fails, an older one (up
 * to CACHE_STALE_MS) is served instead — the public Overpass servers have
 * whole-network outages, and an empty roads/buildings layer is worse for
 * the 3D map than week-old OSM data.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]);

export const OVERPASS_USER_AGENT =
  'LandIntelligenceSiteDesign/1.0 (permaculture site report; +https://site-permaculture.onrender.com)';

/** Concurrent Overpass requests allowed from this process (server allows ~2/IP). */
const MAX_CONCURRENT = 2;
const RETRYABLE = new Set([429, 503, 504]);

let active = 0;
const waiters = [];
function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve)).then(() => { active++; });
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

const CACHE_DIR = path.join(import.meta.dirname, '..', 'data', 'cache', 'overpass');
const CACHE_FRESH_MS = 24 * 3600_000;
const CACHE_STALE_MS = 30 * 24 * 3600_000;

function cacheFile(dir, query) {
  return path.join(dir, `${crypto.createHash('sha1').update(query).digest('hex')}.json`);
}
function readCache(dir, query) {
  try {
    const { cached_at, data } = JSON.parse(fs.readFileSync(cacheFile(dir, query), 'utf8'));
    return { ageMs: Date.now() - cached_at, data };
  } catch {
    return null;
  }
}
function writeCache(dir, query, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile(dir, query), JSON.stringify({ cached_at: Date.now(), data }));
  } catch (e) {
    console.warn('[overpass] cache write failed:', e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an Overpass QL query.
 *
 * @param {string} query Overpass QL (should request `[out:json]`)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=20000] per-attempt timeout
 * @param {number} [opts.deadlineMs] absolute ms budget across queueing,
 *   retries and endpoints — callers inside the report budget pass this
 * @param {Function} [opts.fetchImpl] injectable fetch (tests)
 * @param {string[]} [opts.endpoints]
 * @param {string|null} [opts.cacheDir] disk cache directory; null disables.
 *   Defaults to data/cache/overpass, or off when fetchImpl is injected.
 * @returns {Promise<{ok:true, data:object, endpoint:string, stale?:boolean} | {ok:false, error:string}>}
 *   Never throws — callers decide how to degrade.
 */
export async function overpassQuery(query, opts = {}) {
  const {
    timeoutMs = 20_000,
    deadlineMs = 45_000,
    fetchImpl = fetch,
    endpoints = OVERPASS_ENDPOINTS,
    cacheDir = opts.fetchImpl ? null : CACHE_DIR,
  } = opts;
  const cached = cacheDir ? readCache(cacheDir, query) : null;
  if (cached && cached.ageMs < CACHE_FRESH_MS) return { ok: true, data: cached.data, endpoint: 'cache' };
  const r = await queryNetwork(query, { timeoutMs, deadlineMs, fetchImpl, endpoints });
  if (r.ok) {
    if (cacheDir) writeCache(cacheDir, query, r.data);
    return r;
  }
  if (cached && cached.ageMs < CACHE_STALE_MS) {
    console.warn(`[overpass] serving ${Math.round(cached.ageMs / 3600_000)} h old cache — ${r.error}`);
    return { ok: true, data: cached.data, endpoint: 'cache', stale: true };
  }
  return r;
}

async function queryNetwork(query, { timeoutMs, deadlineMs, fetchImpl, endpoints }) {
  const started = Date.now();
  const left = () => deadlineMs - (Date.now() - started);
  const errors = [];

  await acquire();
  try {
    for (const endpoint of endpoints) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const budget = Math.min(timeoutMs, left());
        if (budget < 500) return { ok: false, error: `deadline exceeded (${errors.join('; ') || 'no attempt completed'})` };
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), budget);
        try {
          const res = await fetchImpl(endpoint, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            signal: ctrl.signal,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              'User-Agent': OVERPASS_USER_AGENT,
            },
          });
          if (res.ok) {
            const data = await res.json();
            return { ok: true, data, endpoint };
          }
          errors.push(`${hostOf(endpoint)} HTTP ${res.status}`);
          if (RETRYABLE.has(res.status) && attempt === 0 && left() > 3_000) {
            await sleep(1_200 + Math.random() * 800);
            continue;
          }
          break; // non-retryable (or second failure) → next endpoint
        } catch (e) {
          errors.push(`${hostOf(endpoint)} ${e?.name === 'AbortError' ? 'timeout' : (e?.message || 'error')}`);
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    return { ok: false, error: errors.join('; ') || 'no endpoints' };
  } finally {
    release();
  }
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}
