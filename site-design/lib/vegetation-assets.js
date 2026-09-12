/**
 * Vegetation asset registry (Poly Haven integration — see
 * polyhaven-vegetation-pipeline.md).
 *
 * This module is the *asset* half of the vegetation model and is deliberately
 * renderer-agnostic — it has no THREE/DOM dependency, so it can be unit-tested
 * in Node (same pattern as public/tree-scale.js and its test) and reused by any
 * renderer (the current Three.js terrain viewer, a future Cesium/3D Tiles one,
 * a server-side report job).
 *
 * Concepts (kept strictly separate — the spec requires this):
 *
 *   VegetationAsset   what the tree/model *is*           (this file)
 *   TreeInstance      where a particular tree is placed  (this file)
 *   PropertyObject    the generic placed-thing wrapper   (lib/vegetation-scatter.js)
 *
 * Provenance rule from the spec: Poly Haven filenames do NOT identify the
 * biological species. A model is only labelled with a species when the source
 * itself supports the identification, and the registry records `species: null`
 * rather than inventing one. The same applies to growth stage — never inferred
 * from a filename.
 */

/** @typedef {'high'|'medium'|'low'} VegetationLod */

/**
 * @typedef {object} VegetationAsset
 * @property {string} id
 * @property {'polyhaven'} source
 * @property {string} sourceUrl      Permalink to the *specific* asset page.
 * @property {'CC0'} license
 * @property {'tree'|'shrub'|'grass'} category
 * @property {string|null} species   Biological name, or null when the source
 *                                   does not support the identification.
 * @property {string} commonName
 * @property {string|null} modelSourceFile  Original download (asset-source/).
 * @property {string} browserModel   Browser-served entry GLB (public/assets/…).
 * @property {string} thumbnail
 * @property {number} defaultScale
 * @property {{high?:string, medium?:string, low?:string}} lods
 * @property {'unknown'|'seedling'|'young'|'mature'} [growthStage]
 * @property {{matureHeightMeters?:number, matureCanopyWidthMeters?:number}} [metadata]
 * @property {string[]} [variants]   Sibling ids that are interchangeable
 *                                   variants of the same species/form (spec §7).
 * @property {object} provenance     Source/URL/license/download/optimisation
 *                                   record (spec §23).
 */

/**
 * @typedef {object} TreeInstance
 * @property {string} id
 * @property {string} assetId
 * @property {string} propertyId
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} [elevation]  Metres — omitted when the renderer should
 *                                 resolve it terrain-relative (spec §12).
 * @property {number} [rotation]   Radians.
 * @property {number} [scale]
 * @property {VegetationStatus} [status]
 * @property {'unknown'|'seedling'|'young'|'mature'} [growthStage]
 * @property {{plantingDate?:string, purpose?:string, notes?:string}} [metadata]
 */

/**
 * Existing-vs-proposed state (spec §22). Poly Haven trees placed by Land
 * Intelligence are 'proposed' unless explicitly reclassified — never imply a
 * modelled tree represents what is actually on the ground.
 * @typedef {'existing-observed'|'proposed'|'planned'|'removed'} VegetationStatus
 */

/**
 * Planting pattern (spec §17).
 * @typedef {'natural'|'orchard'|'shelterbelt'|'landscape'} VegetationMode
 */

/** Valid enum members, exported so callers/validators share one source. */
export const VEGETATION_STATUSES = Object.freeze([
  'existing-observed', 'proposed', 'planned', 'removed',
]);

export const VEGETATION_MODES = Object.freeze([
  'natural', 'orchard', 'shelterbelt', 'landscape',
]);

export const VEGETATION_LODS = Object.freeze(['high', 'medium', 'low']);

export const GROWTH_STAGES = Object.freeze([
  'unknown', 'seedling', 'young', 'mature',
]);

/**
 * The status every newly placed Land Intelligence vegetation instance gets.
 * Exported as a constant (not inlined) so the "these are proposed, not real"
 * intent is greppable and there is one place to change.
 */
