/**
 * Minerals & geology layer.
 *
 * Sources:
 *   - AER Mineral Occurrences (DIG 2025-0009): all-commodity point layer
 *   - AER Metallic Mineral Occurrences (DIG 2019-0026)
 *   - AER Industrial Mineral Occurrences (DIG 2019-0027)
 *   - AER Bedrock Geology polygons (DIG 2013-0018 / Open Canada)
 *   - AER Prospective Areas for Mineral Exploration (DIG 2019-0025)
 *   - AER Bedrock Zones / Physiography (tile MapServer)
 *
 * All ArcGIS services are hosted under AER's ArcGIS Online org:
 *   https://services2.arcgis.com/jQV6VMr2Loovu7GU/
 */

const AER_BASE = 'https://services2.arcgis.com/jQV6VMr2Loovu7GU/arcgis/rest/services';

const ENDPOINTS = {
  mineral_occurrences: `${AER_BASE}/Mineral_Occurrences/FeatureServer/0/query`,
  metallic: `${AER_BASE}/Metallic_Mineral_Occurrences/FeatureServer/0/query`,
  industrial: `${AER_BASE}/Industrial_Mineral_Occurrences/FeatureServer/0/query`,
  prospective_areas: `${AER_BASE}/Prospective_Areas_Mineral_Exploration/FeatureServer/0/query`,
  kimberlite: `${AER_BASE}/Kimberlite_and_Ultrabasic_Intrusions/FeatureServer/0/query`,
  lithium: `${AER_BASE}/Lithium_Content_in_Formation_Water/FeatureServer/0/query`,
};

const BEDROCK_TILES = `${AER_BASE}/Bedrock_Topography_of_Alberta_DIG_2020_0022/MapServer`;

/**
 * Query all mineral data sources in parallel for a given parcel bbox.
 *
 * @param {{ west:number, south:number, east:number, north:number }} bbox
 * @param {{ centre?: {latitude:number,longitude:number}, search_radius_km?:number }} opts
 */
