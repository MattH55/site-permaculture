/**
 * Resample a projected Cloud-Optimized GeoTIFF window into a NORTH-UP
 * lat/lon-aligned grid — the orientation every consumer in this pipeline
 * assumes (row 0 = bbox.north, col 0 = bbox.west; see the
 * `bbox.north - (r / (rows - 1)) * …` convention in solar-horizon-shading.js,
 * pond-hydrology.js, plantable-area.js and the 3D viewer's latLonToLocal()).
 *
 * Why this exists: HRDEM (and the DSM/DTM pair canopy.js derives its CHM
 * from) are served in EPSG:3979, Canada Atlas Lambert. Previously both
 * modules read the 3979-aligned rectangle enclosing the parcel and handed it
 * over as if it were the lat/lon bbox. But a Lambert grid's "up" is grid
 * north, which at Alberta longitudes is rotated well away from true north —
 * about 17° at −113.6° (the projection's central meridian is −95°). The
 * terrain, its contours, the canopy and every tree position were therefore
 * drawn rotated ~17° (and slightly stretched, since the enclosing rectangle
 * is larger than the bbox) against roads, buildings, water and the parcel
 * boundary, which are all placed by true lat/lon.
 *
 * Here each output cell's lat/lon is projected INTO the raster and sampled
 * bilinearly, so the result is a true north-up grid regardless of the
 * source projection. Pure resampling logic takes a GeoTIFF-image-like object
 * so it is unit-testable without a network.
 */

import { fromUrl } from 'geotiff';
import { lonLatToEpsg3979 } from './vegetation-indices.js';

const DEFAULTS = Object.freeze({
  project: lonLatToEpsg3979,
  nodataLo: -1000,
  nodataHi: 9000,
  maxReadSide: 512,
  padFraction: 0.05,
  minPadM: 20,
});

/**
 * Open a COG and resample it to a north-up lat/lon grid over `bbox`.
 * @param {string} href
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {number} size output grid side (rows = cols = size)
 * @param {Partial<typeof DEFAULTS>} [opts]
 */
export async function sampleCogToLonLatGrid(href, bbox, size, opts = {}) {
  const tiff = await fromUrl(href, { allowFullFile: false, blockSize: 65536 });
  const img = await tiff.getImage();
  return resampleImageToLonLatGrid(img, bbox, size, opts);
}

/**
 * @param {{getOrigin:()=>number[], getResolution:()=>number[], getWidth:()=>number,
 *   getHeight:()=>number, readRasters:(o:object)=>Promise<any>}} img
 *   geotiff.js GeoTIFFImage (or a test double with the same surface)
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @param {number} size
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {Promise<null|{rows:number, cols:number, elevations_m:(number|null)[],
 *   min:number, max:number, mean:number, grid_orientation:string,
 *   source_grid_convergence_deg:number}>}
 */
