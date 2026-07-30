/**
 * Alberta AGRASID/AGRASIS soil survey data extraction
 *
 * Queries the Alberta Government's ArcGIS FeatureServer layers for
 * soil landscape polygons at a given point.
 *
 * Data sources:
 * - AGRASIS LandSystems: https://services5.arcgis.com/7tj7rgpq1fcYCLtB/arcgis/rest/services/AGRASIS_LandSystems/FeatureServer/18
 * - AGRASID SoilPolygons: https://services1.arcgis.com/CQDK7abdVpczSUjn/arcgis/rest/services/AGRASID/FeatureServer/0
 * - AGRASIS LandSystems Legend: https://services5.arcgis.com/7tj7rgpq1fcYCLtB/arcgis/rest/services/AGRASIS_LandSystems_Legend/FeatureServer/18
 *
 * Attribution: Alberta Agriculture and Irrigation — AGRASID/AGRASIS
 * Licence: Open Government Licence — Alberta
 */

const AGRASIS_URL = 'https://services5.arcgis.com/7tj7rgpq1fcYCLtB/arcgis/rest/services/AGRASIS_LandSystems/FeatureServer/18';
const AGRASID_URL = 'https://services1.arcgis.com/CQDK7abdVpczSUjn/arcgis/rest/services/AGRASID/FeatureServer/0';

/**
 * Query an ArcGIS FeatureServer at a point.
 */
async function queryAtPoint(serviceUrl, lat, lng, outFields = ['*']) {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'false',
    resultRecordCount: '5',
  });

  const url = `${serviceUrl}/query?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Soil query failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Soil query error: ${data.error.message}`);
  return data.features || [];
}

/**
 * Query AGRASIS LandSystems polygon containing the point.
 */
async function queryLandSystem(lat, lng) {
  const features = await queryAtPoint(AGRASIS_URL, lat, lng, [
    'LSLGDSYM', 'NAME', 'MORPHOL', 'SCA', 'SOIL_ZONE', 'AG_CLIMATE',
    'ORD1', 'ORD2', 'MAJOR1', 'MAJOR2', 'MAJOR3',
    'MINOR1', 'MINOR2', 'SURFORM1', 'SURFORM2', 'SURFORM3',
  ]);
  if (!features.length) return null;
  const a = features[0].attributes;
  return {
    land_system_symbol: a.LSLGDSYM || null,
    land_system_name: a.NAME || null,
    morphology: a.MORPHOL || null,
    soil_zone: a.SOIL_ZONE || null,
    ag_climate_zone: a.AG_CLIMATE || null,
    soil_order_primary: a.ORD1 || null,
    soil_order_secondary: a.ORD2 || null,
    major_components: [a.MAJOR1, a.MAJOR2, a.MAJOR3].filter(Boolean),
    minor_components: [a.MINOR1, a.MINOR2].filter(Boolean),
    surface_forms: [a.SURFORM1, a.SURFORM2, a.SURFORM3].filter(Boolean),
    scale_area_km2: a.SCA || null,
  };
}

/**
 * Query AGRASID soil polygon containing the point.
 */
async function queryAgrasidPolygon(lat, lng) {
  const features = await queryAtPoint(AGRASID_URL, lat, lng, [
    'POLY_ID', 'MUNAME', 'SLC3', 'LCODE', 'LMOD',
  ]);
  if (!features.length) return null;
  const a = features[0].attributes;
  return {
    polygon_id: a.POLY_ID || null,
    municipality: a.MUNAME || null,
    slc_unit: a.SLC3 || null,
    land_capability_code: a.LCODE || null,
    land_capability_modifier: a.LMOD || null,
  };
}

/**
 * Interpret soil zone into permaculture-relevant categories.
 */
