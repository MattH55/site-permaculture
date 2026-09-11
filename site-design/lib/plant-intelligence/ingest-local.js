import fs from 'node:fs';
import path from 'node:path';
import { canonicalName, taxonIdFromName, splitBinomial } from './taxonomy.js';
import { addProv, SOURCES } from './provenance.js';

const CROPS = path.join(import.meta.dirname, '..', '..', 'data', 'crops');

export function ingestLocalCatalogs() {
  const files = [
    ['alberta-catalog.json', 'catalog'],
    ['alberta-natives.json', 'catalog'],
    ['farmfit-export.json', 'catalog'],
  ];
  const plants = [];
  for (const [file, source] of files) {
    const p = path.join(CROPS, file);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const c of raw.crops || raw.plants || []) {
      const sci = c.scientific_name || c.latin;
      if (!sci && !c.common_name) continue;
      plants.push(catalogToPlant(c, source, file));
    }
  }
  const specsPath = path.join(CROPS, 'plant-specs.json');
  if (fs.existsSync(specsPath)) {
    const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
    for (const spec of Object.values(specs.by_id || {})) {
      plants.push(specToPlant(spec));
    }
  }
  return plants;
}

function catalogToPlant(c, source, file) {
  const original = c.scientific_name || c.latin || c.common_name;
  const canonical = canonicalName(c.scientific_name || c.latin || '') || taxonIdFromName(c.id || c.common_name);
  const id = taxonIdFromName(canonical || c.id);
  const bin = splitBinomial(canonical);
  const provenance = [];
  const rec = c.id || id;
  const climate = {
    precip_min_mm: c.precip_min_mm ?? null,
    precip_max_mm: c.precip_max_mm ?? null,
    frost_free_days_min: c.frost_free_min_days ?? null,
    hardiness_zone_min: c.hardiness_min || null,
    hardiness_zone_max: c.hardiness_max || null,
  };
  const soil = {
    ph_min: c.ph_min ?? null,
    ph_max: c.ph_max ?? null,
    texture_preferences: c.textures || [],
    drainage_requirement: Array.isArray(c.drainage) ? c.drainage.join(', ') : c.drainage || null,
  };
  addProv(provenance, { taxon_id: id, table_name: 'plant_climate', field_name: 'hardiness_zone_min', value: climate.hardiness_zone_min, source_id: source, source_record_id: rec, confidence: 0.9 });
  addProv(provenance, { taxon_id: id, table_name: 'plant_soil', field_name: 'ph_min', value: soil.ph_min, source_id: source, source_record_id: rec, confidence: 0.9 });
  return {
    taxon: {
      id,
      scientific_name_source: original,
      scientific_name: canonical || null,
      canonical_name: canonical || null,
      accepted_name: canonical || null,
      genus: bin.genus,
      species: bin.species,
      rank: 'species',
      taxonomic_status: 'curated',
      common_names: [c.common_name].filter(Boolean),
      catalog_id: c.id,
    },
    climate,
    solar: { light_requirement: c.light_requirement || null, shade_tolerance: shadeFromReq(c.light_requirement) },
    soil,
    water: { moisture_requirement: c.water_requirement || null },
    morphology: { growth_form: c.category || c.guild_layer || null },
    ecology: { native_regions: c.alberta_native ? ['Alberta'] : [], nitrogen_fixing: c.nitrogen_fixer ?? null },
    uses: {
      edible: c.edible === true ? true : c.edible === false ? false : 'unknown',
      food_forest: c.food_forest === true ? true : 'unknown',
    },
    provenance,
    sources: [source],
    source_record_id: rec,
    catalog_file: file,
  };
}

function specToPlant(spec) {
  const sci = spec.scientific_name;
  const id = taxonIdFromName(sci || spec.id);
  const src = String(spec.spec_source || 'usda_plants');
  const source_id = src.includes('usda') ? 'usda_plants' : src.includes('pfaf') ? 'pfaf' : 'catalog';
  const provenance = [];
  addProv(provenance, {
    taxon_id: id,
    table_name: 'plant_climate',
    field_name: 'hardiness_zone_min',
    value: spec.hardiness_min,
    source_id,
    source_record_id: spec.usda_symbol || spec.id,
    confidence: spec.spec_confidence === 'high' ? 0.9 : 0.75,
  });
  const bin = splitBinomial(sci || '');
  return {
    taxon: {
      id,
      scientific_name_source: sci,
      scientific_name: canonicalName(sci) || sci,
      canonical_name: canonicalName(sci) || sci,
      accepted_name: canonicalName(sci) || sci,
      genus: bin.genus,
      species: bin.species,
      common_names: [spec.common_name].filter(Boolean),
      usda_symbol: spec.usda_symbol || null,
    },
    climate: {
      hardiness_zone_min: spec.hardiness_min || null,
      hardiness_zone_max: spec.hardiness_max || null,
      precip_min_mm: spec.precip_min_mm ?? null,
      precip_max_mm: spec.precip_max_mm ?? null,
      frost_free_days_min: spec.frost_free_min_days ?? null,
    },
    solar: { light_requirement: spec.light_requirement || null, shade_tolerance: shadeFromReq(spec.light_requirement) },
    soil: {
      ph_min: spec.ph_min ?? null,
      ph_max: spec.ph_max ?? null,
      texture_preferences: spec.textures || [],
      drainage_requirement: Array.isArray(spec.drainage) ? spec.drainage.join(', ') : spec.drainage || null,
    },
    water: { moisture_requirement: spec.water_requirement || null },
    morphology: { growth_form: spec.category || spec.guild_layer || null, mature_height_max_m: spec.height_m ?? null },
    ecology: {
      native_regions: spec.canada_native || spec.alberta_native ? ['Canada'] : [],
      nitrogen_fixing: spec.nitrogen_fixer ?? null,
    },
    uses: {
      edible: spec.edible === true ? true : spec.edible === false ? false : 'unknown',
      medicinal: spec.medicinal_rating > 0 ? true : 'unknown',
    },
    provenance,
    sources: src.split('+').map((s) => (s.includes('usda') ? 'usda_plants' : s.includes('pfaf') ? 'pfaf' : s)),
    source_record_id: spec.usda_symbol || spec.id,
  };
}

function shadeFromReq(req) {
  const s = String(req || '').toLowerCase();
  if (/full.?sun|sun/.test(s) && !/part|shade/.test(s)) return 'intolerant';
  if (/full.?shade|shade/.test(s) && !/sun/.test(s)) return 'tolerant';
  if (/part|dappled/.test(s)) return 'intermediate';
  return null;
}
