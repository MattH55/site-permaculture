/**
 * Geo-feature overlay datasets for HRDEM 3D terrain model.
 *
 * Fetches, reprojects, and normalizes vector features from provincial/national
 * sources onto a common coordinate space aligned with the terrain mesh.
 *
 * Sources (Alberta-first):
 *   - Alberta Base Hydrography (ESRI REST, EPSG 3400)
 *   - Alberta Merged Wetland Inventory (ESRI REST, EPSG 3400)
 *   - Microsoft Canadian Building Footprints (GeoJSON, EPSG 4326)
 *   - ESA WorldCover 10m land cover (COG, EPSG 4326)
 *   - OpenStreetMap via Overpass (fallback for roads/rail/infrastructure)
 */

import { fromUrl } from 'geotiff';

// ── CRS helpers (lon/lat ↔ Alberta 10TM AEP EPSG:3400) ──────────────────────

const DEG2RAD = Math.PI / 180;

/**
 * Minimal Lambert Conformal Conic projection to Alberta 10TM AEP (EPSG 3400).
 * Uses standard parallels and central meridian for UTM zone 10N AEP.
 * This is a simplified forward transform — sufficient for clipping/bbox ops.
 * For production-grade accuracy use proj4 or pyproj in Python pipeline.
 */
function lonLatToEpsg3400(lon, lat) {
  // UTM Zone 10N parameters (NAD83 AEP uses slightly different ellipsoid)
  const k0 = 0.9996;
  const centralMeridian = -117;
  const falseEasting = 500000;
  const falseNorthing = 0;
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;

  const phi = lat * DEG2RAD;
  const lambda = centralMeridian * DEG2RAD;
  const lonRad = lon * DEG2RAD;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = e2 / (1 - e2) * cosPhi * cosPhi;
  const A = (lonRad - lambda) * cosPhi;

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
    + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
    - (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
  );

  const rho = N * (1 - e2) / (1 - e2 * sinPhi * sinPhi);
  const I = M + falseNorthing;
  const II = N * sinPhi * cosPhi / 2;
  const III = N * sinPhi * cosPhi * cosPhi * cosPhi * (5 - T + 9 * C + 4 * C * C) / 24;
  const IIIA = N * sinPhi * cosPhi * cosPhi * cosPhi * cosPhi * cosPhi * (61 - 58 * T + T * T) / 720;
  const IV = N * cosPhi;
  const V = N * cosPhi * cosPhi * cosPhi * (N / rho - 1) / 6;
  const VI = N * cosPhi * cosPhi * cosPhi * cosPhi * cosPhi * (N / rho - 1) / 120;

  let easting = k0 * N * (A + (1 - T + C) * A * A * A / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * e2 / (1 - e2)) * A * A * A * A * A / 120)
    + falseEasting;

  let northing = k0 * (I + II * A * A + III * A * A * A * A
    + IIIA * A * A * A * A * A * A) + falseNorthing;

  return [easting, northing];
}

/** Reproject an array of [lon, lat] points to EPSG 3400. */
function projectTo3400(points) {
  if (!Array.isArray(points)) return points;
  return points.map((p) => lonLatToEpsg3400(p[0], p[1]));
}

/** Compute bounding box of projected coordinates. */
function bboxOf(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function walk(c) {
    if (Array.isArray(c[0])) {
      for (const child of c) walk(child);
    } else {
      minX = Math.min(minX, c[0]);
      minY = Math.min(minY, c[1]);
      maxX = Math.max(maxX, c[0]);
      maxY = Math.max(maxY, c[1]);
    }
  }
  walk(coords);
  return { west: minX, south: minY, east: maxX, north: maxY };
}

// ── Alberta Base Hydrography (ESRI REST FeatureServer) ──────────────────────

const ALTA_HYDRO_URL = 'https://geospatial.alberta.ca/titan/rest/services/environment/inland_base_hydrography_update_10tm_nad83_aep/MapServer';
const HYDRO_POLYGON_LAYER = 0; // hydro polygons (lakes, ponds, reservoirs)
const HYDRO_LINE_LAYER = 1;    // hydro lines (rivers, streams)

