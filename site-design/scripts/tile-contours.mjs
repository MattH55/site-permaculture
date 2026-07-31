/**
 * Reproject Parkland County contours from NAD83 CSRS 10TM AEP Forest → WGS84.
 * Streams from SHP file (record-by-record via SHX index) to avoid OOM.
 *
 * Projection parameters from ContoursIntermittent.prj:
 *   Transverse Mercator, CM=-115°, FE=500000m, FN=0, k0=0.9992, GRS80 ellipsoid
 *
 * Strategy: generate simplified GeoJSON line strings at 0.05° tile size.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data', 'contours');
const OUT = path.join(__dirname, '..', 'data', 'contours-tiles');
const SHP = path.join(DATA, 'ContoursIntermittent.shp');
const SHX = path.join(DATA, 'ContoursIntermittent.shx');
const DBF = path.join(DATA, 'ContoursIntermittent.dbf');

// ---------- Inverse Transverse Mercator (GRS80) ----------
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const E4 = E2 * E2;
const E6 = E4 * E2;
const K0 = 0.9992;
const CM_DEG = -115;
const FE = 500000;

function tmToLatLng(x, y) {
  // Remove false easting
  const dx = (x - FE) / (A * K0);
  const dy = y / (A * K0);

  // Footprint latitude
  const mu = dy;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const e1sq = e1 * e1;
  const e1cu = e1sq * e1;
  const e1qu = e1sq * e1sq;
  const phi1 =
    mu + (1.5 * e1 - (27 / 32) * e1cu) * Math.sin(2 * mu) +
    ((21 / 16) * e1sq - (55 / 32) * e1qu) * Math.sin(4 * mu) +
    ((151 / 96) * e1cu) * Math.sin(6 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = sin1 / cos1;
  const N1 = A / Math.sqrt(1 - E2 * sin1 * sin1);
  const T1 = tan1 * tan1;
  const C1 = (E2 / (1 - E2)) * cos1 * cos1;

  const D = dx / (N1 * K0);
  const lat =
    phi1 -
    (N1 * tan1) / (A * K0) *
      (D * D / 2 - D * D * D * D / 24 * (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (E2 / (1 - E2))) +
        D * D * D * D * D * D / 720 * (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (E2 / (1 - E2)) - 3 * C1 * C1));

  const lng =
    CM_DEG +
    ((D - D * D * D / 6 * (1 + 2 * T1 + C1) +
      D * D * D * D * D / 120 * (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (E2 / (1 - E2)) + 24 * T1 * T1)) /
      cos1) *
      (180 / Math.PI);

  return {
    lat: +(lat * (180 / Math.PI)).toFixed(5),
    lng: +((lng + 360) % 360 - 180).toFixed(5),
  };
}

// ---------- DBF elevation reader ----------
let dbfInfo = null;
function loadDbf() {
  if (dbfInfo) return dbfInfo;
  const buf = fs.readFileSync(DBF);
  const numRec = buf.readUInt32LE(4);
  const hdrSize = buf.readUInt16LE(8);
  const recSize = buf.readUInt16LE(10);

  const fields = [];
  let off = 32;
  while (off < hdrSize - 1) {
    if (buf[off + 11] === 0x0D) break;
    let ne = off;
    while (ne < off + 11 && buf[ne] !== 0) ne++;
    const name = buf.toString('ascii', off, ne);
    fields.push({ name, len: buf[off + 16] || 11, dbfOff: off - 32 });
    off += 32;
  }
  // Find the elevation field
  const elevField = fields.find((f) => f.name === 'Contour' || f.name.includes('ELEV') || f.name.includes('CONTOUR'));
  console.log(`DBF fields: ${fields.map((f) => `${f.name}(${f.len})`).join(', ')}`);
  console.log(`Elevation field: ${elevField?.name || 'NOT FOUND'}`);

  dbfInfo = { buf, numRec, hdrSize, recSize, fields, elevField };
  return dbfInfo;
}

function getElevation(recordNum) {
  const dbf = loadDbf();
  if (!dbf.elevField || recordNum < 1 || recordNum > dbf.numRec) return null;
  const recStart = dbf.hdrSize + (recordNum - 1) * dbf.recSize;
  if (dbf.buf[recStart] === 0x2A) return null;
  const fStart = recStart + 1 + dbf.elevField.dbfOff;
  const raw = dbf.buf.toString('ascii', fStart, fStart + dbf.elevField.len).replace(/\0/g, '').trim();
  return raw ? +parseFloat(raw).toFixed(1) : null;
}

// ---------- Main tiling ----------

function tileKey(lat, lng) {
  const ts = 0.05;
  return `${Math.floor(lat / ts)}_${Math.floor(lng / ts)}`;
}

console.log('Loading DBF…');
loadDbf();

console.log('Streaming shapefile via SHX index…');
const shxBuf = fs.readFileSync(SHX);
const numRecords = (shxBuf.length - 100) / 8;
console.log(`${numRecords.toLocaleString()} shapefile records`);

// Open SHP as a file descriptor for streaming
const shpFd = fs.openSync(SHP, 'r');
const shpBuf = Buffer.alloc(4096); // Working buffer for reads

const tiles = new Map();
let skipped = 0;
let processed = 0;
const MAX_TILE_FEATURES = 5000;

for (let i = 0; i < numRecords; i++) {
  const shxOff = 100 + i * 8;
  const recOffset = shxBuf.readInt32BE(shxOff) * 2;
  const recContentLen = shxBuf.readInt32BE(shxOff + 4) * 2;
  
  if (recContentLen < 4) { skipped++; continue; }

  // Read record header + shape type + bbox
  const headerLen = 12; // record header + shape type
  const readLen = Math.min(headerLen + 68, recContentLen + 8);
  const buf = Buffer.alloc(readLen);
  fs.readSync(shpFd, buf, 0, readLen, recOffset);

  const type = buf.readInt32LE(8);
  if (type !== 3 && type !== 13 && type !== 23) { skipped++; continue; }

  // Bounding box at byte 12-43 (4 doubles)
  const numParts = buf.readInt32LE(52);
  const numPoints = buf.readInt32LE(56);
  if (numPoints < 2 || numPoints > 100000) { skipped++; continue; }

  // Read parts + points
  const partsBytes = numParts * 4;
  const pointsBytes = numPoints * 16;
  const dataOff = recOffset + 60;
  const dataLen = partsBytes + pointsBytes;
  const dataBuf = Buffer.alloc(dataLen);
  fs.readSync(shpFd, dataBuf, 0, dataLen, dataOff);

  const parts = [];
  for (let p = 0; p < numParts; p++) parts.push(dataBuf.readInt32LE(p * 4));

  const allPts = [];
  const ptStart = partsBytes;
  for (let p = 0; p < numPoints; p++) {
    const ox = dataBuf.readDoubleLE(ptStart + p * 16);
    const oy = dataBuf.readDoubleLE(ptStart + p * 16 + 8);
    const ll = tmToLatLng(ox, oy);
    allPts.push([ll.lng, ll.lat]);
  }

  // Elevation from DBF
  const elev = getElevation(i + 1);

  // Split into lines, assign to tiles
  for (let p = 0; p < numParts; p++) {
    const s = parts[p];
    const e = (p + 1 < numParts) ? parts[p + 1] : numPoints;
    if (e - s < 2) continue;
    const line = allPts.slice(s, e);
    
    // Assign to tile by midpoint
    const mid = line[Math.floor(line.length / 2)];
    const key = tileKey(mid[1], mid[0]);
    
    if (!tiles.has(key)) tiles.set(key, []);
    if (tiles.get(key).length < MAX_TILE_FEATURES) {
      tiles.get(key).push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line },
        properties: elev != null ? { elevation_m: elev } : {},
      });
    }
  }

  processed++;
  if (processed % 200000 === 0) {
    console.log(`  ${processed.toLocaleString()} records, ${tiles.size.toLocaleString()} tiles, ${skipped.toLocaleString()} skipped`);
  }
}

fs.closeSync(shpFd);
console.log(`Done processing: ${processed.toLocaleString()} records, ${tiles.size.toLocaleString()} tiles`);

// Write tiles
fs.mkdirSync(OUT, { recursive: true });
const tileIndex = [];

for (const [key, features] of tiles) {
  const [ty, tx] = key.split('_').map(Number);
  const geojson = {
    type: 'FeatureCollection',
    features,
    bbox: [tx * 0.05, ty * 0.05, (tx + 1) * 0.05, (ty + 1) * 0.05],
  };
  const filename = `${key}.geojson`;
  fs.writeFileSync(path.join(OUT, filename), JSON.stringify(geojson));
  tileIndex.push({ key, filename, features: features.length });
}

// Write index
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  tileSize: 0.05,
  projection: 'WGS84',
  totalTiles: tiles.size,
  tiles: tileIndex,
}, null, 2));

const totalMB = tileIndex.reduce((s, t) => s + t.features, 0) * 0.3 / 1024 / 1024;
console.log(`Wrote ${tileIndex.length} tiles, ~${totalMB.toFixed(1)} MB total`);