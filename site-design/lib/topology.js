/**
 * Topology summary for site reports: elevation grid samples + profile for UI.
 */

/**
 * @param {number[]} elevations row-major
 * @param {{ rows: number, cols: number }} meta
 */
export function buildTopologyView(elevations, meta, terrain) {
  const { rows, cols } = meta;
  const valid = elevations.filter((z) => z != null && Number.isFinite(z));
  if (!valid.length) {
    return {
      elevation_m: null,
      elevation_min_m: null,
      elevation_max_m: null,
      relief_m: null,
      profile: [],
      grid: { rows: 0, cols: 0, values: [] },
      landform_position: terrain?.landform_position || null,
      aspect: terrain?.aspect || null,
      slope_percent: terrain?.slope_percent ?? null,
      keypoint_present: !!terrain?.keypoint_present,
    };
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;

  // Mid-row west→east elevation profile for a simple cross-section chart
  const mid = Math.floor(rows / 2);
  const profile = [];
  for (let c = 0; c < cols; c++) {
    const z = elevations[mid * cols + c];
    if (z != null && Number.isFinite(z)) profile.push(round1(z));
  }

  // Normalize grid 0–1 for heatmap (keep raw too for tooltips)
  const values = elevations.map((z) => {
    if (z == null || !Number.isFinite(z)) return null;
    if (max === min) return 0.5;
    return Math.round(((z - min) / (max - min)) * 1000) / 1000;
  });

  return {
    elevation_m: round1(mean),
    elevation_min_m: round1(min),
    elevation_max_m: round1(max),
    relief_m: round1(max - min),
    profile,
    grid: { rows, cols, values, elevations_m: elevations.map((z) => (z == null ? null : round1(z))) },
    landform_position: terrain?.landform_position || null,
    aspect: terrain?.aspect || null,
    slope_percent: terrain?.slope_percent ?? null,
    slope_stats: terrain?.slope_stats || null,
    keypoint_present: !!terrain?.keypoint_present,
    erosion_risk: terrain?.erosion_risk || null,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
