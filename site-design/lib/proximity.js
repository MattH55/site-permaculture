/**
 * Proximity context: nearest water, city/settlement, jurisdiction-level crime.
 * Distances from site centroid. Crime is NEVER point-level — jurisdiction proxy only.
 */

import { esriEnvelope } from './geo.js';

const AB = 'https://geospatial.alberta.ca/titan/rest/services';

/** Alberta population centres / cities (approx centroids + StatCan-ish populations). */
export const ALBERTA_PLACES = [
  { name: 'Calgary', lat: 51.0447, lng: -114.0719, population: 1306784, type: 'city' },
  { name: 'Edmonton', lat: 53.5461, lng: -113.4938, population: 1010899, type: 'city' },
  { name: 'Red Deer', lat: 52.2681, lng: -113.8112, population: 100844, type: 'city' },
  { name: 'Lethbridge', lat: 49.6956, lng: -112.8451, population: 98406, type: 'city' },
  { name: 'St. Albert', lat: 53.6301, lng: -113.6256, population: 68232, type: 'city' },
  { name: 'Medicine Hat', lat: 50.0405, lng: -110.6764, population: 63371, type: 'city' },
  { name: 'Grande Prairie', lat: 55.1707, lng: -118.7947, population: 64141, type: 'city' },
  { name: 'Airdrie', lat: 51.2917, lng: -114.0144, population: 74100, type: 'city' },
  { name: 'Spruce Grove', lat: 53.545, lng: -113.9008, population: 37745, type: 'city' },
  { name: 'Leduc', lat: 53.2594, lng: -113.5492, population: 34094, type: 'city' },
  { name: 'Fort McMurray', lat: 56.7267, lng: -111.379, population: 68002, type: 'city' },
  { name: 'Fort Saskatchewan', lat: 53.7128, lng: -113.2133, population: 27088, type: 'city' },
  { name: 'Lloydminster', lat: 53.2783, lng: -110.005, population: 19500, type: 'city' },
  { name: 'Camrose', lat: 53.0168, lng: -112.8353, population: 18742, type: 'city' },
  { name: 'Brooks', lat: 50.5642, lng: -111.8989, population: 14924, type: 'city' },
  { name: 'Wetaskiwin', lat: 52.9695, lng: -113.3762, population: 12655, type: 'city' },
  { name: 'Cold Lake', lat: 54.4642, lng: -110.18, population: 15661, type: 'city' },
  { name: 'Lacombe', lat: 52.4683, lng: -113.7369, population: 13396, type: 'town' },
  { name: 'Okotoks', lat: 50.7261, lng: -113.9828, population: 30405, type: 'town' },
  { name: 'Cochrane', lat: 51.1918, lng: -114.467, population: 32000, type: 'town' },
  { name: 'Canmore', lat: 51.089, lng: -115.359, population: 15990, type: 'town' },
  { name: 'Banff', lat: 51.1784, lng: -115.5708, population: 8305, type: 'town' },
  { name: 'Hinton', lat: 53.4114, lng: -117.5639, population: 9882, type: 'town' },
  { name: 'Edson', lat: 53.5817, lng: -116.434, population: 8374, type: 'town' },
  { name: 'Whitecourt', lat: 54.1422, lng: -115.6839, population: 9926, type: 'town' },
  { name: 'Drayton Valley', lat: 53.2214, lng: -114.9764, population: 7235, type: 'town' },
  { name: 'Stony Plain', lat: 53.5264, lng: -114.0069, population: 17993, type: 'town' },
  { name: 'Morinville', lat: 53.8022, lng: -113.6497, population: 10600, type: 'town' },
  { name: 'Beaumont', lat: 53.3572, lng: -113.4147, population: 20888, type: 'city' },
  { name: 'Strathmore', lat: 51.0378, lng: -113.4003, population: 14339, type: 'town' },
  { name: 'High River', lat: 50.5808, lng: -113.8744, population: 14324, type: 'town' },
  { name: 'Taber', lat: 49.785, lng: -112.146, population: 8862, type: 'town' },
  { name: 'Peace River', lat: 56.2339, lng: -117.2911, population: 6842, type: 'town' },
  { name: 'Slave Lake', lat: 55.2844, lng: -114.7694, population: 6651, type: 'town' },
  { name: 'Bonnyville', lat: 54.2667, lng: -110.7333, population: 6404, type: 'town' },
  { name: 'Wainwright', lat: 52.8347, lng: -110.8572, population: 6287, type: 'town' },
  { name: 'Vegreville', lat: 53.4928, lng: -112.0522, population: 5708, type: 'town' },
  { name: 'Stettler', lat: 52.3236, lng: -112.7192, population: 5695, type: 'town' },
  { name: 'Olds', lat: 51.7928, lng: -114.1067, population: 9184, type: 'town' },
  { name: 'Innisfail', lat: 52.0208, lng: -113.95, population: 7985, type: 'town' },
  { name: 'Sylvan Lake', lat: 52.3083, lng: -114.0964, population: 15995, type: 'town' },
  { name: 'Blackfalds', lat: 52.3833, lng: -113.8, population: 11015, type: 'town' },
  { name: 'Devon', lat: 53.3633, lng: -113.7322, population: 6545, type: 'town' },
  { name: 'Chestermere', lat: 51.05, lng: -113.8225, population: 22163, type: 'city' },
  { name: 'Rocky Mountain House', lat: 52.3753, lng: -114.9211, population: 6635, type: 'town' },
];

