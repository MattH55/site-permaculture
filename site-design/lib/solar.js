/**
 * Solar incidence & PV viability from NRCan municipality insolation tables.
 *
 * Source: Photovoltaic Potential and Solar Resource Maps of Canada (NRCan)
 * municip_kWh.csv — mean daily global insolation (kWh/m²) by municipality,
 * month + Annual, six array orientations. Methodology: 1974–1993 ANUSPLIN
 * interpolation — fine for household feasibility, not climate-trend work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALBERTA_PLACES, haversineKm } from './proximity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'data', 'solar', 'municip_kWh.csv');

const COL = {
  province: 0,
  municipality: 1,
  month: 2,
  vertical: 3,
  latitude: 4,
  lat_plus_15: 5,
  lat_minus_15: 6,
  tracking: 7,
  horizontal: 8,
};

/** @type {Map<string, { annual: object, months: object[] }> | null} */
let cache = null;

/**
 * Assess solar resource at a site using nearest NRCan municipality row.
 * @param {{ latitude: number, longitude: number }} centre
 * @param {{ aspect?: string, slope_percent?: number, nearest_name?: string }} [opts]
 */
export function assessSolar(centre, opts = {}) {
  const table = loadSolarTable();
  if (!table.size) {
    return {
      available: false,
      error: 'NRCan municip_kWh.csv not loaded',
      disclaimer: sourceDisclaimer(),
    };
  }

  const match = pickMunicipality(centre, table, opts.nearest_name);
  if (!match) {
    return {
      available: false,
      error: 'No NRCan municipality match near site',
      disclaimer: sourceDisclaimer(),
    };
  }

  const { key, name, province, distance_km, annual, months } = match;
  const latTilt = annual.latitude_tilt_kwh_m2_day;
  const horizontal = annual.horizontal_kwh_m2_day;
  const tracking = annual.tracking_2axis_kwh_m2_day;
  const vertical = annual.vertical_90_kwh_m2_day;

  // Rough fixed-tilt PV yield: daily insolation × 365 × performance ratio.
  // PR ~0.78 accounts for inverter, soiling, wiring, and temperature (cold
  // Alberta winters partially offset snow/soiling losses for planning estimates).
  const PR = 0.78;
  const annual_kwh_per_kwp =
    latTilt != null ? Math.round(latTilt * 365 * PR) : null;
  const annual_kwh_per_kwp_tracking =
    tracking != null ? Math.round(tracking * 365 * PR) : null;

  const viability = viabilityBand(latTilt);
  const aspect_note = aspectGuidance(opts.aspect, opts.slope_percent);

  const monthly = months.map((m) => ({
    month: m.month_label,
    month_index: m.month_index,
    latitude_tilt_kwh_m2_day: m.latitude_tilt_kwh_m2_day,
    horizontal_kwh_m2_day: m.horizontal_kwh_m2_day,
  }));

  return {
    available: true,
    municipality: name,
    province,
    municipality_key: key,
    distance_to_station_municipality_km: distance_km,
    mean_daily_global_insolation_kwh_m2: {
      south_latitude_tilt: latTilt,
      south_latitude_plus_15: annual.lat_plus_15_kwh_m2_day,
      south_latitude_minus_15: annual.lat_minus_15_kwh_m2_day,
      south_vertical_90: vertical,
      horizontal_0: horizontal,
      tracking_2axis: tracking,
    },
    annual_global_insolation_kwh_m2:
      latTilt != null ? Math.round(latTilt * 365 * 10) / 10 : null,
    estimated_pv_yield: {
      fixed_south_latitude_tilt_kwh_per_kwp_year: annual_kwh_per_kwp,
      tracking_2axis_kwh_per_kwp_year: annual_kwh_per_kwp_tracking,
      performance_ratio_assumed: PR,
      note: 'Rough household feasibility estimate only — not a bankable yield study. Site shading, snow, inverter, and azimuth not modelled.',
    },
    // Illustrative planning scenario: 5 kWp fixed south-facing array at typical residential rate
    planning_scenario: (() => {
      const systemSizeKwp = 5;
      const gridRateCadPerKwh = 0.15;
      return {
        system_size_kwp: systemSizeKwp,
        annual_generation_kwh:
          annual_kwh_per_kwp != null ? Math.round(annual_kwh_per_kwp * systemSizeKwp) : null,
        grid_rate_cad_per_kwh: gridRateCadPerKwh,
        annual_grid_savings_cad:
          annual_kwh_per_kwp != null
            ? Math.round(annual_kwh_per_kwp * systemSizeKwp * gridRateCadPerKwh)
            : null,
        note: 'Illustrative 5 kWp fixed south-facing array at $0.15 CAD/kWh; excludes capital cost, financing, export credits, demand charges, and site shading.',
      };
    })(),
    viability: {
      band: viability.band,
      score: viability.score,
      summary: viability.summary,
    },
    monthly_latitude_tilt: monthly,
    site_aspect: opts.aspect || null,
    aspect_guidance: aspect_note,
    source_name:
      'NRCan Photovoltaic Potential & Solar Resource Maps of Canada (municip_kWh)',
    source_url:
      'https://ftp.maps.canada.ca/pub/nrcan_rncan/Solar-energy_Energie-solaire/photovoltaic_canada_photovoltaique/',
    methodology_note:
      'Mean daily global insolation interpolated from 1974–1993 weather stations (ANUSPLIN). Suitable for household feasibility; not for recent climate-trend analysis.',
    disclaimer: sourceDisclaimer(),
  };
}

