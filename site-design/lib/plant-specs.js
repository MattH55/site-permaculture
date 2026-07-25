/**
 * Plant growing specifications stack:
 *  1. Permapeople — primary open API (permaculture layers, light/water, edible)
 *  2. PFAF — richest temperate content via local SQLite (offline community mirror)
 *  3. USDA PLANTS — public domain NA range, hardiness, soils, Alberta occurrence
 *  4. Perenual — optional freemium fallback (env PERENUAL_API_KEY)
 *
 * Cache: data/crops/plant-specs.json (built by scripts/enrich-plant-specs.mjs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'data', 'crops', 'plant-specs.json');

const USDA_BASE = 'https://plantsservices.sc.egov.usda.gov/api';
const PERMA_BASE = 'https://permapeople.org/api';
const PERENUAL_BASE = 'https://perenual.com/api';

const UA =
  'ExpandingEdgeSiteDesign/1.0 (Alberta permaculture site design; plant-spec enrichment; +https://www.expandingedge.ca)';

let cache = null;

/**
 * Load offline plant-specs cache (keyed by crop id and scientific name).
 */
export function loadPlantSpecsCache() {
  if (cache) return cache;
  if (!fs.existsSync(CACHE_PATH)) {
    cache = { by_id: {}, by_scientific: {}, meta: { empty: true } };
    return cache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    cache = {
      by_id: raw.by_id || {},
      by_scientific: indexByScientific(raw.by_id || raw.specs || {}),
      meta: raw.meta || {},
    };
  } catch (e) {
    console.warn('plant-specs cache load failed', e.message);
    cache = { by_id: {}, by_scientific: {}, meta: { error: e.message } };
  }
  return cache;
}

function indexByScientific(byId) {
  const map = {};
  for (const [id, spec] of Object.entries(byId)) {
    const key = normSci(spec.scientific_name);
    if (!key) continue;
    if (!map[key] || rankSource(spec.spec_source) > rankSource(map[key].spec_source)) {
      map[key] = { ...spec, id };
    }
  }
  return map;
}

function rankSource(src) {
  const s = String(src || '');
  // Multi-source combos rank highest
  if (s.includes('permapeople') && s.includes('pfaf') && s.includes('usda')) return 7;
  if (s.includes('permapeople') && s.includes('usda')) return 6;
  if (s.includes('pfaf') && s.includes('usda')) return 5;
  if (s.includes('permapeople') && s.includes('pfaf')) return 5;
  if (s === 'permapeople' || s.includes('permapeople')) return 4;
  if (s === 'pfaf' || s.includes('pfaf')) return 4;
  if (s === 'usda_plants' || s.includes('usda')) return 3;
  if (s === 'perenual') return 2;
  if (s === 'curated') return 2;
  if (s === 'inferred') return 1;
  return 0;
}

/**
 * Merge plant-spec overlay onto a crop record (does not mutate if no match).
 */
export function applyPlantSpecs(crop) {
  const c = loadPlantSpecsCache();
  const byId = c.by_id[crop.id];
  const bySci = crop.scientific_name
    ? c.by_scientific[normSci(crop.scientific_name)]
    : null;
  const spec = pickBetterSpec(byId, bySci);
  if (!spec) return crop;

  return mergeSpecOntoCrop(crop, spec);
}

function pickBetterSpec(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return rankSource(a.spec_source) >= rankSource(b.spec_source) ? a : b;
}

/**
 * Overlay authoritative specs onto crop; never wipe curated hardiness with weaker data
 * unless source is stronger than crop's existing spec_source.
 */
