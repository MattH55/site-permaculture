/**
 * Zone & Sector Overlay — permaculture zone rings and sector overlays.
 * See zone-sector-overlay-instructions.md for the schema this implements.
 *
 * Zone rings (0-5) use slope-adjusted travel-time isochrones (Tobler
 * hiking function) from a homestead point rather than Euclidean distance
 * rings, since steep terrain between the house and a plot makes it
 * effectively farther in visit-frequency terms even when it's close as the
 * crow flies. Sun sectors are pure deterministic astronomy; wind/fire
 * sectors reuse the wind-rose data already fetched for shelterbelt design.
 */

const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

/** Cumulative one-way travel-time ceiling (minutes) for each zone number. */
const ZONE_TRAVEL_MINUTES = { 0: 0.5, 1: 2, 2: 5, 3: 15, 4: 30, 5: Infinity };

const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const SECTOR_HALF_WIDTH_DEG = 11.25; // half of one 22.5° compass sector

/** Tobler's hiking function: walking speed (m/s) for a signed slope (%). */
function toblerSpeedMps(slopePercent) {
  const slopeRad = Math.atan(slopePercent / 100);
  const tanPlusOffset = Math.abs(Math.tan(slopeRad) + 0.05);
  return Math.min(6.0 * Math.exp(-3.5 * tanPlusOffset) / 3.6, 1.8); // km/h -> m/s, capped at flat-ground pace
}

function solarDeclination(dayOfYear) {
  return 23.45 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180);
}

function sunriseHourAngle(latDeg, declDeg) {
  const latRad = (latDeg * Math.PI) / 180;
  const declRad = (declDeg * Math.PI) / 180;
  const cosH = -Math.tan(latRad) * Math.tan(declRad);
  if (cosH < -1) return Math.PI; // sun never sets (polar day)
  if (cosH > 1) return 0; // sun never rises (polar night)
  return Math.acos(cosH);
}

function solarAzimuthDeg(latDeg, declDeg, hourAngleRad) {
  const latRad = (latDeg * Math.PI) / 180;
  const declRad = (declDeg * Math.PI) / 180;
  const sinAz = Math.cos(declRad) * Math.sin(hourAngleRad);
  const cosAz = Math.sin(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad) - Math.cos(latRad) * Math.sin(declRad);
  return normalizeDeg((Math.atan2(sinAz, -cosAz) * 180) / Math.PI);
}

function isLeapYear(year) { return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)); }
function winterSolsticeDoy(year) { return isLeapYear(year) ? 356 : 355; }
function summerSolsticeDoy(year) { return isLeapYear(year) ? 173 : 172; }

function normalizeDeg(d) { return ((d % 360) + 360) % 360; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }
function round5(v) { return Math.round(v * 100000) / 100000; }

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Andrew's monotone chain convex hull. Input/output: [[x,y], ...]. */
function convexHull(points) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (seq) => {
    const hull = [];
    for (const p of seq) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  const lower = build(pts);
  const upper = build([...pts].reverse());
  return [...lower, ...upper];
}

/**
 * @param {object} params
 * @param {number} params.latitude Parcel centroid latitude (sun sectors)
 * @param {number} params.longitude Parcel centroid longitude
 * @param {{west:number,south:number,east:number,north:number}} params.bbox
 * @param {number[]} [params.elevations] Row-major DEM elevations (hrdem-terrain.js shape)
 * @param {number} [params.rows]
 * @param {number} [params.cols]
 * @param {{lat:number, lon:number, is_placeholder?:boolean}} [params.homestead_point]
 * @param {object} [params.wind_rose] getWindRose() result
 * @param {boolean} [params.is_in_alberta=true] Gates the optional fire-risk sector
 * @param {string} [params.parcel_id]
 * @param {object} [params.opts]
 * @param {Record<number,number>} [params.opts.zone_travel_minutes]
 * @param {boolean} [params.opts.euclidean_fallback] Force the flat-terrain ring mode
 */
export function computeZoneSectorOverlay(params) {
  return buildResult(params || {});
}

