/**
 * Land value context for site reports (informational only — not design scoring).
 *
 * Phase 1: live Socrata + CLI rural aggregate
 * Phase 2: file-based spatial tile cache (data/spatial-cache) preferred when warm;
 *          live Socrata fallback; same expanding-radius contract.
 *
 * Values are ASSESSED or transfer-aggregate — not Land Titles sale prices.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { socrataGet } from './socrata.js';
import {
  queryRadius,
  cacheStats,
  tileKey,
  upsertTileFeatures,
} from './spatial-cache.js';
import { ALBERTA_PLACES, haversineKm } from './proximity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data', 'land-value');

const RADII_M = [800, 1500, 3000, 5000, 10000, 15000];
const N_MIN = 15;
const SQM_PER_ACRE = 4046.8564224;

/** Municipal Socrata assessment configs (generic adapter consumers). */
export const ASSESSMENT_SOURCES = {
  calgary: {
    key: 'calgary',
    municipality: 'Calgary',
    domain: 'data.calgary.ca',
    id: '4bsw-nn7w',
    /** Approximate city bbox for coverage test */
    centre: { lat: 51.0447, lng: -114.0719 },
    coverage_km: 42,
    geometry_field: 'multipolygon',
    refresh_note: 'City of Calgary assessment roll — typically updated weekly during assessment cycle',
  },
  edmonton: {
    key: 'edmonton',
    municipality: 'Edmonton',
    domain: 'data.edmonton.ca',
    property_id: 'dkk9-cj3x',
    assessment_id: 'q7d6-ambg',
    centre: { lat: 53.5461, lng: -113.4938 },
    coverage_km: 38,
    geometry_field: 'point_location',
    refresh_note: 'City of Edmonton current-year assessment + property info (lot size)',
  },
};

let cliTable = null;
let fccTrends = null;
let placeMap = null;

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{
 *   footprint_ha?: number,
 *   nearest_city?: { name?: string, distance_km?: number },
 *   nearest_settlement?: { name?: string, distance_km?: number },
 *   cli_class?: string|number|null,
 * }} [ctx]
 */
export async function assessLandValue(centre, ctx = {}) {
  const lat = centre.latitude;
  const lng = centre.longitude;
  const acreage = footprintToAcres(ctx.footprint_ha);

  const urban = pickUrbanSource(lat, lng);
  let municipal = null;
  if (urban) {
    municipal = await sampleMunicipalAssessments(urban, lat, lng).catch((e) => ({
      ok: false,
      error: e.message,
      samples: [],
    }));
  }

  const rural = ruralAggregateValue(lat, lng, ctx);

  // Prefer municipal parcel hit for target assessed value when available
  const target = pickTargetAssessment(municipal, acreage);
  const sampleStats = summarizeSamples(municipal?.samples || []);
  const hasMunicipalSample = !!(municipal?.ok && (municipal.sample_n || 0) > 0);

  // Source priority: live municipal assessment sample > rural CLI aggregate > none
  // Pure land $/acre only when land is separable (e.g. Calgary FL) or rural CLI.
  let land_value_source = 'none';
  let assessed_land_value = null;
  let land_value_per_acre = null;
  let land_value_data_year = null;

  if (hasMunicipalSample) {
    land_value_source = 'municipal_assessment';
    land_value_data_year = target?.data_year ?? null;
    if (target?.land_separable && target.land_value_per_acre != null) {
      land_value_per_acre = target.land_value_per_acre;
      assessed_land_value =
        target.land_value_cad ??
        (acreage ? roundMoney(target.land_value_per_acre * acreage) : null);
    }
    // else: total assessed $/acre lives on target_parcel / municipal_sample.stats
    // — not promoted to land_value_per_acre (that field means land residual)
  } else if (rural?.raw_cad_per_acre != null) {
    land_value_source = 'cli_municipality_aggregate';
    land_value_per_acre = rural.adjusted_cad_per_acre;
    land_value_data_year = rural.data_year_base;
    assessed_land_value = acreage
      ? roundMoney(rural.adjusted_cad_per_acre * acreage)
      : null;
  }

  return {
    // Schema fields (primary)
    assessed_land_value,
    land_value_per_acre,
    land_value_data_year,
    land_value_source,
    nearby_land_value_sample_n: municipal?.sample_n ?? 0,
    nearby_land_value_search_radius_m: municipal?.search_radius_m ?? null,

    // Extended context for UI (informational panel only)
    parcel_acreage: acreage,
    target_parcel: target,
    municipal_sample: municipal
      ? {
          available: !!municipal.ok,
          municipality: municipal.municipality,
          search_radius_m: municipal.search_radius_m,
          sample_n: municipal.sample_n,
          n_min: N_MIN,
          expanded: municipal.expanded,
          radii_tried_m: municipal.radii_tried_m,
          stats: sampleStats,
          samples: (municipal.samples || []).slice(0, 40),
          error: municipal.error || null,
          source_name: municipal.source_name,
          source_url: municipal.source_url,
          refresh_note: municipal.refresh_note,
          from_cache: !!municipal.from_cache,
          tiles_hit: municipal.tiles_hit ?? null,
        }
      : {
          available: false,
          note: urban
            ? 'Municipal sample failed'
            : 'Outside Calgary/Edmonton live assessment coverage — rural aggregate used when available.',
        },
    rural_aggregate: rural,
    value_basis: {
      label: 'Assessed / transfer-aggregate value — not market sale price',
      detail:
        'Alberta Land Titles individual sale records are pay-per-lookup with no free bulk API. Urban figures are municipal assessed values (often land+improvements). Rural figures are historical agricultural transfer averages by municipality and CLI class, optionally FCC-trend-adjusted.',
    },
    disclaimer:
      'Planning context only — not an appraisal, CMA, or offer price. Confirm with a licensed appraiser and current assessment notice / realtor comps before any purchase decision.',
  };
}

