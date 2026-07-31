import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, buildSiteRecord } from './rules.js';
import {
  enrichElementValues,
  groupRecommendationsByValue,
  recommendationPriority,
  filterElementsByValue,
  collectRelatedServices,
  valueCounts,
  VALUE_TAXONOMY,
  EE_SERVICES,
} from './recommendation-values.js';

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

  it('frames each element with value fields (primary_value, value_headline)', () => {
    const { design_elements, recommendations } = applyRules({
      terrain: { slope_percent: 6, aspect: 'S', erosion_risk: 'low' },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: null, flood_risk_zone: false },
      climate: { prevailing_wind_direction: 'NW', chinook_exposure: false },
    });
    assert.ok(design_elements.length > 0);
    for (const el of design_elements) {
      assert.ok(el.primary_value, `${el.element_type} missing primary_value`);
      assert.ok(VALUE_TAXONOMY[el.primary_value], `unknown value ${el.primary_value}`);
      assert.ok(el.value_headline, `${el.element_type} missing value_headline`);
      assert.ok(el.technique_label);
      assert.equal(typeof el.priority, 'number');
      assert.ok(Array.isArray(el.secondary_values));
    }
    const swale = design_elements.find((e) => e.element_type === 'swale');
    assert.equal(swale?.primary_value, 'water_harvest');
    assert.match(swale.value_headline, /6%/);
    assert.ok(recommendations?.summary_sentence);
    assert.ok(Array.isArray(recommendations?.priority_ordered));
    assert.ok(recommendations.by_value?.water_harvest?.length);
  });

  it('promotes compliance_safety when wetland blocks earthworks', () => {
    const { design_elements } = applyRules({
      terrain: { slope_percent: 5, aspect: 'S', landform_position: 'valley_floor' },
      soil: { drainage_class: 'well' },
      hydrology: { wetland_class: 'III', flood_risk_zone: false },
    });
    const swale = design_elements.find((e) => e.element_type === 'swale');
    assert.ok(swale);
    assert.equal(swale.primary_value, 'compliance_safety');
    assert.match(swale.value_headline, /wet|wetland/i);
    assert.equal(swale.priority, 1);
  });
});

describe('recommendation-values', () => {
  it('ranks compliance and water before food', () => {
    const a = recommendationPriority({ primary_value: 'compliance_safety' });
    const b = recommendationPriority({ primary_value: 'water_harvest' });
    const c = recommendationPriority({ primary_value: 'food_production' });
    assert.ok(a < b);
    assert.ok(b < c);
  });

  it('builds site-specific windbreak headlines from Alberta prairie palette', () => {
    const v = enrichElementValues(
      'windbreak',
      { climate: { prevailing_wind_direction: 'NW', chinook_exposure: true } },
      {}
    );
    assert.equal(v.primary_value, 'wind_protection');
    assert.match(v.value_headline, /NW|shelterbelt|prairie|spruce|caragana|poplar/i);
    assert.match(v.value_headline, /chinook|conifer|spruce/i);
  });

  it('groups by primary_value', () => {
    const g = groupRecommendationsByValue([
      { element_type: 'swale', primary_value: 'water_harvest', priority: 3, zone: 2 },
      { element_type: 'windbreak', primary_value: 'wind_protection', priority: 4, zone: 2 },
      { element_type: 'pond', primary_value: 'water_storage', priority: 3, zone: 3 },
    ]);
    assert.equal(g.by_value.water_harvest.length, 1);
    assert.equal(g.by_value.wind_protection.length, 1);
    assert.match(g.summary_sentence, /water harvest|wind protection|water storage/i);
  });

  it('filters by primary or secondary value', () => {
    const els = [
      {
        element_type: 'swale',
        primary_value: 'water_harvest',
        secondary_values: ['erosion_control'],
      },
      {
        element_type: 'windbreak',
        primary_value: 'wind_protection',
        secondary_values: ['snow_management'],
      },
      {
        element_type: 'terrace',
        primary_value: 'erosion_control',
        secondary_values: ['water_harvest'],
      },
    ];
    assert.equal(filterElementsByValue(els, 'all').length, 3);
    assert.equal(filterElementsByValue(els, 'wind_protection').length, 1);
    // secondary match
    assert.equal(filterElementsByValue(els, 'erosion_control').length, 2);
  });

  it('collects EE service CTAs from related_services tags', () => {
    const els = [
      {
        element_type: 'swale',
        primary_value: 'water_harvest',
        priority: 3,
        related_services: ['water_earthworks_consult', 'full_site_design'],
      },
      {
        element_type: 'windbreak',
        primary_value: 'wind_protection',
        priority: 4,
        related_services: ['shelterbelt_design', 'full_site_design'],
      },
    ];
    const svc = collectRelatedServices(els);
    assert.ok(svc.some((s) => s.id === 'water_earthworks_consult'));
    assert.ok(svc.some((s) => s.id === 'shelterbelt_design'));
    const full = svc.find((s) => s.id === 'full_site_design');
    assert.equal(full?.hit_count, 2);
    assert.ok(EE_SERVICES.full_site_design.href.includes('expandingedge'));
    // water (priority 3) should sort before or with full_site that inherits best 3
    assert.ok(svc[0].best_priority <= svc[svc.length - 1].best_priority);
  });

  it('value_counts and related_services on group envelope', () => {
    const g = groupRecommendationsByValue([
      {
        element_type: 'swale',
        primary_value: 'water_harvest',
        priority: 3,
        zone: 2,
        related_services: ['water_earthworks_consult'],
      },
      {
        element_type: 'pond',
        primary_value: 'water_storage',
        priority: 3,
        zone: 3,
        related_services: ['water_earthworks_consult'],
      },
    ]);
    assert.ok(g.value_counts.length >= 2);
    assert.ok(g.related_services.some((s) => s.id === 'water_earthworks_consult'));
    const counts = valueCounts(g.priority_ordered);
    assert.equal(
      counts.find((c) => c.id === 'water_harvest')?.count,
      1
    );
  });
});

describe('buildSiteRecord', () => {
  it('returns schema-shaped record with design_elements and recommendations', () => {
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
    assert.ok(rec.design_elements.every((e) => e.primary_value && e.value_headline));
    assert.ok(rec.recommendations?.summary_sentence);
    assert.ok(Array.isArray(rec.data_provenance));
    assert.equal(rec.hydrology.seasonal_distribution, 'summer_peak');
  });
});
