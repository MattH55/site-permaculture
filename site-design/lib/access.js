/**
 * Access & mobility analysis for Alberta properties.
 *
 * Nearest road: Nominatim reverse (fast, named roads) + Overpass (distance /
 * unnamed tracks) with multi-mirror fallback.
 */

const GAS_PRICE_CAD_L = 1.45;

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
    note: 'Async Overpass query not available in sync mode',
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

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function overpassQuery(query, timeoutMs = 12_000) {
  const body = `data=${encodeURIComponent(query)}`;
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'User-Agent': 'ExpandingEdgeSiteDesign/1.0 (permaculture access)',
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

/** Fast named-road lookup via Nominatim reverse geocode. */
async function nominatimRoad(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ExpandingEdgeSiteDesign/1.0 (permaculture; expandingedge.ca)',
      },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const j = await res.json();
    const a = j.address || {};
    const name =
      a.road ||
      a.highway ||
      a.residential ||
      a.unclassified ||
      a.pedestrian ||
      a.footway ||
      null;
    if (!name) return null;
    // Rough distance: if reverse hit a road at this zoom, treat as local access
    // (parcel centroid may be tens–hundreds of metres from the centreline)
    return {
      name,
      type: a.road ? 'road' : a.highway || 'road',
      named: true,
      source: 'OpenStreetMap Nominatim reverse',
      display_name: j.display_name || null,
      osm_type: j.osm_type || null,
      osm_id: j.osm_id || null,
    };
  } finally {
    clearTimeout(t);
  }
}

/** Overpass: nearest highway way with centreline distance. */
async function overpassNearestHighway(lat, lng) {
  // Single pass first (covers most urban + near-road rural). Expand once if empty.
  const radii = [3000, 15000];
  let lastNote = null;
  for (const radiusM of radii) {
    const query = `
[out:json][timeout:8];
way(around:${radiusM},${lat},${lng})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)$"];
out tags center 15;
`.trim();
    try {
      const data = await overpassQuery(query, 9_000);
      const ranked = rankRoads(data.elements || [], lat, lng);
      if (!ranked.length) {
        lastNote = `No highway ways within ${radiusM / 1000} km (OSM).`;
        continue;
      }
      const best = ranked[0];
      return {
        name: roadLabel(best.tags),
        type: best.tags.highway || null,
        distance_m: Math.round(best.distance_m),
        named: !!(best.tags.name || best.tags.ref),
        surface: best.tags.surface || null,
        tracktype: best.tags.tracktype || null,
        search_radius_m: radiusM,
        source: 'OpenStreetMap Overpass',
      };
    } catch (e) {
      lastNote = e.message;
      if (radiusM === radii[radii.length - 1]) throw e;
    }
  }
  return {
    name: null,
    type: null,
    distance_m: null,
    named: false,
    note: lastNote || 'No road found within 15 km in OpenStreetMap.',
    search_radius_m: 15000,
  };
}

function rankRoads(els, lat, lng) {
  const scored = [];
  for (const el of els) {
    const tags = el.tags || {};
    if (!tags.highway) continue;
    const clat = el.lat ?? el.center?.lat;
    const clng = el.lon ?? el.center?.lon;
    if (clat == null || clng == null) continue;
    const distance_m = haversineKm(lat, lng, clat, clng) * 1000;
    const rank = HIGHWAY_RANK[tags.highway] ?? 15;
    const named = !!(tags.name || tags.ref);
    const score = distance_m + rank * 80 + (named ? 0 : 120);
    scored.push({ tags, distance_m, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored;
}

function roadLabel(tags = {}) {
  if (tags.name) return tags.name;
  if (tags.ref) return tags.ref;
  if (tags.official_name) return tags.official_name;
  if (tags.loc_name) return tags.loc_name;
  const hw = tags.highway || 'road';
  const surface = tags.surface ? ` · ${tags.surface}` : '';
  return `Unnamed ${hw}${surface}`;
}

/**
 * Nearest road for a site centroid.
 * Nominatim first (fast names). Overpass distance is best-effort with a short cap.
 */
export async function findNearestRoad(centre) {
  const { latitude, longitude } = centre;

  const nom = await nominatimRoad(latitude, longitude).catch(() => null);

  // If we already have a name, only wait briefly for Overpass distance
  const overpassBudgetMs = nom?.name ? 6_000 : 14_000;
  let ov = null;
  try {
    ov = await Promise.race([
      overpassNearestHighway(latitude, longitude),
      new Promise((resolve) => setTimeout(() => resolve(null), overpassBudgetMs)),
    ]);
  } catch (e) {
    ov = { error: e.message, note: e.message };
  }

  if (ov && ov.distance_m != null) {
    const name = nom?.name || ov.name;
    const named = !!(nom?.name || ov.named);
    return {
      name,
      type: ov.type || nom?.type || 'road',
      distance_m: ov.distance_m,
      available: true,
      named,
      surface: ov.surface || null,
      tracktype: ov.tracktype || null,
      search_radius_m: ov.search_radius_m,
      source: nom?.name
        ? 'Nominatim + OpenStreetMap Overpass'
        : ov.source || 'OpenStreetMap Overpass',
    };
  }

  if (nom?.name) {
    return {
      name: nom.name,
      type: nom.type || 'road',
      distance_m: null,
      available: true,
      named: true,
      note: 'Road name from reverse geocode (OpenStreetMap).',
      source: nom.source,
    };
  }

  return {
    name: null,
    type: null,
    distance_m: null,
    available: false,
    named: false,
    error: ov?.error || null,
    note:
      ov?.note ||
      'No road found. Property may sit on an unmapped range road or trail in OpenStreetMap.',
    search_radius_m: 15000,
  };
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
      'Nominatim reverse (road name) + OpenStreetMap Overpass (highway distance) + nearest-city trip costs',
  };
}

export function assessAccessSync(centre, nearestCityDistanceKm) {
  return assessAccess(centre, nearestCityDistanceKm);
}
