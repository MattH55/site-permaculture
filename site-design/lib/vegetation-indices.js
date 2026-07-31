/**
 * Vegetation indices from Government of Canada / Alberta open data.
 *
 * Primary biophysical indices (NRCan / CCMEO Data Cube):
 *   Canada Wide Vegetation Maps from Medium Resolution Satellite Imagery
 *   https://open.canada.ca/data/en/dataset/033ac0b8-653c-43b2-a843-171fa1c9ace4
 *   STAC: vegetation (peak-season 100 m) + monthly-vegetation-parameters-20m-v1 (20 m)
 *   WMS/WCS: https://datacube.services.geo.ca/ows/vegetation
 *   Products: LAI, fCOVER, fAPAR from Sentinel-2 (CCRS algorithms)
 *
 * Structural inventory (Alberta):
 *   Alberta Vegetation Inventory (AVI) Crown
 *   https://open.canada.ca/data/en/dataset/64b0e73a-da5f-4f7f-bca1-b656b6e86c94
 *   Photo-based Crown forest inventory (FGDB download). Live province-wide
 *   FeatureServer is not published; we attach provenance + soft coverage notes.
 *
 * Encoding (uint8 COGs, nodata 255) — SNAP / CCRS style:
 *   LAI physical ≈ DN / 10
 *   fCOVER physical ≈ DN / 100  (0–1 fraction of green cover)
 *   fAPAR physical ≈ DN / 100  (0–1)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromUrl } from 'geotiff';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache', 'vegetation');
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

const STAC_API = 'https://datacube.services.geo.ca/stac/api';
const VEGETATION_WMS = 'https://datacube.services.geo.ca/ows/vegetation';
const NRCAN_DATASET =
  'https://open.canada.ca/data/en/dataset/033ac0b8-653c-43b2-a843-171fa1c9ace4';
const AVI_DATASET =
  'https://open.canada.ca/data/en/dataset/64b0e73a-da5f-4f7f-bca1-b656b6e86c94';
const AVI_OPEN_AB =
  'https://open.alberta.ca/opendata/64b0e73a-da5f-4f7f-bca1-b656b6e86c94';
const AVI_STANDARDS = 'https://www.alberta.ca/vegetation-inventory-standards.aspx';
const AVI_FGDB =
  'https://extranet.gov.ab.ca/srd/geodiscover/srd_pub/biota/AlbertaVegetationInventoryCrown.zip';

const NODATA = 255;
const FETCH_TIMEOUT_MS = 28_000;

// ---------- Public API ----------

/**
 * @param {{ west:number,south:number,east:number,north:number }|object} aoi
 * @param {{ skipCache?: boolean, prefer_monthly?: boolean }} [opts]
 */
