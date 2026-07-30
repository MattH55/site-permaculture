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

const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const SG_TIMEOUT_MS = 18_000;

/**
 * Full soil survey lookup at a point.
 * Combines AGRASIS LandSystems + AGRASID data + mapped SoilGrids sample grid.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ bbox?: { west:number, south:number, east:number, north:number }, samples?: number }} [opts]
 * @returns {Promise<object>}
 */
async function querySoilSurvey(lat, lng, opts = {}) {
  try {
    const [landSystem, agrasid, samples] = await Promise.all([
      queryLandSystem(lat, lng).catch(() => null),
      queryAgrasidPolygon(lat, lng).catch(() => null),
      fetchSoilSampleGrid(lat, lng, opts).catch(() => ({ samples: [], summary: null })),
    ]);

    if (!landSystem && !agrasid && !(samples?.samples?.length)) {
      return {
        available: false,
        error: 'No AGRASID/AGRASIS or SoilGrids soil data at this location (may be outside agricultural zone).',
      };
    }

    const soilZoneInfo = interpretSoilZone(landSystem?.soil_zone);
    const soilOrderInfo = interpretSoilOrder(landSystem?.soil_order_primary);
    const characteristics = deriveSoilCharacteristics(landSystem);

    // Merge SoilGrids sample summary into characteristics when survey text is thin
    const sampleSummary = samples?.summary || null;
    if (sampleSummary) {
      if (!characteristics.texture_class && sampleSummary.texture_class) {
        characteristics.texture_class = sampleSummary.texture_class;
      }
      if (sampleSummary.mean_ph != null) {
        characteristics.ph_h2o_mean = sampleSummary.mean_ph;
      }
      if (sampleSummary.mean_clay_pct != null) {
        characteristics.clay_pct_mean = sampleSummary.mean_clay_pct;
      }
      if (sampleSummary.mean_sand_pct != null) {
        characteristics.sand_pct_mean = sampleSummary.mean_sand_pct;
      }
      if (sampleSummary.mean_silt_pct != null) {
        characteristics.silt_pct_mean = sampleSummary.mean_silt_pct;
      }
      if (sampleSummary.mean_soc_g_kg != null) {
        characteristics.soc_g_kg_regional_mean = sampleSummary.mean_soc_g_kg;
      }
    }

    return {
      available: true,
      land_system: landSystem || undefined,
      agrasid: agrasid || undefined,
      soil_zone_info: soilZoneInfo,
      soil_order_info: soilOrderInfo,
      characteristics,
      /** Mapped sample points (SoilGrids ~250 m) for property map display */
      soil_samples: samples?.samples || [],
      sample_summary: sampleSummary,
      sample_source: samples?.source || null,
      sample_note:
        'Soil sample markers use SoilGrids 2.0 (~250 m) at a property grid — regional model values, not lab tests. Use for screening and map orientation only.',
      source: landSystem || agrasid
        ? 'Alberta Agriculture and Irrigation — AGRASID/AGRASIS (+ SoilGrids sample grid)'
        : 'SoilGrids 2.0 (ISRIC) sample grid — no AGRASID polygon at point',
      source_url: landSystem || agrasid
        ? 'https://www.alberta.ca/agrasid-agricultural-regions-of-alberta-soil-inventory-database'
        : 'https://www.isric.org/explore/soilgrids',
    };
  } catch (err) {
    return {
      available: false,
      error: err.message,
    };
  }
}

/**
 * Sample a small grid across the parcel (or around the centre) and query
 * SoilGrids for clay / sand / silt / pH / SOC at each point.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {{ bbox?: object, samples?: number }} opts
 */
async function fetchSoilSampleGrid(lat, lng, opts = {}) {
  const n = Math.min(Math.max(opts.samples ?? 9, 1), 12);
  const points = sampleGridPoints(lat, lng, opts.bbox, n);
  const samples = [];

  // Sequential with short concurrency to respect SoilGrids rate limits
  const chunk = 3;
  for (let i = 0; i < points.length; i += chunk) {
    const batch = points.slice(i, i + chunk);
    const results = await Promise.all(
      batch.map((p) => querySoilGridsPoint(p.lat, p.lng).catch(() => null))
    );
    for (let j = 0; j < batch.length; j++) {
      const props = results[j];
      if (!props) continue;
      samples.push({
        id: `sg-${samples.length + 1}`,
        lat: batch[j].lat,
        lng: batch[j].lng,
        role: batch[j].role,
        ...props,
      });
    }
  }

  if (!samples.length) {
    return { samples: [], summary: null, source: 'SoilGrids 2.0 (ISRIC)' };
  }

  const summary = summarizeSamples(samples);
  return {
    samples,
    summary,
    source: 'SoilGrids 2.0 (ISRIC) — clay/sand/silt/pH/SOC @ ~250 m',
  };
}