/* ---------- urban municipal sample ---------- */

function pickUrbanSource(lat, lng) {
  let best = null;
  for (const src of Object.values(ASSESSMENT_SOURCES)) {
    const d = haversineKm(lat, lng, src.centre.lat, src.centre.lng);
    if (d <= src.coverage_km && (!best || d < best.d)) {
      best = { ...src, d };
    }
  }
  return best;
}

async function sampleMunicipalAssessments(src, lat, lng) {
  const cacheLayer =
    src.key === 'calgary'
      ? 'calgary_assessment'
      : src.key === 'edmonton'
        ? 'edmonton_assessment'
        : null;

  // Phase 2: prefer warm tile cache (7-day freshness) before live SoQL
  if (cacheLayer) {
    const cached = sampleFromCache(cacheLayer, lat, lng);
    if (cached && cached.sample_n >= N_MIN) {
      return {
        ...cached,
        municipality: src.municipality,
        source_name: `${src.municipality} assessment (spatial tile cache)`,
        source_url: `https://${src.domain}/`,
        refresh_note: `${src.refresh_note} · cache ${cacheLayer}`,
        from_cache: true,
        cache_stats: cacheStats(cacheLayer),
      };
    }
  }

  const radii_tried = [];
  let samples = [];
  let usedRadius = null;

  for (const r of RADII_M) {
    radii_tried.push(r);
    if (src.key === 'calgary') {
      samples = await fetchCalgarySamples(lat, lng, r);
    } else if (src.key === 'edmonton') {
      samples = await fetchEdmontonSamples(lat, lng, r);
    }
    usedRadius = r;
    if (samples.length >= N_MIN) break;
    if (r >= RADII_M[RADII_M.length - 1]) break;
  }

  // Opportunistically warm cache from live pull
  if (cacheLayer && samples.length) {
    try {
      warmCacheFromSamples(cacheLayer, samples, src.key);
    } catch {
      /* non-fatal */
    }
  }

  return {
    ok: true,
    municipality: src.municipality,
    search_radius_m: usedRadius,
    sample_n: samples.length,
    expanded: usedRadius != null && usedRadius > RADII_M[0],
    radii_tried_m: radii_tried,
    samples,
    source_name: `${src.municipality} open data property assessment (Socrata live)`,
    source_url: `https://${src.domain}/`,
    refresh_note: src.refresh_note,
    from_cache: false,
  };
}

function sampleFromCache(layer, lat, lng) {
  const radii_tried = [];
  let samples = [];
  let usedRadius = null;
  let lastMeta = null;
  // 14-day max age for assessment tiles
  const maxAgeMs = 14 * 24 * 60 * 60 * 1000;

  for (const r of RADII_M) {
    radii_tried.push(r);
    const q = queryRadius(layer, lat, lng, r, { maxAgeMs });
    lastMeta = q;
    samples = q.features || [];
    usedRadius = r;
    // Require some tile hits so we don't treat empty cache as success
    if (samples.length >= N_MIN && q.tiles_hit > 0) break;
    if (r >= RADII_M[RADII_M.length - 1]) break;
  }

  if (!samples.length || !lastMeta?.tiles_hit) return null;

  return {
    ok: true,
    search_radius_m: usedRadius,
    sample_n: samples.length,
    expanded: usedRadius != null && usedRadius > RADII_M[0],
    radii_tried_m: radii_tried,
    samples,
    tiles_hit: lastMeta.tiles_hit,
    tiles_missing: lastMeta.tiles_missing,
  };
}

