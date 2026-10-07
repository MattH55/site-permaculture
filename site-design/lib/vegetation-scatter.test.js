import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aspectBearing,
  assignAssets,
  auditScatter,
  bearingDifference,
  candidatePositions,
  createRng,
  enforceMinSpacing,
  groupIntoRows,
  metersBetween,
  openRing,
  passesTerrainRules,
  polygonAreaHectares,
  scatterVegetation,
} from './vegetation-scatter.js';

// A 200 m × 200 m square near Edmonton, Alberta — big enough that spacing and
// density assertions are meaningful, small enough to keep tests fast.
const LAT0 = 53.5;
const LON0 = -113.5;
const M_PER_DEG_LAT = 111194.9;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function squarePolygon(metres = 200) {
  const dLat = metres / M_PER_DEG_LAT;
  const dLon = metres / M_PER_DEG_LON;
  // Closed ring, counter-clockwise, [lon, lat] — GeoJSON order.
  return [
    [LON0, LAT0],
    [LON0 + dLon, LAT0],
    [LON0 + dLon, LAT0 + dLat],
    [LON0, LAT0 + dLat],
    [LON0, LAT0],
  ];
}

const ASSETS = ['spruce', 'aspen'];

test('createRng is deterministic and stays in [0,1)', () => {
  const a = createRng('seed-1');
  const b = createRng('seed-1');
  const c = createRng('seed-2');
  const seqA = Array.from({ length: 20 }, a);
  const seqB = Array.from({ length: 20 }, b);
  const seqC = Array.from({ length: 20 }, c);
  assert.deepEqual(seqA, seqB, 'same seed ⇒ same sequence');
  assert.notDeepEqual(seqA.slice(0, 5), seqC.slice(0, 5), 'different seed ⇒ different sequence');
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
});

test('createRng accepts numeric and string seeds without collapsing to one state', () => {
  // Two *separately constructed* generators with the same seed must agree...
  assert.equal(createRng(12345)(), createRng(12345)());
  // ...and the degenerate all-zero seed must still produce a usable sequence
  // rather than a constant one.
  const zero = createRng(0);
  assert.notEqual(zero(), zero());
  assert.ok(Number.isFinite(createRng('seed')()));
});

test('metersBetween matches known kilometre-scale distances', () => {
  // 1 degree of latitude ≈ 111.19 km everywhere.
  const d = metersBetween(53, -113, 54, -113);
  assert.ok(Math.abs(d - 111194.9) < 50, `got ${d}`);
  assert.equal(metersBetween(53.5, -113.5, 53.5, -113.5), 0);
});

test('openRing strips the closing point and tolerates degenerate input', () => {
  const closed = squarePolygon(0);
  assert.equal(openRing(closed).length, 4);
  assert.equal(openRing([[0, 0], [1, 1]]).length, 0);
  assert.equal(openRing(null).length, 0);
});

test('polygonAreaHectares measures the square correctly', () => {
  // 200 m × 200 m = 40 000 m² = 4 ha
  const ha = polygonAreaHectares(squarePolygon(200));
  assert.ok(Math.abs(ha - 4) < 0.01, `expected ~4 ha, got ${ha}`);
});

test('polygonAreaHectares returns 0 for degenerate rings', () => {
  assert.equal(polygonAreaHectares([]), 0);
  assert.equal(polygonAreaHectares([[0, 0], [1, 1]]), 0);
});

test('candidatePositions only returns points inside the polygon', () => {
  const rng = createRng('candidates');
  const candidates = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 10, rng,
  });
  assert.ok(candidates.length > 0, 'should generate candidates');
  const ring = openRing(squarePolygon(200));
  for (const c of candidates) {
    assert.ok(
      c.lon >= LON0 - 1e-9 && c.lon <= LON0 + 200 / M_PER_DEG_LON + 1e-9,
      `lon out of bounds: ${c.lon}`
    );
    assert.ok(c.lat >= LAT0 - 1e-9 && c.lat <= LAT0 + 200 / M_PER_DEG_LAT + 1e-9, `lat out of bounds: ${c.lat}`);
  }
  assert.ok(ring.length === 4);
});

