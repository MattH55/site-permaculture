/**
 * FireSmart Canada Home Ignition Zone assessment, per detected structure —
 * see firesmart-zone-assessment-instructions.md. A composite of layers
 * already built (building footprints, canopy cover, individual tree
 * detections, slope) — no new data source.
 *
 * IMPORTANT — per the spec's own caveat: the zone distances (0-10m /
 * 10-30m / 30-100m), the uphill slope-extension multiplier, and the
 * crown-spacing risk thresholds below are the commonly-cited starting
 * structure this spec calls for, NOT verified against FireSmart Canada's
 * current published guidance. Treat every one of these as a placeholder
 * pending that verification, the same way this pipeline flags other
 * regulatory figures (riparian buffer, wind-turbine setback) as
 * placeholders — see DEFAULT_CONFIG below, all flagged in the output.
 *
 * Known gaps, surfaced explicitly rather than silently baked into the
 * score (spec: "flag this explicitly ... rather than presenting a risk
 * score as if it fully accounts for FireSmart's actual criteria"):
 *  - Ladder fuels (shrubs/low vegetation below the canopy layer's ~2m
 *    detection floor) are not modelled at all — `ladder_fuel_assessment`.
 *  - Conifer/deciduous classification does not exist yet in canopy.js
 *    (tree_instances carry no species field) — `conifer_classification`.
 */

import {
  haversineM, slopeAspectAt, sampleRasterAtLatLon, pointInAnyPolygon,
  weakestConfidence, cachedSuitability, clamp, round0, round1,
} from './suitability-common.js';

const DEFAULT_CONFIG = {
  zone_distances_m: { zone1: 10, zone2: 30, zone3: 100 }, // PLACEHOLDER — verify against current FireSmart Canada guidance
  zone_distances_are_placeholder: true,
  uphill_extension_factor: 1.5, // PLACEHOLDER — verify against current FireSmart slope guidance
  uphill_extension_is_placeholder: true,
  canopy_height_threshold_m: 2, // matches plantable-area.js's "existing canopy" threshold
  tight_crown_spacing_m: 1, // PLACEHOLDER — crowns closer than this (or overlapping) flagged as fire-jump risk
  moderate_crown_spacing_m: 3,
  zone_weights: { zone1: 0.6, zone2: 0.25, zone3: 0.15 }, // Zone 1 dominates the composite, per spec step 4
  zone_sample_grid: 14, // N×N sample points per zone's outer bounding box, for canopy-cover-in-annulus estimation
};

const RATING_BANDS = [
  { id: 'low', min: 0 },
  { id: 'moderate', min: 25 },
  { id: 'high', min: 50 },
  { id: 'extreme', min: 75 },
];

/**
 * Assess every detected building on the parcel.
 * @param {object} opts
 * @param {object} opts.buildings computeBuildingDetection() result
 * @param {object} [opts.canopy] buildCanopyLayer() result
 * @param {number[]} [opts.elevations] DEM grid, for slope/aspect at each building
 * @param {number} [opts.rows]
 * @param {number} [opts.cols]
 * @param {{west:number,south:number,east:number,north:number}} [opts.bbox]
 * @param {object} [opts.config]
 * @param {string} [opts.parcel_id]
 */
export function computeFireSmartAssessments(opts = {}) {
  const cfg = mergeConfig(opts.config);
  const buildings = opts.buildings?.buildings || [];
  if (!buildings.length) {
    return { available: false, assessments: [], reason: opts.buildings?.reason || 'No detected buildings to assess.' };
  }
  const assessments = buildings.map((b) => assessOneBuilding(b, opts, cfg));
  return { available: true, assessments };
}

/** Assess a single building — exported separately so a caller re-checking one building after a canopy refresh doesn't have to re-run the whole parcel. */
export function computeFireSmartAssessment(building, opts = {}) {
  const cfg = mergeConfig(opts.config);
  const compute = () => assessOneBuilding(building, opts, cfg);
  if (!opts.parcel_id) return compute();
  return cachedSuitability(`${opts.parcel_id}::building::${building.footprint_id}`, [
    'firesmart', opts.canopy?.data_source, opts.canopy?._meta?.cache, building.height_m,
  ], compute);
}

