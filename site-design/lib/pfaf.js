/**
 * Plants For A Future (PFAF) — local offline lookup.
 *
 * Source data: community SQLite mirror (saulshanabrook/pfaf-data), scraped from pfaf.org.
 * Content is subject to PFAF copyright — personal/research use; attribute pfaf.org.
 * Official bulk DB also sold on pfaf.org for licensed offline use.
 *
 * Not a live scrape of pfaf.org (fragile / TOS-sensitive). Prefer local DB.
 *
 * Download:
 *   npm run pfaf:download
 *   → data/crops/pfaf/data.sqlite (~47 MB)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PFAF_DB_PATH = path.join(
  __dirname,
  '..',
  'data',
  'crops',
  'pfaf',
  'data.sqlite'
);
export const PFAF_DOWNLOAD_URL =
  'https://raw.githubusercontent.com/saulshanabrook/pfaf-data/main/data.sqlite';

let db = null;

export function hasPfafDb() {
  return fs.existsSync(PFAF_DB_PATH);
}

export function openPfafDb() {
  if (db) return db;
  if (!hasPfafDb()) return null;
  db = new DatabaseSync(PFAF_DB_PATH, { readOnly: true });
  return db;
}

export function closePfafDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

/**
 * Lookup plant by scientific or common name.
 * @returns {object|null} normalized PFAF record with uses + care tags
 */
export function lookupPfaf(scientificName, commonName) {
  const database = openPfafDb();
  if (!database) return null;

  const sci = cleanSci(scientificName);
  const common = (commonName || '').trim();

  let row = null;
  if (sci) {
    row = database
      .prepare(
        `SELECT * FROM plants WHERE lower(latin_name) = lower(?) LIMIT 1`
      )
      .get(sci);
    if (!row) {
      // binomial match ignoring subspecies
      const parts = sci.split(/\s+/);
      if (parts.length >= 2) {
        const binom = `${parts[0]} ${parts[1]}`;
        row = database
          .prepare(
            `SELECT * FROM plants WHERE lower(latin_name) = lower(?)
             OR lower(latin_name) LIKE lower(?) || ' %'
             LIMIT 1`
          )
          .get(binom, binom);
      }
    }
    if (!row) {
      row = database
        .prepare(
          `SELECT * FROM plants WHERE lower(latin_name) LIKE '%' || lower(?) || '%'
           ORDER BY length(latin_name) ASC LIMIT 1`
        )
        .get(sci);
    }
  }
  if (!row && common) {
    // Prefer short common-name match
    row = database
      .prepare(
        `SELECT * FROM plants WHERE lower(common_name) LIKE '%' || lower(?) || '%'
         ORDER BY length(common_name) ASC LIMIT 1`
      )
      .get(common.split(/[,/]/)[0].trim());
  }
  if (!row) return null;

  const uses = database
    .prepare(
      `SELECT category, name FROM plant_uses WHERE plant = ?`
    )
    .all(row.latin_name);

  const care = database
    .prepare(`SELECT care FROM plant_care WHERE plant = ?`)
    .all(row.latin_name)
    .map((r) => r.care);

  return normalizePfafRow(row, uses, care);
}

function normalizePfafRow(row, uses, care) {
  const useNames = uses.map((u) => u.name);
  const edibleParts = uses
    .filter((u) => u.category === 'edible parts')
    .map((u) => u.name);
  const special = uses
    .filter((u) => u.category === 'special uses')
    .map((u) => u.name);

  const nitrogen_fixer =
    useNames.some((n) => /nitrogen fixer/i.test(n)) ||
    useNames.some((n) => /agroforestry services:\s*nitrogen/i.test(n));

  const food_forest = special.some((n) => /food forest/i.test(n));
  const ground_cover = special.some((n) => /ground cover/i.test(n));
  const dynamic_accumulator = special.some((n) =>
    /dynamic accumulator/i.test(n)
  );

  const zones = parsePfafHardiness(row.hardiness);
  const textures = mapPfafSoil(row.soil);
  const drainage = mapPfafDrainage(row.moisture, care);
  const light = mapPfafShade(row.shade, care);
  const water = mapPfafMoisture(row.moisture, care);
  const guild = mapPfafHabit(row.habit, special);
  const category = mapPfafCategory(row.habit);

  return {
    source: 'pfaf',
    latin_name: row.latin_name,
    common_name: (row.common_name || '').split(',')[0].trim(),
    family: row.family || null,
    habit: row.habit || null,
    height_m: num(row.height),
    hardiness_raw: row.hardiness || null,
    hardiness_min: zones.min,
    hardiness_max: zones.max,
    growth: mapPfafGrowth(row.growth),
    soil_raw: row.soil || null,
    shade_raw: row.shade || null,
    moisture_raw: row.moisture || null,
    textures,
    drainage,
    light_requirement: light,
    water_requirement: water,
    guild_layer: guild,
    category,
    edibility_rating: num(row.edibility_rating),
    medicinal_rating: num(row.medicinal_rating),
    other_uses_rating: num(row.other_uses_rating),
    edible: num(row.edibility_rating) > 0,
    edible_parts: edibleParts.length ? edibleParts.join(', ') : null,
    nitrogen_fixer,
    food_forest,
    ground_cover,
    dynamic_accumulator,
    known_hazards: row.known_hazards || null,
    range: row.range || null,
    habitats: row.habitats || null,
    cultivation_details: clip(row.cultivation_details, 400),
    summary: clip(row.summary || row.physical_characteristics, 280),
    care_tags: care,
    special_uses: special.slice(0, 12),
    use_count: uses.length,
    pfaf_url: row.latin_name
      ? `https://pfaf.org/user/Plant.aspx?LatinName=${encodeURIComponent(
          row.latin_name.replace(/ /g, '+')
        )}`
      : 'https://pfaf.org/',
    attribution:
      'Plants For A Future (pfaf.org). Community offline dataset — verify against pfaf.org; respect PFAF copyright/terms.',
  };
}

