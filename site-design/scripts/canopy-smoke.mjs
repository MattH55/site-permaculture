import { buildCanopyLayer, _internal, canopyConfidence, canopySourceNote, abmiCovers } from '../lib/canopy.js';
const { extractTrees, downsample, watershedBasins, deterministicNoise, MIN_CHM_M } = _internal;

// Synthetic 32x32 with 3 well-separated cones.
const size = 32;
const elev = new Array(size * size).fill(0);
const cones = [
  { r: 8, c: 8, rad: 5, h: 10 },
  { r: 8, c: 24, rad: 4, h: 7 },
  { r: 24, c: 16, rad: 6, h: 13 },
];
for (const { r, c, rad, h } of cones) {
  for (let rr = 0; rr < size; rr++) {
    for (let cc = 0; cc < size; cc++) {
      const d = Math.hypot(rr - r, cc - c);
      if (d < rad) elev[rr * size + cc] = Math.max(elev[rr * size + cc], h * (1 - d / rad));
    }
  }
}

// A small 200x200 m parcel ring around the centre (approx 53.55, -113.45).
const ring = [
  [-113.4515, 53.5491],
  [-113.4485, 53.5491],
  [-113.4485, 53.5509],
  [-113.4515, 53.5509],
  [-113.4515, 53.5491],
];
const bbox = { west: -113.4515, north: 53.5509, east: -113.4485, south: 53.5491 };
const chm = { rows: size, cols: size, elevations_m: elev, chm_min_m: 0, chm_max_m: 13, chm_mean_m: 2, resolution_m: 1 };

console.log('=== extractTrees with parcel ring (200x200m) ===');
const res = extractTrees(chm, bbox, {
  size, window: 8, ring, data_source: 'SYNTH', source_info: null, confidence: 'moderate',
  parcel_area_m2: 200 * 200,
});
console.log('trees:', res.tree_count);
console.log('instances:', JSON.stringify(res.tree_instances, null, 1));

// Now end-to-end: buildCanopyLayer with HRDEM (real network) for a small parcel.
console.log('\n=== buildCanopyLayer (real HRDEM, small parcel) ===');
const r2 = await buildCanopyLayer(bbox, { size: 48, window: 16, force: true, ring });
console.log('available:', r2.available, 'source:', r2.data_source, 'conf:', r2.confidence);
console.log('trees:', r2.tree_count, 'cover:', r2.canopy_cover_pct);
console.log('top 3:', JSON.stringify(r2.tree_instances.slice(0, 3), null, 1));

// Confidence + note + abmi mapping assertions.
console.assert(canopyConfidence('NRCAN_HRDEM') === 'high', 'HRDEM conf');
console.assert(canopyConfidence('GEE_GLOBAL_CANOPY_FALLBACK') === 'moderate', 'GEE conf');
console.assert(abmiCovers(bbox) === false, 'abmi disabled');
console.assert(canopySourceNote('GEE_GLOBAL_CANOPY_FALLBACK').includes('global remote-sensing'), 'GEE note');
console.log('\nDONE');
process.exit(0);