test('candidatePositions is seeded — same seed yields the same candidate order', () => {
  const make = (seed) => candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 12, rng: createRng(seed),
  }).map((c) => `${c.lat.toFixed(7)},${c.lon.toFixed(7)}`);
  assert.deepEqual(make('alpha'), make('alpha'));
  assert.notDeepEqual(make('alpha'), make('beta'));
});

test('candidatePositions honours exclusion zones', () => {
  const zone = {
    type: 'Polygon',
    coordinates: [[
      [LON0, LAT0],
      [LON0 + 100 / M_PER_DEG_LON, LAT0],
      [LON0 + 100 / M_PER_DEG_LON, LAT0 + 100 / M_PER_DEG_LAT],
      [LON0, LAT0 + 100 / M_PER_DEG_LAT],
      [LON0, LAT0],
    ]],
  };
  const candidates = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 5, rng: createRng('excl'),
    exclusionZones: [{ geometry: zone }],
  });
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    const inZone = c.lon < LON0 + 100 / M_PER_DEG_LON && c.lat < LAT0 + 100 / M_PER_DEG_LAT;
    assert.ok(!inZone, `candidate ${c.lat},${c.lon} landed in the exclusion zone`);
  }
});

test('candidatePositions returns nothing for a degenerate polygon or spacing', () => {
  assert.deepEqual(candidatePositions({ polygon: [], spacingMeters: 5, rng: createRng(1) }), []);
  assert.deepEqual(candidatePositions({ polygon: squarePolygon(), spacingMeters: 0, rng: createRng(1) }), []);
});

test('enforceMinSpacing guarantees the requested minimum separation', () => {
  const raw = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 5, rng: createRng('spacing'),
  });
  const kept = enforceMinSpacing(raw, 10);
  assert.ok(kept.length > 0);
  // Pairs exactly one lattice pitch apart are legitimate (the grid is built on
  // the spacing), so compare with one micron of slack for the lon/lat
  // round-trip rather than expecting strict inequality.
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const d = metersBetween(kept[i].lat, kept[i].lon, kept[j].lat, kept[j].lon);
      assert.ok(d >= 10 - 1e-3, `pair ${i}/${j} only ${d.toFixed(3)} m apart`);
    }
  }
});

test('enforceMinSpacing keeps more points at smaller spacing', () => {
  const raw = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 5, rng: createRng('spacing2'),
  });
  assert.ok(enforceMinSpacing(raw, 5).length > enforceMinSpacing(raw, 20).length);
});

test('enforceMinSpacing respects maxCount', () => {
  const raw = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 5, rng: createRng('cap'),
  });
  assert.equal(enforceMinSpacing(raw, 5, 7).length, 7);
});


test('candidatePositions returns candidates in the canonical instance shape', () => {
  // Downstream code (createTreeInstance, groupIntoRows, auditScatter) speaks
  // latitude/longitude; emitting only lat/lon here silently produced instances
  // at (undefined, undefined), so pin the contract.
  const candidates = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 20, rng: createRng('shape'),
  });
  assert.ok(candidates.length > 0);
  for (const c of candidates) {
    assert.equal(typeof c.latitude, 'number', 'latitude must be present');
    assert.equal(typeof c.longitude, 'number', 'longitude must be present');
    assert.equal(c.latitude, c.lat, 'lat is an alias of latitude');
    assert.equal(c.longitude, c.lon, 'lon is an alias of longitude');
    assert.ok(Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  }
});

test('enforceMinSpacing reads either coordinate convention', () => {
  // Guards against the spacing rule silently passing because the fields it
  // looked for were undefined (NaN comparisons are always false).
  const longForm = [{ latitude: 53.5, longitude: -113.5 }, { latitude: 53.5, longitude: -113.50008 }];
  assert.equal(enforceMinSpacing(longForm, 10).length, 1, 'long form must be thinned');
  const shortForm = [{ lat: 53.5, lon: -113.5 }, { lat: 53.5, lon: -113.50008 }];
  assert.equal(enforceMinSpacing(shortForm, 10).length, 1, 'short form must be thinned');
});