/* ---------- code maps (PFAF abbreviations) ---------- */

/** Hardiness "4-8" or "5-9" → half-zone strings; "0-0" / "-" = unknown */
export function parsePfafHardiness(raw) {
  if (!raw || raw === '-' || raw === '0-0') return { min: null, max: null };
  const m = String(raw).match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
  if (!m) return { min: null, max: null };
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) {
    return { min: null, max: null };
  }
  return { min: `${a}a`, max: `${b}b` };
}

/** L=light/sand, M=medium/loam, H=heavy/clay */
export function mapPfafSoil(code) {
  const c = String(code || '').toUpperCase();
  const out = [];
  if (c.includes('L')) out.push('sand', 'loamy_sand', 'sandy_loam');
  if (c.includes('M')) out.push('loam', 'silt_loam');
  if (c.includes('H')) out.push('clay_loam', 'clay');
  return [...new Set(out)];
}

/** D=dry, M=moist, We often as W in moisture field — PFAF uses D/M/We/Wa in text */
export function mapPfafMoisture(code, care = []) {
  const c = String(code || '').toUpperCase();
  const tags = care.join(' ').toLowerCase();
  if (tags.includes('water plants') || tags.includes('wet soil')) return 'Wet';
  if (c.includes('W') && !c.includes('D') && c !== 'M') return 'Wet';
  if (c.includes('D') && c.includes('M')) return 'Dry to moist';
  if (c.includes('D')) return 'Dry';
  if (c.includes('M')) return 'Moist';
  if (tags.includes('moist soil')) return 'Moist';
  if (tags.includes('well drained')) return 'Well drained / dry-moist';
  return null;
}

export function mapPfafDrainage(code, care = []) {
  const tags = care.join(' ').toLowerCase();
  const c = String(code || '').toUpperCase();
  if (tags.includes('water plants') || tags.includes('wet soil')) {
    return ['imperfect', 'poor', 'very_poor'];
  }
  if (tags.includes('well drained') || c.includes('D')) {
    return ['rapid', 'well', 'moderately_well'];
  }
  return ['well', 'moderately_well'];
}

/** S=shade, N=no shade (sun), F sometimes full shade */
export function mapPfafShade(code, care = []) {
  const c = String(code || '').toUpperCase();
  const tags = care.join(' ').toLowerCase();
  const parts = [];
  if (c.includes('N') || tags.includes('full sun')) parts.push('Full sun');
  if (c.includes('S') || tags.includes('semi-shade'))
    parts.push('Partial sun/shade');
  if (c.includes('F') || tags.includes('full shade')) parts.push('Full shade');
  if (!parts.length) return null;
  return parts.join(', ');
}

export function mapPfafHabit(habit, special = []) {
  const h = String(habit || '').toLowerCase();
  if (special.some((s) => /ground cover/i.test(s))) return 'groundcover';
  if (h.includes('tree')) return 'canopy';
  if (h.includes('shrub')) return 'shrub';
  if (h.includes('climber') || h.includes('vine')) return 'vine';
  if (h.includes('perennial') || h.includes('biennial') || h.includes('fern'))
    return 'herbaceous';
  if (h.includes('annual')) return 'herbaceous';
  if (h.includes('bulb') || h.includes('corm')) return 'herbaceous';
  return 'herbaceous';
}

export function mapPfafCategory(habit) {
  const h = String(habit || '').toLowerCase();
  if (h.includes('tree')) return 'tree';
  if (h.includes('shrub')) return 'shrub';
  if (h.includes('climber') || h.includes('vine')) return 'vine';
  if (h.includes('annual')) return 'annual';
  if (h.includes('perennial') || h.includes('biennial')) return 'perennial';
  return 'perennial';
}

function mapPfafGrowth(g) {
  const c = String(g || '').toUpperCase();
  if (c === 'S') return 'Slow';
  if (c === 'M') return 'Medium';
  if (c === 'F') return 'Fast';
  return g || null;
}

function cleanSci(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clip(s, n) {
  if (!s) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
