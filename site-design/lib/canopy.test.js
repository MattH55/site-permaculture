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

const { extractTrees, downsample, watershedBasins, classifyCanopyRenderZones } = _internal;

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

test('extractTrees: a tree in the north-west of the CHM lands in the north-west of the bbox', () => {
  // Regression: tree latitude was counted up from bbox.south while the CHM
  // grid is north-first, mirroring every tree north↔south.
  const chm = synthConeGrid(32, [{ r: 6, c: 6, rad: 4, h: 12 }]);
  const res = extractTrees(chm, bbox, {
    size: 32, window: 8, ring, data_source: 'SYNTH', source_info: null,
    confidence: 'moderate', parcel_area_m2: 200 * 200,
  });
  assert.ok(res.tree_count >= 1, 'should find the cone');
  const midLat = (bbox.north + bbox.south) / 2;
  const midLon = (bbox.east + bbox.west) / 2;
  const t = res.tree_instances.sort((a, b) => b.height_m - a.height_m)[0];
  assert.ok(t.x > midLat, `tree should be in the NORTH half (lat ${t.x} > ${midLat})`);
  assert.ok(t.y < midLon, `tree should be in the WEST half (lon ${t.y} < ${midLon})`);
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

test('classifyCanopyRenderZones: a solid canopy block classifies as billboard_impostor, a lone tree as instanced', () => {
  // 10x10 window grid: a dense 6x6 forest block plus one isolated canopy cell.
  const m = 10, n = 10;
  const cells = new Array(m * n).fill(0);
  for (let r = 1; r < 7; r++) for (let c = 1; c < 7; c++) cells[r * n + c] = 8;
  cells[8 * n + 8] = 6; // isolated single-window "tree"
  const zones = classifyCanopyRenderZones({ cells, m, n }, bbox);
  const dense = zones.filter((z) => z.render_mode === 'billboard_impostor');
  const instanced = zones.filter((z) => z.render_mode === 'instanced');
  assert.ok(dense.length >= 1, 'dense block should yield a billboard_impostor zone');
  assert.ok(instanced.length >= 1, 'isolated cell should yield an instanced zone');
  const denseZone = dense[0];
  assert.ok(denseZone.avg_canopy_height_m > 0);
  assert.ok(denseZone.canopy_cover_pct > 50, `expected high cover pct, got ${denseZone.canopy_cover_pct}`);
  assert.strictEqual(denseZone.geometry.type, 'Polygon');
  for (const z of zones) {
    // The zone must not span the whole grid — it's a merged region, not
    // "one giant polygon covering everything".
    const ring = z.geometry.coordinates[0];
    assert.ok(ring.length >= 4, 'polygon has a real boundary');
  }
});

test('classifyCanopyRenderZones: no canopy anywhere → no zones', () => {
  const m = 6, n = 6;
  const zones = classifyCanopyRenderZones({ cells: new Array(m * n).fill(0), m, n }, bbox);
  assert.strictEqual(zones.length, 0);
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

test('removeTreesOnBuildings drops CHM "trees" that are really roofs', async () => {
  const { removeTreesOnBuildings } = await import('./canopy.js');
  const lat0 = 53.55, lon0 = -113.45;
  const dLat = (m) => m / 111320, dLon = (m) => m / (111320 * Math.cos(lat0 * Math.PI / 180));
  const house = { geometry: { type: 'Polygon', coordinates: [[
    [lon0, lat0], [lon0 + dLon(12), lat0], [lon0 + dLon(12), lat0 + dLat(9)], [lon0, lat0 + dLat(9)], [lon0, lat0],
  ]] } };
  const onRoof = { x: lat0 + dLat(4.5), y: lon0 + dLon(6), height_m: 6 };
  const underEave = { x: lat0 + dLat(4.5), y: lon0 + dLon(12.8), height_m: 6 }; // 0.8 m outside the wall
  const yardTree = { x: lat0 + dLat(4.5), y: lon0 + dLon(25), height_m: 9 };   // 13 m away
  const r = removeTreesOnBuildings([onRoof, underEave, yardTree], [house]);
  assert.equal(r.removed, 2);
  assert.deepEqual(r.trees, [yardTree]);
  // Idempotent, and a no-op without footprints.
  assert.equal(removeTreesOnBuildings(r.trees, [house]).removed, 0);
  assert.equal(removeTreesOnBuildings([onRoof], []).removed, 0);
});

test('maskCanopyRoofs zeroes CHM under footprints and recomputes cover + zones', async () => {
  const { maskCanopyRoofs } = await import('./canopy.js');
  // 20×20 CHM over a ~200 m square; a 6 m "house" fills the north-west
  // quarter, a real 8 m tree clump sits in the south-east.
  const bbox = { west: -113.4515, south: 53.5491, east: -113.4485, north: 53.5509 };
  const rows = 20, cols = 20;
  const values = new Array(rows * cols).fill(0);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) values[r * cols + c] = 6;
  for (let r = 15; r < 18; r++) for (let c = 15; c < 18; c++) values[r * cols + c] = 8;
  const lonAt = (c) => bbox.west + (c / cols) * (bbox.east - bbox.west);
  const latAt = (r) => bbox.north - (r / rows) * (bbox.north - bbox.south);
  const house = { geometry: { type: 'Polygon', coordinates: [[
    [lonAt(0), latAt(0)], [lonAt(10), latAt(0)], [lonAt(10), latAt(10)], [lonAt(0), latAt(10)], [lonAt(0), latAt(0)],
  ]] } };
  const canopy = {
    available: true, bbox, canopy_cover_pct: 27,
    chm: { rows, cols, values_m: values },
    extraction: { window_cells: 20 }, // windows per side
    tree_instances: [
      { x: latAt(5), y: lonAt(5), height_m: 6 },      // roof peak
      { x: latAt(16.5), y: lonAt(16.5), height_m: 8 }, // real tree
    ],
    tree_count: 2,
  };
  const out = maskCanopyRoofs(canopy, [house], 0);
  assert.equal(out.tree_count, 1);
  assert.equal(out.roof_peaks_removed, 1);
  assert.equal(out.roof_cells_masked, 100);
  assert.equal(out.canopy_cover_pct, 2); // 9 tree cells of 400
  assert.equal(out.canopy_cover_pct_before_roof_mask, 27);
  assert.ok(out.render_zones.length >= 1);
  for (const z of out.render_zones) {
    for (const [lon, lat] of z.geometry.coordinates[0]) {
      assert.ok(lat < latAt(10) + 1e-9 || lon > lonAt(10) - 1e-9, 'no canopy zone left on the roof');
    }
  }
  assert.equal(canopy.chm.values_m[0], 6, 'input not mutated');
  // Idempotent.
  const again = maskCanopyRoofs(out, [house], 0);
  assert.equal(again.canopy_cover_pct, 2);
  assert.equal(again.tree_count, 1);
});
