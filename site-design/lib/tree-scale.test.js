import test from 'node:test';
import assert from 'node:assert/strict';
import { groundSceneScale, treeInstanceDimensions } from '../public/tree-scale.js';

test('groundSceneScale: a 10m-tall tree measures ~10m after scaling, on a small lot', () => {
  // ~110m-wide lot (0.001° lng at this latitude ≈ 111m * cos(lat))
  const bbox = { west: -113.501, south: 53.500, east: -113.500, north: 53.501 };
  const { metersPerSceneUnit } = groundSceneScale(bbox, 10);
  const { heightU, trunkH, canopyH } = treeInstanceDimensions({ height_m: 10, crown_radius_m: 3 }, metersPerSceneUnit);
  const measuredMeters = heightU * metersPerSceneUnit;
  assert.ok(Math.abs(measuredMeters - 10) < 1e-6, `expected ~10m, measured ${measuredMeters}m`);
  // Trunk + canopy stack back up to the full tree height (no gap/overlap).
  assert.ok(Math.abs(trunkH + canopyH - heightU) < 1e-9);
});

test('groundSceneScale: the same real tree renders far smaller (in scene units) on a huge parcel than a tiny one', () => {
  const tinyLot = { west: -113.5010, south: 53.5000, east: -113.5000, north: 53.5010 }; // ~110m
  const hugeParcel = { west: -114.5, south: 53.0, east: -113.5, north: 54.0 }; // ~70km
  const tiny = groundSceneScale(tinyLot, 10);
  const huge = groundSceneScale(hugeParcel, 10);
  const tree = { height_m: 12, crown_radius_m: 4 };
  const onTiny = treeInstanceDimensions(tree, tiny.metersPerSceneUnit);
  const onHuge = treeInstanceDimensions(tree, huge.metersPerSceneUnit);
  // Same real-world tree must occupy far fewer scene units on the huge
  // parcel — this is exactly the bug a fixed absolute scene-unit tree size
  // gets backwards (same size regardless of parcel scale).
  assert.ok(onHuge.heightU < onTiny.heightU / 100, 'huge-parcel tree should be a tiny fraction of scene size');
  // But both still measure the real 12m when converted back.
  assert.ok(Math.abs(onTiny.heightU * tiny.metersPerSceneUnit - 12) < 1e-6);
  assert.ok(Math.abs(onHuge.heightU * huge.metersPerSceneUnit - 12) < 1e-6);
});

test('treeInstanceDimensions: crown scales proportionally with height (no non-uniform stretch)', () => {
  const metersPerSceneUnit = 5;
  const short = treeInstanceDimensions({ height_m: 4, crown_radius_m: 1.5 }, metersPerSceneUnit);
  const tall = treeInstanceDimensions({ height_m: 8, crown_radius_m: 3 }, metersPerSceneUnit);
  // Doubling both real height and real crown radius should double both
  // scene-unit dimensions by the same factor.
  assert.ok(Math.abs(tall.heightU / short.heightU - 2) < 1e-9);
  assert.ok(Math.abs(tall.crownU / short.crownU - 2) < 1e-9);
});

test('treeInstanceDimensions: no double-scaling — dimensions scale linearly with metersPerSceneUnit only', () => {
  const tree = { height_m: 10, crown_radius_m: 3 };
  const a = treeInstanceDimensions(tree, 50);
  const b = treeInstanceDimensions(tree, 100);
  assert.ok(Math.abs(a.heightU / b.heightU - 2) < 1e-9, 'doubling metersPerSceneUnit should halve heightU, not compound');
});
