/**
 * Enrich crop records with:
 *   1. Permapeople (primary API — keys optional)
 *   2. PFAF local SQLite (offline community mirror)
 *   3. USDA PLANTS (public domain — always)
 *   4. Perenual (optional freemium — PERENUAL_API_KEY)
 *
 * Usage:
 *   npm run pfaf:download          # once, ~47 MB
 *   npm run enrich:plant-specs:curated
 *   npm run enrich:plant-specs -- --limit 200
 *
 * Env:
 *   PERMAPEOPLE_KEY_ID / PERMAPEOPLE_KEY_SECRET  (permapeople.org → My API keys)
 *   PERENUAL_API_KEY                             (optional fallback)
 *
 * Output: data/crops/plant-specs.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasPermapeopleKeys,
  searchPermapeople,
  getPermapeoplePlant,
  searchUsdaByScientific,
  fetchUsdaProfile,
  fetchUsdaCharacteristics,
  fetchUsdaCanadaLocations,
  buildSpecFromSources,
  searchPerenual,
  normSci,
  sleep,
} from '../lib/plant-specs.js';
import { hasPfafDb, lookupPfaf, closePfafDb } from '../lib/pfaf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'crops', 'plant-specs.json');

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 200;
const curatedOnly = args.includes('--curated-only');
const delayMs = Number(args.find((a) => a.startsWith('--delay='))?.split('=')[1]) || 220;
const force = args.includes('--force');

function loadCrops() {
  const files = curatedOnly
    ? ['alberta-catalog.json', 'alberta-natives.json']
    : [
        'alberta-catalog.json',
        'alberta-natives.json',
        'farmfit-export.json',
        'vendor-catalog.json',
      ];
  const byId = new Map();
  for (const f of files) {
    const p = path.join(ROOT, 'data', 'crops', f);
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = raw.crops || raw.plants || [];
    for (const c of list) {
      if (!c?.id) continue;
      if (!byId.has(c.id) || f !== 'vendor-catalog.json') {
        byId.set(c.id, {
          id: c.id,
          common_name: c.common_name || c.name,
          scientific_name: c.scientific_name || c.latin || null,
          _from: f,
        });
      }
    }
  }
  return [...byId.values()];
}

function pickBestPerma(plants, scientific, common) {
  if (!plants?.length) return null;
  const target = normSci(scientific || '');
  if (target) {
    const exact = plants.find((p) => normSci(p.scientific_name) === target);
    if (exact) return exact;
    const starts = plants.find((p) =>
      normSci(p.scientific_name).startsWith(target.split(' ').slice(0, 2).join(' '))
    );
    if (starts) return starts;
  }
  if (common) {
    const cn = common.toLowerCase();
    const byName = plants.find((p) => String(p.name || '').toLowerCase() === cn);
    if (byName) return byName;
  }
  return plants[0];
}

async function enrichOne(crop) {
  const query = crop.scientific_name || crop.common_name;
  if (!query) return null;

  let usda = null;
  let usdaChars = [];
  let canadaLocs = [];
  let perma = null;
  let pfaf = null;
  let perenual = null;

  // PFAF local (no network)
  if (hasPfafDb()) {
    try {
      pfaf = lookupPfaf(crop.scientific_name, crop.common_name);
    } catch (e) {
      console.warn(`  pfaf fail ${crop.id}: ${e.message}`);
    }
  }

  // USDA secondary (always)
  if (crop.scientific_name) {
    try {
      const hit = await searchUsdaByScientific(crop.scientific_name);
      await sleep(delayMs);
      if (hit?.Symbol) {
        usda = await fetchUsdaProfile(hit.Symbol);
        await sleep(delayMs);
        if (usda?.Id) {
          usdaChars = await fetchUsdaCharacteristics(usda.Id);
          await sleep(delayMs);
        }
        canadaLocs = await fetchUsdaCanadaLocations(hit.Symbol);
        await sleep(delayMs);
      }
    } catch (e) {
      return { error: `usda: ${e.message}` };
    }
  }

  // Permapeople primary (when keys present)
  if (hasPermapeopleKeys()) {
    try {
      const res = await searchPermapeople(query);
      await sleep(delayMs);
      if (res.ok && res.plants?.length) {
        const best = pickBestPerma(
          res.plants,
          crop.scientific_name,
          crop.common_name
        );
        if (best?.id) {
          perma = (await getPermapeoplePlant(best.id)) || best;
          await sleep(delayMs);
        }
      }
    } catch (e) {
      console.warn(`  perma fail ${crop.id}: ${e.message}`);
    }
  }

  // Perenual only if nothing else matched
  if (!usda && !pfaf && !perma && process.env.PERENUAL_API_KEY) {
    try {
      const res = await searchPerenual(query);
      await sleep(delayMs);
      if (res.ok && res.plants?.length) {
        const p = res.plants[0];
        perenual = {
          hardiness_min: p.hardiness?.min,
          hardiness_max: p.hardiness?.max,
          sunlight: p.sunlight,
          watering: p.watering,
        };
      }
    } catch {
      /* optional */
    }
  }

  if (!usda && !pfaf && !perma && !perenual) return { error: 'no_match' };

  const spec = buildSpecFromSources({
    crop,
    usda,
    usdaChars,
    canadaLocs,
    perma,
    pfaf,
    perenual,
  });
  return { spec };
}

