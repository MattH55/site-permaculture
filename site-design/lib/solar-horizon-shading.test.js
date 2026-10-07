import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSolarHorizonShading } from './solar-horizon-shading.js';

function flatGrid(size, z) {
  return new Array(size * size).fill(z);
}

const bbox = { west: -114.0, south: 53.0, east: -113.98, north: 53.02 };

test('reports insufficient confidence with no DEM grid', () => {
  const r = computeSolarHorizonShading({ latitude: 53, longitude: -114, bbox: null });
  assert.equal(r.available, false);
  assert.equal(r.confidence, 'insufficient');
});

test('always surfaces canopy_shading_assumption as worst_case_evergreen (no species data)', () => {
  const r = computeSolarHorizonShading({
    elevations: flatGrid(8, 500),
    rows: 8,
    cols: 8,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 2,
  });
  assert.equal(r.canopy_shading_assumption, 'worst_case_evergreen');
  assert.ok(r.canopy_shading_note);
});

test('flat terrain gives more winter sun than a point behind a ridge', () => {
  const size = 16;
  const elevations = flatGrid(size, 500);
  // Build a ridge along one row south of the mid-row, tall enough to block low-angle winter sun.
  for (let c = 0; c < size; c++) {
    elevations[(size - 2) * size + c] = 650;
  }
  const flatResult = computeSolarHorizonShading({
    elevations: flatGrid(size, 500),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  const shadedResult = computeSolarHorizonShading({
    elevations,
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  assert.ok(flatResult.available && shadedResult.available);
  assert.ok(Array.isArray(flatResult.solar_exposure_raster.winter_insolation_hours));
  const flatWinterAvg = avg(flatResult.solar_exposure_raster.winter_insolation_hours);
  const shadedWinterAvg = avg(shadedResult.solar_exposure_raster.winter_insolation_hours);
  // Strict: a ridge to the SOUTH must actually cost winter sun. (This was
  // previously <=, which also passed while the sun azimuth was mirrored
  // into the northern sky and the ridge shaded nothing.)
  assert.ok(shadedWinterAvg < flatWinterAvg);
});

test('extracts top candidate zones with required output fields', () => {
  const size = 16;
  const r = computeSolarHorizonShading({
    elevations: flatGrid(size, 500),
    rows: size,
    cols: size,
    bbox,
    latitude: 53.01,
    longitude: -113.99,
    gridSampleStride: 4,
  });
  assert.ok(r.candidate_zones.length >= 1);
  const z = r.candidate_zones[0];
  assert.ok(z.geometry?.type === 'Polygon');
  assert.ok(typeof z.annual_insolation_hours === 'number');
  assert.ok(typeof z.winter_insolation_hours === 'number');
  assert.ok(r.winter_candidate_zones.length >= 1);
  // The two overlays are ranked by different fields and carry distinct id
  // namespaces so the UI can tell which toggle state produced which zone.
  assert.ok(r.winter_candidate_zones.every((zone) => zone.zone_id.startsWith('solar-winter-zone')));
  assert.ok(r.candidate_zones.every((zone) => zone.zone_id.startsWith('solar-zone')));
});

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

// --- Building shadows + leaf-off deciduous (form-aware canopy) ---------

const PT = { lat: 53.01, lon: -113.99 };
const M_LAT = 111_320;
const M_LON = 111_320 * Math.cos((53.01 * Math.PI) / 180);

function onePoint(extra) {
  const r = computeSolarHorizonShading({
    elevations: flatGrid(8, 500), rows: 8, cols: 8, bbox,
    latitude: PT.lat, longitude: PT.lon,
    candidatePoints: [PT],
    ...extra,
  });
  return r.per_point[0];
}

function squareFootprint(centerNorthM, halfM) {
  const lat = PT.lat + centerNorthM / M_LAT;
  const dLat = halfM / M_LAT;
  const dLon = halfM / M_LON;
  return { type: 'Polygon', coordinates: [[
    [PT.lon - dLon, lat - dLat], [PT.lon + dLon, lat - dLat],
    [PT.lon + dLon, lat + dLat], [PT.lon - dLon, lat + dLat], [PT.lon - dLon, lat - dLat],
  ]] };
}

test('a building just south of a point steals winter sun but not midsummer sun', () => {
  const open = onePoint({});
  const barn = onePoint({ buildings: [{ geometry: squareFootprint(-12, 5), height_m: 8 }] });
  assert.ok(barn.winter_insolation_hours < open.winter_insolation_hours, 'low winter sun should be blocked');
  // At 53°N the June noon sun is ~60° high — an 8 m building 7 m away casts
  // a ~4.6 m shadow, so summer loss is small at most.
  assert.ok(open.summer_insolation_hours - barn.summer_insolation_hours < open.winter_insolation_hours - barn.winter_insolation_hours + 2);
});

test('a building north of a point never shades it (northern hemisphere)', () => {
  const open = onePoint({});
  const north = onePoint({ buildings: [{ geometry: squareFootprint(15, 5), height_m: 10 }] });
  assert.equal(north.winter_insolation_hours, open.winter_insolation_hours);
});

test('buildings without a measured height still cast a (default-height) shadow', () => {
  const open = onePoint({});
  const unknown = onePoint({ buildings: [{ geometry: squareFootprint(-8, 4), height_m: null }] });
  assert.ok(unknown.winter_insolation_hours < open.winter_insolation_hours);
});

test('a leaf-off deciduous tree lets more winter sun through than a conifer the same size', () => {
  const tree = (form) => ({
    available: true,
    tree_instances: [{ x: PT.lat - 8 / M_LAT, y: PT.lon, height_m: 12, crown_radius_m: 3, form }],
  });
  const conifer = onePoint({ canopy: tree('conifer') });
  const deciduous = onePoint({ canopy: tree('deciduous') });
  assert.ok(deciduous.winter_insolation_hours > conifer.winter_insolation_hours);
  // In leaf (summer solstice) both block equally.
  assert.equal(deciduous.summer_insolation_hours, conifer.summer_insolation_hours);
});

test('form-tagged trees switch the reported canopy assumption to form_aware_leaf_off', () => {
  const r = computeSolarHorizonShading({
    elevations: flatGrid(8, 500), rows: 8, cols: 8, bbox, latitude: PT.lat, longitude: PT.lon,
    canopy: { available: true, tree_instances: [{ x: PT.lat, y: PT.lon + 0.001, height_m: 10, crown_radius_m: 3, form: 'deciduous' }] },
    gridSampleStride: 2,
  });
  assert.equal(r.canopy_shading_assumption, 'form_aware_leaf_off');
  assert.match(r.canopy_shading_note, /leaf-off/);
});

test('noon sun is due south at a northern-hemisphere site (azimuth convention)', () => {
  // Same ridge, once to the south and once to the north of the grid: only
  // the southern one may cost winter sun.
  const size = 16;
  const southRidge = flatGrid(size, 500);
  const northRidge = flatGrid(size, 500);
  for (let c = 0; c < size; c++) {
    southRidge[(size - 2) * size + c] = 650;
    northRidge[1 * size + c] = 650;
  }
  const run = (elevations) => computeSolarHorizonShading({
    elevations, rows: size, cols: size, bbox, latitude: 53.01, longitude: -113.99, gridSampleStride: 4,
  });
  const south = avg(run(southRidge).solar_exposure_raster.winter_insolation_hours);
  const north = avg(run(northRidge).solar_exposure_raster.winter_insolation_hours);
  assert.ok(south < north, `south ridge (${south}) should shade more than north ridge (${north})`);
});