function buildResult({
  latitude, longitude, bbox, elevations, rows, cols,
  homestead_point, wind_rose = {},
  is_in_alberta = true,
  parcel_id, opts = {},
}) {
  const homestead = homestead_point && Number.isFinite(homestead_point.lat) && Number.isFinite(homestead_point.lon)
    ? homestead_point
    : { lat: latitude, lon: longitude, is_placeholder: true };

  const cacheKey = JSON.stringify({
    parcel_id: parcel_id || `${latitude?.toFixed?.(4)},${longitude?.toFixed?.(4)}`,
    homestead: { lat: round5(homestead.lat), lon: round5(homestead.lon) },
    euclidean: !!opts.euclidean_fallback,
  });
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const demAvailable = Array.isArray(elevations) && rows && cols && elevations.length >= rows * cols && !!bbox;
  const demConfidence = demAvailable ? 'high' : 'insufficient';
  const zoneTravel = opts.zone_travel_minutes || ZONE_TRAVEL_MINUTES;
  const useEuclidean = opts.euclidean_fallback === true || !demAvailable;

  const zones = computeZones(homestead, bbox, elevations, rows, cols, zoneTravel, useEuclidean);
  const sunSectors = computeSunSectors(latitude ?? homestead.lat);
  const windSectors = computeWindSectors(wind_rose);
  const fireSectors = is_in_alberta ? computeFireSectors(wind_rose) : [];

  const result = {
    homestead_point: { lat: homestead.lat, lon: homestead.lon, is_placeholder: homestead.is_placeholder === true },
    zones,
    sectors: { wind: windSectors, sun: sunSectors, fire_risk: fireSectors },
    confidence: {
      zones: demConfidence,
      sun: 'high',
      wind: wind_rose?.available ? 'high' : 'unavailable',
      fire_risk: fireSectors.length > 0 ? (wind_rose?.available ? 'moderate' : 'unavailable') : 'not_applicable',
    },
    placeholder_flag: homestead.is_placeholder === true,
    _meta: {
      generated_at: new Date().toISOString(),
      methodology: useEuclidean
        ? 'Zone rings use flat-terrain Euclidean-distance rings (no resolved DEM, or explicitly requested) at a 1.4 m/s walking pace; solar sectors use deterministic astronomy; wind sectors reuse wind-rose data.'
        : 'Zone rings use slope-adjusted travel-time isochrones (Tobler hiking function) from the homestead point; solar sectors use deterministic astronomy; wind sectors reuse wind-rose data.',
    },
  };
  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}

/**
 * Cost-distance (or Euclidean-fallback) travel time from the homestead
 * point to every DEM cell, bucketed into zone numbers by
 * ZONE_TRAVEL_MINUTES, then grouped into connected components and
 * convex-hulled into polygons — the same component-then-hull technique
 * keyline-frost.js uses for frost-pocket zones. A convex hull is an
 * approximation of the true (possibly non-convex, ring-shaped) isochrone
 * shape, consistent with that existing simplification elsewhere in the
 * pipeline.
 */