export async function fetchVegetationIndices(aoi, opts = {}) {
  const bbox = normalizeBbox(aoi);
  if (!bbox) {
    return emptyResult('invalid_aoi', 'Could not parse AOI for vegetation indices');
  }

  const cacheKey = hashKey({ bbox, v: 2 });
  if (!opts.skipCache) {
    const cached = readCache(cacheKey);
    if (cached) return { ...cached, _meta: { ...cached._meta, cache: 'hit' } };
  }

  const centre = {
    longitude: (bbox.west + bbox.east) / 2,
    latitude: (bbox.south + bbox.north) / 2,
  };
  const fallbacks = [];

  const [nrcan, avi] = await Promise.all([
    sampleNrcanVegetation(bbox, centre, opts, fallbacks).catch((e) => {
      fallbacks.push(`NRCan vegetation failed: ${e.message}`);
      return null;
    }),
    assessAviCrown(bbox, centre, fallbacks).catch((e) => {
      fallbacks.push(`AVI assess failed: ${e.message}`);
      return null;
    }),
  ]);

  const lai = nrcan?.lai ?? null;
  const fcover = nrcan?.fcover ?? null;
  const fapar = nrcan?.fapar ?? null;

  // Cover % and vigor from official biophysical products
  const coverPct =
    fcover?.mean != null
      ? round1(clamp(fcover.mean * 100, 0, 100))
      : lai?.mean != null
        ? round1(clamp((lai.mean / 6) * 100, 0, 100))
        : null;

  let vegetationVigor = null;
  if (lai?.mean != null) {
    // Prairie / parkland LAI is typically lower than dense forest
    if (lai.mean >= 3.0) vegetationVigor = 'high';
    else if (lai.mean >= 1.2) vegetationVigor = 'moderate';
    else if (lai.mean >= 0.5) vegetationVigor = 'low';
    else vegetationVigor = 'very_low';
  } else if (fcover?.mean != null) {
    if (fcover.mean >= 0.55) vegetationVigor = 'high';
    else if (fcover.mean >= 0.3) vegetationVigor = 'moderate';
    else if (fcover.mean >= 0.1) vegetationVigor = 'low';
    else vegetationVigor = 'very_low';
  }

  // Proxy NDVI-like 0–1 for downstream code that still expects ndviMedian
  const vigorIndex =
    fapar?.mean != null
      ? round3(fapar.mean)
      : fcover?.mean != null
        ? round3(fcover.mean)
        : lai?.mean != null
          ? round3(clamp(lai.mean / 6, 0, 1))
          : null;

  const result = {
    available: !!(lai || fcover || fapar || avi?.available),
    source: 'NRCan Canada-wide vegetation biophysical parameters + AVI Crown provenance',
    collection: nrcan?.collection || null,
    resolution_m: nrcan?.resolution_m || null,
    datasets: {
      nrcan_vegetation: NRCAN_DATASET,
      avi_crown: AVI_DATASET,
      avi_open_alberta: AVI_OPEN_AB,
      wms: VEGETATION_WMS,
    },
    lai,
    fcover,
    fapar,
    cover_pct: coverPct,
    vegetation_vigor: vegetationVigor,
    vigor_index: vigorIndex,
    avi,
    map_layers: buildWmsLayers(bbox),
    attribution: vegetationAttribution(),
    aoi: { bbox, centre },
    fallbacks,
    claims: buildClaims({ lai, fcover, fapar, coverPct, avi }),
    _meta: {
      method: 'nrcan-stac-cog+avi-provenance',
      cache: 'miss',
      cache_key: cacheKey,
      generated_at: new Date().toISOString(),
    },
  };

  writeCache(cacheKey, result);
  return result;
}

/**
 * Patch for fecundity / satellite merge.
 */
export function toVegetationFecundityPatch(veg) {
  if (!veg?.available) {
    return {
      vegetation_indices: veg || null,
      ndviCoverPct: undefined,
      vegetationVigor: null,
      ndviMedian: null,
      satelliteClaims: veg?.claims || [],
    };
  }
  return {
    vegetation_indices: veg,
    ndviCoverPct: veg.cover_pct ?? undefined,
    vegetationVigor: veg.vegetation_vigor,
    ndviMedian: veg.vigor_index,
    // Not Landsat trend — leave null so multi-year trend card stays empty unless PC provides it
    ndviTrendSlope: null,
    satelliteClaims: veg.claims || [],
  };
}

export function vegetationAttribution() {
  return (
    'Vegetation indices: Natural Resources Canada — Canada Wide Vegetation Maps from Medium Resolution Satellite Imagery ' +
    '(LAI, fCOVER, fAPAR; Sentinel-2 / CCRS). Open Government Licence – Canada. ' +
    'Structural inventory reference: Alberta Vegetation Inventory (AVI) Crown — Open Government Licence – Alberta.'
  );
}

// ---------- NRCan COG sampling ----------