export async function resampleImageToLonLatGrid(img, bbox, size, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const origin = img.getOrigin();
  const [resX, resY] = img.getResolution();
  const w = img.getWidth();
  const h = img.getHeight();

  // Projected rectangle enclosing the (rotated-in-projection) lat/lon bbox,
  // padded so bilinear sampling at the edges has neighbours.
  const corners = [
    o.project(bbox.west, bbox.south),
    o.project(bbox.east, bbox.south),
    o.project(bbox.west, bbox.north),
    o.project(bbox.east, bbox.north),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const pad = Math.max((x1 - x0) * o.padFraction, (y1 - y0) * o.padFraction, o.minPadM);
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;

  const toCol = (x) => (x - origin[0]) / resX;
  const toRow = (y) => (y - origin[1]) / resY; // resY < 0 for north-up rasters → row grows southward
  let c0 = Math.floor(Math.min(toCol(x0), toCol(x1)));
  let c1 = Math.ceil(Math.max(toCol(x0), toCol(x1)));
  let r0 = Math.floor(Math.min(toRow(y0), toRow(y1)));
  let r1 = Math.ceil(Math.max(toRow(y0), toRow(y1)));
  c0 = clamp(c0, 0, w - 1);
  c1 = clamp(c1, c0 + 1, w);
  r0 = clamp(r0, 0, h - 1);
  r1 = clamp(r1, r0 + 1, h);

  // Read the WHOLE window, downsampled if it is large — never crop it (the
  // old code cropped to a centred 512² block, losing the parcel's edges on
  // big parcels).
  const winW = c1 - c0;
  const winH = r1 - r0;
  const scale = Math.max(1, winW / o.maxReadSide, winH / o.maxReadSide);
  const readW = Math.max(2, Math.round(winW / scale));
  const readH = Math.max(2, Math.round(winH / scale));
  const rasters = await img.readRasters({
    window: [c0, r0, c1, r1],
    width: readW,
    height: readH,
    resampleMethod: 'bilinear',
  });
  const band = rasters[0];
  const bw = Number(rasters.width) || readW;
  const bh = Number(rasters.height) || readH;
  const sx = bw / winW; // read-grid pixels per source pixel
  const sy = bh / winH;

  const valid = (v) => v != null && Number.isFinite(v) && v >= o.nodataLo && v <= o.nodataHi;
  const at = (col, row) => band[clamp(row, 0, bh - 1) * bw + clamp(col, 0, bw - 1)];

  const out = new Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  const denomR = Math.max(size - 1, 1);
  const denomC = Math.max(size - 1, 1);
  for (let r = 0; r < size; r++) {
    const lat = bbox.north - (r / denomR) * (bbox.north - bbox.south);
    for (let c = 0; c < size; c++) {
      const lon = bbox.west + (c / denomC) * (bbox.east - bbox.west);
      const [x, y] = o.project(lon, lat);
      // Continuous read-grid coordinates, pixel-centre convention.
      const u = (toCol(x) - c0) * sx - 0.5;
      const v = (toRow(y) - r0) * sy - 0.5;
      const z = bilinear(at, valid, u, v);
      const i = r * size + c;
      if (z == null) { out[i] = null; continue; }
      const zr = Math.round(z * 10) / 10;
      out[i] = zr;
      if (zr < min) min = zr;
      if (zr > max) max = zr;
      sum += zr;
      n++;
    }
  }
  if (!n) return null;
  return {
    rows: size,
    cols: size,
    elevations_m: out,
    min: round1(min),
    max: round1(max),
    mean: round1(sum / n),
    grid_orientation: 'north-up lat/lon grid: row 0 = bbox.north, col 0 = bbox.west',
    source_grid_convergence_deg: gridConvergenceDeg(o.project, bbox),
  };
}

/**
 * Nodata-aware bilinear sample. Neighbours that are nodata drop out of the
 * weighted average; all-nodata → null.
 */
function bilinear(at, valid, u, v) {
  const u0 = Math.floor(u);
  const v0 = Math.floor(v);
  const fu = u - u0;
  const fv = v - v0;
  const taps = [
    [u0, v0, (1 - fu) * (1 - fv)],
    [u0 + 1, v0, fu * (1 - fv)],
    [u0, v0 + 1, (1 - fu) * fv],
    [u0 + 1, v0 + 1, fu * fv],
  ];
  let acc = 0;
  let wsum = 0;
  for (const [col, row, wt] of taps) {
    if (wt <= 0) continue;
    const z = at(col, row);
    if (!valid(z)) continue;
    acc += z * wt;
    wsum += wt;
  }
  return wsum > 0 ? acc / wsum : null;
}

/**
 * Angle (degrees, clockwise-positive) between the source projection's grid
 * north and true north at the bbox centre — i.e. how far the old
 * unreprojected grid was rotated. Reported for transparency.
 */
export function gridConvergenceDeg(project, bbox) {
  const lon = (bbox.west + bbox.east) / 2;
  const lat = (bbox.south + bbox.north) / 2;
  const [x0, y0] = project(lon, lat);
  const [x1, y1] = project(lon, lat + 1e-4);
  return Math.round((Math.atan2(x1 - x0, y1 - y0) * 180 / Math.PI) * 10) / 10;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
