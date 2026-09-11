/**
 * Repeatable Plant Intelligence ingestion (Phase 1 MVP).
 *
 *   node scripts/ingest-plant-intelligence.mjs
 *   node scripts/ingest-plant-intelligence.mjs --gbif=40
 *
 * Idempotent: same sources rewrite canonical.json; raw EcoCrop checksums skip dupes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestEcoCrop, ECOCROP_CSV } from '../lib/plant-intelligence/ingest-ecocrop.js';
import { ingestLocalCatalogs } from '../lib/plant-intelligence/ingest-local.js';
import { mergePlants } from '../lib/plant-intelligence/merge.js';
import { matchGbifName, fetchGbifOccurrences } from '../lib/plant-intelligence/taxonomy.js';
import { saveCanonical, DATA_DIR } from '../lib/plant-intelligence/store.js';
import { SOURCES } from '../lib/plant-intelligence/provenance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const gbifLimit = Number(args.find((a) => a.startsWith('--gbif='))?.split('=')[1] ?? 0);
const occLimit = Number(args.find((a) => a.startsWith('--occ='))?.split('=')[1] ?? 0);

const ECOCROP_URL = 'https://raw.githubusercontent.com/OpenCLIM/ecocrop/main/EcoCrop_DB.csv';

async function ensureEcoCropCsv() {
  if (fs.existsSync(ECOCROP_CSV) && fs.statSync(ECOCROP_CSV).size > 10000) return;
  fs.mkdirSync(path.dirname(ECOCROP_CSV), { recursive: true });
  console.log('Downloading EcoCrop_DB.csv…');
  const res = await fetch(ECOCROP_URL);
  if (!res.ok) throw new Error(`EcoCrop download HTTP ${res.status}`);
  fs.writeFileSync(ECOCROP_CSV, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  await ensureEcoCropCsv();

  console.log('EcoCrop…');
  const eco = ingestEcoCrop();
  console.log(`  ${eco.count} EcoCrop species`);

  console.log('Local catalogs + USDA/PFAF plant-specs…');
  const local = ingestLocalCatalogs();
  console.log(`  ${local.length} catalog/spec records`);

  console.log('Merge (canonical taxonomy keys)…');
  const { plants, unresolved } = mergePlants([eco.plants, local]);
  console.log(`  ${plants.length} canonical taxa, ${unresolved.length} unresolved`);

  if (gbifLimit > 0) {
    console.log(`GBIF taxonomy match (up to ${gbifLimit})…`);
    const targets = plants
      .filter((p) => p.taxon?.scientific_name && (p.sources || []).includes('catalog'))
      .slice(0, gbifLimit);
    let n = 0;
    for (const p of targets) {
      const hit = await matchGbifName(p.taxon.scientific_name);
      p.gbif = hit;
      if (hit.gbif_taxon_key) {
        p.taxon.gbif_taxon_key = hit.gbif_taxon_key;
        p.taxon.accepted_name = hit.accepted_name || p.taxon.accepted_name;
        p.taxon.family = p.taxon.family || hit.family;
        p.taxon.taxonomic_status = hit.taxonomic_status || p.taxon.taxonomic_status;
        p.sources = [...new Set([...(p.sources || []), 'gbif'])];
        n++;
        if (occLimit > 0 && hit.gbif_taxon_key) {
          p.occurrences = await fetchGbifOccurrences(hit.gbif_taxon_key, {
            taxon_id: p.taxon.id,
            limit: occLimit,
          });
        }
      } else {
        unresolved.push({ original_name: p.taxon.scientific_name, reason: hit.match_method || 'gbif_none' });
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    console.log(`  GBIF accepted ${n}/${targets.length}`);
  }

  const db = {
    meta: {
      ingested_at: new Date().toISOString(),
      sources: Object.values(SOURCES),
      counts: {
        plants: plants.length,
        ecocrop: eco.count,
        local_records: local.length,
        unresolved: unresolved.length,
        with_gbif: plants.filter((p) => p.taxon?.gbif_taxon_key).length,
      },
      units: {
        temperature: '°C',
        precipitation: 'mm/year',
        height: 'm',
        elevation: 'm',
        solar: 'kWh/m²',
        soil_pH: 'dimensionless',
      },
      notes:
        'Raw EcoCrop rows stay in data/plant-intelligence/raw. Canonical values never overwrite source names. TRY is Phase 2.',
    },
    plants: plants.map(compactPlant),
    unresolved,
  };

  const out = saveCanonical(db);
  const bytes = fs.statSync(out).size;
  console.log(`Wrote ${out} (${plants.length} plants, ${(bytes / 1e6).toFixed(2)} MB)`);
  if (plants.length < 500) {
    console.warn('WARNING: fewer than 500 resolved species');
    process.exitCode = 2;
  }
}

function compactPlant(p) {
  return {
    taxon: p.taxon,
    climate: omitEmpty(p.climate),
    solar: omitEmpty(p.solar),
    soil: omitEmpty(p.soil),
    water: omitEmpty(p.water),
    morphology: omitEmpty(p.morphology),
    ecology: omitEmpty(p.ecology),
    uses: omitEmpty(p.uses),
    provenance: p.provenance || [],
    sources: p.sources || [],
    gbif: p.gbif
      ? {
          gbif_taxon_key: p.gbif.gbif_taxon_key,
          match_method: p.gbif.match_method,
          match_confidence: p.gbif.match_confidence,
          accepted_name: p.gbif.accepted_name,
        }
      : null,
    occurrences: p.occurrences || [],
  };
}

function omitEmpty(obj = {}) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    o[k] = v;
  }
  return o;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
