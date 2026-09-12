import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VEGETATION_STATUS,
  VEGETATION_MODES,
  VEGETATION_STATUSES,
  assetDisplayName,
  createTreeInstance,
  groupInstancesByAsset,
  hashString,
  indexVegetationManifest,
  requiredAssetUrls,
  resolveAssetLodUrl,
  validateTreeInstance,
  validateVegetationAsset,
  vegetationSpeciesSummary,
} from './vegetation-assets.js';

/**
 * A well-formed record used as the baseline; each test clones it and breaks
 * exactly one thing, so a failure names the rule it violates.
 */
function goodAsset(overrides = {}) {
  return {
    id: 'polyhaven_tree_small_02',
    source: 'polyhaven',
    sourceUrl: 'https://polyhaven.com/a/tree_small_02',
    license: 'CC0',
    category: 'tree',
    species: null,
    commonName: 'Tree Small 02',
    modelSourceFile: 'tree_small_02_1k.gltf',
    browserModel: '/assets/vegetation/polyhaven/tree_small_02/tree_small_02.glb',
    thumbnail: '/assets/vegetation/polyhaven/tree_small_02/thumbnail.webp',
    defaultScale: 1,
    lods: {
      high: '/assets/vegetation/polyhaven/tree_small_02/tree_small_02.glb',
      medium: '/assets/vegetation/polyhaven/tree_small_02/tree_small_02.medium.glb',
      low: '/assets/vegetation/polyhaven/tree_small_02/tree_small_02.low.glb',
    },
    provenance: {
      source: 'Poly Haven',
      sourceUrl: 'https://polyhaven.com/a/tree_small_02',
      license: 'CC0',
      downloadedAt: '2026-09-12',
      originalFilename: 'tree_small_02_1k.gltf',
      optimizedFilename: 'tree_small_02.glb',
      optimizationProcess: 'gltf-transform: weld, simplify, resize textures, GLB repack',
    },
    ...overrides,
  };
}

test('a well-formed asset record validates cleanly', () => {
  assert.deepEqual(validateVegetationAsset(goodAsset()), []);
});

test('species is allowed to be null — a filename is never treated as a species', () => {
  assert.deepEqual(validateVegetationAsset(goodAsset({ species: null })), []);
  // An authoritative species from the source is also fine — the rule is that
  // null is the *safe default*, not that strings are rejected.
  assert.deepEqual(validateVegetationAsset(goodAsset({ species: 'Picea glauca' })), []);
});

test('rejects a non-CC0 license — every Poly Haven asset must be confirmed CC0', () => {
  const problems = validateVegetationAsset(goodAsset({ license: 'CC-BY' }));
  assert.ok(problems.some((p) => /license must be "CC0"/.test(p)), problems.join('; '));
});

test('rejects a non-GLB runtime model (spec §4: never ship OBJ/FBX/ZIP)', () => {
  for (const bad of ['/assets/x/tree.obj', '/assets/x/tree.fbx', '/assets/x/tree.zip']) {
    const problems = validateVegetationAsset(goodAsset({ browserModel: bad }));
    assert.ok(problems.some((p) => /must be a \.glb/.test(p)), `expected rejection of ${bad}`);
  }
});

test('rejects a hotlinked third-party model URL (spec §25)', () => {
  const problems = validateVegetationAsset(goodAsset({
    browserModel: 'https://dl.polyhaven.org/file/ph-assets/Models/gltf/tree.glb',
  }));
  assert.ok(problems.some((p) => /must be served from \/assets\//.test(p)), problems.join('; '));
});

test('requires provenance on every record (spec §23)', () => {
  const problems = validateVegetationAsset(goodAsset({ provenance: undefined }));
  assert.ok(problems.some((p) => /provenance/.test(p)));
});

test('reports each missing provenance field by name', () => {
  const incomplete = goodAsset();
  delete incomplete.provenance.optimizationProcess;
  delete incomplete.provenance.downloadedAt;
  const problems = validateVegetationAsset(incomplete);
  assert.ok(problems.some((p) => p === 'provenance.optimizationProcess missing'), problems.join('; '));
  assert.ok(problems.some((p) => p === 'provenance.downloadedAt missing'), problems.join('; '));
});

test('requires lods.high — every asset needs at least one LOD', () => {
  const problems = validateVegetationAsset(goodAsset({ lods: { medium: '/assets/x/m.glb' } }));
  assert.ok(problems.some((p) => /lods\.high is required/.test(p)), problems.join('; '));
});

test('rejects a non-.glb LOD entry', () => {
  const problems = validateVegetationAsset(goodAsset({ lods: { high: '/assets/x/tree.gltf' } }));
  assert.ok(problems.some((p) => /lods\.high must be a \.glb/.test(p)), problems.join('; '));
});

test('rejects an unknown LOD key rather than silently ignoring it', () => {
  const problems = validateVegetationAsset(goodAsset({ lods: { high: '/a.glb', ultra: '/b.glb' } }));
  assert.ok(problems.some((p) => /unknown lod key "ultra"/.test(p)), problems.join('; '));
});

test('rejects an unsupported growthStage value (spec §8: never guessed)', () => {
  const problems = validateVegetationAsset(goodAsset({ growthStage: 'ancient' }));
  assert.ok(problems.some((p) => /growthStage must be one of/.test(p)), problems.join('; '));
});

test('rejects a non-positive defaultScale', () => {
  assert.ok(validateVegetationAsset(goodAsset({ defaultScale: 0 })).some((p) => /defaultScale/.test(p)));
  assert.ok(validateVegetationAsset(goodAsset({ defaultScale: -2 })).some((p) => /defaultScale/.test(p)));
});

test('indexVegetationManifest keeps good records and reports bad ones', () => {
  const manifest = { assets: [goodAsset(), goodAsset({ id: 'bad', license: 'CC-BY' })] };
  const { assets, byId, problems } = indexVegetationManifest(manifest);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, 'polyhaven_tree_small_02');
  assert.ok(byId.has('polyhaven_tree_small_02'));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^bad:/);
});

