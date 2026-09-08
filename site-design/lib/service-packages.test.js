import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendServicePackages } from './service-packages.js';

test('no firesmart_fuel_reduction package when no buildings are flagged', () => {
  const result = recommendServicePackages({ firesmart: { assessments: [{ overall_risk_rating: 'low', contributing_factors: [] }] } });
  assert.ok(!result.packages.some((p) => p.id === 'firesmart_fuel_reduction'));
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