function mergeConfig(overrides) {
  return {
    ...DEFAULT_CONFIG, ...(overrides || {}),
    zone_distances_m: { ...DEFAULT_CONFIG.zone_distances_m, ...(overrides?.zone_distances_m || {}) },
    zone_weights: { ...DEFAULT_CONFIG.zone_weights, ...(overrides?.zone_weights || {}) },
  };
}

function assessOneBuilding(building, opts, cfg) {
  const ring = building.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    return emptyAssessment(building, 'Building footprint geometry missing or degenerate.');
  }

  const orient = orientedRect(ring);
  const uphillBearing = uphillBearingAt(orient.centroidLat, orient.centroidLon, opts);
  const sideExtension = uphillBearing == null ? null : extensionPerSide(orient, uphillBearing, cfg.uphill_extension_factor);

  const treeInstances = opts.canopy?.available && Array.isArray(opts.canopy.tree_instances) ? opts.canopy.tree_instances : [];
  const chmRaster = opts.canopy?.chm?.values_m?.length && opts.bbox
    ? { rows: opts.canopy.chm.rows, cols: opts.canopy.chm.cols, bbox: opts.bbox, values: opts.canopy.chm.values_m }
    : null;

  const zoneOrder = ['zone1', 'zone2', 'zone3'];
  let innerRect = { uMin: orient.uMin, uMax: orient.uMax, vMin: orient.vMin, vMax: orient.vMax }; // the footprint itself
  const zones = [];

  zoneOrder.forEach((zoneKey, i) => {
    const zoneNumber = i + 1;
    const baseDist = cfg.zone_distances_m[zoneKey];
    const outerRect = expandRect(innerRect, baseDist, sideExtension);
    const zoneStats = scoreZone({ orient, innerRect, outerRect, zoneNumber, treeInstances, chmRaster, cfg });

    zones.push({
      zone_number: zoneNumber,
      geometry: rectAnnulusToGeoJSON(orient, innerRect, outerRect),
      canopy_cover_pct: round1(zoneStats.canopyCoverPct),
      conifer_pct_of_cover: null, // conifer_classification: not_available — see module doc
      min_crown_spacing_m: zoneStats.minCrownSpacingM != null ? round1(zoneStats.minCrownSpacingM) : null,
      tree_count: zoneStats.treeCount,
      risk_flags: zoneStats.riskFlags,
    });
    innerRect = outerRect;
  });

  const { overallRating, compositeScore } = rollUpRating(zones, cfg);
  const contributingFactors = buildContributingFactors(zones);

  const canopyConfidence = opts.canopy?.available === false ? 'unavailable' : (opts.canopy?.confidence || 'moderate');
  const heightConfidence = building.confidence?.height || 'unavailable';

  return {
    building_id: building.footprint_id,
    zones,
    overall_risk_rating: overallRating,
    composite_score: round0(compositeScore),
    contributing_factors: contributingFactors,
    ladder_fuel_assessment: 'not_available',
    conifer_classification: 'not_available',
    slope_adjustment: {
      applied: sideExtension != null,
      uphill_bearing_deg: uphillBearing != null ? round0(uphillBearing) : null,
      extension_factor: cfg.uphill_extension_factor,
      extension_factor_is_placeholder: cfg.uphill_extension_is_placeholder,
      note: sideExtension == null ? 'No usable DEM slope at this building — zones rendered as symmetric rectangles.' : null,
    },
    thresholds: {
      zone_distances_m: cfg.zone_distances_m,
      zone_distances_are_placeholder: cfg.zone_distances_are_placeholder,
      tight_crown_spacing_m: cfg.tight_crown_spacing_m,
    },
    data_source: {
      footprint: building.data_source?.footprint || 'not supplied',
      canopy: opts.canopy?.data_source || 'not supplied',
      height: building.data_source?.height || 'not supplied',
    },
    confidence: weakestConfidence([canopyConfidence, heightConfidence]),
  };
}