async function sampleNrcanVegetation(bbox, centre, opts, fallbacks) {
  // Prefer peak-season 100 m collection (fast); optionally enrich with monthly 20 m
  const peak = await loadPeakSeasonAssets(fallbacks);
  if (!peak?.LAI && !peak?.fCOVER) {
    // Fall back to latest monthly item
    const monthly = await loadMonthlyAssets(fallbacks);
    if (!monthly) return null;
    return sampleAssetsAt(monthly, centre, bbox, {
      collection: 'monthly-vegetation-parameters-20m-v1',
      resolution_m: 20,
    });
  }

  let result = await sampleAssetsAt(peak, centre, bbox, {
    collection: 'vegetation',
    resolution_m: 100,
    year: peak.year || null,
  });

  if (opts.prefer_monthly !== false) {
    // If peak season is sparse or zero, try monthly 20 m for property scale
    const sparse =
      (result?.lai?.valid_count || 0) < 3 && (result?.fcover?.valid_count || 0) < 3;
    if (sparse || opts.prefer_monthly === true) {
      try {
        const monthly = await loadMonthlyAssets(fallbacks);
        if (monthly) {
          const m = await sampleAssetsAt(monthly, centre, bbox, {
            collection: 'monthly-vegetation-parameters-20m-v1',
            resolution_m: 20,
          });
          if (m && ((m.lai?.valid_count || 0) >= (result?.lai?.valid_count || 0))) {
            result = m;
          }
        }
      } catch (e) {
        fallbacks.push(`Monthly vegetation skipped: ${e.message}`);
      }
    }
  }

  return result;
}

async function loadPeakSeasonAssets(fallbacks) {
  const url = `${STAC_API}/collections/vegetation/items?limit=5`;
  const data = await fetchJson(url, FETCH_TIMEOUT_MS);
  const features = data?.features || [];
  if (!features.length) {
    fallbacks.push('No peak-season vegetation STAC items');
    return null;
  }
  // Prefer newest year
  features.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const f = features[0];
  return {
    year: String(f.id || '').match(/20\d{2}/)?.[0] || null,
    id: f.id,
    LAI: f.assets?.LAI?.href || null,
    fCOVER: f.assets?.fCOVER?.href || null,
    fAPAR: f.assets?.fAPAR?.href || null,
    datetime: f.properties?.datetime || f.properties?.start_datetime || null,
  };
}

async function loadMonthlyAssets(fallbacks) {
  // Latest item in monthly collection (items sorted by API)
  const url = `${STAC_API}/collections/monthly-vegetation-parameters-20m-v1/items?limit=3`;
  const data = await fetchJson(url, FETCH_TIMEOUT_MS);
  const features = data?.features || [];
  if (!features.length) {
    fallbacks.push('No monthly vegetation STAC items');
    return null;
  }
  // Prefer summer months if multiple
  const ranked = [...features].sort((a, b) => {
    const ma = monthScore(a.id || a.properties?.datetime);
    const mb = monthScore(b.id || b.properties?.datetime);
    return mb - ma;
  });
  const f = ranked[0];
  return {
    year: String(f.id || '').match(/20\d{2}/)?.[0] || null,
    id: f.id,
    LAI: f.assets?.LAI?.href || f.assets?.['LAI-raw']?.href || null,
    fCOVER: f.assets?.fCOVER?.href || f.assets?.['fCOVER-raw']?.href || null,
    fAPAR: f.assets?.fAPAR?.href || f.assets?.['fAPAR-raw']?.href || null,
    datetime: f.properties?.datetime || null,
  };
}

function monthScore(id) {
  const s = String(id || '');
  // Prefer June–August for Alberta growing season
  if (/0[6-8]|-0[6-8]|20\d{2}0[6-8]/.test(s)) return 3;
  if (/05|09/.test(s)) return 2;
  return 1;
}

