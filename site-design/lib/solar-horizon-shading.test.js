import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSolarHorizonShading } from './solar-horizon-shading.js';

function flatGrid(size, z) {
  return new Array(size * size).fill(z);
}

const bbox = { west: -114.0, south: 53.0, east: -113.98, north: 53.02 };

test('reports insufficient confidence with no DEM grid', () => {
  const r = computeSolarHorizonShading({ latitude: 53, longitude: -114, bbox: null });
  assert.equal(r.available, false);
  assert.equal(r.confidence, 'insufficient');
});

test('always surfaces canopy_shading_assumption as worst_case_evergreen (no species data)', () => {
  const r = computeSolarHorizonShading({
    elevations: flatGrid(8, 500),
    rows: 8,
    cols: 8,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 2,
  });
  assert.equal(r.canopy_shading_assumption, 'worst_case_evergreen');
  assert.ok(r.canopy_shading_note);
});

test('flat terrain gives more winter sun than a point behind a ridge', () => {
  const size = 16;
  const elevations = flatGrid(size, 500);
  // Build a ridge along one row south of the mid-row, tall enough to block low-angle winter sun.
  for (let c = 0; c < size; c++) {
    elevations[(size - 2) * size + c] = 650;
  }
  const flatResult = computeSolarHorizonShading({
    elevations: flatGrid(size, 500),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  const shadedResult = computeSolarHorizonShading({
    elevations,
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  assert.ok(flatResult.available && shadedResult.available);
  assert.ok(Array.isArray(flatResult.solar_exposure_raster.winter_insolation_hours));
  const flatWinterAvg = avg(flatResult.solar_exposure_raster.winter_insolation_hours);
  const shadedWinterAvg = avg(shadedResult.solar_exposure_raster.winter_insolation_hours);
  assert.ok(shadedWinterAvg <= flatWinterAvg);
});

test('extracts top candidate zones with required output fields', () => {
  const size = 16;
  const r = computeSolarHorizonShading({
    elevations: flatGrid(size, 500),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  assert.ok(r.candidate_zones.length >= 1);
  const z = r.candidate_zones[0];
  assert.ok(z.geometry?.type === 'Polygon');
  assert.ok(typeof z.annual_insolation_hours === 'number');
  assert.ok(typeof z.winter_insolation_hours === 'number');
});

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
