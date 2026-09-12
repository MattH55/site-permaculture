/**
 * Minimal Three.js vegetation renderer: takes TreeInstance[] (from
 * scatterVegetation) + a manifest-derived registry (vegetation-assets.js) and
 * mounts them into a scene with live, camera-distance-driven LOD switching
 * (vegetation-lod.js) — the "renderer should know only how to render the
 * result" half of the spec (see vegetation-scatter.js's header comment).
 *
 * Two representations per instance:
 *   high   real cloned GLB geometry (asset.lods.high / browserModel)
 *   medium a single billboard card, baked once per distinct asset from its
 *          own GLB (front view only — these are small ground plants, not
 *          trees, so a cross-billboard's extra "reads right from any angle"
 *          benefit isn't worth the doubled fill cost at this scale)
 *   low    (beyond mediumMaxM, or beyond maxDrawDistanceM) hidden entirely —
 *          no separate mesh; matches vegetation-lod.js's `withinDrawDistance`
 *          being a cull check independent of tier selection
 *
 * Only one representation is visible per instance at a time; update() swaps
 * them based on ground distance to the camera, called once per frame by the
 * caller (this module holds no render loop of its own — same "renderer does
 * only rendering" boundary vegetation-scatter.js draws for placement).
 */

import { resolveAssetLodUrl, requiredAssetUrls } from './vegetation-assets.js';
import { selectLodByDistance, withinDrawDistance, DEFAULT_LOD_DISTANCES } from './vegetation-lod.js';

const _glbTemplateCache = new Map();
function loadGlbTemplate(url) {
  if (_glbTemplateCache.has(url)) return _glbTemplateCache.get(url);
  const p = new Promise((resolve) => {
    if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader !== 'function') return resolve(null);
    new THREE.GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, () => resolve(null));
  });
  _glbTemplateCache.set(url, p);
  return p;
}