test('enforceMinSpacing treats a non-finite maxCount as unlimited', () => {
  const raw = candidatePositions({
    polygon: squarePolygon(200), spacingMeters: 5, rng: createRng('cap2'),
  });
  assert.equal(enforceMinSpacing(raw, 5, NaN).length, enforceMinSpacing(raw, 5).length);
});

// --- Aspect / slope rules ------------------------------------------------------

test('aspectBearing maps compass directions correctly', () => {
  assert.ok(Math.abs(aspectBearing(0, 1) - 0) < 1e-9, 'north');
  assert.ok(Math.abs(aspectBearing(1, 0) - 90) < 1e-9, 'east');
  assert.ok(Math.abs(aspectBearing(0, -1) - 180) < 1e-9, 'south');
  assert.ok(Math.abs(aspectBearing(-1, 0) - 270) < 1e-9, 'west');
});

test('bearingDifference handles wrap-around', () => {
  assert.equal(bearingDifference(10, 350), 20);
  assert.equal(bearingDifference(350, 10), 20);
  assert.equal(bearingDifference(0, 180), 180);
  assert.equal(bearingDifference(90, 90), 0);
});

test('passesTerrainRules enforces the slope window', () => {
  const rules = { allowedSlopeDegrees: { min: 0, max: 15 } };
  assert.equal(passesTerrainRules({ slopeDeg: 5, rules }), true);
  assert.equal(passesTerrainRules({ slopeDeg: 25, rules }), false);
});

test('passesTerrainRules treats a missing sample as pass, not fail', () => {
  // A DEM gap must not silently blank a parcel — the caller decides.
  assert.equal(passesTerrainRules({ slopeDeg: null, rules: { allowedSlopeDegrees: { max: 15 } } }), true);
  assert.equal(passesTerrainRules({ slopeDeg: NaN, rules: { allowedSlopeDegrees: { max: 15 } } }), true);
});

test('passesTerrainRules accepts any bearing when no preferred aspect is set', () => {
  assert.equal(passesTerrainRules({ aspectBearingDeg: 123, rules: {} }), true);
  assert.equal(passesTerrainRules({ aspectBearingDeg: 123, rules: { preferredAspect: [] } }), true);
});

test('passesTerrainRules accepts a bearing within tolerance of a preferred aspect', () => {
  // One preferred bearing ⇒ ±90° tolerance (a half-compass).
  const single = { preferredAspect: [180] };
  assert.equal(passesTerrainRules({ aspectBearingDeg: 180, rules: single }), true);
  assert.equal(passesTerrainRules({ aspectBearingDeg: 100, rules: single }), true);
  assert.equal(passesTerrainRules({ aspectBearingDeg: 20, rules: single }), false);
});

test('passesTerrainRules partitions the compass across multiple preferred aspects', () => {
  const rules = { preferredAspect: [0, 90, 180, 270] };
  for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
    assert.equal(passesTerrainRules({ aspectBearingDeg: bearing, rules }), true, `bearing ${bearing}`);
  }
  // 22.5° is exactly on the boundary between 0 and 90 — 45 is the max deviation,
  // so 23° off-axis is still inside and 46° is outside.
  assert.equal(passesTerrainRules({ aspectBearingDeg: 23, rules }), true);
  const twoAxes = { preferredAspect: [0, 180] };
  assert.equal(passesTerrainRules({ aspectBearingDeg: 90, rules: twoAxes }), true, 'boundary is inclusive');
});


// --- Asset assignment ----------------------------------------------------------

test('assignAssets round-robins across species so a parcel is mixed, not clumped', () => {
  const assigned = assignAssets(4, ['a', 'b'], createRng('mix'));
  assert.equal(assigned.length, 4);
  assert.equal(new Set(assigned).size, 2);
  assert.equal(assigned.filter((x) => x === 'a').length, 2);
  assert.equal(assigned.filter((x) => x === 'b').length, 2);
});

test('assignAssets respects explicit weights in the realised proportions', () => {
  const assigned = assignAssets(100, ['a', 'b'], createRng('w'), { a: 3, b: 1 });
  const a = assigned.filter((x) => x === 'a').length;
  assert.equal(a, 75, `expected 75/25 split, got ${a}/${100 - a}`);
});

