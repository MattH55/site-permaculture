#!/usr/bin/env node
/**
 * Export Growing Guide / farmfit CropData → site-design planting + economics JSON.
 *
 * Parses farmfit TypeScript crop seeds:
 *   - suitability_params (EcoCrop-style temps/rain/pH/growing days)
 *   - yield_benchmark { yield_kg_ha, yield_range_min, yield_range_max }
 *   - price_benchmarks [{ price_per_kg_usd, market_type }]
 *   - processing_ladder [{ name, value_add_multiplier, output_product }]
 *
 * Usage:
 *   node scripts/export-farmfit-crops.mjs
 *   node scripts/export-farmfit-crops.mjs --guide "C:\\…\\Growing Guide"
 *   node scripts/export-farmfit-crops.mjs --all   # keep tropical too
 *
 * Writes:
 *   data/crops/farmfit-export.json
 *   data/crops/farmfit-economics.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DESIGN_ROOT = path.resolve(__dirname, '..');
const USD_TO_CAD = Number(process.env.USD_CAD_RATE) || 1.38;

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
const keepAll = args.includes('--all');
const guideRoot =
  arg('--guide') ||
  process.env.GROWING_GUIDE_PATH ||
  path.resolve(SITE_DESIGN_ROOT, '..', '..', '..', 'OpenSourceMed', 'Growing Guide');

const farmfit = path.join(guideRoot, 'farmfit');
const outCrops = path.join(SITE_DESIGN_ROOT, 'data', 'crops', 'farmfit-export.json');
const outEcon = path.join(SITE_DESIGN_ROOT, 'data', 'crops', 'farmfit-economics.json');

console.log('Growing Guide:', guideRoot);

if (!fs.existsSync(farmfit)) {
  console.error('farmfit not found. Set GROWING_GUIDE_PATH or --guide');
  process.exit(1);
}

const files = [
  path.join(farmfit, 'src', 'lib', 'data', 'crop-seed.ts'),
  path.join(farmfit, 'src', 'lib', 'data', 'crop-seed-specialty.ts'),
  // allow local samples for offline dev
  path.join(__dirname, '_sample-crop-seed.ts'),
  path.join(__dirname, '_sample-crop-seed-specialty.ts'),
];

const extracted = [];
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn('unreadable', file, e.message);
    continue;
  }
  const objs = extractCropObjects(text);
  console.log(`${path.basename(file)}: ${objs.length} crops`);
  for (const o of objs) {
    const crop = normalizeFarmfitCrop(o, path.basename(file));
    if (crop) extracted.push(crop);
  }
}

const byId = new Map();
for (const c of extracted) {
  byId.set(c.id, { ...(byId.get(c.id) || {}), ...c });
}

let crops = [...byId.values()];
const before = crops.length;
if (!keepAll) crops = crops.filter(isColdClimateRelevant);
console.log(`Crops: ${before} → ${crops.length} after filter (${keepAll ? 'all' : 'cold-climate'})`);

// Split economics
const econItems = {};
for (const c of crops) {
  if (c.economics) {
    econItems[c.id] = c.economics;
    // keep a slim pointer on crop but full data goes to economics file
  }
}

const cropPayload = {
  source: 'farmfit CropData export for Expanding Edge site-design',
  growing_guide: guideRoot,
  exported_at: new Date().toISOString(),
  filter: keepAll ? 'all' : 'cold_climate_and_alberta_relevant',
  count: crops.length,
  crops: crops.map(({ economics, ...rest }) => rest),
};

const econPayload = {
  source: 'farmfit yield_benchmark + price_benchmarks (USD→CAD)',
  currency: 'CAD',
  usd_cad_rate: USD_TO_CAD,
  year: 2025,
  disclaimer:
    'Converted from farmfit FAOSTAT/global benchmarks where present. Planning ranges only — not Alberta market guarantees.',
  items: econItems,
  count: Object.keys(econItems).length,
};

fs.mkdirSync(path.dirname(outCrops), { recursive: true });
fs.writeFileSync(outCrops, JSON.stringify(cropPayload, null, 2));
fs.writeFileSync(outEcon, JSON.stringify(econPayload, null, 2));
console.log('Wrote', outCrops);
console.log('Wrote', outEcon, `(${econPayload.count} economics rows)`);

// Optional farmfit public copy
try {
  const pub = path.join(farmfit, 'public', 'crops-export.json');
  fs.mkdirSync(path.dirname(pub), { recursive: true });
  fs.writeFileSync(pub, JSON.stringify(cropPayload, null, 2));
  console.log('Also wrote', pub);
} catch (e) {
  console.warn('farmfit public write skipped:', e.message);
}

/* ---------- parse farmfit TS CropData objects ---------- */

