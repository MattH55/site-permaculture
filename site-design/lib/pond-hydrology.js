/**
 * Planning-level pond placement and rainfall capture model.
 *
 * Uses the sampled DEM to find a low, locally convergent location, then
 * estimates runoff captured by three standard pond storage tiers. This is
 * deliberately transparent: it is not a watershed or dam-safety model.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const POND_HYDROLOGY_TIERS = [
  { id: 'small', label: 'Small pond', capacity_m3: 150, target_depth_m: 1.5 },
  { id: 'medium', label: 'Medium pond', capacity_m3: 600, target_depth_m: 2 },
  { id: 'large', label: 'Large pond', capacity_m3: 2000, target_depth_m: 2.5 },
];

/**
 * @param {object} opts
 * @param {number[]} opts.elevations Row-major DEM elevations
 * @param {number} opts.rows
 * @param {number} opts.cols
 * @param {{west:number,south:number,east:number,north:number}} opts.bbox
 * @param {object} opts.precipitation Monthly precipitation in mm
 * @param {number} opts.parcel_area_m2
 * @param {string} [opts.drainage_class]
 */
export function modelPondHydrology(opts = {}) {
  const placement = findOptimalPondLocation(opts);
  const monthlyMm = normalizeMonthly(opts.precipitation);
  const annualMm = monthlyMm
    ? MONTHS.reduce((sum, month) => sum + (monthlyMm[month] || 0), 0)
    : 0;
  const parcelAreaM2 = Math.max(Number(opts.parcel_area_m2) || 10_000, 1);
  const runoffCoefficient = runoffCoeff(opts.drainage_class);
  const catchment = placement.catchment_area_m2 || Math.min(parcelAreaM2 * 0.15, parcelAreaM2);
  const eventsPerMonth = 3;

  const tiers = POND_HYDROLOGY_TIERS.map((tier) => {
    const capacityL = tier.capacity_m3 * 1000;
    const eventRows = {};
    const monthlyRows = {};
    let annualCapturedL = 0;
    let annualGrossL = 0;

    for (const month of MONTHS) {
      const precipMm = monthlyMm?.[month] || 0;
      const eventMm = precipMm / eventsPerMonth;
      const grossEventL = catchment * (eventMm / 1000) * 1000 * runoffCoefficient;
      const capturedEventL = Math.min(grossEventL, capacityL);
      const grossMonthL = grossEventL * eventsPerMonth;
      const capturedMonthL = capturedEventL * eventsPerMonth;
      eventRows[month] = {
        precipitation_mm: round1(eventMm),
        gross_runoff_litres: round0(grossEventL),
        captured_litres: round0(capturedEventL),
      };
      monthlyRows[month] = {
        precipitation_mm: round1(precipMm),
        rain_events: eventsPerMonth,
        gross_runoff_litres: round0(grossMonthL),
        captured_litres: round0(capturedMonthL),
      };
      annualGrossL += grossMonthL;
      annualCapturedL += capturedMonthL;
    }

    return {
      ...tier,
      capacity_litres: capacityL,
      surface_area_m2: round1(tier.capacity_m3 / tier.target_depth_m),
      catchment_area_m2: round0(catchment),
      runoff_coefficient: runoffCoefficient,
      annual_gross_runoff_litres: round0(annualGrossL),
      annual_captured_litres: round0(annualCapturedL),
      monthly: monthlyRows,
      per_rain_event: eventRows,
    };
  });

  return {
    available: !!placement.available && !!monthlyMm,
    placement,
    tiers,
    annual_precipitation_mm: round1(annualMm),
    events_per_month: eventsPerMonth,
    runoff_coefficient: runoffCoefficient,
    source: 'Sampled DEM low-point/convergence screen × NASA POWER monthly precipitation × runoff coefficient',
    assumptions: [
      'Three representative rain events per month; monthly precipitation is divided evenly between events.',
      'Captured water is capped at the pond tier capacity for each event; evaporation, seepage, snowmelt timing, and outlet losses are not modelled.',
      'Placement is a DEM screening result. Verify soils, drainage area, inflow, spillway, setbacks, wetland status, and Alberta Water Act requirements before excavation.',
    ],
  };
}

