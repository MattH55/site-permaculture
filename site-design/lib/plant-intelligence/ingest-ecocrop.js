import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, numOrNull } from './csv.js';
import { canonicalName, taxonIdFromName, splitBinomial } from './taxonomy.js';
import { addProv, checksum, SOURCES } from './provenance.js';

export const ECOCROP_CSV = path.join(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'plant-intelligence',
  'raw',
  'ecocrop',
  'EcoCrop_DB.csv'
);

export function parseEcoCropCsv(text) {
  return parseCsv(text).filter((r) => r.ScientificName);
}

export function ecoCropToPlant(row) {
  const original = row.ScientificName;
  const canonical = canonicalName(original);
  const id = taxonIdFromName(canonical);
  const bin = splitBinomial(canonical);
  const source_record_id = String(row.EcoPortCode || id);
  const common = String(row.COMNAME || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  const synonyms = String(row.SYNO || '')
    .split(/;|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

  const climate = {
    temp_min_c: numOrNull(row.TMIN) ?? numOrNull(row.KTMP),
    temp_opt_min_c: numOrNull(row.TOPMN),
    temp_opt_max_c: numOrNull(row.TOPMX),
    temp_max_c: numOrNull(row.TMAX),
    precip_min_mm: numOrNull(row.RMIN),
    precip_max_mm: numOrNull(row.RMAX),
    altitude_max_m: numOrNull(row.ALTMX),
    latitude_min: numOrNull(row.LATMN),
    latitude_max: numOrNull(row.LATMX),
    killing_temp_c: numOrNull(row.KTMP),
    growing_period_min_days: numOrNull(row.GMIN),
    growing_period_max_days: numOrNull(row.GMAX),
  };

  const solar = {
    light_requirement: row.LIOPMN || row.LIMN || null,
    light_min: row.LIMN || null,
    light_max: row.LIMX || null,
    light_opt_min: row.LIOPMN || null,
    light_opt_max: row.LIOPMX || null,
    photoperiod: row.PHOTO || null,
    shade_tolerance: shadeFromLight(row.LIMN, row.LIOPMN),
  };

  const soil = {
    ph_min: numOrNull(row.PHMIN),
    ph_max: numOrNull(row.PHMAX),
    soil_depth: row.DEP || null,
    soil_depth_min_cm: depthCm(row.DEP),
    texture_preferences: splitList(row.TEXT),
    fertility_requirement: row.FER || null,
    salinity_tolerance: row.SAL || null,
    drainage_requirement: row.DRA || null,
  };

  const water = {
    moisture_requirement: moistureFromRain(climate.precip_min_mm, climate.precip_max_mm),
    drought_tolerance: droughtFromRain(climate.precip_min_mm),
    flood_tolerance: /poor|wet|waterlog/i.test(row.DRA || '') ? 'moderate' : 'unknown',
  };

  const morphology = {
    growth_form: row.LIFO || row.HABI || null,
    life_span: row.LISPA || null,
    category: row.CAT || null,
  };

  const provenance = [];
  const src = SOURCES.ecocrop.id;
  const rec = source_record_id;
  const conf = 0.88;
  for (const [field, value, table, unit] of [
    ['temp_min_c', climate.temp_min_c, 'plant_climate', '°C'],
    ['temp_opt_min_c', climate.temp_opt_min_c, 'plant_climate', '°C'],
    ['temp_opt_max_c', climate.temp_opt_max_c, 'plant_climate', '°C'],
    ['temp_max_c', climate.temp_max_c, 'plant_climate', '°C'],
    ['precip_min_mm', climate.precip_min_mm, 'plant_climate', 'mm/year'],
    ['precip_max_mm', climate.precip_max_mm, 'plant_climate', 'mm/year'],
    ['ph_min', soil.ph_min, 'plant_soil', null],
    ['ph_max', soil.ph_max, 'plant_soil', null],
    ['drainage_requirement', soil.drainage_requirement, 'plant_soil', null],
    ['shade_tolerance', solar.shade_tolerance, 'plant_solar', null],
    ['growth_form', morphology.growth_form, 'plant_morphology', null],
  ]) {
    addProv(provenance, {
      taxon_id: id,
      table_name: table,
      field_name: field,
      value,
      unit,
      source_id: src,
      source_record_id: rec,
      confidence: conf,
    });
  }

  return {
    taxon: {
      id,
      scientific_name_source: original,
      scientific_name: canonical,
      canonical_name: canonical,
      accepted_name: canonical,
      family: familyFrom(row.FAMNAME),
      genus: bin.genus,
      species: bin.species,
      rank: 'species',
      taxonomic_status: 'source',
      common_names: common,
      synonyms,
    },
    climate,
    solar,
    soil,
    water,
    morphology,
    ecology: { habitat: row.HABI || null, climate_zone: row.CLIZ || null },
    uses: {},
    provenance,
    sources: ['ecocrop'],
    raw_checksum: checksum(row),
    source_record_id: rec,
  };
}

export function ingestEcoCrop(csvPath = ECOCROP_CSV) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`EcoCrop CSV missing at ${csvPath} — run the ingest script download step`);
  }
  const rows = parseEcoCropCsv(fs.readFileSync(csvPath, 'utf8'));
  const plants = [];
  const raw = [];
  for (const row of rows) {
    const plant = ecoCropToPlant(row);
    plants.push(plant);
    raw.push({
      source: 'ecocrop',
      source_record_id: plant.source_record_id,
      retrieved_at: new Date().toISOString(),
      source_url: SOURCES.ecocrop.source_url,
      checksum: plant.raw_checksum,
      raw_payload: row,
    });
  }
  return { plants, raw, count: plants.length };
}

function familyFrom(famname) {
  if (!famname) return null;
  const parts = String(famname).split(':');
  return parts[parts.length - 1] || famname;
}

function splitList(s) {
  if (!s) return [];
  return String(s)
    .split(/[,;/]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function depthCm(dep) {
  if (!dep) return null;
  const m = String(dep).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return Number(m[1]);
  if (/shallow/i.test(dep)) return 20;
  if (/medium/i.test(dep)) return 50;
  if (/deep/i.test(dep)) return 100;
  return null;
}

function shadeFromLight(limn, opt) {
  const s = `${limn || ''} ${opt || ''}`.toLowerCase();
  if (/very bright|clear skies/.test(s) && !/shady|cloudy/.test(s)) return 'intolerant';
  if (/shady|very shady/.test(s)) return 'tolerant';
  if (/cloudy|moderately/.test(s)) return 'intermediate';
  return null;
}

function moistureFromRain(min, max) {
  if (min == null) return null;
  if (min <= 300) return 'low';
  if (min <= 600) return 'moderate';
  return 'high';
}

function droughtFromRain(min) {
  if (min == null) return 'unknown';
  if (min <= 250) return 'high';
  if (min <= 450) return 'moderate';
  return 'low';
}
