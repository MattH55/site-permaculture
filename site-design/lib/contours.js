/**
 * Contour-line length estimator from the site's sampled elevation grid.
 *
 * Feeds rate-engine.js's recommendSwaleMeters(), which expects
 * { elevationM, lengthM } pairs shaped like a real DEM/contour export.
 * We already sample an elevation grid for topology/slope (see sources.js
 * + topology.js), so this is the "reduction step" the rate-engine's
 * integration guide describes — done here with a coarse marching-squares
 * pass over that same grid rather than a separate LiDAR pipeline.
 *
 * This is a planning-level estimate, not a substitute for a designer
 * walking the real contour map before excavation.
 */

const M_PER_DEG_LAT = 111_320;

/**
 * @param {number[]} elevations row-major, length rows*cols
 * @param {{ rows: number, cols: number }} meta
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 * @param {{ intervalM?: number }} [opts]
 * @returns {{ elevationM: number, lengthM: number }[]}
 */
export function generateContourLines(elevations, meta, bbox, opts = {}) {
  const { rows, cols } = meta || {};
  if (!rows || !cols || !Array.isArray(elevations) || elevations.length < rows * cols) {
    return [];
  }

  const valid = elevations.filter((z) => z != null && Number.isFinite(z));
  if (valid.length < 4) return [];

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const intervalM = opts.intervalM || 0.5;
  if (max - min < intervalM) return [];

  const midLat = (bbox.south + bbox.north) / 2;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const cellW = ((bbox.east - bbox.west) / (cols - 1)) * mPerDegLng;
  const cellH = ((bbox.north - bbox.south) / (rows - 1)) * M_PER_DEG_LAT;

  const levels = [];
  const start = Math.ceil(min / intervalM) * intervalM;
  for (let z = start; z < max; z += intervalM) levels.push(round1(z));

  const lengthByLevel = new Map(levels.map((l) => [l, 0]));

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = elevations[r * cols + c];
      const tr = elevations[r * cols + c + 1];
      const bl = elevations[(r + 1) * cols + c];
      const br = elevations[(r + 1) * cols + c + 1];
      if ([tl, tr, bl, br].some((v) => v == null || !Number.isFinite(v))) continue;

      const cellMin = Math.min(tl, tr, bl, br);
      const cellMax = Math.max(tl, tr, bl, br);
      for (const level of levels) {
        if (level <= cellMin || level >= cellMax) continue;
        const len = cellCrossingLength(tl, tr, bl, br, level, cellW, cellH);
        if (len > 0) lengthByLevel.set(level, lengthByLevel.get(level) + len);
      }
    }
  }

  return levels
    .map((elevationM) => ({ elevationM, lengthM: round1(lengthByLevel.get(elevationM) || 0) }))
    .filter((l) => l.lengthM > 0);
}

/**
 * Marching-squares contour length through one grid cell.
 * Corners: tl (0,0), tr (w,0), br (w,h), bl (0,h) — y grows downward.
 */
function cellCrossingLength(tl, tr, bl, br, level, w, h) {
  const idx =
    (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);

  const pN = () => [((level - tl) / (tr - tl)) * w, 0];
  const pS = () => [((level - bl) / (br - bl)) * w, h];
  const pW = () => [0, ((level - tl) / (bl - tl)) * h];
  const pE = () => [w, ((level - tr) / (br - tr)) * h];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  switch (idx) {
    case 0:
    case 15:
      return 0;
    case 1:
    case 14:
      return dist(pW(), pS());
    case 2:
    case 13:
      return dist(pS(), pE());
    case 3:
    case 12:
      return dist(pW(), pE());
    case 4:
    case 11:
      return dist(pN(), pE());
    case 6:
    case 9:
      return dist(pN(), pS());
    case 7:
    case 8:
      return dist(pN(), pW());
    case 5:
      // Saddle — ambiguous case, resolve as two separate crossings.
      return dist(pN(), pW()) + dist(pS(), pE());
    case 10:
      return dist(pN(), pE()) + dist(pW(), pS());
    default:
      return 0;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
