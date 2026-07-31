/**
 * Satellite vegetation indices + regional SOC context for the fecundity pipeline.
 *
 * Primary vegetation indices (user-requested open data):
 *   - NRCan Canada Wide Vegetation Maps (LAI, fCOVER, fAPAR)
 *     https://open.canada.ca/data/en/dataset/033ac0b8-653c-43b2-a843-171fa1c9ace4
 *   - Alberta Vegetation Inventory (AVI) Crown — structural inventory provenance
 *     https://open.canada.ca/data/en/dataset/64b0e73a-da5f-4f7f-bca1-b656b6e86c94
 *
 * Supplementary (when available):
 *   - Sentinel-2 L2A / Landsat / Sentinel-1 via Microsoft Planetary Computer
 *   - SoilGrids 2.0 REST (regional SOC ~250 m — low-moderate confidence only)
 *
 * Philosophy: satellite = screening / regional context.
 * Lab / calibrated drone = property-scale claims for carbon & biology.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIDENCE,
  buildSocClaim,
  buildIndexClaim,
  satelliteAttribution,
} from './satellite-confidence.js';
import {
  fetchVegetationIndices,
  vegetationAttribution,
} from './vegetation-indices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const DATA = 'https://planetarycomputer.microsoft.com/api/data/v1';
const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache', 'satellite');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const FETCH_TIMEOUT_MS = 45_000;
const MAX_S2_SCENES = 5;
const MAX_LANDSAT_YEARS = 5;

// ---------- Public API ----------

/**
 * Fetch property-scale vegetation indices + regional SOC context for an AOI.
 *
 * @param {object} aoi GeoJSON Polygon / MultiPolygon, or { west,south,east,north }, or ring [[lng,lat],...]
 * @param {{ startDate?: string, endDate?: string, years?: number, skipCache?: boolean, buffer_m?: number }} opts
 */
