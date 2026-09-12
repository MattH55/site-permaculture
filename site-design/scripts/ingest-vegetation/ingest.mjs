#!/usr/bin/env node
/**
 * Vegetation ingestion pipeline: Poly Haven model id → downloaded source →
 * packed .glb → a manifest.json record. This is the real, rerunnable form
 * of the manual steps used to add the first three assets (shrub_03, fern_02,
 * flower_empodium) — see assets/vegetation/manifest.json.
 *
 * Usage:
 *   node scripts/ingest-vegetation/ingest.mjs <polyhaven-id> [<polyhaven-id> ...]
 *   npm run ingest:vegetation -- shrub_02 dandelion_01
 *
 * For each id:
 *   1. GET https://api.polyhaven.com/files/<id>, use the 1k gltf entry.
 *   2. Download the .gltf, its buffer (prefers the 1k geometry variant when
 *      present — the .bin is often only offered at a coarser tier like 4k/8k
 *      since Poly Haven doesn't decimate geometry per resolution), and every
 *      referenced 1k texture, into asset-source/polyhaven/<id>/.
 *   3. Pack into public/assets/vegetation/polyhaven/<id>/<id>.glb (packGlb —
 *      see pack-glb.mjs for why this isn't a GLTFExporter round-trip).
 *   4. Upsert a manifest record (species/growthStage/category left for a
 *      human to fill in — Poly Haven filenames don't identify species, and
 *      guessing one violates the provenance rule in lib/vegetation-assets.js).
 *
 * A record this script writes is deliberately NOT validated end-to-end
 * against lib/vegetation-assets.js's validateVegetationAsset() here — id,
 * commonName, category etc. need a human decision this script can't make
 * responsibly. Run `npm test` (lib/vegetation-assets.test.js exercises the
 * validator) or `node -e "..."` against the manifest after editing those
 * fields in by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlb } from './pack-glb.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'assets', 'vegetation', 'manifest.json');

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function ingestOne(id) {
  console.log(`\n=== ${id} ===`);
  const files = await fetchJson(`https://api.polyhaven.com/files/${id}`);
  const entry = files.gltf?.['1k']?.gltf;
  if (!entry) throw new Error(`${id}: no 1k gltf entry in Poly Haven's file list`);

  const srcDir = path.join(ROOT, 'asset-source', 'polyhaven', id);
  const gltfName = `${id}_1k.gltf`;
  await downloadTo(entry.url, path.join(srcDir, gltfName));
  console.log(`  gltf: ${entry.size} bytes`);

  for (const [relPath, file] of Object.entries(entry.include || {})) {
    const size = await downloadTo(file.url, path.join(srcDir, relPath));
    console.log(`  ${relPath}: ${size} bytes`);
  }

  const outPath = path.join(ROOT, 'public', 'assets', 'vegetation', 'polyhaven', id, `${id}.glb`);
  const glbSize = packGlb(srcDir, gltfName, outPath);
  console.log(`  packed -> ${path.relative(ROOT, outPath)} (${glbSize} bytes)`);

  const today = new Date().toISOString().slice(0, 10);
  const record = {
    id: `polyhaven-${id}`,
    source: 'polyhaven',
    sourceUrl: `https://polyhaven.com/a/${id}`,
    license: 'CC0',
    // Placeholders a human must review — see the module doc comment above.
    category: 'shrub',
    species: null,
    commonName: id.replace(/_\d+$/, '').replace(/_/g, ' '),
    modelSourceFile: `asset-source/polyhaven/${id}/${gltfName}`,
    browserModel: `/assets/vegetation/polyhaven/${id}/${id}.glb`,
    thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
    defaultScale: 1,
    lods: { high: `/assets/vegetation/polyhaven/${id}/${id}.glb` },
    growthStage: 'unknown',
    metadata: {},
    variants: [],
    provenance: {
      source: 'polyhaven',
      sourceUrl: `https://polyhaven.com/a/${id}`,
      license: 'CC0',
      downloadedAt: today,
      originalFilename: gltfName,
      optimizedFilename: `${id}.glb`,
      optimizationProcess: 'Packed 1k-texture glTF (+ external .bin, jpg textures) into a single self-contained GLB by embedding each image as a bufferView (pack-glb.mjs — hand-built per the glTF2/GLB binary spec; no mesh decimation, no LOD variants generated).',
    },
  };

  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : { assets: [] };
  const idx = manifest.assets.findIndex((a) => a.id === record.id);
  if (idx >= 0) {
    console.log(`  manifest: replacing existing record ${record.id}`);
    manifest.assets[idx] = record;
  } else {
    manifest.assets.push(record);
  }
  manifest.generatedAt = today;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  manifest: wrote ${record.id} — review category/species/commonName/metadata by hand`);
}

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node scripts/ingest-vegetation/ingest.mjs <polyhaven-id> [<polyhaven-id> ...]');
  process.exit(1);
}

let failed = 0;
for (const id of ids) {
  try {
    await ingestOne(id);
  } catch (err) {
    failed++;
    console.error(`  FAILED: ${err.message}`);
  }
}
if (failed) {
  console.error(`\n${failed}/${ids.length} failed.`);
  process.exit(1);
}
console.log(`\nDone. Review new/changed records in assets/vegetation/manifest.json, then run npm test.`);
