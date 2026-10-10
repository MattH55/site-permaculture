import test from 'node:test';
import assert from 'node:assert/strict';
import { overpassQuery, OVERPASS_USER_AGENT } from './overpass.js';

const ok = (body = { elements: [{ id: 1 }] }) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test('sends a User-Agent and data= form encoding (Overpass rejects anonymous requests)', async () => {
  let seen;
  const r = await overpassQuery('[out:json];way(1,2,3,4);out;', {
    fetchImpl: async (url, init) => { seen = init; return ok(); },
  });
  assert.equal(r.ok, true);
  assert.equal(seen.headers['User-Agent'], OVERPASS_USER_AGENT);
  assert.match(OVERPASS_USER_AGENT, /LandIntelligence/);
  assert.equal(seen.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(seen.body.startsWith('data='), 'query is sent as data=…');
  assert.equal(decodeURIComponent(seen.body.slice(5)), '[out:json];way(1,2,3,4);out;');
});

test('a 429 is retried once on the same endpoint before giving up on it', async () => {
  const calls = [];
  const r = await overpassQuery('q', {
    endpoints: ['https://a.example/api', 'https://b.example/api'],
    fetchImpl: async (url) => { calls.push(url); return calls.length === 1 ? fail(429) : ok(); },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['https://a.example/api', 'https://a.example/api']);
});

test('a non-retryable error falls through to the next endpoint', async () => {
  const calls = [];
  const r = await overpassQuery('q', {
    endpoints: ['https://a.example/api', 'https://b.example/api'],
    fetchImpl: async (url) => { calls.push(url); return url.includes('a.example') ? fail(406) : ok(); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.endpoint, 'https://b.example/api');
  assert.deepEqual(calls, ['https://a.example/api', 'https://b.example/api']);
});

test('never throws: all endpoints failing returns ok:false with the reasons', async () => {
  const r = await overpassQuery('q', {
    endpoints: ['https://a.example/api', 'https://b.example/api'],
    fetchImpl: async (url) => { if (url.includes('a.')) throw new Error('ECONNRESET'); return fail(500); },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /a\.example ECONNRESET/);
  assert.match(r.error, /b\.example HTTP 500/);
});

test('no more than 2 queries run concurrently (Overpass per-IP slot limit)', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 30));
    inFlight--;
    return ok();
  };
  const results = await Promise.all(Array.from({ length: 6 }, () => overpassQuery('q', { fetchImpl, endpoints: ['https://a.example/api'] })));
  assert.ok(results.every((r) => r.ok));
  assert.equal(peak, 2);
});

test('respects the overall deadline', async () => {
  const r = await overpassQuery('q', {
    deadlineMs: 300,
    timeoutMs: 10_000,
    endpoints: ['https://a.example/api'],
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /timeout|deadline/);
});

test('caches successful answers and serves them stale when every endpoint fails', async () => {
  const os = await import('node:os');
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const cacheDir = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'overpass-cache-'));
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, status: 200, json: async () => ({ elements: [{ id: 1 }] }) }; };
  const down = async () => { calls++; throw new Error('fetch failed'); };
  const q = '[out:json];way(1,2,3,4);out;';
  const first = await overpassQuery(q, { fetchImpl: ok, cacheDir, endpoints: ['https://a/api'] });
  assert.equal(first.endpoint, 'https://a/api');
  // Fresh cache: no network call at all.
  const second = await overpassQuery(q, { fetchImpl: down, cacheDir, endpoints: ['https://a/api'] });
  assert.equal(calls, 1);
  assert.deepEqual(second.data, { elements: [{ id: 1 }] });
  // Age the entry past "fresh": network is tried, fails, stale copy served.
  const f = fsm.readdirSync(cacheDir)[0];
  const entry = JSON.parse(fsm.readFileSync(pathm.join(cacheDir, f), 'utf8'));
  entry.cached_at -= 3 * 24 * 3600_000;
  fsm.writeFileSync(pathm.join(cacheDir, f), JSON.stringify(entry));
  const third = await overpassQuery(q, { fetchImpl: down, cacheDir, endpoints: ['https://a/api'] });
  assert.equal(third.ok, true);
  assert.equal(third.stale, true);
  assert.equal(calls, 2);
  fsm.rmSync(cacheDir, { recursive: true, force: true });
});