export function mergeSpecOntoCrop(crop, spec) {
  const existingRank = rankSource(crop.spec_source || (crop._vendor_product ? 'inferred' : 'curated'));
  const incomingRank = rankSource(spec.spec_source);
  // Always attach cross-ref metadata
  const out = {
    ...crop,
    plant_specs: {
      ...(crop.plant_specs || {}),
      ...spec,
    },
  };

  // Prefer stronger source for grow fields
  if (incomingRank >= existingRank || !crop.spec_source) {
    // Never replace a colder curated/inferred min with a much warmer USDA mis-read
    if (spec.hardiness_min) {
      const prev = out.hardiness_min;
      if (
        !prev ||
        zoneIndexSafe(spec.hardiness_min) <= zoneIndexSafe(prev) + 1 ||
        existingRank < incomingRank
      ) {
        // Allow upgrade when new source is stronger, but cap absurd warm jumps on curated
        if (
          crop.spec_source === 'curated' &&
          prev &&
          zoneIndexSafe(spec.hardiness_min) > zoneIndexSafe(prev) + 2
        ) {
          /* keep curated colder min */
        } else {
          out.hardiness_min = spec.hardiness_min;
        }
      }
    }
    if (spec.hardiness_max) out.hardiness_max = spec.hardiness_max;
    if (spec.frost_free_min_days != null) out.frost_free_min_days = spec.frost_free_min_days;
    if (spec.precip_min_mm != null) out.precip_min_mm = spec.precip_min_mm;
    if (spec.precip_max_mm != null) out.precip_max_mm = spec.precip_max_mm;
    if (spec.ph_min != null) out.ph_min = spec.ph_min;
    if (spec.ph_max != null) out.ph_max = spec.ph_max;
    if (spec.textures?.length) out.textures = spec.textures;
    if (spec.drainage?.length) out.drainage = spec.drainage;
    if (spec.guild_layer) out.guild_layer = spec.guild_layer;
    if (spec.category) out.category = spec.category;
    if (spec.light_requirement) out.light_requirement = spec.light_requirement;
    if (spec.water_requirement) out.water_requirement = spec.water_requirement;
    if (spec.growth_rate) out.growth_rate = spec.growth_rate;
    if (spec.nitrogen_fixer != null) out.nitrogen_fixer = spec.nitrogen_fixer;
    if (spec.edible != null) out.edible = spec.edible;
    if (spec.edible_parts) out.edible_parts = spec.edible_parts;
    if (spec.edibility_rating != null) out.edibility_rating = spec.edibility_rating;
    if (spec.medicinal_rating != null) out.medicinal_rating = spec.medicinal_rating;
    if (spec.food_forest != null) out.food_forest = spec.food_forest;
    if (spec.ground_cover != null) out.ground_cover = spec.ground_cover;
    if (spec.dynamic_accumulator != null)
      out.dynamic_accumulator = spec.dynamic_accumulator;
    if (spec.special_uses) out.special_uses = spec.special_uses;
    if (spec.height_m != null) out.height_m = spec.height_m;
    if (spec.companions) out.companions = spec.companions;
    if (spec.alberta_in_range != null) {
      // USDA range hit for Alberta is a strong native/viable signal, not always "native"
      out.alberta_in_range = spec.alberta_in_range;
      if (spec.alberta_in_range && spec.canada_native) out.alberta_native = true;
    }
    out.spec_source = spec.spec_source;
    out.spec_confidence = spec.spec_confidence || confidenceFor(spec.spec_source);
  } else {
    out.spec_source = crop.spec_source || 'curated';
    out.spec_confidence = crop.spec_confidence || 'high';
    // Still expose secondary cross-check under plant_specs
  }

  if (spec.scientific_name && !out.scientific_name) {
    out.scientific_name = spec.scientific_name;
  }
  if (spec.notes) {
    out.notes = [out.notes, spec.notes].filter(Boolean).join(' ').slice(0, 500);
  }
  return out;
}

function confidenceFor(src) {
  const s = String(src || '');
  if (s.includes('permapeople') && s.includes('usda')) return 'high';
  if (s.includes('pfaf') && s.includes('usda')) return 'high';
  if (
    s === 'permapeople' ||
    s === 'pfaf' ||
    s === 'usda_plants' ||
    s === 'curated'
  )
    return 'high';
  if (s === 'inferred' || s === 'perenual') return 'low';
  return 'moderate';
}

/* ---------- Live fetchers (used by enrich script) ---------- */

