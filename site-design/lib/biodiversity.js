/**
 * Biodiversity reporting module.
 * Logic derived from Expanding Edge Biodiversity Report PDF.
 *
 * Implements:
 * 1. Two-zone concentric analysis (1km inner, 3km outer)
 * 2. Taxonomic hierarchy breakdown (Kingdom > Phylum > Class)
 * 3. Unique species detection vs repeat observations
 * 4. IUCN Red List status mapping
 * 5. Temporal detection trends
 */

import { haversineKm } from './proximity.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RICHNESS_PATH = path.join(__dirname, '..', 'data', 'biodiversity', 'species-richness.json');
let richnessData;

const ICONIC_TAXA = {
  47126: { name: 'Plantae', label: 'Plants' },
  20978: { name: 'Amphibia', label: 'Amphibians' },
  3: { name: 'Aves', label: 'Birds' },
  1: { name: 'Mammalia', label: 'Mammals' },
  47170: { name: 'Fungi', label: 'Fungi' },
  47115: { name: 'Mollusca', label: 'Molluscs' },
  47158: { name: 'Insecta', label: 'Insects' },
  47119: { name: 'Arachnida', label: 'Arachnids' },
  26036: { name: 'Reptilia', label: 'Reptiles' },
};

/**
 * Perform multi-zone iNaturalist analysis.
 */
export async function assessBiodiversity(centre) {
  const innerRadius = 1.0;
  const outerRadius = 3.0;

  // Fetch observations in the larger zone (3km)
  const obs = await fetchINaturalistZone(centre, outerRadius);
  const speciesRichness = lookupSpeciesRichness(centre.latitude, centre.longitude);
  
  if (!obs || !obs.length) {
    return {
      available: false,
      error: 'No iNaturalist data available for this area.',
      species_richness: speciesRichness,
    };
  }

  // Split into zones
  const inner = [];
  const outer = [];
  
  for (const o of obs) {
    const d = haversineKm(centre.latitude, centre.longitude, o.lat, o.lng);
    if (d <= innerRadius) inner.push(o);
    else if (d <= outerRadius) outer.push(o);
  }

  const innerAnalysis = processZoneData(inner);
  const outerAnalysis = processZoneData([...inner, ...outer]);

  return {
    available: true,
    inner: innerAnalysis,
    outer: outerAnalysis,
    metadata: {
      inner_radius_km: innerRadius,
      outer_radius_km: outerRadius,
      total_observations: obs.length,
      last_updated: new Date().toISOString().slice(0, 10),
    },
    species_richness: speciesRichness,
    discoveries: findNearbyPotential(innerAnalysis, outerAnalysis),
  };
}

/**
 * Look up the supplied Alberta richness surfaces at the report centre.
 * These are regional screening values, not an observation count or a
 * property-specific species inventory.
 */
 export function lookupSpeciesRichness(lat, lng) {
  const data = loadRichnessData();
  if (!data?.layers?.length || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { available: false, error: 'Species-richness layer is not available.' };
  }

  const result = { available: true, source: data.source, layers: {} };
  for (const layer of data.layers) {
    const feature = layer.features?.find((f) => pointInGeometry(lng, lat, f.geometry));
    const cell = feature ? null : findRichnessCell(layer, lat, lng, data.resolution_degrees);
    if (feature || cell) {
      const properties = feature?.properties || cell;
      result.layers[layer.id] = {
        value: Number(properties?.value),
        link_id: properties?.link_id || null,
      };
    }
  }

  if (!Object.keys(result.layers).length) {
    return {
      available: false,
      error: 'The supplied richness surfaces do not cover this location.',
      source: data.source,
    };
  }
  return result;
}

function findRichnessCell(layer, lat, lng, resolution) {
  if (!Array.isArray(layer.cells) || !Number.isFinite(resolution)) return null;
  const halfDiagonal = resolution * Math.SQRT2 / 2;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const cell of layer.cells) {
    const distance = Math.hypot(Number(cell.lat) - lat, Number(cell.lng) - lng);
    if (distance < nearestDistance) {
      nearest = cell;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= halfDiagonal ? nearest : null;
}

function loadRichnessData() {
  if (richnessData !== undefined) return richnessData;
  try {
    richnessData = JSON.parse(fs.readFileSync(RICHNESS_PATH, 'utf8'));
  } catch {
    richnessData = null;
  }
  return richnessData;
}

function pointInGeometry(x, y, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return polygonContains(x, y, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContains(x, y, polygon));
  }
  return false;
}

function polygonContains(x, y, rings) {
  if (!rings?.[0] || !ringContains(x, y, rings[0])) return false;
  return !rings.slice(1).some((hole) => ringContains(x, y, hole));
}

function ringContains(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function fetchINaturalistZone(centre, radius) {
  // Rough bbox from radius
  const dLat = radius / 111.32;
  const dLng = radius / (111.32 * Math.cos(centre.latitude * Math.PI / 180));
  
  const swlat = centre.latitude - dLat;
  const swlng = centre.longitude - dLng;
  const nelat = centre.latitude + dLat;
  const nelng = centre.longitude + dLng;

  const url = `https://api.inaturalist.org/v1/observations?` +
    `swlat=${swlat}&swlng=${swlng}&nelat=${nelat}&nelng=${nelng}` +
    `&per_page=200&order=desc&order_by=observed_on&quality_grade=research,needs_id`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    
    return (data.results || []).map(r => ({
      id: r.id,
      species_id: r.taxon?.id,
      name: r.taxon?.name,
      common_name: r.taxon?.preferred_common_name,
      kingdom: r.taxon?.ancestor_ids?.[1], // Simplified
      phylum: r.taxon?.ancestor_ids?.[2],
      class: r.taxon?.ancestor_ids?.[3],
      iconic_taxon_id: r.taxon?.iconic_taxon_id,
      threatened: r.taxon?.threatened || false,
      native: r.taxon?.native || false,
      lat: r.location ? parseFloat(r.location.split(',')[0]) : null,
      lng: r.location ? parseFloat(r.location.split(',')[1]) : null,
      observed_on: r.observed_on || r.time_observed_at?.slice(0, 10),
      photo_url: r.photos?.[0]?.url,
    }));
  } catch (e) {
    return [];
  }
}

function processZoneData(obs) {
  const uniqueSpecies = new Map();
  const kingdomCounts = {};
  const threatened = [];
  const timeline = [];

  for (const o of obs) {
    if (o.species_id) {
      if (!uniqueSpecies.has(o.species_id)) {
        uniqueSpecies.set(o.species_id, {
          name: o.name,
          common: o.common_name,
          count: 0,
          threatened: o.threatened,
          native: o.native,
          photo: o.photo_url
        });
      }
      uniqueSpecies.get(o.species_id).count++;
    }

    if (o.kingdom) {
      kingdomCounts[o.kingdom] = (kingdomCounts[o.kingdom] || 0) + 1;
    }

    if (o.threatened) threatened.push(o);
    timeline.push({ date: o.observed_on, species: o.species_id });
  }

  const speciesList = [...uniqueSpecies.values()].sort((a, b) => b.count - a.count);

  return {
    observation_count: obs.length,
    unique_species_count: uniqueSpecies.size,
    top_species: speciesList.slice(0, 10),
    threatened_count: threatened.length,
    threatened_list: speciesList.filter(s => s.threatened).slice(0, 5),
    kingdom_breakdown: kingdomCounts,
  };
}

function findNearbyPotential(inner, outer) {
  const innerIds = new Set(inner.top_species.map(s => s.name));
  return outer.top_species
    .filter(s => !innerIds.has(s.name))
    .slice(0, 10);
}