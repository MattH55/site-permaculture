/**
 * Planting plan scorer — EcoCrop-style suitability for Growing Guide / farmfit integration.
 *
 * Catalog load order:
 *  1. GROWING_GUIDE_CROPS_PATH (JSON export from farmfit)
 *  2. data/crops/farmfit-export.json
 *  3. data/crops/alberta-catalog.json (default)
 * Optional: GROWING_GUIDE_PATH → farmfit/src/lib/data not parsed (TS); use JSON export.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ZONE_ORDER = [
  '1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b', '5a', '5b',
  '6a', '6b', '7a', '7b', '8a', '8b', '9a', '9b',
];

let catalogCache = null;
let catalogSourceLabel = 'alberta-catalog.json';
let economicsCache = null;

/**
 * @param {object} site — buildSiteRecord-like fields + climate/soil/terrain
 * @param {{ limit?: number }} opts
 */
export function planPlantings(site = {}, opts = {}) {
  const limit = opts.limit ?? 16;
  const crops = loadCatalog();
  const economics = loadEconomics();
  const ctx = siteContext(site);
  const areaHa = Math.max(num(site.footprint_ha) || 0.1, 0.01);

  const scored = crops
    .map((crop) => {
      const row = scoreCrop(crop, ctx);
      row.economics = attachEconomics(
        crop.id,
        economics,
        areaHa,
        row.score,
        crop._inline_economics
      );
      return row;
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.common_name.localeCompare(b.common_name));

  const top = scored.slice(0, limit);
  const byLayer = groupBy(top, (r) => r.guild_layer || 'other');
  const byCategory = groupBy(top, (r) => r.category || 'other');

  // Cash-crop shortlist for planning (has wholesale price)
  const cash = top
    .filter((r) => r.economics?.gross_revenue_cad?.mid != null && r.economics.gross_revenue_cad.mid > 0)
    .slice()
    .sort(
      (a, b) =>
        (b.economics.gross_revenue_cad.mid || 0) - (a.economics.gross_revenue_cad.mid || 0)
    );

  // Succession-aware framing
  const succession = site.existing_vegetation?.successional_stage;
  let phase_note =
    'Scores are EcoCrop-style matches to hardiness, frost-free days, precipitation, texture, and drainage.';
  if (succession === 'pioneer' || succession === 'early_successional') {
    phase_note +=
      ' Site is early succession: prioritize cover crops and N-fixers before full canopy food forest.';
  } else if (succession === 'mid_successional' || succession === 'climax') {
    phase_note +=
      ' Succession allows layered food-forest guilds filtered by hardiness.';
  }
  if (ctx.chinook) {
    phase_note +=
      ' Chinook exposure: deprioritize early-flowering woody species even if hardiness matches.';
  }
  phase_note +=
    ' Economics are farmfit-style price-ladder planning ranges (CAD), scaled to your parcel area — not a business plan.';

  return {
    engine: 'ee-ecocrop-style-v1-economics',
    growing_guide: {
      project: 'OpenSourceMed Growing Guide / farmfit',
      catalog_source: catalogCache?._source || 'alberta-catalog.json',
      economics_source: economics?._source || 'economics.json',
      notes:
        'Aligned with farmfit EcoCrop + price-ladder approach. Export farmfit crops/prices when available.',
    },
    site_filters: {
      plant_hardiness_zone: ctx.zone,
      frost_free_days: ctx.ffd,
      annual_precipitation_mm: ctx.precip,
      texture: ctx.texture,
      drainage_class: ctx.drainage,
      chinook_exposure: ctx.chinook,
      successional_stage: succession || null,
      footprint_ha: areaHa,
    },
    phase_note,
    economics_disclaimer:
      economics?.disclaimer ||
      'Indicative CAD price and yield ranges for planning only. Confirm markets before planting at scale.',
    recommended: top,
    top_cash_crops: cash.slice(0, 6).map((r) => ({
      id: r.id,
      common_name: r.common_name,
      score: r.score,
      suitability: r.suitability,
      economics: r.economics,
    })),
    by_guild_layer: byLayer,
    by_category: byCategory,
    totals: {
      catalog_size: crops.length,
      scored_positive: scored.length,
      returned: top.length,
      with_economics: top.filter((r) => r.economics).length,
    },
  };
}

function loadEconomics() {
  if (economicsCache) return economicsCache;
  const p = path.join(__dirname, '..', 'data', 'crops', 'economics.json');
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      economicsCache = {
        items: raw.items || raw || {},
        disclaimer: raw.disclaimer,
        currency: raw.currency || 'CAD',
        year: raw.year,
        _source: 'economics.json',
      };
      // Optional overlay from farmfit export economics
      const farmfitEcon = path.join(__dirname, '..', 'data', 'crops', 'farmfit-economics.json');
      if (fs.existsSync(farmfitEcon)) {
        const fe = JSON.parse(fs.readFileSync(farmfitEcon, 'utf8'));
        const items = fe.items || fe;
        economicsCache.items = { ...economicsCache.items, ...items };
        economicsCache._source = 'economics.json + farmfit-economics.json';
      }
      return economicsCache;
    }
  } catch (e) {
    console.warn('economics load failed', e.message);
  }
  economicsCache = { items: {}, _source: 'none' };
  return economicsCache;
}