function extractCropObjects(text) {
  // Find array export bodies
  const results = [];
  const re = /\{\s*id:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = matchBrace(text, start);
    if (end < 0) continue;
    const slice = text.slice(start, end + 1);
    const obj = parseCropLiteral(slice);
    if (obj) results.push(obj);
  }
  return results;
}

function matchBrace(s, start) {
  let depth = 0;
  let inStr = null;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseCropLiteral(slice) {
  // Convert TS object literal → JSON-ish
  let s = slice
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // quote unquoted keys
  s = s.replace(/([{\[,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  // single → double quotes
  s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => {
    return `"${inner.replace(/"/g, '\\"')}"`;
  });
  // trailing commas
  s = s.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(s);
  } catch {
    try {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${slice});`)();
    } catch {
      return null;
    }
  }
}

function normalizeFarmfitCrop(o, file) {
  if (!o?.id && !o?.scientific_name) return null;
  const common =
    o.common_names?.en ||
    o.common_name ||
    o.commonName ||
    o.name ||
    o.scientific_name;
  const scientific = o.scientific_name || o.latin || null;
  const sp = o.suitability_params || {};

  const hardiness_min =
    o.hardiness_min ||
    zoneFromTempAbs(sp.temp_min_abs) ||
    '4a';
  const hardiness_max =
    o.hardiness_max ||
    zoneFromTempAbs(sp.temp_opt_min, true) ||
    '8a';

  const yb = o.yield_benchmark || {};
  const prices = o.price_benchmarks || [];
  const farmgate = prices.find((p) => p.market_type === 'farmgate') || prices[0];
  const retail = prices.find((p) => /retail|direct/i.test(p.market_type || '')) || null;

  const ladder = o.processing_ladder || [];
  const topLadder = ladder[ladder.length - 1];

  const economics = {
    yield_kg_per_ha: {
      low: num(yb.yield_range_min) ?? num(yb.yield_kg_ha) ?? 0,
      high: num(yb.yield_range_max) ?? num(yb.yield_kg_ha) ?? 0,
    },
    price_wholesale_cad_per_kg: farmgate
      ? {
          low: round2((num(farmgate.price_per_kg_usd) || 0) * USD_TO_CAD * 0.85),
          high: round2((num(farmgate.price_per_kg_usd) || 0) * USD_TO_CAD * 1.15),
        }
      : { low: 0, high: 0 },
    price_retail_cad_per_kg: retail
      ? {
          low: round2((num(retail.price_per_kg_usd) || 0) * USD_TO_CAD * 0.9),
          high: round2((num(retail.price_per_kg_usd) || 0) * USD_TO_CAD * 1.2),
        }
      : farmgate
        ? {
            low: round2((num(farmgate.price_per_kg_usd) || 0) * USD_TO_CAD * 1.8),
            high: round2((num(farmgate.price_per_kg_usd) || 0) * USD_TO_CAD * 3.0),
          }
        : { low: 0, high: 0 },
    unit: yb.unit || 'kg',
    market_channels: [
      ...(farmgate ? [String(farmgate.market_type || 'farmgate')] : []),
      ...ladder.map((s) => s.output_product || s.name).filter(Boolean),
    ],
    establishment_years: o.category === 'annual' ? 1 : 3,
    labour_intensity: 'medium',
    processing_ladder: ladder.map((s) => ({
      step: s.step,
      name: s.name,
      output_product: s.output_product,
      value_add_multiplier: s.value_add_multiplier ?? 1,
      difficulty: s.difficulty,
    })),
    source: farmgate?.source || yb.source || 'farmfit',
  };

  // frost_tolerance none → chinook/cold sensitive annuals still OK but trees not
  const frostNone = sp.frost_tolerance === 'none';

  return {
    id: o.id || slug(common),
    common_name: common,
    scientific_name: scientific,
    category: mapCategory(o),
    guild_layer: mapLayer(o),
    hardiness_min: String(hardiness_min).toLowerCase(),
    hardiness_max: String(hardiness_max).toLowerCase(),
    frost_free_min_days: num(sp.growing_days_min) ?? 100,
    precip_min_mm: num(sp.rainfall_min_mm) ?? 300,
    precip_max_mm: num(sp.rainfall_max_mm) ?? 1200,
    ph_min: num(sp.ph_min) ?? 5.5,
    ph_max: num(sp.ph_max) ?? 7.5,
    textures: ['loam', 'sandy_loam', 'silt_loam'],
    drainage:
      sp.waterlogging_tolerance === 'high'
        ? ['well', 'moderately_well', 'imperfect', 'poor']
        : ['well', 'moderately_well'],
    chinook_sensitive: frostNone && /tree|shrub|perennial/i.test(String(o.category || '')),
    alberta_native: false,
    region_focus: 'global_farmfit',
    tags: o.tags || [],
    regions: o.regions || [],
    notes: `Farmfit (${file})${topLadder ? ` · value-add: ${topLadder.output_product || topLadder.name}` : ''}`,
    economics,
  };
}

function mapCategory(o) {
  const c = String(o.category || '').toLowerCase();
  if (c.includes('medicin') || (o.tags || []).includes('medicinal')) return 'medicinal';
  if (c.includes('perenn')) return 'perennial';
  if (c.includes('annual')) return 'annual';
  if (c.includes('tree')) return 'tree';
  if (c.includes('shrub')) return 'shrub';
  return c || 'annual';
}

function mapLayer(o) {
  const g = String(o.growth_habit || o.category || '').toLowerCase();
  if (g.includes('tree')) return 'canopy';
  if (g.includes('shrub') || g.includes('bush')) return 'shrub';
  if (g.includes('vine')) return 'vine';
  if (g.includes('grass')) return 'herbaceous';
  return 'herbaceous';
}

function isColdClimateRelevant(c) {
  // frost_tolerance none + tropical tags/regions → drop
  const tags = (c.tags || []).join(' ').toLowerCase();
  const regions = (c.regions || []).join(' ').toLowerCase();
  const name = `${c.common_name} ${c.scientific_name || ''}`.toLowerCase();
  if (/tropical|subtropical/.test(tags + regions)) return false;
  if (
    /rice|oryza|banana|mango|cassava|taro|cacao|coffee|coconut|papaya|sugarcane|yam\b|manioc|pineapple|avocado|citrus|orange|lemon|clove|syzygium|cinnamon|vanilla|black pepper|tea tree|neem|moringa|turmeric|ginger|cardamom|allspice|nutmeg/.test(
      name
    )
  )
    return false;
  // growing days max too long for AB short season? allow if min days OK
  if ((c.frost_free_min_days || 0) > 160) return false;
  // hardiness from temp: if min abs temp requirement is high, plant is tropical
  // already encoded roughly in hardiness_min
  if (zoneRank(c.hardiness_min) >= zoneRank('8a')) return false;
  // maize can work short-season in AB → allow if growing days min <= 120
  if (name.includes('maize') || name.includes('zea mays')) {
    return (c.frost_free_min_days || 999) <= 100;
  }
  return true;
}

function zoneFromTempAbs(t, isOpt = false) {
  // Map absolute min growing temp (°C) to rough hardiness for filter purposes
  // This is NOT the same as plant hardiness zone — used only as coarse filter.
  if (t == null || !Number.isFinite(Number(t))) return null;
  const c = Number(t);
  if (c <= 0) return isOpt ? '4a' : '2a';
  if (c <= 5) return isOpt ? '5a' : '3a';
  if (c <= 8) return isOpt ? '6a' : '4a';
  if (c <= 12) return isOpt ? '7a' : '5a';
  if (c <= 15) return isOpt ? '8a' : '7a';
  return isOpt ? '9a' : '8a';
}

function zoneRank(z) {
  const order = [
    '1a','1b','2a','2b','3a','3b','4a','4b','5a','5b',
    '6a','6b','7a','7b','8a','8b','9a','9b',
  ];
  const i = order.indexOf(String(z || '4a').toLowerCase());
  return i >= 0 ? i : 8;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