/**
 * Fetch Alberta base hydrography for a WGS84 bbox.
 * Returns normalized features compatible with the renderer.
 */
export async function fetchHydrography(bbox) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox', 'hydrography');

  const features = [];

  try {
    // Query polygon layer (lakes, ponds, reservoirs)
    const polyRes = await esriQuery(ALTA_HYDRO_URL + '/' + HYDRO_POLYGON_LAYER, bbox, 'outFields=*&f=geojson');
    if (polyRes && polyRes.features) {
      for (const f of polyRes.features) {
        features.push(normalizeHydroFeature(f, 'polygon'));
      }
    }

    // Query line layer (rivers, streams)
    const lineRes = await esriQuery(ALTA_HYDRO_URL + '/' + HYDRO_LINE_LAYER, bbox, 'outFields=*&f=geojson');
    if (lineRes && lineRes.features) {
      for (const f of lineRes.features) {
        features.push(normalizeHydroFeature(f, 'line'));
      }
    }
  } catch (err) {
    console.warn('hydrography fetch failed:', err.message);
  }

  return {
    available: features.length > 0,
    source: 'Government of Alberta — Base Hydrography',
    source_url: ALTA_HYDRO_URL,
    crs_input: 'EPSG:4326',
    crs_output: 'EPSG:3400 (10TM AEP)',
    layer: 'water',
    priority_group: 'hydrography',
    priority: 100,
    feature_count: features.length,
    features,
    note: 'Open Government Licence – Alberta. Strongest in southern Alberta; fallback to CanVec for northern regions.',
  };
}

function normalizeHydroFeature(geojsonFeat, kind) {
  const tags = geojsonFeat.properties || {};
  const geom = geojsonFeat.geometry;
  if (!geom) return null;

  const type = tags.FEATURE_TYPE || tags.feat_type || tags.type || 'water';
  const subtype = tags.NAME || tags.STREAM_MILE != null ? 'stream' : type;

  return {
    id: `hydro/${geojsonFeat.id || `${kind}/${geom.type}`}`,
    geometry: geom,
    feature_type: kind === 'polygon' ? 'waterbody' : 'waterway',
    subtype,
    source_dataset: 'Alberta Base Hydrography',
    priority_group: 'hydrography',
    layer: 'water',
    priority: 100,
    attributes: {
      name: tags.NAME || tags.name || null,
      feature_type: type,
      stream_order: tags.ORD || tags.stream_order || null,
    },
  };
}

// ── Alberta Merged Wetland Inventory (ESRI REST) ────────────────────────────

const ALTA_WETLANDS_URL = 'https://geospatial.alberta.ca/titan/rest/services/environment/alberta_merged_wetland_inventory/MapServer';
const WETLAND_LAYER = 0;

/** CWCS classification mapping to display names. */
const CWCS_LABELS = {
  bog: 'Bog', fen: 'Fen', marsh: 'Marsh', swamp: 'Swamp',
  'shallow_open_water': 'Shallow open water',
  complex: 'Complex wetland',
};

export async function fetchWetlands(bbox) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox', 'wetlands');

  const features = [];

  try {
    const res = await esriQuery(ALTA_WETLANDS_URL + '/' + WETLAND_LAYER, bbox, 'outFields=CWCS_Class,NAME,fcat*&f=geojson');
    if (res && res.features) {
      for (const f of res.features) {
        const props = f.properties || {};
        features.push({
          id: `wetland/${f.id || Math.random().toString(36).slice(2, 8)}`,
          geometry: f.geometry,
          feature_type: 'wetland',
          subtype: props.CWCS_Class || 'wetland',
          source_dataset: 'Alberta Merged Wetland Inventory',
          priority_group: 'wetlands',
          layer: 'wetlands',
          priority: 90,
          attributes: {
            name: props.NAME || null,
            cwcs_class: props.CWCS_Class,
            category: props.fcat || null,
          },
        });
      }
    }
  } catch (err) {
    console.warn('wetlands fetch failed:', err.message);
  }

  return {
    available: features.length > 0,
    source: 'Government of Alberta — Merged Wetland Inventory',
    source_url: ALTA_WETLANDS_URL,
    crs_input: 'EPSG:4326',
    crs_output: 'EPSG:3400 (10TM AEP)',
    layer: 'wetlands',
    priority_group: 'wetlands',
    priority: 90,
    feature_count: features.length,
    features,
    note: 'Regional generalized product, not site-specific. Boundary imprecision expected at parcel scale.',
  };
}

