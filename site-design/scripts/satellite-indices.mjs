#!/usr/bin/env node
/**
 * CLI: fetch satellite vegetation indices + regional SOC for an AOI.
 *
 * Usage:
 *   node scripts/satellite-indices.mjs --lat 53.55 --lng -113.50
 *   node scripts/satellite-indices.mjs --geojson site.geojson --start 2025-05-01 --end 2026-07-01
 *   node scripts/satellite-indices.mjs --lat 53.8 --lng -113.65 --no-cache
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchSatelliteIndices,
  toFecundityPatch,
} from '../lib/satellite-indices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const geojsonPath = get('--geojson');
const start = get('--start');
const end = get('--end');
const lat = get('--lat');
const lng = get('--lng');
const outPath = get('--out');

let aoi;
if (geojsonPath) {
  const p = path.isAbsolute(geojsonPath)
    ? geojsonPath
    : path.join(process.cwd(), geojsonPath);
  if (!fs.existsSync(p)) {
    console.error(`GeoJSON not found: ${p}`);
    process.exit(1);
  }
  aoi = JSON.parse(fs.readFileSync(p, 'utf8'));
} else if (lat && lng) {
  aoi = { latitude: Number(lat), longitude: Number(lng) };
} else {
  // Default demo: Edmonton-area parcel
  aoi = { latitude: 53.55, longitude: -113.5 };
  console.error('No --geojson / --lat --lng; using Edmonton demo point.');
}

console.error('Fetching satellite indices (Sentinel-2 / Landsat / S1 / SoilGrids)…');
const t0 = Date.now();
const result = await fetchSatelliteIndices(aoi, {
  startDate: start || undefined,
  endDate: end || undefined,
  skipCache: args.includes('--no-cache'),
});
const patch = toFecundityPatch(result);

const out = {
  indices: result,
  fecundity_patch: patch,
  elapsed_ms: Date.now() - t0,
};

const json = JSON.stringify(out, null, 2);
if (outPath) {
  fs.writeFileSync(outPath, json, 'utf8');
  console.error(`Wrote ${outPath}`);
} else {
  console.log(json);
}

console.error(
  `Done in ${Date.now() - t0} ms · available=${result.available}` +
    ` · NDVI=${result.ndvi?.median ?? 'n/a'}` +
    ` · cover=${result.ndviCoverPct ?? 'n/a'}%` +
    ` · SOC=${result.regional_soc?.mean_g_kg ?? 'n/a'} g/kg`
);
