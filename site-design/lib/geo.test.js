import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid } from './geo.js';

const bbox = { west: -113.70, south: 53.80, east: -113.60, north: 53.90 };

test('sampleGrid is north-up: row 0 is bbox.north, last row is bbox.south', () => {
  const { lats, lngs, rows, cols } = sampleGrid(bbox, 49);
  assert.equal(lats.length, rows * cols);
  assert.equal(lats[0], bbox.north, 'first sample should sit on the north edge');
  assert.equal(lats[(rows - 1) * cols], bbox.south, 'last row should sit on the south edge');
  for (let r = 1; r < rows; r++) {
    assert.ok(lats[r * cols] < lats[(r - 1) * cols], `row ${r} must be south of row ${r - 1}`);
  }
});

test('sampleGrid runs west → east along a row with corners inclusive', () => {
  const { lngs, cols } = sampleGrid(bbox, 49);
  assert.equal(lngs[0], bbox.west);
  assert.equal(lngs[cols - 1], bbox.east);
  for (let c = 1; c < cols; c++) assert.ok(lngs[c] > lngs[c - 1]);
});

test('sampleGrid row/col ↔ lat/lon matches the consumers\' north - r/(rows-1) convention', () => {
  const { lats, lngs, rows, cols } = sampleGrid(bbox, 64);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const expectLat = bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south);
      const expectLng = bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west);
      assert.ok(Math.abs(lats[r * cols + c] - expectLat) < 1e-12);
      assert.ok(Math.abs(lngs[r * cols + c] - expectLng) < 1e-12);
    }
  }
});
