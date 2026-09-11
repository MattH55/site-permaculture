import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unpackSoilGridsLayers,
  rusleLite,
  topographicWetnessIndex,
  twiToDrainageClass,
  blendDrainage,
  buildSoilProfile,
  kFactorFromTexture,
} from './soil-profile.js';

test('unpackSoilGridsLayers splits topsoil vs deeper depths', () => {
  const { by_depth, averages } = unpackSoilGridsLayers([
    {
      name: 'phh2o',
      unit_measure: { d_factor: 10 },
      depths: [
        { label: '0-5cm', values: { mean: 62 } },
        { label: '5-15cm', values: { mean: 63 } },
        { label: '30-60cm', values: { mean: 70 } },
      ],
    },
    {
      name: 'soc',
      unit_measure: { d_factor: 10 },
      depths: [
        { label: '0-5cm', values: { mean: 200 } },
        { label: '30-60cm', values: { mean: 40 } },
      ],
    },
  ]);
  assert.equal(by_depth['0-5cm'].phh2o, 6.2);
  assert.equal(by_depth['30-60cm'].phh2o, 7);
  assert.ok(averages.phh2o > 6);
});

test('rusleLite: steep silty ground scores higher risk than flat sand', () => {
  const steep = rusleLite({ texture: 'silt_loam', slope_pct: 18, annual_precip_mm: 500 });
  const flat = rusleLite({ texture: 'sand', slope_pct: 1, annual_precip_mm: 350 });
  assert.ok(steep.erosion_risk_score > flat.erosion_risk_score);
  assert.ok(['poor', 'fair', 'good', 'excellent'].includes(steep.erosion_risk_band));
  assert.match(steep.note, /RUSLE-lite/);
});

test('TWI is higher in flat high-accumulation cells', () => {
  const wet = topographicWetnessIndex(50_000, 1, 10);
  const dry = topographicWetnessIndex(50, 25, 10);
  assert.ok(wet > dry);
  assert.equal(twiToDrainageClass(13), 'poor');
  assert.equal(twiToDrainageClass(5), 'well');
});

test('blendDrainage flags whether survey or TWI is driving', () => {
  const same = blendDrainage('well', 'well');
  assert.equal(same.driver, 'survey');
  const diverge = blendDrainage('well', 'poor');
  assert.equal(diverge.class, 'poor');
  assert.equal(diverge.driver, 'twi');
});

test('kFactorFromTexture: silt higher than sand', () => {
  assert.ok(kFactorFromTexture('silt') > kFactorFromTexture('sand'));
});

test('buildSoilProfile exposes topsoil vs subsoil and erosion band', () => {
  const profile = buildSoilProfile({
    soil_data: {
      soil_data_source: 'AGRASID',
      confidence: 'high',
      soil_units: [{ texture_class: 'loam', drainage_class: 'well', ph: 6.4, organic_carbon_pct: 2.1 }],
    },
    soilgrids_point: {
      by_depth: {
        '0-5cm': { phh2o: 6.2, soc: 25, clay: 20, sand: 40, silt: 40 },
        '5-15cm': { phh2o: 6.3, soc: 18, clay: 22, sand: 38, silt: 40 },
        '15-30cm': { phh2o: 6.4, soc: 12, clay: 24, sand: 36, silt: 40 },
        '30-60cm': { clay: 28, sand: 32, silt: 40, bdod: 1.4 },
      },
    },
    slope_pct: 6,
    annual_precip_mm: 450,
    flow: { available: false },
  });
  assert.ok(profile.topsoil_0_30cm.ph);
  assert.ok(profile.topsoil_0_30cm.texture);
  assert.equal(profile.drainage_class_survey, 'well');
  assert.ok(profile.erosion_risk_score >= 0);
  assert.ok(profile.lab_test_override == null);
  assert.equal(profile.data_source.twi, 'unavailable');
});