async function main() {
  const crops = loadCrops();
  crops.sort((a, b) => {
    const as = a.scientific_name ? 0 : 1;
    const bs = b.scientific_name ? 0 : 1;
    if (as !== bs) return as - bs;
    const ac = a._from === 'vendor-catalog.json' ? 1 : 0;
    const bc = b._from === 'vendor-catalog.json' ? 1 : 0;
    return ac - bc || a.id.localeCompare(b.id);
  });

  const todo = crops.slice(0, limit);
  console.log(`Enriching ${todo.length} crops (of ${crops.length} loaded)`);
  console.log(
    `  PFAF local DB: ${hasPfafDb() ? 'yes' : 'NO — run npm run pfaf:download'}`
  );
  console.log(
    `  Permapeople keys: ${hasPermapeopleKeys() ? 'yes' : 'no (USDA+PFAF only)'}`
  );
  console.log(
    `  Perenual key: ${process.env.PERENUAL_API_KEY ? 'yes' : 'no'}`
  );

  let existing = {};
  if (fs.existsSync(OUT)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT, 'utf8')).by_id || {};
    } catch {
      existing = {};
    }
  }

  const by_id = { ...existing };
  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (let i = 0; i < todo.length; i++) {
    const crop = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] ${crop.id} … `);
    const prev = by_id[crop.id];
    if (
      !force &&
      prev?.spec_source &&
      (prev.spec_source.includes('pfaf') ||
        prev.spec_source.includes('permapeople')) &&
      prev.spec_source.includes('usda')
    ) {
      console.log('cached', prev.spec_source);
      skipped++;
      continue;
    }
    try {
      const result = await enrichOne(crop);
      if (result?.spec) {
        by_id[crop.id] = result.spec;
        ok++;
        console.log(
          result.spec.spec_source,
          result.spec.hardiness_min || '—',
          result.spec.nitrogen_fixer ? 'N-fix' : '',
          result.spec.alberta_in_range ? 'AB' : ''
        );
      } else {
        fail++;
        console.log(result?.error || 'no_spec');
      }
    } catch (e) {
      fail++;
      console.log('ERR', e.message);
    }
  }

  closePfafDb();

  const out = {
    meta: {
      updated_at: new Date().toISOString(),
      sources: {
        primary_api: 'Permapeople.org plant API (CC BY-SA 4.0) — when keys configured',
        content_rich: 'PFAF via local SQLite (saulshanabrook/pfaf-data community mirror of pfaf.org)',
        secondary: 'USDA PLANTS (plantsservices.sc.egov.usda.gov) — public domain',
        optional: 'Perenual freemium API',
      },
      pfaf_db_present: hasPfafDb(),
      permapeople_keys_present: hasPermapeopleKeys(),
      counts: {
        specs: Object.keys(by_id).length,
        enriched_this_run: ok,
        failed_this_run: fail,
        skipped_cached: skipped,
      },
      attribution:
        'Attribute Permapeople.org (CC BY-SA 4.0) and pfaf.org when those sources are used. USDA PLANTS is public domain. Community PFAF SQLite is a scrape mirror — respect PFAF copyright; for commercial redistrib use official PFAF license.',
    },
    by_id,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(by_id).length} specs → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