export function hasPermapeopleKeys() {
  return !!(
    process.env.PERMAPEOPLE_KEY_ID &&
    process.env.PERMAPEOPLE_KEY_SECRET
  );
}

export async function searchPermapeople(query) {
  if (!hasPermapeopleKeys()) {
    return { ok: false, error: 'missing_api_keys', plants: [] };
  }
  const url = `${PERMA_BASE}/search?q=${encodeURIComponent(query)}&per_page=10`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'x-permapeople-key-id': process.env.PERMAPEOPLE_KEY_ID,
      'x-permapeople-key-secret': process.env.PERMAPEOPLE_KEY_SECRET,
    },
  });
  if (!r.ok) {
    return { ok: false, error: `HTTP ${r.status}`, plants: [] };
  }
  const data = await r.json();
  return { ok: true, plants: data.plants || [], pagination: data.pagination };
}

export async function getPermapeoplePlant(id) {
  if (!hasPermapeopleKeys()) return null;
  const r = await fetch(`${PERMA_BASE}/plants/${id}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'x-permapeople-key-id': process.env.PERMAPEOPLE_KEY_ID,
      'x-permapeople-key-secret': process.env.PERMAPEOPLE_KEY_SECRET,
    },
  });
  if (!r.ok) return null;
  return r.json();
}

export async function searchUsdaByScientific(scientificName) {
  const q = stripAuthors(scientificName);
  const url = `${USDA_BASE}/PlantSearch?searchText=${encodeURIComponent(q)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`USDA search HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return null;

  // Prefer exact scientific match (without author)
  const target = normSci(q);
  let best = null;
  for (const row of list) {
    const plant = row.Plant || row;
    const sci = stripHtml(plant.ScientificName || '');
    const key = normSci(sci);
    if (key === target || key.startsWith(target + ' ')) {
      best = plant;
      break;
    }
    if (!best && key.includes(target.split(' ')[0] || '')) best = plant;
  }
  best = best || list[0].Plant || list[0];
  return best;
}

export async function fetchUsdaProfile(symbol) {
  const r = await fetch(
    `${USDA_BASE}/PlantProfile?symbol=${encodeURIComponent(symbol)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } }
  );
  if (!r.ok) throw new Error(`USDA profile HTTP ${r.status}`);
  return r.json();
}