/**
 * farmfit-style price ladder → parcel-scaled gross revenue range.
 * Revenue is gross only (no establishment/labour costs).
 */
function attachEconomics(cropId, economics, areaHa, suitabilityScore, inlineEcon) {
  const e = {
    ...(economics?.items?.[cropId] || {}),
    ...(inlineEcon || {}),
  };
  if (!e || (!e.yield_kg_per_ha && !e.price_wholesale_cad_per_kg && !e.non_cash_value && !e.price_retail_cad_per_kg)) {
    return null;
  }

  const yLo = rangeVal(e.yield_kg_per_ha, 'low');
  const yHi = rangeVal(e.yield_kg_per_ha, 'high');
  const wLo = rangeVal(e.price_wholesale_cad_per_kg, 'low');
  const wHi = rangeVal(e.price_wholesale_cad_per_kg, 'high');
  const rLo = rangeVal(e.price_retail_cad_per_kg, 'low');
  const rHi = rangeVal(e.price_retail_cad_per_kg, 'high');

  const hasCash =
    yHi > 0 && ((wHi > 0 && wLo > 0) || (rHi > 0 && rLo > 0));

  // Suitability dampens yield expectation (marginal sites → lower expected yield)
  const suitFactor =
    suitabilityScore >= 80 ? 1 : suitabilityScore >= 65 ? 0.9 : suitabilityScore >= 50 ? 0.75 : 0.55;

  const yieldParcel = hasCash
    ? {
        low_kg: round1(yLo * areaHa * suitFactor),
        high_kg: round1(yHi * areaHa * suitFactor),
      }
    : null;

  const grossWholesale = hasCash && wHi > 0
    ? {
        low: round0(yLo * areaHa * suitFactor * wLo),
        high: round0(yHi * areaHa * suitFactor * wHi),
        mid: round0(((yLo + yHi) / 2) * areaHa * suitFactor * ((wLo + wHi) / 2)),
      }
    : null;

  const grossRetail = hasCash && rHi > 0
    ? {
        low: round0(yLo * areaHa * suitFactor * rLo),
        high: round0(yHi * areaHa * suitFactor * rHi),
        mid: round0(((yLo + yHi) / 2) * areaHa * suitFactor * ((rLo + rHi) / 2)),
      }
    : null;

  // Prefer wholesale for "planning mid" when both exist
  const gross_revenue_cad = grossWholesale || grossRetail;

  // farmfit processing ladder value-add (e.g. dried → tincture)
  const ladder = Array.isArray(e.processing_ladder) ? e.processing_ladder : [];
  const topStep = ladder.length ? ladder[ladder.length - 1] : null;
  const valueAdd =
    grossWholesale && topStep?.value_add_multiplier > 1
      ? {
          product: topStep.output_product || topStep.name,
          multiplier: topStep.value_add_multiplier,
          gross_mid_cad: round0(
            (grossWholesale.mid || 0) * Number(topStep.value_add_multiplier)
          ),
        }
      : null;

  return {
    currency: economics.currency || 'CAD',
    unit: e.unit || 'kg',
    yield_kg_per_ha: e.yield_kg_per_ha || null,
    price_wholesale_cad_per_kg: e.price_wholesale_cad_per_kg || null,
    price_retail_cad_per_kg: e.price_retail_cad_per_kg || null,
    market_channels: e.market_channels || [],
    establishment_years: e.establishment_years ?? null,
    labour_intensity: e.labour_intensity || null,
    non_cash_value: e.non_cash_value || null,
    processing_ladder: ladder,
    value_add: valueAdd,
    parcel_area_ha: round2(areaHa),
    suitability_yield_factor: suitFactor,
    yield_on_parcel_kg: yieldParcel,
    gross_revenue_wholesale_cad: grossWholesale,
    gross_revenue_retail_cad: grossRetail,
    gross_revenue_cad,
    notes:
      'Gross revenue before labour, establishment, packaging, and marketing. Establishment may take multiple years for perennials. Farmfit price ladder / FAOSTAT benchmarks where noted.',
  };
}

function rangeVal(r, which) {
  if (r == null) return 0;
  if (typeof r === 'number') return r;
  return num(r[which]) ?? 0;
}