/**
 * Jurisdiction-level Crime Severity Index proxies (public StatCan-style series).
 * Values are approximate planning context only — NOT parcel risk scores.
 * data_year reflects the reference year of the published series used for the table.
 */
const CRIME_BY_JURISDICTION = [
  // Larger municipal services (urban) — typically lower CSI than rural RCMP detachments
  { match: /calgary/i, jurisdiction: 'Calgary Police Service', csi: 78, rural: false, year: 2023 },
  { match: /edmonton/i, jurisdiction: 'Edmonton Police Service', csi: 106, rural: false, year: 2023 },
  { match: /lethbridge/i, jurisdiction: 'Lethbridge Police Service', csi: 130, rural: false, year: 2023 },
  { match: /medicine hat/i, jurisdiction: 'Medicine Hat Police Service', csi: 95, rural: false, year: 2023 },
  { match: /camrose/i, jurisdiction: 'Camrose Police Service', csi: 100, rural: false, year: 2023 },
  // Default rural Alberta / RCMP provincial context
  {
    match: /.*/,
    jurisdiction: 'RCMP Alberta (rural / detachment area — approximate)',
    csi: 145,
    rural: true,
    year: 2023,
  },
];

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ west: number, south: number, east: number, north: number }} bbox
 */
export async function gatherProximity(centre, bbox) {
  const { latitude: lat, longitude: lng } = centre;

  const [water, places] = await Promise.all([
    findNearestWater(lat, lng, bbox).catch((e) => ({
      error: e.message,
      nearest_water_source: null,
    })),
    Promise.resolve(findNearestPlaces(lat, lng)),
  ]);

  const nearest_city = places.nearest_city;
  const nearest_settlement = places.nearest_settlement;
  const crime_risk = estimateCrimeContext(nearest_city, nearest_settlement);

  return {
    nearest_water_source: water.nearest_water_source || null,
    nearest_city,
    nearest_settlement,
    amenities: [], // Overpass amenities can be added later without schema change
    crime_risk,
    _sources: {
      water: water.source_name || null,
      places: 'Alberta population-centre lookup (centroid haversine)',
      crime:
        'Statistics Canada Crime Severity Index by police service (jurisdiction proxy — not parcel-level)',
    },
  };
}