test('indexVegetationManifest reports a duplicate id instead of shadowing it', () => {
  const manifest = { assets: [goodAsset(), goodAsset({ commonName: 'Duplicate' })] };
  const { assets, problems } = indexVegetationManifest(manifest);
  assert.equal(assets.length, 1);
  assert.ok(problems.some((p) => /duplicate id/.test(p)));
});

test('indexVegetationManifest tolerates a manifest with no assets array', () => {
  const { assets, problems } = indexVegetationManifest({});
  assert.deepEqual(assets, []);
  assert.ok(problems.some((p) => /no `assets` array/.test(p)));
});

test('resolveAssetLodUrl falls down the quality ladder to a file that exists', () => {
  const asset = goodAsset({ lods: { low: '/assets/x/low.glb' } });
  assert.equal(resolveAssetLodUrl(asset, 'high'), '/assets/x/low.glb');
  assert.equal(resolveAssetLodUrl(asset, 'low'), '/assets/x/low.glb');
});

test('resolveAssetLodUrl prefers the requested level when present', () => {
  const asset = goodAsset();
  assert.equal(resolveAssetLodUrl(asset, 'high'), asset.lods.high);
  assert.equal(resolveAssetLodUrl(asset, 'medium'), asset.lods.medium);
  assert.equal(resolveAssetLodUrl(asset, 'low'), asset.lods.low);
});

test('resolveAssetLodUrl never returns a URL for an unknown asset', () => {
  assert.equal(resolveAssetLodUrl(null, 'high'), null);
  assert.equal(resolveAssetLodUrl(undefined, 'high'), null);
});

test('requiredAssetUrls loads only the species the property actually uses (spec §20)', () => {
  // Distinct URLs per asset, so the de-duplication can't be credited to the
  // fixture producing identical paths for different species.
  const registry = new Map([
    ['spruce', goodAsset({ id: 'spruce' })],
    ['aspen', goodAsset({ id: 'aspen' })],
    ['willow', goodAsset({ id: 'willow' })],
  ].map(([id, asset]) => [id, {
    ...asset,
    lods: Object.fromEntries(Object.entries(asset.lods).map(([k, v]) => [k, `/assets/vegetation/${id}/${v.split('/').pop()}`])),
  }]));

  const instances = [{ assetId: 'spruce' }, { assetId: 'aspen' }, { assetId: 'spruce' }];
  const urls = requiredAssetUrls(instances, registry);
  assert.equal(urls.length, 6, 'two species × three LODs');
  for (const url of urls) assert.ok(!url.includes('willow'), `${url} should not be loaded`);
});

test('requiredAssetUrls de-duplicates repeated instances of the same asset', () => {
  const registry = new Map([['spruce', goodAsset({ id: 'spruce' })]]);
  const many = Array.from({ length: 500 }, () => ({ assetId: 'spruce' }));
  assert.equal(requiredAssetUrls(many, registry).length, 3, '500 trees of one species = 3 files');
});

test('requiredAssetUrls can be restricted to a single LOD tier', () => {
  const registry = new Map([['spruce', goodAsset({ id: 'spruce' })]]);
  const urls = requiredAssetUrls([{ assetId: 'spruce' }], registry, 'low');
  assert.deepEqual(urls, ['/assets/vegetation/polyhaven/tree_small_02/tree_small_02.low.glb']);
});

test('requiredAssetUrls skips unknown asset ids rather than throwing', () => {
  assert.deepEqual(requiredAssetUrls([{ assetId: 'nope' }, {}], new Map()), []);
});

