import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPondHydrology } from './pond-hydrology.js';

const base = {
  rows: 5,
  cols: 5,
  bbox: { west: -114, south: 53, east: -113.99, north: 53.01 },
  parcel_area_m2: 10_000,
  drainage_class: 'well',
  precipitation: { monthly_mm: { Jan: 30, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 } },
};

test('pond hydrology places the candidate at the centre of a DEM bowl', () => {
  const result = modelPondHydrology({
    ...base,
    elevations: [
      10, 10, 10, 10, 10,
      10, 8, 8, 8, 10,
      10, 8, 0, 8, 10,
      10, 8, 8, 8, 10,
      10, 10, 10, 10, 10,
    ],
  });

  assert.equal(result.available, true);
  assert.equal(result.placement.latitude, 53.005);
  assert.equal(result.placement.longitude, -113.995);
  assert.equal(result.placement.elevation_m, 0);
  assert.equal(result.tiers.length, 3);
  assert.equal(result.events_per_month, 3);
});

test('pond capture reports monthly and event water and caps each event at capacity', () => {
  const result = modelPondHydrology({
    ...base,
    precipitation: { monthly_mm: { Jan: 1200, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 } },
    elevations: [
      10, 10, 10, 10, 10,
      10, 8, 8, 8, 10,
      10, 8, 0, 8, 10,
      10, 8, 8, 8, 10,
      10, 10, 10, 10, 10,
    ],
  });
  const small = result.tiers[0];
  assert.equal(small.per_rain_event.Jan.captured_litres, 150_000);
  assert.equal(small.monthly.Jan.captured_litres, 450_000);
  assert.ok(small.monthly.Jan.gross_runoff_litres > small.monthly.Jan.captured_litres);
  assert.equal(small.annual_captured_litres, 450_000);
});