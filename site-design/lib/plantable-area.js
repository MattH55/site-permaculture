/**
 * Available planting space identification — a polygon layer of open ground
 * actually available for NEW planting, built from layered exclusions and
 * constraints over layers already in the pipeline (canopy, water, slope,
 * frost-pocket) plus structure footprints (structures.js). This is
 * deliberately not a suitability score over the whole parcel — it answers
 * "here are the specific patches you can plant," not "this parcel scores
 * well for orchard crops in general."
 *
 * See plantable-area-identification-instructions.md.
 *
 * Hard exclusions (removed from the candidate area entirely):
 *  - existing canopy above a configurable height threshold (already
 *    vegetated — understory/guild planting beneath existing canopy is a
 *    legitimate future use case but out of scope here)
 *  - mapped water bodies + a riparian buffer (PLACEHOLDER distance pending
 *    an actual regulatory figure for the jurisdiction — this is the first
 *    module in the pipeline to need this number; suitability-wind.js's
 *    boundary/dwelling setback follows the same "flag it explicitly"
 *    convention)
 *  - structure footprints + a small buffer
 *
 * Soft constraints (tagged, not excluded):
 *  - slope above the swale/terrace threshold already used elsewhere in the
 *    pipeline (rules.js: 2-15% swale, >15% terrace) — tagged
 *    'steep_terracing_required' rather than dropped
 *  - moderate/high frost-pocket risk — tagged 'frost_risk', not excluded
 *    (unsuitable for frost-sensitive species specifically, not unplantable)
 */

import { computeFlowAccumulation } from './flow-accumulation.js';
import {
  pointInAnyPolygon, distanceToNearestFeatureM, haversineM,
  slopeAspectAt, compassBucket8, sampleRasterAtLatLon,
  weakestConfidence, cachedSuitability, clamp, round0, round1,
} from './suitability-common.js';

const DEFAULT_CONFIG = {
  canopy_height_threshold_m: 2,
  riparian_buffer_m: 30, // PLACEHOLDER — pending an actual regulatory figure for the jurisdiction
  riparian_buffer_is_placeholder: true,
  structure_buffer_m: 3,
  slope_terrace_threshold_pct: 15, // matches rules.js's swale(<=15%)/terrace(>15%) convention
  min_patch_area_m2: 15,
};

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {Array<[number,number]>} [opts.parcel_ring] [lon,lat] ring — restricts patches to the actual parcel, not just its bbox
 * @param {object} [opts.canopy] buildCanopyLayer() result
 * @param {object} [opts.surface_water] getSurfaceWaterLayer() result
 * @param {object} [opts.structures] getStructureFootprints() result (structures.js)
 * @param {object} [opts.soil_data] getSoilData() result
 * @param {object} [opts.frost] deriveKeylineAndFrost().frost result
 * @param {object} [opts.config]
 * @param {string} [opts.parcel_id] Enables per-parcel caching
 */
export function computePlantableArea(opts = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const compute = () => computeUncached(opts, cfg);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(opts.parcel_id, [
    'plantable', opts.rows, opts.cols,
    opts.canopy?.data_source, opts.canopy?._meta?.cache,
    opts.surface_water?._meta?.generated_at,
    opts.soil_data?.soil_data_source,
    opts.structures?.source_counts?.merged,
    opts.frost?.data_source,
  ], compute);
}

