import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWindSuitability } from './suitability-wind.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function flatElevations(size = 9, base = 900) {
  return new Array(size * size).fill(base);
}

const windAtlas = { available: true, source: 'GLOBAL_WIND_ATLAS', mean_speed_ms: 6, confidence: 'moderate' };
const windRose = { available: true, primary_direction: 'W', primary_frequency_pct: 40, secondary_direction: 'NW', secondary_frequency_pct: 15, source: 'NASA POWER' };

test('unavailable without a DEM grid', () => {
  const result = computeWindSuitability({ wind_atlas: windAtlas, wind_rose: windRose });
  assert.equal(result.available, false);
});

test('unavailable without a wind-atlas baseline', () => {
  const size = 9;
  const result = computeWindSuitability({ elevations: flatElevations(size), rows: size, cols: size, bbox, wind_rose: windRose });
  assert.equal(result.available, false);
});

test('flat terrain scores everywhere, no NaNs, bands within range', () => {
  const size = 9;
  const result = computeWindSuitability({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    wind_atlas: windAtlas, wind_rose: windRose, gridSampleStride: 1,
  });
  assert.equal(result.available, true);
  assert.equal(result.suitability_type, 'wind');
  assert.ok(result.suitability_raster.scores.every((s) => s == null || (s >= 0 && s <= 100)));
  assert.ok(result.prevailing_sectors.length > 0);
});

test('a tall obstruction hard-excludes cells within its clearance radius', () => {
  const size = 9;
  const local = (r, c) => [
    bbox.west + (c / (size - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (size - 1)) * (bbox.north - bbox.south),
  ];
  const [lon, lat] = local(4, 4);
  const result = computeWindSuitability({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    wind_atlas: windAtlas, wind_rose: windRose, gridSampleStride: 1,
    canopy: { available: true, tree_instances: [{ x: lat, y: lon, height_m: 20 }] },
  });
  assert.ok(result.hard_exclusions_applied.includes('obstruction_clearance_zone'));
});

test('setback placeholder excludes points near a dwelling', () => {
  const size = 9;
  const local = (r, c) => [
    bbox.west + (c / (size - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (size - 1)) * (bbox.north - bbox.south),
  ];
  const [lon, lat] = local(4, 4);
  const result = computeWindSuitability({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    wind_atlas: windAtlas, wind_rose: windRose, gridSampleStride: 1,
    dwellings: [{ lat, lon }],
  });
  assert.ok(result.hard_exclusions_applied.includes('setback_violation'));
  assert.equal(result.thresholds.boundary_setback_is_placeholder, true);
});
