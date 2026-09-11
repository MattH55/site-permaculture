import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendServicePackages } from './service-packages.js';

test('no firesmart_fuel_reduction package when no buildings are flagged', () => {
  const result = recommendServicePackages({ firesmart: { assessments: [{ overall_risk_rating: 'low', contributing_factors: [] }] } });
  assert.ok(!result.packages.some((p) => p.id === 'firesmart_fuel_reduction'));
});

test('ungulates and predators from the wildlife layer pull fence and camera packages', () => {
  const result = recommendServicePackages({
    wildlife: {
      species_at_risk_flagged: [],
      triggers: { packages: ['deer_wildlife_fence', 'wildlife_camera_monitoring', 'pollinator_habitat'] },
    },
  });
  const ids = result.packages.map((p) => p.id);
  assert.ok(ids.includes('deer_wildlife_fence'));
  assert.ok(ids.includes('wildlife_camera_monitoring'));
  assert.ok(ids.includes('pollinator_habitat'));
});

test('species-at-risk does not auto-select FireSmart clearing', () => {
  const result = recommendServicePackages({
    firesmart: {
      assessments: [
        { overall_risk_rating: 'extreme', contributing_factors: ['Zone 1: vegetation present'] },
      ],
    },
    wildlife: { species_at_risk_flagged: ['Rangifer tarandus caribou'], triggers: { packages: [] } },
  });
  const pkg = result.packages.find((p) => p.id === 'firesmart_fuel_reduction');
  assert.ok(pkg);
  assert.equal(pkg.default_selected, false);
  assert.match(pkg.reason, /species-at-risk/i);
});

test('a high/extreme FireSmart rating pulls in the fuel-reduction package with specific reasoning', () => {
  const result = recommendServicePackages({
    firesmart: {
      assessments: [
        { overall_risk_rating: 'low', contributing_factors: [] },
        { overall_risk_rating: 'extreme', contributing_factors: ['Zone 1: vegetation present (45% cover, 3 trees) — FireSmart Zone 1 calls for minimal-to-no flammable vegetation directly adjacent to the structure.'] },
      ],
    },
  });
  const pkg = result.packages.find((p) => p.id === 'firesmart_fuel_reduction');
  assert.ok(pkg);
  assert.ok(pkg.reason.includes('Zone 1'));
  assert.equal(pkg.site_facts.worst_rating, 'extreme');
  assert.equal(pkg.default_selected, true);
});