function computeUncached(opts, cfg) {
  const flow = computeFlowAccumulation({ elevations: opts.elevations, rows: opts.rows, cols: opts.cols, bbox: opts.bbox });
  if (!flow.available) return emptyResult(flow.reason || 'No complete DEM grid supplied.');

  const { rows, cols, bbox, cellWidthM, cellHeightM, cellAreaM2, slope_percent } = flow;
  const at = (r, c) => opts.elevations[r * cols + c];
  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];

  const waterBodies = opts.surface_water?.water_bodies || [];
  const structureFootprints = opts.structures?.footprints || [];
  const treeInstances = opts.canopy?.available && Array.isArray(opts.canopy.tree_instances) ? opts.canopy.tree_instances : [];
  const denseZones = (opts.canopy?.render_zones || []).filter((z) => z.render_mode === 'billboard_impostor');
  const chmRaster = opts.canopy?.chm?.values_m?.length
    ? { rows: opts.canopy.chm.rows, cols: opts.canopy.chm.cols, bbox, values: opts.canopy.chm.values_m }
    : null;
  const frostRaster = opts.frost?.frost_pocket_raster || null;
  const parcelRing = Array.isArray(opts.parcel_ring) && opts.parcel_ring.length >= 3 ? opts.parcel_ring : null;

  const open = new Array(rows * cols).fill(false);
  const exclusionCounts = {};
  const tally = (reason) => { exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1; };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!Number.isFinite(at(r, c))) continue;
      const [lon, lat] = local(r, c);
      if (parcelRing && !pointInPolygonRing(lon, lat, parcelRing)) continue; // outside the parcel — not part of the candidate area at all

      const reason = exclusionReason({ lat, lon, waterBodies, structureFootprints, treeInstances, denseZones, chmRaster, cfg });
      if (reason) { tally(reason); continue; }
      open[idx] = true;
    }
  }

  const components = connectedComponents(open, rows, cols);
  const zones = [];
  for (const cells of components) {
    const areaM2 = cells.length * cellAreaM2;
    if (areaM2 < cfg.min_patch_area_m2) { tally('sliver_below_min_area'); continue; }

    const slopes = [];
    const aspectSinSum = { s: 0, c: 0 };
    const frostLevels = [];
    let minWaterDistM = Infinity;

    for (const idx of cells) {
      const r = Math.floor(idx / cols), c = idx % cols;
      const [lon, lat] = local(r, c);
      const s = slope_percent[idx];
      if (Number.isFinite(s)) slopes.push(s);
      const { aspectDeg } = slopeAspectAt({ r, c, at, rows, cols, cellWidthM, cellHeightM });
      if (aspectDeg != null) {
        aspectSinSum.s += Math.sin((aspectDeg * Math.PI) / 180);
        aspectSinSum.c += Math.cos((aspectDeg * Math.PI) / 180);
      }
      if (frostRaster) {
        const level = sampleRasterAtLatLon(frostRaster, lat, lon);
        if (level) frostLevels.push(level);
      }
      if (waterBodies.length) {
        const d = distanceToNearestFeatureM(lat, lon, waterBodies);
        if (d < minWaterDistM) minWaterDistM = d;
      }
    }

    const avgSlopePct = slopes.length ? slopes.reduce((a, b) => a + b, 0) / slopes.length : 0;
    const dominantAspect = (aspectSinSum.s || aspectSinSum.c)
      ? compassBucket8((Math.atan2(aspectSinSum.s, aspectSinSum.c) * 180) / Math.PI)
      : null;
    const frostRiskLevel = worstFrostLevel(frostLevels);

    const constraints = [];
    if (avgSlopePct > cfg.slope_terrace_threshold_pct) constraints.push('steep_terracing_required');
    if (frostRiskLevel === 'moderate' || frostRiskLevel === 'high') constraints.push('frost_risk');

    const soilUnit = opts.soil_data?.soil_units?.[0];
    const canopyConfidence = opts.canopy?.available === false ? 'unavailable' : (opts.canopy?.confidence || 'moderate');
    const soilConfidence = opts.soil_data?.soil_data_source === 'AGRASID' ? 'high' : (opts.soil_data?.soil_data_source ? 'moderate_low' : 'unavailable');
    const structuresConfidence = opts.structures?.confidence || 'unavailable';
    const waterConfidence = opts.surface_water?.available === false ? 'unavailable' : 'moderate';

    zones.push({
      geometry: tracePatchBoundary(cells, cols, local, bbox, rows),
      area_m2: round0(areaM2),
      avg_slope_pct: round1(avgSlopePct),
      dominant_aspect: dominantAspect,
      soil_texture_class: soilUnit?.texture_class || null,
      frost_risk_level: frostRiskLevel,
      distance_to_water_m: Number.isFinite(minWaterDistM) ? round0(minWaterDistM) : null,
      constraints,
      contributing_sources: {
        canopy: opts.canopy?.data_source || 'not supplied',
        water: opts.surface_water?.source_name || opts.surface_water?._meta?.primary_source || 'not supplied',
        slope: 'D8 flow-accumulation slope (flow-accumulation.js)',
        soil: opts.soil_data?.soil_data_source || 'not supplied',
        structures: opts.structures?.available
          ? `merged Microsoft/OSM (${opts.structures.source_counts?.microsoft || 0} MS, ${opts.structures.source_counts?.osm || 0} OSM)`
          : 'not supplied',
      },
      confidence: weakestConfidence([canopyConfidence, soilConfidence, structuresConfidence, waterConfidence]),
    });
  }

  zones.sort((a, b) => b.area_m2 - a.area_m2);

  return {
    available: zones.length > 0,
    planting_zones: zones,
    hard_exclusions_applied: Object.keys(exclusionCounts).filter((k) => k !== 'sliver_below_min_area'),
    slivers_discarded: exclusionCounts.sliver_below_min_area || 0,
    thresholds: {
      canopy_height_threshold_m: cfg.canopy_height_threshold_m,
      riparian_buffer_m: cfg.riparian_buffer_m,
      riparian_buffer_is_placeholder: cfg.riparian_buffer_is_placeholder,
      structure_buffer_m: cfg.structure_buffer_m,
      slope_terrace_threshold_pct: cfg.slope_terrace_threshold_pct,
      min_patch_area_m2: cfg.min_patch_area_m2,
    },
    data_source: {
      canopy: opts.canopy?.data_source || 'not supplied',
      water: opts.surface_water?.source_name || 'not supplied',
      structures: opts.structures?.data_source || 'not supplied',
      soil: opts.soil_data?.soil_data_source || 'not supplied',
      frost: opts.frost?.data_source || 'not supplied',
    },
    confidence: weakestConfidence(zones.map((z) => z.confidence)),
    assumptions: [
      `Riparian buffer (${cfg.riparian_buffer_m} m) is a PLACEHOLDER pending an actual regulatory figure for the jurisdiction.`,
      'Soil texture is sampled once per parcel (soil_data.soil_units[0]), not truly per-patch — same limitation carried by every other layer that consumes this soil data.',
      'Patch boundaries are traced from the DEM grid resolution, not a true sub-cell vector boundary — small patches near that resolution are approximate.',
    ],
  };
}

