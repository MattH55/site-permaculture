/** DTM derivatives for keyline screening and frost-pocket zones. */
export function deriveKeylineAndFrost(grid, bbox, source = {}) {
  const coarse = !grid?.available || !grid.elevations_m?.length || Number(grid.resolution_m || 90) > 5;
  const base = { data_source: grid?.source || source.source || 'coarse DEM', confidence: coarse ? 'insufficient' : 'high' };
  if (coarse) return {
    keyline: { ...base, primary_valleys: [], status: 'insufficient_resolution' },
    frost: { ...base, frost_pocket_raster: null, risk_zones: [], note: 'Coarse DEM can only support broad landform screening.' },
  };
  const { rows, cols, elevations_m: z } = grid;
  const at = (r,c) => z[r * cols + c];
  const cellM = Math.max(1, Math.sqrt(Math.abs((bbox.east-bbox.west)*(bbox.north-bbox.south))) * 111320 / Math.sqrt(rows*cols));
  const local = (r,c) => [bbox.west + (c/(cols-1))*(bbox.east-bbox.west), bbox.north - (r/(rows-1))*(bbox.north-bbox.south)];
  // A parcel-scale valley candidate is the lowest interior cell; curvature along
  // its steepest cardinal transect gives an explicit resolved/ambiguous result.
  let low = null;
  for (let r=2;r<rows-2;r++) for (let c=2;c<cols-2;c++) if (Number.isFinite(at(r,c)) && (!low || at(r,c)<low.z)) low={r,c,z:at(r,c)};
  let keypoint = { status: 'undetermined' }, keyline = null;
  if (low) {
    const candidates=[];
    for (let r=2;r<rows-2;r++) { const a=at(r-1,low.c),b=at(r,low.c),d=at(r+1,low.c); if ([a,b,d].every(Number.isFinite) && (a-2*b+d)>0.08) candidates.push({r,curve:a-2*b+d}); }
    candidates.sort((a,b)=>b.curve-a.curve);
    if (candidates.length === 1 || (candidates[0] && candidates[0].curve > (candidates[1]?.curve||0)*1.35)) {
      const r=candidates[0].r, p=local(r,low.c); keypoint={lat:p[1],lon:p[0],elevation_m:at(r,low.c),status:'resolved'};
      keyline={type:'LineString',coordinates:[[bbox.west,p[1]],[bbox.east,p[1]]]};
    } else if (candidates.length) keypoint={status:'ambiguous'};
  }
  const guides = keyline ? [-2,-1,1,2].map(n=>({geometry:{type:'LineString',coordinates:[[bbox.west,keyline.coordinates[0][1]+n*cellM/111320],[bbox.east,keyline.coordinates[1][1]+n*cellM/111320]]},offset_m:n*cellM})) : [];
  const risk = new Array(rows*cols).fill('low');
  const basisAt = new Array(rows*cols).fill(null);
  // Relative-elevation flag uses a windowed TPI (target ~30m neighborhood,
  // per the frost-pocket spec) rather than the immediate 4 neighbors —
  // a 1-cell radius is noise-sensitive and flags scattered single cells
  // instead of coherent low/flat areas.
  const tpiRadius = Math.max(1, Math.round(30 / cellM));
  for (let r=1;r<rows-1;r++) for (let c=1;c<cols-1;c++) {
    const v=at(r,c); if (!Number.isFinite(v)) continue;
    const immediate=[at(r-1,c),at(r+1,c),at(r,c-1),at(r,c+1)].filter(Number.isFinite);
    // Require a minimum depth below every neighbor, not just "no lower
    // neighbor" — a bare >= test fires on any interpolation-noise tie and
    // floods flat/gently-undulating terrain with false depressions.
    const closed = immediate.length === 4 && immediate.every(x=>x-v>=0.15);
    const window = [];
    for (let dr=-tpiRadius; dr<=tpiRadius; dr++) for (let dc=-tpiRadius; dc<=tpiRadius; dc++) {
      if (dr===0 && dc===0) continue;
      const rr=r+dr, cc=c+dc;
      if (rr<0||rr>=rows||cc<0||cc>=cols) continue;
      const x = at(rr,cc);
      if (Number.isFinite(x)) window.push(x);
    }
    const mean = window.length ? window.reduce((a,b)=>a+b,0)/window.length : v;
    const lowRel = window.length >= 4 && v < mean-0.35;
    if (closed || lowRel) {
      risk[r*cols+c] = closed ? 'high' : 'moderate';
      basisAt[r*cols+c] = [...(closed?['closed_depression']:[]),...(lowRel?['low_relative_elevation']:[])];
    }
  }
  // Merge adjacent flagged cells (4-connectivity) into discrete zones sized
  // meaningfully at planting scale, rather than emitting one polygon per
  // raster cell — a component's polygon is the convex hull of its cells'
  // corners, which is a reasonable "avoid this area" envelope for siting.
  const dLng = (bbox.east-bbox.west)/(cols-1), dLat = (bbox.north-bbox.south)/(rows-1);
  const visited = new Array(rows*cols).fill(false);
  const zones = [];
  for (let r=1;r<rows-1;r++) for (let c=1;c<cols-1;c++) {
    const idx = r*cols+c;
    if (risk[idx] === 'low' || visited[idx]) continue;
    const stack = [idx], cells = [];
    visited[idx] = true;
    let hasHigh = false;
    const basisSet = new Set();
    while (stack.length) {
      const cur = stack.pop();
      cells.push(cur);
      const cr = Math.floor(cur / cols), cc = cur % cols;
      if (risk[cur] === 'high') hasHigh = true;
      (basisAt[cur] || []).forEach((b) => basisSet.add(b));
      for (const [nr, nc] of [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]]) {
        if (nr < 1 || nr >= rows-1 || nc < 1 || nc >= cols-1) continue;
        const nIdx = nr*cols+nc;
        if (visited[nIdx] || risk[nIdx] === 'low') continue;
        visited[nIdx] = true;
        stack.push(nIdx);
      }
    }
    // A lone flagged cell from the relative-elevation test is more likely
    // sensor/grid noise than a real cold-air trap; a closed depression is
    // meaningful even at one cell (it's an actual local low point).
    if (cells.length < 2 && !hasHigh) continue;
    const corners = [];
    for (const cell of cells) {
      const cr = Math.floor(cell / cols), cc = cell % cols;
      const [w, n] = local(cr, cc);
      corners.push([w, n], [w + dLng, n], [w + dLng, n - dLat], [w, n - dLat]);
    }
    const hull = convexHull(corners);
    if (hull.length < 3) continue;
    zones.push({
      geometry: { type: 'Polygon', coordinates: [[...hull, hull[0]]] },
      risk_level: hasHigh ? 'high' : 'moderate',
      basis: [...basisSet],
      cell_count: cells.length,
    });
  }
  return { keyline:{...base,primary_valleys:low?[{valley_id:'valley-1',talweg:{type:'LineString',coordinates:[[local(0,low.c)[0],bbox.north],[local(rows-1,low.c)[0],bbox.south]]},keypoint,keyline,guide_lines:guides}]:[]}, frost:{...base,frost_pocket_raster:{rows,cols,values:risk,bbox},risk_zones:zones} };
}

/** Andrew's monotone chain convex hull. Input/output: [[x,y], ...]. */
function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const build = (seq) => {
    const hull = [];
    for (const p of seq) {
      while (hull.length >= 2 && cross(hull[hull.length-2], hull[hull.length-1], p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower, ...upper];
}