async function sampleAssetsAt(assets, centre, bbox, meta) {
  const [x, y] = lonLatToEpsg3979(centre.longitude, centre.latitude);
  const halfPadM = Math.max(
    150,
    haversineM(bbox.south, bbox.west, bbox.north, bbox.east) * 0.15
  );

  const [laiDn, fcoverDn, faparDn] = await Promise.all([
    assets.LAI ? sampleCogWindow(assets.LAI, x, y, halfPadM) : null,
    assets.fCOVER ? sampleCogWindow(assets.fCOVER, x, y, halfPadM) : null,
    assets.fAPAR ? sampleCogWindow(assets.fAPAR, x, y, halfPadM) : null,
  ]);

  const lai = summarizeBand(laiDn, 'lai');
  const fcover = summarizeBand(fcoverDn, 'fcover');
  const fapar = summarizeBand(faparDn, 'fapar');
  // Attach product metadata for UI
  for (const band of [lai, fcover, fapar]) {
    if (!band) continue;
    band.resolution_m = meta.resolution_m;
    band.date = assets.datetime || assets.year || null;
    band.collection = meta.collection;
  }
  return {
    collection: meta.collection,
    resolution_m: meta.resolution_m,
    year: assets.year,
    item_id: assets.id,
    datetime: assets.datetime,
    lai,
    fcover,
    fapar,
  };
}

/**
 * Sample a COG around projected (x,y) metres EPSG:3979.
 * @returns {number[]|null} valid DN values
 */
async function sampleCogWindow(href, x, y, halfPadM) {
  const tiff = await fromUrl(href, {
    allowFullFile: false,
    blockSize: 65536,
  });
  const img = await tiff.getImage();
  const origin = img.getOrigin();
  const res = img.getResolution();
  const resX = res[0];
  const resY = res[1]; // negative
  const w = img.getWidth();
  const h = img.getHeight();

  const colC = Math.floor((x - origin[0]) / resX);
  const rowC = Math.floor((y - origin[1]) / resY);
  const padCols = Math.max(1, Math.ceil(halfPadM / Math.abs(resX)));
  const padRows = Math.max(1, Math.ceil(halfPadM / Math.abs(resY)));

  let c0 = clampInt(colC - padCols, 0, w - 1);
  let r0 = clampInt(rowC - padRows, 0, h - 1);
  let c1 = clampInt(colC + padCols + 1, 1, w);
  let r1 = clampInt(rowC + padRows + 1, 1, h);
  if (c1 <= c0) c1 = Math.min(w, c0 + 1);
  if (r1 <= r0) r1 = Math.min(h, r0 + 1);

  // Cap window to keep requests light
  const maxSide = 48;
  if (c1 - c0 > maxSide) {
    const mid = Math.floor((c0 + c1) / 2);
    c0 = mid - Math.floor(maxSide / 2);
    c1 = c0 + maxSide;
  }
  if (r1 - r0 > maxSide) {
    const mid = Math.floor((r0 + r1) / 2);
    r0 = mid - Math.floor(maxSide / 2);
    r1 = r0 + maxSide;
  }

  const rasters = await img.readRasters({ window: [c0, r0, c1, r1] });
  const band = rasters[0];
  const vals = [];
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if (v != null && v !== NODATA && Number.isFinite(v)) vals.push(v);
  }
  return vals;
}

function summarizeBand(dns, kind) {
  if (!dns?.length) return null;
  const physical = dns
    .map((dn) => decodeDn(dn, kind))
    .filter((v) => v != null && Number.isFinite(v));
  if (!physical.length) return null;
  physical.sort((a, b) => a - b);
  const mean = physical.reduce((a, b) => a + b, 0) / physical.length;
  const median = physical[Math.floor(physical.length / 2)];
  const min = physical[0];
  const max = physical[physical.length - 1];
  return {
    mean: round3(mean),
    median: round3(median),
    min: round3(min),
    max: round3(max),
    valid_count: physical.length,
    unit: kind === 'lai' ? 'm²/m²' : 'fraction',
    encoding: kind === 'lai' ? 'DN/10' : 'DN/100',
    confidence: 'medium-high',
    source: 'NRCan vegetation biophysical COG',
  };
}