export async function fetchSatelliteIndices(aoi, opts = {}) {
  const geometry = normalizeGeometry(aoi, opts.buffer_m ?? 75);
  if (!geometry) {
    return emptyResult('invalid_aoi', 'Could not parse AOI geometry');
  }

  const endDate = opts.endDate || isoDate(new Date());
  const startDate =
    opts.startDate || isoDate(addMonths(new Date(endDate), -4)); // growing-season-ish window
  const years = opts.years ?? MAX_LANDSAT_YEARS;

  const cacheKey = hashKey({ geometry, startDate, endDate, years });
  if (!opts.skipCache) {
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, _meta: { ...cached._meta, cache: 'hit' } };
  }

  const bbox = bboxOf(geometry);
  const fallbacks = [];

  // Primary: NRCan LAI/fCOVER (+ AVI provenance). Secondary: PC + SoilGrids.
  const [nrcanVeg, s2, landsat, s1, soc] = await Promise.all([
    fetchVegetationIndices(bbox, { prefer_monthly: true }).catch((e) => {
      fallbacks.push(`NRCan vegetation failed: ${e.message}`);
      return null;
    }),
    fetchSentinel2Indices(geometry, startDate, endDate, fallbacks).catch((e) => {
      fallbacks.push(`Sentinel-2 failed: ${e.message}`);
      return null;
    }),
    fetchLandsatTrend(geometry, years, fallbacks).catch((e) => {
      fallbacks.push(`Landsat failed: ${e.message}`);
      return null;
    }),
    fetchSentinel1MoistureProxy(geometry, startDate, endDate, fallbacks).catch((e) => {
      fallbacks.push(`Sentinel-1 failed: ${e.message}`);
      return null;
    }),
    fetchRegionalSOC(geometry, bbox, fallbacks).catch((e) => {
      fallbacks.push(`SoilGrids failed: ${e.message}`);
      return null;
    }),
  ]);

  if (nrcanVeg?.fallbacks?.length) fallbacks.push(...nrcanVeg.fallbacks);

  const ndvi = s2?.ndvi || null;
  const ndre = s2?.ndre || null;
  const savi = s2?.savi || null;
  const ndmi = s2?.ndmi || null;

  // Prefer official NRCan fCOVER/LAI for cover %; fall back to S2 NDVI proxy
  const nrcanCover = nrcanVeg?.cover_pct;
  const ndviCoverPct =
    nrcanCover != null
      ? nrcanCover
      : ndvi?.median != null
        ? ndviToCoverPct(ndvi.median)
        : null;

  // Synthetic NDVI-like series for UI cards when NRCan is primary
  const nrcanVigorProxy =
    nrcanVeg?.vigor_index != null
      ? {
          median: nrcanVeg.vigor_index,
          mean: nrcanVeg.vigor_index,
          p10: nrcanVeg.fcover?.min ?? null,
          p90: nrcanVeg.fcover?.max ?? null,
          resolution_m: nrcanVeg.lai?.valid_count
            ? nrcanVeg.collection === 'monthly-vegetation-parameters-20m-v1'
              ? 20
              : 100
            : 100,
          confidence: 'medium-high',
          date: nrcanVeg.lai?.datetime || nrcanVeg.datetime || null,
          source: 'NRCan LAI/fCOVER (proxy scale)',
        }
      : null;

  const claims = [
    ...(nrcanVeg?.claims || []),
    buildIndexClaim('ndvi', ndvi),
    buildIndexClaim('ndre', ndre),
    buildIndexClaim('savi', savi),
    buildIndexClaim('ndmi', ndmi),
    buildSocClaim({ regional_soc: soc }),
  ];

  const mapLayers = [
    ...(nrcanVeg?.map_layers || []),
    ...buildMapLayerHints(s2, soc, bbox),
  ];

  const result = {
    available: !!(nrcanVeg?.available || ndvi || landsat || s1 || soc),
    // Primary open-Canada vegetation indices
    nrcan_vegetation: nrcanVeg,
    lai: nrcanVeg?.lai || null,
    fcover: nrcanVeg?.fcover || null,
    fapar: nrcanVeg?.fapar || null,
    avi: nrcanVeg?.avi || null,
    vegetation_vigor: nrcanVeg?.vegetation_vigor || null,
    // Secondary / legacy fields
    ndvi: ndvi || nrcanVigorProxy,
    ndre,
    savi,
    ndmi,
    soil_moisture_proxy: s1,
    vegetation_trend: landsat,
    regional_soc: soc,
    ndviCoverPct,
    claims,
    map_layers: mapLayers,
    attribution: [vegetationAttribution(), satelliteAttribution()].join(' '),
    aoi: { bbox, buffer_m: opts.buffer_m ?? 75 },
    date_range: { start: startDate, end: endDate },
    fallbacks,
    _meta: {
      method: 'nrcan-vegetation+avi+planetary-computer+soilgrids',
      cache: 'miss',
      cache_key: cacheKey,
      generated_at: new Date().toISOString(),
      primary_vegetation: 'NRCan LAI/fCOVER (033ac0b8) + AVI Crown provenance (64b0e73a)',
    },
  };

  writeCache(cacheKey, result);
  return result;
}

/**
 * Patch object ready to merge into generateFecundityReport rawData.
 */
export function toFecundityPatch(sat) {
  if (!sat?.available) {
    return {
      satellite: sat || null,
      ndviCoverPct: undefined,
      soilMoistureProxy: null,
      vegetationVigor: null,
      satelliteClaims: sat?.claims || [],
    };
  }

  const ndvi = sat.ndvi?.median ?? sat.nrcan_vegetation?.vigor_index ?? null;
  let vegetationVigor = sat.vegetation_vigor || sat.nrcan_vegetation?.vegetation_vigor || null;
  if (!vegetationVigor && ndvi != null) {
    if (ndvi >= 0.55) vegetationVigor = 'high';
    else if (ndvi >= 0.35) vegetationVigor = 'moderate';
    else if (ndvi >= 0.15) vegetationVigor = 'low';
    else vegetationVigor = 'very_low';
  }

  // Relative moisture: higher NDMI / lower S1 dry index → wetter
  let soilMoistureProxy = null;
  if (sat.soil_moisture_proxy?.relative_index != null) {
    soilMoistureProxy = sat.soil_moisture_proxy.relative_index;
  } else if (sat.ndmi?.median != null) {
    // NDMI as optical moisture proxy when SAR missing
    soilMoistureProxy = clamp01((sat.ndmi.median + 0.2) / 0.6);
  }

  return {
    satellite: sat,
    ndviCoverPct: sat.ndviCoverPct ?? sat.nrcan_vegetation?.cover_pct ?? undefined,
    soilMoistureProxy,
    vegetationVigor,
    ndviMedian: ndvi ?? null,
    ndviTrendSlope: sat.vegetation_trend?.slope_per_year ?? null,
    satelliteClaims: sat.claims || [],
    regionalSocContext: sat.regional_soc || null,
    lai: sat.lai?.mean ?? sat.nrcan_vegetation?.lai?.mean ?? null,
    fcover: sat.fcover?.mean ?? sat.nrcan_vegetation?.fcover?.mean ?? null,
    fapar: sat.fapar?.mean ?? sat.nrcan_vegetation?.fapar?.mean ?? null,
  };
}