/**
 * Build sample locations: centre + corners / edge midpoints of bbox.
 */
function sampleGridPoints(lat, lng, bbox, n) {
  if (!bbox || bbox.west == null) {
    // ~180 m offsets around centre
    const d = 0.0016;
    const pts = [
      { lat, lng, role: 'centre' },
      { lat: lat + d, lng: lng - d, role: 'NW' },
      { lat: lat + d, lng: lng + d, role: 'NE' },
      { lat: lat - d, lng: lng - d, role: 'SW' },
      { lat: lat - d, lng: lng + d, role: 'SE' },
    ];
    if (n > 5) {
      pts.push(
        { lat: lat + d, lng, role: 'N' },
        { lat: lat - d, lng, role: 'S' },
        { lat, lng: lng - d, role: 'W' },
        { lat, lng: lng + d, role: 'E' }
      );
    }
    return pts.slice(0, n);
  }

  const { west, south, east, north } = bbox;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  // Shrink slightly so samples stay on-parcel
  const mx = (east - west) * 0.2;
  const my = (north - south) * 0.2;
  const w = west + mx;
  const e = east - mx;
  const s = south + my;
  const nn = north - my;
  const pts = [
    { lat: cy, lng: cx, role: 'centre' },
    { lat: nn, lng: w, role: 'NW' },
    { lat: nn, lng: e, role: 'NE' },
    { lat: s, lng: w, role: 'SW' },
    { lat: s, lng: e, role: 'SE' },
    { lat: nn, lng: cx, role: 'N' },
    { lat: s, lng: cx, role: 'S' },
    { lat: cy, lng: w, role: 'W' },
    { lat: cy, lng: e, role: 'E' },
  ];
  return pts.slice(0, n);
}

/**
 * Single SoilGrids point query — surface 0–5 cm + 5–15 cm means.
 */
async function querySoilGridsPoint(lat, lng) {
  const url =
    `${SOILGRIDS}?lon=${lng.toFixed(5)}&lat=${lat.toFixed(5)}` +
    `&property=soc&property=clay&property=sand&property=silt&property=phh2o` +
    `&depth=0-5cm&depth=5-15cm&value=mean`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SG_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const layers = data?.properties?.layers || [];
    if (!layers.length) return null;

    const pick = (name) => {
      const layer = layers.find((l) => l.name === name);
      if (!layer?.depths?.length) return null;
      const dFactor = layer.unit_measure?.d_factor || 1;
      const vals = layer.depths
        .map((d) => d.values?.mean)
        .filter((v) => v != null && Number.isFinite(v))
        .map((v) => v / dFactor);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    // ISRIC: clay/sand/silt in g/kg (d_factor 10) → %; pH d_factor 10; soc g/kg d_factor 10
    const clayRaw = pick('clay');
    const sandRaw = pick('sand');
    const siltRaw = pick('silt');
    const phRaw = pick('phh2o');
    const socRaw = pick('soc');

    // When d_factor already applied in pick, values are in reported units
    // clay/sand/silt: g/kg → % by /10 if still large
    const toPct = (v) => {
      if (v == null) return null;
      // After /d_factor (10), ISRIC clay is still often ~20–50 (g/kg units scaled) — actually
      // mean 218 with d_factor 10 → 21.8 which is % if we treat residual as g/kg of 0-1000.
      // Convention: clay mean/10 = g/kg? Docs: unit g/kg, d_factor 10, so raw/10 = g/kg.
      // g/kg / 10 = %  (e.g. 218 raw → 21.8 g/kg? Wait:
      // From ISRIC: "values are provided in the unit of measurement with a conversion factor"
      // clay unit g/kg, d_factor 10 → value 218 means 21.8 g/kg which is wrong for clay %.
      // Actually: 218/10 = 21.8% when people treat it as percent... Clay content ~200-400 g/kg = 20-40%.
      // So raw/d_factor = g/kg, and % = (raw/d_factor)/10.
      return round1(v / 10);
    };

    // pick already divides by d_factor → g/kg for texture, pH*10 units, soc g/kg
    // clay after /10 d_factor: if raw mean=218, pick returns 21.8 which IS already %
    // Checking earlier probe: clay:218 without dividing — that's raw. With d_factor 10 → 21.8%
    // phh2o:67 → 6.7. soc:537 → 53.7 g/kg.

    const clay_pct = clayRaw != null ? round1(clayRaw) : null; // after d_factor already %
    // Wait - pick divides by d_factor. clay raw 218 / 10 = 21.8 → clay %
    // sand raw 368 / 10 = 36.8 → %
    // ph 67 / 10 = 6.7
    // soc 537 / 10 = 53.7 g/kg

    // Actually re-read pick: d_factor from unit_measure, default 1.
    // For clay, d_factor is 10, so clayRaw = 21.8 which we report as clay_pct.
    // For consistency with satellite-indices SOC: raw / d_factor = g/kg for SOC.

    const sand_pct = sandRaw != null ? round1(sandRaw) : null;
    const silt_pct = siltRaw != null ? round1(siltRaw) : null;
    // pH: raw 67 / 10 = 6.7 — pick already did /d_factor
    const ph = phRaw != null ? round2(phRaw) : null;
    // SOC: g/kg after /d_factor
    const soc_g_kg = socRaw != null ? round1(socRaw) : null;

    // If values look like they weren't scaled (clay > 100), scale down
    const fixPct = (v) => {
      if (v == null) return null;
      if (v > 100) return round1(v / 10);
      return v;
    };
    const fixPh = (v) => {
      if (v == null) return null;
      if (v > 14) return round2(v / 10);
      return v;
    };

    const clay = fixPct(clay_pct);
    const sand = fixPct(sand_pct);
    const silt = fixPct(silt_pct);
    const phh2o = fixPh(ph);
    const soc = soc_g_kg != null && soc_g_kg > 200 ? round1(soc_g_kg / 10) : soc_g_kg;

    if (clay == null && sand == null && soc == null && phh2o == null) return null;

    const texture_class = textureFromFractions(sand, silt, clay);

    return {
      clay_pct: clay,
      sand_pct: sand,
      silt_pct: silt,
      ph_h2o: phh2o,
      soc_g_kg: soc,
      texture_class,
      depth: '0–15 cm (0–5 + 5–15 mean)',
      resolution_m: 250,
      confidence: 'low-moderate',
    };
  } finally {
    clearTimeout(t);
  }
}

