/**
 * Plant ↔ planting-zone matching — "where on MY land does each plant grow
 * best?" rather than one parcel-wide plant list.
 *
 * Before this module every planting zone was handed the same parcel-wide
 * top-5 list (enrichPlantingZones reused planting_plan.recommended), so a
 * shaded frost hollow and a sunny south slope got identical advice. Here each
 * recommended plant is scored against each zone's own measured conditions:
 *
 *   sun        growing-season direct-sun hours from the shade model (terrain
 *              horizon + trees with leaf-off + building shadows) vs the
 *              plant's light requirement
 *   frost      frost-pocket risk vs the plant's frost-free-days need and
 *              Chinook/early-bloom sensitivity
 *   drainage   zone drainage class vs the drainage classes the plant tolerates
 *   water      wet-loving plants near water / on poorly drained ground;
 *              drought plants kept off waterlogged soil
 *   pH, texture, slope
 *
 * Pure function, no I/O — every score carries its reasons and limits, so the
 * report can say WHY a plant belongs in a zone.
 */

const DRAINAGE_ORDER = ['very_poor', 'poor', 'imperfect', 'moderately_well', 'well', 'rapid'];

/**
 * Minimum daily growing-season direct sun a plant needs, from its light
 * requirement (Permapeople/USDA vocabulary), falling back to USDA shade
 * tolerance. Thresholds follow common horticultural definitions: full sun
 * ≥6 h, part sun/shade 3–6 h, full shade <3 h.
 *
 * @returns {{min_hours:number, prefers_shade:boolean, label:string, basis:string}}
 */
export function sunNeed(plant) {
  const raw = String(plant?.light_requirement ?? plant?.plant_specs?.light_requirement ?? '').toLowerCase();
  const hasFull = raw.includes('full sun') || raw === 'high';
  const hasPart = raw.includes('partial');
  const hasShade = raw.includes('full shade');
  if (raw) {
    if (hasShade && !hasFull) return { min_hours: 2, prefers_shade: true, label: 'shade to part shade', basis: 'light_requirement' };
    if (hasFull && hasShade) return { min_hours: 2, prefers_shade: false, label: 'sun to shade', basis: 'light_requirement' };
    if (hasFull && hasPart) return { min_hours: 4, prefers_shade: false, label: 'full to part sun', basis: 'light_requirement' };
    if (hasFull) return { min_hours: 6, prefers_shade: false, label: 'full sun', basis: 'light_requirement' };
    if (hasPart) return { min_hours: 3, prefers_shade: false, label: 'part sun/shade', basis: 'light_requirement' };
  }
  const tol = String(plant?.shade_tolerance ?? plant?.plant_specs?.shade_tolerance ?? '').toLowerCase();
  if (tol === 'high') return { min_hours: 3, prefers_shade: false, label: 'shade tolerant', basis: 'shade_tolerance' };
  if (tol === 'medium') return { min_hours: 4, prefers_shade: false, label: 'part sun', basis: 'shade_tolerance' };
  if (tol === 'low') return { min_hours: 6, prefers_shade: false, label: 'full sun', basis: 'shade_tolerance' };
  return { min_hours: 5, prefers_shade: false, label: 'unknown (assumed mostly sun)', basis: 'default' };
}

function field(plant, key) {
  return plant?.[key] ?? plant?.plant_specs?.[key] ?? null;
}

/**
 * Score one plant in one zone. 100 = every measured condition fits.
 *
 * @param {object} plant planting_plan.recommended item (catalog crop + plant_specs)
 * @param {object} zone  enriched planting zone (site_condition_profile, frost_risk_level, …)
 * @returns {{score:number, band:string, reasons:string[], limits:string[], unknowns:string[]}}
 */
