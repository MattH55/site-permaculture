import { loadCanonical } from './store.js';
import { recommendPlants } from './recommend.js';
import { geometryPreview } from './economics.js';
import { taxonIdFromName } from './taxonomy.js';

const scenarios = new Map();

/**
 * First-cut planting simulation: shade neighbors by mature canopy, re-rank.
 * Labeled as a scenario estimate — not a full ray-traced solar re-run.
 */
export function simulatePlanting({ plant, location = {}, quantity = 1, spacing, site = {} } = {}) {
  const db = loadCanonical();
  const id = plant?.taxon_id || taxonIdFromName(plant?.scientific_name || '');
  const rec = (db.plants || []).find((p) => p.taxon?.id === id);
  const geom = rec ? geometryPreview(rec) : { mature: { height_m: 8, width_m: 5, root_zone_m: 4 } };
  const n = Math.max(1, Number(quantity) || 1);
  const canopyM2 = Math.PI * (geom.mature.width_m / 2) ** 2 * n;
  const area = site.area_m2 || location.area_m2 || 400;
  const cover = Math.min(0.65, canopyM2 / Math.max(area, 1));
  const annualReduction = cover * 0.45;
  const afternoonReduction = cover * 0.7;
  const morningReduction = cover * 0.25;

  const shadedSite = {
    ...site,
    annual_solar_kwh_m2: site.annual_solar_kwh_m2 != null ? site.annual_solar_kwh_m2 * (1 - annualReduction) : null,
    light_class: cover > 0.35 ? 'part_sun' : site.light_class,
  };
  const before = recommendPlants(site, { max_results: 8, rank: 'biological' });
  const after = recommendPlants(shadedSite, { max_results: 8, rank: 'biological' });

  return {
    scenario: 'estimate',
    assumption: 'Canopy-cover proxy for shadow — not a full 3D solar re-trace. Neighbor scores shift with reduced solar.',
    placement: {
      taxon_id: id,
      scientific_name: rec?.taxon?.scientific_name || plant?.scientific_name,
      quantity: n,
      spacing_m: spacing || geom.mature.width_m,
      geometry: geom,
    },
    garden_solar_reduction: {
      morning: roundPct(morningReduction),
      afternoon: roundPct(afternoonReduction),
      annual: roundPct(annualReduction),
    },
    affected: diffLists(before.recommendations, after.recommendations),
    recommendations_after: after.recommendations,
  };
}

export function saveScenario(body = {}) {
  const id = body.id || `scen-${Date.now()}`;
  const rec = {
    id,
    name: body.name || id,
    plantings: body.plantings || [],
    site: body.site || {},
    created_at: new Date().toISOString(),
  };
  let totalCost = 0;
  let totalMaint = 0;
  let totalRev = 0;
  const rows = [];
  for (const item of rec.plantings) {
    const sim = simulatePlanting({
      plant: { taxon_id: item.taxon_id, scientific_name: item.scientific_name },
      quantity: item.quantity || 1,
      site: rec.site,
      location: rec.site,
    });
    rows.push(sim);
    const rec0 = sim.recommendations_after?.[0];
    totalCost += (rec0?.commercial?.establishment_cost_cad || 0) * (item.quantity || 1);
    totalMaint += (rec0?.commercial?.maintenance_cost_annual_cad || 0) * (item.quantity || 1);
    totalRev += rec0?.economic?.revenue_annual?.mid || 0;
  }
  rec.totals = {
    capital_cost_cad: Math.round(totalCost),
    annual_maintenance_cad: Math.round(totalMaint),
    projected_revenue_cad: Math.round(totalRev),
    label: 'scenario estimate',
  };
  rec.simulations = rows;
  scenarios.set(id, rec);
  return rec;
}

export function getScenario(id) {
  return scenarios.get(id) || null;
}

function diffLists(before, after) {
  const b = Object.fromEntries((before || []).map((r) => [r.plant?.taxon_id, r.biological?.suitability]));
  const out = [];
  for (const r of after || []) {
    const id = r.plant?.taxon_id;
    if (b[id] == null) continue;
    const d = (r.biological.suitability || 0) - b[id];
    if (Math.abs(d) >= 0.02) {
      out.push({
        taxon_id: id,
        scientific_name: r.plant.scientific_name,
        suitability_delta: Math.round(d * 100) / 100,
      });
    }
  }
  return out;
}

function roundPct(x) {
  return Math.round(x * 1000) / 10;
}