function interpretSoilZone(soilZone) {
  if (!soilZone) return null;
  const zone = soilZone.toLowerCase();

  const info = {
    name: soilZone,
    precipitation_range_mm: null,
    typical_texture: null,
    organic_matter_level: null,
    growing_season: null,
    permaculture_notes: [],
  };

  if (zone.includes('brown') && !zone.includes('dark')) {
    info.precipitation_range_mm = '300–400';
    info.typical_texture = 'sandy loam to loam';
    info.organic_matter_level = 'low (1.5–3%)';
    info.growing_season = 'short (100–120 frost-free days)';
    info.permaculture_notes = [
      'Semi-arid — water harvesting is the top priority.',
      'Windbreaks critical for moisture retention.',
      'Drought-tolerant species (caragana, sea buckthorn, buffalo berry) perform best.',
      'Mulching and soil building essential to increase organic matter.',
    ];
  } else if (zone.includes('dark brown')) {
    info.precipitation_range_mm = '350–450';
    info.typical_texture = 'loam to clay loam';
    info.organic_matter_level = 'moderate (3–5%)';
    info.growing_season = 'moderate (110–130 frost-free days)';
    info.permaculture_notes = [
      'Transitional zone — good balance of moisture and warmth.',
      'Most temperate fruits and vegetables viable with wind protection.',
      'Keyline cultivation and swales effective for water retention.',
    ];
  } else if (zone.includes('black') && !zone.includes('dark')) {
    info.precipitation_range_mm = '400–500';
    info.typical_texture = 'clay loam to loam';
    info.organic_matter_level = 'moderate-high (4–7%)';
    info.growing_season = 'good (120–140 frost-free days)';
    info.permaculture_notes = [
      'Chernozemic soils — among the best for agriculture in Alberta.',
      'Rich in organic matter; no-till and cover crops maintain fertility.',
      'Food forest guilds and perennial systems thrive here.',
      'Clay-loam drainage may need swales or raised beds in wet years.',
    ];
  } else if (zone.includes('dark gray')) {
    info.precipitation_range_mm = '450–550';
    info.typical_texture = 'clay loam to silty clay';
    info.organic_matter_level = 'high (5–10%)';
    info.growing_season = 'moderate (110–130 frost-free days)';
    info.permaculture_notes = [
      'Gray Luvisol soils — high organic matter but often imperfect drainage.',
      'Wetland edges common; check drainage before planting.',
      'Good for berry crops, willows, and moisture-loving perennials.',
    ];
  } else if (zone.includes('gray')) {
    info.precipitation_range_mm = '450–600';
    info.typical_texture = 'clay to silty clay';
    info.organic_matter_level = 'high (6–12%)';
    info.growing_season = 'short (90–120 frost-free days)';
    info.permaculture_notes = [
      'Boreal transition — cool, wet, short seasons.',
      'Focus on cold-hardy species (haskap, saskatoon, native shrubs).',
      'Drainage management critical — raised beds and hugelkultur recommended.',
    ];
  } else if (zone.includes('peace river')) {
    info.precipitation_range_mm = '400–500';
    info.typical_texture = 'loam to clay loam';
    info.organic_matter_level = 'moderate-high (4–8%)';
    info.growing_season = 'very short (80–110 frost-free days)';
    info.permaculture_notes = [
      'Peace River lowlands — long days compensate for short season.',
      'Extremely cold-hardy varieties required (UofR hardy fruit program).',
      'Microclimate creation (windbreaks, thermal mass) essential.',
    ];
  }

  return info;
}

/**
 * Interpret soil order for permaculture relevance.
 */
function interpretSoilOrder(order) {
  if (!order) return null;
  const o = order.toLowerCase();

  if (o.includes('chernozem') || o.includes('chernozemic')) {
    return { order, quality: 'excellent', note: 'Chernozem — Alberta\'s best agricultural soils. Rich in organic matter, good structure.' };
  }
  if (o.includes('luvisol') || o.includes('gray wooded')) {
    return { order, quality: 'moderate', note: 'Luvisol (Gray Wooded) — high organic matter but often acidic, imperfect drainage. Common in parkland/boreal transition.' };
  }
  if (o.includes('regosol')) {
    return { order, quality: 'poor', note: 'Regosol — young, undeveloped soil with little profile development. Often sandy or rocky.' };
  }
  if (o.includes('brunisol')) {
    return { order, quality: 'moderate', note: 'Brunisol — forest soil with some development. Moderate fertility, may be acidic.' };
  }
  if (o.includes('gleysol')) {
    return { order, quality: 'poor', note: 'Gleysol — waterlogged, poorly drained. Wetland indicator. Limited agricultural use without drainage.' };
  }
  if (o.includes('organic') || o.includes('misol')) {
    return { order, quality: 'variable', note: 'Organic/Misol — peat or muck soils. High organic matter but often waterlogged. Specialized crops only.' };
  }
  if (o.includes('solonetz') || o.includes('solod')) {
    return { order, quality: 'poor', note: 'Solonetz/Solod — saline/sodic soils. Difficult for most crops. Salt-tolerant species only.' };
  }
  if (o.includes('cryosol')) {
    return { order, quality: 'very poor', note: 'Cryosol — permafrost-affected. Very limited agriculture.' };
  }

  return { order, quality: 'unknown', note: `${order} — soil quality assessment needed.` };
}

/**
 * Derive permaculture-relevant soil characteristics from AGRASIS components.
 */