function warmCacheFromSamples(layer, samples, sourceKey) {
  const byTile = new Map();
  for (const s of samples) {
    // Live samples may lack lat/lng (Calgary only had centroid when multipolygon present)
    if (s.latitude == null || s.longitude == null) continue;
    const { key } = tileKey(s.latitude, s.longitude);
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(s);
  }
  for (const [key, feats] of byTile) {
    upsertTileFeatures(layer, key, feats, {
      source: sourceKey,
      warmed_from: 'live_query',
    });
  }
}

async function fetchCalgarySamples(lat, lng, radiusM) {
  const rows = await socrataGet(
    { domain: 'data.calgary.ca', id: '4bsw-nn7w' },
    {
      $where: `within_circle(multipolygon,${lat},${lng},${radiusM}) AND land_size_ac > 0 AND assessed_value > 0`,
      $limit: 200,
      $select:
        'roll_number,address,assessed_value,assessment_class,fl_assessed_value,re_assessed_value,land_size_ac,land_size_sm,roll_year,property_type,multipolygon',
    }
  );

  const out = [];
  for (const row of rows || []) {
    const acres = num(row.land_size_ac);
    const total = num(row.assessed_value);
    if (!acres || acres <= 0 || !total || total <= 0) continue;

    const fl = num(row.fl_assessed_value) || 0;
    // Farmland class can separate land; residential/NR cannot cleanly
    const landSeparable = row.assessment_class === 'FL' && fl > 0;
    const landVal = landSeparable ? fl : null;
    const c = multipolygonCentroid(row.multipolygon);
    const dist =
      c != null ? Math.round(haversineKm(lat, lng, c.lat, c.lng) * 1000) : null;

    out.push({
      id: row.roll_number,
      address: row.address || null,
      distance_m: dist,
      latitude: c?.lat ?? null,
      longitude: c?.lng ?? null,
      acres,
      assessed_total_cad: total,
      assessed_total_per_acre: roundMoney(total / acres),
      land_value_cad: landVal,
      land_value_per_acre: landVal != null ? roundMoney(landVal / acres) : null,
      land_separable: landSeparable,
      assessment_class: row.assessment_class || null,
      data_year: num(row.roll_year),
      value_type: landSeparable ? 'assessed_land' : 'assessed_total',
    });
  }
  out.sort((a, b) => (a.distance_m ?? 9e9) - (b.distance_m ?? 9e9));
  return out;
}

async function fetchEdmontonSamples(lat, lng, radiusM) {
  // Property info has geometry + lot_size (m²); assessment has value by account
  const props = await socrataGet(
    { domain: 'data.edmonton.ca', id: 'dkk9-cj3x' },
    {
      $where: `within_circle(point_location,${lat},${lng},${radiusM}) AND lot_size > 0`,
      $limit: 200,
      $select: 'account_number,lot_size,latitude,longitude,neighbourhood,zoning,street_name,house_number',
    }
  );
  if (!props?.length) return [];

  const ids = props.map((p) => `'${String(p.account_number).replace(/'/g, '')}'`);
  // Chunk IN() queries
  const assessments = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const rows = await socrataGet(
      { domain: 'data.edmonton.ca', id: 'q7d6-ambg' },
      {
        $where: `account_number in(${chunk.join(',')})`,
        $limit: 50,
      }
    );
    for (const r of rows || []) {
      assessments.set(String(r.account_number), r);
    }
  }

  const out = [];
  for (const p of props) {
    const a = assessments.get(String(p.account_number));
    if (!a) continue;
    const lotM2 = num(p.lot_size);
    const total = num(a.assessed_value);
    if (!lotM2 || lotM2 <= 0 || !total || total <= 0) continue;
    const acres = lotM2 / SQM_PER_ACRE;
    if (acres <= 0) continue;
    const plat = num(p.latitude);
    const plng = num(p.longitude);
    const dist =
      plat != null && plng != null
        ? Math.round(haversineKm(lat, lng, plat, plng) * 1000)
        : null;

    // Edmonton open data does not publish land vs improvement split
    const landSeparable = false;
    const tax = String(a.tax_class || a.mill_class_1 || '');
    // Farmland tax class is still total assessed but closer to land-dominant
    const isFarm = /farm/i.test(tax);

    out.push({
      id: p.account_number,
      address: [p.house_number, p.street_name].filter(Boolean).join(' ') || null,
      neighbourhood: p.neighbourhood || null,
      distance_m: dist,
      latitude: plat,
      longitude: plng,
      acres: Math.round(acres * 1000) / 1000,
      assessed_total_cad: total,
      assessed_total_per_acre: roundMoney(total / acres),
      land_value_cad: isFarm ? total : null,
      land_value_per_acre: isFarm ? roundMoney(total / acres) : null,
      land_separable: isFarm,
      assessment_class: tax || null,
      data_year: new Date().getFullYear(),
      value_type: isFarm ? 'assessed_land' : 'assessed_total',
      zoning: p.zoning || null,
    });
  }
  out.sort((a, b) => (a.distance_m ?? 9e9) - (b.distance_m ?? 9e9));
  return out;
}

