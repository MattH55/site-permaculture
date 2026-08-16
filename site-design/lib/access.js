/**
 * Access & mobility analysis for Alberta properties.
 *
 * Nearest road uses the OSRM nearest API (snap to driving network) — correct
 * distance to the road centreline, not reverse-geocode guesses or way centroids.
 * Nominatim only fills blank names; Overpass is a last-resort fallback.
 */

const GAS_PRICE_CAD_L = 1.45;

const OSRM_NEAREST = [
  'https://router.project-osrm.org/nearest/v1/driving',
  'https://routing.openstreetmap.de/routed-car/nearest/v1/driving',
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const VEHICLES = {
  truck: { label: 'Pickup truck (V8)', l_per_100km: 14.0, speed_kmh: 95 },
  suv: { label: 'SUV (mid-size)', l_per_100km: 10.0, speed_kmh: 95 },
  car: { label: 'Car (compact)', l_per_100km: 7.0, speed_kmh: 95 },
  ev: { label: 'Electric car', l_per_100km: 0, cost_per_km: 0.05, speed_kmh: 95 },
  motorbike: { label: 'Motorcycle', l_per_100km: 4.0, speed_kmh: 90 },
};

const HIGHWAY_RANK = {
  motorway: 1,
  trunk: 2,
  primary: 3,
  secondary: 4,
  tertiary: 5,
  unclassified: 6,
  residential: 7,
  living_street: 8,
  service: 12,
  track: 14,
};

export function findNearestRoadSync() {
  return {
    name: null,
    type: null,
    distance_m: null,
    available: false,
    note: 'Async road query not available in sync mode',
  };
}

export function findNearestSupermarketSync() {
  return {
    name: null,
    type: null,
    distance_km: null,
    available: false,
    note: 'Async Overpass query not available in sync mode',
  };
}

export function tripCostsForDistance(distanceKm, opts = {}) {
  const gasPrice = opts.gasPrice || GAS_PRICE_CAD_L;
  const roundTrip = distanceKm * 2;
  const results = [];
  for (const [key, v] of Object.entries(VEHICLES)) {
    const fuelUsed =
      v.l_per_100km > 0 ? Math.round((v.l_per_100km / 100) * roundTrip * 10) / 10 : 0;
    const elecCost = v.cost_per_km ? Math.round(roundTrip * v.cost_per_km * 100) / 100 : 0;
    const totalCost = Math.round((fuelUsed * gasPrice + elecCost) * 100) / 100;
    const timeMin = Math.round((distanceKm / v.speed_kmh) * 60);
    results.push({
      vehicle: v.label,
      key,
      oneWayDistanceKm: Math.round(distanceKm * 10) / 10,
      roundTripKm: Math.round(roundTrip * 10) / 10,
      fuelConsumedL: fuelUsed || null,
      electricityCostCad: elecCost || null,
      roundTripCostCad: totalCost,
      travelTimeOneWayMin: timeMin,
      travelTimeOneWayFormatted:
        timeMin >= 60 ? `${Math.floor(timeMin / 60)}h ${timeMin % 60}m` : `${timeMin} min`,
      gasPriceAssumed: gasPrice,
    });
  }
  return results;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  return haversineM(lat1, lng1, lat2, lng2) / 1000;
}

// ── OSRM nearest (primary) ───────────────────────────────

/**
 * Snap point to nearest driveable road edge(s).
 * @returns {{ name: string|null, distance_m: number, snap_lat: number, snap_lng: number }|null}
 */
async function osrmNearest(lat, lng) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'LandIntelligenceSiteDesign/1.0 (permaculture access)',
  };

  let lastErr;
  for (const base of OSRM_NEAREST) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      // number=5 so we can prefer a named road among the closest snaps
      const url = `${base}/${lng},${lat}?number=5`;
      const res = await fetch(url, { signal: ctrl.signal, headers });
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.waypoints?.length) {
        throw new Error(data.code || 'OSRM empty');
      }

      const waypoints = data.waypoints
        .map((w) => ({
          name: (w.name && String(w.name).trim()) || null,
          distance_m: Number(w.distance),
          snap_lng: w.location?.[0],
          snap_lat: w.location?.[1],
        }))
        .filter((w) => Number.isFinite(w.distance_m));

      if (!waypoints.length) throw new Error('OSRM no valid waypoints');

      // Prefer the closest *named* road if it's not much farther than the absolute nearest
      const nearest = waypoints[0];
      const named = waypoints.find((w) => w.name);
      let pick = nearest;
      if (named && named.distance_m <= Math.max(nearest.distance_m * 1.5, nearest.distance_m + 40)) {
        pick = named;
      }

      return {
        name: pick.name,
        distance_m: Math.round(pick.distance_m),
        snap_lat: pick.snap_lat,
        snap_lng: pick.snap_lng,
        candidates: waypoints.slice(0, 3),
        source: 'OSRM nearest (OpenStreetMap driving network)',
      };
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('OSRM nearest failed');
}

