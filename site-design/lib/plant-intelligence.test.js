import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './plant-intelligence/csv.js';
import { ecoCropToPlant } from './plant-intelligence/ingest-ecocrop.js';
import { mergePlants } from './plant-intelligence/merge.js';
import { scorePlant } from './plant-intelligence/suitability.js';
import { recommendPlants } from './plant-intelligence/recommend.js';
import { canonicalName, taxonIdFromName } from './plant-intelligence/taxonomy.js';

test('CSV parser keeps quoted commas', () => {
  const rows = parseCsv('a,b\n"x, y",2\n');
  assert.equal(rows[0].a, 'x, y');
  assert.equal(rows[0].b, '2');
});

test('canonicalName strips authors', () => {
  assert.equal(canonicalName('Abelmoschus esculentus (L.) Moench'), 'Abelmoschus esculentus');
  assert.equal(taxonIdFromName('Malus domestica'), 'malus-domestica');
});

test('EcoCrop row maps SI climate/soil with provenance and keeps source name', () => {
  const p = ecoCropToPlant({
    EcoPortCode: '289',
    ScientificName: 'Abelmoschus esculentus (L.) Moench',
    COMNAME: 'okra, bhindi',
    TMIN: '12',
    TMAX: '35',
    TOPMN: '20',
    TOPMX: '30',
    RMIN: '300',
    RMAX: '2500',
    PHMIN: '4.5',
    PHMAX: '8.7',
    LIMN: 'very bright',
    LIOPMN: 'clear skies',
    DRA: 'well (dry spells)',
    TEXT: 'heavy, medium, light',
    DEP: 'shallow (20-50 cm)',
    LIFO: 'herb',
    FAMNAME: 'Malvales:Malvaceae',
  });
  assert.equal(p.taxon.scientific_name_source, 'Abelmoschus esculentus (L.) Moench');
  assert.equal(p.taxon.scientific_name, 'Abelmoschus esculentus');
  assert.equal(p.climate.temp_min_c, 12);
  assert.equal(p.climate.precip_min_mm, 300);
  assert.equal(p.soil.ph_min, 4.5);
  assert.ok(p.provenance.some((r) => r.field_name === 'temp_min_c' && r.source_id === 'ecocrop'));
  assert.equal(p.soil.soil_depth_min_cm, 20);
});

test('merge keeps both EcoCrop and USDA values in provenance', () => {
  const eco = ecoCropToPlant({
    EcoPortCode: '1',
    ScientificName: 'Malus domestica',
    TMIN: '-25',
    PHMIN: '5.5',
    PHMAX: '7.5',
    COMNAME: 'apple',
  });
  const usda = {
    taxon: { id: 'malus-domestica', scientific_name: 'Malus domestica', scientific_name_source: 'Malus domestica Borkh.', common_names: ['Apple'] },
    climate: { temp_min_c: -30, hardiness_zone_min: '3a' },
    soil: {},
    solar: {},
    water: {},
    morphology: {},
    ecology: {},
    uses: {},
    provenance: [{ taxon_id: 'malus-domestica', field_name: 'temp_min_c', value: -30, source_id: 'usda_plants' }],
    sources: ['usda_plants'],
  };
  const { plants } = mergePlants([[eco], [usda]]);
  const apple = plants.find((p) => p.taxon.id === 'malus-domestica');
  assert.ok(apple);
  assert.equal(apple.climate.temp_min_c, -25);
  const temps = apple.provenance.filter((r) => r.field_name === 'temp_min_c').map((r) => r.source_id);
  assert.ok(temps.includes('ecocrop'));
  assert.ok(temps.includes('usda_plants'));
});

test('hard constraint rejects site colder than EcoCrop TMIN; unknown solar does not reject', () => {
  const okra = ecoCropToPlant({
    EcoPortCode: '289',
    ScientificName: 'Abelmoschus esculentus',
    TMIN: '12',
    TMAX: '35',
    PHMIN: '5',
    PHMAX: '8',
    RMIN: '300',
    RMAX: '2000',
  });
  const alberta = scorePlant(okra, {
    temperature_min_c: -30,
    temperature_max_c: 28,
    annual_precipitation_mm: 450,
    soil_ph: 6.5,
  });
  assert.equal(alberta.hard_fail, true);
  assert.equal(alberta.suitability, 0);

  const tropics = scorePlant(okra, {
    temperature_min_c: 18,
    temperature_max_c: 32,
    annual_precipitation_mm: 800,
    soil_ph: 6.5,
  });
  assert.equal(tropics.hard_fail, false);
  assert.ok(tropics.suitability > 0.5);
  assert.ok(tropics.unknown_fields.includes('solar'));
});

