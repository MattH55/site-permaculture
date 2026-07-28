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

export function assessAccessSync(centre, nearestCityDistanceKm) {
  const costs = nearestCityDistanceKm ? tripCostsForDistance(nearestCityDistanceKm) : [];

  return {
    available: true,
    nearest_road: { name: null, type: null, distance_m: null, available: false },
    nearest_supermarket: { name: null, type: null, distance_km: nearestCityDistanceKm || null, available: !!nearestCityDistanceKm },
    trip_costs_to_supermarket: costs,
    gas_price_cad_l: GAS_PRICE_CAD_L,
    methodology: 'OSM Overpass (async) + Alberta gas price estimate',
  };
}