function emptyAssessment(building, reason) {
  return {
    building_id: building.footprint_id || null,
    zones: [],
    overall_risk_rating: null,
    contributing_factors: [],
    ladder_fuel_assessment: 'not_available',
    conifer_classification: 'not_available',
    data_source: {},
    confidence: 'insufficient',
    reason,
  };
}

// --- Zone geometry (oriented-rectangle approximation) -----------------------
//
// Buffering an arbitrary polygon outward by a fixed distance is a real
// offset-polygon problem; real building footprints here are near-
// rectangular (building-detection.js's own type inference already treats
// them that way), so zones are built from the footprint's oriented
// bounding rectangle (aligned to its longest edge) rather than a full
// polygon-offset algorithm. Exact for a rectangular footprint, a
// documented simplification for an irregular one.

function orientedRect(ring) {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const lat0 = closed.reduce((s, p) => s + p[1], 0) / closed.length;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const originLon = closed[0][0], originLat = closed[0][1];
  const toLocal = ([lon, lat]) => [(lon - originLon) * mPerDegLon, (lat - originLat) * mPerDegLat];
  const local = closed.map(toLocal);

  // Longest edge sets the u-axis.
  let bestLen = -1, bestI = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > bestLen) { bestLen = len; bestI = i; }
  }
  const a = local[bestI], b = local[(bestI + 1) % local.length];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const uAxis = { x: dx / len, y: dy / len };
  const vAxis = { x: -uAxis.y, y: uAxis.x }; // perpendicular

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const [x, y] of local) {
    const u = x * uAxis.x + y * uAxis.y;
    const v = x * vAxis.x + y * vAxis.y;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }

  const centroidLon = closed.reduce((s, p) => s + p[0], 0) / closed.length;
  const centroidLat = lat0;

  return { uAxis, vAxis, originLon, originLat, mPerDegLat, mPerDegLon, uMin, uMax, vMin, vMax, centroidLon, centroidLat };
}

