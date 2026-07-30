/**
 * Wetlands layer for fecundity + site design.
 *
 * Primary: Alberta Merged Wetland Inventory (AMWI) vector polygons (high confidence).
 * Optional: satellite wetness indices (medium) for gap-fill — never regulatory delineation.
 *
 * See: "Yes. Wetlands fit cleanly into the.txt" addendum.
 */

import { esriEnvelope } from './geo.js';

const AB =
  process.env.ALBERTA_ARCGIS_BASE ||
  'https://geospatial.alberta.ca/titan/rest/services';

const AMWI_URL = `${AB}/environment/alberta_merged_wetland_inventory/MapServer/3/query`;

/**
 * Fetch wetlands for an AOI (bbox or polygon ring).
 *
 * @param {{ west:number,south:number,east:number,north:number } | number[][]} aoi
 * @param {{ buffer_m?: number, centre?: {latitude:number,longitude:number} }} [opts]
 */
export async function fetchWetlands(aoi, opts = {}) {
  const bufferM = opts.buffer_m ?? 200;
  const bbox = expandBbox(normalizeBbox(aoi), bufferM);
  const centre =
    opts.centre ||
    (bbox
      ? {
          latitude: (bbox.south + bbox.north) / 2,
          longitude: (bbox.west + bbox.east) / 2,
        }
      : null);

  try {
    const coreBbox = normalizeBbox(aoi);
    // On-site = intersects unbuffered parcel; nearby uses buffer
    const [coreData, bufData] = await Promise.all([
      coreBbox ? queryAmwiPolygons(coreBbox, 40) : Promise.resolve({ features: [] }),
      queryAmwiPolygons(bbox, 50),
    ]);
    const coreFeatures = coreData.features || [];
    const features = bufData.features || [];
    const types = new Map();
    let areaHa = 0;
    const geoFeatures = [];
    let nearestM = null;

    // Area / types from on-parcel hits first, else buffered set
    const areaSource = coreFeatures.length ? coreFeatures : features;
    for (const f of areaSource) {
      const attrs = f.attributes || {};
      const cwcs =
        attrs.CWCS_Class ||
        attrs.CLASS ||
        attrs.WETLAND_TYPE ||
        attrs.TYPE ||
        'unknown';
      const typeKey = normalizeTypeLabel(cwcs);
      types.set(typeKey, (types.get(typeKey) || 0) + 1);

      const geom = ringsFromEsri(f.geometry);
      if (geom) {
        const ha = polygonAreaHa(geom);
        // Clip contribution: for on-site query, full feature area is OK for screening
        if (Number.isFinite(ha) && coreFeatures.length) areaHa += ha;
        geoFeatures.push({
          type: 'Feature',
          properties: {
            type: typeKey,
            cwcs_class: cwcs,
            area_ha: ha != null ? Math.round(ha * 100) / 100 : null,
            on_parcel: coreFeatures.includes(f),
          },
          geometry: { type: 'Polygon', coordinates: geom },
        });
      }
    }

    // Map all buffered polygons for context; nearest distance from parcel centre
    for (const f of features) {
      const geom = ringsFromEsri(f.geometry);
      if (!geom) continue;
      if (!geoFeatures.some((g) => g.geometry.coordinates === geom)) {
        const attrs = f.attributes || {};
        const cwcs = attrs.CWCS_Class || attrs.CLASS || 'unknown';
        const ha = polygonAreaHa(geom);
        geoFeatures.push({
          type: 'Feature',
          properties: {
            type: normalizeTypeLabel(cwcs),
            cwcs_class: cwcs,
            area_ha: ha != null ? Math.round(ha * 100) / 100 : null,
            on_parcel: false,
          },
          geometry: { type: 'Polygon', coordinates: geom },
        });
      }
      if (centre) {
        const d = distancePointToPolygonM(centre.latitude, centre.longitude, geom);
        if (nearestM == null || d < nearestM) nearestM = d;
      }
    }

    const has_wetland_on_site = coreFeatures.length > 0;
    if (has_wetland_on_site && (nearestM == null || nearestM > 0)) {
      // Parcel intersects inventory even if centroid is outside the poly
      nearestM = 0;
    }

    return {
      has_wetland_on_site,
      wetland_area_ha: Math.round(areaHa * 100) / 100,
      wetland_types: [...types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k),
      wetland_type_counts: Object.fromEntries(types),
      nearest_wetland_distance_m:
        nearestM != null ? Math.round(nearestM) : has_wetland_on_site ? 0 : null,
      wetland_polygons: {
        type: 'FeatureCollection',
        features: geoFeatures.slice(0, 40),
      },
      feature_count: coreFeatures.length || features.length,
      source: 'Alberta Merged Wetland Inventory (AMWI)',
      source_url: `${AB}/environment/alberta_merged_wetland_inventory/MapServer`,
      confidence: 'high',
      resolution_note: 'polygon inventory (CWCS class)',
      claims: [
        {
          field: 'wetland_presence',
          value: has_wetland_on_site,
          source: 'AMWI',
          confidence: 'high',
          allowed_claim:
            'Inventory polygons support screening for presence/type — not a formal Alberta Wetland Policy delineation or Water Act approval.',
        },
      ],
      disclaimer:
        'AMWI polygons improve water, microclimate, and fauna inferences for screening only. They are not a regulatory wetland delineation; field assessment is required before earthworks or Water Act decisions.',
      derived_indices: null,
      query_bbox: bbox,
      available: true,
    };
  } catch (e) {
    console.warn('Wetlands fetch failed:', e.message);
    return {
      has_wetland_on_site: false,
      wetland_area_ha: null,
      wetland_types: [],
      nearest_wetland_distance_m: null,
      wetland_polygons: { type: 'FeatureCollection', features: [] },
      feature_count: 0,
      source: 'Alberta Merged Wetland Inventory (AMWI)',
      confidence: 'none',
      available: false,
      error: e.message,
      disclaimer:
        'Wetland inventory lookup failed. Do not assume absence of wetlands — confirm on site and via GeoDiscover Alberta before earthworks.',
      claims: [
        {
          field: 'wetland_presence',
          value: null,
          source: 'none',
          confidence: 'none',
          allowed_claim: 'No wetland presence claim without inventory or field assessment.',
        },
      ],
    };
  }
}

