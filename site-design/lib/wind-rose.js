/**
 * Wind rose from NASA POWER (hourly WS10M + WD10M).
 *
 * Primary source: NASA Langley Research Center POWER Project
 *   https://power.larc.nasa.gov/
 * Community RE, 10 m wind speed (m/s) and meteorological direction (°).
 *
 * Builds a 16-direction × speed-bin frequency rose, primary/secondary
 * prevailing directions, and shelterbelt orientation envelopes.
 *
 * ACIS is no longer required (browser/session gate often blocks server use).
 */

const POWER_HOURLY =
  'https://power.larc.nasa.gov/api/temporal/hourly/point';
const UA = 'ExpandingEdgeAlberta/1.0 (site-design; research)';
const FETCH_MS = 90_000;

const DIRS16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** Speed bins (m/s) — low → high for stacked rose legend. */
const SPEED_BINS = [
  { name: '0–2 m/s', min: 0, max: 2 },
  { name: '2–4 m/s', min: 2, max: 4 },
  { name: '4–6 m/s', min: 4, max: 6 },
  { name: '6–8 m/s', min: 6, max: 8 },
  { name: '8–10 m/s', min: 8, max: 10 },
  { name: '≥10 m/s', min: 10, max: Infinity },
];

/**
 * Fetch NASA POWER hourly wind and build a wind rose for the site.
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ years?: number, endDate?: Date }} [opts]
 */
export async function getWindRose(centre, opts = {}) {
  const lat = centre?.latitude;
  const lng = centre?.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { available: false, error: 'Invalid centre coordinates' };
  }

  try {
    const years = Math.min(Math.max(opts.years ?? 2, 1), 5);
    const end = opts.endDate ? new Date(opts.endDate) : new Date();
    // Prefer complete years ending last full year if mid-year; otherwise rolling
    const endYmd = toYmd(end);
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - years);
    const startYmd = toYmd(start);

    const raw = await fetchPowerHourly(lat, lng, startYmd, endYmd);
    if (!raw?.ok) {
      return {
        available: false,
        error: raw?.error || 'NASA POWER wind request failed',
        source: 'NASA POWER',
        source_url: 'https://power.larc.nasa.gov/',
      };
    }

    const rose = binWindRose(raw.ws, raw.wd);
    if (!rose.n_obs) {
      return {
        available: false,
        error: 'NASA POWER returned no valid wind observations',
        source: 'NASA POWER',
        source_url: 'https://power.larc.nasa.gov/',
      };
    }

    const primary = rose.dir_rank[0] || null;
    const secondary = rose.dir_rank[1] || null;
    const shelterbelt = shelterbeltEnvelope(primary, secondary);

    return {
      available: true,
      station_name: `NASA POWER grid (${lat.toFixed(3)}°, ${lng.toFixed(3)}°)`,
      station_id: 'NASA-POWER-WS10M-WD10M',
      distance_km: 0,
      latitude: lat,
      longitude: lng,
      start_date: startYmd.slice(0, 4) + '-' + startYmd.slice(4, 6) + '-' + startYmd.slice(6, 8),
      end_date: endYmd.slice(0, 4) + '-' + endYmd.slice(4, 6) + '-' + endYmd.slice(6, 8),
      series: rose.series,
      n_obs: rose.n_obs,
      mean_speed_ms: rose.mean_speed_ms,
      calm_pct: rose.calm_pct,
      primary_direction: primary?.dir || null,
      primary_frequency_pct: primary?.freq_pct ?? null,
      primary_mean_speed_ms: primary?.mean_speed_ms ?? null,
      secondary_direction: secondary?.dir || null,
      secondary_frequency_pct: secondary?.freq_pct ?? null,
      secondary_mean_speed_ms: secondary?.mean_speed_ms ?? null,
      dir_frequencies: rose.dir_totals_pct,
      shelterbelt,
      source: 'NASA POWER (Langley Research Center) — hourly WS10M / WD10M @ 10 m',
      source_url: 'https://power.larc.nasa.gov/',
      methodology:
        'Hourly 10 m wind speed and meteorological direction binned into 16 compass sectors and speed classes. ' +
        'Frequencies are % of valid hours. Primary/secondary = top two sector frequencies. ' +
        'Shelterbelt axes are perpendicular to those sectors.',
      _meta: {
        parameters: ['WS10M', 'WD10M'],
        community: 'RE',
        years_requested: years,
        generated_at: new Date().toISOString(),
      },
    };
  } catch (e) {
    console.warn('Wind rose (NASA POWER) failed:', e.message);
    return {
      available: false,
      error: e.message,
      source: 'NASA POWER',
      source_url: 'https://power.larc.nasa.gov/',
    };
  }
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {string} startYmd YYYYMMDD
 * @param {string} endYmd YYYYMMDD
 */