function emptyResult(reason) {
  return {
    available: false,
    planting_zones: [],
    hard_exclusions_applied: [],
    slivers_discarded: 0,
    thresholds: {},
    data_source: {},
    confidence: 'insufficient',
    reason,
  };
}

function exclusionReason({ lat, lon, waterBodies, structureFootprints, treeInstances, denseZones, chmRaster, cfg }) {
  if (pointInAnyPolygon(lon, lat, waterBodies)) return 'existing_water';
  if (waterBodies.length && distanceToNearestFeatureM(lat, lon, waterBodies) <= cfg.riparian_buffer_m) return 'riparian_buffer';
  if (pointInAnyPolygon(lon, lat, structureFootprints)) return 'structure_footprint';
  if (structureFootprints.length && distanceToNearestFeatureM(lat, lon, structureFootprints) <= cfg.structure_buffer_m) return 'structure_buffer';
  if (chmRaster) {
    const h = sampleRasterAtLatLon(chmRaster, lat, lon);
    if (h != null && h >= cfg.canopy_height_threshold_m) return 'existing_canopy';
  }
  if (treeInstances.some((t) => {
    const treeLat = t.x ?? t.lat, treeLon = t.y ?? t.lon; // canopy.js stores {x:lat,y:lon} — see solar-horizon-shading.js note
    if (treeLat == null || treeLon == null || !(t.height_m >= cfg.canopy_height_threshold_m)) return false;
    return haversineM(lat, lon, treeLat, treeLon) <= (t.crown_radius_m || 1.5);
  })) return 'existing_canopy';
  if (pointInAnyPolygon(lon, lat, denseZones)) return 'existing_canopy';
  return null;
}

function connectedComponents(open, rows, cols) {
  const visited = new Array(rows * cols).fill(false);
  const components = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (!open[start] || visited[start]) continue;
      const cells = [];
      const stack = [start];
      visited[start] = true;
      while (stack.length) {
        const cur = stack.pop();
        cells.push(cur);
        const cr = Math.floor(cur / cols), cc = cur % cols;
        for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (visited[nIdx] || !open[nIdx]) continue;
          visited[nIdx] = true;
          stack.push(nIdx);
        }
      }
      components.push(cells);
    }
  }
  return components;
}

