/**
 * Alberta Flood Hazard Identification Program (FHIP) — 2024 FeatureServer.
 *
 * Study-area based: many rural parcels return no_data (not "no risk").
 * https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/AlbertaFloodMapping_gdb/FeatureServer
 *
 * Important service quirks (verified 2026):
 * - Point geometry queries return 0 features even inside known floodways.
 * - Envelope queries work; use JSON envelopes with a minimum size so tiny
 *   drawn parcels still intersect nearby hazard polys reliably.
 */

const FLOOD_HAZARD =
  'https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/AlbertaFloodMapping_gdb/FeatureServer/0';

/** Minimum half-width of query envelope (~metres) so tiny parcels still hit. */
const MIN_HALF_WIDTH_M = 75;
/** Search radius when parcel itself has no FHIP hit — nearest study context. */
const NEARBY_SEARCH_M = 5000;

/**
 * Point-in-polygon / parcel flood hazard class.
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ west: number, south: number, east: number, north: number }} [bbox]
 */
export async function queryFloodHazard(centre, bbox) {
  const lat = centre.latitude;
  const lng = centre.longitude;

  try {
    const parcelEnv = ensureMinEnvelope(
      bbox && Number.isFinite(bbox.west)
        ? bbox
        : pointEnvelope(lat, lng, MIN_HALF_WIDTH_M),
      lat,
      MIN_HALF_WIDTH_M
    );

    const features = await queryEnvelope(parcelEnv);
    if (features.length) {
      return buildHitResult(features, {
        query_envelope: parcelEnv,
        match: 'parcel_intersects',
      });
    }

    // No polygon on the parcel — look for nearest mapped study for context
    const nearbyEnv = pointEnvelope(lat, lng, NEARBY_SEARCH_M);
    const nearby = await queryEnvelope(nearbyEnv, 25);
    if (nearby.length) {
      const hits = mapHits(nearby);
      const nearest = hits[0];
      return {
        available: true,
        in_mapped_study_area: false,
        flood_hazard_class: 'no_data',
        flood_risk_zone: false,
        hits: [],
        nearby_studies: hits.slice(0, 5),
        nearest_study: nearest,
        headline: 'No FHIP mapping on this parcel',
        note: nearest
          ? `No Flood Hazard Identification Program polygon intersects this boundary. Nearest published mapping: ${labelClass(
              nearest.class
            )}${nearest.river_name ? ` on the ${nearest.river_name}` : ''}${
              nearest.study_name ? ` (${nearest.study_name})` : ''
            } within ~${Math.round(NEARBY_SEARCH_M / 1000)} km — still not a clean bill of health for unmapped watercourses.`
          : 'No FHIP flood polygon intersects this boundary. Many rural Alberta watercourses remain unmapped.',
        caveat:
          'Absence of FHIP data on the parcel is not zero flood risk. Confirm with local knowledge and floods.alberta.ca before earthworks or low siting.',
        source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
        source_url:
          'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
        feature_server: FLOOD_HAZARD,
        awareness_map: 'https://floods.alberta.ca',
        query_envelope: parcelEnv,
        match: 'nearby_only',
      };
    }

    return {
      available: true,
      in_mapped_study_area: false,
      flood_hazard_class: 'no_data',
      flood_risk_zone: false,
      hits: [],
      nearby_studies: [],
      headline: 'No published FHIP mapping on or near this parcel',
      note:
        'No Flood Hazard Identification Program polygon intersects this boundary, and none were found within ~5 km. That means no published study coverage here — not that the site is free of flood risk. FHIP mapping covers selected river corridors; most rural watercourses are unmapped.',
      caveat:
        'No map ≠ no risk. Check local knowledge, watercourse proximity, and the provincial flood awareness map before earthworks or low siting.',
      source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
      source_url:
        'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
      feature_server: FLOOD_HAZARD,
      awareness_map: 'https://floods.alberta.ca',
      query_envelope: parcelEnv,
      match: 'none_in_region',
    };
  } catch (e) {
    return {
      available: false,
      in_mapped_study_area: null,
      flood_hazard_class: 'unknown',
      flood_risk_zone: false,
      error: e.message,
      headline: 'Flood lookup unavailable',
      note: `Could not reach Alberta FHIP mapping (${e.message}). Treat flood status as unknown until verified.`,
      caveat:
        'Service error does not mean low risk. Confirm at floods.alberta.ca and with municipal planning before earthworks.',
      source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
      source_url:
        'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
      awareness_map: 'https://floods.alberta.ca',
    };
  }
}

// ── ArcGIS query ─────────────────────────────────────────

async function queryEnvelope(env, limit = 15) {
  const geometry = JSON.stringify({
    xmin: env.west,
    ymin: env.south,
    xmax: env.east,
    ymax: env.north,
    spatialReference: { wkid: 4326 },
  });

  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields:
      'One_Zone,Two_Zone,Multi_Zone,FloodMechanism,RiverName,Flow_Regime,StudyName',
    returnGeometry: 'false',
    resultRecordCount: String(limit),
    f: 'json',
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${FLOOD_HAZARD}/query?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Flood query error');
    return data.features || [];
  } finally {
    clearTimeout(t);
  }
}

