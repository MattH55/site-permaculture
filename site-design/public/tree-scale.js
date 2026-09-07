/**
 * Pure (no DOM/THREE) scene-scale math shared between the 3D viewer
 * (app.js) and its Node test — see tree-rendering-fix-and-forest-texture
 * instructions, Part 1. Kept isolated so the "does a 10m tree measure 10m"
 * sanity check can run without a browser/WebGL harness.
 *
 * The terrain mesh is fit into a `meshSize`-unit box, undistorted (ground
 * aspect ratio preserved — see terrain3dBlock in app.js), so real-world
 * meters convert to scene units by a single isotropic factor regardless of
 * axis. That's the fix for Part 1's bug #1/#2: the old placeholder tree
 * meshes used a fixed absolute scene-unit size (e.g. 0.3 units tall)
 * regardless of the parcel's real ground size — fine for a small lot,
 * wildly oversized (or undersized) once meshSize=10 units represents a
 * multi-km parcel. Every tree dimension must instead be derived from an
 * actual meters-per-scene-unit factor, never a bare constant.
 */

/**
 * @param {{west:number, south:number, east:number, north:number}} bbox
 * @param {number} [meshSize] must match the value terrain3dBlock uses (10)
 * @returns {{meshW:number, meshD:number, metersPerSceneUnit:number}}
 */
export function groundSceneScale(bbox, meshSize = 10) {
  const lngRange = bbox.east - bbox.west || 0.001;
  const latRange = bbox.north - bbox.south || 0.001;
  const latMid = (bbox.north + bbox.south) / 2;
  const kmPerDegLng = 111.32 * Math.cos((latMid * Math.PI) / 180);
  const kmPerDegLat = 111.32;
  const aspect = (lngRange * kmPerDegLng) / (latRange * kmPerDegLat);
  const meshW = meshSize * Math.min(aspect, 1);
  const meshD = meshSize / Math.max(aspect, 1);
  const groundWidthM = lngRange * kmPerDegLng * 1000;
  return { meshW, meshD, metersPerSceneUnit: groundWidthM / meshW };
}

/**
 * Derive a tree instance's scene-unit geometry from its real measured
 * dimensions. Height and crown radius both scale by the *same* factor
 * (`metersPerSceneUnit`) — fixes bug #4 (non-uniform scaling): a tree
 * scaled tall without scaling its crown to match reads as a spike, not a
 * tree. Trunk radius is derived from crown radius (not an independent
 * constant), so there is exactly one scale factor applied once — fixes
 * bug #3 (double-scaling): nothing here bakes in a second multiplier on
 * top of `metersPerSceneUnit`.
 *
 * @param {{height_m:number, crown_radius_m:number}} tree
 * @param {number} metersPerSceneUnit from groundSceneScale()
 * @returns {{heightU:number, crownU:number, trunkH:number, canopyH:number, trunkRadiusU:number}}
 */
export function treeInstanceDimensions(tree, metersPerSceneUnit) {
  const heightM = Number(tree.height_m) || 2;
  const crownM = Number(tree.crown_radius_m) || 0.6;
  const heightU = Math.max(heightM / metersPerSceneUnit, 0.001);
  const crownU = Math.max(crownM / metersPerSceneUnit, 0.001);
  const trunkH = heightU * 0.35;
  const canopyH = heightU * 0.65;
  return { heightU, crownU, trunkH, canopyH, trunkRadiusU: crownU * 0.18 };
}
