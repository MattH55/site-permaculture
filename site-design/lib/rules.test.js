import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, buildSiteRecord } from './rules.js';

describe('applyRules', () => {
  it('recommends swale on moderate slope with good drainage', () => {
    const { design_elements } = applyRules({
      terrain: { slope_percent: 6, aspect: 'S', erosion_risk: 'low' },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: null, flood_risk_zone: false },
    });
    assert.ok(design_elements.some((e) => e.element_type === 'swale'));
  });

  it('recommends terrace above 15% slope', () => {
    const { design_elements } = applyRules({
      terrain: { slope_percent: 18, aspect: 'W', erosion_risk: 'moderate' },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: null },
    });
    assert.ok(design_elements.some((e) => e.element_type === 'terrace'));
    assert.ok(!design_elements.some((e) => e.element_type === 'swale' && e.confidence !== 'needs_site_visit'));
  });

  it('blocks earthworks when wetland class present', () => {
    const { design_elements, flags } = applyRules({
      terrain: { slope_percent: 5, aspect: 'S', landform_position: 'valley_floor' },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: 'III', flood_risk_zone: false },
    });
    assert.ok(flags.some((f) => f.code === 'wetland_water_act'));
    assert.ok(!design_elements.some((e) => e.element_type === 'pond'));
  });

  it('recommends keyline when keypoint present', () => {
    const { design_elements } = applyRules({
      terrain: { slope_percent: 8, keypoint_present: true, aspect: 'E' },
      soil: { drainage_class: 'moderately_well' },
      hydrology: { wetland_class: null },
    });
    assert.ok(design_elements.some((e) => e.element_type === 'keyline_cultivation'));
  });

  it('recommends pond on valley floor without flood risk', () => {
    const { design_elements } = applyRules({
      terrain: { slope_percent: 3, landform_position: 'valley_floor', aspect: 'flat' },
      hydrology: { wetland_class: null, flood_risk_zone: false },
      soil: { drainage_class: 'imperfect' },
    });
    assert.ok(design_elements.some((e) => e.element_type === 'pond'));
  });

  it('recommends hugelkultur for shallow soil or poor CLI', () => {
    const a = applyRules({ soil: { depth_to_bedrock_cm: 20 } });
    const b = applyRules({ soil: { cli_agricultural_capability_class: '6' } });
    assert.ok(a.design_elements.some((e) => e.element_type === 'hugelkultur_mound'));
    assert.ok(b.design_elements.some((e) => e.element_type === 'hugelkultur_mound'));
  });

  it('defers food forest on pioneer succession', () => {
    const { design_elements, flags } = applyRules({
      existing_vegetation: {
        cover_type: 'bare_disturbed',
        successional_stage: 'pioneer',
      },
    });
    assert.ok(flags.some((f) => f.code === 'succession_build_soil_first'));
    assert.ok(!design_elements.some((e) => e.element_type === 'food_forest_guild'));
  });

  it('recommends food forest on mid succession', () => {
    const { design_elements } = applyRules({
      existing_vegetation: {
        cover_type: 'shrubland',
        successional_stage: 'mid_successional',
      },
      climate: { plant_hardiness_zone: '3b', frost_free_days: 140 },
    });
    assert.ok(design_elements.some((e) => e.element_type === 'food_forest_guild'));
  });

  it('adds Zone 1 intensive on small footprint', () => {
    const { design_elements } = applyRules({ footprint_ha: 0.05 });
    assert.ok(design_elements.some((e) => e.element_type === 'herb_spiral'));
    assert.ok(design_elements.some((e) => e.element_type === 'keyhole_bed'));
  });

  it('caps earthwork confidence when erosion is high', () => {
    const { design_elements, flags } = applyRules({
      terrain: {
        slope_percent: 8,
        aspect: 'S',
        erosion_risk: 'high',
      },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: null },
    });
    assert.ok(flags.some((f) => f.code === 'erosion_high'));
    const swale = design_elements.find((e) => e.element_type === 'swale');
    assert.equal(swale?.confidence, 'needs_site_visit');
  });

  it('prioritises windbreak under chinook exposure', () => {
    const { design_elements } = applyRules({
      climate: {
        prevailing_wind_direction: 'W',
        chinook_exposure: true,
      },
    });
    const wb = design_elements.find((e) => e.element_type === 'windbreak');
    assert.ok(wb);
    assert.match(wb.placement_notes, /Chinook/i);
  });
});

describe('buildSiteRecord', () => {
  it('returns schema-shaped record with design_elements', () => {
    const rec = buildSiteRecord({
      site_name: 'Test Acreage',
      location: { latitude: 53.5, longitude: -113.5, municipality: 'Sturgeon County' },
      terrain: {
        slope_percent: 5,
        aspect: 'S',
        landform_position: 'mid_slope',
        keypoint_present: false,
        erosion_risk: 'low',
      },
      soil: { drainage_class: 'well', texture: 'loam', cli_agricultural_capability_class: '3' },
      climate: {
        plant_hardiness_zone: '3b',
        prevailing_wind_direction: 'NW',
        chinook_exposure: false,
      },
      existing_vegetation: {
        cover_type: 'tame_pasture',
        successional_stage: 'early_successional',
      },
      footprint_ha: 2,
      _preset_id: 'sturgeon',
    });
    assert.ok(rec.site_id);
    assert.equal(rec.location.municipality, 'Sturgeon County');
    assert.ok(Array.isArray(rec.design_elements));
    assert.ok(rec.design_elements.length > 0);
    assert.ok(Array.isArray(rec.data_provenance));
    assert.equal(rec.hydrology.seasonal_distribution, 'summer_peak');
  });
});
