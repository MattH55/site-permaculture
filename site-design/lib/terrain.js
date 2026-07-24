/**
 * Slope / aspect / landform from a sampled elevation grid.
 * Pure JS finite differences — no GDAL required for MVP.
 */

const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * @param {number[]} elevations flat row-major array length rows*cols
 * @param {{ rows: number, cols: number, west: number, south: number, east: number, north: number }} meta
 */
export function analyzeTerrain(elevations, meta) {
  const { rows, cols, west, south, east, north } = meta;
  const midLat = (south + north) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const cellW = ((east - west) / cols) * mPerDegLng;
  const cellH = ((north - south) / rows) * mPerDegLat;

  const valid = elevations.filter((z) => z != null && Number.isFinite(z));
  if (valid.length < 4) {
    return {
      elevation_m: null,
      elevation_min_m: null,
      elevation_max_m: null,
      slope_percent: null,
      aspect: 'flat',
      landform_position: null,
      keypoint_present: null,
      erosion_risk: null,
      slope_stats: null,
    };
  }

  const elevMean = mean(valid);
  const elevMin = Math.min(...valid);
  const elevMax = Math.max(...valid);

  const slopes = [];
  const aspects = [];
  const slopeGrid = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const z = at(elevations, r, c, cols);
      const zl = at(elevations, r, c - 1, cols);
      const zr = at(elevations, r, c + 1, cols);
      const zd = at(elevations, r - 1, c, cols); // south-ish depending on grid order
      const zu = at(elevations, r + 1, c, cols);
      if (![z, zl, zr, zd, zu].every((v) => v != null && Number.isFinite(v))) continue;

      // Horn-like gradient
      const dzdx = (zr - zl) / (2 * cellW);
      const dzdy = (zu - zd) / (2 * cellH);
      const slopeRad = Math.atan(Math.hypot(dzdx, dzdy));
      const slopePct = Math.tan(slopeRad) * 100;
      slopes.push(slopePct);
      slopeGrid[r][c] = slopePct;

      // Aspect: 0 = N, clockwise — atan2(dzdx, dzdy)
      let aspectDeg = (Math.atan2(dzdx, dzdy) * 180) / Math.PI;
      if (aspectDeg < 0) aspectDeg += 360;
      if (slopePct < 0.5) aspects.push('flat');
      else aspects.push(degToAspect(aspectDeg));
    }
  }

  const slopeMean = slopes.length ? mean(slopes) : 0;
  const slopeP90 = slopes.length ? percentile(slopes, 90) : 0;
  const slopeMax = slopes.length ? Math.max(...slopes) : 0;
  // Design slope: robust mid-high value so one ditch doesn't dominate
  const designSlope = round1(Math.max(slopeMean, slopeP90 * 0.65));

  const aspect = mode(aspects.filter((a) => a !== 'flat')) || 'flat';
  const landform = inferLandform(elevations, rows, cols, elevMean, elevMin, elevMax);
  const keypoint = detectKeypoint(elevations, slopeGrid, rows, cols);
  const erosion = inferErosion(designSlope, slopeMax);

  return {
    elevation_m: round1(elevMean),
    elevation_min_m: round1(elevMin),
    elevation_max_m: round1(elevMax),
    slope_percent: designSlope,
    aspect,
    landform_position: landform,
    keypoint_present: keypoint,
    erosion_risk: erosion,
    slope_stats: {
      mean: round1(slopeMean),
      p90: round1(slopeP90),
      max: round1(slopeMax),
      samples: slopes.length,
    },
  };
}

function at(arr, r, c, cols) {
  return arr[r * cols + c];
}

function degToAspect(deg) {
  const i = Math.round(deg / 45) % 8;
  return ASPECTS[i];
}

function inferLandform(elevations, rows, cols, meanZ, minZ, maxZ) {
  const range = maxZ - minZ;
  if (range < 1.5) return 'flat_upland';

  // Compare centre vs edges
  const cr = Math.floor(rows / 2);
  const cc = Math.floor(cols / 2);
  const centre = at(elevations, cr, cc, cols);
  if (centre == null || !Number.isFinite(centre)) return 'mid_slope';

  const edgeVals = [];
  for (let c = 0; c < cols; c++) {
    pushFinite(edgeVals, at(elevations, 0, c, cols));
    pushFinite(edgeVals, at(elevations, rows - 1, c, cols));
  }
  for (let r = 0; r < rows; r++) {
    pushFinite(edgeVals, at(elevations, r, 0, cols));
    pushFinite(edgeVals, at(elevations, r, cols - 1, cols));
  }
  if (!edgeVals.length) return 'mid_slope';
  const edgeMean = mean(edgeVals);
  const rel = centre - edgeMean;

  if (rel > range * 0.25) return 'ridge';
  if (rel < -range * 0.25) {
    if (range > 8) return 'valley_floor';
    return 'depression';
  }
  if (centre > meanZ + range * 0.1) return 'upper_slope';
  if (centre < meanZ - range * 0.1) return 'lower_slope';
  return 'mid_slope';
}

/**
 * Heuristic: slope decreases downslope (convex→concave inflection)
 * across a significant fraction of the grid.
 */
function detectKeypoint(elevations, slopeGrid, rows, cols) {
  let hits = 0;
  let checks = 0;
  for (let r = 2; r < rows - 2; r++) {
    for (let c = 2; c < cols - 2; c++) {
      const s0 = slopeGrid[r - 1]?.[c];
      const s1 = slopeGrid[r]?.[c];
      const s2 = slopeGrid[r + 1]?.[c];
      if (s0 == null || s1 == null || s2 == null) continue;
      checks++;
      // Concave: slope decreasing as we move "down" elevation
      const zUp = at(elevations, r - 1, c, cols);
      const zDn = at(elevations, r + 1, c, cols);
      if (zUp == null || zDn == null) continue;
      const downhillIncreasingR = zDn < zUp;
      if (downhillIncreasingR && s0 > s1 && s1 > s2 && s0 - s2 > 1.5) hits++;
    }
  }
  if (checks < 5) return false;
  return hits / checks > 0.08;
}

function inferErosion(designSlope, slopeMax) {
  if (slopeMax >= 25 || designSlope >= 15) return 'high';
  if (slopeMax >= 12 || designSlope >= 6) return 'moderate';
  return 'low';
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo];
  return s[lo] * (hi - i) + s[hi] * (i - lo);
}

function mode(arr) {
  if (!arr.length) return null;
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  let best = null;
  let n = 0;
  for (const [k, c] of m) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function pushFinite(arr, v) {
  if (v != null && Number.isFinite(v)) arr.push(v);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
