/**
 * Temperature profile for a site: annual mean, seasonal extremes, frost timing.
 * Pulls from Open-Meteo daily archive (last full year + current partial year).
 * Falls back to Alberta presets when the API is unavailable.
 *
 * Used by pipeline.js to enrich the climate context beyond the existing
 * basic hardiness / frost-free-days preset.
 */

import { ALBERTA_PRESETS } from './alberta-presets.js';

/**
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ elevation_m?: number|null, nearest_name?: string }} opts
 * @returns {Promise<object>} temperature profile payload
 */
export async function assessTemperature(centre, opts = {}) {
  const { latitude: lat, longitude: lng } = centre;
  const today = new Date();
  const lastYear = new Date(today);
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const startDate = lastYear.toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  const url =
    `https://archive-api.open-meteo.com/v1/archive?` +
    `latitude=${lat}&longitude=${lng}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean` +
    `&timezone=America%2FEdmonton`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 22_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
    const data = await res.json();

    if (data.daily) {
      return buildProfile(data.daily, centre, opts);
    }
    throw new Error('No daily data');
  } catch (e) {
    console.warn('Temperature profile fetch failed — using presets', e.message);
    return fallbackProfile(centre);
  }
}

function buildProfile(daily, centre, opts) {
  const maxs = (daily.temperature_2m_max || []).filter((v) => v != null);
  const mins = (daily.temperature_2m_min || []).filter((v) => v != null);
  const means = (daily.temperature_2m_mean || []).filter((v) => v != null);
  const dates = daily.time || [];

  if (!maxs.length || !mins.length) return fallbackProfile(centre);

  const annualMean = means.length
    ? round1(means.reduce((a, b) => a + b, 0) / means.length)
    : round1((maxs.reduce((a, b) => a + b, 0) + mins.reduce((a, b) => a + b, 0)) / (maxs.length + mins.length));

  const annualHigh = Math.max(...maxs);
  const annualLow = Math.min(...mins);

  // Per-month averages
  const monthly = {};
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const m = d.slice(0, 7); // YYYY-MM
    if (!monthly[m]) monthly[m] = { maxs: [], mins: [], means: [] };
    if (maxs[i] != null) monthly[m].maxs.push(maxs[i]);
    if (mins[i] != null) monthly[m].mins.push(mins[i]);
    if (means[i] != null) monthly[m].means.push(means[i]);
  }

  // Compute monthly summaries
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlySummary = monthNames.map((abbr, idx) => {
    const mm = String(idx + 1).padStart(2, '0');
    // Find any year-month entries for this calendar month
    const matching = Object.entries(monthly).filter(([k]) => k.endsWith(`-${mm}`));
    if (!matching.length) return null;

    let allMaxs = [], allMins = [], allMeans = [];
    for (const [, data] of matching) {
      allMaxs.push(...data.maxs);
      allMins.push(...data.mins);
      allMeans.push(...data.means);
    }

    return {
      month: abbr,
      avg_max: allMaxs.length ? round1(mean(allMaxs)) : null,
      avg_min: allMins.length ? round1(mean(allMins)) : null,
      avg_mean: allMeans.length ? round1(mean(allMeans)) : null,
    };
  }).filter(Boolean);

  // Find coldest month avg min (January-ish) and warmest month avg max (July-ish)
  const january = monthlySummary.find((m) => m.month === 'Jan');
  const july = monthlySummary.find((m) => m.month === 'Jul');

  // Frost days: count days where min < 0°C
  const frostDays = mins.filter((v) => v < 0).length;
  const extremeHeatDays = maxs.filter((v) => v >= 30).length;

  // Growing degree days base 5 (simple sum of daily mean above 5)
  let gdd5 = 0;
  for (const v of means) {
    if (v > 5) gdd5 += (v - 5);
  }

  return {
    available: true,
    source_name: 'Open-Meteo daily archive (ERA5 reanalysis)',
    source_url: 'https://open-meteo.com/',
    period: {
      start: dates[0] || null,
      end: dates[dates.length - 1] || null,
      days: maxs.length,
    },
    annual: {
      mean_c: round1(annualMean),
      high_c: round1(annualHigh),
      low_c: round1(annualLow),
    },
    seasonal: {
      coldest_month_avg_low_c: january ? round1(january.avg_min) : null,
      warmest_month_avg_high_c: july ? round1(july.avg_max) : null,
      frost_days_per_year: frostDays,
      extreme_heat_days_per_year: extremeHeatDays,
    },
    monthly: monthlySummary,
    growing_degree_days_base5: Math.round(gdd5),
    methodology_note:
      `Daily ERA5 reanalysis grid cell nearest to (${round2(centre.latitude)}, ${round2(centre.longitude)}). ` +
      'Frost days and GDD computed from the trailing 12-month archive window. ' +
      'This is a planning-level summary, not a 30-year climate normal.',
  };
}

function fallbackProfile(centre) {
  const preset = nearestPreset(centre.latitude, centre.longitude);
  if (preset?.climate) {
    return {
      available: true,
      source_name: 'Expanding Edge Alberta climate presets (30-year normals)',
      source_url: null,
      annual: {
        mean_c: preset.climate.mean_temp_c || null,
        high_c: preset.climate.annual_high_c || null,
        low_c: preset.climate.annual_low_c || null,
      },
      seasonal: {
        coldest_month_avg_low_c: preset.climate.january_low_c || null,
        warmest_month_avg_high_c: preset.climate.july_high_c || null,
      },
      growing_degree_days_base5: preset.climate.growing_degree_days_base5 || null,
      methodology_note: 'Alberta climate preset map lookup. No daily archive available for this request.',
    };
  }
  return {
    available: false,
    error: 'No climate data source available for this location.',
  };
}

function nearestPreset(lat, lng) {
  let best = null;
  let bestD = Infinity;
  for (const p of ALBERTA_PRESETS) {
    if (p.latitude == null || p.longitude == null) continue;
    const d = (p.latitude - lat) ** 2 + (p.longitude - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}