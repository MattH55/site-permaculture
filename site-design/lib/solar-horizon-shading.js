/**
 * Real solar-exposure model: terrain self-shading (horizon-vs-sun-path) plus
 * canopy shadow-casting, replacing the aspect/slope insolation guess with
 * actual blocked/unblocked sun hours per point.
 *
 * Reuses the parcel DTM already sampled for the terrain pipeline
 * (hrdem-terrain.js) and the tree instances already extracted by the
 * canopy layer (canopy.js) — no new data source. Solar position uses the
 * standard NOAA low-precision solar-position formulas (the same class of
 * calculation as the sun-sector overlay), good to well under 1° error,
 * which is adequate at DEM-grid resolution.
 *
 * See solar-horizon-shading-instructions.md for the schema this implements.
 */

const MS_PER_DAY = 86_400_000;
// Representative dates (UTC noon anchors — solar position is computed by
// stepping minutes across the full UTC day, so local time is fully covered
// regardless of the parcel's time zone).
const REPRESENTATIVE_DATES = [
  { label: 'winter_solstice', month: 11, day: 21 }, // Dec 21 (0-indexed month)
  { label: 'spring_equinox', month: 2, day: 20 },   // Mar 20
  { label: 'summer_solstice', month: 5, day: 21 },  // Jun 21
  { label: 'autumn_equinox', month: 8, day: 22 },   // Sep 22
];
const TIME_STEP_MIN = 15;
const AZIMUTH_STEP_DEG = 10;
const HORIZON_SEARCH_RADIUS_M = 1500;
const HORIZON_SAMPLE_STEP_M = 15;

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations (hrdem-terrain.js shape)
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {number} opts.latitude Parcel centroid latitude (for solar position)
 * @param {number} opts.longitude Parcel centroid longitude
 * @param {object} [opts.canopy] buildCanopyLayer() result (tree_instances, canopy_cover_pct)
 * @param {number} opts.year Calendar year for the representative dates
 * @param {Array<{lat:number,lon:number}>} [opts.candidatePoints] Run on-demand for
 *   specific sites instead of the full parcel grid.
 * @param {number} [opts.gridSampleStride=1] Subsample the DEM grid by this
 *   stride when running parcel-wide (perf control for large grids).
 */