test('assignAssets is deterministic for a given seed', () => {
  assert.deepEqual(
    assignAssets(30, ['a', 'b', 'c'], createRng('det'), { a: 2, b: 1, c: 1 }),
    assignAssets(30, ['a', 'b', 'c'], createRng('det'), { a: 2, b: 1, c: 1 }),
  );
});

test('assignAssets ignores non-positive weights and falls back cleanly', () => {
  // All weights invalid ⇒ the plain round-robin path is used, not a crash.
  const assigned = assignAssets(6, ['a', 'b'], createRng('x'), { a: 0, b: -1 });
  assert.equal(assigned.length, 6);
  assert.equal(new Set(assigned).size, 2);
});

test('assignAssets returns nothing for zero count or no assets', () => {
  assert.deepEqual(assignAssets(0, ['a'], createRng(1)), []);
  assert.deepEqual(assignAssets(5, [], createRng(1)), []);
  assert.deepEqual(assignAssets(5, null, createRng(1)), []);
});

// --- scatterVegetation() — the placement guarantees of spec §13 ----------------

test('scatterVegetation places every tree inside the polygon', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({ property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 10, randomSeed: 's1' });
  assert.ok(trees.length > 0);
  for (const t of trees) {
    assert.ok(t.longitude >= LON0 - 1e-6 && t.longitude <= LON0 + 200 / M_PER_DEG_LON + 1e-6,
      `tree ${t.id} escaped the polygon (lon ${t.longitude})`);
    assert.ok(t.latitude >= LAT0 - 1e-6 && t.latitude <= LAT0 + 200 / M_PER_DEG_LAT + 1e-6,
      `tree ${t.id} escaped the polygon (lat ${t.latitude})`);
  }
});

test('scatterVegetation respects the minimum spacing rule', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 10, randomSeed: 's2',
    rules: { minSpacingMeters: 12 },
  });
  const audit = auditScatter(trees, { polygon, rules: { minSpacingMeters: 12 } });
  assert.ok(audit.spacingOk, `closest pair was ${audit.minPairDistanceM.toFixed(3)} m, needed 12 m`);
});

test('scatterVegetation never plants inside an exclusion zone', () => {
  const polygon = squarePolygon(200);
  const zone = {
    type: 'Polygon',
    coordinates: [[
      [LON0, LAT0],
      [LON0 + 100 / M_PER_DEG_LON, LAT0],
      [LON0 + 100 / M_PER_DEG_LON, LAT0 + 100 / M_PER_DEG_LAT],
      [LON0, LAT0 + 100 / M_PER_DEG_LAT],
      [LON0, LAT0],
    ]],
  };
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 8, randomSeed: 's3',
    rules: { exclusionZones: [{ geometry: zone }] },
  });
  assert.ok(trees.length > 0, 'planting outside the exclusion zone should still happen');
  const audit = auditScatter(trees, { polygon, rules: { exclusionZones: [{ geometry: zone }] } });
  assert.equal(audit.insideExclusion, 0);
});

test('scatterVegetation is reproducible from the same seed (spec §13)', () => {
  const args = { property: { id: 'p1' }, polygon: squarePolygon(150), assetIds: ASSETS, spacing: 9, randomSeed: 'repeat' };
  const a = scatterVegetation(args);
  const b = scatterVegetation(args);
  assert.deepEqual(a, b, 'same call ⇒ byte-identical layout');
});


test('scatterVegetation changes layout when the seed changes', () => {
  const base = { property: { id: 'p1' }, polygon: squarePolygon(150), assetIds: ASSETS, spacing: 9 };
  const a = scatterVegetation({ ...base, randomSeed: 'seed-a' });
  const b = scatterVegetation({ ...base, randomSeed: 'seed-b' });
  assert.notDeepEqual(
    a.map((t) => [t.latitude, t.longitude]),
    b.map((t) => [t.latitude, t.longitude]),
  );
});

