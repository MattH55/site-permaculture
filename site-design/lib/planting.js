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

/**
 * @param {object} site — buildSiteRecord-like fields + climate/soil/terrain
 * @param {{ limit?: number }} opts
 */
export function planPlantings(site = {}, opts = {}) {
  const limit = opts.limit ?? 16;
  const crops = loadCatalog();
  const ctx = siteContext(site);

  const scored = crops
    .map((crop) => scoreCrop(crop, ctx))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.common_name.localeCompare(b.common_name));

  const top = scored.slice(0, limit);
  const byLayer = groupBy(top, (r) => r.guild_layer || 'other');
  const byCategory = groupBy(top, (r) => r.category || 'other');

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

  return {
    engine: 'ee-ecocrop-style-v1',
    growing_guide: {
      project: 'OpenSourceMed Growing Guide / farmfit',
      catalog_source: catalogCache?._source || 'alberta-catalog.json',
      notes:
        'Aligned with farmfit EcoCrop scoring approach. Swap in farmfit-export.json for full Growing Guide catalog.',
    },
    site_filters: {
      plant_hardiness_zone: ctx.zone,
      frost_free_days: ctx.ffd,
      annual_precipitation_mm: ctx.precip,
      texture: ctx.texture,
      drainage_class: ctx.drainage,
      chinook_exposure: ctx.chinook,
      successional_stage: succession || null,
    },
    phase_note,
    recommended: top,
    by_guild_layer: byLayer,
    by_category: byCategory,
    totals: {
      catalog_size: crops.length,
      scored_positive: scored.length,
      returned: top.length,
    },
  };
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

  // Early succession bonus for cover crops / N-fixers
  // (handled in phase_note; small score nudge)
  if (
    (crop.category === 'cover_crop' || crop.id === 'caragana' || crop.id === 'sea-buckthorn') &&
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
    score,
    suitability,
    reasons,
    limits,
    notes: crop.notes || null,
  };
}

function loadCatalog() {
  if (catalogCache) return catalogCache;

  const byId = new Map();
  const basePath = path.join(__dirname, '..', 'data', 'crops', 'alberta-catalog.json');
  loadInto(byId, basePath, 'alberta-catalog.json');

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
  return {
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
    notes: c.notes || c.description || null,
  };
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
