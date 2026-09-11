/**
 * Wildlife context assessment for Alberta permaculture sites.
 *
 * Delegates to wildlife-layer.js (expected ranges vs confirmed nearby
 * observations). Keeps white_tailed_deer for older report cards.
 */

import { buildWildlifeLayer } from './wildlife-layer.js';

/**
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 * @param {{ latitude: number, longitude: number }} centre
 * @param {object} [opts]
 * @returns {Promise<object>} wildlife context payload
 */
export async function assessWildlife(bbox, centre, opts = {}) {
  try {
    return await buildWildlifeLayer({
      bbox,
      centre,
      surface_water: opts.surface_water,
      wetlands: opts.wetlands,
      skipCache: opts.skipCache,
      fetchImpl: opts.fetchImpl,
    });
  } catch (e) {
    return {
      available: false,
      error: e.message || 'wildlife layer failed',
      expected_species: [],
      observations_nearby: [],
      species_at_risk_flagged: [],
      white_tailed_deer: null,
    };
  }
}
