import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCanopyVolume,
  estimateCutFill,
  roofFacesFromBuilding,
  enrichPlantingZones,
  computeRoofFaceSolar,
  roofOrientationFactor,
} from './report-site-layers.js';

const bbox = { west: -113.01, south: 53.5, east: -113.00, north: 53.51 };

test('estimateCanopyVolume sums CHM × cell area and flags the cruise disclaimer', () => {
  const values = new Array(4 * 4).fill(0);
  values[5] = 10;
  values[6] = 8;
  const r = estimateCanopyVolume({
    available: true,
    confidence: 'high',
    data_source: 'NRCAN_HRDEM',
    chm: { rows: 4, cols: 4, values_m: values },
  }, bbox);
  assert.equal(r.available, true);
  assert.ok(r.canopy_volume_m3 > 0);
  assert.ok(r.board_feet_estimate > 0);
  assert.match(r.note, /not a forestry cruise/i);
});

test('estimateCutFill balances around the mean grade of a square pad', () => {
  const rows = 5, cols = 5;
  const elevations = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) elevations.push(100 + r);
  const ring = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
  const r = estimateCutFill({ elevations, rows, cols, bbox, footprints: [{ geometry: { coordinates: [ring] } }] });
  assert.equal(r.available, true);
  assert.equal(r.pads.length, 1);
  assert.ok(r.pads[0].cut_m3 >= 0);
  assert.ok(r.pads[0].fill_m3 >= 0);
});

test('roofFacesFromBuilding: gable yields two faces, flat yields one', () => {
  const ring = [[0, 0], [0.001, 0], [0.001, 0.0004], [0, 0.0004], [0, 0]];
  const gable = roofFacesFromBuilding({ roof_type: 'gable', geometry: { coordinates: [ring] } });
  const flat = roofFacesFromBuilding({ roof_type: 'flat', geometry: { coordinates: [ring] } });
  assert.equal(gable.length, 2);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].tilt_deg, 5);
});

test('enrichPlantingZones bands a steep frosty patch poorer than a gentle one', () => {
  const zones = enrichPlantingZones({
    plantable_area: {
      planting_zones: [
        {
          geometry: { type: 'Polygon', coordinates: [[[-113, 53], [-113.001, 53], [-113.001, 53.001], [-113, 53.001], [-113, 53]]] },
          area_m2: 400,
          avg_slope_pct: 2,
          frost_risk_level: 'none',
          soil_texture_class: 'loam',
          confidence: 'high',
        },
        {
          geometry: { type: 'Polygon', coordinates: [[[-113, 53], [-113.001, 53], [-113.001, 53.001], [-113, 53.001], [-113, 53]]] },
          area_m2: 400,
          avg_slope_pct: 22,
          frost_risk_level: 'high',
          constraints: ['steep_terracing_required', 'frost_risk'],
          soil_texture_class: 'clay',
          confidence: 'moderate',
        },
      ],
    },
    soil_profile: { topsoil_0_30cm: { texture: 'loam', ph: 6.5 }, confidence: 'high' },
    site: { climate: { plant_hardiness_zone: '3a' }, footprint_ha: 1, soil: { texture: 'loam' } },
  });
  assert.equal(zones.length, 2);
  assert.ok(zones[0].suitability_score > zones[1].suitability_score);
  assert.equal(zones[1].site_condition_profile.frost_pocket, true);
  assert.ok(['poor', 'fair', 'good', 'excellent'].includes(zones[0].suitability_band));
});

test('computeRoofFaceSolar samples the existing raster and prefers the south face', () => {
  const ring = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.south],
    [bbox.east, bbox.north],
    [bbox.west, bbox.north],
    [bbox.west, bbox.south],
  ];
  const raster = {
    rows: 2,
    cols: 2,
    bbox,
    annual_insolation_hours: [6, 6, 6, 6],
  };
  const r = computeRoofFaceSolar(
    {
      available: true,
      buildings: [{
        footprint_id: 'a',
        building_type: 'house',
        roof_type: 'gable',
        geometry: { coordinates: [ring] },
      }],
    },
    { solar_exposure_raster: raster },
    4
  );
  assert.equal(r.available, true);
  assert.equal(r.roofs.length, 2);
  assert.ok(r.best_face);
  assert.ok(r.best_face.annual_kwh_m2 > 0);
  assert.ok(roofOrientationFactor(180, 30) > roofOrientationFactor(0, 30));
});

test('enrichPlantingZones reuses planting_plan instead of requiring a site catalog', () => {
  const zones = enrichPlantingZones({
    plantable_area: {
      planting_zones: [{
        geometry: { type: 'Polygon', coordinates: [[[-113, 53], [-113.001, 53], [-113.001, 53.001], [-113, 53.001], [-113, 53]]] },
        area_m2: 400,
        avg_slope_pct: 2,
        frost_risk_level: 'none',
        soil_texture_class: 'loam',
      }],
    },
    planting_plan: { recommended: [{ common_name: 'Saskatoon', latin_name: 'Amelanchier alnifolia', score: 80 }] },
  });
  assert.equal(zones[0].recommended_plantings.length, 1);
  assert.equal(zones[0].recommended_plantings[0].species_or_guild, 'Saskatoon');
});
