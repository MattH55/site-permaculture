import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFireSmartAssessments, _internal } from './firesmart-zones.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function houseFootprint(clon, clat, halfLonDeg, halfLatDeg) {
  return [[clon - halfLonDeg, clat - halfLatDeg], [clon + halfLonDeg, clat - halfLatDeg], [clon + halfLonDeg, clat + halfLatDeg], [clon - halfLonDeg, clat + halfLatDeg], [clon - halfLonDeg, clat - halfLatDeg]];
}

const centre = { lon: -113.995, lat: 53.005 };
const footprintRing = houseFootprint(centre.lon, centre.lat, 0.00006, 0.00004); // small rectangular house

function baseBuilding() {
  return {
    footprint_id: 'b1',
    geometry: { type: 'Polygon', coordinates: [footprintRing] },
    height_m: 6,
    data_source: { footprint: 'OSM', height: 'CHM (DSM − DTM)' },
    confidence: { footprint: 'moderate', height: 'high', type: 'lower' },
  };
}

test('no buildings -> unavailable', () => {
  const result = computeFireSmartAssessments({ buildings: { buildings: [] } });
  assert.equal(result.available, false);
});

test('a building with no nearby vegetation rates low, ladder-fuel/conifer gaps always flagged', () => {
  const result = computeFireSmartAssessments({
    buildings: { buildings: [baseBuilding()] },
    canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', tree_instances: [], chm: null },
  });
  assert.equal(result.available, true);
  const a = result.assessments[0];
  assert.equal(a.overall_risk_rating, 'low');
  assert.equal(a.ladder_fuel_assessment, 'not_available');
  assert.equal(a.conifer_classification, 'not_available');
  assert.equal(a.zones.length, 3);
});

test('trees directly beside the structure flag Zone 1 and float the overall rating up', () => {
  const nearTrees = [
    { x: centre.lat, y: centre.lon - 0.00009, height_m: 12, crown_radius_m: 3 }, // just outside the footprint, inside zone 1
    { x: centre.lat, y: centre.lon - 0.0001, height_m: 12, crown_radius_m: 3 },
  ];
  const size = 25;
  const values = new Array(size * size).fill(0);
  for (let r = 8; r <= 16; r++) for (let c = 4; c <= 10; c++) values[r * size + c] = 10; // canopy block near the west side of the house
  const result = computeFireSmartAssessments({
    buildings: { buildings: [baseBuilding()] },
    canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', tree_instances: nearTrees, chm: { rows: size, cols: size, values_m: values } },
    bbox,
  });
  const a = result.assessments[0];
  const zone1 = a.zones[0];
  assert.ok(zone1.risk_flags.includes('woody_vegetation_present_in_zone_1'));
  assert.ok(['moderate', 'high', 'extreme'].includes(a.overall_risk_rating));
  assert.ok(a.contributing_factors.some((f) => f.includes('Zone 1')));
});

test('tightly spaced crowns are flagged', () => {
  const tightTrees = [
    { x: centre.lat, y: centre.lon - 0.00015, height_m: 14, crown_radius_m: 3 },
    { x: centre.lat + 0.00002, y: centre.lon - 0.00016, height_m: 14, crown_radius_m: 3 }, // very close to the first
  ];
  const result = computeFireSmartAssessments({
    buildings: { buildings: [baseBuilding()] },
    canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', tree_instances: tightTrees, chm: null },
    bbox,
  });
  const a = result.assessments[0];
  const anyTight = a.zones.some((z) => z.risk_flags.includes('tight_crown_spacing'));
  assert.ok(anyTight);
});

test('slope adjustment extends the uphill-facing side, not applied when DEM is missing', () => {
  const size = 21;
  const elevations = new Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) elevations[r * size + c] = r * 20; // north (low r) is high ground

  const withDem = computeFireSmartAssessments({
    buildings: { buildings: [baseBuilding()] },
    canopy: { available: true, data_source: 'x', confidence: 'moderate', tree_instances: [], chm: null },
    elevations, rows: size, cols: size, bbox,
  });
  assert.equal(withDem.assessments[0].slope_adjustment.applied, true);
  assert.ok(Number.isFinite(withDem.assessments[0].slope_adjustment.uphill_bearing_deg));

  const noDem = computeFireSmartAssessments({
    buildings: { buildings: [baseBuilding()] },
    canopy: { available: true, data_source: 'x', confidence: 'moderate', tree_instances: [], chm: null },
  });
  assert.equal(noDem.assessments[0].slope_adjustment.applied, false);
});

test('orientedRect produces a rectangle spanning the footprint', () => {
  const orient = _internal.orientedRect(footprintRing);
  assert.ok(orient.uMax > orient.uMin);
  assert.ok(orient.vMax > orient.vMin);
});

test('rollUpRating: a risky Zone 1 is not averaged away by clean Zones 2-3', () => {
  const zones = [
    { zone_number: 1, canopy_cover_pct: 45, risk_flags: ['woody_vegetation_present_in_zone_1'] },
    { zone_number: 2, canopy_cover_pct: 0, risk_flags: [] },
    { zone_number: 3, canopy_cover_pct: 0, risk_flags: [] },
  ];
  const { overallRating } = _internal.rollUpRating(zones, _internal.DEFAULT_CONFIG);
  assert.equal(overallRating, 'extreme');
});