function decodeDn(dn, kind) {
  if (dn == null || dn === NODATA || !Number.isFinite(dn)) return null;
  if (kind === 'lai') {
    // DN/10 → LAI; clamp extreme
    const v = dn / 10;
    if (v < 0 || v > 12) return null;
    return v;
  }
  // fCOVER / fAPAR as fraction
  const v = dn / 100;
  if (v < 0 || v > 1.2) return null;
  return clamp(v, 0, 1);
}

// ---------- AVI Crown ----------

/**
 * AVI Crown is distributed as FGDB only (no province-wide public FeatureServer).
 * We record provenance and a soft coverage flag for forested natural regions.
 */
async function assessAviCrown(bbox, centre, fallbacks) {
  // Soft regional hint via Natural Subregions (public Titan)
  let naturalSubregion = null;
  try {
    naturalSubregion = await queryNaturalSubregion(centre);
  } catch (e) {
    fallbacks.push(`Natural subregion: ${e.message}`);
  }

  const forestish = isForestishSubregion(naturalSubregion?.name);

  return {
    available: false, // polygon inventory not live-queried
    live_query: false,
    dataset_url: AVI_DATASET,
    open_alberta_url: AVI_OPEN_AB,
    standards_url: AVI_STANDARDS,
    fgdb_download: AVI_FGDB,
    note:
      'Alberta Vegetation Inventory (AVI) Crown is a photo-based digital forest inventory for Crown land ' +
      '(species, height, density, age). Full province coverage is distributed as FGDB, not a live parcel API. ' +
      'Biophysical LAI/fCOVER from NRCan provide vegetation indices for any parcel; AVI is the structural ' +
      'inventory reference for design review on forested Crown holdings.',
    natural_subregion: naturalSubregion,
    likely_relevant: forestish,
    licence: 'Open Government Licence – Alberta',
  };
}