// ---------- Sentinel-2 ----------

export async function fetchSentinel2Indices(geometry, startDate, endDate, fallbacks = []) {
  let scenes = await searchStac({
    collections: ['sentinel-2-l2a'],
    intersects: geometry,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 40 } },
    limit: 20,
    sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
  });

  if (!scenes.length) {
    // Alberta cloud cover — widen window / cloud threshold
    fallbacks.push('Sentinel-2: no scenes <40% cloud; retrying <70% over longer window');
    const widerStart = isoDate(addMonths(new Date(startDate), -4));
    scenes = await searchStac({
      collections: ['sentinel-2-l2a'],
      intersects: geometry,
      datetime: `${widerStart}T00:00:00Z/${endDate}T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: 70 } },
      limit: 20,
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });
  }

  // Exclude winter-heavy scenes (Alberta snow) when summer options exist
  const growing = scenes.filter((f) => {
    const m = monthOf(f.properties?.datetime);
    return m >= 5 && m <= 9;
  });
  const pool = growing.length ? growing : scenes;
  if (!growing.length && scenes.length) {
    fallbacks.push('Sentinel-2: no May–Sep scenes; using best available (snow risk flagged)');
  }

  const picked = pool.slice(0, MAX_S2_SCENES);
  if (!picked.length) return null;

  const series = [];
  for (const item of picked) {
    const stats = await itemIndexStats(item, geometry);
    if (stats) series.push(stats);
  }
  if (!series.length) return null;

  // Median composite across dates for each index
  const composite = (key) => {
    const vals = series.map((s) => s[key]).filter((v) => v && v.mean != null);
    if (!vals.length) return null;
    const means = vals.map((v) => v.mean);
    const stds = vals.map((v) => v.std).filter((x) => x != null);
    const meanStd = stds.length ? avg(stds) : 0.12;
    const med = median(means);
    const bestDate = series[0]?.date || null;
    return indexBlock(med, meanStd, {
      date: bestDate,
      dates: series.map((s) => s.date).filter(Boolean),
      resolution_m: 10,
      source: 'Sentinel-2 L2A (Planetary Computer)',
      confidence: series.length >= 2 ? CONFIDENCE.medium_high : CONFIDENCE.moderate,
      cloud_cover_pct: series[0]?.cloud_cover_pct ?? null,
      scenes_used: series.length,
      method: series.length >= 2 ? 'median_of_scene_means' : 'single_scene',
    });
  };

  return {
    ndvi: composite('ndvi'),
    ndre: composite('ndre'),
    savi: composite('savi'),
    ndmi: composite('ndmi'),
    scenes: series.map((s) => ({
      id: s.id,
      date: s.date,
      cloud_cover_pct: s.cloud_cover_pct,
    })),
    item_id: series[0]?.id,
    collection: 'sentinel-2-l2a',
  };
}

async function itemIndexStats(item, geometry) {
  const id = item.id;
  const cloud = item.properties?.['eo:cloud_cover'];
  const date = (item.properties?.datetime || '').slice(0, 10);

  const expressions = {
    ndvi: { expr: '(B08-B04)/(B08+B04)', assets: ['B04', 'B08'] },
    ndre: { expr: '(B08-B05)/(B08+B05)', assets: ['B05', 'B08'] },
    // L2A assets are reflectance × 10000 — use L≈5000 (≡ 0.5 in reflectance units)
    savi: { expr: '((B08-B04)/(B08+B04+5000))*(1.5)', assets: ['B04', 'B08'] },
    ndmi: { expr: '(B08-B11)/(B08+B11)', assets: ['B08', 'B11'] },
  };

  const out = { id, date, cloud_cover_pct: cloud != null ? round1(cloud) : null };
  for (const [key, { expr, assets }] of Object.entries(expressions)) {
    try {
      const st = await pcItemStatistics(id, 'sentinel-2-l2a', geometry, assets, expr);
      if (st) out[key] = st;
    } catch {
      /* skip index */
    }
  }
  if (!out.ndvi) return null;
  return out;
}

// ---------- Landsat trend ----------

export async function fetchLandsatTrend(geometry, years, fallbacks = []) {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - years);

  const annual = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const datetime = `${y}-06-01T00:00:00Z/${y}-09-15T23:59:59Z`;
    let scenes = await searchStac({
      collections: ['landsat-c2-l2'],
      intersects: geometry,
      datetime,
      query: { 'eo:cloud_cover': { lt: 50 } },
      limit: 8,
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    });
    // Landsat assets use different band names
    if (!scenes.length) continue;
    const item = scenes[0];
    try {
      // Collection 2 SR: red=red, nir08=nir
      const st = await pcItemStatistics(
        item.id,
        'landsat-c2-l2',
        geometry,
        ['red', 'nir08'],
        '(nir08-red)/(nir08+red)'
      );
      if (st?.mean != null) {
        annual.push({
          year: y,
          ndvi_mean: round3(st.mean),
          date: (item.properties?.datetime || '').slice(0, 10),
          cloud_cover_pct: item.properties?.['eo:cloud_cover'] ?? null,
        });
      }
    } catch {
      /* year skipped */
    }
  }

  if (annual.length < 2) {
    if (annual.length === 1) {
      fallbacks.push('Landsat: only one year available — no trend slope');
      return {
        annual,
        slope_per_year: null,
        source: 'Landsat 8/9 C2 L2 (Planetary Computer)',
        resolution_m: 30,
        confidence: CONFIDENCE.low_moderate,
      };
    }
    return null;
  }

  const slope = linearSlope(
    annual.map((a) => a.year),
    annual.map((a) => a.ndvi_mean)
  );

  return {
    annual,
    slope_per_year: round4(slope),
    source: 'Landsat 8/9 C2 L2 (Planetary Computer)',
    resolution_m: 30,
    confidence: annual.length >= 3 ? CONFIDENCE.moderate : CONFIDENCE.low_moderate,
    note: 'Multi-year summer NDVI slope — property screening only',
  };
}

// ---------- Sentinel-1 moisture proxy ----------

export async function fetchSentinel1MoistureProxy(geometry, startDate, endDate, fallbacks = []) {
  const scenes = await searchStac({
    collections: ['sentinel-1-rtc'],
    intersects: geometry,
    datetime: `${startDate}T00:00:00Z/${endDate}T23:59:59Z`,
    limit: 8,
    sortby: [{ field: 'datetime', direction: 'desc' }],
  });

  if (!scenes.length) {
    fallbacks.push('Sentinel-1 RTC: no scenes in window');
    return null;
  }

  // Prefer VV backscatter — lower γ0 often correlates with wetter bare soil (relative)
  const item = scenes[0];
  let st = null;
  try {
    st = await pcItemStatistics(item.id, 'sentinel-1-rtc', geometry, ['vv'], null);
  } catch {
    try {
      st = await pcItemStatistics(item.id, 'sentinel-1-rtc', geometry, ['VV'], null);
    } catch {
      fallbacks.push('Sentinel-1: statistics failed');
      return null;
    }
  }
  if (st?.mean == null) return null;

  // Map linear or dB mean into 0–1 relative wetness (heuristic, supplementary only)
  const mean = st.mean;
  // RTC often linear power; convert-ish to relative rank
  const relative = clamp01(1 - (Math.log10(Math.max(mean, 1e-4)) + 2) / 3);

  return {
    relative_index: round3(relative),
    backscatter_mean: round4(mean),
    date: (item.properties?.datetime || '').slice(0, 10),
    resolution_m: 10,
    source: 'Sentinel-1 RTC (Planetary Computer)',
    confidence: CONFIDENCE.low_moderate,
    note: 'Relative soil-moisture proxy from SAR backscatter — supplementary for Water lever only',
    scenes_considered: scenes.length,
  };
}

// ---------- Regional SOC (SoilGrids) ----------

export async function fetchRegionalSOC(geometry, bbox, fallbacks = []) {
  const b = bbox || bboxOf(geometry);
  let points = samplePointsInBbox(b, 5);
  // SoilGrids occasionally returns null at exact cells in Alberta — expand search
  if (b) {
    const pad = 0.15; // ~15 km
    points = points.concat(
      samplePointsInBbox(
        {
          west: b.west - pad,
          south: b.south - pad,
          east: b.east + pad,
          north: b.north + pad,
        },
        5
      )
    );
  }
  const samples = [];
  const seen = new Set();

  for (const [lon, lat] of points) {
    const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const url =
        `${SOILGRIDS}?lon=${lon}&lat=${lat}` +
        `&property=soc&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`;
      const data = await fetchJson(url, 20_000);
      const layer = data?.properties?.layers?.find((l) => l.name === 'soc');
      if (!layer?.depths) continue;
      // Convert dg/kg → g/kg (d_factor 10 per ISRIC docs)
      const dFactor = layer.unit_measure?.d_factor || 10;
      for (const d of layer.depths) {
        const raw = d.values?.mean;
        if (raw == null) continue;
        samples.push({
          lon,
          lat,
          depth: d.label,
          g_kg: round1(raw / dFactor),
        });
      }
      if (samples.length >= 6) break; // enough for regional context
    } catch {
      /* point skip */
    }
  }

  if (!samples.length) {
    fallbacks.push('SoilGrids: no SOC values returned for AOI sample points');
    return null;
  }

  // Prefer 0-5cm + 5-15cm surface means
  const surface = samples.filter((s) => s.depth === '0-5cm' || s.depth === '5-15cm');
  const pool = surface.length ? surface : samples;
  const vals = pool.map((s) => s.g_kg);

  // Collapse multi-depth hits to map markers (one point per lon/lat)
  const byPoint = new Map();
  for (const s of pool) {
    const key = `${s.lon.toFixed(4)},${s.lat.toFixed(4)}`;
    if (!byPoint.has(key)) {
      byPoint.set(key, { lon: s.lon, lat: s.lat, depths: {}, g_kg_vals: [] });
    }
    const p = byPoint.get(key);
    p.depths[s.depth] = s.g_kg;
    p.g_kg_vals.push(s.g_kg);
  }
  const sample_points = [...byPoint.values()].map((p, i) => ({
    id: `soc-${i + 1}`,
    lon: p.lon,
    lat: p.lat,
    soc_g_kg: round1(avg(p.g_kg_vals)),
    depths: p.depths,
  }));

  return {
    mean_g_kg: round1(avg(vals)),
    min_g_kg: round1(Math.min(...vals)),
    max_g_kg: round1(Math.max(...vals)),
    std_g_kg: round1(stdev(vals)),
    n_samples: vals.length,
    depth_labels: [...new Set(pool.map((s) => s.depth))],
    sample_points,
    source: 'SoilGrids 2.0 (ISRIC)',
    resolution_m: 250,
    confidence: CONFIDENCE.low_moderate,
    note: 'Regional context only – not property-scale. Mapped sample points are model estimates for screening.',
  };
}

// ---------- Planetary Computer helpers ----------

async function searchStac(body) {
  const res = await fetchJson(`${STAC}/search`, FETCH_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res?.features || [];
}

async function pcItemStatistics(itemId, collection, geometry, assets, expression) {
  const q = new URLSearchParams({ collection, item: itemId, asset_as_band: 'true' });
  for (const a of assets) q.append('assets', a);
  if (expression) q.set('expression', expression);

  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: geometry.type === 'Feature' ? geometry.geometry : geometry,
        properties: {},
      },
    ],
  };

  const res = await fetchJson(`${DATA}/item/statistics?${q.toString()}`, FETCH_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(fc),
  });

  const stats = res?.features?.[0]?.properties?.statistics;
  if (!stats) return null;

  // Expression key or first asset band
  const key = expression
    ? Object.keys(stats).find((k) => k.includes('B08') || k.includes('nir') || k === expression) ||
      Object.keys(stats)[0]
    : Object.keys(stats)[0];
  const s = stats[key] || Object.values(stats)[0];
  if (!s || s.mean == null) return null;
  return {
    mean: s.mean,
    min: s.min,
    max: s.max,
    std: s.std,
    median: s.median,
    count: s.count,
  };
}

function indexBlock(medianVal, std, meta) {
  const s = std ?? 0.12;
  return {
    median: round3(medianVal),
    p10: round3(medianVal - 1.28 * s),
    p90: round3(medianVal + 1.28 * s),
    mean: round3(medianVal),
    std: round3(s),
    date: meta.date,
    dates: meta.dates || null,
    resolution_m: meta.resolution_m,
    source: meta.source,
    confidence: meta.confidence,
    cloud_cover_pct: meta.cloud_cover_pct,
    scenes_used: meta.scenes_used,
    method: meta.method,
  };
}

function buildMapLayerHints(s2, soc, bbox) {
  const layers = [];
  if (s2?.item_id) {
    const expr = encodeURIComponent('(B08-B04)/(B08+B04)');
    const tilejson =
      `${DATA}/item/tilejson.json?collection=sentinel-2-l2a` +
      `&item=${encodeURIComponent(s2.item_id)}` +
      `&assets=B04&assets=B08&expression=${expr}&asset_as_band=true` +
      `&rescale=-0.2,0.9&colormap_name=rdylgn`;
    layers.push({
      id: 'ndvi',
      label: 'NDVI (Sentinel-2)',
      type: 'tilejson',
      url: tilejson,
      opacity: 0.65,
      confidence: CONFIDENCE.medium_high,
      resolution_m: 10,
      date: s2.ndvi?.date || null,
      source: 'Sentinel-2 L2A via Planetary Computer',
      legend_note: 'Green = higher vegetative vigor',
    });
  }
  if (soc?.mean_g_kg != null) {
    layers.push({
      id: 'regional_soc',
      label: 'Regional SOC (context only)',
      type: 'points',
      opacity: 0.85,
      confidence: CONFIDENCE.low_moderate,
      resolution_m: 250,
      source: soc.source,
      mean_g_kg: soc.mean_g_kg,
      min_g_kg: soc.min_g_kg,
      max_g_kg: soc.max_g_kg,
      sample_points: soc.sample_points || [],
      legend_note: 'SOC sample points (SoilGrids ~250 m) — regional model context only, not lab values',
      bbox,
    });
  }
  return layers;
}

// ---------- Geometry / cache / utils ----------

function normalizeGeometry(aoi, bufferM = 75) {
  if (!aoi) return null;
  if (aoi.type === 'Polygon' || aoi.type === 'MultiPolygon') {
    return bufferApprox(aoi, bufferM);
  }
  if (aoi.type === 'Feature' && aoi.geometry) {
    return bufferApprox(aoi.geometry, bufferM);
  }
  if (aoi.type === 'FeatureCollection' && aoi.features?.[0]?.geometry) {
    return bufferApprox(aoi.features[0].geometry, bufferM);
  }
  if (Array.isArray(aoi) && Array.isArray(aoi[0])) {
    // ring [[lng,lat],...]
    return bufferApprox({ type: 'Polygon', coordinates: [closeRing(aoi)] }, bufferM);
  }
  if (aoi.west != null) {
    const { west, south, east, north } = aoi;
    return bufferApprox(
      {
        type: 'Polygon',
        coordinates: [
          closeRing([
            [west, south],
            [east, south],
            [east, north],
            [west, north],
          ]),
        ],
      },
      bufferM
    );
  }
  if (aoi.latitude != null && aoi.longitude != null) {
    const d = 0.002; // ~200 m
    return {
      type: 'Polygon',
      coordinates: [
        closeRing([
          [aoi.longitude - d, aoi.latitude - d],
          [aoi.longitude + d, aoi.latitude - d],
          [aoi.longitude + d, aoi.latitude + d],
          [aoi.longitude - d, aoi.latitude + d],
        ]),
      ],
    };
  }
  return null;
}

/** Crude geographic buffer (~metres) for small AOIs — enough for STAC clip pad. */
function bufferApprox(geom, bufferM) {
  if (!bufferM || bufferM <= 0) return geom;
  const b = bboxOf(geom);
  if (!b) return geom;
  const latMid = (b.south + b.north) / 2;
  const dLat = bufferM / 111_320;
  const dLng = bufferM / (111_320 * Math.cos((latMid * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [
      closeRing([
        [b.west - dLng, b.south - dLat],
        [b.east + dLng, b.south - dLat],
        [b.east + dLng, b.north + dLat],
        [b.west - dLng, b.north + dLat],
      ]),
    ],
  };
}

function bboxOf(geom) {
  const coords = [];
  const walk = (c) => {
    if (typeof c[0] === 'number') coords.push(c);
    else c.forEach(walk);
  };
  if (geom?.coordinates) walk(geom.coordinates);
  if (!coords.length) return null;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
  };
}

function samplePointsInBbox(bbox, n = 5) {
  if (!bbox) return [];
  const { west, south, east, north } = bbox;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  const pts = [[cx, cy]];
  if (n >= 5) {
    pts.push(
      [(west + cx) / 2, (south + cy) / 2],
      [(east + cx) / 2, (south + cy) / 2],
      [(west + cx) / 2, (north + cy) / 2],
      [(east + cx) / 2, (north + cy) / 2]
    );
  }
  return pts.slice(0, n);
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring;
  return [...ring, a];
}

function ndviToCoverPct(ndvi) {
  // Map typical vegetated NDVI to canopy/cover %
  const pct = ((ndvi - 0.08) / 0.72) * 100;
  return Math.round(clamp(pct, 0, 100));
}

function emptyResult(code, message) {
  return {
    available: false,
    ndvi: null,
    ndre: null,
    savi: null,
    ndmi: null,
    soil_moisture_proxy: null,
    vegetation_trend: null,
    regional_soc: null,
    ndviCoverPct: null,
    claims: [buildSocClaim({})],
    map_layers: [],
    attribution: satelliteAttribution(),
    fallbacks: [`${code}: ${message}`],
    _meta: { method: 'none', generated_at: new Date().toISOString() },
  };
}

async function fetchJson(url, timeoutMs, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function readCache(key) {
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - (j._cached_at || 0) > CACHE_TTL_MS) return null;
    return j.payload;
  } catch {
    return null;
  }
}

function writeCache(key, payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify({ _cached_at: Date.now(), payload }),
      'utf8'
    );
  } catch {
    /* cache best-effort */
  }
}

function hashKey(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 24);
}

function linearSlope(xs, ys) {
  const n = xs.length;
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function monthOf(iso) {
  if (!iso) return 0;
  return Number(String(iso).slice(5, 7)) || 0;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function avg(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(a) {
  if (a.length < 2) return 0;
  const m = avg(a);
  return Math.sqrt(avg(a.map((x) => (x - m) ** 2)));
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// CLI entry when run directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const geojsonPath = get('--geojson');
  const start = get('--start');
  const end = get('--end');
  let aoi = { latitude: 53.55, longitude: -113.5 };
  if (geojsonPath && fs.existsSync(geojsonPath)) {
    aoi = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));
  }
  const lat = get('--lat');
  const lng = get('--lng');
  if (lat && lng) aoi = { latitude: Number(lat), longitude: Number(lng) };

  console.error('Fetching satellite indices…');
  const result = await fetchSatelliteIndices(aoi, {
    startDate: start || undefined,
    endDate: end || undefined,
    skipCache: args.includes('--no-cache'),
  });
  console.log(JSON.stringify(result, null, 2));
}