function deriveSoilCharacteristics(landSystem) {
  if (!landSystem) return {};

  const chars = {
    drainage: null,
    erosion_risk: null,
    texture_class: null,
    suitable_for_trees: null,
    suitable_for_crops: null,
    salinity_risk: null,
    stoniness: null,
  };

  const components = [
    ...(landSystem.major_components || []),
    ...(landSystem.minor_components || []),
  ].map(c => (c || '').toLowerCase());

  const morph = (landSystem.morphology || '').toLowerCase();
  const surfaceForms = (landSystem.surface_forms || []).map(s => (s || '').toLowerCase());

  // Infer drainage
  if (morph.includes('well drained') || morph.includes('well-drained')) chars.drainage = 'well';
  else if (morph.includes('moderately well') || morph.includes('mod-well')) chars.drainage = 'moderately_well';
  else if (morph.includes('imperfect') || morph.includes('somewhat poor')) chars.drainage = 'imperfect';
  else if (morph.includes('poor') || morph.includes('very poor')) chars.drainage = 'poor';
  else if (morph.includes('rapid') || morph.includes('excessive')) chars.drainage = 'excessive';

  // Infer texture from components
  const hasClay = components.some(c => c.includes('clay'));
  const hasSand = components.some(c => c.includes('sand'));
  const hasLoam = components.some(c => c.includes('loam'));
  const hasSilt = components.some(c => c.includes('silt'));

  if (hasClay && hasSand) chars.texture_class = 'clay loam';
  else if (hasClay) chars.texture_class = 'clay';
  else if (hasSand && hasLoam) chars.texture_class = 'sandy loam';
  else if (hasSand) chars.texture_class = 'sand';
  else if (hasSilt) chars.texture_class = 'silt loam';
  else if (hasLoam) chars.texture_class = 'loam';

  // Infer erosion risk
  if (surfaceForms.some(s => s.includes('steep') || s.includes('escarpment') || s.includes('breaks'))) {
    chars.erosion_risk = 'high';
  } else if (surfaceForms.some(s => s.includes('undulating') || s.includes('rolling') || s.includes('hilly'))) {
    chars.erosion_risk = 'moderate';
  } else if (surfaceForms.some(s => s.includes('level') || s.includes('flat') || s.includes('gently'))) {
    chars.erosion_risk = 'low';
  }

  // Infer tree suitability
  const soilZone = (landSystem.soil_zone || '').toLowerCase();
  if (soilZone.includes('brown')) chars.suitable_for_trees = 'limited — drought-tolerant species only';
  else if (soilZone.includes('dark brown')) chars.suitable_for_trees = 'good — most shelterbelt species viable';
  else if (soilZone.includes('black')) chars.suitable_for_trees = 'excellent — wide range of tree species';
  else if (soilZone.includes('gray') || soilZone.includes('dark gray')) chars.suitable_for_trees = 'good — boreal-adapted species';

  // Infer crop suitability
  if (hasClay && !hasSand && chars.drainage === 'poor') chars.suitable_for_crops = 'limited — drainage issues';
  else if (hasSand && !hasClay) chars.suitable_for_crops = 'moderate — drought risk on sandy soils';
  else if (hasLoam && chars.drainage !== 'poor') chars.suitable_for_crops = 'good — loam soils with adequate drainage';
  else chars.suitable_for_crops = 'variable — check specific conditions';

  // Salinity risk
  if (morph.includes('salin') || components.some(c => c.includes('salin'))) {
    chars.salinity_risk = 'elevated';
  }

  return chars;
}

/**
 * Full soil survey lookup at a point.
 * Combines AGRASIS LandSystems + AGRASID data.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{available: boolean, land_system?: object, agrasid?: object, soil_zone_info?: object, soil_order_info?: object, characteristics?: object, error?: string}>}
 */
async function querySoilSurvey(lat, lng) {
  try {
    const [landSystem, agrasid] = await Promise.all([
      queryLandSystem(lat, lng).catch(() => null),
      queryAgrasidPolygon(lat, lng).catch(() => null),
    ]);

    if (!landSystem && !agrasid) {
      return {
        available: false,
        error: 'No AGRASID/AGRASIS soil data at this location (may be outside agricultural zone).',
      };
    }

    const soilZoneInfo = interpretSoilZone(landSystem?.soil_zone);
    const soilOrderInfo = interpretSoilOrder(landSystem?.soil_order_primary);
    const characteristics = deriveSoilCharacteristics(landSystem);

    return {
      available: true,
      land_system: landSystem || undefined,
      agrasid: agrasid || undefined,
      soil_zone_info: soilZoneInfo,
      soil_order_info: soilOrderInfo,
      characteristics,
      source: 'Alberta Agriculture and Irrigation — AGRASID/AGRASIS',
      source_url: 'https://www.alberta.ca/agrasid-agricultural-regions-of-alberta-soil-inventory-database',
    };
  } catch (err) {
    return {
      available: false,
      error: err.message,
    };
  }
}

module.exports = {
  querySoilSurvey,
  queryLandSystem,
  queryAgrasidPolygon,
  interpretSoilZone,
  interpretSoilOrder,
  deriveSoilCharacteristics,
  AGRASIS_URL,
  AGRASID_URL,
};