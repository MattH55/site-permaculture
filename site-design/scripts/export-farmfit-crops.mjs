#!/usr/bin/env node
/**
 * Export Growing Guide / farmfit crop data → JSON for site-design planting scorer.
 *
 * Usage (from site-design or anywhere):
 *   node scripts/export-farmfit-crops.mjs
 *   node scripts/export-farmfit-crops.mjs --guide "C:\Users\...\Growing Guide"
 *   node scripts/export-farmfit-crops.mjs --out ./data/crops/farmfit-export.json
 *
 * Env:
 *   GROWING_GUIDE_PATH  — path to "Growing Guide" folder (contains farmfit/)
 *
 * Filters tropical-leaning crops by default (keeps cold-hardy / Alberta-relevant).
 * Pass --all to keep everything from farmfit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DESIGN_ROOT = path.resolve(__dirname, '..');

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
  path.resolve(
    SITE_DESIGN_ROOT,
    '..',
    '..',
    '..',
    'OpenSourceMed',
    'Growing Guide'
  );
const outPath =
  arg('--out') ||
  path.join(SITE_DESIGN_ROOT, 'data', 'crops', 'farmfit-export.json');

const farmfit = path.join(guideRoot, 'farmfit');
const candidates = [
  path.join(farmfit, 'src', 'lib', 'data', 'crop-seed.ts'),
  path.join(farmfit, 'src', 'lib', 'data', 'crop-seed-specialty.ts'),
  path.join(farmfit, 'src', 'lib', 'data', 'growable-medicine', 'taxa.ts'),
];

console.log('Growing Guide root:', guideRoot);
console.log('farmfit path:', farmfit);

if (!fs.existsSync(farmfit)) {
  console.error(
    'farmfit folder not found. Set GROWING_GUIDE_PATH or pass --guide "…/Growing Guide"'
  );
  process.exit(1);
}

const extracted = [];
for (const file of candidates) {
  if (!fs.existsSync(file)) {
    console.warn('skip (missing):', file);
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn('skip (unreadable — OneDrive offline?):', file, e.message);
    continue;
  }
  const objs = extractObjectLiterals(text);
  console.log(`${path.basename(file)}: ${objs.length} object literals`);
  for (const o of objs) {
    const crop = normalizeFarmfitRecord(o, path.basename(file));
    if (crop) extracted.push(crop);
  }
}

// Dedupe by id
const byId = new Map();
for (const c of extracted) {
  if (!byId.has(c.id)) byId.set(c.id, c);
  else byId.set(c.id, { ...byId.get(c.id), ...c });
}

let crops = [...byId.values()];
const before = crops.length;
if (!keepAll) {
  crops = crops.filter(isColdClimateRelevant);
}
console.log(
  `Crops: ${before} raw → ${crops.length} after ${keepAll ? 'no' : 'cold-climate'} filter`
);

// Tag Alberta relevance
crops = crops.map((c) => ({
  ...c,
  region_focus: c.region_focus || (isAlbertaNativeName(c) ? 'alberta' : 'cold_temperate'),
  alberta_native: c.alberta_native ?? isAlbertaNativeName(c),
}));

const payload = {
  source: 'farmfit export for Expanding Edge site-design',
  growing_guide: guideRoot,
  exported_at: new Date().toISOString(),
  filter: keepAll ? 'all' : 'cold_climate_and_alberta_relevant',
  count: crops.length,
  crops,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log('Wrote', outPath);

// Also copy into farmfit/public if writable
const farmfitOut = path.join(farmfit, 'public', 'crops-export.json');
try {
  fs.mkdirSync(path.dirname(farmfitOut), { recursive: true });
  fs.writeFileSync(farmfitOut, JSON.stringify(payload, null, 2));
  console.log('Also wrote', farmfitOut);
} catch (e) {
  console.warn('Could not write farmfit public export:', e.message);
}

/** Best-effort extract of {...} objects from TS modules (not a full parser). */
function extractObjectLiterals(text) {
  const results = [];
  // Prefer array assignments: export const X = [ {...}, {...} ]
  const arrayMatch = text.match(/=\s*\[([\s\S]*?)\]\s*;?\s*$/m);
  const body = arrayMatch ? arrayMatch[1] : text;
  let i = 0;
  while (i < body.length) {
    if (body[i] === '{') {
      const end = matchBrace(body, i);
      if (end > i) {
        const slice = body.slice(i, end + 1);
        if (/common_name|scientific_name|name:|latin|hardiness|zone|id:/.test(slice)) {
          const obj = looseEvalObject(slice);
          if (obj && typeof obj === 'object') results.push(obj);
        }
        i = end + 1;
        continue;
      }
    }
    i++;
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

function looseEvalObject(slice) {
  // Convert TS object literal toward JSON
  let s = slice
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(\w+)\s*:/g, '"$1":') // quote keys
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\bundefined\b/g, 'null')
    .replace(/\btrue\b/g, 'true')
    .replace(/\bfalse\b/g, 'false');
  // Remove trailing commas again
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

function normalizeFarmfitRecord(o, file) {
  const common =
    o.common_name || o.commonName || o.name || o.label || o.title;
  const scientific =
    o.scientific_name || o.scientificName || o.latin || o.species || o.taxon;
  if (!common && !scientific) return null;

  const id =
    o.id ||
    o.slug ||
    slug(common || scientific);

  // Map farmfit / EcoCrop-ish fields
  const hardiness_min =
    o.hardiness_min ||
    o.zone_min ||
    o.minHardinessZone ||
    zoneFromTemp(o.temp_min ?? o.tmin) ||
    '4a';
  const hardiness_max =
    o.hardiness_max ||
    o.zone_max ||
    o.maxHardinessZone ||
    zoneFromTemp(o.temp_max ?? o.tmax, true) ||
    '8a';

  const crop = {
    id,
    common_name: common || scientific,
    scientific_name: scientific || null,
    category: mapCategory(o),
    guild_layer: o.guild_layer || o.layer || o.canopy_layer || 'herbaceous',
    hardiness_min: String(hardiness_min).toLowerCase(),
    hardiness_max: String(hardiness_max).toLowerCase(),
    frost_free_min_days:
      num(o.frost_free_min_days ?? o.min_ffd ?? o.growing_days_min) ?? 100,
    precip_min_mm: num(o.precip_min_mm ?? o.rainfall_min ?? o.rain_min) ?? 300,
    precip_max_mm: num(o.precip_max_mm ?? o.rainfall_max ?? o.rain_max) ?? 1200,
    ph_min: num(o.ph_min ?? o.phMin) ?? 5.5,
    ph_max: num(o.ph_max ?? o.phMax) ?? 7.5,
    textures: arr(o.textures || o.soil_textures || o.soilTexture) || [
      'loam',
      'sandy_loam',
      'silt_loam',
    ],
    drainage: arr(o.drainage || o.drainage_classes) || [
      'well',
      'moderately_well',
    ],
    chinook_sensitive: !!(o.chinook_sensitive ?? o.early_flowering),
    alberta_native: !!(o.alberta_native || o.native_alberta || o.nativeAB),
    notes: o.notes || o.description || `Exported from farmfit (${file})`,
    source_file: file,
  };

  // Pull farmfit economic / price-ladder fields when present
  const econ = extractEconomics(o);
  if (econ) crop.economics = econ;
  return crop;
}

function extractEconomics(o) {
  const y =
    o.yield_kg_per_ha ||
    o.yieldKgPerHa ||
    o.yield ||
    o.expected_yield;
  const w =
    o.price_wholesale_cad_per_kg ||
    o.wholesale_price ||
    o.price_wholesale ||
    o.priceLadder?.wholesale;
  const r =
    o.price_retail_cad_per_kg ||
    o.retail_price ||
    o.price_retail ||
    o.priceLadder?.retail;
  const channels =
    o.market_channels || o.channels || o.selling_channels || o.markets;

  const has =
    y != null ||
    w != null ||
    r != null ||
    (Array.isArray(channels) && channels.length);
  if (!has) return null;

  return {
    yield_kg_per_ha: normalizeRange(y),
    price_wholesale_cad_per_kg: normalizeRange(w),
    price_retail_cad_per_kg: normalizeRange(r),
    unit: o.unit || o.yield_unit || 'kg',
    market_channels: arr(channels) || [],
    establishment_years: num(o.establishment_years ?? o.years_to_yield),
    labour_intensity: o.labour_intensity || o.labor || null,
    non_cash_value: o.non_cash_value || null,
  };
}

function normalizeRange(v) {
  if (v == null) return null;
  if (typeof v === 'number') return { low: v, high: v };
  if (typeof v === 'object') {
    const low = num(v.low ?? v.min ?? v[0]);
    const high = num(v.high ?? v.max ?? v[1]);
    if (low == null && high == null) return null;
    return { low: low ?? high, high: high ?? low };
  }
  const n = num(v);
  return n == null ? null : { low: n, high: n };
}

function mapCategory(o) {
  const c = String(o.category || o.type || o.group || '').toLowerCase();
  if (/medicin|herbal|pharma/.test(c)) return 'medicinal';
  if (/cover|green.?manure|legume.?cover/.test(c)) return 'cover_crop';
  if (/tree|canopy|orchard/.test(c)) return 'tree';
  if (/shrub|berry|bush/.test(c)) return 'shrub';
  if (/annual|veg|vegetable/.test(c)) return 'annual';
  if (/perenn/.test(c)) return 'perennial';
  if (o.life_cycle === 'annual') return 'annual';
  if (o.life_cycle === 'perennial') return 'perennial';
  return c || 'perennial';
}

function isColdClimateRelevant(c) {
  // Drop clearly tropical / hot-only crops
  const zMin = zoneRank(c.hardiness_min);
  // If plant needs warmer than zone 7 as minimum, skip for Alberta reports
  if (zMin >= zoneRank('8a')) return false;
  const name = `${c.common_name} ${c.scientific_name || ''}`.toLowerCase();
  const tropicalHints =
    /banana|mango|papaya|cacao|coffee|coconut|cassava|taro|breadfruit|durian|rambutan|lychee|longan|vanilla|black pepper|cinnamon|clove|pineapple|avocado|citrus(?!.*hardy)|orange|lemon|lime|guava|papaya|sugarcane|teak|rubber|oil palm|yam\b|sweet potato|manioc|passionfruit|dragon fruit|starfruit/;
  if (tropicalHints.test(name)) return false;
  // Prefer hardiness max that still includes cold-temperate
  return true;
}

function isAlbertaNativeName(c) {
  const name = `${c.common_name} ${c.scientific_name || ''}`.toLowerCase();
  return /saskatoon|amelanchier|chokecherry|prunus virginiana|pin cherry|prunus pensylvanica|buffalo.?berry|shepherdia|silverberry|elaeagnus commutata|wolf willow|rosa acicularis|prickly rose|cornus sericea|red.?osier|populus tremuloides|aspen|populus balsamifera|balsam poplar|picea glauca|white spruce|picea mariana|black spruce|larix laricina|tamarack|betula papyrifera|paper birch|pinus banksiana|jack pine|pinus contorta|lodgepole|salix\b|willow|viburnum edule|highbush cranberry|viburnum trilobum|sambucus racemosa|elder|vaccinium vitis|lingon|arctostaphylos|bearberry|fragaria virginiana|wild straw|rubus idaeus|wild rasp|heracleum|cow parsnip|achillea|yarrow|monarda fistulosa|bergamot|epilobium|fireweed|solidago|goldenrod|bouteloua|blue grama|koeleria|june grass|elymus|wheatgrass|carex|sedge|typha|cattail|lemna|nuphar|potamogeton|acer negundo|manitoba maple|quercus macrocarpa|bur oak|fraxinus pennsylvanica|green ash|ulmus americana|american elm/.test(
    name
  );
}

function zoneFromTemp(t, isMax = false) {
  // Rough USDA-ish mapping from absolute min temp °C
  if (t == null || !Number.isFinite(Number(t))) return null;
  const c = Number(t);
  if (c <= -45) return isMax ? '2a' : '1a';
  if (c <= -40) return isMax ? '3a' : '2a';
  if (c <= -35) return isMax ? '3b' : '2b';
  if (c <= -32) return isMax ? '4a' : '3a';
  if (c <= -29) return isMax ? '4b' : '3b';
  if (c <= -26) return isMax ? '5a' : '4a';
  if (c <= -23) return isMax ? '5b' : '4b';
  if (c <= -20) return isMax ? '6a' : '5a';
  if (c <= -18) return isMax ? '6b' : '5b';
  if (c <= -15) return isMax ? '7a' : '6a';
  if (c <= -12) return isMax ? '7b' : '6b';
  return isMax ? '9a' : '8a';
}

function zoneRank(z) {
  const order = [
    '1a','1b','2a','2b','3a','3b','4a','4b','5a','5b',
    '6a','6b','7a','7b','8a','8b','9a','9b',
  ];
  const s = String(z || '4a').toLowerCase();
  const i = order.indexOf(s);
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
function arr(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}
