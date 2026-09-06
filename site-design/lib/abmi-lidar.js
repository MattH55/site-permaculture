/**
 * ABMI LiDAR Canopy Height Model — DISABLED.
 *
 * The only released ABMI LiDAR bundle (Christina Lake, ~5,600 km², ~138 GB)
 * covers a small fraction of Alberta. The bulk-download / local-cache
 * architecture was not worth the infrastructure for province-wide coverage,
 * so this module is now a stub that always reports ABMI as unavailable.
 *
 * The canopy layer pipeline (see lib/canopy.js) no longer calls into ABMI;
 * it uses NRCan HRDEM (DSM − DTM) with a Google Earth Engine global-canopy
 * fallback. If ABMI is ever revisited, the correct architecture is
 * tile-level / windowed access (e.g. a cloud-hosted COG conversion), not a
 * local 200 GB bulk cache.
 *
 * Export signatures are preserved so existing imports keep working; every
 * function returns an "unavailable / disabled" result.
 */

// Kept for backwards compatibility (referenced by older tests / tooling).
export const CACHE_DIR =
  process.env.ABMI_CACHE_DIR ||
  'data/cache/abmi-lidar';

// Known ABMI LiDAR project extents — retained as reference data only.
export const PROJECTS = [
  {
    id: 'christina_lake',
    name: 'Christina Lake',
    release: '2024-06',
    bundle_url:
      'https://ftp-public.abmi.ca/GISData/Lidar/ABMI_lidar_Canopy_Height_Model.7z',
    metadata_url:
      'https://ftp-public.abmi.ca/GISData/Lidar/CanopyHeight_Metadata.pdf',
    bbox: { west: -118.35, south: 55.35, east: -117.7, north: 56.15 },
    crs: 'EPSG:4647',
    resolution_m: 1,
  },
];

const DISABLED = {
  available: false,
  reason: 'abmi_disabled',
  note:
    'ABMI LiDAR is disabled (bulk-download path not worth the infrastructure). ' +
    'Use lib/canopy.js for the active canopy layer (NRCan HRDEM + GEE fallback).',
};

/**
 * @deprecated ABMI is disabled. Returns an unavailable result always.
 * @param {{ west:number,south:number,east:number,north:number }} _bbox
 * @param {{ size?: number }} [_opts]
 */
export async function sampleAbmiCanopyHeight(_bbox, _opts = {}) {
  return { ...DISABLED };
}

/**
 * @deprecated ABMI is disabled. Always returns null.
 * @param {{ west:number,south:number,east:number,north:number }} _bbox
 */
export function projectCovers(_bbox) {
  return null;
}

/**
 * @deprecated ABMI is disabled. Always returns null.
 * @param {object} _project
 * @param {{ west:number,south:number,east:number,north:number }} _bbox
 */
export function findLocalTile(_project, _bbox) {
  return null;
}