export const DEFAULT_VEGETATION_STATUS = 'proposed';


/**
 * Structural validation for a single manifest record. Returns an array of
 * human-readable problems — empty means valid. Used by both the ingestion
 * script (which fails the run on any problem) and the test suite, so there is
 * exactly one definition of "well-formed asset".
 *
 * @param {any} asset
 * @returns {string[]} problems
 */
export function validateVegetationAsset(asset) {
  const problems = [];
  if (!asset || typeof asset !== 'object') return ['record is not an object'];

  if (!asset.id || typeof asset.id !== 'string') problems.push('missing id');
  if (asset.source !== 'polyhaven') problems.push(`source must be "polyhaven", got ${JSON.stringify(asset.source)}`);
  if (asset.license !== 'CC0') problems.push(`license must be "CC0", got ${JSON.stringify(asset.license)}`);
  if (!asset.sourceUrl || !/^https?:\/\//.test(asset.sourceUrl)) {
    problems.push('sourceUrl must be an absolute http(s) URL');
  }
  if (!asset.commonName || typeof asset.commonName !== 'string') problems.push('missing commonName');
  if (!asset.browserModel || typeof asset.browserModel !== 'string') {
    problems.push('missing browserModel');
  } else {
    // Spec §4: the runtime format is GLB/glTF only. Never ship OBJ/FBX/ZIP.
    if (!asset.browserModel.endsWith('.glb')) {
      problems.push(`browserModel must be a .glb (runtime format is GLB only), got ${asset.browserModel}`);
    }
    // Spec §25: never hotlink a third-party URL at runtime.
    if (!asset.browserModel.startsWith('/assets/')) {
      problems.push('browserModel must be served from /assets/ (never a third-party hotlink)');
    }
  }
  if (!asset.thumbnail || typeof asset.thumbnail !== 'string') problems.push('missing thumbnail');
  if (typeof asset.defaultScale !== 'number' || !(asset.defaultScale > 0)) {
    problems.push('defaultScale must be a positive number');
  }
  if (!asset.lods || typeof asset.lods !== 'object') {
    problems.push('missing lods object');
  } else {
    if (!asset.lods.high) problems.push('lods.high is required (every asset needs at least one LOD)');
    for (const [key, url] of Object.entries(asset.lods)) {
      if (!VEGETATION_LODS.includes(key)) problems.push(`unknown lod key "${key}"`);
      if (typeof url !== 'string' || !url.endsWith('.glb')) {
        problems.push(`lods.${key} must be a .glb — the browser never downloads OBJ/FBX/ZIP`);
      }
    }
  }

  // species / growthStage are intentionally allowed to be null/absent. Only
  // their *type* is checked when present — absence is more honest than a guess.
  if (asset.species != null && typeof asset.species !== 'string') {
    problems.push('species must be a string or null');
  }
  if (asset.growthStage != null && !GROWTH_STAGES.includes(asset.growthStage)) {
    problems.push(`growthStage must be one of ${GROWTH_STAGES.join('|')}`);
  }

  // Provenance is required by spec §23 — a record without it is not shippable.
  if (!asset.provenance || typeof asset.provenance !== 'object') {
    problems.push('missing provenance block (spec §23)');
  } else {
    for (const key of [
      'source', 'sourceUrl', 'license', 'downloadedAt',
      'originalFilename', 'optimizedFilename', 'optimizationProcess',
    ]) {
      if (!asset.provenance[key]) problems.push(`provenance.${key} missing`);
    }
  }
  return problems;
}

/** Fill in defaults so consumers never have to null-check optional fields. */
export function normalizeAsset(raw) {
  return {
    ...raw,
    species: raw.species ?? null,
    variants: Array.isArray(raw.variants) ? raw.variants.slice() : [],
    lods: { ...(raw.lods || {}) },
    metadata: { ...(raw.metadata || {}) },
  };
}