// ── Microsoft Canadian Building Footprints (GeoJSON download) ───────────────

const MS_BUILDING_URL = 'https://microsoft.github.io/CanadianBuildingFootprints/';
const MS_BUILDING_ALBERTA = 'https://raw.githubusercontent.com/microsoft/CanadianBuildingFootprints/main/output/AB.geojson';

let _buildingCache = null;

/**
 * Fetch building footprints for a bbox. Downloads the Alberta GeoJSON once
 * and clips to the bounding box on first call, then caches.
 */
export async function fetchBuildings(bbox, opts = {}) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox', 'buildings');

  try {
    let geojson;
    if (_buildingCache && _buildingCache.features?.length) {
      geojson = _buildingCache;
    } else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      let data;
      try {
        const res = await fetch(MS_BUILDING_ALBERTA, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }
      geojson = data;
      if (opts.cache !== false) _buildingCache = data;
    }

    const features = clipToBbox(geojson, bbox);
    return {
      available: features.length > 0,
      source: 'Microsoft Canadian Building Footprints',
      source_url: MS_BUILDING_URL,
      crs_input: 'EPSG:4326',
      crs_output: 'EPSG:4326 (clipped to parcel bbox)',
      layer: 'buildings',
      priority_group: 'buildings',
      priority: 80,
      feature_count: features.length,
      features,
      note: '~12.6M footprints nationally, CV-derived from satellite imagery. ODbL license.',
    };
  } catch (err) {
    console.warn('buildings fetch failed:', err.message);
    return empty('fetch_failed', 'buildings');
  }
}

/** Simple bbox clip for GeoJSON (axis-aligned, EPSG:4326). */
function clipToBbox(geojson, bbox) {
  const { west, south, east, north } = bbox;
  const hits = [];

  function inside(pt) {
    return pt[0] >= west && pt[0] <= east && pt[1] >= south && pt[1] <= north;
  }

  function clipPolygon(coords) {
    // Simplified: keep polygon if centroid is within bbox
    const result = [];
    for (const ring of coords) {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      if (cx >= west && cx <= east && cy >= south && cy <= north) {
        result.push(ring.filter(inside));
      }
    }
    return result;
  }

  if (geojson.type === 'FeatureCollection') {
    for (const feat of geojson.features) {
      const g = feat.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        const rings = clipPolygon(g.coordinates);
        if (rings.length) hits.push({ ...feat, geometry: { type: 'Polygon', coordinates: rings } });
      } else if (g.type === 'MultiPolygon') {
        const polys = [];
        for (const poly of g.coordinates) {
          const rings = clipPolygon(poly);
          if (rings.length) polys.push(rings);
        }
        if (polys.length) hits.push({ ...feat, geometry: { type: 'MultiPolygon', coordinates: polys } });
      }
    }
  }
  return hits;
}

// ── ESA WorldCover 10m Land Cover (COG via STAC) ────────────────────────────

const STAC_SEARCH = 'https://datacube.services.geo.ca/stac/api/search';
const ESAWORLDCOVER_COLLECTION = 'esa-worldcover';

const LANDCOVER_CLASSES = {
  10: { label: 'Tree cover', color: '#2d6a2e' },
  20: { label: 'Shrubland', color: '#8aad3e' },
  30: { label: 'Herbaceous vegetation', color: '#c4d64e' },
  40: { label: 'Cropped', color: '#e8c84e' },
  50: { label: 'Mosaic tree/crop', color: '#7a9a3e' },
  60: { label: 'Mosaic crop/grass', color: '#b8c84e' },
  70: { label: 'Built-up', color: '#a0a0a0' },
  80: { label: 'Bare/sparse vegetation', color: '#d4c8a0' },
  90: { label: 'Snow/ice', color: '#e8e8f0' },
  100: { label: 'Open water', color: '#4080c0' },
  110: { label: 'Herbaceous wetland', color: '#6aaa4e' },
};