/** Compass bearing (° from N) of the slope's downhill-facing direction at a point; uphill = +180°. */
function uphillBearingAt(lat, lon, opts) {
  const { elevations, rows, cols, bbox } = opts;
  if (!Array.isArray(elevations) || !rows || !cols || !bbox) return null;
  const c = clamp(Math.round(((lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1)), 1, cols - 2);
  const r = clamp(Math.round(((bbox.north - lat) / (bbox.north - bbox.south)) * (rows - 1)), 1, rows - 2);
  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const at = (rr, cc) => elevations[rr * cols + cc];
  const { aspectDeg } = slopeAspectAt({ r, c, at, rows, cols, cellWidthM, cellHeightM });
  if (aspectDeg == null) return null;
  return (aspectDeg + 180) % 360; // aspectDeg is the downslope-facing direction; uphill is the opposite
}

/** Which of the rect's 4 outward sides (in u/v terms) best faces uphill — that side alone gets extended. */
function extensionPerSide(orient, uphillBearing, factor) {
  const bearingOf = (vx, vy) => normalizeDeg((Math.atan2(vx, vy) * 180) / Math.PI);
  const sides = {
    uMax: bearingOf(orient.uAxis.x, orient.uAxis.y),
    uMin: bearingOf(-orient.uAxis.x, -orient.uAxis.y),
    vMax: bearingOf(orient.vAxis.x, orient.vAxis.y),
    vMin: bearingOf(-orient.vAxis.x, -orient.vAxis.y),
  };
  let best = null, bestDiff = Infinity;
  for (const [side, bearing] of Object.entries(sides)) {
    const diff = angularDiff(bearing, uphillBearing);
    if (diff < bestDiff) { bestDiff = diff; best = side; }
  }
  return { side: best, factor };
}

function expandRect(inner, baseDist, sideExtension) {
  const d = { uMin: baseDist, uMax: baseDist, vMin: baseDist, vMax: baseDist };
  if (sideExtension) d[sideExtension.side] *= sideExtension.factor;
  return {
    uMin: inner.uMin - d.uMin,
    uMax: inner.uMax + d.uMax,
    vMin: inner.vMin - d.vMin,
    vMax: inner.vMax + d.vMax,
  };
}

function rectCornersLatLon(orient, rect) {
  const toLatLon = (u, v) => {
    const x = u * orient.uAxis.x + v * orient.vAxis.x;
    const y = u * orient.uAxis.y + v * orient.vAxis.y;
    return [orient.originLon + x / orient.mPerDegLon, orient.originLat + y / orient.mPerDegLat];
  };
  return [
    toLatLon(rect.uMin, rect.vMin), toLatLon(rect.uMax, rect.vMin),
    toLatLon(rect.uMax, rect.vMax), toLatLon(rect.uMin, rect.vMax),
  ];
}

function rectAnnulusToGeoJSON(orient, innerRect, outerRect) {
  const outer = rectCornersLatLon(orient, outerRect);
  const inner = rectCornersLatLon(orient, innerRect);
  return { type: 'Polygon', coordinates: [[...outer, outer[0]], [...inner, inner[0]]] };
}

function pointToUV(orient, lat, lon) {
  const x = (lon - orient.originLon) * orient.mPerDegLon;
  const y = (lat - orient.originLat) * orient.mPerDegLat;
  return { u: x * orient.uAxis.x + y * orient.uAxis.y, v: x * orient.vAxis.x + y * orient.vAxis.y };
}

function inRect(uv, rect) {
  return uv.u >= rect.uMin && uv.u <= rect.uMax && uv.v >= rect.vMin && uv.v <= rect.vMax;
}
function inAnnulus(uv, innerRect, outerRect) {
  return inRect(uv, outerRect) && !inRect(uv, innerRect);
}

// --- Per-zone vegetation scoring ----------------------------------------------

function scoreZone({ orient, innerRect, outerRect, zoneNumber, treeInstances, chmRaster, cfg }) {
  const canopyCoverPct = estimateCanopyCoverPct(orient, innerRect, outerRect, chmRaster, cfg);

  const zoneTrees = treeInstances.filter((t) => {
    const tLat = t.x ?? t.lat, tLon = t.y ?? t.lon; // canopy.js stores {x:lat,y:lon}
    if (tLat == null || tLon == null) return false;
    return inAnnulus(pointToUV(orient, tLat, tLon), innerRect, outerRect);
  });

  let minCrownSpacingM = null;
  for (let i = 0; i < zoneTrees.length; i++) {
    for (let j = i + 1; j < zoneTrees.length; j++) {
      const a = zoneTrees[i], b = zoneTrees[j];
      const aLat = a.x ?? a.lat, aLon = a.y ?? a.lon, bLat = b.x ?? b.lat, bLon = b.y ?? b.lon;
      const gap = haversineM(aLat, aLon, bLat, bLon) - (a.crown_radius_m || 1) - (b.crown_radius_m || 1);
      if (minCrownSpacingM == null || gap < minCrownSpacingM) minCrownSpacingM = gap;
    }
  }

  const riskFlags = [];
  if (zoneNumber === 1 && (canopyCoverPct > 0 || zoneTrees.length > 0)) riskFlags.push('woody_vegetation_present_in_zone_1');
  if (minCrownSpacingM != null && minCrownSpacingM < cfg.tight_crown_spacing_m) riskFlags.push('tight_crown_spacing');
  if (canopyCoverPct >= 40) riskFlags.push('dense_canopy_cover');

  return { canopyCoverPct, minCrownSpacingM, treeCount: zoneTrees.length, riskFlags };
}

/** Grid-sample the zone's outer bounding box, classify each sample in/out of the annulus and canopy/no-canopy. */
function estimateCanopyCoverPct(orient, innerRect, outerRect, chmRaster, cfg) {
  const n = cfg.zone_sample_grid;
  let total = 0, covered = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const u = outerRect.uMin + ((i + 0.5) / n) * (outerRect.uMax - outerRect.uMin);
      const v = outerRect.vMin + ((j + 0.5) / n) * (outerRect.vMax - outerRect.vMin);
      if (!inAnnulus({ u, v }, innerRect, outerRect)) continue;
      total++;
      const x = u * orient.uAxis.x + v * orient.vAxis.x;
      const y = u * orient.uAxis.y + v * orient.vAxis.y;
      const lon = orient.originLon + x / orient.mPerDegLon;
      const lat = orient.originLat + y / orient.mPerDegLat;
      if (chmRaster) {
        const h = sampleRasterAtLatLon(chmRaster, lat, lon);
        if (h != null && h >= cfg.canopy_height_threshold_m) covered++;
      }
    }
  }
  return total ? (covered / total) * 100 : 0;
}

