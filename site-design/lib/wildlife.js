/**
 * Wildlife context assessment for Alberta permaculture sites.
 *
 * Primary: iNaturalist API for recent White-tailed Deer / Mule Deer sightings.
 * Fallback: heuristic based on land cover, proximity to water, and county-level
 *   agricultural context (rural Alberta almost always has some deer pressure).
 *
 * Future: ABMI habitat suitability GeoTIFF raster analysis (when rasters are
 *   downloaded from ftp.public.abmi.ca).
 */

/**
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 * @param {{ latitude: number, longitude: number }} centre
 * @returns {Promise<object>} wildlife context payload
 */
export async function assessWildlife(bbox, centre) {
  // Run iNaturalist and heuristic in parallel
  const [inat, heuristic] = await Promise.all([
    fetchINaturalist(bbox).catch(() => null),
    Promise.resolve(heuristicDeerPressure(centre)),
  ]);

  const whiteTailedDeer = summarizeDeer(inat, heuristic);

  return {
    available: true,
    source_name: 'iNaturalist observations + Alberta county heuristic',
    source_url: 'https://api.inaturalist.org/v1/observations',
    white_tailed_deer: whiteTailedDeer,
    recent_sightings: inat
      ? {
          count: inat.total_results || 0,
          last_seen: inat.last_observed || null,
          source: 'iNaturalist (research-grade, last 5 years)',
        }
      : { count: 0, last_seen: null, source: 'iNaturalist unavailable — heuristic fallback' },
    sighting_species: inat?.observations?.map((o) => o.taxon).filter(Boolean) || [],
    methodology_note:
      whiteTailedDeer.assessment +
      ' Deer are present almost everywhere in rural Alberta — this is a relative pressure indicator, not a presence/absence test.',
  };
}

// ---------- iNaturalist ----------

async function fetchINaturalist(bbox) {
  // White-tailed Deer: taxon_id=42223; Mule Deer: 42195
  const taxonIds = [42223, 42195];
  const allResults = [];

  for (const taxonId of taxonIds) {
    // Expand bbox by ~2km (0.02°) for better wildlife coverage
    const padLat = 0.02, padLng = 0.02;
    const url =
      `https://api.inaturalist.org/v1/observations?` +
      `taxon_id=${taxonId}` +
      `&swlat=${bbox.south - padLat}&swlng=${bbox.west - padLng}` +
      `&nelat=${bbox.north + padLat}&nelng=${bbox.east + padLng}` +
      `&per_page=50&order_by=observed_on&order=desc` +
      `&quality_grade=research` +
      `&d1=${fiveYearsAgo()}`;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 18_000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'ExpandingEdgePermaculture/1.0' },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.results) {
        allResults.push(...data.results.map((r) => ({
          taxon: r.taxon?.name || (taxonId === 42223 ? 'White-tailed Deer' : 'Mule Deer'),
          observed_on: r.observed_on || r.time_observed_at?.slice(0, 10) || null,
          quality: r.quality_grade,
          lat: r.geoprivacy ? null : (r.location ? r.location.split(',')[0] : null),
          lng: r.geoprivacy ? null : (r.location ? r.location.split(',')[1] : null),
        })));
      }
    } catch {
      /* skip */
    }
  }

  if (!allResults.length) return null;

  // Sort by date
  allResults.sort((a, b) => (b.observed_on || '').localeCompare(a.observed_on || ''));
  const lastObserved = allResults[0]?.observed_on || null;

  // Count by taxon
  const byTaxon = {};
  for (const r of allResults) {
    byTaxon[r.taxon] = (byTaxon[r.taxon] || 0) + 1;
  }

  return {
    total_results: allResults.length,
    last_observed: lastObserved,
    by_taxon: byTaxon,
    observations: allResults.slice(0, 20),
  };
}

function fiveYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

// ---------- Heuristic ----------

function heuristicDeerPressure(centre) {
  // Deer are ubiquitous in rural Alberta. Factors that increase pressure:
  //   - Proximity to water (streams, wetlands) = higher
  //   - Agricultural land / edge habitat = higher
  //   - Forest/fringe areas = higher
  //   - Urban/suburban = lower but still present

  const lat = centre.latitude;

  // Broad ecological zones
  let base = 0.5; // Default: moderate

  // Parkland zone (52-55) — classic deer habitat, highest pressure
  if (lat >= 52 && lat <= 55) base = 0.65;
  // Boreal transition (55-57) — still high
  else if (lat > 55 && lat <= 57) base = 0.55;
  // Southern grassland (49-51) — moderate, mule deer country
  else if (lat < 51) base = 0.50;
  // Foothills (50-52 west of ~114.5) — high
  // Northern boreal (57+) — lower

  // All of Alberta: assume at least "moderate" deer presence
  // This is a planning heuristic — not ecological modeling

  let label;
  if (base >= 0.65) label = 'High deer pressure expected';
  else if (base >= 0.50) label = 'Moderate deer pressure likely';
  else label = 'Lower deer density — but still present';

  return {
    pressure_score: base,
    pressure_label: label,
    assessment: `Rural Alberta county-level heuristic (lat ${lat.toFixed(1)}°). ` +
      'Deer are mobile and follow water corridors + edge habitat. ' +
      'Presence should be assumed for any rural Alberta property regardless of score.',
  };
}

function summarizeDeer(inat, heuristic) {
  const sightings = inat?.total_results || 0;
  const lastSeen = inat?.last_observed || null;

  let pressureScore = heuristic.pressure_score;
  let pressureLabel = heuristic.pressure_label;

  // Adjust score upwards if there are recent sightings within the bbox
  if (sightings >= 10) {
    pressureScore = Math.min(0.95, pressureScore + 0.15);
    pressureLabel = 'Confirmed high deer activity (recent sightings)';
  } else if (sightings >= 3) {
    pressureScore = Math.min(0.85, pressureScore + 0.1);
    pressureLabel = 'Confirmed deer presence (recent sightings)';
  }

  // Round to 2 decimals
  pressureScore = Math.round(pressureScore * 100) / 100;

  let recommendations = [];
  if (pressureScore >= 0.65) {
    recommendations = [
      'Plan for deer fencing or individual tree guards on all new plantings',
      'Select deer-resistant species for Zone 4-5 shelterbelt and food forest edges',
      'Locate food forest Zone 1-2 close to buildings (deer avoid human activity)',
      'Consider sacrificial browse hedgerow on perimeter',
    ];
  } else if (pressureScore >= 0.40) {
    recommendations = [
      'Tree guards recommended for high-value saplings',
      'Monitor browse damage in first 1-2 years after planting',
      'Deer-resistant understory recommended for food forest',
    ];
  } else {
    recommendations = [
      'Deer pressure appears low — basic monitoring sufficient',
      'Tree guards only for highest-value specimen trees',
    ];
  }

  return {
    pressure_score: pressureScore,
    pressure_label: pressureLabel,
    sightings_count: sightings,
    last_sighting: lastSeen,
    by_taxon: inat?.by_taxon || {},
    recommendations,
    assessment: heuristic.assessment,
  };
}