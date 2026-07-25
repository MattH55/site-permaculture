/**
 * Alberta zoning is municipal — no free provincial parcel/zoning bulk API.
 * Phase 2: municipality → bylaw / GIS portal lookup (not automated designation).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALBERTA_PLACES, haversineKm } from './proximity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTALS_PATH = path.join(__dirname, '..', 'data', 'zoning', 'portals.json');

let portals = null;

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ nearest_city?: { name?: string }, nearest_settlement?: { name?: string }, municipality?: string }} [ctx]
 */
export function resolveZoningContext(centre, ctx = {}) {
  const table = loadPortals();
  const name =
    ctx.municipality ||
    ctx.nearest_settlement?.name ||
    ctx.nearest_city?.name ||
    nearestPlace(centre.latitude, centre.longitude);

  const hit = findPortal(table, name);
  const nearest = nearestPortalPlace(centre.latitude, centre.longitude, table);

  return {
    municipality: hit?.municipality || name || null,
    zoning_designation: null, // not automated in phase 2
    zoning_source_url: hit?.portal_url || nearest?.portal_url || null,
    zoning_bylaw_url: hit?.bylaw_url || nearest?.bylaw_url || null,
    zoning_gis_url: hit?.gis_url || nearest?.gis_url || null,
    zoning_notes: hit?.notes || nearest?.notes || null,
    match: hit ? 'name' : nearest ? 'nearest_portal' : 'none',
    nearest_portal_municipality: nearest?.municipality || null,
    phase: 2,
    note:
      'Zoning bylaws are set per municipality; AltaLIS holds authoritative parcel fabric (licensed). This tool links to the local portal rather than inventing a designation.',
  };
}

function findPortal(table, name) {
  if (!name) return null;
  const n = norm(name);
  return (
    table.portals.find((p) => norm(p.municipality) === n) ||
    table.portals.find((p) => n.includes(norm(p.municipality)) || norm(p.municipality).includes(n)) ||
    null
  );
}

function nearestPortalPlace(lat, lng, table) {
  let best = null;
  for (const p of table.portals) {
    if (p.lat == null || p.lng == null) continue;
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { ...p, d };
  }
  return best;
}

function nearestPlace(lat, lng) {
  let best = null;
  for (const p of ALBERTA_PLACES) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = p;
  }
  return best?.name || null;
}

function loadPortals() {
  if (portals) return portals;
  portals = JSON.parse(fs.readFileSync(PORTALS_PATH, 'utf8'));
  return portals;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
