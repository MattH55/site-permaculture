/**
 * NRCan Plant Hardiness Zones of Canada (4th edition, 1991–2020 climate).
 * Live ESRI REST query — no bulk download required.
 *
 * https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/PlantHardiness_en/MapServer/0
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER =
  'https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/PlantHardiness_en/MapServer/0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FROST_PATH = path.join(__dirname, '..', 'data', 'climate', 'frost-dates-ab.json');

let frostTable = null;

/**
 * @param {{ latitude: number, longitude: number }} centre
 */
export async function queryHardiness(centre) {
  const lat = centre.latitude;
  const lng = centre.longitude;

  try {
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'zone',
      returnGeometry: 'false',
      resultRecordCount: '1',
      f: 'json',
    });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 18_000);
    let data;
    try {
      const res = await fetch(`${LAYER}/query?${params}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(t);
    }

    const zone = data.features?.[0]?.attributes?.zone || null;
    const frost = frostForZone(zone, lat, lng);

    return {
      available: !!zone,
      hardiness_zone: zone,
      frost_free_days_estimate: frost?.frost_free_days ?? null,
      first_fall_frost_approx: frost?.first_fall_frost ?? null,
      last_spring_frost_approx: frost?.last_spring_frost ?? null,
      frost_table_region: frost?.region ?? null,
      source_name: 'NRCan Plant Hardiness Zones of Canada (4th edition, 1991–2020)',
      source_url: LAYER,
      methodology_note:
        'Zone from seven climate variables including coldest-month minima, frost-free period, and wind. Frost dates are a static Alberta regional table keyed by zone — not a parcel microclimate forecast.',
      edition: '4th',
      climate_normals: '1991–2020',
    };
  } catch (e) {
    return {
      available: false,
      hardiness_zone: null,
      error: e.message,
      source_name: 'NRCan Plant Hardiness Zones of Canada',
      source_url: LAYER,
    };
  }
}

function frostForZone(zone, lat, lng) {
  const table = loadFrost();
  if (!zone) return null;
  const z = String(zone).toLowerCase();
  // Prefer zone match, then latitude band
  const byZone = (table.by_zone || {})[z] || (table.by_zone || {})[z.replace(/[ab]$/, '')];
  if (byZone) return { ...byZone, region: byZone.region || `zone ${zone}` };

  // Latitude bands for Alberta
  for (const band of table.by_latitude || []) {
    if (lat >= band.lat_min && lat < band.lat_max) return band;
  }
  return table.default || null;
}

function loadFrost() {
  if (frostTable) return frostTable;
  if (!fs.existsSync(FROST_PATH)) {
    frostTable = { by_zone: {}, by_latitude: [], default: null };
    return frostTable;
  }
  frostTable = JSON.parse(fs.readFileSync(FROST_PATH, 'utf8'));
  return frostTable;
}