/** Fill blank OSRM names via Nominatim at the snap point (or original centroid). */
async function nominatimNameAt(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'LandIntelligenceSiteDesign/1.0 (permaculture; LandIntelligence.ca)',
      },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const a = j.address || {};
    return (
      a.road ||
      a.highway ||
      a.residential ||
      a.unclassified ||
      a.pedestrian ||
      null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Overpass fallback (geometry-aware distance) ──────────

async function overpassQuery(query, timeoutMs = 12_000) {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'LandIntelligenceSiteDesign/1.0 (permaculture access)',
  };
  const tryOne = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', body, signal: ctrl.signal, headers });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map((url) => tryOne(url)));
  } catch (e) {
    throw new Error(e?.errors?.[0]?.message || e.message || 'Overpass failed');
  }
}

/** Minimum distance from point to a polyline (lat/lng vertices). */
function distanceToPolylineM(lat, lng, geometry) {
  if (!geometry?.length) return Infinity;
  let best = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    if (a?.lat == null || b?.lat == null) continue;
    const d = distanceToSegmentM(lat, lng, a.lat, a.lon, b.lat, b.lon);
    if (d < best) best = d;
  }
  // single-node ways
  if (geometry.length === 1 && geometry[0]?.lat != null) {
    best = Math.min(best, haversineM(lat, lng, geometry[0].lat, geometry[0].lon));
  }
  return best;
}

