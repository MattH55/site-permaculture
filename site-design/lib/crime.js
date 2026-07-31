/**
 * Crime map context for Alberta parcels.
 *
 * Primary (province-wide rural / RCMP):
 *   Alberta Rural Crime Watch — RCMP Area Crime Map
 *   https://www.ruralcrimewatch.ab.ca/resources/RCMP-area-crime-map
 *   Viewer: https://rcmp-k-div.maps.arcgis.com/apps/webappviewer/index.html?id=f648d78dbfb143d0b3bdf47d8eb2bbee
 *
 * Supplemental (Edmonton only):
 *   EPS Occurrences CSDP — EPS_OCC_30DAY FeatureServer
 *   Locations anonymized to nearest intersection — not addresses.
 *   https://experience.arcgis.com/experience/8e2c6c41933e48a79faa90048d9a459d
 */

/** Alberta RCMP K-Division public crime web app (Rural Crime Watch resource). */
export const RCMP_CRIME_MAP_PAGE =
  'https://www.ruralcrimewatch.ab.ca/resources/RCMP-area-crime-map';
export const RCMP_CRIME_MAP_VIEWER_BASE =
  'https://rcmp-k-div.maps.arcgis.com/apps/webappviewer/index.html?id=f648d78dbfb143d0b3bdf47d8eb2bbee';
export const RCMP_REPORT_SUSPICIOUS = 'tel:3107267';

/**
 * Embed / open URL for the RCMP Area Crime Map, optionally centred near the parcel.
 * @param {{ latitude: number, longitude: number }|null} [centre]
 * @param {{ level?: number }} [opts]
 */
export function rcmpCrimeMapUrl(centre = null, opts = {}) {
  const level = opts.level ?? 10;
  if (
    centre &&
    Number.isFinite(centre.latitude) &&
    Number.isFinite(centre.longitude)
  ) {
    // Web AppViewer accepts center=lon,lat and level for initial extent
    return `${RCMP_CRIME_MAP_VIEWER_BASE}&center=${centre.longitude},${centre.latitude}&level=${level}`;
  }
  return RCMP_CRIME_MAP_VIEWER_BASE;
}

/**
 * Lightweight payload for the report UI (no scrape of RCMP app data).
 * The map is the source of truth; we only deep-link / embed it.
 */
export function ruralCrimeWatchContext(centre) {
  const mapUrl = rcmpCrimeMapUrl(centre);
  return {
    available: true,
    provider: 'Alberta RCMP / Rural Crime Watch',
    source_name: 'RCMP Area Crime Map (Alberta Rural Crime Watch)',
    source_url: RCMP_CRIME_MAP_PAGE,
    map_url: mapUrl,
    fullscreen_url: mapUrl,
    report_suspicious_tel: '310-RCMP (7267)',
    report_suspicious_href: RCMP_REPORT_SUSPICIOUS,
    note:
      'Province-wide Alberta RCMP crime map used by Rural Crime Watch associations. ' +
      'Shows approximate recent incidents for community awareness — not a parcel risk score. ' +
      'Report suspicious activity: 310-RCMP (7267). Emergencies: 911.',
    disclaimer:
      'Incident locations and categories are published by the RCMP for public awareness and may be approximate or delayed. ' +
      'This is situational awareness only — not a safety rating, insurance product, or police clearance for your property.',
  };
}

const EPS_LAYER =
  'https://services9.arcgis.com/pkzvt2xlZJnPgk1Z/arcgis/rest/services/EPS_OCC_30DAY/FeatureServer/0';

/** Approx Edmonton city centre */
const EDMONTON = { lat: 53.5461, lng: -113.4938 };

/** Beyond this distance from city centre we skip the live EPS layer */
const EPS_MAX_KM = 38;

const FETCH_MS = 22_000;

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ limit?: number, search_radius_m?: number }} [opts]
 */