function pickTargetAssessment(municipal, acreage) {
  if (!municipal?.samples?.length) return null;
  // Closest parcel as neighbourhood proxy for "subject" when we don't have exact roll match
  const nearest = municipal.samples[0];
  const land_separable = !!nearest.land_separable;
  return {
    matched: 'nearest_in_sample',
    roll_or_account: nearest.id,
    address: nearest.address,
    distance_m: nearest.distance_m,
    data_year: nearest.data_year,
    land_separable,
    land_value_cad: nearest.land_value_cad,
    land_value_per_acre: nearest.land_value_per_acre,
    assessed_total_cad: nearest.assessed_total_cad,
    assessed_total_per_acre: nearest.assessed_total_per_acre,
    assessment_class: nearest.assessment_class,
    value_type: nearest.value_type,
    note: land_separable
      ? 'Nearest sample has separable land assessment (farmland class).'
      : 'Nearest sample is total assessed value (land + improvements). Calgary/Edmonton open data does not publish a pure land residual for typical residential parcels.',
    subject_parcel_acreage: acreage,
    subject_implied_total_if_same_rate:
      acreage && nearest.assessed_total_per_acre
        ? roundMoney(acreage * nearest.assessed_total_per_acre)
        : null,
  };
}

function summarizeSamples(samples) {
  const rates = samples
    .map((s) =>
      s.land_separable && s.land_value_per_acre != null
        ? s.land_value_per_acre
        : s.assessed_total_per_acre
    )
    .filter((v) => v != null && v > 0)
    .sort((a, b) => a - b);

  if (!rates.length) {
    return {
      n: 0,
      unit: 'CAD_per_acre',
      metric: 'assessed_value_per_acre',
    };
  }

  const landOnly = samples.filter((s) => s.land_separable && s.land_value_per_acre != null);
  return {
    n: rates.length,
    unit: 'CAD_per_acre',
    metric:
      landOnly.length >= Math.max(5, rates.length * 0.4)
        ? 'assessed_land_per_acre'
        : 'assessed_total_per_acre',
    land_separable_n: landOnly.length,
    min: rates[0],
    p25: percentile(rates, 0.25),
    median: percentile(rates, 0.5),
    p75: percentile(rates, 0.75),
    max: rates[rates.length - 1],
    mean: roundMoney(rates.reduce((a, b) => a + b, 0) / rates.length),
    // For violin-ish rendering
    distribution: rates,
  };
}

/* ---------- rural CLI aggregate + FCC ---------- */

