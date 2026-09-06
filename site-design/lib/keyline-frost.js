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
  const risk = new Array(rows*cols).fill('low'), zones=[];
  for (let r=1;r<rows-1;r++) for (let c=1;c<cols-1;c++) {
    const v=at(r,c); if (!Number.isFinite(v)) continue;
    const ns=[at(r-1,c),at(r+1,c),at(r,c-1),at(r,c+1)].filter(Number.isFinite);
    const mean=ns.reduce((a,b)=>a+b,0)/ns.length, closed=ns.every(x=>x>=v), lowRel=v < mean-0.35;
    if (closed || lowRel) { const level=closed?'high':'moderate'; risk[r*cols+c]=level; const [w,n]=local(r,c), e=w+(bbox.east-bbox.west)/(cols-1), s=n-(bbox.north-bbox.south)/(rows-1); zones.push({geometry:{type:'Polygon',coordinates:[[[w,n],[e,n],[e,s],[w,s],[w,n]]]},risk_level:level,basis:[...(closed?['closed_depression']:[]),...(lowRel?['low_relative_elevation']:[])]}); }
  }
  return { keyline:{...base,primary_valleys:low?[{valley_id:'valley-1',talweg:{type:'LineString',coordinates:[[local(0,low.c)[0],bbox.north],[local(rows-1,low.c)[0],bbox.south]]},keypoint,keyline,guide_lines:guides}]:[]}, frost:{...base,frost_pocket_raster:{rows,cols,values:risk,bbox},risk_zones:zones} };
}
