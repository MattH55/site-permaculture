import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlantableArea, _internal } from './plantable-area.js';

const bbox = { west: -114, south: 53, east: -113.982, north: 53.018 }; // ~1.6km wide, gentle grid

function flatElevations(size, base = 900) {
  return new Array(size * size).fill(base);
}

function steppedElevations(size, dropPerRow = 3) {
  // A real slope from north to south. bbox rows are ~200m apart here, so
  // dropPerRow needs to clear ~30m to cross the 15% terrace threshold.
  const z = new Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) z[r * size + c] = r * dropPerRow;
  return z;
}

test('unavailable without a DEM grid', () => {
  const result = computePlantableArea({});
  assert.equal(result.available, false);
});

test('flat open parcel with no exclusions produces one large patch', () => {
  const size = 11;
  const result = computePlantableArea({ elevations: flatElevations(size), rows: size, cols: size, bbox });
  assert.equal(result.available, true);
  assert.equal(result.planting_zones.length, 1);
  assert.ok(result.planting_zones[0].area_m2 > 0);
  assert.deepEqual(result.hard_exclusions_applied, []);
});

test('a mapped water body excludes cells and is reported', () => {
  const size = 11;
  const waterRing = [[-113.994, 53.012], [-113.99, 53.012], [-113.99, 53.008], [-113.994, 53.008], [-113.994, 53.012]];
  const result = computePlantableArea({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    surface_water: { water_bodies: [{ geometry: { type: 'Polygon', coordinates: [waterRing] } }] },
    config: { riparian_buffer_m: 5 }, // small buffer so the test parcel isn't entirely swallowed
  });
  assert.equal(result.available, true);
  assert.ok(result.hard_exclusions_applied.includes('existing_water') || result.hard_exclusions_applied.includes('riparian_buffer'));
});

test('a structure footprint excludes cells and is reported', () => {
  const size = 11;
  const bldgRing = [[-113.993, 53.011], [-113.991, 53.011], [-113.991, 53.009], [-113.993, 53.009], [-113.993, 53.011]];
  const result = computePlantableArea({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    structures: { available: true, footprints: [{ geometry: { type: 'Polygon', coordinates: [bldgRing] } }], confidence: 'high' },
    config: { structure_buffer_m: 2 },
  });
  assert.ok(result.hard_exclusions_applied.some((r) => r.startsWith('structure')));
});

test('existing canopy (CHM above threshold) is excluded, not scored', () => {
  const size = 11;
  const chmSize = 11;
  const values = new Array(chmSize * chmSize).fill(0.3); // below threshold everywhere...
  for (let r = 3; r <= 6; r++) for (let c = 3; c <= 6; c++) values[r * chmSize + c] = 8; // ...except a dense block
  const result = computePlantableArea({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    canopy: { available: true, data_source: 'NRCAN_HRDEM', confidence: 'high', chm: { rows: chmSize, cols: chmSize, values_m: values }, tree_instances: [], render_zones: [] },
  });
  assert.ok(result.hard_exclusions_applied.includes('existing_canopy'));
  // The canopy block splits the middle out — total open area should be less than the full flat-parcel case.
  const flatResult = computePlantableArea({ elevations: flatElevations(size), rows: size, cols: size, bbox });
  const totalArea = (r) => r.planting_zones.reduce((s, z) => s + z.area_m2, 0);
  assert.ok(totalArea(result) < totalArea(flatResult));
});

test('steep terrain is tagged, not excluded', () => {
  const size = 11;
  const result = computePlantableArea({ elevations: steppedElevations(size, 50), rows: size, cols: size, bbox });
  assert.equal(result.available, true);
  const anyTagged = result.planting_zones.some((z) => z.constraints.includes('steep_terracing_required'));
  assert.ok(anyTagged);
  // still counted as plantable area, not removed
  assert.ok(result.planting_zones.reduce((s, z) => s + z.area_m2, 0) > 0);
});

test('frost-pocket risk is tagged, not excluded', () => {
  const size = 11;
  const values = new Array(size * size).fill('low');
  for (let r = 3; r <= 6; r++) for (let c = 3; c <= 6; c++) values[r * size + c] = 'high';
  const result = computePlantableArea({
    elevations: flatElevations(size), rows: size, cols: size, bbox,
    frost: { data_source: 'test', frost_pocket_raster: { rows: size, cols: size, bbox, values } },
  });
  const anyTagged = result.planting_zones.some((z) => z.constraints.includes('frost_risk'));
  assert.ok(anyTagged);
});

test('tracePatchBoundary: a solid 2x2 block traces one closed ring', () => {
  const cols = 4, rows = 4;
  const cells = [1 * cols + 1, 1 * cols + 2, 2 * cols + 1, 2 * cols + 2]; // r,c in {1,2}
  const local = (r, c) => [c, r]; // identity mapping for the geometry check
  const geom = _internal.tracePatchBoundary(cells, cols, local, { west: 0, east: 10, north: 0, south: 10 }, rows);
  assert.equal(geom.type, 'Polygon');
  assert.equal(geom.coordinates.length, 1); // no hole
  const ring = geom.coordinates[0];
  assert.ok(ring.length >= 5); // closed ring: >=4 distinct corners + repeat of first
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test('tracePatchBoundary: a ring of cells around a hole traces outer + inner rings', () => {
  const cols = 3, rows = 3;
  const cells = [0, 1, 2, 3, 5, 6, 7, 8]; // full 3x3 minus the centre cell (index 4)
  const local = (r, c) => [c, r];
  const geom = _internal.tracePatchBoundary(cells, cols, local, { west: 0, east: 10, north: 0, south: 10 }, rows);
  assert.equal(geom.coordinates.length, 2); // outer + one hole
});