export async function fetchUsdaCharacteristics(plantId) {
  const r = await fetch(`${USDA_BASE}/PlantCharacteristics/${plantId}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return [];
  return r.json();
}

export async function fetchUsdaCanadaLocations(symbol) {
  const r = await fetch(
    `${USDA_BASE}/StateSearch?symbol=${encodeURIComponent(symbol)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' } }
  );
  if (!r.ok) return [];
  const data = await r.json();
  return (data.Locations || []).filter(
    (l) => l.PlantLocationCategory === 'Canada'
  );
}

/**
 * Build a unified plant-spec object from Permapeople + PFAF + USDA (+ optional Perenual).
 */
export function buildSpecFromSources({
  crop,
  usda,
  usdaChars,
  canadaLocs,
  perma,
  pfaf,
  perenual,
}) {
  // Prefer species-level characteristics (CultivarName null) over cultivar rows
  const charMap = {};
  const sortedChars = [...(usdaChars || [])].sort((a, b) => {
    const ac = a.CultivarName ? 1 : 0;
    const bc = b.CultivarName ? 1 : 0;
    return ac - bc;
  });
  for (const c of sortedChars) {
    if (!c.CultivarName || charMap[c.PlantCharacteristicName] == null) {
      charMap[c.PlantCharacteristicName] = c.PlantCharacteristicValue;
    }
  }

  const permaData = {};
  if (perma?.data) {
    for (const d of perma.data) {
      if (d?.key) permaData[d.key] = d.value;
    }
  }

  // Hardiness: Permapeople → PFAF → USDA cold min temp
  let hardiness_min = null;
  let hardiness_max = null;
  const permaZone = permaData['USDA Hardiness zone'] || permaData['Hardiness zone'];
  if (permaZone) {
    const parsed = parseZoneRange(permaZone);
    hardiness_min = parsed.min;
    hardiness_max = parsed.max;
  }
  if ((!hardiness_min || !hardiness_max) && pfaf?.hardiness_min) {
    hardiness_min = hardiness_min || pfaf.hardiness_min;
    hardiness_max = hardiness_max || pfaf.hardiness_max;
  }
  const durations = (usda?.Durations || []).join(' ').toLowerCase();
  const habits = (usda?.GrowthHabits || []).join(' ').toLowerCase();
  const isWoodyOrPerennial =
    /tree|shrub|subshrub|vine/i.test(habits) ||
    /perennial|biennial/i.test(durations) ||
    (pfaf && !/annual/i.test(pfaf.habit || ''));
  if (!hardiness_min && charMap['Temperature, Minimum (°F)'] != null) {
    const t = Number(charMap['Temperature, Minimum (°F)']);
    if (Number.isFinite(t) && t <= 20 && isWoodyOrPerennial) {
      hardiness_min = minTempFToZone(t);
      hardiness_max = hardiness_max || '7a';
    }
  }
  if (!hardiness_min && perenual?.hardiness_min != null) {
    hardiness_min = `${perenual.hardiness_min}a`;
    if (perenual.hardiness_max != null) hardiness_max = `${perenual.hardiness_max}b`;
  }

  let frost_free_min_days = null;
  if (charMap['Frost Free Days, Minimum'] != null) {
    frost_free_min_days = Number(charMap['Frost Free Days, Minimum']);
  }

  let precip_min_mm = null;
  let precip_max_mm = null;
  if (charMap['Precipitation, Minimum'] != null) {
    precip_min_mm = Math.round(Number(charMap['Precipitation, Minimum']) * 25.4);
  }
  if (charMap['Precipitation, Maximum'] != null) {
    precip_max_mm = Math.round(Number(charMap['Precipitation, Maximum']) * 25.4);
  }

  const ph_min = numOrNull(charMap['pH, Minimum']);
  const ph_max = numOrNull(charMap['pH, Maximum']);

  let textures = mapUsdaTextures(charMap);
  if (pfaf?.textures?.length) {
    for (const t of pfaf.textures) {
      if (!textures.includes(t)) textures.push(t);
    }
  }
  const soilType = permaData['Soil type'] || permaData['Soil Type'];
  if (soilType) {
    for (const t of mapPermaSoil(soilType)) {
      if (!textures.includes(t)) textures.push(t);
    }
  }

  let drainage = mapUsdaDrainage(charMap);
  if (pfaf?.drainage?.length) drainage = pfaf.drainage;

  const light_requirement =
    permaData['Light requirement'] ||
    pfaf?.light_requirement ||
    mapUsdaShade(charMap['Shade Tolerance']) ||
    (Array.isArray(perenual?.sunlight)
      ? perenual.sunlight.join(', ')
      : perenual?.sunlight) ||
    null;
  const water_requirement =
    permaData['Water requirement'] ||
    pfaf?.water_requirement ||
    mapUsdaMoisture(charMap['Moisture Use'], charMap['Drought Tolerance']) ||
    perenual?.watering ||
    null;

  const guild_layer =
    mapPermaLayer(permaData['Layer'] || permaData['layer']) ||
    pfaf?.guild_layer ||
    mapUsdaHabit(usda?.GrowthHabits || usda?.GrowthHabitName);

  const category =
    mapPermaCategory(permaData['Layer'], permaData['Life cycle']) ||
    pfaf?.category ||
    mapUsdaCategory(usda?.GrowthHabits, usda?.Durations);

  const canadaNames = (canadaLocs || []).map((l) => l.PlantLocationName);
  const alberta_in_range = canadaNames.some((n) => /alberta/i.test(n));
  const canada_native =
    (usda?.NativeStatuses || []).some(
      (s) => s.Region === 'CAN' && /native/i.test(s.Type || s.Status || '')
    ) || alberta_in_range;

  const nitrogen_fixer =
    pfaf?.nitrogen_fixer === true ||
    (/yes|low|medium|high/i.test(String(charMap['Nitrogen Fixation'] || '')) &&
      !/^none$/i.test(String(charMap['Nitrogen Fixation'] || '')));

  const edible =
    permaData['Edible'] === 'true' ||
    permaData['Edible'] === true ||
    pfaf?.edible === true ||
    charMap['Palatable Human'] === 'Yes' ||
    (pfaf?.edibility_rating != null && pfaf.edibility_rating > 0);

  const edible_parts = permaData['Edible parts'] || pfaf?.edible_parts || null;

  const sources = [];
  if (perma) sources.push('permapeople');
  if (pfaf) sources.push('pfaf');
  if (usda) sources.push('usda_plants');
  if (perenual && !sources.length) sources.push('perenual');
  const spec_source = sources.length > 1 ? sources.join('+') : sources[0] || 'inferred';

  const scientific =
    stripHtml(
      perma?.scientific_name ||
        pfaf?.latin_name ||
        usda?.ScientificNameWithoutAuthor ||
        usda?.ScientificName ||
        ''
    ) ||
    crop.scientific_name ||
    null;

  const height_m =
    pfaf?.height_m ??
    (charMap['Height, Mature (feet)'] != null
      ? Math.round(Number(charMap['Height, Mature (feet)']) * 0.3048 * 10) / 10
      : null);

  return {
    id: crop.id,
    common_name:
      perma?.name || pfaf?.common_name || usda?.CommonName || crop.common_name,
    scientific_name: scientific,
    spec_source,
    spec_confidence: confidenceFor(spec_source),
    hardiness_min,
    hardiness_max,
    frost_free_min_days: Number.isFinite(frost_free_min_days)
      ? frost_free_min_days
      : null,
    precip_min_mm,
    precip_max_mm,
    ph_min,
    ph_max,
    textures,
    drainage,
    guild_layer,
    category,
    light_requirement,
    water_requirement,
    growth_rate:
      permaData['Growth'] || pfaf?.growth || charMap['Growth Rate'] || null,
    nitrogen_fixer: nitrogen_fixer || null,
    edible: edible || null,
    edible_parts,
    edibility_rating: pfaf?.edibility_rating ?? null,
    medicinal_rating: pfaf?.medicinal_rating ?? null,
    other_uses_rating: pfaf?.other_uses_rating ?? null,
    food_forest: pfaf?.food_forest ?? null,
    ground_cover: pfaf?.ground_cover ?? null,
    dynamic_accumulator: pfaf?.dynamic_accumulator ?? null,
    special_uses: pfaf?.special_uses || null,
    known_hazards: pfaf?.known_hazards || null,
    shade_tolerance: charMap['Shade Tolerance'] || null,
    drought_tolerance: charMap['Drought Tolerance'] || null,
    height_m,
    height_mature_ft: numOrNull(charMap['Height, Mature (feet)']),
    bloom_period: charMap['Bloom Period'] || null,
    alberta_in_range,
    canada_native,
    canada_provinces: canadaNames,
    usda_symbol: usda?.Symbol || null,
    usda_id: usda?.Id || null,
    permapeople_id: perma?.id || null,
    permapeople_url: perma?.link
      ? `https://permapeople.org${perma.link}`
      : null,
    usda_url: usda?.Symbol
      ? `https://plants.usda.gov/home/plantProfile?symbol=${usda.Symbol}`
      : null,
    pfaf_url: pfaf?.pfaf_url || null,
    family: permaData['Family'] || pfaf?.family || null,
    notes: buildNotes({ alberta_in_range, canada_native, perma, pfaf, charMap }),
    attribution: buildAttribution({ perma, pfaf, usda, perenual }),
  };
}

function buildAttribution({ perma, pfaf, usda, perenual }) {
  const parts = [];
  if (perma) parts.push('Permapeople.org (CC BY-SA 4.0)');
  if (pfaf)
    parts.push(
      'Plants For A Future / pfaf.org (community offline dataset — attribute pfaf.org)'
    );
  if (usda) parts.push('USDA PLANTS (public domain)');
  if (perenual) parts.push('Perenual API');
  return parts.length ? `Plant specs: ${parts.join('; ')}.` : 'Plant specs: local catalog.';
}

function buildNotes({ alberta_in_range, canada_native, perma, pfaf, charMap }) {
  const parts = [];
  if (alberta_in_range) parts.push('USDA distribution includes Alberta.');
  else if (canada_native) parts.push('Listed as native/present in Canada (USDA).');
  if (pfaf?.nitrogen_fixer) parts.push('PFAF: nitrogen fixer.');
  if (pfaf?.food_forest) parts.push('PFAF: food forest plant.');
  if (pfaf?.edibility_rating != null && pfaf.edibility_rating > 0) {
    parts.push(`PFAF edibility ${pfaf.edibility_rating}/5.`);
  }
  if (charMap['Cold Stratification Required'] === 'Yes') {
    parts.push('Cold stratification often required for seed.');
  }
  if (perma?.description) parts.push(String(perma.description).slice(0, 140));
  else if (pfaf?.summary) parts.push(String(pfaf.summary).slice(0, 140));
  return parts.join(' ') || null;
}

/** Optional Perenual freemium API (supplementary). */
export async function searchPerenual(query) {
  const key = process.env.PERENUAL_API_KEY;
  if (!key) return { ok: false, error: 'missing_api_key', plants: [] };
  const url = `${PERENUAL_BASE}/species-list?key=${encodeURIComponent(
    key
  )}&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, plants: [] };
  const data = await r.json();
  return { ok: true, plants: data.data || [] };
}

/* ---------- mappers ---------- */

export function minTempFToZone(t) {
  // USDA half-zones ≈ 5°F bands; zone 1a starts at -60°F
  if (!Number.isFinite(t)) return null;
  const shifted = t + 60; // 0 at start of 1a
  if (shifted < 0) return '1a';
  let zoneNum = Math.floor(shifted / 10) + 1;
  if (zoneNum > 13) zoneNum = 13;
  if (zoneNum < 1) zoneNum = 1;
  const within = shifted % 10;
  const half = within < 5 ? 'a' : 'b';
  return `${zoneNum}${half}`;
}

function parseZoneRange(s) {
  // "3-9", "3a-7b", "Zones 4 to 8"
  const m = String(s).match(/(\d{1,2}[ab]?)\s*[-–to]+\s*(\d{1,2}[ab]?)/i);
  if (!m) {
    const one = String(s).match(/(\d{1,2})([ab])?/i);
    if (!one) return { min: null, max: null };
    const z = `${one[1]}${(one[2] || 'a').toLowerCase()}`;
    return { min: z, max: z };
  }
  const norm = (x) => {
    const p = String(x).toLowerCase().match(/(\d{1,2})([ab])?/);
    if (!p) return null;
    return `${p[1]}${p[2] || 'a'}`;
  };
  return { min: norm(m[1]), max: norm(m[2]) };
}

function mapUsdaTextures(charMap) {
  const out = [];
  if (charMap['Adapted to Coarse Textured Soils'] === 'Yes') {
    out.push('sand', 'loamy_sand', 'sandy_loam');
  }
  if (charMap['Adapted to Medium Textured Soils'] === 'Yes') {
    out.push('loam', 'silt_loam');
  }
  if (charMap['Adapted to Fine Textured Soils'] === 'Yes') {
    out.push('clay_loam', 'clay');
  }
  return [...new Set(out)];
}

function mapUsdaDrainage(charMap) {
  const ana = (charMap['Anaerobic Tolerance'] || '').toLowerCase();
  if (ana === 'none' || ana === 'low') return ['well', 'moderately_well', 'rapid'];
  if (ana === 'medium') return ['well', 'moderately_well', 'imperfect'];
  if (ana === 'high') return ['moderately_well', 'imperfect', 'poor'];
  return ['well', 'moderately_well'];
}

function mapPermaSoil(s) {
  const t = String(s).toLowerCase();
  const out = [];
  if (t.includes('sand') || t.includes('light')) out.push('sand', 'sandy_loam', 'loamy_sand');
  if (t.includes('medium') || t.includes('loam')) out.push('loam', 'silt_loam');
  if (t.includes('clay') || t.includes('heavy')) out.push('clay_loam', 'clay');
  return out.length ? out : ['loam'];
}

function mapUsdaShade(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === 'intolerant') return 'Full sun';
  if (s === 'intermediate' || s === 'medium') return 'Full sun, partial sun/shade';
  if (s === 'tolerant') return 'Partial sun/shade, full shade';
  return v;
}

function mapUsdaMoisture(use, drought) {
  const d = String(drought || '').toLowerCase();
  const m = String(use || '').toLowerCase();
  if (d === 'high') return 'Dry';
  if (d === 'low' || m === 'high') return 'Moist';
  if (m === 'medium') return 'Moist';
  return m || drought || null;
}

function mapPermaLayer(layer) {
  if (!layer) return null;
  const s = String(layer).toLowerCase();
  if (s.includes('canopy') || s === 'trees' || s.includes('tree')) return 'canopy';
  if (s.includes('understor')) return 'understory';
  if (s.includes('shrub')) return 'shrub';
  if (s.includes('herb') || s.includes('herbaceous')) return 'herbaceous';
  if (s.includes('ground') || s.includes('cover') || s.includes('root')) return 'groundcover';
  if (s.includes('vine') || s.includes('climber')) return 'vine';
  return null;
}

function mapPermaCategory(layer, life) {
  const s = `${layer || ''} ${life || ''}`.toLowerCase();
  if (s.includes('annual')) return 'annual';
  if (s.includes('tree')) return 'tree';
  if (s.includes('shrub')) return 'shrub';
  if (s.includes('vine')) return 'vine';
  if (s.includes('cover')) return 'cover_crop';
  if (s.includes('perennial') || s.includes('herb')) return 'perennial';
  return null;
}

function mapUsdaHabit(habits) {
  const h = Array.isArray(habits) ? habits.join(' ') : String(habits || '');
  if (/tree/i.test(h) && /shrub/i.test(h)) return 'understory';
  if (/tree/i.test(h)) return 'canopy';
  if (/shrub/i.test(h)) return 'shrub';
  if (/vine/i.test(h)) return 'vine';
  if (/graminoid|grass/i.test(h)) return 'groundcover';
  if (/forb|herb/i.test(h)) return 'herbaceous';
  return null;
}

function mapUsdaCategory(habits, durations) {
  const h = Array.isArray(habits) ? habits.join(' ') : String(habits || '');
  const d = Array.isArray(durations) ? durations.join(' ') : String(durations || '');
  if (/tree/i.test(h)) return 'tree';
  if (/shrub/i.test(h)) return 'shrub';
  if (/vine/i.test(h)) return 'vine';
  if (/annual/i.test(d)) return 'annual';
  if (/perennial/i.test(d)) return 'perennial';
  return null;
}

/* ---------- string helpers ---------- */

export function normSci(s) {
  return stripAuthors(stripHtml(s || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&times;/g, '×')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAuthors(s) {
  // "Amelanchier alnifolia (Nutt.) Nutt. ex M. Roem." → binomial
  let t = stripHtml(s);
  t = t.replace(/\s*×\s*/g, ' × ');
  // keep first two words (or hybrid form)
  const m = t.match(
    /^([A-Z][a-z]+(?:\s+×)?\s+[a-z]+(?:\s+var\.\s+[a-z]+)?(?:\s+subsp\.\s+[a-z]+)?)/
  );
  return m ? m[1] : t.split(/\s+/).slice(0, 2).join(' ');
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const ZONE_ORDER_LOCAL = [
  '1a','1b','2a','2b','3a','3b','4a','4b','5a','5b',
  '6a','6b','7a','7b','8a','8b','9a','9b','10a','10b','11a','11b','12a','12b','13a','13b',
];

function zoneIndexSafe(z) {
  const i = ZONE_ORDER_LOCAL.indexOf(String(z || '').toLowerCase());
  return i < 0 ? 99 : i;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