test('freshness labels archival vs recent prices', async () => {
  const { freshnessLabel } = await import('./plant-intelligence/products.js');
  assert.equal(freshnessLabel('2020-01-01', Date.parse('2026-09-11')), 'archival');
  assert.equal(freshnessLabel('2026-08-20', Date.parse('2026-09-11')), 'current');
});

test('Cheyenne apple has a retail observation and delivery is labeled', async () => {
  const { pricesForTaxon } = await import('./plant-intelligence/products.js');
  const obs = pricesForTaxon('Malus domestica', { latitude: 53.55, longitude: -113.5 });
  assert.ok(obs.length);
  assert.equal(obs[0].price_class, 'retail');
  assert.ok(obs[0].freshness);
  assert.ok(obs[0].delivered_total_cad >= obs[0].price_cad);
});

test('utility and cost stay separate on a spruce vs saskatoon', async () => {
  const { utilityValue, establishmentCost, rankRecommendations } = await import('./plant-intelligence/economics.js');
  const spruce = { taxon: { id: 'picea-glauca', scientific_name: 'Picea glauca', common_names: ['White spruce'] }, morphology: { growth_form: 'tree' }, ecology: { native_regions: ['Alberta'] } };
  const berry = { taxon: { id: 'amelanchier-alnifolia', scientific_name: 'Amelanchier alnifolia', common_names: ['Saskatoon'] }, morphology: { growth_form: 'shrub' }, ecology: { native_regions: ['Alberta'] } };
  const uS = utilityValue(spruce);
  const uB = utilityValue(berry);
  assert.ok(uS.windbreak > uB.windbreak);
  assert.ok(uB.food > uS.food);
  const site = { latitude: 53.55, longitude: -113.5, area_m2: 400 };
  const cS = establishmentCost(spruce, site);
  const cB = establishmentCost(berry, site);
  assert.ok(cS.total_initial_cost > cB.total_initial_cost);
  const ranked = rankRecommendations([
    { plant: { taxon_id: 'picea-glauca' }, biological: { suitability: 0.9 }, commercial: { establishment_cost_cad: cS.total_initial_cost }, economic: { npv: null }, utility: uS, utility_per_dollar: 0.01 },
    { plant: { taxon_id: 'amelanchier-alnifolia' }, biological: { suitability: 0.9 }, commercial: { establishment_cost_cad: cB.total_initial_cost }, economic: { npv: { mid: 200 } }, utility: uB, utility_per_dollar: 0.2 },
  ], 'cost');
  assert.equal(ranked[0].plant.taxon_id, 'amelanchier-alnifolia');
});

test('recommendPlants ranks a fitting species above a hard-fail', () => {
  const okra = ecoCropToPlant({ EcoPortCode: '1', ScientificName: 'Abelmoschus esculentus', TMIN: '12', TMAX: '35', RMIN: '300', RMAX: '2000', PHMIN: '5', PHMAX: '8', COMNAME: 'okra' });
  const saskatoon = ecoCropToPlant({ EcoPortCode: '2', ScientificName: 'Amelanchier alnifolia', TMIN: '-40', TMAX: '30', RMIN: '250', RMAX: '900', PHMIN: '5.5', PHMAX: '7.8', COMNAME: 'saskatoon' });
  saskatoon.climate.hardiness_zone_min = '2a';
  const db = { plants: [okra, saskatoon] };
  const out = recommendPlants(
    { temperature_min_c: -28, annual_precipitation_mm: 450, soil_ph: 6.4, hardiness_zone: '3a', region: 'Alberta' },
    { db, max_results: 20 }
  );
  assert.equal(out.recommendations[0].plant.scientific_name, 'Amelanchier alnifolia');
  assert.ok(!out.recommendations.some((r) => (r.plant?.scientific_name || '').includes('Abelmoschus')));
});
