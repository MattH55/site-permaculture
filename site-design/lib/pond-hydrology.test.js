import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPondHydrology, findPondCandidateZones } from './pond-hydrology.js';

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

// 11x11 terrain with two separate bowls (low points far apart) — exercises
// the top-N + minimum-separation logic in findPondCandidateZones rather
// than a single-bowl grid where every high-scoring cell clusters together.
function twoBowlElevations() {
  const size = 11;
  const bowlA = { r: 2, c: 2 };
  const bowlB = { r: 8, c: 8 };
  const z = new Array(size * size).fill(10);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dA = Math.hypot(r - bowlA.r, c - bowlA.c);
      const dB = Math.hypot(r - bowlB.r, c - bowlB.c);
      const d = Math.min(dA, dB);
      z[r * size + c] = d < 3 ? d : 10;
    }
  }
  return { size, z };
}

test('findPondCandidateZones returns well-separated candidates, not a cluster around one bowl', () => {
  const { size, z } = twoBowlElevations();
  const result = findPondCandidateZones({
    rows: size,
    cols: size,
    bbox: { west: -114, south: 53, east: -113.9, north: 53.1 },
    elevations: z,
    parcel_area_m2: 40_000,
  }, { topN: 6, minSeparationCells: 3 });

  assert.equal(result.available, true);
  assert.ok(result.candidates.length >= 2);
  // No two returned candidates should be within the minimum separation —
  // re-derive grid row/col from lat/lon to check.
  const toRC = (cand) => ({
    r: Math.round(((53.1 - cand.latitude) / (53.1 - 53)) * (size - 1)),
    c: Math.round(((cand.longitude - -114) / (-113.9 - -114)) * (size - 1)),
  });
  const rcs = result.candidates.map(toRC);
  for (let i = 0; i < rcs.length; i++) {
    for (let j = i + 1; j < rcs.length; j++) {
      assert.ok(Math.hypot(rcs[i].r - rcs[j].r, rcs[i].c - rcs[j].c) >= 3);
    }
  }
});

test('findPondCandidateZones reports unavailable with no DEM grid', () => {
  const result = findPondCandidateZones({});
  assert.equal(result.available, false);
  assert.deepEqual(result.candidates, []);
});