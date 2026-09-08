import test from 'node:test';
import assert from 'node:assert/strict';
import { computePondSuitability } from './suitability-pond.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

// Gentle valley (per-cell grade well under the pond slope hard-exclusion
// threshold) where the lateral (toward-centre) gradient dominates the
// southward one, so D8 flow funnels off-centre cells into the centre
// column before draining south — a proper convergent thalweg rather than
// parallel straight-down flow lines.
function valleyElevations(size = 15) {
  const centre = Math.floor(size / 2);
  const z = new Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      z[r * size + c] = r * 0.3 + Math.abs(c - centre) * 1.0;
    }
  }
  return z;
}

const clayeySoil = {
  soil_data_source: 'AGRASID',
  soil_units: [{ texture_class: 'clay', drainage_class: 'poor' }],
};

test('unavailable without a DEM grid', () => {
  const result = computePondSuitability({});
  assert.equal(result.available, false);
});

test('scores the valley thalweg higher than a steep off-axis corner', () => {
  const size = 15;
  const result = computePondSuitability({
    elevations: valleyElevations(size),
    rows: size,
    cols: size,
    bbox,
    parcel_area_m2: 40_000,
    soil_data: clayeySoil,
    dem_confidence: 'high',
  });

  assert.equal(result.available, true);
  assert.equal(result.suitability_type, 'pond');
  assert.ok(result.suitability_raster);
  assert.ok(result.top_candidate_zones.length > 0);

  const idx = (r, c) => r * size + c;
  const thalwegScore = result.suitability_raster.scores[idx(12, 7)];
  const cornerScore = result.suitability_raster.scores[idx(1, 1)];
  assert.ok(thalwegScore > cornerScore, `expected thalweg (${thalwegScore}) > corner (${cornerScore})`);
});

test('excludes cells inside a mapped water body', () => {
  const size = 15;
  const waterRing = [[-113.996, 53.002], [-113.994, 53.002], [-113.994, 53.001], [-113.996, 53.001], [-113.996, 53.002]];
  const result = computePondSuitability({
    elevations: valleyElevations(size),
    rows: size,
    cols: size,
    bbox,
    parcel_area_m2: 40_000,
    soil_data: clayeySoil,
    surface_water: { water_bodies: [{ geometry: { type: 'Polygon', coordinates: [waterRing] } }] },
  });
  assert.ok(result.hard_exclusions_applied.includes('existing_water'));
});

test('sandy soil scores lower than clay soil for holding capacity, all else equal', () => {
  const size = 15;
  const sandy = { soil_data_source: 'AGRASID', soil_units: [{ texture_class: 'sand' }] };
  const clayResult = computePondSuitability({ elevations: valleyElevations(size), rows: size, cols: size, bbox, parcel_area_m2: 40_000, soil_data: clayeySoil });
  const sandResult = computePondSuitability({ elevations: valleyElevations(size), rows: size, cols: size, bbox, parcel_area_m2: 40_000, soil_data: sandy });
  const idx = 12 * size + 7;
  assert.ok(clayResult.suitability_raster.scores[idx] > sandResult.suitability_raster.scores[idx]);
});