function computeZones(homestead, bbox, elevations, rows, cols, zoneTravelMinutes, useEuclidean) {
  if (!bbox) return [];
  if (useEuclidean && (!rows || !cols)) {
    // Euclidean rings are pure geometry (no elevation needed) — synthesize
    // a working resolution rather than refusing just because no DEM grid
    // was supplied (this is exactly the "no DEM" case the fallback exists
    // for).
    rows = 33; cols = 33;
  }
  if (!rows || !cols) return [];
  const n = rows * cols;
  const at = (r, c) => elevations?.[r * cols + c];
  const cellWidthM = haversineM(bbox.south, bbox.west, bbox.south, bbox.east) / (cols - 1 || 1);
  const cellHeightM = haversineM(bbox.south, bbox.west, bbox.north, bbox.west) / (rows - 1 || 1);
  const local = (r, c) => [
    bbox.west + (c / (cols - 1)) * (bbox.east - bbox.west),
    bbox.north - (r / (rows - 1)) * (bbox.north - bbox.south),
  ];

  const hc = clamp(Math.round(((homestead.lon - bbox.west) / (bbox.east - bbox.west)) * (cols - 1)), 0, cols - 1);
  const hr = clamp(Math.round(((bbox.north - homestead.lat) / (bbox.north - bbox.south)) * (rows - 1)), 0, rows - 1);

  const travelMin = new Float64Array(n).fill(Infinity);

  if (useEuclidean || !Array.isArray(elevations) || elevations.length < n) {
    const WALK_MPS = 1.4; // ~5 km/h flat-ground pace
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = (c - hc) * cellWidthM;
        const dy = (r - hr) * cellHeightM;
        travelMin[r * cols + c] = Math.hypot(dx, dy) / WALK_MPS / 60;
      }
    }
  } else {
    // Dijkstra over the 8-connected grid with Tobler-adjusted, direction-
    // dependent edge costs (uphill costs more than downhill along the same
    // edge) — a simple O(V²) extraction since DEM sample grids here are at
    // most 96×96 (hrdem-terrain.js), well within budget for an on-demand
    // planning-mode request.
    const NEIGHBOR_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    let startR = hr, startC = hc;
    if (!Number.isFinite(at(hr, hc))) {
      // Homestead cell itself is nodata — search outward for the nearest
      // valid cell to start from, rather than producing an all-unreachable
      // result.
      const found = nearestValidCell(at, rows, cols, hr, hc);
      if (found) { startR = found.r; startC = found.c; }
    }
    const homesteadIdx = startR * cols + startC;
    travelMin[homesteadIdx] = 0;
    const visited = new Uint8Array(n);
    for (let iter = 0; iter < n; iter++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && travelMin[i] < best) { best = travelMin[i]; u = i; }
      }
      if (u === -1) break;
      visited[u] = 1;
      const ur = Math.floor(u / cols), uc = u % cols;
      const uz = at(ur, uc);
      if (!Number.isFinite(uz)) continue;
      for (const [dr, dc] of NEIGHBOR_OFFSETS) {
        const vr = ur + dr, vc = uc + dc;
        if (vr < 0 || vr >= rows || vc < 0 || vc >= cols) continue;
        const v = vr * cols + vc;
        if (visited[v]) continue;
        const vz = at(vr, vc);
        if (!Number.isFinite(vz)) continue;
        const dist = Math.hypot(dr * cellHeightM, dc * cellWidthM);
        if (!(dist > 0)) continue;
        const slopePercent = ((vz - uz) / dist) * 100;
        const speedMps = toblerSpeedMps(slopePercent);
        const costMin = dist / speedMps / 60;
        const alt = travelMin[u] + costMin;
        if (alt < travelMin[v]) travelMin[v] = alt;
      }
    }
  }

  const zoneKeys = Object.keys(zoneTravelMinutes).map(Number).sort((a, b) => a - b);
  const outermostZone = zoneKeys[zoneKeys.length - 1];
  const zoneOf = (t) => {
    if (!Number.isFinite(t)) return outermostZone; // unreachable cells default to the wild/unmanaged zone
    for (const z of zoneKeys) if (t <= zoneTravelMinutes[z]) return z;
    return outermostZone;
  };
  const zoneAt = new Int8Array(n);
  for (let i = 0; i < n; i++) zoneAt[i] = zoneOf(travelMin[i]);

  const dLng = (bbox.east - bbox.west) / (cols - 1);
  const dLat = (bbox.north - bbox.south) / (rows - 1);
  const visited2 = new Uint8Array(n);
  const zones = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (visited2[idx]) continue;
      const z = zoneAt[idx];
      const stack = [idx];
      const cells = [];
      visited2[idx] = 1;
      while (stack.length) {
        const cur = stack.pop();
        cells.push(cur);
        const cr = Math.floor(cur / cols), cc = cur % cols;
        for (const [nr, nc] of [[cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1]]) {
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (visited2[nIdx] || zoneAt[nIdx] !== z) continue;
          visited2[nIdx] = 1;
          stack.push(nIdx);
        }
      }
      const corners = [];
      for (const cell of cells) {
        const cr = Math.floor(cell / cols), cc = cell % cols;
        const [w, north] = local(cr, cc);
        corners.push([w, north], [w + dLng, north], [w + dLng, north - dLat], [w, north - dLat]);
      }
      const hull = convexHull(corners);
      if (hull.length < 3) continue;
      zones.push({
        zone_number: z,
        boundary_type: useEuclidean ? 'euclidean' : 'cost_distance',
        geometry: { type: 'Polygon', coordinates: [[...hull, hull[0]]] },
        cell_count: cells.length,
      });
    }
  }
  return zones;
}

