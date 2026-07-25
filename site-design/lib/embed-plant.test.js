import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enrichPlantValues, filterPlantsByValue, groupPlantsByValue } from './plant-values.js';
import { planPlantings } from './planting.js';
import { buildEmbedRecommendations, getTaxonomyPayload } from './embed-api.js';

describe('plant-values (phase 4)', () => {
  it('tags food crops as food_production', () => {
    const v = enrichPlantValues({
      id: 'saskatoon',
      common_name: 'Saskatoon serviceberry',
      category: 'shrub',
      guild_layer: 'shrub',
      edibility_rating: 4,
      hardiness_min: '2a',
      hardiness_max: '7a',
    });
    assert.equal(v.primary_value, 'food_production');
    assert.ok(v.value_headline.includes('Saskatoon'));
  });

  it('tags caragana as wind_protection', () => {
    const v = enrichPlantValues({
      id: 'caragana',
      common_name: 'Caragana / Siberian pea-shrub',
      category: 'shrub',
      nitrogen_fixer: true,
    });
    assert.equal(v.primary_value, 'wind_protection');
    assert.ok(v.secondary_values.includes('nitrogen_fixing') || v.secondary_values.includes('biodiversity'));
  });

  it('tags cover crops as soil / N-fix', () => {
    const v = enrichPlantValues({
      id: 'red-clover',
      common_name: 'Red clover',
      category: 'cover_crop',
      nitrogen_fixer: true,
    });
    assert.equal(v.primary_value, 'nitrogen_fixing');
  });

  it('groups and filters plants by value', () => {
    const plants = [
      enrichPlantValues({ common_name: 'A', category: 'cover_crop', nitrogen_fixer: true, score: 80 }),
      enrichPlantValues({ common_name: 'B', category: 'shrub', edibility_rating: 5, score: 90 }),
    ].map((v, i) => ({ ...v, score: 80 + i * 10 }));
    // re-attach after enrich (enrich doesn't keep score)
    plants[0].score = 80;
    plants[0].primary_value = 'nitrogen_fixing';
    plants[1].score = 90;
    plants[1].primary_value = 'food_production';
    const g = groupPlantsByValue(plants);
    assert.ok(g.by_value.food_production);
    assert.equal(filterPlantsByValue(plants, 'food_production').length, 1);
  });
});

describe('planPlantings value tags', () => {
  it('returns primary_value on recommended plants', () => {
    const plan = planPlantings(
      {
        climate: {
          plant_hardiness_zone: '3b',
          frost_free_days: 140,
          chinook_exposure: false,
        },
        soil: { drainage_class: 'well', texture: 'loam' },
        hydrology: { annual_precipitation_mm: 450 },
        existing_vegetation: { successional_stage: 'mid_successional' },
        footprint_ha: 1,
      },
      { limit: 8 }
    );
    assert.ok(plan.recommended.length > 0);
    for (const p of plan.recommended) {
      assert.ok(p.primary_value, `${p.common_name} missing primary_value`);
      assert.ok(p.value_headline);
    }
    assert.ok(Array.isArray(plan.value_counts));
    assert.ok(plan.by_value);
  });
});

describe('embed-api (phase 3)', () => {
  it('exposes taxonomy with values and services', () => {
    const t = getTaxonomyPayload();
    assert.ok(t.values.some((v) => v.id === 'water_harvest'));
    assert.ok(t.services.some((s) => s.id === 'full_site_design'));
    assert.ok(t.presets.length > 0);
  });

  it('builds recommendations from Alberta preset', () => {
    const out = buildEmbedRecommendations({
      preset_id: 'sturgeon',
      footprint_ha: 1.5,
      terrain: { slope_percent: 6 },
      existing_vegetation: {
        successional_stage: 'mid_successional',
        cover_type: 'tame_pasture',
      },
      include_plants: true,
      plant_limit: 6,
    });
    assert.equal(out.engine, 'ee-recommendation-embed-v1');
    assert.ok(out.summary_sentence);
    assert.ok(out.design_elements.length > 0);
    assert.ok(out.design_elements.every((e) => e.primary_value && e.value_headline));
    assert.ok(out.recommendations.value_counts.length > 0);
    assert.ok(out.planting?.recommended?.length > 0);
    assert.ok(out.planting.recommended.every((p) => p.primary_value));
    assert.ok(out.full_tool_url);
  });

  it('can omit plants', () => {
    const out = buildEmbedRecommendations({
      preset_id: 'edmonton',
      include_plants: false,
    });
    assert.equal(out.planting, null);
  });
});
