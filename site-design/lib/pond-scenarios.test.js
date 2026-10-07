import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPondScenarios, PRECIP_SCENARIOS } from './pond-scenarios.js';

const BASE = {
  pond_point: { lat: 53.5, lon: -113.5 },
  catchment_area_m2: 12_000,
  precipitation: { mean_annual_mm: 450 },
  soil_data: { soil_units: [{ texture_class: 'clay_loam' }], soil_data_source: 'AGRASID' },
  canopy: { available: true, canopy_cover_pct: 20 },
};

const scenario = (tier, id) => tier.scenarios.find((s) => s.scenario_id === id);

test('runs every scenario for every standard tier, 36 monthly rows each', () => {
  const r = modelPondScenarios(BASE);
  assert.equal(r.available, true);
  assert.equal(r.tiers.length, 3);
  for (const t of r.tiers) {
    assert.equal(t.scenarios.length, PRECIP_SCENARIOS.length);
    for (const s of t.scenarios) assert.equal(s.monthly.length, 36);
  }
});

test('no precipitation normals → unavailable rather than a fabricated answer', () => {
  const r = modelPondScenarios({ ...BASE, precipitation: null });
  assert.equal(r.available, false);
});

test('snowpack: no inflow in sub-zero months, a melt pulse in the first thaw month', () => {
  const temperature = {
    available: true,
    monthly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((month, i) => ({ month, avg_mean: [-12, -10, -4, 4, 11, 15, 17, 16, 11, 5, -4, -10][i] })),
  };
  const r = modelPondScenarios({ ...BASE, temperature });
  assert.deepEqual(r.snow_months.sort(), ['Dec', 'Feb', 'Jan', 'Mar', 'Nov'].sort());
  const rows = scenario(r.tiers[1], 'normal').monthly.filter((m) => m.year === 1);
  const byMonth = Object.fromEntries(rows.map((m) => [m.month, m]));
  for (const m of ['Jan', 'Feb', 'Mar', 'Nov', 'Dec']) assert.equal(byMonth[m].inflow_m3, 0, `${m} should accumulate snow, not run off`);
  // April gets the melt pulse on top of its own rain, so it out-flows May
  // even though May has more rain.
  assert.ok(byMonth.Apr.inflow_m3 > byMonth.May.inflow_m3, 'spring melt should dominate April inflow');
});

test('drier scenarios never yield more water than wetter ones', () => {
  const r = modelPondScenarios({ ...BASE, catchment_area_m2: 4_000 });
  for (const t of r.tiers) {
    const wet = scenario(t, 'wet');
    const normal = scenario(t, 'normal');
    const drought = scenario(t, 'multi_year_drought');
    assert.ok(wet.sustainable_growing_season_draw_m3_per_month >= normal.sustainable_growing_season_draw_m3_per_month - 0.5);
    assert.ok(normal.sustainable_growing_season_draw_m3_per_month >= drought.sustainable_growing_season_draw_m3_per_month - 0.5);
    assert.ok(normal.min_storage_m3 >= drought.min_storage_m3);
  }
});

test('a lined pond is never worse than the same pond unlined', () => {
  const unlined = modelPondScenarios({ ...BASE, catchment_area_m2: 3_000, soil_data: { soil_units: [{ texture_class: 'loam' }] } });
  const lined = modelPondScenarios({ ...BASE, catchment_area_m2: 3_000, soil_data: { soil_units: [{ texture_class: 'loam' }] }, liner_assumption: 'lined' });
  for (let i = 0; i < 3; i++) {
    const u = scenario(unlined.tiers[i], 'multi_year_drought');
    const l = scenario(lined.tiers[i], 'multi_year_drought');
    assert.ok(l.min_storage_m3 >= u.min_storage_m3);
    assert.ok(l.months_empty <= u.months_empty);
  }
});

test('reported supportable herd is actually supportable in that scenario', () => {
  const wetter = { ...BASE, catchment_area_m2: 40_000 };
  const r = modelPondScenarios(wetter);
  const t = r.tiers[1];
  const herd = scenario(t, 'multi_year_drought').supportable_cattle_head;
  assert.ok(herd > 0, 'test fixture should support some cattle');
  const check = modelPondScenarios({ ...wetter, demand: { cattle_head: herd } });
  const s = scenario(check.tiers[1], 'multi_year_drought');
  assert.equal(s.months_empty, 0);
  assert.equal(s.demand_reliability_pct, 100);
});

test('more demand → lower or equal reliability', () => {
  const small = modelPondScenarios({ ...BASE, catchment_area_m2: 4_000, demand: { cattle_head: 5 } });
  const big = modelPondScenarios({ ...BASE, catchment_area_m2: 4_000, demand: { cattle_head: 60, garden_m2: 2_000 } });
  const a = scenario(small.tiers[0], 'severe_drought').demand_reliability_pct;
  const b = scenario(big.tiers[0], 'severe_drought').demand_reliability_pct;
  assert.ok(b <= a);
});

test('storage never exceeds capacity or goes negative', () => {
  const r = modelPondScenarios({ ...BASE, catchment_area_m2: 50_000 });
  for (const t of r.tiers) {
    for (const s of t.scenarios) {
      for (const m of s.monthly) {
        assert.ok(m.storage_m3 >= 0);
        assert.ok(m.storage_m3 <= t.capacity_m3 + 0.1);
      }
    }
  }
});

test('recommendation names a tier and says whether it survives the multi-year drought', () => {
  const r = modelPondScenarios(BASE);
  assert.ok(['small', 'medium', 'large'].includes(r.recommendation.tier_id));
  assert.equal(typeof r.recommendation.drought_resilient, 'boolean');
  assert.ok(r.recommendation.reason.length > 20);
});

test('unknown soil texture → glacial-till pond-bed default, not the leaky loam fallback', () => {
  const r = modelPondScenarios({ ...BASE, soil_data: null });
  assert.equal(r.seepage_mm_day, 2);
  assert.match(r.seepage_basis, /glacial till/);
});

test('subsoil texture (pond-bed depth) wins over surface texture', () => {
  const r = modelPondScenarios({
    ...BASE,
    soil_data: { soil_units: [{ texture_class: 'sandy_loam' }] },
    soil_profile: { subsoil_30cm_plus: { texture: 'clay' } },
  });
  assert.equal(r.seepage_mm_day, 1);
  assert.match(r.seepage_basis, /subsoil/);
});

test('a near-zero-mean month (e.g. -0.2 °C April) is a melt month, not a snow month', () => {
  const temps = [-10, -9, -8, -0.2, 12, 14, 18, 16, 12, 6, -3, -16];
  const temperature = { available: true, monthly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, i) => ({ month, avg_mean: temps[i] })) };
  const r = modelPondScenarios({ ...BASE, temperature });
  assert.ok(!r.snow_months.includes('Apr'));
  assert.ok(r.snow_months.includes('Mar'));
});

test('unlined tiers report what a liner would buy in a multi-year drought', () => {
  const r = modelPondScenarios({ ...BASE, catchment_area_m2: 3_000, soil_data: { soil_units: [{ texture_class: 'loam' }] } });
  for (const t of r.tiers) {
    assert.ok(t.if_lined, 'if_lined present');
    const unlined = t.scenarios.find((s) => s.scenario_id === 'multi_year_drought');
    assert.ok(t.if_lined.months_empty <= unlined.months_empty);
    assert.ok(t.annual_seepage_m3 > 0);
  }
  const lined = modelPondScenarios({ ...BASE, liner_assumption: 'lined' });
  assert.equal(lined.tiers[0].if_lined, null);
});
