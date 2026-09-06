import test from 'node:test';
import assert from 'node:assert';
import {
  buildCanopyLayer,
  canopyConfidence,
  canopySourceNote,
  abmiCovers,
  SOURCE_CONFIDENCE,
  _internal,
} from './canopy.js';

const { extractTrees, downsample, watershedBasins } = _internal;

const bbox = { west: -113.4515, north: 53.5509, east: -113.4485, south: 53.5491 };
const ring = [
  [-113.4515, 53.5491],
  [-113.4485, 53.5491],
  [-113.4485, 53.5509],
  [-113.4515, 53.5509],
  [-113.4515, 53.5491],
];

/** Build a synthetic CHM with n well-separated cones. */
function synthConeGrid(size, cones) {
  const elev = new Array(size * size).fill(0);
  for (const { r, c, rad, h } of cones) {
    for (let rr = 0; rr < size; rr++) {
      for (let cc = 0; cc < size; cc++) {
        const d = Math.hypot(rr - r, cc - c);
        if (d < rad) elev[rr * size + cc] = Math.max(elev[rr * size + cc], h * (1 - d / rad));
      }
    }
  }
  return {
    rows: size,
    cols: size,
    elevations_m: elev,
    chm_min_m: 0,
    chm_max_m: Math.max(...cones.map((c) => c.h)),
    chm_mean_m: 2,
    resolution_m: 1,
  };
}

test('confidence mapping: NRCAN_HRDEM → high', () => {
  assert.strictEqual(canopyConfidence('NRCAN_HRDEM'), 'high');
  assert.strictEqual(SOURCE_CONFIDENCE.NRCAN_HRDEM, 'high');
});

test('confidence mapping: GEE_GLOBAL_CANOPY_FALLBACK → moderate', () => {
  assert.strictEqual(canopyConfidence('GEE_GLOBAL_CANOPY_FALLBACK'), 'moderate');
});

test('confidence mapping: unknown / null → low', () => {
  assert.strictEqual(canopyConfidence(null), 'low');
  assert.strictEqual(canopyConfidence(''), 'low');
});

test('source note: GEE fallback mentions global remote-sensing', () => {
  const note = canopySourceNote('GEE_GLOBAL_CANOPY_FALLBACK');
  assert.ok(note.includes('global remote-sensing'), note);
});

test('source note: HRDEM mentions DSM', () => {
  const note = canopySourceNote('NRCAN_HRDEM');
  assert.ok(note.includes('DSM'), note);
});

test('abmiCovers always returns false (disabled)', () => {
  assert.strictEqual(abmiCovers(bbox), false);
  assert.strictEqual(abmiCovers({ west: 0, south: 0, east: 1, north: 1 }), false);
});

test('extractTrees: 3 synthetic cones → ≥2 instances with sane fields', () => {
  const chm = synthConeGrid(32, [
    { r: 8, c: 8, rad: 5, h: 10 },
    { r: 8, c: 24, rad: 4, h: 7 },
    { r: 24, c: 16, rad: 6, h: 13 },
  ]);
  const res = extractTrees(chm, bbox, {
    size: 32,
    window: 8,
    ring,
    data_source: 'SYNTH',
    source_info: null,
    confidence: 'moderate',
    parcel_area_m2: 200 * 200,
  });
  assert.ok(res.available);
  assert.ok(res.tree_count >= 2, `expected ≥2 trees, got ${res.tree_count}`);
  assert.ok(res.tree_count <= 10, `expected ≤10 trees, got ${res.tree_count}`);
  for (const t of res.tree_instances) {
    assert.ok(typeof t.x === 'number', 'x is number');
    assert.ok(typeof t.y === 'number', 'y is number');
    assert.ok(t.height_m >= 0.75, 'height above threshold');
    assert.ok(t.crown_radius_m > 0, 'crown radius positive');
    assert.strictEqual(t.data_source, 'SYNTH', 'data_source propagated');
    assert.ok(t.x >= 53.5491 && t.x <= 53.5509, `lat in range: ${t.x}`);
    assert.ok(t.y >= -113.4515 && t.y <= -113.4485, `lng in range: ${t.y}`);
  }
});

test('extractTrees: flat CHM (no peaks) → 0 trees', () => {
  const chm = {
    rows: 32,
    cols: 32,
    elevations_m: new Array(32 * 32).fill(0.5),
    chm_min_m: 0.5,
    chm_max_m: 0.5,
    chm_mean_m: 0.5,
    resolution_m: 1,
  };
  const res = extractTrees(chm, bbox, {
    size: 32,
    window: 8,
    ring,
    data_source: 'SYNTH',
    source_info: null,
    confidence: 'moderate',
    parcel_area_m2: 200 * 200,
  });
  assert.ok(res.available);
  assert.strictEqual(res.tree_count, 0, 'flat CHM yields no trees');
});

test('buildCanopyLayer: invalid bbox → unavailable', async () => {
  const res = await buildCanopyLayer({});
  assert.strictEqual(res.available, false);
  assert.strictEqual(res.error, 'invalid_bbox');
});

test('downsample: shape + values preserved', () => {
  const elev = new Array(16 * 16).fill(5);
  const g = downsample(elev, 16, 16, 4);
  assert.strictEqual(g.m, 4);
  assert.strictEqual(g.n, 4);
  assert.strictEqual(g.cells.length, 16);
  for (const v of g.cells) assert.strictEqual(v, 5);
});

test('watershedBasins: returns an array with well-formed basins', () => {
  const inv = new Float64Array(8 * 8).fill(10);
  inv[2 * 8 + 2] = 5; // a clear local minimum (== peak)
  const basins = watershedBasins(inv, 8, 8, 3);
  assert.ok(Array.isArray(basins));
  for (const b of basins) {
    assert.ok(b.area >= 1);
    assert.ok(Number.isFinite(b.minInv));
    assert.ok(Array.isArray(b.centroid) && b.centroid.length === 2);
  }
});