function worstFrostLevel(levels) {
  if (levels.includes('high')) return 'high';
  if (levels.includes('moderate')) return 'moderate';
  if (levels.length) return 'low';
  return 'low';
}

function pointInPolygonRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Trace the true rectilinear outline of a connected component of DEM cells
 * (a union of grid squares), rather than a convex hull — an open patch is
 * frequently non-convex (an L-shaped clearing, a ring around a small pond),
 * and a convex hull would silently paint over the excluded ground between
 * its lobes. Standard "walk each cell clockwise, keep only edges exposed to
 * a non-member neighbour" boundary trace: every exposed edge is emitted in
 * a fixed per-cell orientation, so chaining edges head-to-tail always closes
 * into simple loops — the largest-area loop is the outer boundary, any
 * remaining loops are holes (e.g. a small excluded pond fully inside an
 * otherwise-open patch), returned as GeoJSON interior rings.
 */
function tracePatchBoundary(cellIdxs, cols, local, bbox, rows) {
  const cellSet = new Set(cellIdxs);
  // Bounds-check BOTH r and c before the flat-index lookup — an unchecked
  // c<0 or c>=cols (or r out of range) aliases into a real index for a
  // different row/column and silently corrupts adjacency, breaking the
  // boundary chain into fragments instead of the two expected loops.
  const has = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && cellSet.has(r * cols + c);
  const corner = (r, c) => local(r, c); // local() already accepts fractional r/c via linear interpolation

  // Vertices keyed on doubled half-integer coordinates so they hash exactly.
  const vkey = (r, c) => `${Math.round(r * 2)}_${Math.round(c * 2)}`;
  const edgesFrom = new Map(); // vkey(from) -> { from:[r,c], to:[r,c] }

  for (const idx of cellIdxs) {
    const r = Math.floor(idx / cols), c = idx % cols;
    const N = r - 0.5, S = r + 0.5, W = c - 0.5, E = c + 0.5;
    if (!has(r - 1, c)) edgesFrom.set(vkey(N, W), { from: [N, W], to: [N, E] }); // top
    if (!has(r, c + 1)) edgesFrom.set(vkey(N, E), { from: [N, E], to: [S, E] }); // right
    if (!has(r + 1, c)) edgesFrom.set(vkey(S, E), { from: [S, E], to: [S, W] }); // bottom
    if (!has(r, c - 1)) edgesFrom.set(vkey(S, W), { from: [S, W], to: [N, W] }); // left
  }

  const visited = new Set();
  const rings = [];
  for (const [key, startEdge] of edgesFrom) {
    if (visited.has(key)) continue;
    const ring = [startEdge.from];
    let cur = startEdge;
    let guard = 0;
    while (guard++ < edgesFrom.size + 1) {
      visited.add(vkey(cur.from[0], cur.from[1]));
      ring.push(cur.to);
      if (vkey(cur.to[0], cur.to[1]) === key) break; // closed the loop
      const next = edgesFrom.get(vkey(cur.to[0], cur.to[1]));
      if (!next) break; // shouldn't happen for a simple polyomino boundary; guard against pinch points
      cur = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }

  if (!rings.length) return null;

  const withArea = rings.map((ring) => ({ ring, area: Math.abs(shoelaceArea(ring)) }));
  withArea.sort((a, b) => b.area - a.area);
  const toLatLon = (ring) => {
    const pts = ring.map(([r, c]) => corner(r, c));
    const closed = [...pts, pts[0]];
    return closed;
  };
  const coordinates = withArea.map((w) => toLatLon(w.ring));
  return { type: 'Polygon', coordinates };
}

function shoelaceArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [r1, c1] = ring[i];
    const [r2, c2] = ring[(i + 1) % ring.length];
    sum += r1 * c2 - r2 * c1;
  }
  return sum / 2;
}

export const _internal = { DEFAULT_CONFIG, tracePatchBoundary, connectedComponents };
