import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LOD_DISTANCES,
  lodHysteresisBand,
  selectLodByDistance,
  withinDrawDistance,
} from './vegetation-lod.js';

test('default LOD distances match the spec §6 starting values', () => {
  assert.equal(DEFAULT_LOD_DISTANCES.highMaxM, 50);
  assert.equal(DEFAULT_LOD_DISTANCES.mediumMaxM, 200);
  assert.ok(Object.isFrozen(DEFAULT_LOD_DISTANCES), 'thresholds must not be mutable globals');
});

test('selectLodByDistance picks the tier for each spec §6 band', () => {
  assert.equal(selectLodByDistance(0), 'high');
  assert.equal(selectLodByDistance(25), 'high');
  assert.equal(selectLodByDistance(50), 'high', 'threshold is inclusive');
  assert.equal(selectLodByDistance(50.1), 'medium');
  assert.equal(selectLodByDistance(120), 'medium');
  assert.equal(selectLodByDistance(200), 'medium', 'threshold is inclusive');
  assert.equal(selectLodByDistance(200.1), 'low');
  assert.equal(selectLodByDistance(5000), 'low');
});

test('selectLodByDistance degrades to "low" for a non-finite distance rather than throwing', () => {
  assert.equal(selectLodByDistance(NaN), 'low');
  assert.equal(selectLodByDistance(undefined), 'low');
  assert.equal(selectLodByDistance(Infinity), 'low');
});

test('selectLodByDistance accepts custom thresholds for empirical tuning', () => {
  const thresholds = { highMaxM: 10, mediumMaxM: 40 };
  assert.equal(selectLodByDistance(5, thresholds), 'high');
  assert.equal(selectLodByDistance(30, thresholds), 'medium');
  assert.equal(selectLodByDistance(60, thresholds), 'low');
});

test('selectLodByDistance ignores a nonsensical custom threshold', () => {
  // mediumMax must exceed highMax; a broken override falls back to the default
  // rather than inverting the bands and hiding every tree.
  const broken = { highMaxM: 50, mediumMaxM: 10 };
  assert.equal(selectLodByDistance(120, broken), 'medium');
});

test('lodHysteresisBand agrees with selectLodByDistance at the band centre', () => {
  for (const d of [0, 25, 50, 100, 200, 1000]) {
    assert.equal(
      lodHysteresisBand(d).lod,
      selectLodByDistance(d),
      `disagreement at ${d} m`,
    );
  }
});

test('lodHysteresisBand widens each tier by the dead-band margin', () => {
  const margin = 5;
  const high = lodHysteresisBand(30, margin);
  assert.equal(high.lod, 'high');
  // A tree stays 'high' until it is 5 m past the 50 m threshold.
  assert.equal(high.stableAfterM, 55);

  const medium = lodHysteresisBand(100, margin);
  assert.equal(medium.lod, 'medium');
  assert.equal(medium.stableBeforeM, 45, 'overlaps the high band by the margin');
  assert.equal(medium.stableAfterM, 205);

  const low = lodHysteresisBand(1000, margin);
  assert.equal(low.lod, 'low');
  assert.equal(low.stableBeforeM, 195);
  assert.equal(low.stableAfterM, Infinity);
});

test('lodHysteresisBand produces overlapping bands — the point of hysteresis', () => {
  // If the bands did not overlap there would be nothing to be stable *about*.
  const atThreshold = lodHysteresisBand(50, 5);
  assert.ok(atThreshold.stableBeforeM <= 50 && atThreshold.stableAfterM >= 50);
  const mediumAtThreshold = lodHysteresisBand(200, 5);
  assert.ok(mediumAtThreshold.stableBeforeM <= 200 && mediumAtThreshold.stableAfterM >= 200);
});

test('lodHysteresisBand tolerates a zero margin and a bad margin', () => {
  assert.equal(lodHysteresisBand(30, 0).stableAfterM, 50);
  assert.equal(lodHysteresisBand(30, -10).stableAfterM, 50, 'negative margin clamps to 0');
  assert.equal(lodHysteresisBand(30, NaN).stableAfterM, 50);
});

test('lodHysteresisBand returns an eternal low band for a non-finite distance', () => {
  const band = lodHysteresisBand(NaN);
  assert.equal(band.lod, 'low');
  assert.equal(band.stableBeforeM, Infinity);
});

test('withinDrawDistance culls only beyond the max draw distance', () => {
  assert.equal(withinDrawDistance(0, 1000), true);
  assert.equal(withinDrawDistance(1000, 1000), true, 'boundary is inclusive');
  assert.equal(withinDrawDistance(1000.1, 1000), false);
});

test('withinDrawDistance never culls when disabled', () => {
  for (const max of [Infinity, undefined, NaN, null]) {
    assert.equal(withinDrawDistance(999999, max), true, `max=${max} should disable culling`);
  }
});

test('withinDrawDistance keeps a tree with an unknown distance', () => {
  // Distance may be unknown before the first camera update; dropping the tree
  // would make it blink out of existence rather than simply be drawn.
  assert.equal(withinDrawDistance(NaN, 100), true);
  assert.equal(withinDrawDistance(undefined, 100), true);
});