/** Expanding-ring search for the nearest DEM cell with a finite elevation. */
function nearestValidCell(at, rows, cols, r0, c0) {
  const maxRadius = Math.max(rows, cols);
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only, not filled square
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        if (Number.isFinite(at(r, c))) return { r, c };
      }
    }
  }
  return null;
}

function computeSunSectors(latitude) {
  if (!Number.isFinite(latitude)) return [];
  const year = new Date().getUTCFullYear();
  return [
    { season: 'winter_solstice', doy: winterSolsticeDoy(year) },
    { season: 'summer_solstice', doy: summerSolsticeDoy(year) },
  ].map(({ season, doy }) => {
    const decl = solarDeclination(doy);
    const ha = sunriseHourAngle(latitude, decl);
    // Hour angle is negative before solar noon; with this azimuth formula
    // that maps to +ha for sunrise and -ha for sunset (verified against
    // known sunrise/sunset azimuth values — swapping these two flips
    // morning/afternoon).
    const sunriseAz = solarAzimuthDeg(latitude, decl, ha);
    const sunsetAz = solarAzimuthDeg(latitude, decl, -ha);
    return { season, azimuth_range_deg: [round1(sunriseAz), round1(sunsetAz)] };
  });
}

function dirToDeg(dirLabel) {
  const idx = DIR16.indexOf(dirLabel);
  return idx >= 0 ? idx * 22.5 : null;
}

function windWedge(deg, label, extra) {
  return {
    direction_deg_from: round1(normalizeDeg(deg - SECTOR_HALF_WIDTH_DEG)),
    direction_deg_to: round1(normalizeDeg(deg + SECTOR_HALF_WIDTH_DEG)),
    label,
    ...extra,
  };
}

function computeWindSectors(windRose) {
  if (!windRose?.available) return [];
  const sectors = [];
  const primaryDeg = dirToDeg(windRose.primary_direction);
  if (primaryDeg != null) {
    sectors.push(windWedge(primaryDeg, 'prevailing_wind', {
      frequency_pct: windRose.primary_frequency_pct ?? null,
      data_source: windRose.source || 'NASA POWER wind rose',
    }));
  }
  const secondaryDeg = dirToDeg(windRose.secondary_direction);
  if (secondaryDeg != null) {
    sectors.push(windWedge(secondaryDeg, 'secondary_wind', {
      frequency_pct: windRose.secondary_frequency_pct ?? null,
      data_source: windRose.source || 'NASA POWER wind rose',
    }));
  }
  return sectors;
}

/**
 * Optional fire-risk sector: the prevailing wind direction, flagged as an
 * elevated fire-approach sector. The wind-rose source here (wind-rose.js)
 * is an annual aggregate with no fire-season-filtered breakdown, so this is
 * an approximation of the hot/dry-season direction rather than data
 * actually restricted to fire-season months — surfaced explicitly via
 * `basis` rather than presented as more precise than it is.
 */
function computeFireSectors(windRose) {
  if (!windRose?.available) return [];
  const deg = dirToDeg(windRose.primary_direction);
  if (deg == null) return [];
  return [windWedge(deg, 'fire_approach', {
    data_source: windRose.source || 'NASA POWER wind rose',
    basis: 'Annual prevailing wind direction (no fire-season-filtered wind breakdown available in this pipeline) — an approximation of the hot/dry-season direction, not a confirmed fire-season rose.',
  })];
}
