/**
 * Parkland County contour shapefile server.
 * Reads the 1.7 GB ESRI shapefile directly (binary .shp + .dbf),
 * filters contours by bounding box, and returns GeoJSON.
 *
 * Uses Node.js built-in Buffer/fs — no native extensions needed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, '..', 'data', 'contours');
const SHP_PATH = path.join(DATA_DIR, 'ContoursIntermittent.shp');
const DBF_PATH = path.join(DATA_DIR, 'ContoursIntermittent.dbf');
const SHX_PATH = path.join(DATA_DIR, 'ContoursIntermittent.shx');

// Cache for shapefile header
let headerCache = null;
let dbfFieldCache = null;

function readHeader() {
  if (headerCache) return headerCache;
  if (!fs.existsSync(SHP_PATH)) return null;

  const buf = fs.readFileSync(SHP_PATH);
  const hdr = {
    fileCode: buf.readInt32BE(0),
    fileLengthWords: buf.readInt32BE(24),
    version: buf.readInt32LE(28),
    shapeType: buf.readInt32LE(32),
    xmin: buf.readDoubleLE(36),
    ymin: buf.readDoubleLE(44),
    xmax: buf.readDoubleLE(52),
    ymax: buf.readDoubleLE(60),
  };
  headerCache = hdr;
  return hdr;
}

function readDbfHeader() {
  if (dbfFieldCache) return dbfFieldCache;
  if (!fs.existsSync(DBF_PATH)) return null;

  const buf = fs.readFileSync(DBF_PATH, { encoding: null });
  const numRecords = buf.readUInt32LE(4);
  const headerSize = buf.readUInt16LE(8);
  const recordSize = buf.readUInt16LE(10);

  // Parse field descriptors (32 bytes each, starting at offset 32)
  const fields = [];
  let offset = 32;
  while (offset < headerSize - 1) {
    const typeByte = buf[offset + 11];
    if (typeByte === 0x0D) break; // terminator
    let nameEnd = offset;
    while (nameEnd < offset + 11 && buf[nameEnd] !== 0) nameEnd++;
    const name = buf.toString('ascii', offset, nameEnd);
    const type = String.fromCharCode(buf[offset + 11]);
    fields.push({ name, type, offset: offset - 32 });
    offset += 32;
  }

  const headerOffset = headerSize;
  dbfFieldCache = { buf, numRecords, headerSize, recordSize, fields, headerOffset };
  return dbfFieldCache;
}

function readDbfRecordValues(recordIndex) {
  const dbf = readDbfHeader();
  if (!dbf || recordIndex >= dbf.numRecords) return {};

  const { buf, headerSize, recordSize, fields } = dbf;
  const recordStart = headerSize + recordIndex * recordSize;

  if (buf[recordStart] === 0x2A) return null; // deleted record

  const result = {};
  for (const f of fields) {
    const fStart = recordStart + 1 + f.offset;
    const raw = buf.toString('ascii', fStart, fStart + (f.name === 'ELEVATION' ? 11 : 11)).replace(/\0/g, '').trim();
    if (f.name === 'ELEVATION' && raw) {
      result.ELEVATION = parseFloat(raw);
    }
  }
  return result;
}

/**
 * Parse a PolyLine record from the shapefile binary buffer.
 * Returns null if the shape doesn't intersect the bbox.
 */
function parsePolyLineRecord(buf, offset, bbox) {
  const recordNum = buf.readInt32BE(offset);
  const contentLength = buf.readInt32BE(offset + 4) * 2; // words to bytes
  const shapeStart = offset + 8;

  const type = buf.readInt32LE(shapeStart);
  if (type !== 3 && type !== 13 && type !== 23) return null; // not a polyline

  // Bounding box: 4 doubles
  const shpXmin = buf.readDoubleLE(shapeStart + 4);
  const shpYmin = buf.readDoubleLE(shapeStart + 12);
  const shpXmax = buf.readDoubleLE(shapeStart + 20);
  const shpYmax = buf.readDoubleLE(shapeStart + 28);

  // Quick bbox reject
  if (bbox) {
    if (shpXmax < bbox.west || shpXmin > bbox.east ||
        shpYmax < bbox.south || shpYmin > bbox.north) {
      return null;
    }
  }

  const numParts = buf.readInt32LE(shapeStart + 36);
  const numPoints = buf.readInt32LE(shapeStart + 40);

  if (numPoints < 2) return null;

  // Parts array (offset to start of each part)
  const partsStart = shapeStart + 44;
  const parts = [];
  for (let i = 0; i < numParts; i++) {
    parts.push(buf.readInt32LE(partsStart + i * 4));
  }

  // Points array
  const pointsStart = partsStart + numParts * 4;
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const x = buf.readDoubleLE(pointsStart + i * 16);
    const y = buf.readDoubleLE(pointsStart + i * 16 + 8);
    points.push([x, y]);
  }

  // Split into parts
  const lines = [];
  for (let i = 0; i < numParts; i++) {
    const start = parts[i];
    const end = (i + 1 < numParts) ? parts[i + 1] : numPoints;
    if (end - start >= 2) {
      lines.push(points.slice(start, end));
    }
  }

  return {
    recordNum,
    box: { xmin: shpXmin, ymin: shpYmin, xmax: shpXmax, ymax: shpYmax },
    lines,
  };
}

/**
 * Query all contours within a bounding box.
 *
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 * @param {{ limit?: number }} opts — max features to return (default 5000)
 * @returns {{ type: 'FeatureCollection', features: Array }}
 */
function queryContours(bbox, opts = {}) {
  const limit = opts.limit || 5000;
  const hdr = readHeader();
  const dbf = readDbfHeader();

  if (!hdr || !fs.existsSync(SHP_PATH)) {
    return { type: 'FeatureCollection', features: [], error: 'Shapefile not found' };
  }

  // Quick whole-file bounds check
  if (hdr.xmax < bbox.west || hdr.xmin > bbox.east ||
      hdr.ymax < bbox.south || hdr.ymin > bbox.north) {
    return { type: 'FeatureCollection', features: [], note: 'Bbox outside shapefile extent' };
  }

  const buf = fs.readFileSync(SHP_PATH);
  let offset = 100; // After 100-byte header
  const features = [];
  const recordIndices = [];

  while (offset + 12 <= buf.length && features.length < limit) {
    const contentLength = buf.readInt32BE(offset + 4) * 2;
    const recordNum = buf.readInt32BE(offset);

    // Skip deleted / empty records
    if (contentLength < 4) {
      offset += 8 + contentLength;
      continue;
    }

    const parsed = parsePolyLineRecord(buf, offset, bbox);
    if (parsed) {
      // Get elevation from DBF
      let elev = null;
      if (dbf && recordNum > 0 && recordNum <= dbf.numRecords) {
        const attrs = readDbfRecordValues(recordNum - 1);
        elev = attrs.ELEVATION;
      }

      for (const line of parsed.lines) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: line,
          },
          properties: {
            elevation_m: elev,
          },
        });
        if (features.length >= limit) break;
      }
    }

    offset += 8 + contentLength;
  }

  return {
    type: 'FeatureCollection',
    features,
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    total_in_shp: features.length >= limit ? `${limit}+ (limit reached)` : `${features.length}`,
  };
}

// Export for use in Express route
export { queryContours, readHeader };