export async function fetchNearestEpsCrimes(centre, opts = {}) {
  const lat = centre.latitude;
  const lng = centre.longitude;
  const limit = opts.limit ?? 20;
  const searchRadiusM = opts.search_radius_m ?? 8000;

  const distToEdmKm = haversineKm(lat, lng, EDMONTON.lat, EDMONTON.lng);
  if (distToEdmKm > EPS_MAX_KM) {
    return {
      available: false,
      in_eps_coverage: false,
      distance_to_edmonton_km: round1(distToEdmKm),
      nearest: [],
      note: `Site is ~${round1(distToEdmKm)} km from Edmonton centre — outside typical EPS Community Safety Map coverage. Live nearest-occurrence list is only available inside / near the City of Edmonton.`,
      source_name: 'Edmonton Police Service — Occurrences CSDP (Community Safety Map)',
      source_url:
        'https://experience.arcgis.com/experience/8e2c6c41933e48a79faa90048d9a459d',
      disclaimer: epsDisclaimer(),
    };
  }

  try {
    // Fetch a buffer of recent points, rank by haversine to site centroid
    const features = await queryEpsNear(lat, lng, searchRadiusM, Math.max(limit * 8, 120));
    const scored = [];
    for (const f of features) {
      const a = f.attributes || {};
      const g = f.geometry || {};
      const x = g.x ?? g.longitude;
      const y = g.y ?? g.latitude;
      if (x == null || y == null) continue;
      const distance_m = Math.round(haversineM(lat, lng, y, x));
      scored.push({
        distance_m,
        occurrence_category: a.Occurrence_Category || null,
        occurrence_group: a.Occurrence_Group || null,
        occurrence_type: a.Occurrence_Type_Group || null,
        intersection: a.Intersection || null,
        date_reported: a.Date_Reported || formatEpoch(a.Reported_Date),
        reported_year: a.Reported_Year || null,
        reported_month: a.Reported_Month || null,
        latitude: y,
        longitude: x,
      });
    }
    scored.sort((a, b) => a.distance_m - b.distance_m);
    const nearest = scored.slice(0, limit);

    // Category breakdown for the returned set
    const by_type = {};
    const by_group = {};
    for (const c of nearest) {
      const t = c.occurrence_type || 'Unknown';
      const g = c.occurrence_group || 'Unknown';
      by_type[t] = (by_type[t] || 0) + 1;
      by_group[g] = (by_group[g] || 0) + 1;
    }

    return {
      available: true,
      in_eps_coverage: true,
      distance_to_edmonton_km: round1(distToEdmKm),
      search_radius_m: searchRadiusM,
      count: nearest.length,
      nearest,
      summary: {
        by_occurrence_type: by_type,
        by_occurrence_group: by_group,
      },
      source_name:
        'Edmonton Police Service — Occurrences CSDP / Community Safety Map (EPS_OCC_30DAY)',
      source_url:
        'https://experience.arcgis.com/experience/8e2c6c41933e48a79faa90048d9a459d',
      data_portal_url:
        'https://communitysafetydataportal.edmontonpolice.ca/datasets/b3e3584e4b0d4f198bb5eefff7c04932_0',
      feature_server: EPS_LAYER,
      disclaimer: epsDisclaimer(),
      note:
        nearest.length === 0
          ? `No EPS occurrences returned within ${searchRadiusM} m of the parcel centroid in the current public layer window.`
          : `Showing ${nearest.length} nearest publicly mapped occurrences (locations snapped to intersections by EPS).`,
    };
  } catch (e) {
    return {
      available: false,
      in_eps_coverage: true,
      distance_to_edmonton_km: round1(distToEdmKm),
      nearest: [],
      error: e.message || String(e),
      source_name: 'Edmonton Police Service — Occurrences CSDP (Community Safety Map)',
      source_url:
        'https://experience.arcgis.com/experience/8e2c6c41933e48a79faa90048d9a459d',
      disclaimer: epsDisclaimer(),
    };
  }
}

function epsDisclaimer() {
  return 'EPS maps occurrences to the nearest intersection to protect privacy — not a specific address or parcel. Points are approximate. This is situational awareness for the neighbourhood, not a property safety score. Data refreshes daily with a 24–48 h delay and is subject to change.';
}

async function queryEpsNear(lat, lng, radiusM, recordCount) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusM),
    units: 'esriSRUnit_Meter',
    outFields:
      'Occurrence_Category,Occurrence_Group,Occurrence_Type_Group,Intersection,Date_Reported,Reported_Date,Reported_Day,Reported_Month,Reported_Year',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(recordCount),
    f: 'json',
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(`${EPS_LAYER}/query?${params}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`EPS FeatureServer HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.message || 'EPS query failed');
    }
    return data.features || [];
  } finally {
    clearTimeout(t);
  }
}

function formatEpoch(ms) {
  if (ms == null || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
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

function round1(n) {
  return Math.round(n * 10) / 10;
}