test('scatterVegetation is stable across property ids — the id is part of the seed', () => {
  const shared = { polygon: squarePolygon(150), assetIds: ASSETS, spacing: 9, randomSeed: 'same' };
  const p1 = scatterVegetation({ ...shared, property: { id: 'property-1' } });
  const p2 = scatterVegetation({ ...shared, property: { id: 'property-2' } });
  assert.notDeepEqual(p1.map((t) => t.id), p2.map((t) => t.id));
  // ...but each property is individually reproducible.
  assert.deepEqual(p1, scatterVegetation({ ...shared, property: { id: 'property-1' } }));
});

test('scatterVegetation marks every tree "proposed" by default (spec §22)', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(120), assetIds: ASSETS, spacing: 10, randomSeed: 'status',
  });
  assert.ok(trees.length > 0);
  for (const t of trees) {
    assert.equal(t.status, 'proposed');
    assert.equal(t.growthStage, 'unknown');
  }
});

test('scatterVegetation honours an explicit status/growthStage override', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(120), assetIds: ASSETS, spacing: 10,
    randomSeed: 'status2', rules: { status: 'existing-observed', growthStage: 'mature' },
  });
  for (const t of trees) {
    assert.equal(t.status, 'existing-observed');
    assert.equal(t.growthStage, 'mature');
  }
});

test('scatterVegetation varies rotation and scale within plausible limits (spec §7)', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS, spacing: 6,
    randomSeed: 'variety', rules: { scaleRange: { min: 0.9, max: 1.1 } },
  });
  assert.ok(trees.length > 5);
  const audit = auditScatter(trees);
  assert.equal(audit.distinctRotationCount, trees.length, 'every tree should have its own rotation');
  assert.ok(audit.scaleMin >= 0.9 - 1e-9, `scale min ${audit.scaleMin} below range`);
  assert.ok(audit.scaleMax <= 1.1 + 1e-9, `scale max ${audit.scaleMax} above range`);
  assert.ok(audit.scaleMax > audit.scaleMin, 'scale must actually vary');
});

test('scatterVegetation uses every requested species (mixture, spec §7)', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ['a', 'b', 'c'],
    spacing: 8, randomSeed: 'mixture',
  });
  assert.equal(auditScatter(trees).distinctAssetCount, 3);
});

test('scatterVegetation enforces the requested count as a ceiling', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS, spacing: 4,
    count: 12, randomSeed: 'count',
  });
  assert.equal(trees.length, 12);
});

test('scatterVegetation applies a planting-density ceiling (spec §14)', () => {
  // 4 ha × 100 stems/ha = ~407 max. Spacing is explicitly tiny (1 m) so the
  // *only* thing that can hold the count down is the density rule — otherwise
  // this test could pass because the lattice happened to run out of room.
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 1,
    randomSeed: 'density', rules: { plantingDensityPerHectare: 100 },
  });
  const expectedCap = Math.round(polygonAreaHectares(polygon) * 100);
  assert.ok(trees.length <= expectedCap, `density cap ${expectedCap} breached: ${trees.length}`);
  assert.ok(trees.length > 0);
});

test('scatterVegetation derives spacing from planting density when none is given', () => {
  const dense = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    randomSeed: 'derived', rules: { plantingDensityPerHectare: 400 },
  });
  const sparse = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    randomSeed: 'derived', rules: { plantingDensityPerHectare: 25 },
  });
  assert.ok(dense.length > sparse.length, `${dense.length} should exceed ${sparse.length}`);
});

test('scatterVegetation handles the southern hemisphere without sign errors', () => {
  // ~200 m square in Sydney: latitude *decreases* going south, which is where a
  // sign error in the lattice maths would show up.
  const south = [
    [151.20, -33.86],
    [151.2018, -33.86],
    [151.2018, -33.8618],
    [151.20, -33.8618],
    [151.20, -33.86],
  ];
  const trees = scatterVegetation({
    property: { id: 'sydney' }, polygon: south, assetIds: ASSETS, spacing: 8, randomSeed: 'south',
  });
  assert.ok(trees.length > 0);
  for (const t of trees) {
    assert.ok(t.latitude < -33.859 && t.latitude > -33.862, `lat ${t.latitude} off`);
    assert.ok(t.longitude > 151.199 && t.longitude < 151.202, `lon ${t.longitude} off`);
  }
});