// --- Roll-up ------------------------------------------------------------------

function rollUpRating(zones, cfg) {
  const zoneScore = (z) => clamp(z.canopy_cover_pct + (z.risk_flags.includes('tight_crown_spacing') ? 20 : 0), 0, 100);
  const scores = zones.map(zoneScore);
  const w = cfg.zone_weights;
  const composite = (scores[0] || 0) * w.zone1 + (scores[1] || 0) * w.zone2 + (scores[2] || 0) * w.zone3;

  let band = RATING_BANDS[0].id;
  for (const b of RATING_BANDS) if (composite >= b.min) band = b.id;

  // Zone 1 floor: a risky Zone 1 is never offset by clean Zones 2-3 (spec step 4).
  // Keys off the flag (canopy cover OR any detected tree), not canopy_cover_pct
  // alone — a CHM raster may not resolve individual trees whose crowns still
  // put them squarely in Zone 1.
  const zone1 = zones[0];
  const zone1Cover = zone1?.canopy_cover_pct || 0;
  const zone1HasVeg = !!zone1?.risk_flags.includes('woody_vegetation_present_in_zone_1');
  const zone1Tight = zone1?.risk_flags.includes('tight_crown_spacing');
  let floor = 'low';
  if (zone1Cover > 30 || (zone1Cover > 10 && zone1Tight)) floor = 'extreme';
  else if (zone1Cover > 10) floor = 'high';
  else if (zone1Cover > 0 || zone1HasVeg) floor = 'moderate';

  const bandRank = (id) => RATING_BANDS.findIndex((b) => b.id === id);
  const overallRating = bandRank(floor) > bandRank(band) ? floor : band;
  return { overallRating, compositeScore: composite };
}

function buildContributingFactors(zones) {
  const factors = [];
  for (const z of zones) {
    if (z.risk_flags.includes('woody_vegetation_present_in_zone_1')) {
      factors.push(`Zone 1: vegetation present (${z.canopy_cover_pct}% cover, ${z.tree_count} tree${z.tree_count === 1 ? '' : 's'}) — FireSmart Zone 1 calls for minimal-to-no flammable vegetation directly adjacent to the structure.`);
    }
    if (z.risk_flags.includes('tight_crown_spacing')) {
      factors.push(`Zone ${z.zone_number}: tight crown spacing (min ${z.min_crown_spacing_m} m between neighbouring trees) — closely spaced crowns let fire jump tree-to-tree.`);
    }
    if (z.risk_flags.includes('dense_canopy_cover')) {
      factors.push(`Zone ${z.zone_number}: dense canopy cover (${z.canopy_cover_pct}%).`);
    }
  }
  if (!factors.length) factors.push('No significant FireSmart risk factors detected in the modelled zones.');
  return factors;
}

function angularDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function normalizeDeg(d) { return ((d % 360) + 360) % 360; }

export const _internal = { orientedRect, expandRect, rollUpRating, DEFAULT_CONFIG };