async function queryNaturalSubregion(centre) {
  const base =
    'https://geospatial.alberta.ca/titan/rest/services/biota/natural_subregions_alberta_2005/MapServer/0/query';
  const params = new URLSearchParams({
    geometry: JSON.stringify({
      x: centre.longitude,
      y: centre.latitude,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  const data = await fetchJson(`${base}?${params}`, 12_000);
  const attrs = data?.features?.[0]?.attributes;
  if (!attrs) return null;
  const name =
    attrs.NSRNAME ||
    attrs.NATURAL_SUBREGION ||
    attrs.NAME ||
    attrs.NSR_NAME ||
    attrs.Natural_Subregion ||
    null;
  const region =
    attrs.NRNAME || attrs.NATURAL_REGION || attrs.NATURAL_REGION_NAME || null;
  return {
    name: name || null,
    natural_region: region || null,
    source: 'Alberta Natural Subregions 2005 (Titan)',
  };
}

function isForestishSubregion(name) {
  if (!name) return false;
  return /boreal|foothills|montane|subalpine|parkland|shield|mixedwood|dry.?mixed|central.?mixed/i.test(
    String(name)
  );
}

// ---------- Map layers ----------

function buildWmsLayers(bbox) {
  return [
    {
      id: 'nrcan_lai',
      label: 'NRCan LAI (peak season)',
      type: 'wms',
      url: VEGETATION_WMS,
      layers: 'LAI',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.65,
      attribution: 'NRCan vegetation LAI',
      dataset: NRCAN_DATASET,
      legend_note: 'Higher LAI = denser green canopy (peak-season composite)',
      bbox,
    },
    {
      id: 'nrcan_fcover',
      label: 'NRCan fCOVER',
      type: 'wms',
      url: VEGETATION_WMS,
      layers: 'fCOVER',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.65,
      attribution: 'NRCan vegetation fCOVER',
      dataset: NRCAN_DATASET,
      legend_note: 'Fraction of green vegetation cover',
      bbox,
    },
  ];
}

function buildClaims({ lai, fcover, fapar, coverPct, avi }) {
  const claims = [];
  if (lai?.mean != null) {
    claims.push({
      field: 'lai',
      value: lai.mean,
      unit: 'm²/m²',
      confidence: 'medium-high',
      allowed_claim: `Peak-season leaf area index ≈ ${lai.mean} (NRCan Sentinel-2 biophysical product)`,
      source: NRCAN_DATASET,
    });
  }
  if (fcover?.mean != null) {
    claims.push({
      field: 'fcover',
      value: fcover.mean,
      unit: 'fraction',
      confidence: 'medium-high',
      allowed_claim: `Green vegetation cover fraction ≈ ${round3(fcover.mean)} (${coverPct != null ? coverPct + '%' : '—'})`,
      source: NRCAN_DATASET,
    });
  }
  if (fapar?.mean != null) {
    claims.push({
      field: 'fapar',
      value: fapar.mean,
      unit: 'fraction',
      confidence: 'medium-high',
      allowed_claim: `Fraction of absorbed photosynthetically active radiation ≈ ${round3(fapar.mean)}`,
      source: NRCAN_DATASET,
    });
  }
  if (avi) {
    claims.push({
      field: 'avi_crown',
      value: null,
      confidence: 'reference',
      allowed_claim: avi.note,
      source: AVI_DATASET,
    });
  }
  return claims;
}

// ---------- Geometry / projection ----------

/**
 * EPSG:3979 NAD83 / Canada Atlas Lambert (approximate GRS80).
 * Good enough for 20–100 m vegetation COG sampling.
 */
export function lonLatToEpsg3979(lon, lat) {
  const deg2rad = Math.PI / 180;
  const phi1 = 49 * deg2rad;
  const phi2 = 77 * deg2rad;
  const phi0 = 49 * deg2rad;
  const lam0 = -95 * deg2rad;
  const a = 6378137.0;
  const e = 0.08181919104281579;
  const e2 = e * e;

  const m = (phi) => {
    const s = Math.sin(phi);
    return Math.cos(phi) / Math.sqrt(1 - e2 * s * s);
  };
  const t = (phi) => {
    const s = Math.sin(phi);
    return (
      Math.tan(Math.PI / 4 - phi / 2) /
      Math.pow((1 - e * s) / (1 + e * s), e / 2)
    );
  };

  const m1 = m(phi1);
  const m2 = m(phi2);
  const t0 = t(phi0);
  const t1 = t(phi1);
  const t2 = t(phi2);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const phi = lat * deg2rad;
  const lam = lon * deg2rad;
  const rho = a * F * Math.pow(t(phi), n);
  const theta = n * (lam - lam0);
  return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
}

function normalizeBbox(aoi) {
  if (!aoi) return null;
  if (
    aoi.west != null &&
    aoi.south != null &&
    aoi.east != null &&
    aoi.north != null
  ) {
    return {
      west: Number(aoi.west),
      south: Number(aoi.south),
      east: Number(aoi.east),
      north: Number(aoi.north),
    };
  }
  if (aoi.type === 'Polygon' && aoi.coordinates?.[0]) {
    return ringBbox(aoi.coordinates[0]);
  }
  if (aoi.type === 'MultiPolygon' && aoi.coordinates?.[0]?.[0]) {
    return ringBbox(aoi.coordinates[0][0]);
  }
  if (Array.isArray(aoi) && Array.isArray(aoi[0])) {
    return ringBbox(aoi);
  }
  if (aoi.bbox?.length === 4) {
    const [west, south, east, north] = aoi.bbox;
    return { west, south, east, north };
  }
  return null;
}

function ringBbox(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const pt of ring) {
    const lng = Number(pt[0]);
    const lat = Number(pt[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

// ---------- Utils ----------

function emptyResult(code, message) {
  return {
    available: false,
    error: code,
    message,
    datasets: { nrcan_vegetation: NRCAN_DATASET, avi_crown: AVI_DATASET },
    attribution: vegetationAttribution(),
    claims: [],
    fallbacks: [message],
  };
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
function hashKey(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function readCache(key) {
  try {
    const p = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Date.now() - (raw._cached_at || 0) > CACHE_TTL_MS) return null;
    return raw.payload;
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
    /* ignore */
  }
}