export function computeSolarHorizonShading(opts = {}) {
  const { elevations, rows, cols, bbox } = opts;
  const coarse = !Array.isArray(elevations) || !rows || !cols || elevations.length < rows * cols || !bbox;
  const canopySpeciesAware = false; // canopy.js does not currently classify species
  const canopyAssumption = canopySpeciesAware ? 'species_aware' : 'worst_case_evergreen';

  if (coarse) {
    return {
      available: false,
      solar_exposure_raster: null,
      candidate_zones: [],
      canopy_shading_assumption: canopyAssumption,
      data_source: opts.data_source || 'coarse/no DEM',
      confidence: 'insufficient',
      note: 'No complete DEM grid supplied — horizon shading requires resolved terrain relief.',
    };
  }

  const at = (r, c) => elevations[r * cols + c];
  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];
  const latitude = opts.latitude ?? (bbox.north + bbox.south) / 2;
  const year = opts.year || new Date().getUTCFullYear();

  const trees = (opts.canopy?.available && Array.isArray(opts.canopy.tree_instances)) ? opts.canopy.tree_instances : [];

  const sunPaths = REPRESENTATIVE_DATES.map((d) => ({
    ...d,
    steps: buildSunPath(latitude, d, year),
  }));

  const stride = Math.max(1, Math.round(opts.gridSampleStride || Math.ceil(Math.max(rows, cols) / 32)));

  let points;
  if (Array.isArray(opts.candidatePoints) && opts.candidatePoints.length) {
    points = opts.candidatePoints.map((p, i) => ({ id: `candidate-${i}`, r: null, c: null, lat: p.lat, lon: p.lon, elevation_m: sampleElevationAt(p, { at, rows, cols, bbox }) }));
  } else {
    points = [];
    for (let r = 1; r < rows - 1; r += stride) {
      for (let c = 1; c < cols - 1; c += stride) {
        const z = at(r, c);
        if (!Number.isFinite(z)) continue;
        const [lon, lat] = local(r, c);
        points.push({ id: `${r}-${c}`, r, c, lat, lon, elevation_m: z });
      }
    }
  }

  const results = points.map((p) => {
    const horizon = horizonProfile({ at, rows, cols, bbox, cellWidthM, cellHeightM, r: p.r, c: p.c, lat: p.lat, lon: p.lon, elevation_m: p.elevation_m });
    const hours = insolationHours({ horizon, sunPaths, point: p, trees, canopyAssumption });
    return { point: p, horizon, ...hours };
  });

  const raster = points.length && points[0].r != null ? {
    rows: Math.ceil((rows - 2) / stride),
    cols: Math.ceil((cols - 2) / stride),
    stride,
    bbox,
    annual_insolation_hours: results.map((r) => r.annual_hours),
    winter_insolation_hours: results.map((r) => r.winter_hours),
    summer_insolation_hours: results.map((r) => r.summer_hours),
    growing_season_insolation_hours: results.map((r) => r.growing_season_hours),
    spring_insolation_hours: results.map((r) => r.spring_hours),
  } : null;

  // Default overlay ranks by annual insolation (spec: "top annual-insolation
  // zones"); winter-ranked zones are a separate toggle for passive-heating /
  // greenhouse siting, since the best annual spot and the best winter spot
  // are frequently not the same place (e.g. a site shaded by a deciduous
  // windbreak in summer but not winter).
  const candidateZones = extractCandidateZones(results, { rows, cols, stride, bbox, rankBy: 'annual_hours' });
  const winterCandidateZones = extractCandidateZones(results, { rows, cols, stride, bbox, rankBy: 'winter_hours' });

  return {
    available: true,
    solar_exposure_raster: raster,
    per_point: raster ? undefined : results.map(formatPointResult),
    candidate_zones: candidateZones,
    winter_candidate_zones: winterCandidateZones,
    canopy_shading_assumption: canopyAssumption,
    canopy_shading_note: canopyAssumption === 'worst_case_evergreen'
      ? 'Canopy layer does not distinguish species — nearby trees are conservatively treated as evergreen/full shading year-round. This likely understates real winter sun access wherever deciduous trees dominate.'
      : null,
    data_source: opts.data_source || 'Sampled DEM (hrdem-terrain.js) + canopy tree instances (canopy.js)',
    confidence: (opts.dem_confidence) || 'moderate',
    methodology: {
      horizon_profile: 'Radial DEM sampling every 10° azimuth out to 1500 m, max elevation angle per azimuth.',
      sun_path: 'NOAA low-precision solar-position formulas, 15-minute steps, at winter/summer solstice + both equinoxes.',
      canopy_shadow: 'Per-timestep check of nearby tree instances against shadow length (height / tan(elevation)) and shadow azimuth.',
    },
  };
}

function formatPointResult(r) {
  return {
    lat: r.point.lat,
    lon: r.point.lon,
    annual_insolation_hours: r.annual_hours,
    winter_insolation_hours: r.winter_hours,
    summer_insolation_hours: r.summer_hours,
    growing_season_insolation_hours: r.growing_season_hours,
    spring_insolation_hours: r.spring_hours,
    sunrise_delay_min_solstice: r.sunrise_delay_min,
    sunset_delay_min_solstice: r.sunset_delay_min,
  };
}

/**
 * Radial DEM sampling: max elevation angle observed at each azimuth.
 * Exported so suitability-wind.js can reuse the exact same "how much is
 * this point shielded by surrounding terrain" geometry for wind exposure
 * instead of sun visibility — the underlying question is identical.
 */
