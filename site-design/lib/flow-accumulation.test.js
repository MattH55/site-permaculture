import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlowAccumulation } from './flow-accumulation.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

/** A 9x9 V-shaped valley running north-south through column 4, descending southward. */
function valleyElevations(size = 9) {
  const z = new Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      z[r * size + c] = r * 10 + Math.abs(c - 4) * 3;
    }
  }
  return z;
}

test('returns unavailable for an incomplete grid', () => {
  const result = computeFlowAccumulation({ elevations: [1, 2, 3], rows: 2, cols: 2, bbox });
  assert.equal(result.available, false);
});

test('flow converges toward the valley thalweg, accumulating more than off-axis cells', () => {
  const size = 9;
  const result = computeFlowAccumulation({ elevations: valleyElevations(size), rows: size, cols: size, bbox });
  assert.equal(result.available, true);

  const thalweg = result.accumulation_cells[7 * size + 4];
  const offAxis = result.accumulation_cells[1 * size + 1];
  assert.ok(thalweg > offAxis, `expected thalweg accumulation (${thalweg}) > off-axis (${offAxis})`);
  assert.ok(result.contributing_area_m2[7 * size + 4] > result.cellAreaM2);
});

test('slope_percent is zero or positive everywhere it is defined', () => {
  const size = 7;
  const result = computeFlowAccumulation({ elevations: valleyElevations(size), rows: size, cols: size, bbox });
  for (const s of result.slope_percent) {
    if (s != null) assert.ok(s >= 0);
  }
});