function round0(n) {
  return Math.round(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

function siteContext(site) {
  const climate = site.climate || {};
  const soil = site.soil || {};
  return {
    zone: normalizeZone(climate.plant_hardiness_zone) || '3a',
    ffd: num(climate.frost_free_days) ?? 120,
    precip: num(site.hydrology?.annual_precipitation_mm) ?? num(climate.annual_precipitation_mm) ?? 450,
    ph: num(soil.ph),
    texture: soil.texture || 'loam',
    drainage: soil.drainage_class || 'well',
    chinook: climate.chinook_exposure === true,
  };
}

function scoreCrop(crop, ctx) {
  const reasons = [];
  const limits = [];
  let score = 100;

  // Hardiness: site zone must be >= crop hardiness_min (warmer or equal)
  const zSite = zoneIndex(ctx.zone);
  const zMin = zoneIndex(crop.hardiness_min);
  const zMax = zoneIndex(crop.hardiness_max);
  if (zSite < zMin) {
    score -= 55;
    limits.push(`Too cold: site ${ctx.zone} < min ${crop.hardiness_min}`);
  } else if (zSite > zMax + 2) {
    score -= 15;
    reasons.push(`Warmer than typical max ${crop.hardiness_max}`);
  } else {
    reasons.push(`Hardiness OK (${crop.hardiness_min}–${crop.hardiness_max})`);
  }

  // Frost-free days
  const ffdMin = num(crop.frost_free_min_days) ?? 90;
  if (ctx.ffd < ffdMin - 20) {
    score -= 40;
    limits.push(`Short season: ${ctx.ffd} FFD < ~${ffdMin} needed`);
  } else if (ctx.ffd < ffdMin) {
    score -= 15;
    limits.push(`Marginal season: ${ctx.ffd} FFD vs ${ffdMin} preferred`);
  } else {
    reasons.push(`Season length OK (${ctx.ffd} FFD)`);
  }

  // Precipitation
  const pMin = num(crop.precip_min_mm);
  const pMax = num(crop.precip_max_mm);
  if (pMin != null && ctx.precip < pMin - 100) {
    score -= 30;
    limits.push(`Dry: ${ctx.precip} mm < ${pMin} mm min`);
  } else if (pMin != null && ctx.precip < pMin) {
    score -= 10;
    limits.push(`Somewhat dry vs ${pMin} mm`);
  } else if (pMax != null && ctx.precip > pMax + 200) {
    score -= 15;
    limits.push(`Wet: ${ctx.precip} mm > ${pMax} mm max`);
  } else {
    reasons.push(`Precip OK (~${ctx.precip} mm)`);
  }

  // Texture
  const textures = crop.textures || [];
  if (textures.length && ctx.texture) {
    if (textures.includes(ctx.texture)) {
      reasons.push(`Texture match (${ctx.texture})`);
    } else {
      score -= 20;
      limits.push(`Texture ${ctx.texture} not ideal`);
    }
  }

  // Drainage
  const drains = crop.drainage || [];
  if (drains.length && ctx.drainage) {
    if (drains.includes(ctx.drainage)) {
      reasons.push(`Drainage match (${ctx.drainage})`);
    } else {
      score -= 18;
      limits.push(`Drainage ${ctx.drainage} not ideal`);
    }
  }

  // pH if known
  if (ctx.ph != null && crop.ph_min != null && crop.ph_max != null) {
    if (ctx.ph < crop.ph_min - 0.5 || ctx.ph > crop.ph_max + 0.5) {
      score -= 12;
      limits.push(`pH ${ctx.ph} outside ${crop.ph_min}–${crop.ph_max}`);
    } else {
      reasons.push(`pH OK`);
    }
  }

  // Chinook
  if (ctx.chinook && crop.chinook_sensitive) {
    score -= 25;
    limits.push('Chinook-sensitive woody / early flower');
  }

  // Reject / heavily penalize tropical-leaning crops for Alberta sites
  if (isTropicalLeaning(crop)) {
    score -= 50;
    limits.push('Tropical / warm-climate crop — not suited to Alberta parkland/boreal');
  }

  // Prefer Alberta natives and cold-hardy region focus
  if (crop.alberta_native) {
    score += 8;
    reasons.push('Alberta native / naturalized prairie-boreal species');
  } else if (crop.region_focus === 'alberta' || crop.region_focus === 'cold_temperate') {
    score += 3;
  }

  // Early succession bonus for cover crops / N-fixers
  if (
    (crop.category === 'cover_crop' ||
      crop.id === 'caragana' ||
      crop.id === 'sea-buckthorn' ||
      crop.id === 'wolf-willow' ||
      crop.id === 'buffalo-berry') &&
    score > 40
  ) {
    score += 3;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const suitability =
    score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'fair' : score >= 35 ? 'marginal' : 'poor';

  return {
    id: crop.id,
    common_name: crop.common_name,
    scientific_name: crop.scientific_name || null,
    category: crop.category,
    guild_layer: crop.guild_layer,
    alberta_native: !!crop.alberta_native,
    score,
    suitability,
    reasons,
    limits,
    notes: crop.notes || null,
  };
}

function isTropicalLeaning(crop) {
  const zMin = zoneIndex(crop.hardiness_min);
  // Minimum hardiness zone 8+ means too warm for AB
  if (zMin >= zoneIndex('8a')) return true;
  const name = `${crop.common_name || ''} ${crop.scientific_name || ''}`.toLowerCase();
  return /banana|mango|papaya|cacao|coffee|coconut|cassava|taro|breadfruit|durian|rambutan|lychee|vanilla|pineapple|avocado|guava|sugarcane|teak|rubber|oil palm|passionfruit|dragon fruit|starfruit|manioc|yam\b|citrus|orange tree|lemon tree|lime tree/.test(
    name
  );
}

function loadCatalog() {
  if (catalogCache) return catalogCache;

  const byId = new Map();
  const basePath = path.join(__dirname, '..', 'data', 'crops', 'alberta-catalog.json');
  loadInto(byId, basePath, 'alberta-catalog.json');

  // Alberta natives / prairie-hardy pack (overrides same ids, adds many natives)
  const nativesPath = path.join(__dirname, '..', 'data', 'crops', 'alberta-natives.json');
  loadInto(byId, nativesPath, 'alberta-natives.json');

  const farmfitLocal = path.join(__dirname, '..', 'data', 'crops', 'farmfit-export.json');
  loadInto(byId, farmfitLocal, 'farmfit-export.json');

  if (process.env.GROWING_GUIDE_CROPS_PATH) {
    loadInto(byId, process.env.GROWING_GUIDE_CROPS_PATH, process.env.GROWING_GUIDE_CROPS_PATH);
  }

  // Optional: auto-discover farmfit-export next to Growing Guide path
  const gg = process.env.GROWING_GUIDE_PATH;
  if (gg) {
    const candidates = [
      path.join(gg, 'farmfit', 'data', 'crops-export.json'),
      path.join(gg, 'farmfit', 'public', 'crops-export.json'),
      path.join(gg, 'crops-export.json'),
    ];
    for (const c of candidates) loadInto(byId, c, c);
  }

  catalogCache = [...byId.values()];
  catalogCache._source = catalogSourceLabel;
  return catalogCache;
}

function loadInto(map, filePath, label) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.crops || raw.plants || [];
    let n = 0;
    for (const c of list) {
      if (!c?.id && !c?.common_name) continue;
      const id = c.id || slug(c.common_name || c.scientific_name);
      map.set(id, normalizeCrop({ ...c, id }));
      n++;
    }
    if (n) catalogSourceLabel = label;
  } catch (e) {
    console.warn('crop catalog load failed', filePath, e.message);
  }
}

function normalizeCrop(c) {
  const crop = {
    id: c.id,
    common_name: c.common_name || c.name || c.id,
    scientific_name: c.scientific_name || c.latin || null,
    category: c.category || c.type || 'perennial',
    guild_layer: c.guild_layer || c.layer || 'herbaceous',
    hardiness_min: normalizeZone(c.hardiness_min || c.zone_min || '3a'),
    hardiness_max: normalizeZone(c.hardiness_max || c.zone_max || '7a'),
    frost_free_min_days: num(c.frost_free_min_days ?? c.min_ffd),
    precip_min_mm: num(c.precip_min_mm ?? c.rainfall_min),
    precip_max_mm: num(c.precip_max_mm ?? c.rainfall_max),
    ph_min: num(c.ph_min),
    ph_max: num(c.ph_max),
    textures: c.textures || c.soil_textures || [],
    drainage: c.drainage || c.drainage_classes || [],
    chinook_sensitive: !!c.chinook_sensitive,
    alberta_native: !!(c.alberta_native || c.native_alberta),
    region_focus: c.region_focus || (c.alberta_native ? 'alberta' : null),
    notes: c.notes || c.description || null,
  };
  if (c.economics) crop._inline_economics = c.economics;
  return crop;
}

function normalizeZone(z) {
  if (!z) return null;
  const s = String(z).trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})([ab])?$/);
  if (!m) return s;
  return `${m[1]}${m[2] || 'a'}`;
}

function zoneIndex(z) {
  const n = normalizeZone(z);
  const i = ZONE_ORDER.indexOf(n);
  if (i >= 0) return i;
  const m = String(n || '').match(/^(\d+)/);
  return m ? ZONE_ORDER.indexOf(`${m[1]}a`) : 6;
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item) || 'other';
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