export function horizonProfile(ctx) {
  const { at, rows, cols, bbox, cellWidthM, cellHeightM, r, c, lat, lon, elevation_m } = ctx;
  const profile = [];
  for (let az = 0; az < 360; az += AZIMUTH_STEP_DEG) {
    const rad = (az * Math.PI) / 180;
    const dx = Math.sin(rad); // east component
    const dy = -Math.cos(rad); // north component (grid row decreases northward)
    let maxAngle = 0;
    for (let dist = HORIZON_SAMPLE_STEP_M; dist <= HORIZON_SEARCH_RADIUS_M; dist += HORIZON_SAMPLE_STEP_M) {
      let sr, sc, sLat, sLon;
      if (r != null) {
        const dCols = (dx * dist) / cellWidthM;
        const dRows = (dy * dist) / cellHeightM;
        sr = Math.round(r - dRows); // north is -row
        sc = Math.round(c + dCols);
        if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) break;
      } else {
        // Point mode: no full grid indices — walk in lat/lon directly.
        const metersPerDegLat = 111_320;
        const metersPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
        sLat = lat + (dy * dist) / metersPerDegLat;
        sLon = lon + (dx * dist) / metersPerDegLon;
        if (sLon < bbox.west || sLon > bbox.east || sLat < bbox.south || sLat > bbox.north) break;
        sc = Math.round(((sLon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1));
        sr = Math.round(((bbox.north - sLat) / (bbox.north - bbox.south)) * (rows - 1));
      }
      const z = at(sr, sc);
      if (!Number.isFinite(z)) continue;
      const rise = z - elevation_m;
      if (rise <= 0) continue;
      const angle = Math.atan2(rise, dist) * (180 / Math.PI);
      if (angle > maxAngle) maxAngle = angle;
    }
    profile.push({ azimuth: az, angle_deg: round2(maxAngle) });
  }
  return profile;
}

export function horizonAngleAt(profile, azimuth) {
  const az = ((azimuth % 360) + 360) % 360;
  const idx = az / AZIMUTH_STEP_DEG;
  const lo = Math.floor(idx) % profile.length;
  const hi = (lo + 1) % profile.length;
  const frac = idx - Math.floor(idx);
  return profile[lo].angle_deg * (1 - frac) + profile[hi].angle_deg * frac;
}

function insolationHours({ horizon, sunPaths, point, trees, canopyAssumption }) {
  const byLabel = {};
  let sunriseDelayMin = null;
  let sunsetDelayMin = null;

  for (const path of sunPaths) {
    let unblockedMinutes = 0;
    let firstFlatVisible = null, firstActualVisible = null, lastFlatVisible = null, lastActualVisible = null;
    for (const step of path.steps) {
      if (step.elevation <= 0) continue; // below flat horizon — night regardless
      const flatVisible = true;
      if (firstFlatVisible == null) firstFlatVisible = step.minutesUTC;
      lastFlatVisible = step.minutesUTC;

      const horizonAngle = horizonAngleAt(horizon, step.azimuth);
      const terrainClear = step.elevation > horizonAngle;
      const canopyClear = terrainClear && !treeShadowed(point, trees, step, canopyAssumption);

      if (terrainClear) {
        if (firstActualVisible == null) firstActualVisible = step.minutesUTC;
        lastActualVisible = step.minutesUTC;
      }
      if (canopyClear) unblockedMinutes += TIME_STEP_MIN;
    }
    byLabel[path.label] = round2(unblockedMinutes / 60);
    if (path.label === 'winter_solstice' && firstFlatVisible != null && firstActualVisible != null) {
      sunriseDelayMin = firstActualVisible - firstFlatVisible;
      sunsetDelayMin = lastFlatVisible - lastActualVisible;
    }
  }

  const winter = byLabel.winter_solstice ?? 0;
  const summer = byLabel.summer_solstice ?? 0;
  const spring = byLabel.spring_equinox ?? 0;
  const autumn = byLabel.autumn_equinox ?? 0;
  const springAutumnAvg = (spring + autumn) / 2;
  // Average the four representative dates (each ~a quarter-year apart) and
  // scale by 365 for an annual estimate.
  const avgDailyHours = (winter + summer + 2 * springAutumnAvg) / 4;
  // Frost-free / planting window: equinoxes + summer, not the winter total.
  const growingSeasonDaily = (spring + summer + autumn) / 3;
  return {
    winter_hours: round1(winter),
    summer_hours: round1(summer),
    spring_hours: round1(spring),
    growing_season_hours: round1(growingSeasonDaily),
    annual_hours: round1(avgDailyHours * 365),
    sunrise_delay_min: sunriseDelayMin != null ? Math.max(0, sunriseDelayMin) : null,
    sunset_delay_min: sunsetDelayMin != null ? Math.max(0, sunsetDelayMin) : null,
  };
}

