/**
 * Pack a loose glTF (1k-texture download: .gltf + external .bin + external
 * image URIs) into a single self-contained .glb — hand-built per the
 * glTF 2.0 / GLB binary container spec, no Three.js or browser needed.
 *
 * Why not GLTFLoader + GLTFExporter (the "normal" round-trip)? That was the
 * first approach tried here and it hung indefinitely on the secondary
 * resource fetches (the .bin and textures) under a headless-Chromium runner,
 * with neither its load nor error callback ever firing — undiagnosed, and
 * not worth chasing further when the binary format itself is simple enough
 * to construct directly with Buffer operations.
 *
 * GLB layout: 12-byte header (magic 'glTF', version 2, total length) then two
 * chunks — a JSON chunk (the modified glTF, space-padded to 4 bytes) and a
 * BIN chunk (the original buffer with every external image appended after
 * it, zero-padded to 4 bytes). Each appended image gets a new bufferView and
 * its `images[i].uri` is replaced with `bufferView` + `mimeType`.
 */

import fs from 'node:fs';
import path from 'node:path';

function pad(buf, boundary, fillByte) {
  const rem = buf.length % boundary;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(boundary - rem, fillByte)]);
}

const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/**
 * @param {string} dir directory containing the .gltf and everything its
 *   buffers[0].uri / images[].uri point to (relative to this dir)
 * @param {string} gltfName filename of the .gltf within `dir`
 * @param {string} outPath where to write the resulting .glb
 * @returns {number} bytes written
 */
export function packGlb(dir, gltfName, outPath) {
  const gltf = JSON.parse(fs.readFileSync(path.join(dir, gltfName), 'utf8'));

  if (!Array.isArray(gltf.buffers) || gltf.buffers.length !== 1 || !gltf.buffers[0].uri) {
    throw new Error(`${gltfName}: expected exactly one external buffer, got ${JSON.stringify(gltf.buffers)}`);
  }
  const baseBuffer = fs.readFileSync(path.join(dir, gltf.buffers[0].uri));
  const chunks = [baseBuffer];
  let offset = baseBuffer.length;

  for (const img of gltf.images || []) {
    if (!img.uri) continue; // already embedded (data: URI or bufferView) — leave alone
    const ext = path.extname(img.uri).toLowerCase();
    const imgBuf = fs.readFileSync(path.join(dir, img.uri));
    const aligned = pad(imgBuf, 4, 0);
    const bufferViewIndex = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: imgBuf.length });
    offset += aligned.length;
    chunks.push(aligned);
    delete img.uri;
    img.bufferView = bufferViewIndex;
    img.mimeType = MIME_BY_EXT[ext] || 'image/jpeg';
  }
  const combinedBin = Buffer.concat(chunks);
  gltf.buffers[0] = { byteLength: combinedBin.length };

  const jsonBuf = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 4, 0x20); // space-pad, per spec
  const binBuf = pad(combinedBin, 4, 0);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // ascii 'JSON', little-endian

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuf.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // ascii 'BIN\0', little-endian

  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const glb = Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, glb);
  return glb.length;
}
