import test from 'node:test';
import assert from 'node:assert/strict';
import { sunNeed, scorePlantInZone, matchPlantsToZones } from './plant-zone-match.js';

const zone = (overrides = {}) => ({
  area_m2: 500,
  frost_risk_level: 'low',
  site_condition_profile: {
    soil: { texture: 'loam', ph: 6.8, drainage: 'well' },
    growing_season_sun_hours: 9,
    slope_pct: 3,
    distance_to_water_m: 300,
    ...overrides.scp,
  },
  ...overrides.zone,
});

const SUNNY = zone();
const SHADY = zone({ scp: { growing_season_sun_hours: 2.5 } });
const FROSTY = zone({ zone: { frost_risk_level: 'high' } });
const WET = zone({ scp: { soil: { texture: 'clay_loam', ph: 7, drainage: 'poor' }, distance_to_water_m: 20 } });

const TOMATO = { id: 'tomato', common_name: 'Tomato', light_requirement: 'Full sun', frost_free_min_days: 130, guild_layer: 'herbaceous',
  plant_specs: { drainage: ['well', 'moderately_well'], ph_min: 5.5, ph_max: 7.5 } };
const HOSTA = { id: 'wild-ginger', common_name: 'Wild ginger', light_requirement: 'Partial sun/shade, Full shade', guild_layer: 'groundcover',
  plant_specs: { drainage: ['well', 'moderately_well', 'imperfect'] } };
const SASKATOON = { id: 'saskatoon', common_name: 'Saskatoon', light_requirement: 'Full sun, Partial sun/shade', frost_free_min_days: 90, guild_layer: 'shrub',
  plant_specs: { drainage: ['rapid', 'well', 'moderately_well'], ph_min: 5.5, ph_max: 7.5 } };
const WILLOW = { id: 'willow', common_name: 'Willow', light_requirement: 'Full sun', water_requirement: 'Wet', guild_layer: 'canopy',
  plant_specs: { drainage: ['imperfect', 'poor', 'very_poor', 'moderately_well'] } };

test('sunNeed maps light-requirement vocabulary to sun-hour thresholds', () => {
  assert.equal(sunNeed({ light_requirement: 'Full sun' }).min_hours, 6);
  assert.equal(sunNeed({ light_requirement: 'Full sun, Partial sun/shade' }).min_hours, 4);
  assert.equal(sunNeed({ light_requirement: 'Partial sun/shade, Full shade' }).prefers_shade, true);
  assert.equal(sunNeed({ plant_specs: { light_requirement: 'Full sun' } }).min_hours, 6);
  assert.equal(sunNeed({ shade_tolerance: 'High' }).basis, 'shade_tolerance');
  assert.equal(sunNeed({}).basis, 'default');
});

test('a full-sun plant scores far better in a sunny zone than a shaded one', () => {
  const sunny = scorePlantInZone(TOMATO, SUNNY);
  const shady = scorePlantInZone(TOMATO, SHADY);
  assert.ok(sunny.score - shady.score >= 30);
  assert.ok(shady.limits.some((l) => /sun/.test(l)));
});

test('a shade plant prefers the shaded zone over an open, sun-baked one', () => {
  assert.ok(scorePlantInZone(HOSTA, SHADY).score > scorePlantInZone(HOSTA, SUNNY).score);
});

test('frost pockets hurt frost-tender plants much more than hardy ones', () => {
  const tenderDrop = scorePlantInZone(TOMATO, SUNNY).score - scorePlantInZone(TOMATO, FROSTY).score;
  const hardyDrop = scorePlantInZone(SASKATOON, SUNNY).score - scorePlantInZone(SASKATOON, FROSTY).score;
  assert.ok(tenderDrop > hardyDrop * 2);
});

test('wet-loving plants go to wet ground; well-drained plants avoid it', () => {
  assert.ok(scorePlantInZone(WILLOW, WET).score > scorePlantInZone(WILLOW, SUNNY).score);
  assert.ok(scorePlantInZone(SASKATOON, SUNNY).score > scorePlantInZone(SASKATOON, WET).score);
});

test('out-of-range pH is flagged', () => {
  const acid = zone({ scp: { soil: { texture: 'loam', ph: 4.6, drainage: 'well' } } });
  const r = scorePlantInZone(TOMATO, acid);
  assert.ok(r.limits.some((l) => /pH/.test(l)));
});

test('missing data is reported as unknown, not silently scored as a fit', () => {
  const blank = { area_m2: 100, site_condition_profile: { soil: {} } };
  const r = scorePlantInZone(TOMATO, blank);
  assert.ok(r.unknowns.includes('soil pH'));
  assert.ok(r.unknowns.some((u) => /sun/.test(u)));
});

test('different zones get different top plants (the point of zone matching)', () => {
  const plants = [TOMATO, HOSTA, SASKATOON, WILLOW];
  const m = matchPlantsToZones([SUNNY, SHADY, WET], plants, { perZone: 1 });
  const tops = m.zones.map((z) => z.best_plants[0].id);
  assert.equal(new Set(tops).size, 3, `expected 3 distinct top plants, got ${tops}`);
  assert.equal(tops[1], 'wild-ginger');
  assert.equal(tops[2], 'willow');
});

test('per-plant view reports best zone and suitable area', () => {
  const m = matchPlantsToZones([SUNNY, SHADY, WET], [TOMATO, HOSTA, SASKATOON, WILLOW]);
  const tomato = m.plants.find((p) => p.id === 'tomato');
  assert.equal(tomato.best_zone_index, 0);
  assert.equal(tomato.suitable_area_m2, 500 * tomato.suitable_zone_count);
  assert.equal(tomato.top_zones.length, 3);
});

test('empty inputs do not throw', () => {
  assert.deepEqual(matchPlantsToZones([], []).zones, []);
  assert.deepEqual(matchPlantsToZones(null, null).plants, []);
});

test('zone_scores aligns one score per zone, in zone order', () => {
  const m = matchPlantsToZones([SUNNY, SHADY, WET], [TOMATO]);
  const t = m.plants[0];
  assert.equal(t.zone_scores.length, 3);
  assert.ok(t.zone_scores[0] > t.zone_scores[1], 'tomato: sunny zone beats shady zone');
});