/**
 * Conservative shadow test: point is shaded if some tree's shadow (cast
 * directly away from the sun) reaches the point within a width tolerance
 * derived from the tree's crown radius.
 */
function treeShadowed(point, trees, sunStep, canopyAssumption) {
  if (!trees.length || sunStep.elevation <= 1) return false;
  const shadowAzimuth = (sunStep.azimuth + 180) % 360;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  for (const tree of trees) {
    const height = evergreenSeasonalHeight(tree.height_m, sunStep.month, canopyAssumption);
    if (height <= 0) continue;
    const shadowLength = height / Math.tan((sunStep.elevation * Math.PI) / 180);
    if (shadowLength <= 0 || shadowLength > HORIZON_SEARCH_RADIUS_M) continue;
    // canopy.js tree instances store { x: lat, y: lng } (see canopy.js
    // watershedToTrees) — not the geographic convention the names suggest.
    const treeLat = tree.x ?? tree.lat;
    const treeLon = tree.y ?? tree.lon;
    if (treeLat == null || treeLon == null) continue;
    const dNorthM = (point.lat - treeLat) * metersPerDegLat;
    const dEastM = (point.lon - treeLon) * metersPerDegLon;
    const distM = Math.hypot(dNorthM, dEastM);
    if (distM > shadowLength + (tree.crown_radius_m || 2)) continue;
    const bearingToPoint = (Math.atan2(dEastM, dNorthM) * 180) / Math.PI;
    const bearingNorm = ((bearingToPoint % 360) + 360) % 360;
    let diff = Math.abs(bearingNorm - shadowAzimuth);
    if (diff > 180) diff = 360 - diff;
    const angularToleranceDeg = Math.min(45, (Math.atan2(tree.crown_radius_m || 2, Math.max(distM, 1)) * 180) / Math.PI + 5);
    if (diff <= angularToleranceDeg) return true;
  }
  return false;
}

/** Deciduous trees would lose shading capacity in winter; canopy.js has no
 * species field, so under the worst_case_evergreen assumption every tree
 * holds full height/shading year-round. */
function evergreenSeasonalHeight(heightM, month, canopyAssumption) {
  if (canopyAssumption === 'species_aware') {
    // Reserved for when the canopy layer gains a species/type field.
  }
  return heightM;
}

function extractCandidateZones(results, { rows, cols, stride, bbox, rankBy = 'annual_hours' }) {
  if (!results.length || results[0].point.r == null) return [];
  const sorted = [...results].sort((a, b) => b[rankBy] - a[rankBy]);
  const topCount = Math.max(1, Math.min(5, Math.round(sorted.length * 0.05)));
  const top = sorted.slice(0, topCount);
  const cellHalfLon = ((bbox.east - bbox.west) / (cols - 1)) * stride / 2;
  const cellHalfLat = ((bbox.north - bbox.south) / (rows - 1)) * stride / 2;
  const prefix = rankBy === 'winter_hours' ? 'solar-winter-zone' : 'solar-zone';
  return top.map((r, i) => ({
    zone_id: `${prefix}-${i + 1}`,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [r.point.lon - cellHalfLon, r.point.lat - cellHalfLat],
        [r.point.lon + cellHalfLon, r.point.lat - cellHalfLat],
        [r.point.lon + cellHalfLon, r.point.lat + cellHalfLat],
        [r.point.lon - cellHalfLon, r.point.lat + cellHalfLat],
        [r.point.lon - cellHalfLon, r.point.lat - cellHalfLat],
      ]],
    },
    annual_insolation_hours: r.annual_hours,
    winter_insolation_hours: r.winter_hours,
    summer_insolation_hours: r.summer_hours,
    growing_season_insolation_hours: r.growing_season_hours,
    spring_insolation_hours: r.spring_hours,
    sunrise_delay_min_solstice: r.sunrise_delay_min,
    sunset_delay_min_solstice: r.sunset_delay_min,
  }));
}

