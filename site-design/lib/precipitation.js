/**
 * Precipitation context for a site centre.
 *
 * Primary operational source: NASA POWER (PRECTOTCORR) — free point API.
 * Attribution / research archive: NASA GPM PPS
 *   https://arthurhouhttps.pps.eosdis.nasa.gov/
 *   (IMERG files require PPS registration: email as username & password)
 *
 * When GPM_PPS_EMAIL is set, we attempt a lightweight PPS presence check and
 * record the archive link; full IMERG raster sampling is not done server-side.
 */

const POWER_MONTHLY = 'https://power.larc.nasa.gov/api/temporal/monthly/point';
const POWER_CLIMATOLOGY = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const PPS_BASE = 'https://arthurhouhttps.pps.eosdis.nasa.gov';
const UA = 'ExpandingEdgeAlberta/1.0 (site-design; research)';
const FETCH_MS = 18_000;

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ years?: number }} [opts]
 */
export async function fetchPrecipitation(centre, opts = {}) {
  const lat = centre?.latitude;
  const lng = centre?.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { available: false, error: 'Invalid coordinates' };
  }

  const years = Math.min(Math.max(opts.years ?? 5, 1), 10);
  const endYear = new Date().getFullYear() - 1; // last complete year
  const startYear = endYear - years + 1;

  const [powerMonthly, powerClimo, pps] = await Promise.all([
    fetchPowerMonthly(lat, lng, startYear, endYear).catch((e) => ({
      ok: false,
      error: e.message,
    })),
    fetchPowerClimatology(lat, lng).catch(() => ({ ok: false })),
    probePpsArchive().catch(() => ({ available: false })),
  ]);

  const monthly = powerMonthly?.ok ? powerMonthly.monthly : null;
  const annualSeries = powerMonthly?.ok ? powerMonthly.annual_by_year : null;
  const meanAnnual =
    powerMonthly?.ok && powerMonthly.mean_annual_mm != null
      ? powerMonthly.mean_annual_mm
      : powerClimo?.ok
        ? powerClimo.annual_mm
        : null;

  const available = meanAnnual != null || (monthly && Object.keys(monthly).length);

  return {
    available: !!available,
    mean_annual_mm: meanAnnual != null ? round1(meanAnnual) : null,
    monthly_mm: monthly || powerClimo?.monthly_mm || null,
    annual_by_year: annualSeries || null,
    years: powerMonthly?.ok
      ? { start: startYear, end: endYear }
      : powerClimo?.ok
        ? { start: null, end: null, note: 'climatology' }
        : null,
    source: powerMonthly?.ok
      ? 'NASA POWER PRECTOTCORR (monthly)'
      : powerClimo?.ok
        ? 'NASA POWER PRECTOTCORR (climatology)'
        : 'unavailable',
    source_url: 'https://power.larc.nasa.gov/',
    // GPM PPS research archive (user-requested)
    gpm_pps: {
      archive_url: PPS_BASE + '/',
      open_data_note:
        'NASA GPM Precipitation Processing System (PPS) research archive hosts IMERG and related products. Access uses registered email as username and password.',
      registration_url: 'https://registration.pps.eosdis.nasa.gov/registration/',
      probe: pps || null,
    },
    methodology_note:
      'Annual / monthly precipitation from NASA POWER (bias-corrected PRECTOTCORR) at the parcel centroid. POWER is suitable for planning screening. Full GPM IMERG rasters are available from the PPS archive (arthurhouhttps.pps.eosdis.nasa.gov) for research downloads after free registration.',
    error: available ? null : powerMonthly?.error || 'No precipitation series returned',
  };
}

