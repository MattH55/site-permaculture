/**
 * Tree canopy detection for Alberta permaculture sites.
 *
 * Approach: Uses Google Maps static satellite image loaded client-side
 * via a hidden canvas to sample green pixels within the property bbox.
 * Server-side provides the bounding box coordinates and pixel-sampling grid;
 * the frontend does the actual image analysis.
 *
 * For reports that can't access the Google Maps API (fallback mode, PDF),
 * a heuristic based on land cover type and wetland presence is used.
 */

/**
 * Generates a sampling grid of lat/lng points within the parcel bbox
 * that the frontend can use to sample satellite pixel colors.
 *
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 * @returns {{ grid: Array<{lat: number, lng: number}>, rows: number, cols: number }}
 */
export function generateTreeSampleGrid(bbox) {
  const cols = 20;
  const dLng = (bbox.east - bbox.west) / (cols + 1);
  const rows = Math.max(2, Math.round((bbox.north - bbox.south) / dLng));
  const dLat = (bbox.north - bbox.south) / (rows + 1);

  const grid = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      grid.push({
        lat: round5(bbox.south + r * dLat),
        lng: round5(bbox.west + c * dLng),
      });
    }
  }

  return {
    grid,
    rows,
    cols,
    bbox: {
      south: round5(bbox.south),
      north: round5(bbox.north),
      west: round5(bbox.west),
      east: round5(bbox.east),
    },
  };
}

/**
 * Heuristic tree cover estimate based on available site data.
 * Used as fallback when satellite pixel analysis is unavailable.
 *
 * @param {object} layers - site layers from gatherSiteLayers
 * @param {object} proximity - proximity context
 */
export function estimateTreeCover(layers, proximity) {
  const coverType = layers.existing_vegetation?.cover_type || 'tame_pasture';
  const wetlands = layers.wetlands || {};
  const soils = layers.soils || {};

  let treePct = 0;
  let source = 'heuristic';

  // Base estimates by cover type
  switch (coverType) {
    case 'forest': treePct = 70; break;
    case 'woodland': treePct = 40; break;
    case 'wetland_vegetation': treePct = 25; break;
    case 'tame_pasture': treePct = 5; break;
    case 'crop': treePct = 2; break;
    case 'shrubland': treePct = 15; break;
    case 'mixed': treePct = 25; break;
    default: treePct = 10; break;
  }

  // Wetlands usually have trees along margins
  if (wetlands.present) {
    treePct = Math.max(treePct, 15);
  }

  // Parkland zone adjustment (lat 52-55 = aspen parkland, naturally 15-30% treed)
  const lat = layers.centre?.latitude;
  if (lat && lat >= 52 && lat <= 55) {
    treePct = Math.max(treePct, 10);
  }

  // Boreal (north of 55) = naturally forested
  if (lat && lat > 55) {
    treePct = Math.max(treePct, 35);
  }

  // Grassland south (below 51) = naturally low tree cover
  if (lat && lat < 51) {
    treePct = Math.min(treePct, 15);
  }

  treePct = Math.min(95, Math.max(0, Math.round(treePct)));

  const treedAcres = treePct > 0 && layers.site_name
    ? `~${Math.round(treePct)}% tree canopy estimated`
    : 'Tree cover not assessed';

  let recommendations = [];
  if (treePct < 5) {
    recommendations = [
      'Very low tree cover — shelterbelt and windbreak are high priority for microclimate',
      'Consider pioneer nitrogen-fixing trees (caragana, sea buckthorn) to establish canopy',
      'Food forest will need full wind protection in establishment years',
    ];
  } else if (treePct < 20) {
    recommendations = [
      'Low to moderate tree cover — shelterbelt recommended on prevailing wind side',
      'Existing trees can serve as nurse plants for food forest understory',
      'Map existing tree clusters to integrate into Zone 3-4 design',
    ];
  } else if (treePct < 50) {
    recommendations = [
      'Moderate tree cover — good foundation for silvopasture or forest garden',
      'Assess species composition for timber, fruit, or wildlife value',
      'Thin strategically to increase light for understory crops',
    ];
  } else {
    recommendations = [
      'High tree cover — site likely suited for forest farming / agroforestry',
      'Consider mushroom logs, shade-tolerant medicinals, maple/syrup if species present',
      'Fire-smart perimeter design recommended for boreal/fringe properties',
    ];
  }

  return {
    available: true,
    method: source,
    tree_cover_pct: treePct,
    treed_acres_estimate: treedAcres,
    recommendations,
    methodology_note:
      `Tree cover estimated from vegetation cover type (${coverType}), ` +
      `wetland presence, and Alberta ecological zone heuristic. ` +
      'For precise canopy analysis, satellite pixel sampling (NDVI/color threshold) ' +
      'can be enabled when the site is viewed with Google Maps satellite imagery.',
  };
}

function round5(n) {
  return Math.round(n * 100000) / 100000;
}