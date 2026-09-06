import test from 'node:test';
import assert from 'node:assert';
import {
  sampleAbmiCanopyHeight,
  projectCovers,
  findLocalTile,
  PROJECTS,
  CACHE_DIR,
} from './abmi-lidar.js';

// A parcel inside Christina Lake's (reference) project bbox.
const inside = {
  west: -118.1,
  south: 55.7,
  east: -118.05,
  north: 55.75,
};

// A parcel far away (Edmonton).
const outside = {
  west: -113.7,
  south: 53.5,
  east: -113.65,
  north: 53.55,
};

test('ABMI is disabled: projectCovers always returns null', () => {
  assert.strictEqual(projectCovers(inside), null);
  assert.strictEqual(projectCovers(outside), null);
});

test('ABMI is disabled: sampleAbmiCanopyHeight always unavailable', async () => {
  for (const b of [inside, outside]) {
    const res = await sampleAbmiCanopyHeight(b);
    assert.strictEqual(res.available, false, 'must be unavailable');
    assert.strictEqual(res.reason, 'abmi_disabled');
    assert.ok(res.note?.includes('disabled'), 'note mentions disabled');
  }
});

test('ABMI is disabled: findLocalTile always returns null', () => {
  assert.strictEqual(findLocalTile({ id: 'christina_lake' }, inside), null);
  assert.strictEqual(findLocalTile({ id: 'christina_lake' }, outside), null);
});

test('PROJECTS retained as reference data (well-formed)', () => {
  assert.ok(Array.isArray(PROJECTS));
  assert.ok(PROJECTS.length >= 1);
  for (const p of PROJECTS) {
    assert.ok(p.id, 'id');
    assert.ok(p.name, 'name');
    assert.ok(p.bundle_url?.startsWith('https://'), 'bundle_url');
    assert.ok(p.metadata_url?.startsWith('https://'), 'metadata_url');
    assert.ok(p.bbox && p.bbox.west < p.bbox.east, 'bbox');
    assert.ok(p.bbox && p.bbox.south < p.bbox.north, 'bbox');
    assert.ok(p.crs, 'crs');
    assert.ok(p.resolution_m > 0, 'resolution_m');
  }
});

test('CACHE_DIR export is a string path', () => {
  assert.ok(typeof CACHE_DIR === 'string');
  assert.ok(CACHE_DIR.length > 0);
});
