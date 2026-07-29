/**
 * Access & mobility analysis for Alberta properties.
 *
 * Computes:
 *  - Nearest road (name, type, distance)
 *  - Nearest supermarket / grocery (name, distance)
 *  - Travel time & cost to nearest city or supermarket
 *  - Cost estimates for: truck, SUV, car, EV, motorcycle
 *
 * Data: OpenStreetMap Overpass API for road + amenity queries.
 * Costs: Current Alberta gas prices + vehicle consumption assumptions.
 */

export function findNearestRoadSync(centre) {
  return { name: null, type: null, distance_m: null, available: false, note: 'Async Overpass query not available in sync mode' };
}

export function findNearestSupermarketSync(centre) {
  return { name: null, type: null, distance_km: null, available: false, note: 'Async Overpass query not available in sync mode' };
}

const GAS_PRICE_CAD_L = 1.45;

const VEHICLES = {
  truck:    { label: 'Pickup truck (V8)',   l_per_100km: 14.0, speed_kmh: 95 },
  suv:      { label: 'SUV (mid-size)',      l_per_100km: 10.0, speed_kmh: 95 },
  car:      { label: 'Car (compact)',        l_per_100km: 7.0,  speed_kmh: 95 },
  ev:       { label: 'Electric car',         l_per_100km: 0,    cost_per_km: 0.05, speed_kmh: 95 },
  motorbike:{ label: 'Motorcycle',           l_per_100km: 4.0,  speed_kmh: 90 },
};

export function tripCostsForDistance(distanceKm, opts = {}) {
  const gasPrice = opts.gasPrice || GAS_PRICE_CAD_L;
  const roundTrip = distanceKm * 2;
  const results = [];
  for (const [key, v] of Object.entries(VEHICLES)) {
    const fuelUsed = v.l_per_100km > 0 ? Math.round((v.l_per_100km / 100) * roundTrip * 10) / 10 : 0;
    const elecCost = v.cost_per_km ? Math.round(roundTrip * v.cost_per_km * 100) / 100 : 0;
    const totalCost = Math.round((fuelUsed * gasPrice + elecCost) * 100) / 100;
    const timeMin = Math.round((distanceKm / v.speed_kmh) * 60);
    results.push({
      vehicle: v.label, key, oneWayDistanceKm: Math.round(distanceKm * 10) / 10,
      roundTripKm: Math.round(roundTrip * 10) / 10, fuelConsumedL: fuelUsed || null,
      electricityCostCad: elecCost || null, roundTripCostCad: totalCost,
      travelTimeOneWayMin: timeMin,
      travelTimeOneWayFormatted: timeMin >= 60 ? `${Math.floor(timeMin / 60)}h ${timeMin % 60}m` : `${timeMin} min`,
      gasPriceAssumed: gasPrice,
    });
  }
  return results;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function findNearestRoad(centre) {
  const { latitude, longitude } = centre;
  const query = `[out:json][timeout:15];way(around:500,${latitude},${longitude})[highway];out tags 3;`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain' }, body: query });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    if (!data.elements?.length) return { name: null, type: null, distance_m: null, available: false };
    let best = null, bestDist = Infinity;
    for (const el of data.elements) {
      if (!el.tags?.highway) continue;
      const d = el.center ? haversineKm(latitude, longitude, el.center.lat, el.center.lon) * 1000 : 300;
      if (d < bestDist) { bestDist = d; best = el; }
    }
    if (!best) return { name: null, type: null, distance_m: null, available: false };
    return { name: best.tags?.name || best.tags?.ref || null, type: best.tags?.highway || null, distance_m: Math.round(bestDist), available: true };
  } catch (e) { console.warn('Road query failed:', e.message); return { name: null, type: null, distance_m: null, available: false }; }
}

export async function findNearestSupermarket(centre) {
  const { latitude, longitude } = centre;
  const query = `[out:json][timeout:20];(node["shop"="supermarket"](around:50000,${latitude},${longitude});node["shop"="grocery"](around:50000,${latitude},${longitude});node["shop"="convenience"](around:50000,${latitude},${longitude}););out body 5;`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain' }, body: query });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();
    if (!data.elements?.length) return { name: null, type: null, distance_km: null, available: false };
    let best = null, bestDist = Infinity;
    for (const el of data.elements) {
      const d = haversineKm(latitude, longitude, el.lat, el.lon);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    if (!best) return { name: null, type: null, distance_km: null, available: false };
    return { name: best.tags?.name || best.tags?.brand || 'Grocery store', type: best.tags?.shop || 'supermarket', distance_km: Math.round(bestDist * 10) / 10, lat: best.lat, lng: best.lon, available: true };
  } catch (e) { console.warn('Supermarket query failed:', e.message); return { name: null, type: null, distance_km: null, available: false }; }
}

export async function assessAccess(centre, nearestCityDistanceKm) {
  const [road, supermarket] = await Promise.all([findNearestRoad(centre), findNearestSupermarket(centre)]);
  const distKm = supermarket?.distance_km || nearestCityDistanceKm || null;
  const costs = distKm ? tripCostsForDistance(distKm) : [];
  return {
    available: true,
    nearest_road: road,
    nearest_supermarket: supermarket,
    trip_costs_to_supermarket: costs,
    gas_price_cad_l: GAS_PRICE_CAD_L,
    methodology: 'OpenStreetMap Overpass API + Alberta gas price estimate',
  };
}

export function assessAccessSync(centre, nearestCityDistanceKm) {
  return assessAccess(centre, nearestCityDistanceKm);
}