test('requiredAssetUrls order is deterministic across calls', () => {
  const registry = new Map([['a', goodAsset({ id: 'a' })], ['b', goodAsset({ id: 'b' })]]);
  const instances = [{ assetId: 'b' }, { assetId: 'a' }];
  assert.deepEqual(requiredAssetUrls(instances, registry), requiredAssetUrls(instances, registry));
});


test('groupInstancesByAsset batches by asset — the unit of instanced rendering', () => {
  const groups = groupInstancesByAsset([
    { assetId: 'spruce' }, { assetId: 'aspen' }, { assetId: 'spruce' },
  ]);
  assert.equal(groups.size, 2);
  assert.equal(groups.get('spruce').length, 2);
  assert.equal(groups.get('aspen').length, 1);
});

test('createTreeInstance defaults to status "proposed" and stage "unknown" (spec §8, §22)', () => {
  const t = createTreeInstance({
    assetId: 'polyhaven_tree_small_02', propertyId: 'property-123',
    latitude: 53.5123, longitude: -113.4821,
  });
  assert.equal(t.status, DEFAULT_VEGETATION_STATUS);
  assert.equal(t.status, 'proposed');
  assert.equal(t.growthStage, 'unknown');
  assert.equal(t.scale, 1);
  assert.equal(t.rotation, 0);
  // elevation is omitted (not zero) so the renderer resolves it terrain-relative
  assert.ok(!('elevation' in t), 'elevation must be omitted, not assumed 0 (spec §12)');
});

test('createTreeInstance produces a stable id for the same placement', () => {
  const a = createTreeInstance({ assetId: 'x', propertyId: 'p', latitude: 53.5, longitude: -113.4 });
  const b = createTreeInstance({ assetId: 'x', propertyId: 'p', latitude: 53.5, longitude: -113.4 });
  assert.equal(a.id, b.id);
  assert.ok(a.id.startsWith('tree-'));
});

test('createTreeInstance respects explicit status/growthStage/elevation overrides', () => {
  const t = createTreeInstance({
    assetId: 'x', propertyId: 'p', latitude: 1, longitude: 2,
    status: 'existing-observed', growthStage: 'mature', elevation: 812.5,
  });
  assert.equal(t.status, 'existing-observed');
  assert.equal(t.growthStage, 'mature');
  assert.equal(t.elevation, 812.5);
});

test('validateTreeInstance accepts a good instance and names bad fields', () => {
  const good = createTreeInstance({ assetId: 'x', propertyId: 'p', latitude: 1, longitude: 2 });
  assert.deepEqual(validateTreeInstance(good), []);

  const problems = validateTreeInstance({
    id: 't', assetId: 'x', propertyId: 'p',
    latitude: NaN, longitude: 2, scale: -1, status: 'imaginary',
  });
  assert.ok(problems.some((p) => /latitude/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /scale/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /status must be one of/.test(p)), problems.join('; '));
});

test('vegetationSpeciesSummary counts per asset, most-used first (spec §18)', () => {
  const registry = new Map([
    ['spruce', goodAsset({ id: 'spruce', commonName: 'White Spruce', species: 'Picea glauca' })],
    ['aspen', goodAsset({ id: 'aspen', commonName: 'Trembling Aspen' })],
  ]);
  const instances = [
    ...Array.from({ length: 42 }, () => ({ assetId: 'spruce' })),
    ...Array.from({ length: 17 }, () => ({ assetId: 'aspen' })),
  ];
  const summary = vegetationSpeciesSummary(instances, registry);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary[0], {
    assetId: 'spruce', name: 'White Spruce', species: 'Picea glauca', count: 42,
  });
  assert.equal(summary[1].count, 17);
});

test('assetDisplayName never invents a species for an unidentified model', () => {
  assert.equal(assetDisplayName({ id: 'x', commonName: 'Tree Small 02', species: null }), 'Tree Small 02');
  assert.equal(assetDisplayName({ id: 'x', commonName: '', species: null }), 'x');
  assert.equal(assetDisplayName(null), 'Unknown');
});

test('hashString is stable, within signed 32-bit range, and seed-sensitive', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  for (const s of ['', 'a', 'property-123|natural|seed', 'x'.repeat(500)]) {
    const h = hashString(s);
    assert.ok(Number.isInteger(h) && h >= -2147483648 && h <= 2147483647, `out of range for ${s}`);
  }
});

test('exported enums match the spec vocabulary', () => {
  assert.deepEqual([...VEGETATION_STATUSES], ['existing-observed', 'proposed', 'planned', 'removed']);
  assert.deepEqual([...VEGETATION_MODES], ['natural', 'orchard', 'shelterbelt', 'landscape']);
});