let _billboardRenderer = null;
function getBillboardRenderer() {
  if (_billboardRenderer || typeof THREE === 'undefined') return _billboardRenderer;
  try {
    _billboardRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch { /* WebGL unavailable — medium tier falls back to the high mesh */ }
  return _billboardRenderer;
}

const _billboardTexCache = new Map();
/**
 * Bake a single front-view alpha-cut card texture from a GLB template — the
 * medium-LOD source. "Gamma-naive" (no sRGB/tonemap), matching how this
 * project's other PBR textures are baked and consumed (see
 * billboard-impostor-trees-instructions.md's lighting fix for why).
 */
function bakeBillboardTexture(url, viewSize = 256) {
  if (_billboardTexCache.has(url)) return _billboardTexCache.get(url);
  const p = loadGlbTemplate(url).then((template) => {
    const renderer = getBillboardRenderer();
    if (!template || !renderer) return null;
    renderer.setSize(viewSize, viewSize, false);

    const box = new THREE.Box3().setFromObject(template);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const radius = Math.max(size.x, size.z) * 0.6 || 0.3;
    const halfHeight = Math.max(size.y * 0.55, 0.05);

    const bakeScene = new THREE.Scene();
    const model = template.clone(true);
    model.position.sub(center);
    bakeScene.add(model);
    bakeScene.add(new THREE.HemisphereLight(0xdcefff, 0x2c3a24, 0.9));
    const key = new THREE.DirectionalLight(0xfff4e0, 1.6);
    key.position.set(1, 1.4, 1);
    bakeScene.add(key);

    const cam = new THREE.OrthographicCamera(-radius, radius, halfHeight, -halfHeight, -radius * 4, radius * 4);
    cam.position.set(0, 0, radius * 3);
    cam.lookAt(0, 0, 0);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(bakeScene, cam);

    const canvas = document.createElement('canvas');
    canvas.width = viewSize;
    canvas.height = viewSize;
    canvas.getContext('2d').drawImage(renderer.domElement, 0, 0, viewSize, viewSize);
    model.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return { tex, aspect: (radius * 2) / (halfHeight * 2), halfHeight };
  }).catch(() => null);
  _billboardTexCache.set(url, p);
  return p;
}

/**
 * Load every distinct asset this instance list needs (spec: never load more
 * than the property actually uses) and bake each one's medium-tier billboard.
 *
 * @param {import('./vegetation-assets.js').TreeInstance[]} instances
 * @param {Map<string,object>|Record<string,object>} registry
 * @returns {Promise<{templates: Map<string,THREE.Object3D>, billboards: Map<string,{tex:THREE.Texture,aspect:number,halfHeight:number}>}>}
 */
export async function preloadVegetationAssets(instances, registry) {
  const urls = requiredAssetUrls(instances, registry, 'high');
  const templates = new Map();
  const billboards = new Map();
  await Promise.all(urls.map(async (url) => {
    const [template, billboard] = await Promise.all([loadGlbTemplate(url), bakeBillboardTexture(url)]);
    templates.set(url, template);
    if (billboard) billboards.set(url, billboard);
  }));
  return { templates, billboards };
}

/**
 * Mount a list of vegetation instances into `scene`, with live LOD switching.
 *
 * @param {THREE.Scene} scene
 * @param {import('./vegetation-assets.js').TreeInstance[]} instances
 * @param {Map<string,object>|Record<string,object>} registry
 * @param {object} opts
 * @param {(lat:number, lon:number) => {x:number,y:number,z:number}} opts.toLocal
 * @param {number} opts.metersPerSceneUnit
 * @param {{templates:Map, billboards:Map}} opts.preloaded from preloadVegetationAssets()
 * @param {{highMaxM?:number, mediumMaxM?:number}} [opts.lodThresholds]
 * @param {number} [opts.maxDrawDistanceM]
 * @returns {{group:THREE.Group, update:(camera:THREE.Camera)=>void, dispose:()=>void}}
 */
export function mountVegetation(scene, instances, registry, opts) {
  const {
    toLocal, metersPerSceneUnit, preloaded,
    lodThresholds = DEFAULT_LOD_DISTANCES, maxDrawDistanceM = Infinity,
  } = opts;
  const get = registry instanceof Map ? (id) => registry.get(id) : (id) => registry?.[id];

  const group = new THREE.Group();
  group.name = 'vegetation';
  scene.add(group);

  const items = [];
  for (const inst of instances) {
    const asset = get(inst.assetId);
    if (!asset) continue;
    const url = resolveAssetLodUrl(asset, 'high');
    const template = preloaded.templates.get(url);
    if (!template) continue;
    const p = toLocal(inst.latitude, inst.longitude);
    const scale = (Number(inst.scale) || 1) * (Number(asset.defaultScale) || 1) / metersPerSceneUnit;

    const full = template.clone(true);
    full.position.set(p.x, p.y, p.z);
    full.scale.setScalar(scale);
    full.rotation.y = Number(inst.rotation) || 0;
    full.visible = false;
    group.add(full);

    let billboard = null;
    const baked = preloaded.billboards.get(url);
    if (baked) {
      const geo = new THREE.PlaneGeometry(baked.aspect * baked.halfHeight * 2, baked.halfHeight * 2);
      const mat = new THREE.MeshBasicMaterial({
        map: baked.tex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true,
      });
      billboard = new THREE.Mesh(geo, mat);
      billboard.scale.setScalar(scale);
      billboard.position.set(p.x, p.y + baked.halfHeight * scale, p.z);
      billboard.visible = false;
      group.add(billboard);
    }

    items.push({ full, billboard, x: p.x, z: p.z, currentTier: null });
  }

  function update(camera) {
    if (!camera) return;
    for (const item of items) {
      const dxU = camera.position.x - item.x;
      const dzU = camera.position.z - item.z;
      // Y-locked billboarding (a "cylindrical" billboard, not a full
      // sprite): rotate to face the camera around the vertical axis only, so
      // a small ground plant still plants its base on the terrain instead of
      // tilting with camera pitch. Done every frame regardless of tier so
      // there's no visible snap when a billboard becomes visible.
      if (item.billboard) item.billboard.rotation.y = Math.atan2(dxU, dzU);
      const distM = Math.sqrt(dxU * dxU + dzU * dzU) * metersPerSceneUnit;
      const drawable = withinDrawDistance(distM, maxDrawDistanceM);
      const tier = drawable ? selectLodByDistance(distM, lodThresholds) : 'culled';
      if (tier === item.currentTier) continue;
      item.currentTier = tier;
      item.full.visible = tier === 'high';
      if (item.billboard) item.billboard.visible = tier === 'medium';
      // 'low' with no separate cheap mesh reads as "hidden" — same as
      // 'culled' — rather than falling back to the (expensive) full mesh.
    }
  }

  function dispose() {
    for (const item of items) {
      item.full.geometry?.dispose?.();
      item.billboard?.geometry?.dispose?.();
      item.billboard?.material?.dispose?.();
    }
    scene.remove(group);
  }

  return { group, update, dispose };
}
