/**
 * Wind rose data from Alberta Climate Information Service (ACIS).
 *
 * Fetches station list + binned wind-direction frequency from
 *   https://acis.alberta.ca/acis/api/v1/weather/stations
 *   https://acis.alberta.ca/acis/api/v1/weather/wind/binned-frequency
 *
 * Requires a browser-like session (ACIS blocks raw server calls).
 * We bootstrap a JSESSIONID by visiting the wind-rose page first.
 */

import { haversineKm } from './proximity.js';

const ACIS_BASE = 'https://acis.alberta.ca/acis';
const ACIS_PAGE = 'https://acis.alberta.ca/wind-rose.jsp';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Fetch with browser-like headers and follow redirects.
 */
async function acisFetch(url, cookie = '') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/html, */*',
        'Referer': ACIS_PAGE,
        ...(cookie ? { 'Cookie': cookie } : {}),
      },
      redirect: 'follow',
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const jsession = setCookie.match(/JSESSIONID=([^;]+)/)?.[1] || null;
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, jsession };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get an ACIS session cookie by visiting the wind-rose page.
 */
async function getSession() {
  const res = await acisFetch(ACIS_PAGE);
  if (res.jsession) return `JSESSIONID=${res.jsession}`;
  return '';
}

/**
 * Fetch the full station list from ACIS.
 */
async function fetchStations(cookie) {
  // Try the API; if it returns the "browser only" message, retry with session
  let res = await acisFetch(`${ACIS_BASE}/api/v1/weather/stations`, cookie);
  if (!res.ok || res.text.includes('web interface')) {
    // Get fresh session
    cookie = await getSession();
    res = await acisFetch(`${ACIS_BASE}/api/v1/weather/stations`, cookie);
  }
  if (!res.ok || res.text.includes('web interface')) {
    throw new Error('ACIS stations API unavailable');
  }
  return JSON.parse(res.text);
}

/**
 * Fetch wind binned-frequency for a station.
 * @param {string} cookie
 * @param {string|number} stationId
 * @param {string} element - e.g. 'wd_sd' (wind direction standard), 'wd_sr' (speed range)
 * @param {string} startISO
 * @param {string} endISO
 */
async function fetchWindData(cookie, stationId, element, startISO, endISO) {
  const params = new URLSearchParams({
    stationId: String(stationId),
    windDirCd: element,
    interval: 'yearly',
    startTimestamp: startISO,
    endTimestamp: endISO,
  });
  const url = `${ACIS_BASE}/api/v1/weather/wind/binned-frequency?${params}`;
  let res = await acisFetch(url, cookie);
  if (!res.ok || res.text.includes('web interface')) {
    cookie = await getSession();
    res = await acisFetch(url, cookie);
  }
  if (!res.ok || res.text.includes('web interface')) {
    return null;
  }
  try {
    return JSON.parse(res.text);
  } catch {
    return null;
  }
}

/**
 * Find the nearest ACIS station to a point that has wind data.
 * @param {{ latitude: number, longitude: number }} centre
 * @returns {Promise<object>}
 */
export async function getWindRose(centre) {
  try {
    const cookie = await getSession();
    const stations = await fetchStations(cookie);

    if (!Array.isArray(stations) || !stations.length) {
      return { available: false, error: 'No ACIS stations returned' };
    }

    // Find nearest station with wind direction support
    const candidates = stations
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({
        ...s,
        _dist: haversineKm(centre.latitude, centre.longitude, s.latitude, s.longitude),
      }))
      .sort((a, b) => a._dist - b._dist);

    // Try up to 5 nearest stations
    const now = new Date();
    const fiveYearsAgo = new Date(now);
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const startISO = fiveYearsAgo.toISOString();
    const endISO = now.toISOString();

    for (const st of candidates.slice(0, 5)) {
      // Check if station supports wind direction ('wd_sd')
      const supported = st.supportedValues || {};
      const yearly = supported.yearly || supported.monthly || [];
      const hasWind = yearly.some((v) =>
        ['wd_sd', 'wd_sr'].includes(v) || (typeof v === 'string' && v.startsWith('wd'))
      );

      if (!hasWind && !yearly.includes('wd_sd')) {
        // Try anyway — metadata may be incomplete
      }

      const data = await fetchWindData(cookie, st.stationId, 'wd_sd', startISO, endISO);
      if (data && Array.isArray(data) && data.length > 0) {
        return {
          available: true,
          station_name: st.name,
          station_id: st.stationId,
          distance_km: Math.round(st._dist * 10) / 10,
          latitude: st.latitude,
          longitude: st.longitude,
          start_date: startISO.slice(0, 10),
          end_date: endISO.slice(0, 10),
          series: data,
          source: 'Alberta Climate Information Service (ACIS)',
          source_url: 'https://acis.alberta.ca/wind-rose.jsp',
        };
      }
    }

    return {
      available: false,
      error: 'No wind direction data at nearby ACIS stations',
      nearest_station: candidates[0]?.name || null,
      nearest_station_distance_km: candidates[0] ? Math.round(candidates[0]._dist * 10) / 10 : null,
    };
  } catch (e) {
    console.warn('Wind rose fetch failed:', e.message);
    return { available: false, error: e.message };
  }
}