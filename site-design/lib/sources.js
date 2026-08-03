/**
 * Live geospatial sources for Alberta bbox → site attributes.
 *
 * Elevation: Open-Meteo (Copernicus GLO-90) multi-point — free, reliable baseline.
 *            OpenTopoData SRTM30m fallback. HRDEM STAC coverage check (NRCan).
 * Hydrology: Alberta ArcGIS REST (AMWI, watersheds, wet areas, base water).
 * Soils:     Agricultural Land Resource Atlas (soil groups, erosion where available).
 * Climate:   Open-Meteo climate/forecast normals proxies + Alberta presets.
 */

import {
  esriEnvelope,
  sampleGrid,
  isInAlberta,
} from './geo.js';
import { analyzeTerrain } from './terrain.js';
import { ALBERTA_PRESETS } from './alberta-presets.js';
import { fetchSemanticTerrain } from './semantic-terrain.js';

const AB = 'https://geospatial.alberta.ca/titan/rest/services';
const FETCH_MS = 28_000;

export async function gatherSiteLayers({ ring, bbox, site_name }) {
  const centre = {
    longitude: (bbox.west + bbox.east) / 2,
    latitude: (bbox.south + bbox.north) / 2,
  };
  const alberta = isInAlberta(centre.latitude, centre.longitude);

  const [
    elevationResult,
    hrdem,
    wetlands,
    watershed,
    wetAreas,
    soils,
    semantic_terrain,
    climate,
  ] = await Promise.all([
    fetchElevationGrid(bbox),
    checkHrdemCoverage(bbox).catch((e) => ({ available: false, error: e.message })),
    alberta
      ? queryAmwi(bbox).catch((e) => ({ error: e.message, features: [] }))
      : Promise.resolve({ skipped: true, features: [] }),
    alberta
      ? queryWatershed(bbox).catch((e) => ({ error: e.message }))
      : Promise.resolve({ skipped: true }),
    alberta
      ? queryWetAreasCount(bbox).catch((e) => ({ error: e.message }))
      : Promise.resolve({ skipped: true }),
    alberta
      ? querySoilsAtlas(bbox).catch((e) => ({ error: e.message }))
      : Promise.resolve({ skipped: true }),
    fetchSemanticTerrain(bbox).catch((e) => ({ available: false, error: e.message, features: [] })),
    fetchClimate(centre).catch((e) => ({ error: e.message })),
  ]);

  const terrain = analyzeTerrain(elevationResult.elevations, {
    rows: elevationResult.rows,
    cols: elevationResult.cols,
    ...bbox,
  });

  const preset = nearestPreset(centre.latitude, centre.longitude);

  return {
    centre,
    alberta,
    elevation: elevationResult,
    terrain,
    hrdem,
    wetlands,
    watershed,
    wetAreas,
    soils,
    semantic_terrain,
    climate,
    preset,
    site_name: site_name || '',
  };
}

/* ---------- elevation ---------- */

