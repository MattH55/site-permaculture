import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Structural check for the Kenney Nature Kit GLB assets app.js loads via
// GLTFLoader (public/assets/nature-kit) — see
// tree-rendering-fix-and-forest-texture-instructions, Part 1b. This can't
// exercise GLTFLoader/THREE itself (no WebGL/DOM in Node), but it does
// verify the files exist, are well-formed binary glTF, and actually
// contain renderable mesh geometry — catching a bad/missing/corrupt asset
// without needing a browser.

const ASSET_DIR = path.join(import.meta.dirname, '..', 'public', 'assets', 'nature-kit');
const EXPECTED = ['tree_default.glb', 'tree_pineTallA.glb', 'tree_oak.glb'];

/** Minimal GLB (binary glTF) header + JSON-chunk parse — no dependency. */
function parseGlb(buf) {
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'GLB magic');
  const version = buf.readUInt32LE(4);
  const jsonChunkLength = buf.readUInt32LE(12);
  const jsonChunkType = buf.readUInt32LE(16);
  assert.equal(jsonChunkType, 0x4e4f534a, 'first chunk is JSON'); // 'JSON'
  const json = JSON.parse(buf.subarray(20, 20 + jsonChunkLength).toString('utf8'));
  return { version, json };
}

for (const name of EXPECTED) {
  test(`nature-kit asset "${name}" exists and is a valid GLB with mesh geometry`, () => {
    const file = path.join(ASSET_DIR, name);
    assert.ok(fs.existsSync(file), `missing asset: ${file}`);
    const buf = fs.readFileSync(file);
    const { version, json } = parseGlb(buf);
    assert.equal(version, 2, 'glTF version 2');
    assert.ok(Array.isArray(json.meshes) && json.meshes.length > 0, 'has at least one mesh');
    const totalPrimitives = json.meshes.reduce((n, m) => n + (m.primitives?.length || 0), 0);
    assert.ok(totalPrimitives > 0, 'has at least one primitive to render');
    // Every primitive needs POSITION data to be renderable at all.
    for (const mesh of json.meshes) {
      for (const prim of mesh.primitives) {
        assert.ok(prim.attributes?.POSITION != null, 'primitive has POSITION attribute');
      }
    }
  });
}

test('LICENSE.txt is present alongside the Nature Kit assets (CC0, kenney.nl)', () => {
  const licensePath = path.join(ASSET_DIR, 'LICENSE.txt');
  assert.ok(fs.existsSync(licensePath), 'missing LICENSE.txt');
  const text = fs.readFileSync(licensePath, 'utf8');
  assert.ok(/CC0|Creative Commons Zero/i.test(text), 'license text should mention CC0');
});
