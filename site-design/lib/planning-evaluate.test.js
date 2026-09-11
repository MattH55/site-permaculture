import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePlanningClick } from './planning-evaluate.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };
const flatElevations = new Array(9 * 9).fill(500);

const baseContext = {
  elevations: flatElevations,
  rows: 9,
  cols: 9,
  bbox,
  latitude: 53.005,
  longitude: -113.995,
  precipitation: { monthly_mm: { Jan: 10, Feb: 8, Mar: 15, Apr: 25, May: 45, Jun: 70, Jul: 65, Aug: 55, Sep: 35, Oct: 20, Nov: 12, Dec: 10 } },
  parcel_area_m2: 10_000,
  soil_data: { soil_data_source: 'AGRASID', confidence: 'high', soil_units: [{ texture_class: 'loam', drainage_class: 'well' }] },
  canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', canopy_cover_pct: 20, render_zones: [] },
};

test('rejects a missing/invalid position before touching any model', () => {
  const result = evaluatePlanningClick({ feature_type: 'solar', position: null, context: baseContext });
  assert.equal(result.available, false);
  assert.ok(result.error);
});

test('rejects an unknown feature_type', () => {
  const result = evaluatePlanningClick({ feature_type: 'bogus', position: { lat: 53.005, lon: -113.995 }, context: baseContext });
  assert.equal(result.available, false);
  assert.ok(result.error);
});

test('solar: evaluates the single clicked point using the real horizon-shading model', () => {
  const result = evaluatePlanningClick({
    feature_type: 'solar',
    position: { lat: 53.005, lon: -113.995 },
    context: baseContext,
  });
  assert.equal(result.available, true);
  assert.ok(typeof result.point.annual_insolation_hours === 'number');
  assert.ok(result.methodology);
  assert.equal(result.canopy_shading_assumption, 'worst_case_evergreen');
});

test('pond: evaluates the clicked point with a user-adjustable assumed surface area', () => {
  const result = evaluatePlanningClick({
    feature_type: 'pond',
    position: { lat: 53.003, lon: -113.997 },
    user_params: { assumed_surface_area_m2: 250 },
    context: baseContext,
  });
  assert.equal(result.available, true);
  assert.equal(result.tiers.length, 1);
  assert.equal(result.tiers[0].assumed_surface_area_m2, 250);
  assert.ok(Array.isArray(result.assumptions) && result.assumptions.length > 0);
});

test('planting: open ground returns recommendations (spatial catalog or parcel fallback)', () => {
  const result = evaluatePlanningClick({
    feature_type: 'planting',
    position: { lat: 53.005, lon: -113.995 },
    context: { ...baseContext, recommended_plantings: [{ id: 'saskatoon', common_name: 'Saskatoon', score: 88 }] },
  });
  assert.equal(result.available, true);
  assert.ok(result.recommendations.length);
  if (result.zone_specific) {
    assert.ok(result.site_environment);
    assert.ok(result.recommendations[0].plant || result.recommendations[0].id || result.recommendations[0].scientific_name);
  } else {
    assert.equal(result.recommendations[0].id, 'saskatoon');
  }
});

test('planting: refuses a point inside dense canopy', () => {
  const denseZoneGeometry = {
    type: 'Polygon',
    coordinates: [[[-114, 53], [-113.99, 53], [-113.99, 53.01], [-114, 53.01], [-114, 53]]],
  };
  const result = evaluatePlanningClick({
    feature_type: 'planting',
    position: { lat: 53.005, lon: -113.995 },
    context: {
      ...baseContext,
      canopy: { ...baseContext.canopy, render_zones: [{ render_mode: 'billboard_impostor', geometry: denseZoneGeometry }] },
      recommended_plantings: [{ id: 'saskatoon' }],
    },
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /canopy|woodlot/);
});