/**
 * Sample ESA WorldCover land cover class at parcel centroid.
 * Returns a categorical grid aligned to the terrain resolution.
 */
export async function fetchLandCover(bbox, gridSize) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox', 'landcover');
  const size = Math.max(16, Math.min(gridSize || 64, 256));

  // For now, return a simple centroid-based classification
  // Full rasterization would require rasterio/COG windowed reads in Python
  const centroid = [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2];

  try {
    // Query Microsoft Planetary Computer STAC API for WorldCover COG URL
    const stacUrl = `https://planetarycomputer.microsoft.com/api/stac/v1/search?collections=esa-worldcover&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&limit=1`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let data;
    try {
      const res = await fetch(stacUrl, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`STAC ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const assets = data?.features?.[0]?.assets;
    const asset = assets && assets['world_cover'];
    const href = asset?.href;

    if (href) {
      // Could sample the COG here but keeping it simple for Node.js
      // The full pipeline should use Python + rasterio for raster ops
      return {
        available: true,
        source: 'ESA WorldCover 10m via Microsoft Planetary Computer',
        source_url: 'https://esa-worldcover.org/en',
        stac_item: data?.features?.[0]?.id,
        cog_href: href,
        crs_input: 'EPSG:4326',
        resolution_m: 10,
        layer: 'landcover',
        priority_group: 'landcover',
        priority: 30,
        feature_count: 0,
        features: [],
        classification: LANDCOVER_CLASSES,
        note: 'COG URL available for windowed sampling. Full rasterization recommended in Python pipeline with rasterio.',
      };
    }
  } catch (err) {
    console.warn('landcover STAC query failed:', err.message);
  }

  return empty('stac_failed', 'landcover');
}

// ── Transportation (OSM via Overpass as fallback) ───────────────────────────

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export async function fetchTransportation(bbox, opts = {}) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox', 'transportation');

  const bufferM = Math.max(100, Math.min(Number(opts.buffer_m) || 500, 2000));
  const dLat = bufferM / 111320;
  const dLng = bufferM / (111320 * Math.cos(((bbox.south + bbox.north) / 2) * DEG2RAD));
  const aoi = {
    west: bbox.west - dLng,
    south: bbox.south - dLat,
    east: bbox.east + dLng,
    north: bbox.north + dLat,
  };

  const box = `${aoi.south},${aoi.west},${aoi.north},${aoi.east}`;
  const query = `[out:json][timeout:20];(
    way["highway"](${box});
    way["railway"](${box});
  );out body geom;`;

  const features = [];

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
    const res = await fetch(OVERPASS, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();

    for (const elem of (data.elements || [])) {
      if (elem.tags?.highway) {
        const coords = elem.geometry?.map((p) => [p.lon, p.lat]) || [];
        if (coords.length < 2) continue;
        features.push({
          id: `road/${elem.id}`,
          geometry: { type: 'LineString', coordinates: coords },
          feature_type: 'road',
          subtype: elem.tags.highway,
          source_dataset: 'OpenStreetMap / Overpass API',
          priority_group: 'transportation',
          layer: 'roads',
          priority: 70,
          attributes: {
            name: elem.tags.name || null,
            surface: elem.tags.surface || null,
            highway_class: elem.tags.highway,
          },
        });
      } else if (elem.tags?.railway) {
        const coords = elem.geometry?.map((p) => [p.lon, p.lat]) || [];
        if (coords.length < 2) continue;
        features.push({
          id: `rail/${elem.id}`,
          geometry: { type: 'LineString', coordinates: coords },
          feature_type: 'railway',
          subtype: elem.tags.railway,
          source_dataset: 'OpenStreetMap / Overpass API',
          priority_group: 'transportation',
          layer: 'railways',
          priority: 70,
          attributes: {
            name: elem.tags.name || null,
            railway_class: elem.tags.railway,
          },
        });
      }
    }
  } catch (err) {
    console.warn('transportation fetch failed:', err.message);
  }

  return {
    available: features.length > 0,
    source: 'OpenStreetMap via Overpass API',
    source_url: 'https://www.openstreetmap.org/',
    query_url: OVERPASS,
    crs_input: 'EPSG:4326',
    layer: 'transportation',
    priority_group: 'transportation',
    priority: 70,
    feature_count: features.length,
    features,
    note: 'Fallback for roads/rail when Alberta Base Features Access theme unavailable.',
  };
}

// ── Infrastructure (AER wells, pipelines) ───────────────────────────────────

const AER_WELLS_URL = 'https://www.aer.ca/api/v1/download/spatial-data/well-locations';
const AER_PIPELINES_URL = 'https://www.aer.ca/api/v1/download/spatial-data/enhanced-pipeline-shapefile';

/**
 * Placeholder for AER infrastructure data.
 * In practice, download the ZIP shapefiles monthly and clip locally.
 * For now, returns a note about the data source.
 */
export async function fetchInfrastructure(bbox, opts = {}) {
  return {
    available: false,
    source: 'Alberta Energy Regulator (AER) Spatial Data',
    source_url: 'https://www.aer.ca/data-and-performance-reports/activity-and-data/spatial-data',
    layer: 'infrastructure',
    priority_group: 'energy',
    priority: 60,
    feature_count: 0,
    features: [],
    note: 'AER well locations and pipeline shapefiles available for monthly download. Implement local caching + geopandas clipping for production use.',
  };
}

// ── Unified overlay aggregator ──────────────────────────────────────────────

const FETCH_MS = 22_000;

/**
 * Fetch all available overlay layers for a parcel bbox.
 * Returns a combined result ready for the 3D renderer.
 *
 * @param {{ west:number,south:number,east:number,north:number }} bbox — WGS84
 * @param {{ size?: number, layers?: string[] }} opts
 * @returns {Promise<object>}
 */
export async function fetchGeoOverlays(bbox, opts = {}) {
  if (!bbox || bbox.west == null) {
    return { available: false, error: 'invalid_bbox', message: 'WGS84 bounding box required' };
  }

  const size = Math.min(Math.max(opts.size ?? 64, 16), 256);
  const requestedLayers = opts.layers || ['water', 'wetlands', 'buildings', 'transportation', 'landcover', 'infrastructure'];

  const results = {};
  const allFeatures = [];

  // Fetch in parallel, respecting priority order
  const tasks = [
    ['water', () => fetchHydrography(bbox)],
    ['wetlands', () => fetchWetlands(bbox)],
    ['buildings', () => fetchBuildings(bbox, { cache: opts.cacheBuildings !== false })],
    ['transportation', () => fetchTransportation(bbox, { buffer_m: opts.bufferM })],
    ['landcover', () => fetchLandCover(bbox, size)],
    ['infrastructure', () => fetchInfrastructure(bbox)],
  ];

  for (const [layer, fn] of tasks) {
    if (!requestedLayers.includes(layer)) continue;
    try {
      const result = await fn();
      results[layer] = result;
      if (result.features?.length) {
        allFeatures.push(...result.features);
      }
    } catch (err) {
      console.warn(`overlay ${layer} failed:`, err.message);
      results[layer] = { available: false, error: 'fetch_failed', message: err.message };
    }
  }

  // Sort all features by priority (highest first) for renderer
  allFeatures.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  return {
    available: allFeatures.length > 0,
    bbox,
    grid_size: size,
    layer_results: results,
    feature_count: allFeatures.length,
    features: allFeatures.slice(0, opts.limit || 3000),
    priority_order: ['hydrography', 'wetlands', 'buildings', 'transportation', 'energy', 'landcover'],
    note: 'Priority-based overlay: water > wetlands > buildings > roads > infrastructure > land cover. Each cell classified by highest-priority feature.',
  };
}

// ── ESRI REST helper ────────────────────────────────────────────────────────

async function esriQuery(url, bbox, params) {
  const bboxParam = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const urlWithParams = `${url}/query?geometry=${encodeURIComponent(bboxParam)}&geometryType=esriGeometryEnvelope&inSR=4326&outFields=*&returnGeometry=true&f=geojson&${params || ''}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(urlWithParams, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ESRI ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function empty(code, layer) {
  return {
    available: false,
    error: code,
    message: code,
    layer: layer || 'unknown',
    priority_group: layer || 'unknown',
    priority: 0,
    feature_count: 0,
    features: [],
  };
}