function findOptimalPondLocation(opts) {
  const { elevations, rows, cols, bbox } = opts;
  if (!Array.isArray(elevations) || !rows || !cols || elevations.length < rows * cols || !bbox) {
    return { available: false, reason: 'No complete DEM grid and bounding box were supplied.' };
  }
  const valid = elevations.filter((v) => Number.isFinite(v));
  if (valid.length < 9) return { available: false, reason: 'Too few valid DEM cells for pond placement.' };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const candidates = [];
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const elevation = elevations[r * cols + c];
      if (!Number.isFinite(elevation)) continue;
      const neighbours = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr || dc) neighbours.push(elevations[(r + dr) * cols + c + dc]);
        }
      }
      const validNeighbours = neighbours.filter((v) => Number.isFinite(v));
      if (validNeighbours.length < 5) continue;
      const lowerNeighbours = validNeighbours.filter((v) => v < elevation - 0.05).length;
      const higherNeighbours = validNeighbours.filter((v) => v > elevation + 0.05).length;
      const reliefNorm = max > min ? (max - elevation) / (max - min) : 0.5;
      const convergence = higherNeighbours / validNeighbours.length;
      const depression = lowerNeighbours === 0 ? 1 : 0;
      const score = 0.55 * reliefNorm + 0.35 * convergence + 0.10 * depression;
      candidates.push({ r, c, elevation, score, convergence });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { available: false, reason: 'No usable interior DEM cells were found.' };
  const lat = bbox.north - (best.r / (rows - 1)) * (bbox.north - bbox.south);
  const lng = bbox.west + (best.c / (cols - 1)) * (bbox.east - bbox.west);
  const parcelAreaM2 = Math.max(Number(opts.parcel_area_m2) || 10_000, 1);
  const catchmentFraction = clamp(0.10 + best.convergence * 0.25 + (best.score * 0.10), 0.10, 0.45);
  return {
    available: true,
    method: 'Lowest/convergent interior DEM cell screen',
    latitude: round6(lat),
    longitude: round6(lng),
    elevation_m: round1(best.elevation),
    score: round3(best.score),
    convergence_score: round3(best.convergence),
    catchment_fraction_of_parcel: round3(catchmentFraction),
    catchment_area_m2: round0(parcelAreaM2 * catchmentFraction),
    candidate_count: candidates.length,
    confidence: candidates.length >= 25 ? 'moderate' : 'low',
  };
}

function normalizeMonthly(precipitation) {
  const source = precipitation?.monthly_mm || precipitation?.monthly;
  if (source && typeof source === 'object') {
    const out = {};
    for (const month of MONTHS) out[month] = Math.max(0, Number(source[month] || 0));
    return out;
  }
  const annual = Number(precipitation?.mean_annual_mm || precipitation?.annual_precipitation_mm || 0);
  if (!annual) return null;
  const fractions = [0.04, 0.03, 0.05, 0.07, 0.11, 0.17, 0.16, 0.14, 0.10, 0.06, 0.04, 0.03];
  return Object.fromEntries(MONTHS.map((month, i) => [month, annual * fractions[i]]));
}

function runoffCoeff(drainageClass) {
  return { rapid: 0.15, well: 0.25, moderately_well: 0.30, imperfect: 0.38, poor: 0.45, very_poor: 0.50 }[drainageClass] || 0.28;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round0(value) { return Math.round(value); }
function round1(value) { return Math.round(value * 10) / 10; }
function round3(value) { return Math.round(value * 1000) / 1000; }
function round6(value) { return Math.round(value * 1e6) / 1e6; }