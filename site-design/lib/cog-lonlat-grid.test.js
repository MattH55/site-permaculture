import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleImageToLonLatGrid, gridConvergenceDeg } from './cog-lonlat-grid.js';
import { lonLatToEpsg3979 } from './vegetation-indices.js';

/**
 * A synthetic EPSG:3979-like raster whose value is a known function of
 * projected (x, y): z = f(x, y). Resampling it onto a lat/lon grid must give
 * back f(project(lon, lat)) at each output cell — independent of the
 * projection's rotation, which is exactly what the old window read got wrong.
 */
function syntheticImage({ originX, originY, res, width, height, f }) {
  return {
    getOrigin: () => [originX, originY],
    getResolution: () => [res, -res],
    getWidth: () => width,
    getHeight: () => height,
    async readRasters({ window: [c0, r0, c1, r1], width: rw, height: rh }) {
      const out = new Float32Array(rw * rh);
      for (let j = 0; j < rh; j++) {
        for (let i = 0; i < rw; i++) {
          // Pixel centre in source coordinates after downsampling.
          const col = c0 + ((i + 0.5) / rw) * (c1 - c0);
          const row = r0 + ((j + 0.5) / rh) * (r1 - r0);
          const x = originX + col * res;
          const y = originY - row * res;
          out[j * rw + i] = f(x, y);
        }
      }
      out.width = rw;
      out.height = rh;
      return [out];
    },
  };
}

const bbox = { west: -113.6515, south: 53.8011, east: -113.6479, north: 53.8033 };
const [cx, cy] = lonLatToEpsg3979((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2);

function imageAround(f) {
  // 2 m raster, origin 2 km north-west of the parcel centre.
  return syntheticImage({ originX: cx - 2000, originY: cy + 2000, res: 2, width: 2000, height: 2000, f });
}

test('row 0 is north, col 0 is west, and values follow true lat/lon (not grid) position', async () => {
  // z rises with projected y (northing). On a north-up lat/lon grid the top
  // row must therefore be the highest — and each cell must equal the plane
  // evaluated at that cell's own projected position.
  const f = (x, y) => 600 + (y - cy) * 0.01 + (x - cx) * 0.002;
  const g = await resampleImageToLonLatGrid(imageAround(f), bbox, 16);
  assert.equal(g.rows, 16);
  assert.equal(g.cols, 16);
  const row = (r) => g.elevations_m.slice(r * 16, r * 16 + 16);
  assert.ok(avg(row(0)) > avg(row(15)), 'north row should be higher');
  for (const [r, c] of [[0, 0], [0, 15], [15, 0], [15, 15], [7, 8]]) {
    const lat = bbox.north - (r / 15) * (bbox.north - bbox.south);
    const lon = bbox.west + (c / 15) * (bbox.east - bbox.west);
    const [x, y] = lonLatToEpsg3979(lon, lat);
    assert.ok(Math.abs(g.elevations_m[r * 16 + c] - f(x, y)) < 0.25, `cell ${r},${c} should match the plane at its true position`);
  }
});

test('a ridge running true east–west stays east–west on the output grid', async () => {
  // Ridge along the centre latitude: in PROJECTED space that line is rotated
  // ~17° from the raster's x axis, so a naive window read would tilt it.
  const latMid = (bbox.south + bbox.north) / 2;
  const f = (x, y) => {
    // Distance from the true E–W line through the centre: invert via the
    // projection locally (the ridge is defined in lat/lon, sampled in x/y).
    // Build the ridge as the set of projected points of (lon, latMid).
    const [, yLine] = lonLatToEpsg3979(xToLon(x), latMid);
    return 600 + Math.max(0, 40 - Math.abs(y - yLine) * 0.5);
  };
  function xToLon(x) {
    // Local inverse along the centre latitude: x is ~linear in lon over 400 m.
    const [xa] = lonLatToEpsg3979(bbox.west, latMid);
    const [xb] = lonLatToEpsg3979(bbox.east, latMid);
    return bbox.west + ((x - xa) / (xb - xa)) * (bbox.east - bbox.west);
  }
  const g = await resampleImageToLonLatGrid(imageAround(f), bbox, 32);
  // Peak row for the west column and for the east column must coincide.
  const peakRow = (c) => {
    let best = -Infinity, br = -1;
    for (let r = 0; r < 32; r++) { const z = g.elevations_m[r * 32 + c]; if (z > best) { best = z; br = r; } }
    return br;
  };
  assert.equal(peakRow(0), peakRow(31), 'ridge should not tilt across the grid');
  assert.ok(Math.abs(peakRow(0) - 15.5) <= 1, 'ridge should sit on the centre latitude');
});

test('nodata cells are skipped in the bilinear average and reported as null when isolated', async () => {
  const f = (x, y) => (x < cx - 40 ? -9999 : 700);
  const g = await resampleImageToLonLatGrid(imageAround(f), bbox, 8);
  assert.ok(g.elevations_m.some((z) => z === null), 'west strip should be nodata');
  assert.ok(g.elevations_m.some((z) => z === 700), 'east side should be valid');
  assert.equal(g.max, 700);
});

test('all-nodata window returns null, never a fabricated surface', async () => {
  const g = await resampleImageToLonLatGrid(imageAround(() => -9999), bbox, 8);
  assert.equal(g, null);
});

test('reports the source grid convergence (~17° at Edmonton-area longitudes in EPSG:3979)', () => {
  const deg = gridConvergenceDeg(lonLatToEpsg3979, bbox);
  // West of the −95° central meridian true north lies clockwise of grid
  // north, so the sign is positive here; magnitude ≈ n·Δλ ≈ 0.9 × 18.6°.
  assert.ok(deg > 14 && deg < 20, `expected ≈ +17°, got ${deg}`);
});

function avg(a) { const v = a.filter((z) => z != null); return v.reduce((s, z) => s + z, 0) / v.length; }