function sourceDisclaimer() {
  return 'Solar figures are municipality-level NRCan averages, not a parcel-specific irradiance model. Confirm shading, roof/ground orientation, and snow with a site visit or PV design tool (e.g. RETScreen).';
}

function viabilityBand(latTiltDaily) {
  if (latTiltDaily == null) {
    return {
      band: 'unknown',
      score: null,
      summary: 'Insufficient insolation data to rate solar viability.',
    };
  }
  // Alberta residential context (kWh/m²/day, south-facing latitude tilt annual mean)
  if (latTiltDaily >= 4.6) {
    return {
      band: 'excellent',
      score: 5,
      summary: `Strong solar resource (~${latTiltDaily} kWh/m²/day annual mean at latitude tilt). Fixed south arrays are highly viable for Alberta residential / homestead PV.`,
    };
  }
  if (latTiltDaily >= 4.2) {
    return {
      band: 'good',
      score: 4,
      summary: `Good solar resource (~${latTiltDaily} kWh/m²/day). Fixed south latitude-tilt PV is practical; tracking adds optional gain.`,
    };
  }
  if (latTiltDaily >= 3.7) {
    return {
      band: 'fair',
      score: 3,
      summary: `Fair solar resource (~${latTiltDaily} kWh/m²/day). PV still viable with careful orientation and shading control; expect lower winter production.`,
    };
  }
  if (latTiltDaily >= 3.2) {
    return {
      band: 'limited',
      score: 2,
      summary: `Limited solar resource (~${latTiltDaily} kWh/m²/day). Small systems may still pencil for off-grid critical loads; full homestead electrification needs careful design.`,
    };
  }
  return {
    band: 'poor',
    score: 1,
    summary: `Low solar resource (~${latTiltDaily} kWh/m²/day at latitude tilt). Prioritise passive solar design and micro-loads over large PV arrays.`,
  };
}

function aspectGuidance(aspect, slopePercent) {
  const a = String(aspect || '').toUpperCase();
  const slope = Number(slopePercent);
  const steep = Number.isFinite(slope) && slope >= 8;
  if (!a || a === 'FLAT') {
    return 'Parcel aspect is flat or unknown — array azimuth still free; prefer true south (±15°) for fixed mounts.';
  }
  if (a === 'S' || a === 'SE' || a === 'SW') {
    return steep
      ? `Southish aspect (${a}) with measurable slope favours both PV and heat-loving plantings on the same face.`
      : `Southish aspect (${a}) is favourable for fixed PV and sun-demanding Zone 1 beds.`;
  }
  if (a === 'N' || a === 'NE' || a === 'NW') {
    return `Northerly aspect (${a}) reduces ground-mounted array yield and cool-season garden heat — prefer open ridge or roof planes facing south if available.`;
  }
  return `Aspect ${a}: balance wind exposure with solar gain; south of structures and windbreaks is usually preferred for PV and production beds.`;
}

