import test from 'node:test';
import assert from 'node:assert/strict';
import { getSurfaceWaterLayer } from './surface-water.js';

const bbox = { west: -113.51, south: 53.50, east: -113.50, north: 53.51 };

test('surface water prefers live, current AltaLIS coverage and retains WAM separately', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('MapServer?f=json')) return ok({ documentInfo: { ModifiedDate: new Date().toISOString() } });
    if (String(url).includes('/2/query')) return ok({ count: 1 });
    if (String(url).includes('/9/query')) return ok({ features: [{ properties: { FEATURE_TYPE: 'Lake', NAME: 'Test Lake' }, geometry: { type: 'Polygon', coordinates: [[[-113.506, 53.503], [-113.504, 53.503], [-113.504, 53.505], [-113.506, 53.503]]] } }] });
    if (String(url).includes('/11/query')) return ok({ features: [{ properties: { FEATURE_TYPE: 'Perennial Stream' }, geometry: { type: 'LineString', coordinates: [[-113.509, 53.501], [-113.501, 53.509]] } }] });
    throw new Error(`unexpected URL ${url}`);
  };
  const out = await getSurfaceWaterLayer(bbox, {
    fetch: fakeFetch,
    skipCache: true,
    fetchPredictedStreams: async () => ({ available: true, features: [{ geometry: { type: 'LineString', coordinates: [[-113.5, 53.5], [-113.499, 53.501]] } }] }),
  });
  assert.equal(out.data_source, 'ALTALIS_WATER_BODIES');
  assert.equal(out.water_bodies.length, 2);
  assert.equal(out.water_bodies[0].type, 'lake');
  assert.equal(out.predicted_streams[0].data_source, 'WAM');
  assert.ok(out.distance_to_nearest_water_m >= 0);
  assert.ok(out.water_bodies[0].local_geometry.coordinates.length);
  assert.ok(calls.some((u) => u.includes('/2/query')));
});

function ok(body) { return { ok: true, json: async () => body }; }
