import test from 'node:test';
import assert from 'node:assert/strict';
import { getSoilData } from './soil-data.js';

const bbox = { west: -113.01, south: 51.495, east: -112.99, north: 51.505 };

/** soil-survey.js (which soil-data.js delegates to) calls the global
 * `fetch` directly with no injectable fetcher, so these tests patch
 * globalThis.fetch for the duration of each test rather than passing an
 * opts.fetch — restored in a `finally` so it never leaks between tests. */
function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => { globalThis.fetch = orig; });
}

test('getSoilData: real AGRASIS coverage at the sample grid → AGRASID source, no SoilGrids call needed for the decision', () => withFetch(
  async (url) => {
    const u = String(url);
    if (u.includes('AGRASIS_LandSystems')) {
      return ok({ features: [{ attributes: {
        LSLGDSYM: 'U1', NAME: 'Pope Lease', MORPHOL: 'Plain, well drained', SOIL_ZONE: 'Dark Brown',
        MAJOR1: 'Loam', MAJOR2: null, MAJOR3: null, MINOR1: null, MINOR2: null,
        SURFORM1: 'level', SURFORM2: null, SURFORM3: null, ORD1: null, ORD2: null, AG_CLIMATE: null, SCA: null,
      } }] });
    }
    if (u.includes('AGRASID/FeatureServer')) return ok({ features: [] });
    if (u.includes('rest.isric.org')) return ok({ properties: { layers: [] } }); // enrichment call — no data
    throw new Error(`unexpected url ${u}`);
  },
  async () => {
    const r = await getSoilData(bbox, {}, { skipCache: true, samples: 5 });
    assert.equal(r.soil_data_source, 'AGRASID');
    assert.equal(r.confidence, 'high');
    assert.equal(r.soil_units.length, 1);
    const unit = r.soil_units[0];
    assert.equal(unit.area_pct_of_parcel, 100);
    assert.equal(unit.soil_series, 'Pope Lease');
    assert.equal(unit.texture_class, 'loam');
    assert.equal(unit.drainage_class, 'well');
  }
));

test('getSoilData: no AGRASID/AGRASIS coverage anywhere on the grid → falls back to SoilGrids, drainage stays null', () => withFetch(
  async (url) => {
    const u = String(url);
    if (u.includes('AGRASIS_LandSystems') || u.includes('AGRASID/FeatureServer')) return ok({ features: [] });
    if (u.includes('rest.isric.org')) {
      return ok({ properties: { layers: [
        { name: 'clay', unit_measure: { d_factor: 10 }, depths: [{ values: { mean: 250 } }] },
        { name: 'sand', unit_measure: { d_factor: 10 }, depths: [{ values: { mean: 400 } }] },
        { name: 'silt', unit_measure: { d_factor: 10 }, depths: [{ values: { mean: 350 } }] },
        { name: 'phh2o', unit_measure: { d_factor: 10 }, depths: [{ values: { mean: 62 } }] },
        { name: 'soc', unit_measure: { d_factor: 10 }, depths: [{ values: { mean: 150 } }] },
      ] } });
    }
    throw new Error(`unexpected url ${u}`);
  },
  async () => {
    const r = await getSoilData(bbox, {}, { skipCache: true, samples: 5 });
    assert.equal(r.soil_data_source, 'SOILGRIDS_FALLBACK');
    assert.equal(r.confidence, 'moderate_low');
    assert.equal(r.soil_units.length, 1);
    const unit = r.soil_units[0];
    assert.equal(unit.drainage_class, null, 'drainage must not be inferred for the SoilGrids fallback');
    assert.equal(unit.soil_series, null);
    assert.ok(unit.texture_class, 'texture class should be derivable from sand/silt/clay');
    assert.ok(unit.ph > 0);
  }
));

test('getSoilData: total AGRASID+SoilGrids failure degrades to an explicit unavailable result, not a throw', () => withFetch(
  async () => { throw new Error('network down'); },
  async () => {
    const r = await getSoilData(bbox, {}, { skipCache: true, samples: 5 });
    assert.equal(r.soil_data_source, 'SOILGRIDS_FALLBACK');
    assert.equal(r.confidence, 'unavailable');
    assert.deepEqual(r.soil_units, []);
    assert.ok(r.error);
  }
));

function ok(body) { return { ok: true, json: async () => body }; }