/**
 * Validate a whole manifest and return the records that are usable, plus the
 * problems found. A single bad record must not take down the whole registry —
 * but it must be reported loudly (the ingestion script exits non-zero on any
 * problem; the runtime just skips the broken record).
 *
 * @param {any} manifest
 * @returns {{assets: VegetationAsset[], byId: Map<string, VegetationAsset>, problems: string[]}}
 */
export function indexVegetationManifest(manifest) {
  const problems = [];
  const assets = [];
  const byId = new Map();

  const list = Array.isArray(manifest?.assets) ? manifest.assets : null;
  if (!list) return { assets, byId, problems: ['manifest has no `assets` array'] };

  for (const raw of list) {
    const issues = validateVegetationAsset(raw);
    if (issues.length) {
      problems.push(`${raw?.id || '(no id)'}: ${issues.join('; ')}`);
      continue;
    }
    if (byId.has(raw.id)) {
      problems.push(`${raw.id}: duplicate id — the second record was skipped`);
      continue;
    }
    const asset = normalizeAsset(raw);
    assets.push(asset);
    byId.set(asset.id, asset);
  }
  return { assets, byId, problems };
}

/**
 * Pick the GLB URL for a given LOD, falling back to the nearest available
 * level. Falls *down* the quality ladder (high → medium → low) when a level is
 * missing, and only ever returns a URL that actually exists on the record —
 * so a caller can never hand a 404 to the loader.
 *
 * @param {VegetationAsset} asset
 * @param {VegetationLod} lod
 * @returns {string|null}
 */
export function resolveAssetLodUrl(asset, lod = 'high') {
  if (!asset) return null;
  if (!asset.lods || !Object.keys(asset.lods).length) return asset.browserModel || null;
  const order = VEGETATION_LODS; // high, medium, low
  const start = Math.max(0, order.indexOf(lod));
  for (let i = start; i < order.length; i++) {
    const url = asset.lods[order[i]];
    if (url) return url;
  }
  // Requested LOD was *better* than anything present (e.g. only 'low' exists):
  // still return a real file rather than nothing.
  for (const key of order) {
    if (asset.lods[key]) return asset.lods[key];
  }
  return asset.browserModel || null;
}

/**
 * The complete set of GLB URLs a property's vegetation actually needs.
 *
 * Spec §20: "Do not load every Poly Haven tree model when the property only
 * contains one species." The renderer calls this with the instances it is about
 * to draw and loads exactly the returned URLs — nothing else. This is the
 * single definition of "which assets are required", so the lazy-loading
 * guarantee is testable in Node without a browser.
 *
 * @param {TreeInstance[]} instances
 * @param {Map<string, VegetationAsset>|Record<string, VegetationAsset>} registry
 * @param {VegetationLod|null} [lod] Restrict to one LOD level (e.g. only 'low'
 *                              for a far-tier pass); omit for all levels.
 * @returns {string[]} unique, deterministic-order list of GLB URLs
 */