function pickMunicipality(centre, table, preferredName) {
  const lat = centre.latitude;
  const lng = centre.longitude;

  // 1) Preferred nearest-settlement name if present in table
  if (preferredName) {
    const hit = table.get(normalizeKey(preferredName));
    if (hit) {
      return {
        key: normalizeKey(preferredName),
        name: hit.name,
        province: hit.province,
        distance_km: null,
        annual: hit.annual,
        months: hit.months,
      };
    }
  }

  // 2) Nearest ALBERTA_PLACES that has a solar row
  let best = null;
  for (const p of ALBERTA_PLACES) {
    const hit = table.get(normalizeKey(p.name));
    if (!hit) continue;
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (!best || d < best.distance_km) {
      best = {
        key: normalizeKey(p.name),
        name: hit.name,
        province: hit.province,
        distance_km: Math.round(d * 10) / 10,
        annual: hit.annual,
        months: hit.months,
      };
    }
  }
  if (best) return best;

  // 3) Fall back: any Alberta Annual row with name substring match to nearest place
  const nearestPlace = ALBERTA_PLACES.map((p) => ({
    ...p,
    d: haversineKm(lat, lng, p.lat, p.lng),
  })).sort((a, b) => a.d - b.d)[0];

  if (nearestPlace) {
    for (const [key, hit] of table) {
      if (!hit.province.toLowerCase().includes('alberta')) continue;
      if (
        key.includes(normalizeKey(nearestPlace.name)) ||
        normalizeKey(nearestPlace.name).includes(key)
      ) {
        return {
          key,
          name: hit.name,
          province: hit.province,
          distance_km: Math.round(nearestPlace.d * 10) / 10,
          annual: hit.annual,
          months: hit.months,
        };
      }
    }
  }

  // 4) Last resort Edmonton if in northern plains AB
  const edm = table.get('edmonton');
  if (edm) {
    return {
      key: 'edmonton',
      name: edm.name,
      province: edm.province,
      distance_km: Math.round(haversineKm(lat, lng, 53.5461, -113.4938) * 10) / 10,
      annual: edm.annual,
      months: edm.months,
    };
  }
  return null;
}

function loadSolarTable() {
  if (cache) return cache;
  cache = new Map();
  if (!fs.existsSync(CSV_PATH)) return cache;

  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.startsWith(',,,') || line.startsWith('Province,')) continue;
    // Skip French header duplicate
    if (line.startsWith('Province,Municipalit')) continue;

    const parts = splitCsvLine(line);
    if (parts.length < 9) continue;
    const province = parts[COL.province]?.trim() || '';
    const mun = parts[COL.municipality]?.trim() || '';
    const monthRaw = parts[COL.month]?.trim() || '';
    if (!mun || !monthRaw) continue;

    // Prefer Alberta rows; keep all provinces for non-AB edge sites
    const key = normalizeKey(mun);
    if (!cache.has(key)) {
      cache.set(key, {
        name: mun,
        province: province.split('/')[0] || province,
        annual: null,
        months: [],
      });
    }
    const row = cache.get(key);
    const parsed = {
      month_raw: monthRaw,
      month_label: monthLabel(monthRaw),
      month_index: monthIndex(monthRaw),
      vertical_90_kwh_m2_day: num(parts[COL.vertical]),
      latitude_tilt_kwh_m2_day: num(parts[COL.latitude]),
      lat_plus_15_kwh_m2_day: num(parts[COL.lat_plus_15]),
      lat_minus_15_kwh_m2_day: num(parts[COL.lat_minus_15]),
      tracking_2axis_kwh_m2_day: num(parts[COL.tracking]),
      horizontal_kwh_m2_day: num(parts[COL.horizontal]),
    };

    if (/annual/i.test(monthRaw)) {
      row.annual = parsed;
    } else if (parsed.month_index != null) {
      row.months.push(parsed);
    }
  }

  // Keep only entries with annual data; sort months
  for (const [k, v] of [...cache.entries()]) {
    if (!v.annual) {
      cache.delete(k);
      continue;
    }
    v.months.sort((a, b) => (a.month_index ?? 99) - (b.month_index ?? 99));
  }
  return cache;
}

function splitCsvLine(line) {
  // Simple CSV (no quoted commas in this dataset)
  return line.split(',');
}

function normalizeKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function monthLabel(raw) {
  const m = String(raw).split('/')[0].trim();
  return m;
}

function monthIndex(raw) {
  const m = String(raw).split('/')[0].trim().toLowerCase();
  const map = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return map[m] ?? null;
}