function buildHitResult(features, meta = {}) {
  const hits = mapHits(features);
  const top = hits[0];
  const flood_hazard_class = top.class;
  const flood_risk_zone = ['floodway', 'high_hazard_fringe', 'flood_fringe'].includes(
    flood_hazard_class
  );

  return {
    available: true,
    in_mapped_study_area: true,
    flood_hazard_class,
    flood_risk_zone,
    primary: top,
    hits,
    headline: labelClassTitle(flood_hazard_class),
    note: flood_risk_zone
      ? `Parcel intersects mapped ${labelClass(flood_hazard_class)}${
          top.river_name ? ` (${top.river_name})` : ''
        }${top.study_name ? ` — ${top.study_name}` : ''}. Affects pond/dam siting and low-lying plantings — verify before earthworks.`
      : `Mapped study area present (${top.study_name || 'FHIP'}) with class ${labelClass(
          flood_hazard_class
        )}.`,
    source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
    source_url:
      'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
    feature_server: FLOOD_HAZARD,
    awareness_map: 'https://floods.alberta.ca',
    ...meta,
  };
}

function mapHits(features) {
  const hits = features.map((f) => {
    const a = f.attributes || {};
    // ArcGIS Online sometimes returns different key casing
    const get = (...keys) => {
      for (const k of keys) {
        if (a[k] != null && a[k] !== '') return a[k];
      }
      // case-insensitive fallback
      const lower = Object.fromEntries(
        Object.entries(a).map(([k, v]) => [k.toLowerCase(), v])
      );
      for (const k of keys) {
        const v = lower[k.toLowerCase()];
        if (v != null && v !== '') return v;
      }
      return null;
    };
    return {
      one_zone: get('One_Zone'),
      two_zone: get('Two_Zone'),
      multi_zone: get('Multi_Zone'),
      flood_mechanism: get('FloodMechanism'),
      river_name: get('RiverName'),
      flow_regime: get('Flow_Regime'),
      study_name: get('StudyName'),
      class: normalizeClass(
        get('Two_Zone') || get('Multi_Zone') || get('One_Zone')
      ),
    };
  });

  const rank = {
    floodway: 4,
    high_hazard_fringe: 3,
    flood_fringe: 2,
    protected_fringe: 1,
    other: 0,
  };
  hits.sort((a, b) => (rank[b.class] || 0) - (rank[a.class] || 0));
  return hits;
}

// ── geometry helpers ─────────────────────────────────────

function pointEnvelope(lat, lng, halfWidthM) {
  const dLat = halfWidthM / 111_320;
  const dLng = halfWidthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lng - dLng,
    south: lat - dLat,
    east: lng + dLng,
    north: lat + dLat,
  };
}

/** Expand envelope so each side is at least ~minHalfWidthM from centre. */
function ensureMinEnvelope(bbox, lat, minHalfWidthM) {
  const midLat = (bbox.south + bbox.north) / 2 || lat;
  const midLng = (bbox.west + bbox.east) / 2;
  const dLat = minHalfWidthM / 111_320;
  const dLng = minHalfWidthM / (111_320 * Math.cos((midLat * Math.PI) / 180));
  return {
    west: Math.min(bbox.west, midLng - dLng),
    south: Math.min(bbox.south, midLat - dLat),
    east: Math.max(bbox.east, midLng + dLng),
    north: Math.max(bbox.north, midLat + dLat),
  };
}

function normalizeClass(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase();
  if (s.includes('floodway') || s.includes('flood way')) return 'floodway';
  if (s.includes('high') && s.includes('fringe')) return 'high_hazard_fringe';
  if (s.includes('protected') && s.includes('fringe')) return 'protected_fringe';
  if (s.includes('fringe') || s.includes('overland')) return 'flood_fringe';
  if (s.includes('1:100') || s.includes('1:200') || s.includes('flood hazard'))
    return 'flood_fringe';
  if (s.includes('hazard')) return 'flood_fringe';
  return 'other';
}

function labelClass(c) {
  return (
    {
      floodway: 'floodway',
      high_hazard_fringe: 'high-hazard flood fringe',
      flood_fringe: 'flood fringe',
      protected_fringe: 'protected flood fringe (behind berm)',
      other: 'flood hazard area',
      no_data: 'no mapped data',
      unknown: 'unknown',
    }[c] || c
  );
}

function labelClassTitle(c) {
  return (
    {
      floodway: 'Floodway',
      high_hazard_fringe: 'High-hazard flood fringe',
      flood_fringe: 'Flood fringe',
      protected_fringe: 'Protected flood fringe',
      other: 'Flood hazard area',
    }[c] || labelClass(c)
  );
}
