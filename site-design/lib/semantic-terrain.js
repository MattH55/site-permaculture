/**
 * Semantic terrain feature adapter.
 *
 * Source: OpenStreetMap via the public Overpass API. OSM is used only for
 * mapped vector features; no imagery classification or ML is performed.
 * The output is deliberately renderer-agnostic normalized feature objects.
 */

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DATASET_URL = 'https://www.openstreetmap.org/';
const FETCH_MS = 22_000;

const PRIORITY = {
  hydrography: 100,
  wetlands: 90,
  buildings: 80,
  transportation: 70,
  energy: 60,
  forest: 50,
  agriculture: 40,
  landcover: 30,
  administrative: 20,
};

const LAYER_LABELS = {
  hydrography: 'Water', wetlands: 'Wetlands', buildings: 'Buildings',
  transportation: 'Roads', energy: 'Infrastructure', forest: 'Forest',
  agriculture: 'Cropland', landcover: 'Bare ground',
};

/** Fetch and normalize mapped public features around an AOI. */
export async function fetchSemanticTerrain(bbox, opts = {}) {
  if (!bbox || bbox.west == null) return empty('invalid_bbox');
  const bufferM = Math.max(100, Math.min(Number(opts.buffer_m) || 750, 2500));
  const aoi = expandBbox(bbox, bufferM);
  const query = buildOverpassQuery(aoi);

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
    const features = (data.elements || [])
      .map(normalizeElement)
      .filter(Boolean)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, opts.limit || 1800);
    return {
      available: true,
      source: 'OpenStreetMap via Overpass API',
      source_url: DATASET_URL,
      query_url: OVERPASS,
      bbox,
      query_bbox: aoi,
      buffer_m: bufferM,
      priority_order: Object.entries(PRIORITY).sort((a, b) => b[1] - a[1]).map(([k]) => k),
      feature_count: features.length,
      features,
      layer_labels: LAYER_LABELS,
      note: 'Mapped public vector features only. Coverage varies by location; OSM tags and geometry are preserved for inspection.',
    };
  } catch (error) {
    return empty('query_failed', error.message, aoi, bufferM);
  }
}

function buildOverpassQuery(b) {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:20];(
    nwr["natural"~"water|wetland|wood|scrub|grassland|bare_rock|sand"](${box});
    nwr["landuse"~"forest|farmland|meadow|orchard|vineyard|grass|greenfield"](${box});
    way["building"](${box});
    way["highway"](${box});
    way["railway"](${box});
    way["waterway"](${box});
    nwr["man_made"~"pipeline|petroleum_well|well"](${box});
    nwr["natural"="bare_ground"](${box});
    nwr["man_made"="pipeline"](${box});
    nwr["power"~"line|minor_line|substation|plant"](${box});
    nwr["boundary"="protected_area"](${box});
  );out body geom;`;
}

function normalizeElement(element) {
  const tags = element.tags || {};
  const mapped = classify(tags, element.type === 'node' ? 'point' : 'line');
  if (!mapped) return null;
  const coordinates = element.geometry?.map((p) => [p.lon, p.lat]) ||
    (element.lat != null ? [[element.lon, element.lat]] : []);
  if (!coordinates.length) return null;
  const closed = coordinates.length >= 4 && samePoint(coordinates[0], coordinates.at(-1));
  const geometry = element.type === 'node'
    ? { type: 'Point', coordinates: coordinates[0] }
    : closed
      ? { type: 'Polygon', coordinates: [coordinates] }
      : { type: 'LineString', coordinates };
  return {
    id: `${element.type}/${element.id}`,
    geometry,
    feature_type: mapped.type,
    subtype: mapped.subtype,
    source_dataset: 'OpenStreetMap / Overpass API',
    priority_group: mapped.group,
    layer: mapped.layer,
    priority: PRIORITY[mapped.group],
    attributes: {
      name: tags.name || tags['name:en'] || null,
      tags,
      osm_type: element.type,
      osm_id: element.id,
    },
    metadata: { source_url: `${DATASET_URL}${element.type}/${element.id}` },
  };
}

function classify(tags, fallback) {
  const mapped = (group, type, subtype) => ({ group, layer: group, type, subtype });
  if (tags.waterway) return mapped('hydrography', 'water', tags.waterway);
  if (tags.natural === 'water' || tags.water) return mapped('hydrography', 'water', tags.water || 'waterbody');
  if (tags.natural === 'wetland' || tags.wetland) return mapped('wetlands', 'wetland', tags.wetland || 'wetland');
  if (tags.building) return mapped('buildings', 'building', tags.building);
  if (tags.highway) return mapped('transportation', tags.highway === 'path' || tags.highway === 'track' ? 'trail' : 'road', tags.highway);
  if (tags.railway) return mapped('transportation', 'railway', tags.railway);
  if (tags.man_made === 'pipeline') return mapped('energy', 'pipeline', 'pipeline');
  if (tags.man_made === 'petroleum_well' || tags.man_made === 'well') return mapped('energy', 'well', tags.man_made);
  if (tags.power) return mapped('energy', 'power', tags.power);
  if (tags.boundary === 'protected_area' || tags.leisure === 'nature_reserve') return mapped('administrative', 'protected_area', tags.protection_title || 'protected area');
  if (tags.natural === 'wood' || tags.landuse === 'forest') return mapped('forest', 'forest', tags.leaf_type || 'forest');
  if (tags.natural === 'scrub') return mapped('forest', 'shrubland', 'scrub');
  if (tags.landuse === 'farmland' || tags.landuse === 'orchard' || tags.landuse === 'vineyard') return mapped('agriculture', 'cropland', tags.landuse);
  if (tags.natural === 'grassland' || tags.landuse === 'meadow' || tags.landuse === 'grass') return mapped('agriculture', 'grassland', tags.landuse || 'grassland');
  if (tags.natural === 'bare_ground' || tags.natural === 'bare_rock' || tags.natural === 'sand') return mapped('landcover', 'bare_ground', tags.natural);
  return fallback === 'point' ? null : null;
}

function expandBbox(b, bufferM) {
  const dLat = bufferM / 111320;
  const dLng = bufferM / (111320 * Math.cos(((b.south + b.north) / 2) * Math.PI / 180));
  return { west: b.west - dLng, south: b.south - dLat, east: b.east + dLng, north: b.north + dLat };
}

function samePoint(a, b) { return Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8; }
function empty(error, message, bbox = null, buffer_m = null) { return { available: false, error, message: message || error, source: 'OpenStreetMap via Overpass API', source_url: DATASET_URL, bbox, query_bbox: bbox, buffer_m, features: [] }; }