function sampleElevationAt(p, { at, rows, cols, bbox }) {
  const c = clamp(Math.round(((p.lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1)), 0, cols - 1);
  const r = clamp(Math.round(((bbox.north - p.lat) / (bbox.north - bbox.south)) * (rows - 1)), 0, rows - 1);
  const z = at(r, c);
  return Number.isFinite(z) ? z : 0;
}

// --- Sun path (NOAA low-precision solar position) -------------------------

function buildSunPath(latitude, date, year) {
  const steps = [];
  const dayStart = Date.UTC(year, date.month, date.day, 0, 0, 0);
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MIN) {
    const t = new Date(dayStart + m * 60_000);
    const pos = sunPosition(latitude, 0, t);
    steps.push({ minutesUTC: m, azimuth: pos.azimuth, elevation: pos.elevation, month: date.month });
  }
  return steps;
}

/**
 * NOAA low-precision solar position (per NOAA Solar Calculator equations).
 * @param {number} latDeg
 * @param {number} lonDeg longitude in degrees East (0 here — see buildSunPath note)
 * @param {Date} date UTC instant
 * @returns {{azimuth:number, elevation:number}} azimuth from true north, clockwise
 */
function sunPosition(latDeg, lonDeg, date) {
  const jd = toJulianDay(date);
  const jc = (jd - 2451545) / 36525;

  const geomMeanLongSun = normalizeDeg(280.46646 + jc * (36000.76983 + jc * 0.0003032));
  const geomMeanAnomSun = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const eccentEarthOrbit = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const sunEqOfCtr =
    Math.sin(deg2rad(geomMeanAnomSun)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(deg2rad(2 * geomMeanAnomSun)) * (0.019993 - 0.000101 * jc) +
    Math.sin(deg2rad(3 * geomMeanAnomSun)) * 0.000289;
  const sunTrueLong = geomMeanLongSun + sunEqOfCtr;
  const meanObliqEcliptic = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliqEcliptic + 0.00256 * Math.cos(deg2rad(125.04 - 1934.136 * jc));
  const sunAppLong = sunTrueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(125.04 - 1934.136 * jc));
  const sunDeclin = rad2deg(Math.asin(Math.sin(deg2rad(obliqCorr)) * Math.sin(deg2rad(sunAppLong))));

  const varY = Math.tan(deg2rad(obliqCorr / 2)) * Math.tan(deg2rad(obliqCorr / 2));
  const eqOfTime =
    4 *
    rad2deg(
      varY * Math.sin(2 * deg2rad(geomMeanLongSun)) -
        2 * eccentEarthOrbit * Math.sin(deg2rad(geomMeanAnomSun)) +
        4 * eccentEarthOrbit * varY * Math.sin(deg2rad(geomMeanAnomSun)) * Math.cos(2 * deg2rad(geomMeanLongSun)) -
        0.5 * varY * varY * Math.sin(4 * deg2rad(geomMeanLongSun)) -
        1.25 * eccentEarthOrbit * eccentEarthOrbit * Math.sin(2 * deg2rad(geomMeanAnomSun))
    );

  const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutesUTC + eqOfTime + 4 * lonDeg) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const latRad = deg2rad(latDeg);
  const declRad = deg2rad(sunDeclin);
  const haRad = deg2rad(hourAngle);

  const cosZenith = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);
  const zenith = rad2deg(Math.acos(clamp(cosZenith, -1, 1)));
  const elevation = 90 - zenith;

  let azimuth;
  const zenithRad = deg2rad(zenith);
  if (Math.abs(Math.sin(zenithRad)) < 1e-6) {
    azimuth = 0;
  } else {
    let cosAz = (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) / (Math.cos(latRad) * Math.sin(zenithRad));
    cosAz = clamp(cosAz, -1, 1);
    azimuth = rad2deg(Math.acos(cosAz));
    if (hourAngle > 0) azimuth = 360 - azimuth;
  }

  return { azimuth: normalizeDeg(azimuth), elevation };
}

function toJulianDay(date) {
  return date.getTime() / MS_PER_DAY + 2440587.5;
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
function rad2deg(r) { return (r * 180) / Math.PI; }
function normalizeDeg(d) { return ((d % 360) + 360) % 360; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