function findNearestPlaces(lat, lng) {
  const scored = ALBERTA_PLACES.map((p) => ({
    ...p,
    distance_km: haversineKm(lat, lng, p.lat, p.lng),
  })).sort((a, b) => a.distance_km - b.distance_km);

  // Prefer incorporated cities; fall back to large towns only if none nearby
  const citiesOnly = scored.filter((p) => p.type === 'city');
  const cityPick = citiesOnly[0] || scored.find((p) => p.population >= 10000) || null;
  const nearest_city = cityPick
    ? {
        name: cityPick.name,
        distance_km: round2(cityPick.distance_km),
        population: cityPick.population,
      }
    : null;

  const nearest_settlement = scored[0]
    ? {
        name: scored[0].name,
        distance_km: round2(scored[0].distance_km),
        settlement_type: mapSettlementType(scored[0]),
      }
    : null;

  return { nearest_city, nearest_settlement };
}

function mapSettlementType(p) {
  if (p.type === 'city') return 'city';
  if (p.population >= 10000) return 'town';
  if (p.population >= 1000) return 'village';
  return 'hamlet';
}

function estimateCrimeContext(nearest_city, nearest_settlement) {
  const name = nearest_city?.name || nearest_settlement?.name || '';
  const dist = nearest_city?.distance_km ?? nearest_settlement?.distance_km ?? 999;
  // Far from a sizeable centre → treat as rural for classification
  const forceRural = dist > 40;

  let row = CRIME_BY_JURISDICTION[CRIME_BY_JURISDICTION.length - 1];
  if (!forceRural) {
    for (const c of CRIME_BY_JURISDICTION) {
      if (c.match.source === '.*') continue;
      if (c.match.test(name)) {
        row = c;
        break;
      }
    }
  }

  return {
    reporting_jurisdiction: forceRural
      ? `RCMP Alberta rural area near ${name || 'site'} (proxy — detachment boundary not published as open parcel data)`
      : row.jurisdiction,
    crime_severity_index: row.csi,
    rural_or_urban_classification: forceRural || row.rural ? 'rural' : 'urban',
    data_year: row.year,
    disclaimer:
      'Jurisdiction-level Crime Severity Index context only — not a property-level risk score. Canadian crime stats are published by police service, not by address. Rural Alberta typically reports higher CSI than large urban services; treat this as coarse situational awareness.',
  };
}

async function findNearestWater(lat, lng, bbox) {
  // 1) Overpass — nearest natural water / waterway within 15 km
  try {
    const overpass = await nearestWaterOverpass(lat, lng, 15000);
    if (overpass) {
      return {
        nearest_water_source: overpass,
        source_name: 'OpenStreetMap Overpass (waterway / natural=water)',
        source_url: 'https://overpass-api.de/',
      };
    }
  } catch {
    /* fall through */
  }

  // 2) Alberta base water feature — sample features in a padded bbox, pick nearest centroid
  try {
    const ab = await nearestWaterAlberta(lat, lng, bbox);
    if (ab) {
      return {
        nearest_water_source: ab,
        source_name: 'Alberta Base Water Feature (ArcGIS REST)',
        source_url: `${AB}/environment/base_water_feature/MapServer`,
      };
    }
  } catch {
    /* fall through */
  }

  return {
    nearest_water_source: null,
    source_name: 'No water feature found within search radius',
  };
}

async function nearestWaterOverpass(lat, lng, radiusM) {
  const query = `
[out:json][timeout:25];
(
  way["waterway"](around:${radiusM},${lat},${lng});
  relation["waterway"](around:${radiusM},${lat},${lng});
  way["natural"="water"](around:${radiusM},${lat},${lng});
  relation["natural"="water"](around:${radiusM},${lat},${lng});
  way["landuse"="reservoir"](around:${radiusM},${lat},${lng});
  node["natural"="water"](around:${radiusM},${lat},${lng});
);
out center tags 60;
`.trim();

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let lastErr;
  for (const url of endpoints) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 22000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'ExpandingEdgeSiteDesign/1.0 (permaculture site report)',
        },
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const data = await res.json();
      const best = pickNearestWaterElement(data.elements || [], lat, lng);
      if (best) return best;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

