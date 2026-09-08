/**
 * D8 flow accumulation + per-cell steepest-descent slope from a row-major
 * DEM grid.
 *
 * New shared terrain primitive, factored out for the location-suitability
 * scoring layers (suitability-pond.js, suitability-wind.js) — no prior
 * flow-accumulation grid existed in this pipeline to reuse. The existing
 * pond-siting screen (pond-hydrology.js scorePondCandidates) uses a cheaper
 * relief+convergence proxy instead of true flow routing; this module is the
 * real thing, computed once and shared, so anything downstream that needs
 * upstream-contributing-area can reuse it instead of re-deriving another
 * proxy.
 *
 * Method: for every DEM cell, route its flow to the single steepest-descent
 * neighbour among its 8 neighbours (standard D8), then accumulate cell
 * counts downstream in descending-elevation order so every upstream
 * contributor has already been added before a cell passes its total along.
 * This is a planning-level screen, not a hydrologically-conditioned
 * flow-routing model (no pit-filling/depression-breaching pass) — small
 * DEM noise can create unrouted local sinks, which simply accumulate no
 * further than themselves.
 */
export function computeFlowAccumulation({ elevations, rows, cols, bbox }) {
  if (!Array.isArray(elevations) || !rows || !cols || elevations.length < rows * cols || !bbox) {
    return { available: false, reason: 'No complete DEM grid and bounding box were supplied.' };
  }

  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const cellAreaM2 = Math.max(cellWidthM * cellHeightM, 1);
  const n = rows * cols;
  const at = (r, c) => elevations[r * cols + c];

  const slopePercent = new Array(n).fill(null);
  const downstream = new Array(n).fill(-1);
  const valid = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const z = at(r, c);
      if (!Number.isFinite(z)) continue;
      valid.push(idx);
      let best = -1;
      let bestDrop = 0; // steepest downhill grade (rise/run), fraction
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nz = at(nr, nc);
          if (!Number.isFinite(nz)) continue;
          const dist = Math.hypot(dr * cellHeightM, dc * cellWidthM);
          const drop = (z - nz) / dist;
          if (drop > bestDrop) {
            bestDrop = drop;
            best = nr * cols + nc;
          }
        }
      }
      downstream[idx] = best;
      slopePercent[idx] = bestDrop > 0 ? bestDrop * 100 : 0;
    }
  }

  if (!valid.length) return { available: false, reason: 'No usable interior DEM cells were found.' };

  // Each cell starts by draining its own footprint, then hands its running
  // total to its single downstream neighbour, processed highest-elevation
  // first so contributions flow through in one pass.
  const accumulationCells = new Array(n).fill(0);
  for (const idx of valid) accumulationCells[idx] = 1;
  const byElevDesc = [...valid].sort((a, b) => elevations[b] - elevations[a]);
  for (const idx of byElevDesc) {
    const down = downstream[idx];
    if (down >= 0) accumulationCells[down] += accumulationCells[idx];
  }

  const contributingAreaM2 = accumulationCells.map((a) => a * cellAreaM2);

  return {
    available: true,
    rows,
    cols,
    bbox,
    cellWidthM,
    cellHeightM,
    cellAreaM2,
    accumulation_cells: accumulationCells,
    contributing_area_m2: contributingAreaM2,
    slope_percent: slopePercent,
    downstream,
    method: 'D8 single-flow-direction routing, planning-level (no pit-filling pass)',
  };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function deg2rad(d) { return (d * Math.PI) / 180; }
