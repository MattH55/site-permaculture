/**
 * Bulk-ingest municipal assessment samples into the file-based spatial tile cache.
 *
 * Usage:
 *   node scripts/ingest-land-value.mjs              # both cities, default grids
 *   node scripts/ingest-land-value.mjs calgary
 *   node scripts/ingest-land-value.mjs edmonton --max-tiles 40
 *
 * Phase 2: no PostGIS — tiles under data/spatial-cache/{calgary,edmonton}/
 * Re-run weekly (Calgary) / after Edmonton annual assessment refresh.
 */

import { socrataGet } from '../lib/socrata.js';
import { tileKey, upsertTileFeatures, cacheStats, TILE_DEG } from '../lib/spatial-cache.js';

const SQM_PER_ACRE = 4046.8564224;

const CITIES = {
  calgary: {
    layer: 'calgary_assessment',
    centre: { lat: 51.0447, lng: -114.0719 },
    // Cover urban Calgary with a grid of sample points
    half_span_deg: 0.22,
    step: TILE_DEG,
    queryRadiusM: 1200,
  },
  edmonton: {
    layer: 'edmonton_assessment',
    centre: { lat: 53.5461, lng: -113.4938 },
    half_span_deg: 0.2,
    step: TILE_DEG,
    queryRadiusM: 1200,
  },
};

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const maxTiles = numFlag(args, '--max-tiles') ?? 80;
const sleepMs = numFlag(args, '--sleep-ms') ?? 350;

const targets = only && CITIES[only] ? { [only]: CITIES[only] } : CITIES;

for (const [city, cfg] of Object.entries(targets)) {
  console.log(`\n=== Ingest ${city} (max ${maxTiles} tiles) ===`);
  const points = gridPoints(cfg.centre, cfg.half_span_deg, cfg.step).slice(0, maxTiles);
  let written = 0;
  for (let i = 0; i < points.length; i++) {
    const { lat, lng } = points[i];
    const { key } = tileKey(lat, lng);
    process.stdout.write(`[${i + 1}/${points.length}] tile ${key} … `);
    try {
      const features =
        city === 'calgary'
          ? await fetchCalgary(lat, lng, cfg.queryRadiusM)
          : await fetchEdmonton(lat, lng, cfg.queryRadiusM);
      // Bucket features into their true tiles
      const byTile = new Map();
      for (const f of features) {
        const tk = tileKey(f.latitude, f.longitude);
        if (!byTile.has(tk.key)) byTile.set(tk.key, []);
        byTile.get(tk.key).push(f);
      }
      let n = 0;
      for (const [tkey, feats] of byTile) {
        upsertTileFeatures(cfg.layer, tkey, feats, {
          source: city,
          roll_note: city === 'calgary' ? 'Socrata 4bsw-nn7w' : 'Socrata dkk9+q7d6',
        });
        n += feats.length;
      }
      written += n;
      console.log(`${features.length} features → ${byTile.size} tiles`);
    } catch (e) {
      console.log(`FAIL ${e.message}`);
    }
    await sleep(sleepMs);
  }
  console.log('Cache stats:', cacheStats(cfg.layer));
  console.log(`Features written this run (approx): ${written}`);
}

console.log('\nDone. Pipeline will prefer tile cache when tiles cover the query radius.');

function gridPoints(centre, half, step) {
  const pts = [];
  for (let lat = centre.lat - half; lat <= centre.lat + half; lat += step) {
    for (let lng = centre.lng - half; lng <= centre.lng + half; lng += step) {
      pts.push({ lat: round6(lat), lng: round6(lng) });
    }
  }
  // centre-out order for early usefulness if user aborts
  pts.sort((a, b) => {
    const da = (a.lat - centre.lat) ** 2 + (a.lng - centre.lng) ** 2;
    const db = (b.lat - centre.lat) ** 2 + (b.lng - centre.lng) ** 2;
    return da - db;
  });
  return pts;
}

async function fetchCalgary(lat, lng, radiusM) {
  const rows = await socrataGet(
    { domain: 'data.calgary.ca', id: '4bsw-nn7w' },
    {
      $where: `within_circle(multipolygon,${lat},${lng},${radiusM}) AND land_size_ac > 0 AND assessed_value > 0`,
      $limit: 150,
      $select:
        'roll_number,address,assessed_value,assessment_class,fl_assessed_value,land_size_ac,roll_year,multipolygon',
    }
  );
  const out = [];
  for (const row of rows || []) {
    const acres = Number(row.land_size_ac);
    const total = Number(row.assessed_value);
    if (!(acres > 0) || !(total > 0)) continue;
    const c = multipolygonCentroid(row.multipolygon);
    if (!c) continue;
    const fl = Number(row.fl_assessed_value) || 0;
    const landSeparable = row.assessment_class === 'FL' && fl > 0;
    out.push({
      id: row.roll_number,
      latitude: c.lat,
      longitude: c.lng,
      address: row.address || null,
      acres,
      assessed_total_cad: total,
      assessed_total_per_acre: Math.round(total / acres),
      land_value_cad: landSeparable ? fl : null,
      land_value_per_acre: landSeparable ? Math.round(fl / acres) : null,
      land_separable: landSeparable,
      assessment_class: row.assessment_class || null,
      data_year: Number(row.roll_year) || null,
      value_type: landSeparable ? 'assessed_land' : 'assessed_total',
      source: 'calgary',
    });
  }
  return out;
}

async function fetchEdmonton(lat, lng, radiusM) {
  const props = await socrataGet(
    { domain: 'data.edmonton.ca', id: 'dkk9-cj3x' },
    {
      $where: `within_circle(point_location,${lat},${lng},${radiusM}) AND lot_size > 0`,
      $limit: 150,
      $select: 'account_number,lot_size,latitude,longitude,neighbourhood,street_name,house_number',
    }
  );
  if (!props?.length) return [];
  const ids = props.map((p) => `'${String(p.account_number).replace(/'/g, '')}'`);
  const assessments = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const rows = await socrataGet(
      { domain: 'data.edmonton.ca', id: 'q7d6-ambg' },
      { $where: `account_number in(${chunk.join(',')})`, $limit: 50 }
    );
    for (const r of rows || []) assessments.set(String(r.account_number), r);
  }
  const out = [];
  for (const p of props) {
    const a = assessments.get(String(p.account_number));
    if (!a) continue;
    const lotM2 = Number(p.lot_size);
    const total = Number(a.assessed_value);
    const plat = Number(p.latitude);
    const plng = Number(p.longitude);
    if (!(lotM2 > 0) || !(total > 0) || !Number.isFinite(plat) || !Number.isFinite(plng)) continue;
    const acres = lotM2 / SQM_PER_ACRE;
    const tax = String(a.tax_class || a.mill_class_1 || '');
    const isFarm = /farm/i.test(tax);
    out.push({
      id: p.account_number,
      latitude: plat,
      longitude: plng,
      address: [p.house_number, p.street_name].filter(Boolean).join(' ') || null,
      neighbourhood: p.neighbourhood || null,
      acres: Math.round(acres * 1000) / 1000,
      assessed_total_cad: total,
      assessed_total_per_acre: Math.round(total / acres),
      land_value_cad: isFarm ? total : null,
      land_value_per_acre: isFarm ? Math.round(total / acres) : null,
      land_separable: isFarm,
      assessment_class: tax || null,
      data_year: new Date().getFullYear(),
      value_type: isFarm ? 'assessed_land' : 'assessed_total',
      source: 'edmonton',
    });
  }
  return out;
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function numFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = Number(args[i + 1]);
  return Number.isFinite(v) ? v : null;
}
