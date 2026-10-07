/**
 * Client-side sync copy of lib/vegetation-lod.js — public/ cannot import
 * from lib/ (see public/tree-scale.js for the same pattern). Keep these two
 * files identical; lib/vegetation-lod.test.js exercises this logic.
 */

/**
 * Tree LOD tier selection — pure math, no THREE/DOM.
 *
 * Spec §6 asks for three conceptual tiers:
 *
 *   0–50 m      HIGH    (near tier: full GLB geometry)
 *   50–200 m    MEDIUM  (cross-billboard impostor)
 *   200–1000+ m LOW     (cheap representation / culled)
 *
 * and explicitly says those distances are "starting defaults, not fixed
 * requirements. Tune them empirically." So they live here as named,
 * overridable constants rather than magic numbers buried in the render loop.
 *
 * This module mirrors the split the existing viewer already implements via
 * TREE_LOD in public/app.js (near = close to a *structure*, which is a static
 * site-context split). Distance-based selection is added alongside it for
 * camera-driven LOD, and both funnel through one classifier so the two tiers
 * can't disagree about what "near" means.
 */

/** @typedef {import('./vegetation-assets.js').VegetationLod} VegetationLod */

/**
 * Default camera-distance thresholds in metres (spec §6). Override per-call
 * for empirical tuning without editing this file.
 */
export const DEFAULT_LOD_DISTANCES = Object.freeze({
  highMaxM: 50,
  mediumMaxM: 200,
});

/**
 * Choose a LOD tier for a camera distance (metres, ground distance).
 * Below {@link DEFAULT_LOD_DISTANCES.highMaxM} → high, below mediumMaxM →
 * medium, beyond → low. Distances beyond a hard cutoff are the caller's
 * business (culling), not this classifier's — this always returns a tier, so a
 * tree is never silently dropped for being "too far" to have a tier.
 *
 * @param {number} distanceM
 * @param {{highMaxM?:number, mediumMaxM?:number}} [thresholds]
 * @returns {VegetationLod}
 */
export function selectLodByDistance(distanceM, thresholds = DEFAULT_LOD_DISTANCES) {
  const highMax = Number(thresholds?.highMaxM) > 0 ? thresholds.highMaxM : DEFAULT_LOD_DISTANCES.highMaxM;
  const mediumMax = Number(thresholds?.mediumMaxM) > highMax ? thresholds.mediumMaxM : DEFAULT_LOD_DISTANCES.mediumMaxM;
  const d = Number(distanceM);
  if (!Number.isFinite(d)) return 'low';
  if (d <= highMax) return 'high';
  if (d <= mediumMax) return 'medium';
  return 'low';
}

/**
 * Quantise a camera distance into LOD *hysteresis bands*: returns the tier plus
 * the distance band it belongs to. Used so a tree sitting exactly on a
 * threshold doesn't flip representations every frame as the camera jitters —
 * the caller keeps the previous tier until the distance leaves the band by a
 * margin.
 *
 * @param {number} distanceM
 * @param {number} [marginM] dead-band in metres on each side of a threshold
 * @param {{highMaxM?:number, mediumMaxM?:number}} [thresholds]
 * @returns {{lod:VegetationLod, stableBeforeM:number, stableAfterM:number}}
 */
export function lodHysteresisBand(distanceM, marginM = 5, thresholds = DEFAULT_LOD_DISTANCES) {
  const highMax = Number.isFinite(thresholds?.highMaxM) ? thresholds.highMaxM : DEFAULT_LOD_DISTANCES.highMaxM;
  const mediumMax = Number.isFinite(thresholds?.mediumMaxM) ? thresholds.mediumMaxM : DEFAULT_LOD_DISTANCES.mediumMaxM;
  const m = Math.max(0, Number(marginM) || 0);
  const d = Number(distanceM);
  if (!Number.isFinite(d)) {
    return { lod: 'low', stableBeforeM: Infinity, stableAfterM: Infinity };
  }
  if (d <= highMax) {
    return { lod: 'high', stableBeforeM: 0, stableAfterM: highMax + m };
  }
  if (d <= mediumMax) {
    return { lod: 'medium', stableBeforeM: highMax - m, stableAfterM: mediumMax + m };
  }
  return { lod: 'low', stableBeforeM: Math.max(0, mediumMax - m), stableAfterM: Infinity };
}

/**
 * Should a tree be rendered at all at this distance? Separate from LOD choice
 * so a "hide beyond N metres" performance rule (spec §20) can be tuned or
 * disabled without touching tier selection.
 *
 * @param {number} distanceM
 * @param {number} maxDrawDistanceM Use Infinity (the default) to never cull.
 * @returns {boolean}
 */
export function withinDrawDistance(distanceM, maxDrawDistanceM = Infinity) {
  if (!Number.isFinite(maxDrawDistanceM)) return true;
  const d = Number(distanceM);
  if (!Number.isFinite(d)) return true;
  return d <= maxDrawDistanceM;
}