async function fetchElevationGrid(bbox) {
  const { lats, lngs, rows, cols } = sampleGrid(bbox, 49);
  // Open-Meteo accepts parallel lat/lng arrays
  try {
    const url =
      `https://api.open-meteo.com/v1/elevation?` +
      `latitude=${lats.map((v) => v.toFixed(5)).join(',')}&` +
      `longitude=${lngs.map((v) => v.toFixed(5)).join(',')}`;
    const data = await fetchJson(url, 20_000);
    if (Array.isArray(data.elevation) && data.elevation.length === lats.length) {
      return {
        source: 'Open-Meteo Copernicus DEM GLO-90',
        source_url: 'https://open-meteo.com/en/docs/elevation-api',
        elevations: data.elevation.map((z) => (z == null ? null : Number(z))),
        rows,
        cols,
        sample_count: data.elevation.length,
      };
    }
  } catch {
    /* fall through */
  }

  // OpenTopoData SRTM — max 100 pts, rate limited; batch
  const elevations = new Array(lats.length).fill(null);
  const chunk = 90;
  for (let i = 0; i < lats.length; i += chunk) {
    const pair = [];
    for (let j = i; j < Math.min(i + chunk, lats.length); j++) {
      pair.push(`${lats[j].toFixed(5)},${lngs[j].toFixed(5)}`);
    }
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${pair.join('|')}`;
    const data = await fetchJson(url, 25_000);
    if (data.status !== 'OK' || !Array.isArray(data.results)) {
      throw new Error('Elevation services unavailable');
    }
    data.results.forEach((r, k) => {
      elevations[i + k] = r.elevation;
    });
    if (i + chunk < lats.length) await sleep(1100);
  }
  return {
    source: 'OpenTopoData SRTM 30m',
    source_url: 'https://www.opentopodata.org/',
    elevations,
    rows,
    cols,
    sample_count: elevations.filter((z) => z != null).length,
  };
}

async function checkHrdemCoverage(bbox) {
  // LiDAR projects + national HRDEM mosaic (open.canada.ca/dataset/0fe65119-…)
  const url =
    `https://datacube.services.geo.ca/stac/api/search?` +
    `collections=hrdem-lidar,hrdem-mosaic-1m,hrdem-mosaic-2m` +
    `&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&limit=8`;
  const data = await fetchJson(url, 15_000);
  const items = data.features || [];
  const collections = [...new Set(items.map((f) => f.collection).filter(Boolean))];
  return {
    available: items.length > 0,
    count: items.length,
    projects: items.map((f) => f.id).slice(0, 5),
    collections,
    dataset_url:
      'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b',
    wms_url: 'https://datacube.services.geo.ca/ows/elevation',
    source_url:
      'https://datacube.services.geo.ca/stac/api/search?collections=hrdem-lidar,hrdem-mosaic-1m,hrdem-mosaic-2m',
    note: items.length
      ? `HRDEM coverage present (${collections.join(', ') || 'tiles'}) — hillshade available on maps.`
      : 'No HRDEM mosaic/LiDAR tile in STAC for this box; using provincial contours + regional DEM baseline.',
  };
}

/* ---------- Alberta ArcGIS ---------- */

async function queryAmwi(bbox) {
  const url = `${AB}/environment/alberta_merged_wetland_inventory/MapServer/3/query`;
  const data = await arcgisQuery(url, bbox, 40);
  const classes = new Map();
  for (const f of data.features || []) {
    const c = f.attributes?.CWCS_Class || f.attributes?.CLASS || 'unknown';
    classes.set(c, (classes.get(c) || 0) + 1);
  }
  const ranked = [...classes.entries()].sort((a, b) => b[1] - a[1]);
  // Map CWCS → simplified class for rules (I–V / descriptive)
  const top = ranked[0]?.[0] || null;
  const wetland_class = mapCwcsToClass(top);
  return {
    features: (data.features || []).slice(0, 25).map((f) => f.attributes),
    counts: Object.fromEntries(ranked),
    wetland_class,
    present: ranked.length > 0,
    source_name: 'Alberta Merged Wetland Inventory (AMWI)',
    source_url: `${AB}/environment/alberta_merged_wetland_inventory/MapServer`,
  };
}

function mapCwcsToClass(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  // CWCS classes often: Bog, Fen, Marsh, Swamp, Shallow Open Water, Open Water…
  // Ruleset expects Water Act sensitivity — any true wetland class triggers review
  if (n.includes('none') || n === 'upland') return null;
  if (n.includes('marsh')) return 'III';
  if (n.includes('swamp')) return 'III';
  if (n.includes('fen') || n.includes('bog')) return 'IV';
  if (n.includes('open water') || n.includes('shallow')) return 'V';
  if (/^[ivx]+$/i.test(name.trim())) return name.trim().toUpperCase();
  return name; // keep descriptive — rules treat non-null as present
}

async function queryWatershed(bbox) {
  const url = `${AB}/environment/alberta_watersheds/MapServer/3/query`;
  const data = await arcgisQuery(url, bbox, 5);
  const a = data.features?.[0]?.attributes || {};
  return {
    watershed: a.AENV_MAJOR || a.NAME || a.BASIN_NAME || null,
    sub_continental: a.SUB_CONTNL || null,
    continental: a.CONT_BASIN || null,
    source_name: 'Watersheds of Alberta (Major River Basins)',
    source_url: `${AB}/environment/alberta_watersheds/MapServer`,
  };
}

async function queryWetAreasCount(bbox) {
  // Predicted streams — returnCountOnly; short timeout (layer is often slow)
  const url = `${AB}/environment/wet_areas_mapping_predicted_streams/MapServer/0/query`;
  const body = new URLSearchParams({
    geometry: esriEnvelope(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnCountOnly: 'true',
    f: 'json',
  });
  try {
    const data = await fetchJsonPost(url, body, 8_000);
    return {
      predicted_stream_count: data.count ?? data.Count ?? null,
      source_name: 'Wet Areas Mapping — Predicted Streams',
      source_url: `${AB}/environment/wet_areas_mapping_predicted_streams/MapServer`,
    };
  } catch (e) {
    return {
      predicted_stream_count: null,
      skipped: true,
      error: e.message,
      source_name: 'Wet Areas Mapping — Predicted Streams',
      source_url: `${AB}/environment/wet_areas_mapping_predicted_streams/MapServer`,
    };
  }
}

async function querySoilsAtlas(bbox) {
  const groupUrl = `${AB}/agriculture/agricultural_land_resource_atlas/MapServer/17/query`;
  const groupData = await arcgisQuery(groupUrl, bbox, 5).catch(() => ({ features: [] }));
  const group = groupData.features?.[0]?.attributes?.SOIL_NAME || null;

  // Texture layer often sparse; try identify-style query
  let texture = null;
  try {
    const texUrl = `${AB}/agriculture/agricultural_land_resource_atlas/MapServer/18/query`;
    const texData = await arcgisQuery(texUrl, bbox, 5);
    const a = texData.features?.[0]?.attributes || {};
    texture =
      a.TEXTURE ||
      a.TEXT_CLASS ||
      a.DESCRIPTN ||
      a.SOIL_TEXT ||
      null;
    if (texture && !String(texture).trim()) texture = null;
  } catch {
    /* optional */
  }

  let erosion = null;
  try {
    // Water erosion risk layer 21 sometimes queryable
    const erUrl = `${AB}/agriculture/agricultural_land_resource_atlas/MapServer/21/query`;
    const erData = await arcgisQuery(erUrl, bbox, 3);
    const a = erData.features?.[0]?.attributes || {};
    erosion = a.RISK || a.CLASS || a.DESCRIPTN || a.EROSION || null;
  } catch {
    /* optional */
  }

  return {
    soil_group: group,
    texture_raw: texture,
    texture: mapTexture(texture, group),
    erosion_raw: erosion,
    erosion_risk: mapErosionLabel(erosion),
    source_name: 'Agricultural Land Resource Atlas of Alberta',
    source_url: `${AB}/agriculture/agricultural_land_resource_atlas/MapServer`,
  };
}

function mapTexture(raw, group) {
  if (raw) {
    const t = String(raw).toLowerCase();
    if (t.includes('sand') && t.includes('loam')) return 'sandy_loam';
    if (t.includes('silt') && t.includes('loam')) return 'silt_loam';
    if (t.includes('clay') && t.includes('loam')) return 'clay_loam';
    if (t.includes('loamy sand')) return 'loamy_sand';
    if (t.includes('sand')) return 'sand';
    if (t.includes('clay')) return 'clay';
    if (t.includes('loam')) return 'loam';
    if (t.includes('organic') || t.includes('peat')) return 'organic';
  }
  // Infer coarse texture from soil group name
  if (group) {
    const g = group.toLowerCase();
    if (g.includes('chernozem')) return 'loam';
    if (g.includes('solonetz')) return 'clay_loam';
    if (g.includes('luvisol')) return 'clay_loam';
    if (g.includes('brunisol')) return 'sandy_loam';
    if (g.includes('organic') || g.includes('gleysol')) return 'organic';
  }
  return 'loam';
}

function mapErosionLabel(raw) {
  if (!raw) return null;
  const t = String(raw).toLowerCase();
  if (t.includes('high') || t.includes('severe')) return 'high';
  if (t.includes('mod')) return 'moderate';
  if (t.includes('low') || t.includes('slight')) return 'low';
  return null;
}

async function arcgisQuery(url, bbox, recordCount = 10) {
  const body = new URLSearchParams({
    geometry: esriEnvelope(bbox),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
    resultRecordCount: String(recordCount),
  });
  const data = await fetchJsonPost(url, body, FETCH_MS);
  if (data.error) {
    throw new Error(data.error.message || 'ArcGIS query failed');
  }
  return data;
}

/* ---------- climate ---------- */

async function fetchClimate(centre) {
  // Open-Meteo archive for recent climate-ish stats + forecast wind
  const { latitude: lat, longitude: lng } = centre;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant` +
    `&forecast_days=1&past_days=92&timezone=America%2FEdmonton`;
  let windDir = null;
  let precipProxy = null;
  try {
    const data = await fetchJson(url, 18_000);
    const dirs = data.daily?.wind_direction_10m_dominant || [];
    const validDirs = dirs.filter((d) => d != null);
    if (validDirs.length) {
      const meanDir = validDirs.reduce((a, b) => a + b, 0) / validDirs.length;
      windDir = degToCompass(meanDir);
    }
    const precip = (data.daily?.precipitation_sum || []).filter((p) => p != null);
    if (precip.length) {
      const sum = precip.reduce((a, b) => a + b, 0);
      // Extrapolate 92 days → annual rough proxy
      precipProxy = Math.round((sum / precip.length) * 365);
    }
  } catch {
    /* use preset */
  }

  // 30-year (1991–2020) monthly precipitation normals from the Open-Meteo
  // climate archive. Replaces the 92-day extrapolation when available.
  const normals = await fetchPrecipitationNormals(lat, lng).catch(() => null);

  const preset = nearestPreset(lat, lng);
  return {
    plant_hardiness_zone: preset?.climate?.plant_hardiness_zone || '3a',
    frost_free_days: preset?.climate?.frost_free_days || 120,
    growing_degree_days_base5: preset?.climate?.growing_degree_days_base5 || 1300,
    prevailing_wind_direction:
      windDir || preset?.climate?.prevailing_wind_direction || 'NW',
    chinook_exposure: !!preset?.climate?.chinook_exposure,
    annual_precipitation_mm:
      normals?.annual_mm ||
      precipProxy ||
      preset?.hydrology?.annual_precipitation_mm ||
      450,
    monthly_precipitation_mm: normals?.monthly || null,
    precipitation_normals_years: normals?.years || null,
    seasonal_distribution: 'summer_peak',
    preset_id: preset?.id || null,
    source_name: 'Open-Meteo 30-year normals + Expanding Edge Alberta climate presets',
    source_url: 'https://open-meteo.com/',
  };
}

/**
 * Fetch 30-year (1991–2020) monthly precipitation normals from the
 * Open-Meteo climate archive. Returns average monthly totals (mm) and the
 * mean annual total, or null when the archive is unavailable.
 */
async function fetchPrecipitationNormals(lat, lng) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
    `&start_date=1991-01-01&end_date=2020-12-31&daily=precipitation_sum` +
    `&timezone=America%2FEdmonton`;
  const data = await fetchJson(url, 18_000);
  const times = data?.daily?.time || [];
  const sums = data?.daily?.precipitation_sum || [];
  if (!times.length || times.length !== sums.length) return null;

  const monthSums = Array(12).fill(0);
  const monthCounts = Array(12).fill(0);
  let annualSum = 0;
  let annualCount = 0;
  for (let i = 0; i < times.length; i++) {
    const v = sums[i];
    if (v == null || !Number.isFinite(v)) continue;
    const m = Number(String(times[i]).slice(5, 7));
    if (m < 1 || m > 12) continue;
    monthSums[m - 1] += v;
    monthCounts[m - 1] += 1;
    annualSum += v;
    annualCount += 1;
  }
  if (!annualCount) return null;

  const labels = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthly = {};
  for (let i = 0; i < 12; i++) {
    if (monthCounts[i] > 0) {
      monthly[labels[i]] = Math.round((monthSums[i] / monthCounts[i]) * 10) / 10;
    }
  }
  return {
    monthly,
    annual_mm: Math.round((annualSum / annualCount) * 365 * 10) / 10,
    years: '1991-2020',
  };
}

function degToCompass(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function nearestPreset(lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const p of ALBERTA_PRESETS) {
    if (p.latitude == null || p.longitude == null) continue;
    const d =
      (p.latitude - lat) ** 2 + (p.longitude - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/* ---------- http ---------- */

async function fetchJson(url, timeoutMs = FETCH_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonPost(url, body, timeoutMs = FETCH_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