export function scorePlantInZone(plant, zone) {
  const scp = zone?.site_condition_profile || {};
  const reasons = [];
  const limits = [];
  const unknowns = [];
  let score = 100;

  // --- Sun ---------------------------------------------------------------
  const need = sunNeed(plant);
  const sun = Number.isFinite(scp.growing_season_sun_hours) ? scp.growing_season_sun_hours : null;
  if (sun == null) {
    unknowns.push('sun hours (no shade model for this zone)');
  } else {
    const deficit = need.min_hours - sun;
    if (deficit > 0) {
      score -= Math.min(45, deficit * 12);
      limits.push(`${sun.toFixed(1)} h growing-season sun, needs ~${need.min_hours}+ h (${need.label})`);
    } else {
      reasons.push(`${sun.toFixed(1)} h sun meets ${need.label} need`);
    }
    if (need.prefers_shade && sun > 8) {
      score -= 12;
      limits.push('woodland/shade plant in an open, sun-baked zone — expect leaf scorch');
    }
  }

  // --- Frost pocket --------------------------------------------------------
  const frost = zone?.frost_risk_level || (scp.frost_pocket ? 'moderate' : 'low');
  const ffd = Number(field(plant, 'frost_free_min_days'));
  const tender = (Number.isFinite(ffd) && ffd >= 120) || plant?.chinook_sensitive === true;
  if (frost === 'high' || frost === 'moderate') {
    const hit = tender ? (frost === 'high' ? 25 : 12) : (frost === 'high' ? 6 : 2);
    score -= hit;
    (tender ? limits : reasons).push(tender
      ? `${frost} frost-pocket risk for a frost-tender plant${Number.isFinite(ffd) ? ` (needs ${ffd} frost-free days)` : ''}`
      : `${frost} frost-pocket risk, but hardy enough`);
  }

  // --- Drainage --------------------------------------------------------------
  const zoneDrain = normalizeDrainage(scp.soil?.drainage);
  const plantDrain = (field(plant, 'drainage') || []).map(normalizeDrainage).filter(Boolean);
  if (zoneDrain && plantDrain.length) {
    if (plantDrain.includes(zoneDrain)) {
      reasons.push(`tolerates ${zoneDrain.replace('_', ' ')} drainage`);
    } else {
      const gap = nearestDrainageGap(zoneDrain, plantDrain);
      score -= Math.min(30, gap * 12);
      limits.push(`zone is ${zoneDrain.replace('_', ' ')} drained; prefers ${plantDrain.map((d) => d.replace('_', ' ')).join('/')}`);
    }
  } else if (!zoneDrain) {
    unknowns.push('drainage class');
  }

  // --- Water regime -----------------------------------------------------------
  const water = String(field(plant, 'water_requirement') || '').toLowerCase();
  const nearWater = Number.isFinite(scp.distance_to_water_m) && scp.distance_to_water_m < 60;
  const wetGround = zoneDrain && DRAINAGE_ORDER.indexOf(zoneDrain) <= DRAINAGE_ORDER.indexOf('imperfect');
  if (water === 'wet') {
    if (nearWater || wetGround) { score += 5; reasons.push('moisture-loving plant on wet ground / near water'); }
    else { score -= 15; limits.push('needs wet soil — zone is dry and away from water (irrigate or skip)'); }
  } else if ((water === 'dry' || water === 'dry to moist') && wetGround) {
    score -= 10;
    limits.push('drought-adapted plant on poorly drained ground — root rot risk');
  }

  // --- pH -------------------------------------------------------------------
  const ph = Number(scp.soil?.ph);
  const phMin = Number(field(plant, 'ph_min'));
  const phMax = Number(field(plant, 'ph_max'));
  if (Number.isFinite(ph) && (Number.isFinite(phMin) || Number.isFinite(phMax))) {
    if (Number.isFinite(phMin) && ph < phMin - 0.3) { score -= 15; limits.push(`soil pH ${ph} below its ${phMin} minimum`); }
    else if (Number.isFinite(phMax) && ph > phMax + 0.3) { score -= 15; limits.push(`soil pH ${ph} above its ${phMax} maximum`); }
    else reasons.push(`soil pH ${ph} in range`);
  } else if (!Number.isFinite(ph)) {
    unknowns.push('soil pH');
  }

  // --- Texture ----------------------------------------------------------------
  const tex = scp.soil?.texture;
  const plantTex = field(plant, 'textures');
  if (tex && Array.isArray(plantTex) && plantTex.length && !plantTex.includes(tex)) {
    score -= 8;
    limits.push(`${String(tex).replace(/_/g, ' ')} soil not among its preferred textures`);
  }

  // --- Slope --------------------------------------------------------------------
  const slope = Number(scp.slope_pct);
  const layer = String(plant?.guild_layer || field(plant, 'guild_layer') || '');
  if (Number.isFinite(slope) && slope > 15 && (layer === 'herbaceous' || layer === 'groundcover')) {
    score -= 10;
    limits.push(`${Math.round(slope)}% slope — annual/herbaceous beds need terracing`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: band(score), reasons, limits, unknowns };
}

function band(score) {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'fair';
  return 'poor';
}

function normalizeDrainage(d) {
  if (!d) return null;
  const s = String(d).toLowerCase().replace(/[\s-]+/g, '_');
  if (s.includes('very_poor')) return 'very_poor';
  if (s.includes('poor')) return 'poor';
  if (s.includes('imperfect') || s.includes('somewhat_poor')) return 'imperfect';
  if (s.includes('moderately')) return 'moderately_well';
  if (s.includes('rapid') || s.includes('excessive')) return 'rapid';
  if (s.includes('well')) return 'well';
  return null;
}

function nearestDrainageGap(zoneDrain, plantDrain) {
  const zi = DRAINAGE_ORDER.indexOf(zoneDrain);
  return Math.min(...plantDrain.map((d) => Math.abs(DRAINAGE_ORDER.indexOf(d) - zi)));
}

/**
 * Score every plant in every zone.
 *
 * @param {object[]} zones enriched planting zones (enrichPlantingZones output, before
 *   recommended_plantings is filled)
 * @param {object[]} plants planting_plan.recommended
 * @param {{perZone?:number}} [opts]
 * @returns {{zones: Array<{zone_index:number, best_plants:object[]}>, plants: object[], methodology:string}}
 */
export function matchPlantsToZones(zones, plants, opts = {}) {
  const perZone = opts.perZone ?? 5;
  const zs = Array.isArray(zones) ? zones : [];
  const ps = (Array.isArray(plants) ? plants : []).filter((p) => p && (p.id || p.common_name));

  const grid = ps.map((p) => zs.map((z) => scorePlantInZone(p, z)));

  const zoneResults = zs.map((z, zi) => {
    const ranked = ps
      .map((p, pi) => ({ plant: p, fit: grid[pi][zi] }))
      .sort((a, b) => b.fit.score - a.fit.score || (b.plant.score ?? 0) - (a.plant.score ?? 0));
    return {
      zone_index: zi,
      best_plants: ranked.slice(0, perZone).map(({ plant, fit }) => ({
        id: plant.id || null,
        species_or_guild: plant.common_name || plant.name || plant.id,
        latin: plant.scientific_name || plant.latin_name || null,
        guild_layer: plant.guild_layer || null,
        sun_need: sunNeed(plant).label,
        zone_fit_score: fit.score,
        zone_fit_band: fit.band,
        parcel_score: plant.score ?? null,
        reasons: fit.reasons,
        limits: fit.limits,
      })),
    };
  });

  const plantResults = ps.map((p, pi) => {
    const fits = zs.map((z, zi) => ({ zone_index: zi, area_m2: Number(z.area_m2) || 0, ...grid[pi][zi] }))
      .sort((a, b) => b.score - a.score);
    const suitable = fits.filter((f) => f.score >= 65);
    const best = fits[0] || null;
    return {
      id: p.id || null,
      common_name: p.common_name || p.name || p.id,
      guild_layer: p.guild_layer || null,
      sun_need: sunNeed(p).label,
      parcel_score: p.score ?? null,
      best_zone_index: best ? best.zone_index : null,
      best_zone_score: best ? best.score : null,
      best_zone_band: best ? best.band : null,
      best_zone_limits: best ? best.limits : [],
      // Conditions that could not be checked for the best zone (missing
      // data) — a high fit with unknowns is "nothing ruled it out", not
      // "everything confirmed".
      best_zone_unknowns: best ? best.unknowns : [],
      suitable_zone_count: suitable.length,
      suitable_area_m2: Math.round(suitable.reduce((s, f) => s + f.area_m2, 0)),
      top_zones: fits.slice(0, 3).map((f) => ({ zone_index: f.zone_index, score: f.score, band: f.band })),
      // Compact per-zone scores aligned with zone index — lets the 3D viewer
      // recolour every planting zone by this plant's fit.
      zone_scores: grid[pi].map((g) => g.score),
    };
  }).sort((a, b) => (b.suitable_area_m2 - a.suitable_area_m2) || ((b.best_zone_score ?? 0) - (a.best_zone_score ?? 0)));

  return {
    zones: zoneResults,
    plants: plantResults,
    methodology: 'Each recommended plant is scored 0–100 against each planting zone\'s own measured conditions: growing-season sun hours from the shade model (terrain horizon, trees with deciduous leaf-off, building shadows) vs light requirement (full sun ≥6 h, part 3–6 h, shade <3 h); frost-pocket risk vs frost-free-day need; drainage, water regime, pH, texture, and slope. "Suitable" = good or excellent (≥65).',
  };
}
