import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSolarSuitability } from './suitability-solar.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function flatElevations(size = 9, base = 900) {
  return new Array(size * size).fill(base);
}

test('unavailable without a DEM grid', () => {
  const result = computeSolarSuitability({});
  assert.equal(result.available, false);
});

test('flat terrain produces a valid raster with no orientation bonus applied', () => {
  const size = 9;
  const result = computeSolarSuitability({
    elevations: flatElevations(size),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.5,
    longitude: -113.99,
    year: 2025,
    dem_confidence: 'high',
    gridSampleStride: 1,
  });
  assert.equal(result.available, true);
  assert.equal(result.suitability_type, 'solar');
  assert.ok(result.suitability_raster);
  assert.ok(result.suitability_raster.scores.every((s) => s == null || (s >= 0 && s <= 100)));
});

test('excludes cells inside a mapped water body', () => {
  const size = 9;
  const waterRing = [[-113.996, 53.006], [-113.994, 53.006], [-113.994, 53.004], [-113.996, 53.004], [-113.996, 53.006]];
  const result = computeSolarSuitability({
    elevations: flatElevations(size),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.5,
    longitude: -113.99,
    gridSampleStride: 1,
    surface_water: { water_bodies: [{ geometry: { type: 'Polygon', coordinates: [waterRing] } }] },
  });
  assert.ok(result.hard_exclusions_applied.includes('existing_water'));
});