/**
 * Patch for generateFecundityReport / assessFecundity.
 */
export function toFecundityWetlandPatch(wetlands) {
  if (!wetlands?.available && !wetlands?.has_wetland_on_site) {
    return {
      wetlands,
      wetlandsPresent: wetlands?.has_wetland_on_site ?? null,
      wetlandHabitatPresent: null,
      wetlandProximityBoost: null,
    };
  }
  const onSite = !!wetlands.has_wetland_on_site;
  const near =
    wetlands.nearest_wetland_distance_m != null &&
    wetlands.nearest_wetland_distance_m < 250;

  return {
    wetlands,
    wetlandsPresent: onSite,
    // Prefer inventory over land-cover for pond/wetland presence
    hasPondOrWetlandInventory: onSite,
    wetlandHabitatPresent: onSite || near,
    wetlandProximityBoost:
      onSite ? 1 : near ? Math.max(0, 1 - wetlands.nearest_wetland_distance_m / 250) : 0,
    wetlandTypes: wetlands.wetland_types || [],
    wetlandAreaHa: wetlands.wetland_area_ha,
  };
}

// ── ArcGIS ───────────────────────────────────────────────

async function queryAmwiPolygons(bbox, limit = 40) {
  const body = new URLSearchParams({
    geometry: esriEnvelope(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultRecordCount: String(limit),
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(AMWI_URL, {
      method: 'POST',
      body,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`AMWI ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'AMWI query error');
    return data;
  } finally {
    clearTimeout(t);
  }
}

// ── Geometry helpers ─────────────────────────────────────

function normalizeBbox(aoi) {
  if (!aoi) return null;
  if (aoi.west != null) return { ...aoi };
  if (Array.isArray(aoi) && Array.isArray(aoi[0])) {
    // ring [[lng,lat],...]
    const lngs = aoi.map((p) => p[0]);
    const lats = aoi.map((p) => p[1]);
    return {
      west: Math.min(...lngs),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      north: Math.max(...lats),
    };
  }
  if (aoi.type === 'Polygon') {
    return normalizeBbox(aoi.coordinates[0]);
  }
  return null;
}

function expandBbox(bbox, bufferM) {
  if (!bbox || !bufferM) return bbox;
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = bufferM / 111_320;
  const dLng = bufferM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    west: bbox.west - dLng,
    south: bbox.south - dLat,
    east: bbox.east + dLng,
    north: bbox.north + dLat,
  };
}

function ringsFromEsri(geometry) {
  if (!geometry) return null;
  // ArcGIS polygon: rings = [[[x,y],...]]
  if (geometry.rings?.length) {
    return geometry.rings.map((ring) =>
      ring.map(([x, y]) => [x, y])
    );
  }
  if (geometry.type === 'Polygon' && geometry.coordinates) {
    return geometry.coordinates;
  }
  return null;
}

/** Shoelace with equirectangular scale (ha). */
function polygonAreaHa(rings) {
  if (!rings?.length) return 0;
  let totalM2 = 0;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    const midLat =
      (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
    const mx = 111320 * Math.cos(midLat);
    const my = 111320;
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = ring[i][0] * mx;
      const y1 = ring[i][1] * my;
      const x2 = ring[i + 1][0] * mx;
      const y2 = ring[i + 1][1] * my;
      a += x1 * y2 - x2 * y1;
    }
    totalM2 += Math.abs(a) / 2;
  }
  return totalM2 / 10_000;
}

function distancePointToPolygonM(lat, lng, rings) {
  // 0 if inside any ring; else min distance to edges
  for (const ring of rings) {
    if (pointInRing(lng, lat, ring)) return 0;
  }
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const d = distToSegmentM(
        lat,
        lng,
        ring[i][1],
        ring[i][0],
        ring[i + 1][1],
        ring[i + 1][0]
      );
      if (d < best) best = d;
    }
  }
  return best;
}

function pointInRing(x, y, ring) {
  // ray casting; ring as [lng,lat]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegmentM(plat, plng, lat1, lng1, lat2, lng2) {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const mx = 111320 * Math.cos(midLat);
  const my = 111320;
  const px = plng * mx;
  const py = plat * my;
  const ax = lng1 * mx;
  const ay = lat1 * my;
  const bx = lng2 * mx;
  const by = lat2 * my;
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeTypeLabel(cwcs) {
  const n = String(cwcs || 'unknown').toLowerCase();
  if (n.includes('marsh')) return 'marsh';
  if (n.includes('swamp')) return 'swamp';
  if (n.includes('fen')) return 'fen';
  if (n.includes('bog')) return 'bog';
  if (n.includes('shallow') || n.includes('open water')) return 'shallow_open_water';
  if (n.includes('water')) return 'open_water';
  return n.replace(/\s+/g, '_').slice(0, 40) || 'unknown';
}