function textureFromFractions(sand, silt, clay) {
  if (sand == null || clay == null) return null;
  const si = silt != null ? silt : Math.max(0, 100 - sand - clay);
  // Simplified USDA triangle
  if (clay >= 40) return sand >= 45 ? 'sandy clay' : si >= 40 ? 'silty clay' : 'clay';
  if (clay >= 27 && clay < 40) {
    if (sand <= 20) return 'silty clay loam';
    if (sand >= 45) return 'sandy clay loam';
    return 'clay loam';
  }
  if (clay >= 20 && clay < 27) {
    if (si >= 50) return 'silt loam';
    if (sand >= 52) return 'sandy clay loam';
    return 'loam';
  }
  if (clay < 20) {
    if (si >= 50 && clay >= 12) return 'silt loam';
    if (si >= 80) return 'silt';
    if (sand >= 70 && clay < 15) return sand >= 85 ? 'sand' : 'loamy sand';
    if (sand >= 43) return 'sandy loam';
    return 'loam';
  }
  return 'loam';
}

function summarizeSamples(samples) {
  const avg = (key) => {
    const vals = samples.map((s) => s[key]).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) return null;
    return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const textures = samples.map((s) => s.texture_class).filter(Boolean);
  const texture_class = mode(textures);

  return {
    n_samples: samples.length,
    mean_clay_pct: avg('clay_pct'),
    mean_sand_pct: avg('sand_pct'),
    mean_silt_pct: avg('silt_pct'),
    mean_ph: avg('ph_h2o') != null ? round2(avg('ph_h2o')) : null,
    mean_soc_g_kg: avg('soc_g_kg'),
    min_soc_g_kg: minOf(samples, 'soc_g_kg'),
    max_soc_g_kg: maxOf(samples, 'soc_g_kg'),
    texture_class,
    resolution_m: 250,
    confidence: 'low-moderate',
    note: 'Regional SoilGrids means across sample grid — not lab-verified property SOC',
  };
}

function mode(arr) {
  if (!arr.length) return null;
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function minOf(arr, key) {
  const vals = arr.map((s) => s[key]).filter((v) => v != null);
  return vals.length ? round1(Math.min(...vals)) : null;
}
function maxOf(arr, key) {
  const vals = arr.map((s) => s[key]).filter((v) => v != null);
  return vals.length ? round1(Math.max(...vals)) : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

export {
  querySoilSurvey,
  queryLandSystem,
  queryAgrasidPolygon,
  interpretSoilZone,
  interpretSoilOrder,
  deriveSoilCharacteristics,
  fetchSoilSampleGrid,
  querySoilGridsPoint,
  AGRASIS_URL,
  AGRASID_URL,
};