/** Approx equirectangular projection for short segments. */
function distanceToSegmentM(plat, plng, lat1, lng1, lat2, lng2) {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const mx = 111320 * Math.cos(midLat);
  const my = 111320;
  const px = plng * mx;
  const py = plat * my;
  const ax = lng1 * mx;
  const ay = lat1 * my;
  const bx = lng2 * mx;
  const by = lat2 * my;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

async function overpassNearestRoad(lat, lng) {
  const radii = [1500, 8000, 20000];
  let lastNote = null;
  for (const radiusM of radii) {
    const query = `
[out:json][timeout:12];
way(around:${radiusM},${lat},${lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)$"];
out tags geom 30;
`.trim();
    try {
      const data = await overpassQuery(query, 13_000);
      const els = data.elements || [];
      if (!els.length) {
        lastNote = `No OSM highway within ${radiusM / 1000} km.`;
        continue;
      }
      let best = null;
      for (const el of els) {
        const tags = el.tags || {};
        if (!tags.highway) continue;
        const dist = distanceToPolylineM(lat, lng, el.geometry);
        if (!Number.isFinite(dist)) continue;
        const rank = HIGHWAY_RANK[tags.highway] ?? 15;
        const named = !!(tags.name || tags.ref);
        // Prefer closer; slight penalty for tracks/service and unnamed
        const score = dist + rank * 15 + (named ? 0 : 25);
        if (!best || score < best.score) {
          best = {
            score,
            distance_m: dist,
            name: tags.name || tags.ref || tags.official_name || tags.loc_name || null,
            type: tags.highway,
            named,
            surface: tags.surface || null,
            tracktype: tags.tracktype || null,
          };
        }
      }
      if (best) {
        return {
          name: best.name || `Unnamed ${best.type}`,
          type: best.type,
          distance_m: Math.round(best.distance_m),
          named: best.named,
          surface: best.surface,
          tracktype: best.tracktype,
          search_radius_m: radiusM,
          source: 'OpenStreetMap Overpass (geometry distance)',
        };
      }
    } catch (e) {
      lastNote = e.message;
      if (radiusM === radii[radii.length - 1]) throw e;
    }
  }
  return {
    available: false,
    name: null,
    type: null,
    distance_m: null,
    named: false,
    note: lastNote || 'No road found within 20 km.',
    search_radius_m: 20000,
  };
}

// ── Public API ───────────────────────────────────────────

/**
 * Nearest road to a site centroid.
 * 1) OSRM snap to driving network (correct distance)
 * 2) Nominatim name fill if OSRM name blank
 * 3) Overpass geometry distance fallback
 */
export async function findNearestRoad(centre) {
  const { latitude, longitude } = centre;

  // 1) OSRM nearest
  try {
    const snap = await osrmNearest(latitude, longitude);
    let name = snap.name;
    let named = !!name;
    let type = 'road';

    if (!name && snap.snap_lat != null && snap.snap_lng != null) {
      const filled = await nominatimNameAt(snap.snap_lat, snap.snap_lng);
      if (filled) {
        name = filled;
        named = true;
      }
    }
    if (!name) {
      const filled = await nominatimNameAt(latitude, longitude);
      if (filled) {
        name = filled;
        named = true;
      }
    }
    if (!name) {
      name = 'Unnamed road';
      named = false;
    }

    return {
      name,
      type,
      distance_m: snap.distance_m,
      available: true,
      named,
      snap_lat: snap.snap_lat,
      snap_lng: snap.snap_lng,
      candidates: snap.candidates,
      source: snap.source + (named && !snap.name ? ' + Nominatim name' : ''),
    };
  } catch (osrmErr) {
    console.warn('OSRM nearest failed:', osrmErr.message);
  }

  // 2) Overpass geometry fallback
  try {
    const ov = await overpassNearestRoad(latitude, longitude);
    if (ov.distance_m != null) {
      return {
        ...ov,
        available: true,
      };
    }
    return {
      available: false,
      name: null,
      type: null,
      distance_m: null,
      named: false,
      note: ov.note || 'No road found.',
      search_radius_m: ov.search_radius_m,
    };
  } catch (e) {
    console.warn('Overpass road fallback failed:', e.message);
    // 3) Nominatim-only last resort (name without reliable distance)
    const nom = await nominatimNameAt(latitude, longitude);
    if (nom) {
      return {
        name: nom,
        type: 'road',
        distance_m: null,
        available: true,
        named: true,
        note: 'Road name from reverse geocode only; centreline distance unavailable.',
        source: 'OpenStreetMap Nominatim reverse',
      };
    }
    return {
      name: null,
      type: null,
      distance_m: null,
      available: false,
      named: false,
      error: e.message,
      note: `Road lookup failed (${e.message}). Property may sit on an unmapped range road or trail.`,
    };
  }
}

export async function findNearestSupermarket(centre) {
  const { latitude, longitude } = centre;
  const query = `
[out:json][timeout:12];
(
  node["shop"="supermarket"](around:40000,${latitude},${longitude});
  node["shop"="grocery"](around:40000,${latitude},${longitude});
);
out body 6;
`.trim();
  try {
    const data = await overpassQuery(query, 12_000);
    if (!data.elements?.length) {
      return { name: null, type: null, distance_km: null, available: false };
    }
    let best = null;
    let bestDist = Infinity;
    for (const el of data.elements) {
      if (el.lat == null || el.lon == null) continue;
      const d = haversineKm(latitude, longitude, el.lat, el.lon);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
    if (!best) return { name: null, type: null, distance_km: null, available: false };
    return {
      name: best.tags?.name || best.tags?.brand || 'Grocery store',
      type: best.tags?.shop || 'supermarket',
      distance_km: Math.round(bestDist * 10) / 10,
      lat: best.lat,
      lng: best.lon,
      available: true,
    };
  } catch (e) {
    console.warn('Supermarket query failed:', e.message);
    return { name: null, type: null, distance_km: null, available: false, error: e.message };
  }
}

export async function assessAccess(centre, nearestCityDistanceKm) {
  const road = await findNearestRoad(centre);
  const distKm = nearestCityDistanceKm || null;
  const costs = distKm ? tripCostsForDistance(distKm) : [];
  return {
    available: true,
    nearest_road: road,
    trip_costs_to_city: costs,
    nearest_city_distance_km: distKm,
    gas_price_cad_l: GAS_PRICE_CAD_L,
    methodology:
      'OSRM nearest snap to OSM driving network (distance) + Nominatim name fill when needed; Overpass geometry fallback',
  };
}

export function assessAccessSync(centre, nearestCityDistanceKm) {
  return assessAccess(centre, nearestCityDistanceKm);
}
