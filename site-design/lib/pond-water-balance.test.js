import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPondWaterBalance, rankPondCandidateZones } from './pond-water-balance.js';

const bowlElevations = [
  10, 10, 10, 10, 10,
  10, 8, 8, 8, 10,
  10, 8, 0, 8, 10,
  10, 8, 8, 8, 10,
  10, 10, 10, 10, 10,
];

const base = {
  rows: 5,
  cols: 5,
  bbox: { west: -114, south: 53, east: -113.99, north: 53.01 },
  elevations: bowlElevations,
  parcel_area_m2: 10_000,
  precipitation: { monthly_mm: { Jan: 10, Feb: 8, Mar: 15, Apr: 25, May: 45, Jun: 70, Jul: 65, Aug: 55, Sep: 35, Oct: 20, Nov: 12, Dec: 10 } },
  soil_data: { soil_data_source: 'AGRASID', confidence: 'high', soil_units: [{ texture_class: 'loam', drainage_class: 'well' }] },
  canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', canopy_cover_pct: 20 },
};

test('runs all three standard pond tiers by default', () => {
  const result = modelPondWaterBalance(base);
  assert.equal(result.available, true);
  assert.equal(result.tiers.length, 3);
  assert.deepEqual(result.tiers.map((t) => t.tier_id), ['small', 'medium', 'large']);
});

test('lined pond has zero seepage; unlined has positive seepage', () => {
  const lined = modelPondWaterBalance({ ...base, liner_assumption: 'lined' });
  const unlined = modelPondWaterBalance({ ...base, liner_assumption: 'unlined' });
  assert.equal(lined.tiers[0].annual_seepage_m3, 0);
  assert.ok(unlined.tiers[0].annual_seepage_m3 > 0);
});

test('custom surface area overrides the standard tiers', () => {
  const result = modelPondWaterBalance({ ...base, assumed_surface_area_m2: 500 });
  assert.equal(result.tiers.length, 1);
  assert.equal(result.tiers[0].assumed_surface_area_m2, 500);
});

test('sizing validation flags undersized ponds against a target use volume', () => {
  const result = modelPondWaterBalance({ ...base, target_use_volume_m3: 1_000_000 });
  assert.ok(['undersized', 'undersized_no_net_inflow'].includes(result.tiers[0].sizing_validation.flag));
});

test('monthly time series has all twelve months and reports design storm + dry period', () => {
  const result = modelPondWaterBalance(base);
  const tier = result.tiers[0];
  assert.equal(tier.monthly_level_time_series.length, 12);
  assert.ok(tier.design_storm_peak_inflow_m3 > 0);
  assert.ok(tier.dry_period_minimum_storage_m3 >= 0);
});

test('rankPondCandidateZones ranks candidates by net annual balance and flags a top pick', () => {
  const result = rankPondCandidateZones(base);
  assert.equal(result.available, true);
  assert.ok(result.candidate_zones.length >= 1);
  assert.equal(result.candidate_zones[0].top_pick, true);
  assert.equal(result.candidate_zones[0].rank, 1);
  for (let i = 1; i < result.candidate_zones.length; i++) {
    assert.ok(result.candidate_zones[i - 1].net_annual_balance_m3 >= result.candidate_zones[i].net_annual_balance_m3);
  }
});

test('rankPondCandidateZones folds in a distinct keyline keypoint as its own candidate', () => {
  const result = rankPondCandidateZones({
    ...base,
    keypoint: { lat: 53.009, lon: -113.991, elevation_m: 9 }, // far corner from the bowl's centre candidate
  });
  assert.ok(result.candidate_zones.some((c) => c.source === 'keyline_keypoint'));
});

test('rankPondCandidateZones reports unavailable with no DEM grid', () => {
  const result = rankPondCandidateZones({ precipitation: base.precipitation });
  assert.equal(result.available, false);
  assert.deepEqual(result.candidate_zones, []);
});
