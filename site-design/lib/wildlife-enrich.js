/**
 * Wildlife data enrichment for Alberta properties.
 *
 * Data stack (in priority order for property reports):
 * 1. ABMI species distribution maps (1km², relative abundance) — GeoTIFF via rasterio
 * 2. WMU boundaries → harvest stats, season data, game density
 * 3. iNaturalist observations — recent, hyper-local
 * 4. GBIF — aggregates iNaturalist + eBird + museums + gov records
 * 5. Wildlife sensitivity layers (raptor ranges, at-risk species)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esriEnvelope } from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Query GBIF for recent species observations within a bbox.
 * GBIF aggregates iNaturalist, eBird, museum collections, and gov datasets.
 *
 * @param {{ west, south, east, north }} bbox
 * @param {{ limit?: number, year?: string }} opts
 */
export async function queryGbig(bbox, opts = {}) {
  const limit = opts.limit || 50;
  const year = opts.year || '2022,2026';

  const url =
    `https://api.gbif.org/v1/occurrence/search?` +
    `decimalLatitude=${bbox.south},${bbox.north}` +
    `&decimalLongitude=${bbox.west},${bbox.east}` +
    `&year=${year}` +
    `&hasCoordinate=true` +
    `&limit=${limit}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`GBIF ${res.status}`);
    const data = await res.json();

    if (!data.results?.length) return { total: 0, species: [], results: [] };

    const species = {};
    for (const r of data.results) {
      const name = r.species || r.scientificName || 'Unknown';
      species[name] = (species[name] || 0) + 1;
    }

    const topSpecies = Object.entries(species)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({
        scientific_name: name,
        common_name: data.results.find((r) => r.species === name || r.scientificName === name)?.vernacularName || null,
        observations: count,
      }));

    return {
      total: data.count || data.results.length,
      top_species: topSpecies,
      methodology: 'GBIF occurrence search (aggregates iNaturalist, eBird, museums, gov records)',
      source_url: 'https://www.gbif.org/',
    };
  } catch (e) {
    console.warn('GBIF query failed:', e.message);
    return { total: 0, species: [], results: [], error: e.message };
  }
}

/**
 * Load WMU boundaries from a local GeoJSON file.
 * Download: https://open.alberta.ca/opendata/wildlife-management-units
 *
 * Maps a point to its WMU code for game species context.
 *
 * @param {{ latitude: number, longitude: number }} centre
 * @returns {{ wmu_code: string|null, wmu_name: string|null }}
 */
export function lookupWmu(centre) {
  const wmuPath = path.join(__dirname, '..', 'data', 'wmu', 'wildlife-management-units.geojson');

  if (!fs.existsSync(wmuPath)) {
    return { wmu_code: null, wmu_name: null, available: false, note: 'WMU data not downloaded. Get from open.alberta.ca/opendata/wildlife-management-units' };
  }

  try {
    const geo = JSON.parse(fs.readFileSync(wmuPath, 'utf8'));
    const features = geo.features || [];

    // Point-in-polygon test for WMU containing the site centre
    for (const f of features) {
      const coords = f.geometry?.coordinates?.[0];
      if (!coords) continue;
      if (pointInPolygon(centre.longitude, centre.latitude, coords)) {
        return {
          wmu_code: f.properties?.WMUNIT_COD || f.properties?.WMU_CODE || f.properties?.CODE || null,
          wmu_name: f.properties?.WMUNIT_NAM || f.properties?.WMU_NAME || f.properties?.NAME || null,
          available: true,
        };
      }
    }

    return { wmu_code: null, wmu_name: null, available: true, note: 'Site outside all WMU boundaries' };
  } catch (e) {
    console.warn('WMU lookup failed:', e.message);
    return { wmu_code: null, wmu_name: null, available: false, note: e.message };
  }
}

/**
 * Wildlife sensitivity check — flags known constraints from public spatial layers.
 * Currently uses heuristic lat/lng bands; can be enhanced with actual raster/GIS layers.
 *
 * @param {{ latitude: number, longitude: number }} centre
 */
export function checkWildlifeSensitivity(centre) {
  const { latitude, longitude } = centre;
  const flags = [];

  // Boreal zone (north of 55°) — caribou range, higher sensitivity
  if (latitude > 55) {
    flags.push({
      species: 'Woodland Caribou',
      severity: 'caution',
      note: 'Northern Alberta is within boreal caribou range. Earthworks may require habitat assessment under the federal Species at Risk Act.',
    });
  }

  // Eastern slopes / foothills (west of ~114.5) — grizzly bear range
  if (longitude < -114.5 && latitude > 50.5 && latitude < 54.5) {
    flags.push({
      species: 'Grizzly Bear',
      severity: 'caution',
      note: 'Eastern slopes are designated grizzly bear range. Food forest design should consider bear attractants (fruit trees, compost). Electric fencing recommended for livestock and high-value crops.',
    });
  }

  // Prairie zone (south of 51°) — sharp-tailed grouse, sage grouse, swift fox
  if (latitude < 51) {
    flags.push({
      species: 'Prairie species (Sharp-tailed Grouse, Swift Fox)',
      severity: 'info',
      note: 'Southern Alberta grassland — consult Alberta Environment for species-at-risk screening before large earthworks.',
    });
  }

  // Parkland (52-54°) — trumpeter swan staging
  if (latitude > 52 && latitude < 54.5) {
    flags.push({
      species: 'Trumpeter Swan',
      severity: 'info',
      note: 'Parkland zone includes trumpeter swan staging areas. Pond placement near wetlands should consider swan buffer guidelines.',
    });
  }

  // Mountain zone (west of -115, south) — bighorn sheep, mountain goat
  if (longitude < -115 && latitude < 52) {
    flags.push({
      species: 'Mountain ungulates (Bighorn Sheep, Mountain Goat)',
      severity: 'info',
      note: 'Mountain/front-range zone — sensitive ungulate ranges. Avoid construction during lambing season (May-June).',
    });
  }

  return {
    available: true,
    source: 'Alberta ecozone heuristic (replace with ABMI sensitivity layers when available)',
    flags,
    count: flags.length,
    disclaimer: 'This is a planning-level screening only. Consult Alberta Environment and Parks for site-specific species-at-risk assessment before earthworks.',
  };
}

// ---------- Helpers ----------

function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}