import fs from 'node:fs';
import path from 'node:path';
import { canonicalName, taxonIdFromName } from './taxonomy.js';
import { distanceKm } from './site-environment.js';

const DIR = path.join(import.meta.dirname, '..', '..', 'data', 'plant-intelligence');

let vendorsCache;
let pricesCache;

export function loadVendors() {
  if (vendorsCache) return vendorsCache;
  const p = path.join(DIR, 'alberta-vendors.json');
  vendorsCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { vendors: [] };
  return vendorsCache;
}

export function loadPriceObservations() {
  if (pricesCache) return pricesCache;
  const p = path.join(DIR, 'price-observations.json');
  pricesCache = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { observations: [] };
  return pricesCache;
}

export function freshnessLabel(observedAt, now = Date.now()) {
  if (!observedAt) return 'archival';
  const days = (now - Date.parse(observedAt)) / 86400000;
  if (!Number.isFinite(days) || days < 0) return 'archival';
  if (days <= 30) return 'current';
  if (days <= 90) return 'recent';
  if (days <= 180) return 'stale';
  if (days <= 365) return 'historical';
  return 'archival';
}

export function nearbyVendors({ latitude, longitude, limit = 8 } = {}) {
  const vendors = loadVendors().vendors || [];
  return vendors
    .map((v) => ({
      ...v,
      distance_km: distanceKm(latitude, longitude, v.latitude, v.longitude),
    }))
    .sort((a, b) => (a.distance_km ?? 9e9) - (b.distance_km ?? 9e9))
    .slice(0, limit);
}

export function pricesForTaxon(scientificName, { latitude, longitude } = {}) {
  const key = taxonIdFromName(scientificName);
  const vendors = Object.fromEntries((loadVendors().vendors || []).map((v) => [v.vendor_id, v]));
  const obs = (loadPriceObservations().observations || [])
    .filter((o) => taxonIdFromName(o.scientific_name) === key || canonicalName(o.scientific_name) === canonicalName(scientificName))
    .map((o) => {
      const vendor = vendors[o.vendor_id];
      const dist = vendor ? distanceKm(latitude, longitude, vendor.latitude, vendor.longitude) : null;
      const delivery = deliveryCost(vendor, dist, o.price_cad);
      return {
        ...o,
        taxon_id: key,
        vendor_name: vendor?.name || o.vendor_id,
        vendor_municipality: vendor?.municipality || null,
        distance_km: dist != null ? Math.round(dist * 10) / 10 : null,
        pickup_total_cad: o.price_cad,
        delivered_total_cad: o.price_cad + delivery,
        delivery_cad: delivery,
        freshness: freshnessLabel(o.observed_at),
        price_class: o.price_class || 'retail',
      };
    })
    .sort((a, b) => freshnessRank(a.freshness) - freshnessRank(b.freshness) || a.delivered_total_cad - b.delivered_total_cad);
  return obs;
}

export function bestOffer(scientificName, site = {}) {
  const list = pricesForTaxon(scientificName, site);
  if (!list.length) return null;
  const preferred = list.find((o) => o.freshness === 'current' || o.freshness === 'recent') || list[0];
  return preferred;
}

function deliveryCost(vendor, distKm, plantPrice) {
  if (distKm == null) return 0;
  if (vendor?.pickup && distKm <= 25) return 0;
  if (vendor?.kind === 'mail_order_nursery') return Math.max(18, Math.min(45, plantPrice * 0.15));
  if (distKm <= (vendor?.delivery_radius_km || 0)) return Math.max(25, Math.round(distKm * 1.2));
  return Math.max(40, Math.round(distKm * 1.4));
}

function freshnessRank(f) {
  return { current: 0, recent: 1, stale: 2, historical: 3, archival: 4 }[f] ?? 5;
}