async function fetchPowerMonthly(lat, lng, startYear, endYear) {
  const url =
    `${POWER_MONTHLY}?parameters=PRECTOTCORR` +
    `&community=AG&longitude=${lng}&latitude=${lat}` +
    `&start=${startYear}&end=${endYear}&format=JSON`;
  const data = await fetchJson(url, FETCH_MS);
  const param = data?.properties?.parameter?.PRECTOTCORR;
  if (!param || typeof param !== 'object') {
    return { ok: false, error: 'POWER monthly PRECTOTCORR missing' };
  }

  // Keys like "202001" … "202012"
  // POWER monthly PRECTOTCORR is average daily rate (mm/day) for that month.
  // Convert to monthly depth (mm) using days-in-month.
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const byYear = new Map();
  const monthDepthSums = Array(12).fill(0);
  const monthCounts = Array(12).fill(0);

  for (const [key, val] of Object.entries(param)) {
    if (val == null || val < -900) continue; // POWER fill
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(4, 6));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) continue;
    const depthMm = Number(val) * daysInMonth(y, m);
    if (!byYear.has(y)) byYear.set(y, 0);
    byYear.set(y, byYear.get(y) + depthMm);
    monthDepthSums[m - 1] += depthMm;
    monthCounts[m - 1] += 1;
  }

  const annuals = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, mm]) => ({ year, mm: round1(mm) }));
  const meanAnnual =
    annuals.length > 0
      ? annuals.reduce((s, a) => s + a.mm, 0) / annuals.length
      : null;

  const monthly = {};
  const labels = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  for (let i = 0; i < 12; i++) {
    if (monthCounts[i] > 0) {
      monthly[labels[i]] = round1(monthDepthSums[i] / monthCounts[i]);
    }
  }

  return {
    ok: true,
    mean_annual_mm: meanAnnual != null ? round1(meanAnnual) : null,
    annual_by_year: annuals,
    monthly,
    unit_note: 'Monthly depths derived from POWER PRECTOTCORR (mm/day × days in month)',
  };
}

async function fetchPowerClimatology(lat, lng) {
  const url =
    `${POWER_CLIMATOLOGY}?parameters=PRECTOTCORR` +
    `&community=AG&longitude=${lng}&latitude=${lat}&format=JSON`;
  const data = await fetchJson(url, FETCH_MS);
  const param = data?.properties?.parameter?.PRECTOTCORR;
  if (!param || typeof param !== 'object') return { ok: false };

  const labels = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const short = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthly = {};
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const v = param[labels[i]];
    if (v != null && v > -900) {
      monthly[short[i]] = round1(Number(v));
      sum += Number(v);
      n++;
    }
  }
  if (!n) return { ok: false };
  // Climatology PRECTOTCORR monthly is typically mm/day; ANN may be mm/day annual mean
  let annual;
  if (param.ANN != null && param.ANN > -900) {
    const ann = Number(param.ANN);
    // If ANN looks like a daily rate (< 20), scale to annual depth
    annual = ann < 20 ? ann * 365 : ann;
  } else {
    // sum of monthly mm/day averages × ~30.4
    annual = sum * 30.44;
  }
  // Scale monthly display to mm/month for chart
  const monthlyDepth = {};
  for (const [k, v] of Object.entries(monthly)) {
    monthlyDepth[k] = round1(Number(v) * 30.44);
  }
  return {
    ok: true,
    annual_mm: round1(annual),
    monthly_mm: monthlyDepth,
  };
}

/**
 * Optional PPS probe — requires GPM_PPS_EMAIL (used as both user & password).
 * Confirms the research archive is reachable for this deployment.
 */
async function probePpsArchive() {
  const email = process.env.GPM_PPS_EMAIL || process.env.PPS_EMAIL;
  const result = {
    archive_url: PPS_BASE + '/',
    requires_registration: true,
    registration_url: 'https://registration.pps.eosdis.nasa.gov/registration/',
    authenticated_probe: false,
  };
  if (!email) {
    result.note =
      'Set GPM_PPS_EMAIL to enable authenticated PPS archive checks. IMERG file download still requires manual/scripted access.';
    return result;
  }
  try {
    const auth =
      'Basic ' + Buffer.from(`${email}:${email}`).toString('base64');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(PPS_BASE + '/gpmdata/', {
      headers: { Authorization: auth, 'User-Agent': UA },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    result.authenticated_probe = res.ok || res.status === 401 || res.status === 403
      ? res.ok
      : false;
    result.http_status = res.status;
    result.note = res.ok
      ? 'PPS archive reachable with registered email credentials.'
      : `PPS responded ${res.status} — register email at PPS if needed.`;
  } catch (e) {
    result.note = `PPS probe failed: ${e.message}`;
  }
  return result;
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}