function ruralAggregateValue(lat, lng, ctx) {
  const table = loadCliTable();
  const trends = loadFccTrends();
  const pmap = loadPlaceMap();

  const placeName =
    ctx.nearest_settlement?.name ||
    ctx.nearest_city?.name ||
    nearestPlaceName(lat, lng);

  let muniName = pmap[placeName] || null;
  let row = muniName ? findCliRow(table, muniName) : null;

  // Fuzzy: match CLI municipality containing place name
  if (!row && placeName) {
    row = table.municipalities.find((m) =>
      normalize(m.municipality).includes(normalize(placeName))
    );
    if (row) muniName = row.municipality;
  }

  // Nearest mapped place's county
  if (!row) {
    const np = nearestMappedPlace(lat, lng, pmap);
    if (np) {
      muniName = np.county;
      row = findCliRow(table, muniName);
    }
  }

  if (!row) {
    row = findCliRow(table, 'Alberta Average');
    muniName = 'Alberta Average';
  }

  const cliClass = normalizeCli(ctx.cli_class);
  const raw =
    (cliClass && row[`cli_${cliClass}`]) ||
    row.all_classes ||
    firstPositive([
      row.cli_2,
      row.cli_3,
      row.cli_1,
      row.cli_4,
      row.cli_5,
      row.cli_6,
      row.other,
    ]);

  if (raw == null) return null;

  const baseYear = table.data_year || 2015;
  const currentYear = new Date().getFullYear();
  const { factor, years_applied, cumulative_pct } = fccCumulativeFactor(
    trends,
    baseYear,
    currentYear
  );
  const adjusted = roundMoney(raw * factor);

  return {
    municipality: muniName,
    place_proxy: placeName || null,
    cli_class_used: cliClass || 'all_classes_or_available_mean',
    raw_cad_per_acre: roundMoney(raw),
    adjusted_cad_per_acre: adjusted,
    data_year_base: baseYear,
    data_year_adjusted_to: currentYear,
    fcc_cumulative_factor: Math.round(factor * 1000) / 1000,
    fcc_cumulative_pct: Math.round(cumulative_pct * 10) / 10,
    fcc_years_applied: years_applied,
    source_name: table.source_name,
    source_url: table.source_url,
    fcc_source_name: trends.source_name,
    fcc_source_url: trends.source_url,
    note: table.note,
  };
}

function fccCumulativeFactor(trends, fromYear, toYear) {
  const series = trends.annual_pct_change || {};
  let factor = 1;
  const years_applied = [];
  for (let y = fromYear + 1; y <= toYear; y++) {
    const pct = series[String(y)];
    if (pct == null) continue;
    factor *= 1 + Number(pct) / 100;
    years_applied.push({ year: y, pct_change: Number(pct) });
  }
  return {
    factor,
    years_applied,
    cumulative_pct: (factor - 1) * 100,
  };
}

/* ---------- loaders / helpers ---------- */

function loadCliTable() {
  if (cliTable) return cliTable;
  const p = path.join(DATA, 'cli-municipality-2015.json');
  cliTable = JSON.parse(fs.readFileSync(p, 'utf8'));
  return cliTable;
}

function loadFccTrends() {
  if (fccTrends) return fccTrends;
  const p = path.join(DATA, 'fcc-alberta-trends.json');
  fccTrends = JSON.parse(fs.readFileSync(p, 'utf8'));
  return fccTrends;
}

function loadPlaceMap() {
  if (placeMap) return placeMap;
  const p = path.join(DATA, 'place-to-municipality.json');
  placeMap = JSON.parse(fs.readFileSync(p, 'utf8')).map || {};
  return placeMap;
}

function findCliRow(table, name) {
  const n = normalize(name);
  return (
    table.municipalities.find((m) => normalize(m.municipality) === n) ||
    table.municipalities.find((m) => normalize(m.municipality).includes(n)) ||
    null
  );
}

function nearestPlaceName(lat, lng) {
  let best = null;
  for (const p of ALBERTA_PLACES) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { name: p.name, d };
  }
  return best?.name || null;
}

function nearestMappedPlace(lat, lng, pmap) {
  let best = null;
  for (const p of ALBERTA_PLACES) {
    const county = pmap[p.name];
    if (!county) continue;
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { place: p.name, county, d };
  }
  return best;
}

function footprintToAcres(ha) {
  if (ha == null || !Number.isFinite(Number(ha)) || Number(ha) <= 0) return null;
  return Math.round(Number(ha) * 2.47105 * 1000) / 1000;
}

function multipolygonCentroid(mp) {
  try {
    const ring = mp?.coordinates?.[0]?.[0];
    if (!ring?.length) return null;
    let x = 0;
    let y = 0;
    for (const [lng, lat] of ring) {
      x += lng;
      y += lat;
    }
    return { lng: x / ring.length, lat: y / ring.length };
  } catch {
    return null;
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return roundMoney(sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo));
}

function normalizeCli(c) {
  if (c == null || c === '') return null;
  const s = String(c).trim();
  const m = s.match(/([1-7])/);
  return m ? m[1] : null;
}

function firstPositive(arr) {
  for (const v of arr) {
    if (typeof v === 'number' && v > 0) return v;
  }
  return null;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}
