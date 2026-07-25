/**
 * Alberta Flood Hazard Identification Program (FHIP) — 2024 FeatureServer.
 *
 * Study-area based: many rural parcels return no_data (not "no risk").
 * https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/AlbertaFloodMapping_gdb/FeatureServer
 */

const FLOOD_HAZARD =
  'https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/AlbertaFloodMapping_gdb/FeatureServer/0';

/**
 * Point-in-polygon flood hazard class at site centroid.
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ west: number, south: number, east: number, north: number }} [bbox]
 */
export async function queryFloodHazard(centre, bbox) {
  const lat = centre.latitude;
  const lng = centre.longitude;

  try {
    // Prefer envelope of parcel if available (any intersect with flood poly)
    let geometry;
    let geometryType;
    if (bbox) {
      geometry = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
      geometryType = 'esriGeometryEnvelope';
    } else {
      geometry = `${lng},${lat}`;
      geometryType = 'esriGeometryPoint';
    }

    const params = new URLSearchParams({
      geometry,
      geometryType,
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'One_Zone,Two_Zone,Multi_Zone,FloodMechanism,RiverName,Flow_Regime,StudyName',
      returnGeometry: 'false',
      resultRecordCount: '10',
      f: 'json',
    });

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    let data;
    try {
      const res = await fetch(`${FLOOD_HAZARD}/query?${params}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(t);
    }

    if (data.error) throw new Error(data.error.message || 'Flood query error');

    const features = data.features || [];
    if (!features.length) {
      return {
        available: true,
        in_mapped_study_area: false,
        flood_hazard_class: 'no_data',
        flood_risk_zone: false,
        hits: [],
        note:
          'No FHIP flood polygon intersects this parcel. That means "no published study coverage here," not a certified clean bill of health — many rural Alberta watercourses are unmapped.',
        source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
        source_url:
          'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
        feature_server: FLOOD_HAZARD,
      };
    }

    const hits = features.map((f) => {
      const a = f.attributes || {};
      return {
        one_zone: a.One_Zone || null,
        two_zone: a.Two_Zone || null,
        multi_zone: a.Multi_Zone || null,
        flood_mechanism: a.FloodMechanism || null,
        river_name: a.RiverName || null,
        flow_regime: a.Flow_Regime || null,
        study_name: a.StudyName || null,
        class: normalizeClass(a.Two_Zone || a.Multi_Zone || a.One_Zone),
      };
    });

    // Highest severity wins
    const rank = { floodway: 4, high_hazard_fringe: 3, flood_fringe: 2, protected_fringe: 1, other: 0 };
    hits.sort((a, b) => (rank[b.class] || 0) - (rank[a.class] || 0));
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
      note: flood_risk_zone
        ? `Parcel intersects mapped ${labelClass(flood_hazard_class)}${
            top.river_name ? ` (${top.river_name})` : ''
          }. Affects pond/dam siting and low-lying plantings — verify before earthworks.`
        : `Mapped study area present (${top.study_name || 'FHIP'}) with class ${labelClass(
            flood_hazard_class
          )}.`,
      source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
      source_url:
        'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
      feature_server: FLOOD_HAZARD,
      awareness_map: 'https://floods.alberta.ca',
    };
  } catch (e) {
    return {
      available: false,
      in_mapped_study_area: null,
      flood_hazard_class: 'unknown',
      flood_risk_zone: false,
      error: e.message,
      source_name: 'Alberta Flood Hazard Identification Program Mapping (2024)',
      source_url:
        'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28',
    };
  }
}

function normalizeClass(raw) {
  if (!raw) return 'other';
  const s = String(raw).toLowerCase();
  if (s.includes('floodway') || s.includes('flood way')) return 'floodway';
  if (s.includes('high') && s.includes('fringe')) return 'high_hazard_fringe';
  if (s.includes('protected') && s.includes('fringe')) return 'protected_fringe';
  if (s.includes('fringe')) return 'flood_fringe';
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