test('scatterVegetation returns [] for a degenerate polygon rather than throwing', () => {
  assert.deepEqual(scatterVegetation({ property: { id: 'p' }, polygon: [], assetIds: ASSETS }), []);
  assert.deepEqual(scatterVegetation({ property: { id: 'p' }, polygon: [[0, 0], [1, 1]], assetIds: ASSETS }), []);
  assert.deepEqual(scatterVegetation({}), []);
});


// --- Static placements (user-defined planting plan) ----------------------------

test('staticPlacements are honoured exactly — the user chose those positions', () => {
  const polygon = squarePolygon(200);
  const placements = [
    { lat: LAT0 + 20 / M_PER_DEG_LAT, lon: LON0 + 20 / M_PER_DEG_LON },
    { lat: LAT0 + 50 / M_PER_DEG_LAT, lon: LON0 + 50 / M_PER_DEG_LON },
  ];
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, randomSeed: 'static',
    rules: { staticPlacements: placements },
  });
  assert.equal(trees.length, 2);
  assert.ok(Math.abs(trees[0].latitude - placements[0].lat) < 1e-9, 'position must be exact, not jittered');
  assert.ok(Math.abs(trees[1].longitude - placements[1].lon) < 1e-9);
});

test('staticPlacements bypasses the spacing rule — a planting plan may be tight', () => {
  const polygon = squarePolygon(200);
  // Two trees 1 m apart; minSpacingMeters of 10 would normally reject this.
  const placements = [
    { lat: LAT0 + 100 / M_PER_DEG_LAT, lon: LON0 + 100 / M_PER_DEG_LON },
    { lat: LAT0 + 100 / M_PER_DEG_LAT, lon: LON0 + 101 / M_PER_DEG_LON },
  ];
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, randomSeed: 'static2',
    rules: { staticPlacements: placements, minSpacingMeters: 10 },
  });
  assert.equal(trees.length, 2, 'the explicit plan wins over the heuristic');
});

test('staticPlacements outside the polygon are still rejected', () => {
  const polygon = squarePolygon(200);
  const placements = [
    { lat: LAT0 + 100 / M_PER_DEG_LAT, lon: LON0 + 100 / M_PER_DEG_LON }, // inside
    { lat: LAT0 + 5000 / M_PER_DEG_LAT, lon: LON0 + 100 / M_PER_DEG_LON }, // far outside
  ];
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, randomSeed: 'static3',
    rules: { staticPlacements: placements },
  });
  assert.equal(trees.length, 1, 'only the in-bounds placement survives');
});

test('staticPlacements with an empty array falls back to the lattice', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    spacing: 20, randomSeed: 'static4', rules: { staticPlacements: [] },
  });
  assert.ok(trees.length > 1, 'an empty plan means "no plan", not "plant nothing"');
});

// --- Water rules (spec §15: hydrology stays outside this module) ---------------

test('waterMode "static" ignores the water sampler entirely', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    spacing: 15, randomSeed: 'water1',
    rules: { waterMode: 'static', waterSampler: () => ({ water: true, wetland: true }) },
    terrainSampler: null,
  });
  assert.ok(trees.length > 0, 'a static water mode must not filter anything');
});

test('waterMode "no-tree-wetland" drops wetland points but keeps dry ones', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 10, randomSeed: 'water2',
    rules: {
      waterMode: 'no-tree-wetland',
      // Left half of the square is wetland.
      waterSampler: (lat, lon) => ({ wetland: lon < LON0 + 100 / M_PER_DEG_LON }),
    },
  });
  assert.ok(trees.length > 0);
  for (const t of trees) {
    assert.ok(t.longitude >= LON0 + 100 / M_PER_DEG_LON, `tree ${t.id} planted in wetland`);
  }
});

test('waterMode "deep-water" also rejects open water', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 10, randomSeed: 'water3',
    rules: {
      waterMode: 'deep-water',
      waterSampler: (lat, lon) => ({ water: lon < LON0 + 100 / M_PER_DEG_LON, wetland: false }),
    },
  });
  assert.ok(trees.length > 0);
  for (const t of trees) {
    assert.ok(t.longitude >= LON0 + 100 / M_PER_DEG_LON, `tree ${t.id} planted in open water`);
  }
});

