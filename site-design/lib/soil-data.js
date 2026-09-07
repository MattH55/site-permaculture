/**
 * Soil data layer: AGRASID/AGRASIS primary (Alberta agricultural soil
 * survey), SoilGrids (ISRIC) global fallback where AGRASID has no coverage.
 *
 * Coverage is checked live at a small sample grid across the parcel (not
 * "is this in Alberta") — AGRASID's survey extent is the agricultural
 * region specifically, and does not cover forested/mountainous/urban-fringe
 * Alberta. Reuses the AGRASID/AGRASIS point-query + SoilGrids sample-grid
 * machinery already built in soil-survey.js rather than re-implementing it.
 *
 * See soil-data-layer-instructions.md for the schema/behaviour this
 * implements.
 */
import {
  queryLandSystem,
  queryAgrasidPolygon,
  deriveSoilCharacteristics,
  fetchSoilSampleGrid,
  querySoilGridsPoint,
  sampleGridPoints,
} from './soil-survey.js';

const TTL = 7 * 864e5;
const cache = new Map();

export async function getSoilData(bbox, legacyAlrSoils = {}, opts = {}) {
  const key = [bbox.west, bbox.south, bbox.east, bbox.north].map(x => Number(x).toFixed(4)).join(',');
  const hit = cache.get(key);
  if (!opts.skipCache && hit && Date.now() - hit.at < TTL) return { ...hit.value, _meta: { cache: 'hit' } };

  const centre = { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 };
  let value;
  try {
    value = await buildSoilData(centre, bbox, legacyAlrSoils, opts);
  } catch (e) {
    value = { soil_data_source: null, confidence: 'unavailable', soil_units: [], error: e.message };
  }
  if (!opts.skipCache) cache.set(key, { at: Date.now(), value });
  return value;
}

async function buildSoilData(centre, bbox, legacyAlrSoils, opts) {
  // Real coverage check: query AGRASID/AGRASIS at a small sample grid across
  // the parcel (density scaled by opts.samples, default matches the
  // soil-survey.js grid). A single centroid query would silently mislabel a
  // parcel that straddles the survey's edge; sampling multiple points also
  // gives an area-weighted way to report mixed soil units (Monte-Carlo-style
  // area estimate from sample density, since we don't have full polygon
  // geometry to intersect/clip here).
  const points = sampleGridPoints(centre.lat, centre.lng, bbox, opts.samples ?? 5);
  const hits = await Promise.all(points.map(async (p) => {
    const [landSystem, agrasid] = await Promise.all([
      queryLandSystem(p.lat, p.lng).catch(() => null),
      queryAgrasidPolygon(p.lat, p.lng).catch(() => null),
    ]);
    if (!landSystem && !agrasid) return null;
    return { point: p, landSystem, agrasid };
  }));
  const covered = hits.filter(Boolean);

  if (covered.length) return buildFromAgrasid(covered, points.length);
  return buildFromSoilGrids(centre, opts);
}

/**
 * Build soil_units from AGRASID/AGRASIS hits across the sample grid,
 * grouping samples that land in the same land-system/soil-polygon so a
 * parcel spanning more than one unit reports each with its share of the
 * sampled points as area_pct_of_parcel — an approximation (point density,
 * not true polygon-intersection area), but a real one, not a guess.
 */
async function buildFromAgrasid(covered, totalPoints) {
  const groups = new Map();
  for (const hit of covered) {
    const unitKey = hit.landSystem?.land_system_symbol || hit.agrasid?.polygon_id || 'unit';
    if (!groups.has(unitKey)) groups.set(unitKey, []);
    groups.get(unitKey).push(hit);
  }

  const units = await Promise.all([...groups.entries()].map(async ([, hitsInGroup]) => {
    const { landSystem, agrasid, point } = hitsInGroup[0];
    const chars = deriveSoilCharacteristics(landSystem) || {};
    // AGRASID/AGRASIS is a geomorphic/texture survey, not a lab-chemistry
    // dataset — pH and organic carbon aren't in it. SoilGrids covers the
    // same point, so use it to fill just those two numeric fields rather
    // than leaving them null when a perfectly good modelled value exists.
    const sg = await querySoilGridsPoint(point.lat, point.lng).catch(() => null);
    return {
      area_pct_of_parcel: round1((hitsInGroup.length / totalPoints) * 100),
      soil_series: landSystem?.land_system_name || null,
      texture_class: normalizeTexture(chars.texture_class),
      drainage_class: chars.drainage || null,
      parent_material: null, // not exposed by AGRASID/AGRASIS at this query depth
      ph: sg?.ph_h2o ?? null,
      organic_carbon_pct: sg?.soc_g_kg != null ? round1(sg.soc_g_kg / 10) : null,
      depth_to_bedrock_cm: null, // SoilGrids v2.0 dropped bedrock-depth properties
      land_capability_code: agrasid?.land_capability_code || null,
      soil_zone: landSystem?.soil_zone || null,
      confidence: 'high',
    };
  }));
  units.sort((a, b) => b.area_pct_of_parcel - a.area_pct_of_parcel);

  return {
    soil_data_source: 'AGRASID',
    confidence: 'high',
    soil_units: units,
    source_name: 'Alberta Agriculture and Irrigation — AGRASID/AGRASIS',
    source_url: 'https://www.alberta.ca/agrasid-agricultural-regions-of-alberta-soil-inventory-database',
    note: units.length > 1
      ? `Parcel spans ${units.length} distinct AGRASID/AGRASIS units — area_pct_of_parcel is estimated from sample-point density, not full polygon intersection.`
      : 'AGRASID/AGRASIS Alberta agricultural soil-survey result. pH/organic carbon supplemented from SoilGrids at the same point (not part of the AGRASID/AGRASIS survey itself).',
  };
}

async function buildFromSoilGrids(centre, opts) {
  const grid = await fetchSoilSampleGrid(centre.lat, centre.lng, opts).catch(() => null);
  const s = grid?.summary;
  if (!s) {
    return {
      soil_data_source: 'SOILGRIDS_FALLBACK',
      confidence: 'unavailable',
      soil_units: [],
      error: 'No AGRASID/AGRASIS coverage and SoilGrids returned no usable samples.',
      source_url: 'https://www.isric.org/explore/soilgrids',
    };
  }
  return {
    soil_data_source: 'SOILGRIDS_FALLBACK',
    confidence: 'moderate_low',
    soil_units: [{
      area_pct_of_parcel: 100,
      soil_series: null,
      texture_class: normalizeTexture(s.texture_class),
      drainage_class: null, // intentionally not inferred — see spec
      parent_material: null,
      ph: s.mean_ph ?? null,
      organic_carbon_pct: s.mean_soc_g_kg != null ? round1(s.mean_soc_g_kg / 10) : null,
      depth_to_bedrock_cm: null, // SoilGrids v2.0 has no bedrock-depth property
      confidence: 'moderate_low',
    }],
    sample_count: grid.samples?.length || 0,
    source_url: 'https://www.isric.org/explore/soilgrids',
    note: 'AGRASID/AGRASIS has no soil survey at this location (outside the agricultural survey extent, or no polygon here). SoilGrids is a 250 m modelled global product, not a field survey — drainage is intentionally not inferred, and a small parcel may not reflect real local heterogeneity.',
  };
}

function normalizeTexture(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase().replace(/\s+/g, '_');
}
function round1(x) { const n = Number(x); return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
