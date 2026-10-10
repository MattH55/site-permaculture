import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInAnyPolygon, distanceToNearestFeatureM, polygonOuterRings, geometryLines } from './suitability-common.js';

const sq = (x0, y0, d) => [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]];
const poly = (ring) => ({ geometry: { type: 'Polygon', coordinates: [ring] } });
const stream = { geometry: { type: 'LineString', coordinates: [[-113.7145, 53.846], [-113.714, 53.847], [-113.7135, 53.848]] } };

test('a LineString (stream) among water features does not throw — regression for the failed-report crash', () => {
  // Previously coordinates[0] of the LineString (a single [lon,lat]) was
  // treated as a ring → "number … is not iterable" → whole /api/report 400.
  assert.doesNotThrow(() => pointInAnyPolygon(-113.714, 53.847, [stream]));
  assert.equal(pointInAnyPolygon(-113.714, 53.847, [stream]), false, 'a line has no inside');
});

test('points inside a Polygon or any part of a MultiPolygon are detected', () => {
  const a = sq(-113.72, 53.84, 0.001);
  const b = sq(-113.70, 53.84, 0.001);
  assert.equal(pointInAnyPolygon(-113.7195, 53.8405, [poly(a)]), true);
  const multi = { geometry: { type: 'MultiPolygon', coordinates: [[a], [b]] } };
  assert.equal(pointInAnyPolygon(-113.6995, 53.8405, [multi]), true, 'second polygon of a MultiPolygon');
  assert.equal(pointInAnyPolygon(-113.71, 53.8405, [multi]), false);
});

test('mixed water layer: polygon + stream + point + garbage all handled', () => {
  const feats = [poly(sq(-113.72, 53.84, 0.001)), stream, { geometry: { type: 'Point', coordinates: [-113.71, 53.85] } }, null, {}, { geometry: { type: 'Polygon', coordinates: [] } }];
  assert.equal(pointInAnyPolygon(-113.7195, 53.8405, feats), true);
  assert.ok(Number.isFinite(distanceToNearestFeatureM(53.846, -113.7145, feats)));
});

test('distance to a stream uses its vertices; to a MultiPolygon uses every ring', () => {
  assert.ok(distanceToNearestFeatureM(53.846, -113.7145, [stream]) < 1, 'on a stream vertex');
  const multi = { geometry: { type: 'MultiPolygon', coordinates: [[sq(-113.72, 53.84, 0.001)], [sq(-113.70, 53.84, 0.001)]] } };
  // Near the SECOND polygon only — previously MultiPolygons yielded NaN distances (never "near").
  assert.ok(distanceToNearestFeatureM(53.8400, -113.7000, [multi]) < 1);
});

test('helpers expose the right rings per geometry type', () => {
  assert.equal(polygonOuterRings(stream).length, 0);
  assert.equal(geometryLines(stream).length, 1);
  assert.equal(geometryLines({ geometry: { type: 'Point', coordinates: [1, 2] } }).length, 1);
  assert.equal(polygonOuterRings({ coordinates: [sq(0, 0, 1)] }).length, 1, 'untyped legacy shape still works');
});