async function fetchPowerHourly(lat, lng, startYmd, endYmd) {
  const params = new URLSearchParams({
    parameters: 'WS10M,WD10M',
    community: 'RE',
    longitude: String(Number(lng.toFixed(4))),
    latitude: String(Number(lat.toFixed(4))),
    start: startYmd,
    end: endYmd,
    format: 'JSON',
  });
  const url = `${POWER_HOURLY}?${params}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) {
      return { ok: false, error: `NASA POWER HTTP ${res.status}` };
    }
    const data = await res.json();
    const ws = data?.properties?.parameter?.WS10M || null;
    const wd = data?.properties?.parameter?.WD10M || null;
    if (!ws || !wd) {
      return { ok: false, error: 'NASA POWER response missing WS10M/WD10M' };
    }
    return { ok: true, ws, wd };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bin hourly series into stacked rose series compatible with the report SVG.
 * @param {Record<string, number>} wsMap
 * @param {Record<string, number>} wdMap
 */
export function binWindRose(wsMap, wdMap) {
  const nDirs = 16;
  const nBins = SPEED_BINS.length;
  // counts[speedBin][dir]
  const counts = Array.from({ length: nBins }, () => new Array(nDirs).fill(0));
  const dirSpeedSum = new Array(nDirs).fill(0);
  const dirCount = new Array(nDirs).fill(0);
  let n = 0;
  let speedSum = 0;
  let calm = 0;

  const keys = Object.keys(wsMap);
  for (const k of keys) {
    const speed = Number(wsMap[k]);
    const dir = Number(wdMap[k]);
    // POWER fill values are often -999
    if (!Number.isFinite(speed) || speed < 0 || speed > 80) continue;
    if (!Number.isFinite(dir) || dir < 0 || dir > 360) continue;

    n += 1;
    speedSum += speed;
    if (speed < 0.5) calm += 1;

    const dBin = dirToBin(dir);
    dirSpeedSum[dBin] += speed;
    dirCount[dBin] += 1;

    let sBin = nBins - 1;
    for (let i = 0; i < nBins; i++) {
      if (speed >= SPEED_BINS[i].min && speed < SPEED_BINS[i].max) {
        sBin = i;
        break;
      }
    }
    counts[sBin][dBin] += 1;
  }

  if (!n) {
    return {
      n_obs: 0,
      series: [],
      dir_totals_pct: [],
      dir_rank: [],
      mean_speed_ms: null,
      calm_pct: null,
    };
  }

  // Convert to % of all valid hours (stacked series for SVG)
  const series = counts.map((row, i) => ({
    name: SPEED_BINS[i].name,
    data: row.map((c) => round1((c / n) * 100)),
  }));

  const dirTotals = new Array(nDirs).fill(0);
  for (let s = 0; s < nBins; s++) {
    for (let d = 0; d < nDirs; d++) dirTotals[d] += counts[s][d];
  }
  const dir_totals_pct = dirTotals.map((c, i) => ({
    dir: DIRS16[i],
    freq_pct: round1((c / n) * 100),
    mean_speed_ms: dirCount[i] ? round2(dirSpeedSum[i] / dirCount[i]) : null,
  }));

  const dir_rank = [...dir_totals_pct]
    .sort((a, b) => b.freq_pct - a.freq_pct)
    .filter((d) => d.freq_pct > 0);

  return {
    n_obs: n,
    series,
    dir_totals_pct,
    dir_rank,
    mean_speed_ms: round2(speedSum / n),
    calm_pct: round1((calm / n) * 100),
  };
}

/** Meteorological direction ° → 16-bin index (0=N). */
export function dirToBin(deg) {
  // Centre bins on 0, 22.5, … — round(deg/22.5) mod 16
  let d = ((Number(deg) % 360) + 360) % 360;
  return Math.round(d / 22.5) % 16;
}

/**
 * Shelterbelt orientation from primary (and optional secondary) wind sectors.
 * Perpendicular to wind = plant axis.
 */
export function shelterbeltEnvelope(primary, secondary) {
  if (!primary?.dir) {
    return {
      primary_axis: null,
      secondary_axis: null,
      note: 'Insufficient wind data for shelterbelt orientation',
    };
  }

  const primaryAxis = perpendicularAxis(primary.dir);
  const secondaryAxis =
    secondary?.dir && secondary.freq_pct >= 8 ? perpendicularAxis(secondary.dir) : null;

  const multi =
    secondary?.freq_pct != null &&
    primary.freq_pct > 0 &&
    secondary.freq_pct / primary.freq_pct >= 0.65;

  let note =
    `Orient the main shelterbelt along ${primaryAxis.label} (perpendicular to ${primary.dir} winds, ` +
    `${primary.freq_pct}% of hours). Protected zone extends ~5–10× belt height leeward.`;

  if (secondaryAxis && multi) {
    note +=
      ` Secondary winds from ${secondary.dir} (${secondary.freq_pct}%) are significant — ` +
      `consider a second belt along ${secondaryAxis.label}, or an L/U-shaped multi-row design.`;
  } else if (secondaryAxis) {
    note +=
      ` Secondary sector ${secondary.dir} (${secondary.freq_pct}%) is moderate; a single well-designed multi-row belt may suffice, with optional return rows.`;
  }

  return {
    primary_axis: primaryAxis.label,
    primary_perpendicular_to: primary.dir,
    secondary_axis: secondaryAxis?.label || null,
    secondary_perpendicular_to: secondaryAxis ? secondary.dir : null,
    multi_directional: !!multi,
    note,
  };
}

function perpendicularAxis(dirLabel) {
  const idx = DIRS16.indexOf(dirLabel);
  if (idx < 0) return { label: 'E–W', index: 4 };
  // +90° = 4 bins of 22.5°
  const a = (idx + 4) % 16;
  const b = (idx + 12) % 16; // opposite end of same axis
  // Prefer naming main 8-point when both ends are cardinal-ish
  const label = `${DIRS16[a]}–${DIRS16[b]}`;
  return { label, index: a };
}

function toYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
