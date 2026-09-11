import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTreeAsset, priorFromSubregion, formFromDimensions, AVI_SPECIES_TO_ASSET } from './avi-species.js';

test('AVI codes map to the documented Poly Haven asset classes', () => {
  assert.equal(resolveTreeAsset({ avi_species: 'SW' }), 'conifer');
  assert.equal(resolveTreeAsset({ species_code: 'PL' }), 'conifer');
  assert.equal(resolveTreeAsset({ avi_species: 'PB' }), 'deciduous');
  assert.equal(resolveTreeAsset({ avi_species: 'AW' }), 'deciduous');
  assert.ok(AVI_SPECIES_TO_ASSET.SW.asset === 'conifer');
});

test('unknown code falls back to form, then height/crown, then prior', () => {
  assert.equal(resolveTreeAsset({ form: 'conifer' }), 'conifer');
  assert.equal(resolveTreeAsset({ height_m: 18, crown_radius_m: 2 }), 'conifer');
  assert.equal(resolveTreeAsset({ height_m: 8, crown_radius_m: 4 }, { prior: 'deciduous' }), 'deciduous');
  assert.equal(resolveTreeAsset({ height_m: 16 }), 'conifer');
});

test('priorFromSubregion: boreal → conifer, parkland → deciduous', () => {
  assert.equal(priorFromSubregion('Central Mixedwood'), 'conifer');
  assert.equal(priorFromSubregion('Central Parkland'), 'deciduous');
  assert.equal(priorFromSubregion(null), null);
});

test('formFromDimensions: tall skinny crowns count as conifer', () => {
  assert.equal(formFromDimensions(20, 3), 'conifer');
  assert.equal(formFromDimensions(8, 4), 'deciduous');
});
