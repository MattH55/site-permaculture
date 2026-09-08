import test from 'node:test';
import assert from 'node:assert/strict';
import { getStructureFootprints, clearStructureFootprintsCache } from './structures.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function fakeOverpassResponse(elements) {
  return { ok: true, json: async () => ({ elements }) };
}

test('returns unavailable for an invalid bbox', async () => {
  const result = await getStructureFootprints(null);
  assert.equal(result.available, false);
});

test('falls back to OSM-only when Microsoft footprints are not configured, no throw', async () => {
  clearStructureFootprintsCache();
  const osmWay = {
    type: 'way', id: 111,
    geometry: [{ lat: 53.005, lon: -113.995 }, { lat: 53.006, lon: -113.995 }, { lat: 53.006, lon: -113.994 }, { lat: 53.005, lon: -113.994 }],
    tags: { building: 'house' },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('overpass')) return fakeOverpassResponse([osmWay]);
    return { ok: false };
  };
  const result = await getStructureFootprints(bbox, { fetchImpl, force: true });
  assert.equal(result.available, true);
  assert.equal(result.footprints.length, 1);
  assert.equal(result.footprints[0].source, 'OSM');
  assert.equal(result.footprints[0].building_type_tag, 'house');
  assert.equal(result.data_source.microsoft, 'not_configured');
});

test('dedupes an OSM footprint that duplicates a Microsoft one, keeps a distinct one', async () => {
  clearStructureFootprintsCache();
  process.env.MS_BUILDING_FOOTPRINTS_URL = 'https://example.test/ms-footprints';
  try {
    const msFeature = {
      geometry: { type: 'Polygon', coordinates: [[[-113.995, 53.005], [-113.9945, 53.005], [-113.9945, 53.0055], [-113.995, 53.0055], [-113.995, 53.005]]] },
    };
    const dupOsmWay = { // centroid ~ same spot as msFeature
      type: 'way', id: 1,
      geometry: [{ lat: 53.005, lon: -113.995 }, { lat: 53.005, lon: -113.9945 }, { lat: 53.0055, lon: -113.9945 }, { lat: 53.0055, lon: -113.995 }],
      tags: { building: 'yes' },
    };
    const distinctOsmWay = { // far away — not a duplicate
      type: 'way', id: 2,
      geometry: [{ lat: 53.001, lon: -113.999 }, { lat: 53.0012, lon: -113.999 }, { lat: 53.0012, lon: -113.9988 }, { lat: 53.001, lon: -113.9988 }],
      tags: { building: 'barn' },
    };
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u.includes('ms-footprints')) return { ok: true, json: async () => ({ features: [msFeature] }) };
      if (u.includes('overpass')) return fakeOverpassResponse([dupOsmWay, distinctOsmWay]);
      return { ok: false };
    };
    const result = await getStructureFootprints(bbox, { fetchImpl, force: true });
    assert.equal(result.source_counts.microsoft, 1);
    assert.equal(result.source_counts.osm, 2);
    assert.equal(result.source_counts.duplicates_dropped, 1);
    assert.equal(result.footprints.length, 2); // 1 MS + 1 distinct OSM
    assert.ok(result.footprints.some((f) => f.source === 'MICROSOFT_FOOTPRINTS'));
    assert.ok(result.footprints.some((f) => f.building_type_tag === 'barn'));
  } finally {
    delete process.env.MS_BUILDING_FOOTPRINTS_URL;
  }
});
