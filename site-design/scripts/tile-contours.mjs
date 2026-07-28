/**
 * Preprocess the Parkland County contour shapefile into tiled GeoJSON.
 * 
 * Reads the 1.7 GB ESRI shapefile, simplifies coordinates, and writes
 * small GeoJSON tiles organized by bbox. Each tile covers ~0.05° × 0.05°.
 * 
 * Usage: node scripts/tile-contours.mjs
 * Output: data/contours-tiles/{lat}_{lng}.geojson
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'contours');
const OUT_DIR = path.join(__dirname, '..', 'data', 'contours-tiles');
const SHP = path.join(DATA_DIR, 'ContoursIntermittent.shp');
const SHX = path.join(DATA_DIR, 'ContoursIntermittent.shx');

if (!fs.existsSync(SHP)) {
  console.error('Shapefile not found at:', SHP);
  console.error('Extract the zip first.');
  process.exit(1);
}

const TILE_SIZE = 0.05; // degrees (~5.5km at this latitude)
const PRECISION = 4; // decimal places (~11m)

console.log('Reading shapefile header…');
const shpBuf = fs.readFileSync(SHP);
const shxBuf = fs.readFileSync(SHX);

// Parse SHP header
const xmin = shpBuf.readDoubleLE(36);
const ymin = shpBuf.readDoubleLE(44);
const xmax = shpBuf.readDoubleLE(52);
const ymax = shpBuf.readDoubleLE(60);
const shapeType = shpBuf.readInt32LE(32);

console.log(`Shape type: ${shapeType} (3=PolyLine)`);
console.log(`Bounds: [${xmin.toFixed(4)}, ${ymin.toFixed(4)}] to [${xmax.toFixed(4)}, ${ymax.toFixed(4)}]`);

// Parse SHX (record offset index)
const shxNumRecords = (shxBuf.length - 100) / 8;
console.log(`SHX records: ${shxNumRecords.toLocaleString()}`);

// Read elevation values from DBF
const DBF = path.join(DATA_DIR, 'ContoursIntermittent.dbf');
let elevations = null;
if (fs.existsSync(DBF)) {
  console.log('Reading DBF for elevation values…');
  const dbfBuf = fs.readFileSync(DBF);
  const numRecords = dbfBuf.readUInt32LE(4);
  const headerSize = dbfBuf.readUInt16LE(8);
  const recordSize = dbfBuf.readUInt16LE(10);
  
  // Parse field descriptors
  const fields = [];
  let off = 32;
  while (off < headerSize - 1) {
    if (dbfBuf[off + 11] === 0x0D) break;
    let ne = off;
    while (ne < off + 11 && dbfBuf[ne] !== 0) ne++;
    const name = dbfBuf.toString('ascii', off, ne);
    fields.push({ name, offset: off - 32 });
    off += 32;
  }
  
  const elevField = fields.find(f => f.name === 'ELEVATION');
  elevations = new Array(numRecords).fill(null);
  
  for (let i = 0; i < numRecords; i++) {
    if (dbfBuf[headerSize + i * recordSize] === 0x2A) continue; // deleted
    if (!elevField) continue;
    const fStart = headerSize + i * recordSize + 1 + elevField.offset;
    const raw = dbfBuf.toString('ascii', fStart, fStart + 11).replace(/\0/g, '').trim();
    if (raw) elevations[i] = parseFloat(raw);
    if (i % 500000 === 0) console.log(`  DBF record ${i.toLocaleString()} / ${numRecords.toLocaleString()}`);
  }
  console.log(`  DBF done: ${elevations.filter(v => v !== null).length.toLocaleString()} elevation values`);
}

// Create tile structure
const tiles = new Map();
function tileKey(lng, lat) {
  const tx = Math.floor(lng / TILE_SIZE);
  const ty = Math.floor(lat / TILE_SIZE);
  return `${ty}_${tx}`;
}

console.log('Processing shapefile records…');
let processed = 0;
let offset = 100;

function parseLine(buf, off) {
  const type = buf.readInt32LE(off + 8);
  if (type !== 3 && type !== 13 && type !== 23) return null;
  
  const numParts = buf.readInt32LE(off + 44);
  const numPoints = buf.readInt32LE(off + 48);
  if (numPoints < 2 || numPoints > 50000) return null;
  
  const recordBox = {
    xmin: buf.readDoubleLE(off + 12),
    ymin: buf.readDoubleLE(off + 20),
    xmax: buf.readDoubleLE(off + 28),
    ymax: buf.readDoubleLE(off + 36),
  };
  
  const partsStart = off + 52;
  const parts = [];
  for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(partsStart + i * 4));
  
  const ptsStart = partsStart + numParts * 4;
  const allPts = [];
  for (let i = 0; i < numPoints; i++) {
    const x = +buf.readDoubleLE(ptsStart + i * 16).toFixed(PRECISION);
    const y = +buf.readDoubleLE(ptsStart + i * 16 + 8).toFixed(PRECISION);
    allPts.push([x, y]);
  }
  
  const lines = [];
  for (let i = 0; i < numParts; i++) {
    const s = parts[i];
    const e = (i + 1 < numParts) ? parts[i + 1] : numPoints;
    if (e - s >= 2) lines.push(allPts.slice(s, e));
  }
  
  return { box: recordBox, lines };
}

while (offset + 12 <= shpBuf.length) {
  const recordNum = shpBuf.readInt32BE(offset);
  const contentLen = shpBuf.readInt32BE(offset + 4) * 2;
  
  if (contentLen >= 4) {
    const parsed = parseLine(shpBuf, offset);
    if (parsed) {
      const elev = elevations?.[recordNum - 1] ?? null;
      const { box } = parsed;
      
      // Determine which tiles this record touches
      const tMinX = Math.floor(box.xmin / TILE_SIZE);
      const tMaxX = Math.floor(box.xmax / TILE_SIZE);
      const tMinY = Math.floor(box.ymin / TILE_SIZE);
      const tMaxY = Math.floor(box.ymax / TILE_SIZE);
      
      for (const line of parsed.lines) {
        // Use midpoint to assign to a single tile
        const mid = line[Math.floor(line.length / 2)];
        const key = tileKey(mid[0], mid[1]);
        
        if (!tiles.has(key)) tiles.set(key, []);
        tiles.get(key).push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: line },
          properties: { elevation_m: elev },
        });
      }
    }
  }
  
  offset += 8 + contentLen;
  processed++;
  if (processed % 200000 === 0) {
    console.log(`  ${processed.toLocaleString()} records, ${tiles.size.toLocaleString()} tiles`);
  }
}

console.log(`\nWriting ${tiles.size.toLocaleString()} tiles…`);
fs.mkdirSync(OUT_DIR, { recursive: true });

// Write tile index
const tileIndex = [];
for (const [key, features] of tiles) {
  const [ty, tx] = key.split('_').map(Number);
  const tileBbox = {
    west: tx * TILE_SIZE,
    south: ty * TILE_SIZE, 
    east: (tx + 1) * TILE_SIZE,
    north: (ty + 1) * TILE_SIZE,
  };
  
  const geojson = {
    type: 'FeatureCollection',
    features: features.slice(0, 8000), // cap per tile
    bbox: [tileBbox.west, tileBbox.south, tileBbox.east, tileBbox.north],
  };
  
  const filename = `${key}.geojson`;
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(geojson));
  
  tileIndex.push({
    key,
    bbox: tileBbox,
    filename,
    featureCount: geojson.features.length,
  });
}

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({
  tileSize: TILE_SIZE,
  precision: PRECISION,
  totalFeatures: processed,
  totalTiles: tiles.size,
  bounds: { west: xmin, south: ymin, east: xmax, north: ymax },
  tiles: tileIndex,
}, null, 2));

const totalSize = fs.readdirSync(OUT_DIR)
  .filter(f => f.endsWith('.geojson'))
  .reduce((sum, f) => sum + fs.statSync(path.join(OUT_DIR, f)).size, 0);

console.log(`Done! ${tiles.size} tiles, ${(totalSize / 1024 / 1024).toFixed(1)} MB total`);