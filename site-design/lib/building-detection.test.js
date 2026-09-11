import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBuildingDetection, _internal } from './building-detection.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function squareRing(clon, clat, halfDeg) {
  return [[clon - halfDeg, clat - halfDeg], [clon + halfDeg, clat - halfDeg], [clon + halfDeg, clat + halfDeg], [clon - halfDeg, clat + halfDeg], [clon - halfDeg, clat - halfDeg]];
}

test('unavailable with no footprints', () => {
  const result = computeBuildingDetection({ structures: { available: false, footprints: [] } });
  assert.equal(result.available, false);
});

test('tagged OSM building uses the tag directly, at "tagged" confidence', () => {
  const ring = squareRing(-113.995, 53.005, 0.0003);
  const structures = {
    available: true,
    data_source: { microsoft: 'not_configured', osm: 'OSM' },
    footprints: [{ footprint_id: 'osm-1', source: 'OSM', building_type_tag: 'barn', roof_shape_tag: 'gable', geometry: { type: 'Polygon', coordinates: [ring] }, centroid: { lat: 53.005, lon: -113.995 } }],
  };
  const result = computeBuildingDetection({ structures, bbox });
  assert.equal(result.available, true);
  assert.equal(result.buildings.length, 1);
  assert.equal(result.buildings[0].building_type, 'barn');
  assert.equal(result.buildings[0].type_confidence, 'tagged');
  assert.equal(result.buildings[0].render_mode_hint, 'asset');
});

test('untagged footprint infers a type from shape, flagged inferred', () => {
  const ring = squareRing(-113.995, 53.005, 0.00002); // small square footprint (~12 m²)
  const structures = {
    available: true,
    data_source: { microsoft: 'MICROSOFT_FOOTPRINTS', osm: 'OSM' },
    footprints: [{ footprint_id: 'ms-1', source: 'MICROSOFT_FOOTPRINTS', building_type_tag: null, geometry: { type: 'Polygon', coordinates: [ring] }, centroid: { lat: 53.005, lon: -113.995 } }],
  };
  const result = computeBuildingDetection({ structures, bbox });
  assert.equal(result.buildings[0].type_confidence, 'inferred');
  assert.equal(result.buildings[0].building_type, 'shed'); // small square footprint
  assert.equal(result.buildings[0].confidence.footprint, 'high'); // Microsoft source
});

test('height is sampled from the CHM raster at the footprint', () => {
  const ring = squareRing(-113.995, 53.005, 0.0003);
  const structures = {
    available: true,
    data_source: {},
    footprints: [{ footprint_id: 'ms-1', source: 'MICROSOFT_FOOTPRINTS', geometry: { type: 'Polygon', coordinates: [ring] }, centroid: { lat: 53.005, lon: -113.995 } }],
  };
  const size = 21;
  const values = new Array(size * size).fill(0.5);
  // Elevate a block near the footprint's centroid location in the CHM grid.
  for (let r = 8; r <= 12; r++) for (let c = 8; c <= 12; c++) values[r * size + c] = 6.2;
  const canopy = { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', chm: { rows: size, cols: size, values_m: values } };
  const result = computeBuildingDetection({ structures, bbox, canopy });
  assert.ok(result.buildings[0].height_m > 1); // picked up the elevated CHM block, not the 0.5m background
  assert.equal(result.buildings[0].confidence.height, 'high');
});

test('footprintShape: a long thin rectangle has a large aspect ratio', () => {
  const ring = [[-114, 53], [-113.999, 53], [-113.999, 53.0003], [-114, 53.0003], [-114, 53]];
  const { aspectRatio } = _internal.footprintShape(ring);
  assert.ok(aspectRatio > 2);
});

test('inferType buckets by area/aspect per the documented thresholds', () => {
  assert.equal(_internal.inferType(10, 1.2), 'shed');
  assert.equal(_internal.inferType(120, 1.3), 'house');
  assert.equal(_internal.inferType(200, 2.5), 'barn');
});

test('untagged house gets siding + asphalt, shed gets metal, barn gets metal roof', () => {
  assert.deepEqual(_internal.inferMaterials('shed', 12), { wall: 'metal', roof: 'metal' });
  assert.deepEqual(_internal.inferMaterials('barn', 200), { wall: 'siding', roof: 'metal' });
  assert.deepEqual(_internal.inferMaterials('house', 140), { wall: 'siding', roof: 'asphalt_shingle' });
});

test('OSM gable tag wins; otherwise rectangular + height variation → gable', () => {
  const ring = squareRing(-113.995, 53.005, 0.0003);
  assert.equal(_internal.inferRoofType(ring, 'gable', [4, 4, 4], 1.4), 'gable');
  assert.equal(_internal.inferRoofType(ring, 'flat', [4, 6, 8], 1.4), 'flat');
  assert.equal(_internal.inferRoofType(ring, null, [4, 4.1, 4.05, 3.95], 1.4), 'flat');
  assert.equal(_internal.inferRoofType(ring, null, [3, 5, 7, 6], 1.5), 'gable');
});

test('missing CHM height marks lod=box (degraded-data path)', () => {
  const ring = squareRing(-113.995, 53.005, 0.0003);
  const structures = {
    available: true,
    footprints: [{ footprint_id: 'ms-1', source: 'MICROSOFT_FOOTPRINTS', geometry: { type: 'Polygon', coordinates: [ring] }, centroid: { lat: 53.005, lon: -113.995 } }],
  };
  const result = computeBuildingDetection({ structures, bbox });
  assert.equal(result.buildings[0].lod, 'box');
  assert.equal(result.buildings[0].roof_type, 'flat');
  assert.ok(result.buildings[0].wall_material);
});

test('percentile 0.9 ignores a single spike', () => {
  const values = [4, 4.2, 4.1, 4.3, 4.0, 20];
  const p = _internal.percentile(values, 0.9);
  assert.ok(p < 20, `90th percentile should not be the spike, got ${p}`);
  assert.ok(p >= 4);
});