export function requiredAssetUrls(instances, registry, lod = null) {
  const get = registry instanceof Map
    ? (id) => registry.get(id)
    : (id) => registry?.[id];
  const urls = new Set();
  // A property with 500 trees of one species must still issue 3 HTTP requests,
  // not 500 — so instance *identity* is irrelevant and only the distinct asset
  // ids matter. Tracking ids (rather than the resulting URLs) also keeps the
  // result correct when two assets share a URL.
  const seenAssetIds = new Set();
  for (const inst of instances || []) {
    const assetId = inst?.assetId;
    if (!assetId || seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    const asset = get(assetId);
    if (!asset) continue; // unknown asset id — skip rather than throw
    if (lod) {
      const url = resolveAssetLodUrl(asset, lod);
      if (url) urls.add(url);
    } else if (asset.lods && Object.keys(asset.lods).length) {
      for (const key of VEGETATION_LODS) {
        if (asset.lods[key]) urls.add(asset.lods[key]);
      }
    } else if (asset.browserModel) {
      urls.add(asset.browserModel);
    }
  }
  return [...urls].sort();
}

/**
 * Group instances by asset id — the batching unit for instanced rendering
 * (spec §21: one InstancedMesh per asset, not one object per tree).
 *
 * @param {TreeInstance[]} instances
 * @returns {Map<string, TreeInstance[]>}
 */
export function groupInstancesByAsset(instances) {
  const groups = new Map();
  for (const inst of instances || []) {
    const id = inst?.assetId;
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(inst);
  }
  return groups;
}

/** Human-readable label for UI — never fabricates a species. */
export function assetDisplayName(asset) {
  if (!asset) return 'Unknown';
  return asset.commonName || asset.species || asset.id;
}

/**
 * Count instances per asset for the vegetation panel (spec §18), sorted by
 * descending count so the most-used species lead the list.
 *
 * @param {TreeInstance[]} instances
 * @param {Map<string, VegetationAsset>|Record<string, VegetationAsset>} registry
 * @returns {Array<{assetId:string, name:string, species:string|null, count:number}>}
 */
export function vegetationSpeciesSummary(instances, registry) {
  const get = registry instanceof Map
    ? (id) => registry.get(id)
    : (id) => registry?.[id];
  const counts = new Map();
  for (const inst of instances || []) {
    if (!inst?.assetId) continue;
    counts.set(inst.assetId, (counts.get(inst.assetId) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([assetId, count]) => {
      const asset = get(assetId);
      return {
        assetId,
        name: assetDisplayName(asset),
        species: asset?.species ?? null,
        count,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
/** Minimal shape check for a TreeInstance before it reaches the renderer. */
export function validateTreeInstance(inst) {
  const problems = [];
  if (!inst || typeof inst !== 'object') return ['instance is not an object'];
  if (!inst.id) problems.push('missing id');
  if (!inst.assetId) problems.push('missing assetId');
  if (!inst.propertyId) problems.push('missing propertyId');
  if (!Number.isFinite(inst.latitude)) problems.push('latitude must be a finite number');
  if (!Number.isFinite(inst.longitude)) problems.push('longitude must be a finite number');
  if (inst.elevation != null && !Number.isFinite(inst.elevation)) {
    problems.push('elevation, when present, must be a finite number');
  }
  if (inst.rotation != null && !Number.isFinite(inst.rotation)) {
    problems.push('rotation, when present, must be a finite number (radians)');
  }
  if (inst.scale != null && !(Number.isFinite(inst.scale) && inst.scale > 0)) {
    problems.push('scale, when present, must be a positive finite number');
  }
  if (inst.status != null && !VEGETATION_STATUSES.includes(inst.status)) {
    problems.push(`status must be one of ${VEGETATION_STATUSES.join('|')}`);
  }
  return problems;
}

/**
 * Deterministic 32-bit string hash (FNV-1a) — stable ids, no dependency.
 * Same input always yields the same id on every platform and run.
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0; // signed 32-bit
}

/**
 * Build a TreeInstance, filling the honest defaults the spec insists on:
 * status 'proposed' (these are Land Intelligence plans, not observations),
 * growthStage 'unknown' (never inferred from a filename), scale 1 and a
 * rotation of 0 rather than `undefined` leaking into geometry code.
 *
 * @param {Partial<TreeInstance> & {assetId:string, propertyId:string, latitude:number, longitude:number}} input
 * @returns {TreeInstance}
 */
export function createTreeInstance(input) {
  const id = input.id || `tree-${Math.abs(hashString(
    `${input.propertyId}|${input.latitude},${input.longitude}|${input.assetId}`
  )).toString(36)}`;
  return {
    id,
    assetId: input.assetId,
    propertyId: input.propertyId,
    latitude: input.latitude,
    longitude: input.longitude,
    ...(Number.isFinite(input.elevation) ? { elevation: input.elevation } : {}),
    rotation: Number.isFinite(input.rotation) ? input.rotation : 0,
    scale: Number.isFinite(input.scale) ? input.scale : 1,
    status: input.status || DEFAULT_VEGETATION_STATUS,
    growthStage: input.growthStage || 'unknown',
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  };
}