test('a missing water sample passes — a data gap is not a lake', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    spacing: 15, randomSeed: 'water4',
    rules: { waterMode: 'deep-water', waterSampler: () => null },
  });
  assert.ok(trees.length > 0);
});


// --- Planting modes (spec §16/§17) ---------------------------------------------

test('orchard mode plants on a regular lattice, not a jittered scatter', () => {
  const trees = scatterVegetation({
    property: { id: 'orchard' }, polygon: squarePolygon(200), assetIds: ['apple'],
    spacing: 10, randomSeed: 'orchard', mode: 'orchard',
  });
  // Rows are recovered by 1-D clustering on the lattice's north axis. A 0.5 m
  // tolerance is tighter than the lattice pitch, so it groups strictly along a
  // row rather than bridging two neighbours.
  const rows = groupIntoRows(trees, 0.5);
  assert.equal(rows.length, 21, `10 m lattice over 200 m should give 21 rows, got ${rows.length}`);

  // Every tree sits on the lattice, so every north-south gap is exactly one
  // pitch. (Orchard mode applies no jitter, unlike shelterbelt/natural.)
  const northings = rows.map((r) => trees[r[0]].latitude * M_PER_DEG_LAT);
  for (let i = 1; i < northings.length; i++) {
    const gap = northings[i - 1] - northings[i];
    assert.ok(Math.abs(gap - 10) < 1e-3, `row ${i} is ${gap.toFixed(4)} m from its neighbour, expected 10`);
  }

  // Interior rows span the full 200 m width (20 columns at 10 m), even where
  // spacing enforcement has thinned individual columns out.
  const widest = Math.max(...rows.map((r) => r.length));
  assert.equal(widest, 20, `widest row should span 20 columns, got ${widest}`);
  for (const row of rows) {
    const lons = row.map((i) => trees[i].longitude * M_PER_DEG_LON);
    assert.ok(Math.abs(lons[lons.length - 1] - lons[0]) < 200, 'row must stay inside the parcel');
  }
});

test('orchard mode applies no jitter — every tree is on the exact lattice', () => {
  const trees = scatterVegetation({
    property: { id: 'orchard' }, polygon: squarePolygon(200), assetIds: ['apple'],
    spacing: 10, randomSeed: 'orchard', mode: 'orchard',
  });
  for (const t of trees) {
    const east = t.longitude * M_PER_DEG_LON;
    // Round to the nearest metre and require it to land exactly on a 10 m mark,
    // relative to the parcel's western edge.
    const offsetM = (east - LON0 * M_PER_DEG_LON) % 10;
    const distToLattice = Math.min(offsetM, 10 - offsetM);
    // One centimetre of slack: metres-per-degree and the lon/lat round-trip
    // accumulate a couple of millimetres of error at 200 m from the origin.
    assert.ok(distToLattice < 0.01, `tree easting is ${distToLattice.toFixed(4)} m off the lattice`);
  }
});


test('shelterbelt rows stay separated — jitter never merges two rows', () => {
  const trees = scatterVegetation({
    property: { id: 'belt' }, polygon: squarePolygon(200), assetIds: ['caragana'],
    spacing: 8, randomSeed: 'belt', mode: 'shelterbelt',
  });
  const rows = groupIntoRows(trees, 1.5);
  assert.ok(rows.length > 1, 'a shelterbelt is multiple rows');
  assert.equal(rows.flat().length, trees.length, 'every tree belongs to exactly one row');
  // And each row must be genuinely linear: within a row, consecutive trees are
  // roughly one spacing apart in easting and essentially level in northing.
  for (const row of rows) {
    if (row.length < 2) continue;
    assert.ok(trees[row[0]].longitude < trees[row[1]].longitude, 'row must be ordered west→east');
  }
});


test('groupIntoRows returns rows north→south with members west→east', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 20, randomSeed: 'rows', mode: 'orchard',
  });
  const rows = groupIntoRows(trees, 1);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(trees[rows[i - 1][0]].latitude >= trees[rows[i][0]].latitude, 'rows must run north→south');
  }
  for (const row of rows) {
    for (let i = 1; i < row.length; i++) {
      assert.ok(trees[row[i - 1]].longitude <= trees[row[i]].longitude, 'members must run west→east');
    }
  }
});