function pickNearestWaterElement(els, lat, lng) {
  let best = null;
  for (const el of els) {
    const clat = el.lat ?? el.center?.lat;
    const clng = el.lon ?? el.center?.lon;
    if (clat == null || clng == null) continue;
    const d = haversineM(lat, lng, clat, clng);
    const tags = el.tags || {};
    const feature_type = classifyWater(tags);
    const feature_name = tags.name || tags.waterway || tags.water || null;
    if (!best || d < best.distance_m) {
      best = {
        distance_m: Math.round(d),
        feature_type,
        feature_name,
      };
    }
  }
  return best;
}

function classifyWater(tags) {
  const w = (tags.waterway || '').toLowerCase();
  const n = (tags.natural || '').toLowerCase();
  const water = (tags.water || '').toLowerCase();
  if (w === 'river') return 'river';
  if (w === 'stream' || w === 'brook' || w === 'ditch') return 'stream';
  if (w === 'canal') return 'stream';
  if (water === 'pond' || tags.landuse === 'reservoir') return 'pond';
  if (n === 'water' || water === 'lake' || water === 'reservoir') return 'lake';
  if (tags.wetland || n === 'wetland') return 'wetland';
  if (w) return 'stream';
  return 'lake';
}

async function nearestWaterAlberta(lat, lng, bbox) {
  // Identify works on this MapServer; many sublayers reject /query with 400.
  const pad = 0.15;
  const mapExtent = [
    bbox.west - pad,
    bbox.south - pad,
    bbox.east + pad,
    bbox.north + pad,
  ].join(',');
  const url =
    `${AB}/environment/base_water_feature/MapServer/identify?` +
    new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'all',
      tolerance: '80',
      mapExtent,
      imageDisplay: '800,600,96',
      returnGeometry: 'true',
      f: 'json',
    }).toString();

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`identify ${res.status}`);
    const data = await res.json();
    let best = null;
    for (const r of data.results || []) {
      const c = featureCentroid(r.geometry);
      if (!c) continue;
      const d = haversineM(lat, lng, c.lat, c.lng);
      const a = r.attributes || {};
      const name =
        nullIfNull(a.Name) ||
        nullIfNull(a.NAME) ||
        nullIfNull(a.NAME_EN) ||
        nullIfNull(r.value) ||
        null;
      const ft = String(a['Feature Type'] || r.layerName || '').toLowerCase();
      let feature_type = 'lake';
      if (ft.includes('stream') || ft.includes('river') && ft.includes('line'))
        feature_type = 'stream';
      else if (ft.includes('river')) feature_type = 'river';
      else if (ft.includes('wet') || ft.includes('sand')) feature_type = 'wetland';
      else if (ft.includes('lake') || ft.includes('pond')) feature_type = 'lake';
      else if (ft.includes('stream')) feature_type = 'stream';

      if (!best || d < best.distance_m) {
        best = {
          distance_m: Math.round(d),
          feature_type,
          feature_name: name && String(name) !== String(r.value) ? name : name,
        };
      }
    }
    return best;
  } finally {
    clearTimeout(t);
  }
}

function nullIfNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
}

function featureCentroid(geom) {
  if (!geom) return null;
  if (geom.x != null && geom.y != null) return { lng: geom.x, lat: geom.y };
  if (geom.rings?.[0]) {
    const ring = geom.rings[0];
    let x = 0;
    let y = 0;
    for (const [lng, lat] of ring) {
      x += lng;
      y += lat;
    }
    return { lng: x / ring.length, lat: y / ring.length };
  }
  if (geom.paths?.[0]) {
    const path = geom.paths[0];
    const mid = path[Math.floor(path.length / 2)];
    return { lng: mid[0], lat: mid[1] };
  }
  if (geom.points?.[0]) return { lng: geom.points[0][0], lat: geom.points[0][1] };
  return null;
}

async function fetchJsonPost(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: body.toString(),
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  return haversineM(lat1, lng1, lat2, lng2) / 1000;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
