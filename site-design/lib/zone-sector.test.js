import test from 'node:test';
import assert from 'node:assert/strict';
import { computeZoneSectorOverlay } from './zone-sector.js';

const bbox = { west: -114, south: 53, east: -113.99, north: 53.01 };

function flatGrid(size, z) { return new Array(size * size).fill(z); }

// Every call below gets its own parcel_id — the module caches by
// (parcel_id, homestead_point, euclidean flag) per spec, and several tests
// here intentionally reuse the same lat/lon/homestead fixture with a
// *different* elevations/wind_rose payload, which would otherwise collide
// with another test's cached result within this same process.

test('flags a placeholder homestead point when none was placed', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'placeholder-test',
    elevations: flatGrid(9, 500), rows: 9, cols: 9,
  });
  assert.equal(r.placeholder_flag, true);
  assert.equal(r.homestead_point.is_placeholder, true);
});

test('an explicit homestead point is not flagged as a placeholder', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'explicit-point-test',
    elevations: flatGrid(9, 500), rows: 9, cols: 9,
    homestead_point: { lat: 53.004, lon: -113.996 },
  });
  assert.equal(r.placeholder_flag, false);
  assert.equal(r.homestead_point.lat, 53.004);
});

test('zone rings expand outward from the homestead point on flat terrain', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'expand-test',
    elevations: flatGrid(21, 500), rows: 21, cols: 21,
    homestead_point: { lat: 53.005, lon: -113.995 },
  });
  assert.ok(r.zones.length >= 2);
  const zoneNumbers = new Set(r.zones.map((z) => z.zone_number));
  // Zone 0 (the house itself) and at least one outer zone should both appear.
  assert.ok(zoneNumbers.has(0));
  assert.ok([...zoneNumbers].some((z) => z > 0));
  for (const z of r.zones) {
    assert.equal(z.geometry.type, 'Polygon');
    assert.equal(z.boundary_type, 'cost_distance');
  }
});

test('steep terrain pushes nearby cells into farther zones than flat terrain at the same distance', () => {
  const size = 21;
  const mid = Math.floor(size / 2);
  const flat = flatGrid(size, 500);
  const steep = flatGrid(size, 500);
  // A steep slope directly east of the homestead cell, same row.
  for (let c = mid + 1; c < size; c++) steep[mid * size + c] = 500 + (c - mid) * 40;

  const common = {
    latitude: 53.005, longitude: -113.995, bbox,
    rows: size, cols: size,
    homestead_point: { lat: 53.005, lon: -113.995 },
  };
  const flatResult = computeZoneSectorOverlay({ ...common, elevations: flat, parcel_id: 'slope-test-flat' });
  const steepResult = computeZoneSectorOverlay({ ...common, elevations: steep, parcel_id: 'slope-test-steep' });

  const nearCellCount = (result) => result.zones.filter((z) => z.zone_number <= 2).reduce((n, z) => n + z.cell_count, 0);
  assert.ok(nearCellCount(steepResult) <= nearCellCount(flatResult));
});

test('euclidean_fallback forces flat-terrain rings even with a DEM available', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'euclidean-forced-test',
    elevations: flatGrid(15, 500), rows: 15, cols: 15,
    homestead_point: { lat: 53.005, lon: -113.995 },
    opts: { euclidean_fallback: true },
  });
  assert.ok(r.zones.every((z) => z.boundary_type === 'euclidean'));
  assert.equal(r.confidence.zones, 'high');
});

test('no DEM grid falls back to euclidean rings with insufficient confidence', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'no-dem-test',
    homestead_point: { lat: 53.005, lon: -113.995 },
  });
  assert.ok(r.zones.length >= 1);
  assert.ok(r.zones.every((z) => z.boundary_type === 'euclidean'));
  assert.equal(r.confidence.zones, 'insufficient');
});

test('sun sectors are always available and high confidence, winter narrower than summer', () => {
  const r = computeZoneSectorOverlay({
    latitude: 53.5, longitude: -113.995, bbox, parcel_id: 'sun-sector-test',
    homestead_point: { lat: 53.005, lon: -113.995 },
  });
  assert.equal(r.confidence.sun, 'high');
  const winter = r.sectors.sun.find((s) => s.season === 'winter_solstice');
  const summer = r.sectors.sun.find((s) => s.season === 'summer_solstice');
  assert.ok(winter && summer);
  // Span = clockwise sweep from sunrise through south to sunset.
  const span = (s) => {
    const [from, to] = s.azimuth_range_deg;
    return ((to - from + 360) % 360);
  };
  assert.ok(span(winter) < span(summer));
  // Winter sunrise should be well south of due east; summer sunrise well north of it.
  assert.ok(winter.azimuth_range_deg[0] > 90);
  assert.ok(summer.azimuth_range_deg[0] < 90);
});

test('wind sectors are empty when no wind rose is available; present when it is', () => {
  const withoutWind = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'wind-sector-test-none',
    homestead_point: { lat: 53.005, lon: -113.995 },
  });
  assert.deepEqual(withoutWind.sectors.wind, []);
  assert.equal(withoutWind.confidence.wind, 'unavailable');

  const withWind = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'wind-sector-test-present',
    homestead_point: { lat: 53.005, lon: -113.995 },
    wind_rose: { available: true, primary_direction: 'NW', primary_frequency_pct: 22, source: 'NASA POWER' },
  });
  assert.equal(withWind.sectors.wind.length, 1);
  assert.equal(withWind.sectors.wind[0].label, 'prevailing_wind');
  assert.equal(withWind.confidence.wind, 'high');
});

test('fire-risk sector only appears when gated in and a wind rose is available', () => {
  const windRose = { available: true, primary_direction: 'W', source: 'NASA POWER' };
  const gatedOut = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'fire-sector-test-gated-out',
    homestead_point: { lat: 53.005, lon: -113.995 },
    wind_rose: windRose, is_in_alberta: false,
  });
  assert.deepEqual(gatedOut.sectors.fire_risk, []);
  assert.equal(gatedOut.confidence.fire_risk, 'not_applicable');

  const gatedIn = computeZoneSectorOverlay({
    latitude: 53.005, longitude: -113.995, bbox, parcel_id: 'fire-sector-test-gated-in',
    homestead_point: { lat: 53.005, lon: -113.995 },
    wind_rose: windRose, is_in_alberta: true,
  });
  assert.equal(gatedIn.sectors.fire_risk.length, 1);
  assert.ok(gatedIn.sectors.fire_risk[0].basis);
});

test('caches by (parcel_id, homestead_point) so two candidate house sites on the same parcel stay distinct', () => {
  const base = { latitude: 53.005, longitude: -113.995, bbox, elevations: flatGrid(9, 500), rows: 9, cols: 9, parcel_id: 'parcel-x' };
  const a = computeZoneSectorOverlay({ ...base, homestead_point: { lat: 53.001, lon: -113.999 } });
  const b = computeZoneSectorOverlay({ ...base, homestead_point: { lat: 53.009, lon: -113.991 } });
  assert.notEqual(a.homestead_point.lat, b.homestead_point.lat);
});