export async function fetchMinerals(bbox, opts = {}) {
  const searchKm = opts.search_radius_km ?? 15;
  const centre = opts.centre || {
    latitude: (bbox.south + bbox.north) / 2,
    longitude: (bbox.west + bbox.east) / 2,
  };
  // Expand bbox for mineral search — mineral occurrences can be sparse
  const expandedBbox = expandBbox(bbox, searchKm * 1000);

  const [
    generalMetallic,
    generalIndustrial,
    metallic,
    industrial,
    prospective,
    kimberlite,
    lithium,
  ] = await Promise.all([
    queryArcgis(ENDPOINTS.mineral_occurrences, expandedBbox, {
      outFields: 'site_name,commodity,geo_age,geo_unit,site_type,dev_stage,geo_region,comments,reference',
      limit: 25,
    }),
    queryArcgis(ENDPOINTS.mineral_occurrences, expandedBbox, {
      where: "commodity LIKE '%Industrial%' OR site_type = 'Terrigenous'",
      outFields: 'site_name,commodity,geo_age,geo_unit,site_type,dev_stage',
      limit: 15,
    }),
    queryArcgis(ENDPOINTS.metallic, expandedBbox, {
      outFields: 'Name,Comm_1,Other_comm,Ore_min,Gangue_min,Dep_Type,Host_Rock,Geo_Age,Geo_Unit,Geo_Region,Exposure,Site_Type,Dev_Stage,Depth_m',
      limit: 25,
    }),
    queryArcgis(ENDPOINTS.industrial, expandedBbox, {
      outFields: 'Name,Comm_1,Other_comm,Dev_Stage,Site_Type,Geo_Age,Geo_Unit,Geo_Region',
      limit: 25,
    }),
    queryArcgis(ENDPOINTS.prospective_areas, expandedBbox, {
      outFields: '*',
      limit: 10,
    }),
    queryArcgis(ENDPOINTS.kimberlite, expandedBbox, {
      outFields: 'Name,Body_Name,Geo_Age,Geo_Unit,Type,Area_m2',
      limit: 10,
    }),
    queryArcgis(ENDPOINTS.lithium, expandedBbox, {
      outFields: 'Name,Li_mg_L,TDS_mg_L,Formation,Geo_Age,Geo_Unit',
      limit: 10,
    }),
  ]);

  // Combine all point occurrences
  const allOccurrences = [
    ...generalMetallic,
    ...metallic,
    ...industrial,
    ...kimberlite,
    ...lithium,
  ];

  // Deduplicate by location + commodity
  const seen = new Set();
  const unique = [];
  for (const f of allOccurrences) {
    const a = f.properties || f;
    const key = `${(a.Name || a.name || a.site_name || '').toLowerCase()}|${(a.Comm_1 || a.commodity || '').toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }

  // Sort by distance to parcel centre
  const withDist = unique.map((f) => {
    const a = f.properties || f;
    const lat = a.lat_nad83 || a.Lat_NAD83 || a.latitude || 0;
    const lng = a.long_nad83 || a.Long_NAD83 || a.longitude || 0;
    const distM = haversineM(centre.latitude, centre.longitude, lat, lng);
    return { ...f, _dist_m: distM };
  }).sort((a, b) => a._dist_m - b._dist_m);

  // Extract commodity summary
  const commodityCounts = new Map();
  for (const f of withDist) {
    const a = f.properties || f;
    const commodity = a.Comm_1 || a.commodity || a.Commodity || 'Unknown';
    for (const c of String(commodity).split(/[,;/]/)) {
      const trimmed = c.trim();
      if (trimmed) commodityCounts.set(trimmed, (commodityCounts.get(trimmed) || 0) + 1);
    }
  }

  // Group by commodity type
  const metallicList = withDist.filter((f) => {
    const a = f.properties || f;
    return a.Comm_1 || a.Ore_min || a.Dep_Type;
  }).slice(0, 15);

  const industrialList = withDist.filter((f) => {
    const a = f.properties || f;
    return a.site_type === 'Terrigenous' || String(a.commodity || '').includes('Clay') || String(a.commodity || '').includes('Sand') || String(a.commodity || '').includes('Gravel');
  }).slice(0, 10);

  // Prospective areas (polygons)
  const prospectiveAreas = prospective.map((f) => {
    const a = f.properties || f;
    return {
      name: a.Name || a.name || 'Prospective area',
      commodity: a.Comm_1 || a.commodity || null,
      geo_age: a.Geo_Age || a.geo_age || null,
      geo_unit: a.Geo_Unit || a.geo_unit || null,
      geo_region: a.Geo_Region || a.geo_region || null,
      notes: a.Comments || a.comments || null,
    };
  });

  // Bedrock geology context (from occurrence data)
  const bedrockContext = extractBedrockContext(withDist);

  // Top commodities
  const topCommodities = [...commodityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    available: allOccurrences.length > 0,
    occurrence_count: allOccurrences.length,
    unique_count: withDist.length,
    search_radius_km: searchKm,
    top_commodities: topCommodities,
    bedrock_context: bedrockContext,
    metallic: metallicList.map(formatOccurrence),
    industrial: industrialList.map(formatOccurrence),
    prospective_areas: prospectiveAreas,
    all_occurrences: withDist.slice(0, 20).map(formatOccurrence),
    source: 'Alberta Geological Survey (AER)',
    source_urls: [
      'https://ags.aer.ca/publications/all-publications/dig-2025-0009',
      'https://open.canada.ca/data/en/dataset/34739138-af4f-4d9d-a7fb-f18a8e694398',
    ],
    disclaimer:
      'Mineral occurrence data is for informational and screening purposes only. Not a substitute for professional geological assessment or mineral exploration permits.',
    bedrock_tile_url: BEDROCK_TILES,
  };
}

// ── ArcGIS query helper ──────────────────────────────────

async function queryArcgis(url, bbox, opts = {}) {
  const geoJson = {
    type: 'Envelope',
    xmin: bbox.west,
    ymin: bbox.south,
    xmax: bbox.east,
    ymax: bbox.north,
  };

  const body = new URLSearchParams({
    geometry: JSON.stringify(geoJson),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: opts.outFields || '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultRecordCount: String(opts.limit || 20),
  });

  if (opts.where) body.set('where', opts.where);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`AER ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'AER query error');

    const features = (data.features || []).map((f) => ({
      type: 'Feature',
      properties: f.attributes || {},
      geometry: f.geometry
        ? {
            type: 'Point',
            coordinates: [f.geometry.x, f.geometry.y],
          }
        : null,
    }));

    return features;
  } catch (e) {
    console.warn(`[minerals] query failed: ${url.split('/').slice(-3).join('/')}:`, e.message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// ── Helpers ──────────────────────────────────────────────

function formatOccurrence(f) {
  const a = f.properties || f;
  return {
    name: a.Name || a.name || a.site_name || null,
    commodity: a.Comm_1 || a.commodity || null,
    other_commodity: a.Other_comm || a.other_commodity || null,
    ore_minerals: a.Ore_min || null,
    gangue_minerals: a.Gangue_min || null,
    alteration_minerals: a.Alt_Min || null,
    deposit_type: a.Dep_Type || a.site_type || null,
    host_rock: a.Host_Rock || null,
    geo_age: a.Geo_Age || a.geo_age || null,
    geo_unit: a.Geo_Unit || a.geo_unit || null,
    geo_region: a.Geo_Region || a.geo_region || null,
    development_stage: a.Dev_Stage || a.dev_stage || null,
    exposure: a.Exposure || null,
    depth_m: a.Depth_m || null,
    highlight: a.Exp_Hghlt || null,
    highlight_grade: a.Hghlt_Grd1 || null,
    highlight_unit: a.Hghlt_Unt1 || null,
    comments: a.Comments || a.comments || null,
    reference: a.Ref_Prime || a.reference || null,
    distance_m: f._dist_m ?? null,
  };
}

function extractBedrockContext(occurrences) {
  const ages = new Map();
  const units = new Map();
  const regions = new Map();

  for (const f of occurrences) {
    const a = f.properties || f;
    const age = a.Geo_Age || a.geo_age;
    const unit = a.Geo_Unit || a.geo_unit;
    const region = a.Geo_Region || a.geo_region;
    if (age && age.trim()) ages.set(age.trim(), (ages.get(age.trim()) || 0) + 1);
    if (unit && unit.trim()) units.set(unit.trim(), (units.get(unit.trim()) || 0) + 1);
    if (region && region.trim()) regions.set(region.trim(), (regions.get(region.trim()) || 0) + 1);
  }

  return {
    dominant_age: topEntry(ages),
    dominant_unit: topEntry(units),
    dominant_region: topEntry(regions),
    age_distribution: [...ages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ age: k, count: v })),
    unit_distribution: [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ unit: k, count: v })),
  };
}

function topEntry(map) {
  if (!map.size) return null;
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
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

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}