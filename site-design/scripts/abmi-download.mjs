#!/usr/bin/env node
/**
 * One-time download + extract of the ABMI LiDAR Canopy Height Model bundle.
 *
 *   node scripts/abmi-download.mjs [project-id]
 *
 * Default project: `christina_lake` (the only released ABMI LiDAR project as
 * of 2026-09). The 7z bundle is 138 GB and is extracted to
 * `data/cache/abmi-lidar/`. This is a long-running step — do NOT run it
 * from the server process; run it manually or in CI before deploy.
 *
 * Requirements:
 *   - `7z` (7-Zip) on PATH, or `7za` / `7zr`. The script auto-detects.
 *   - ~200 GB free disk (7z + extracted tiles).
 *   - A stable network connection.
 *
 * Idempotent: if the 7z is already present and the target dir has tiles,
 * the script exits early. Pass `--force` to re-download.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache', 'abmi-lidar');

// Keep in sync with lib/abmi-lidar.js PROJECTS.
const PROJECTS = {
  christina_lake: {
    bundle_url:
      'https://ftp-public.abmi.ca/GISData/Lidar/ABMI_lidar_Canopy_Height_Model.7z',
    bundle_name: 'ABMI_lidar_Canopy_Height_Model.7z',
  },
};

const project = PROJECTS[process.argv[2]] || PROJECTS.christina_lake;
const force = process.argv.includes('--force');
const target = path.join(CACHE_DIR, project.bundle_name);

console.log(`Project:        ${process.argv[2] || 'christina_lake'}`);
console.log(`Bundle:         ${project.bundle_url}`);
console.log(`Target:         ${target}`);
console.log(`Cache dir:      ${CACHE_DIR}`);

if (!force && fs.existsSync(target)) {
  console.log('Bundle already present. Skipping download.');
} else {
  console.log('Downloading… (this is 138 GB, will take a while)');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Use curl if available (better resume support), else PowerShell.
  try {
    execFileSync('curl', ['-fL', '--progress-bar', '-o', target, project.bundle_url], {
      stdio: 'inherit',
    });
  } catch {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Invoke-WebRequest -Uri '${project.bundle_url}' -OutFile '${target}'`,
      ],
      { stdio: 'inherit' }
    );
  }
}

// Extract.
const extractDir = CACHE_DIR;
console.log(`Extracting to: ${extractDir}`);
const seven = detectSeven();
execFileSync(seven.bin, [seven.xflag, target, `o!${extractDir}`], { stdio: 'inherit' });

// Count tiles.
const tiles = fs
  .readdirSync(extractDir)
  .filter((n) => /\.(tiff?|tif)$/i.test(n));
console.log(`Done. ${tiles.length} raster tile(s) present in ${extractDir}.`);

function detectSeven() {
  for (const name of ['7z', '7za', '7zr']) {
    try {
      execFileSync(name, ['-h'], { stdio: 'ignore' });
      return { bin: name, xflag: 'x' };
    } catch {}
  }
  throw new Error('7-Zip (7z/7za/7zr) not found on PATH. Install it and retry.');
}