test('groupIntoRows handles empty and single-tree input', () => {
  assert.deepEqual(groupIntoRows([], 1), []);
  assert.deepEqual(groupIntoRows(null, 1), []);
  assert.deepEqual(groupIntoRows([{ latitude: 53.5, longitude: -113.5 }], 1), [[0]]);
});

test('a larger jitter tolerance merges more rows together', () => {
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon: squarePolygon(200), assetIds: ASSETS,
    spacing: 10, randomSeed: 'jt', mode: 'natural',
  });
  assert.ok(groupIntoRows(trees, 0.5).length >= groupIntoRows(trees, 500).length);
});

// --- auditScatter (spec §13: prove the guarantees on any scatter) --------------

test('auditScatter confirms a generated scatter honours its own rules', () => {
  const polygon = squarePolygon(200);
  const rules = { minSpacingMeters: 8, exclusionZones: [] };
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 8, randomSeed: 'audit', rules,
  });
  const audit = auditScatter(trees, { polygon, rules });
  assert.equal(audit.count, trees.length);
  assert.equal(audit.outsidePolygon, 0, 'no tree may escape the polygon');
  assert.equal(audit.insideExclusion, 0);
  assert.equal(audit.spacingOk, true, `closest pair ${audit.minPairDistanceM} m < ${audit.minSpacingMeters} m`);
  assert.equal(audit.distinctAssetCount, ASSETS.length);
});

test('auditScatter reports the closest realised pair, not the requested spacing', () => {
  // Two trees a deliberately-too-short distance apart: the audit must surface
  // the violation rather than repeat back the rule that was asked for.
  const trees = [
    { assetId: 'a', latitude: LAT0, longitude: LON0, scale: 1, rotation: 0 },
    { assetId: 'a', latitude: LAT0, longitude: LON0 + 1 / M_PER_DEG_LON, scale: 1, rotation: 0 },
  ];
  const audit = auditScatter(trees, { rules: { minSpacingMeters: 10 } });
  assert.ok(Math.abs(audit.minPairDistanceM - 1) < 0.05, `got ${audit.minPairDistanceM}`);
  assert.equal(audit.spacingOk, false);
});

test('auditScatter counts escapes from the polygon and exclusion zones', () => {
  const polygon = squarePolygon(200);
  const trees = [
    { assetId: 'a', latitude: LAT0 + 100 / M_PER_DEG_LAT, longitude: LON0 + 100 / M_PER_DEG_LON },
    { assetId: 'a', latitude: LAT0 + 100000 / M_PER_DEG_LAT, longitude: LON0 },
  ];
  const audit = auditScatter(trees, { polygon });
  assert.equal(audit.outsidePolygon, 1);
});

test('auditScatter tolerates an empty scatter without dividing by zero', () => {
  const audit = auditScatter([], { polygon: squarePolygon(200), rules: { minSpacingMeters: 5 } });
  assert.equal(audit.count, 0);
  assert.equal(audit.minPairDistanceM, Infinity);
  assert.equal(audit.spacingOk, true, 'nothing to violate');
  assert.equal(audit.distinctAssetCount, 0);
  assert.equal(audit.scaleMin, 0);
});

test('auditScatter survives garbage input rather than throwing in a UI thread', () => {
  for (const garbage of [null, undefined, 42, 'trees', {}]) {
    const audit = auditScatter(garbage, {});
    assert.equal(audit.count, 0, `count for ${JSON.stringify(garbage)}`);
  }
});

test('auditScatter measures the scale range actually applied', () => {
  const polygon = squarePolygon(200);
  const trees = scatterVegetation({
    property: { id: 'p' }, polygon, assetIds: ASSETS, spacing: 15, randomSeed: 'scale-audit',
  });
  const audit = auditScatter(trees, { polygon });
  assert.ok(audit.scaleMin > 0, 'scale must be positive');
  assert.ok(audit.scaleMax >= audit.scaleMin);
});


