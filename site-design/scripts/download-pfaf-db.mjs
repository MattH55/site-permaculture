/**
 * Download community PFAF SQLite mirror for offline plant specs.
 *
 * Source: https://github.com/saulshanabrook/pfaf-data (scraped from pfaf.org)
 * Copyright of plant content remains with Plants For A Future — personal/research use;
 * attribute https://pfaf.org. Official licensed DB also sold on pfaf.org.
 *
 * Usage: node scripts/download-pfaf-db.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PFAF_DB_PATH, PFAF_DOWNLOAD_URL } from '../lib/pfaf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  fs.mkdirSync(path.dirname(PFAF_DB_PATH), { recursive: true });
  if (fs.existsSync(PFAF_DB_PATH) && !process.argv.includes('--force')) {
    const mb = (fs.statSync(PFAF_DB_PATH).size / 1e6).toFixed(1);
    console.log(`Already present: ${PFAF_DB_PATH} (${mb} MB). Use --force to re-download.`);
    return;
  }
  console.log(`Downloading ${PFAF_DOWNLOAD_URL}`);
  console.log(`→ ${PFAF_DB_PATH}`);
  const res = await fetch(PFAF_DOWNLOAD_URL, {
    headers: { 'User-Agent': 'LandIntelligenceSiteDesign/1.0 (PFAF offline mirror download)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(PFAF_DB_PATH, buf);
  console.log(`Done: ${(buf.length / 1e6).toFixed(1)} MB`);
  console.log('Next: npm run enrich:plant-specs:curated');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
