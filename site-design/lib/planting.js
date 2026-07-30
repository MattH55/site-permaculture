/**
 * Plant Recommendation + Economics Engine
 *
 * Architecture:
 *   Site AOI + Fecundity → Site Condition Profile → hard filters + soft scoring
 *   → ranked plants/guilds → economics overlay (cost, yield, payback, NPV)
 *
 * Catalog load order:
 *  1. GROWING_GUIDE_CROPS_PATH (JSON export from farmfit)
 *  2. data/crops/farmfit-export.json
 *  3. data/crops/alberta-catalog.json (default)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSuppliers } from './vendors.js';
import { applyPlantSpecs, loadPlantSpecsCache } from './plant-specs.js';
import {
  enrichPlantValues,
  groupPlantsByValue,
} from './plant-values.js';
import { recommendationPriority } from './recommendation-values.js';
import {
  buildSiteConditionProfile,
  normalizeZone,
  zoneIndex,
  ZONE_ORDER,
} from './site-condition-profile.js';
import {
  attachPlantEconomics,
  summarizePlanEconomics,
} from './plant-economics.js';
import {
  PLANT_GOALS,
  normalizePlantGoals,
  goalScoreBonus,
  compareByGoals,
  goalsLabel,
  getPlantGoalsPayload,
} from './plant-goals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let catalogCache = null;
let catalogSourceLabel = 'alberta-catalog.json';
let economicsCache = null;

/**
 * @param {object} site — buildSiteRecord-like fields + climate/soil/terrain
 * @param {{
 *   limit?: number,
 *   goals?: string[],
 *   scenario?: string,
 *   fecundity?: object,
 *   hardiness?: object,
 *   soil_survey?: object,
 *   satellite?: object,
 *   wetlands?: object,
 *   wind_rose?: object,
 *   tree_cover?: object,
 *   profile?: object,
 * }} opts
 */
export function planPlantings(site = {}, opts = {}) {
  const limit = opts.limit ?? 18;
  const scenario = opts.scenario || 'market_garden';
  const crops = loadCatalog();
  const economics = loadEconomics();

  // Explicit goals win; otherwise profile may derive from weak levers
  const explicitGoals =
    opts.goals != null ? normalizePlantGoals(opts.goals) : null;

  const profile =
    opts.profile && !explicitGoals
      ? opts.profile
      : buildSiteConditionProfile(site, {
          fecundity: opts.fecundity,
          hardiness: opts.hardiness,
          soil_survey: opts.soil_survey,
          satellite: opts.satellite,
          wetlands: opts.wetlands,
          small_water: opts.small_water,
          wind_rose: opts.wind_rose,
          tree_cover: opts.tree_cover,
          goals: explicitGoals || opts.goals,
          landCoverClass: opts.landCoverClass,
          windExposureHint: opts.windExposureHint,
          frostPoolingHint: opts.frostPoolingHint,
        });

  // If profile was reused but user passed new goals, override
  if (explicitGoals?.length) {
    profile.goals = explicitGoals;
  }

  const activeGoals = profile.goals || ['balanced'];
  const areaHa = profile.footprint_ha || Math.max(num(site.footprint_ha) || 0.1, 0.01);
  const ctx = profileToLegacyCtx(profile);

  const scored = crops
    .map((crop) => {
      const row = scoreCrop(crop, ctx, profile);
      if (row.hard_filter_pass === false && row.score <= 0) return row;
      row.economics = attachPlantEconomics(
        crop.id,
        economics,
        areaHa,
        row.score,
        crop._inline_economics,
        {
          guild_layer: crop.guild_layer || row.guild_layer,
          category: crop.category,
          scenario,
          horizon_years: opts.horizon_years || 10,
        }
      );
      row.suppliers = resolveSuppliers(crop);
      const values = enrichPlantValues(row);
      Object.assign(row, values);
      // Goal-weighted bonus after primary_value is known
      const signals = plantSignals(row);
      const gBonus = goalScoreBonus(row, signals, activeGoals, row.economics);
      if (gBonus) {
        row.score = Math.max(0, Math.min(100, Math.round(row.score + gBonus)));
        row.goal_bonus = gBonus;
        row.suitability =
          row.score >= 80
            ? 'excellent'
            : row.score >= 65
              ? 'good'
              : row.score >= 50
                ? 'fair'
                : row.score >= 35
                  ? 'marginal'
                  : 'poor';
      }
      row.priority = recommendationPriority(row);
      row.lever_benefits = row.lever_benefits || [];
      row.fit_summary = buildFitSummary(row, profile);
      row.active_goals = activeGoals;
      return row;
    })
    .filter((r) => r.score > 0 && r.hard_filter_pass !== false)
    .sort((a, b) => compareByGoals(a, b, activeGoals));

  const top = scored.slice(0, limit);
  const byLayer = groupBy(top, (r) => r.guild_layer || 'other');
  const byCategory = groupBy(top, (r) => r.category || 'other');
  const plantValues = groupPlantsByValue(top);
  const guilds = suggestGuilds(top, profile);
  const planEconomics = summarizePlanEconomics(top, {
    horizon_years: opts.horizon_years || 10,
  });

  const cash = top
    .filter((r) => r.economics?.gross_revenue_cad?.mid != null && r.economics.gross_revenue_cad.mid > 0)
    .slice()
    .sort(
      (a, b) =>
        (b.economics.gross_revenue_cad.mid || 0) - (a.economics.gross_revenue_cad.mid || 0)
    );

  const succession = profile.vegetation?.successional_stage;
  let phase_note =
    'Plant Matching Engine: hardiness hard filter, then soft scores for soil, water, wind, succession, and weak fecundity levers.';
  if (succession === 'pioneer' || succession === 'early_successional') {
    phase_note +=
      ' Early succession: prioritize cover crops, N-fixers, and pioneer shrubs before full canopy food forest.';
  } else if (succession === 'mid_successional' || succession === 'climax') {
    phase_note += ' Succession allows layered food-forest guilds filtered by hardiness.';
  }
  if (profile.microclimate?.chinook_exposure) {
    phase_note +=
      ' Chinook exposure: deprioritize early-flowering woody species even if hardiness matches.';
  }
  if (profile.fecundity?.weakest?.length) {
    const w = profile.fecundity.weakest
      .slice(0, 3)
      .map((x) => x.label || x.category)
      .join(', ');
    phase_note += ` Weakest levers (${w}) boost plants that improve those systems.`;
  }
  phase_note +=
    ' Economics: establishment cost, yield trajectory, payback, and simple NPV — planning ranges only, not a business plan.';
  phase_note += ` Active goals: ${goalsLabel(activeGoals)}.`;

  return {
    engine: 'ee-plant-recommendation-economics-v2',
    beta: true,
    goals: activeGoals,
    goals_label: goalsLabel(activeGoals),
    available_goals: PLANT_GOALS,
    schema: 'https://opensourcemed.info/schemas/permaculture-crop.schema.json',
    growing_guide: {
      project: 'OpenSourceMed Growing Guide / farmfit',
      catalog_source: catalogCache?._source || 'alberta-catalog.json',
      economics_source: economics?._source || 'economics.json',
      notes:
        'Site Condition Profile → hard filters + soft scoring → economics overlay. Suppliers via crop.schema + vendors.json.',
    },
    site_condition_profile: profile,
    site_filters: {
      plant_hardiness_zone: profile.hardiness.zone,
      effective_hardiness_zone: profile.hardiness.effective_zone,
      frost_free_days: profile.hardiness.frost_free_days,
      annual_precipitation_mm: profile.water.annual_precip_mm,
      texture: profile.soil.texture,
      drainage_class: profile.soil.drainage,
      water_regime: profile.water.regime,
      chinook_exposure: profile.microclimate.chinook_exposure,
      successional_stage: succession || null,
      wind_exposure: profile.microclimate.wind_exposure,
      goals: activeGoals,
      goals_label: goalsLabel(activeGoals),
      footprint_ha: areaHa,
      scenario,
    },
    phase_note,
    economics_disclaimer:
      economics?.disclaimer ||
      'Indicative CAD price, cost, payback, and NPV ranges for planning only. Confirm markets before planting at scale.',
    recommended: top,
    suggested_guilds: guilds,
    plan_economics: planEconomics,
    top_cash_crops: cash.slice(0, 6).map((r) => ({
      id: r.id,
      common_name: r.common_name,
      score: r.score,
      suitability: r.suitability,
      economics: r.economics,
      primary_value: r.primary_value,
      secondary_values: r.secondary_values,
      lever_benefits: r.lever_benefits,
    })),
    by_guild_layer: byLayer,
    by_category: byCategory,
    by_value: plantValues.by_value,
    value_counts: plantValues.value_counts,
    totals: {
      catalog_size: crops.length,
      scored_positive: scored.length,
      hard_filtered_out: crops.length - scored.length,
      returned: top.length,
      with_economics: top.filter((r) => r.economics).length,
      with_cash_model: top.filter((r) => r.economics?.gross_revenue_cad?.mid).length,
    },
  };
}

function profileToLegacyCtx(profile) {
  return {
    zone: profile.hardiness?.effective_zone || profile.hardiness?.zone || '3a',
    zone_base: profile.hardiness?.zone || '3a',
    ffd: profile.hardiness?.frost_free_days ?? 120,
    precip: profile.water?.annual_precip_mm ?? 450,
    ph: profile.soil?.ph,
    texture: profile.soil?.texture || 'loam',
    drainage: profile.soil?.drainage || 'well',
    chinook: profile.microclimate?.chinook_exposure === true,
    water_regime: profile.water?.regime || 'mesic',
    wind_exposure: profile.microclimate?.wind_exposure || 'partial',
    succession: profile.vegetation?.successional_stage || 'early_successional',
    missing_layers: profile.vegetation?.missing_layers || [],
    goals: profile.goals || [],
    weakest: profile.fecundity?.weakest || [],
    lever_scores: profile.fecundity?.lever_scores || {},
    wetland_on_site: !!profile.water?.wetland_on_site,
    small_water_confirmed: !!profile.water?.small_water?.has_confirmed,
    small_water_possible: !!profile.water?.small_water?.has_possible,
    small_water_nearest_m: profile.water?.small_water?.nearest_m ?? null,
    small_water_density: profile.water?.small_water?.density_score ?? null,
  };
}

function buildFitSummary(row, profile) {
  const bits = [];
  bits.push(`Fit ${row.score}/100 (${row.suitability})`);
  if (row.lever_benefits?.length) {
    bits.push(`Helps: ${row.lever_benefits.slice(0, 3).join(', ')}`);
  }
  if (row.economics?.payback_years != null) {
    bits.push(`~${row.economics.payback_years} yr payback`);
  } else if (row.economics?.establishment_cost_cad?.total) {
    bits.push(`Est. ~$${row.economics.establishment_cost_cad.total}`);
  }
  if (profile.hardiness?.effective_zone) {
    bits.push(`Zone ${profile.hardiness.effective_zone}`);
  }
  return bits.join(' · ');
}

/**
 * Suggest polyculture guilds from ranked plants + site needs.
 */
function suggestGuilds(plants, profile) {
  const guilds = [];

  // Shelterbelt mix when wind is open or microclimate weak
  const windWeak =
    profile.microclimate?.wind_exposure === 'open' ||
    (profile.fecundity?.lever_scores?.microclimate != null &&
      profile.fecundity.lever_scores.microclimate < 55);
  if (windWeak) {
    const members = plants
      .filter(
        (p) =>
          p.primary_value === 'wind_protection' ||
          /caragana|sea.?buckthorn|buffalo|willow|spruce|poplar|ash/i.test(p.common_name || '')
      )
      .slice(0, 5);
    if (members.length >= 2) {
      guilds.push({
        id: 'shelterbelt_mix',
        label: 'Shelterbelt mix',
        rationale:
          'Open or wind-exposed site — multi-row belt with pioneer shrubs + longer-lived trees for wind, snow, and microclimate.',
        lever_targets: ['microclimate', 'water'],
        members: members.map(guildMember),
      });
    }
  }

  // Food forest understory
  const food = plants.filter((p) => p.primary_value === 'food_production').slice(0, 4);
  const nfix = plants.filter((p) => p.primary_value === 'nitrogen_fixing' || p.nitrogen_fixer).slice(0, 2);
  if (food.length >= 2) {
    guilds.push({
      id: 'food_forest_understory',
      label: 'Food forest understory guild',
      rationale:
        'Layered edible shrubs/trees with nitrogen support — matches vegetative structure and food goals.',
      lever_targets: ['vegetativeStructure', 'nutrientCycling', 'faunaIntegration'],
      members: [...food, ...nfix].slice(0, 6).map(guildMember),
    });
  }

  // Wetland buffer
  if (
    profile.water?.wetland_on_site ||
    profile.water?.regime === 'wet' ||
    profile.water?.regime === 'mesic_wet' ||
    profile.water?.small_water?.has_confirmed ||
    profile.water?.small_water?.has_possible
  ) {
    const wetPlants = plants
      .filter((p) => isMoistureLovingPlant(p))
      .slice(0, 5);
    if (wetPlants.length) {
      const possibleOnly =
        profile.water?.small_water?.has_possible &&
        !profile.water?.small_water?.has_confirmed &&
        !profile.water?.wetland_on_site;
      guilds.push({
        id: 'wetland_buffer',
        label: possibleOnly ? 'Moisture-edge guild (verify seeps)' : 'Wetland / water-edge buffer',
        rationale: possibleOnly
          ? 'Possible small water or seeps nearby (low-medium confidence) — moisture-loving edge plantings; confirm water on site walk before design commitments.'
          : 'Confirmed or mapped water nearby — edge plantings stabilize banks, filter runoff, and add wildlife structure (not a regulatory delineation).',
        lever_targets: ['water', 'faunaIntegration', 'microclimate'],
        members: wetPlants.map(guildMember),
      });
    }
  }

  // Soil / N-fix starter when nutrients weak
  const nutWeak =
    (profile.fecundity?.lever_scores?.nutrientCycling != null &&
      profile.fecundity.lever_scores.nutrientCycling < 55) ||
    (profile.fecundity?.lever_scores?.soilBiology != null &&
      profile.fecundity.lever_scores.soilBiology < 55);
  if (nutWeak) {
    const soilers = plants
      .filter(
        (p) =>
          p.primary_value === 'nitrogen_fixing' ||
          p.primary_value === 'soil_building' ||
          p.nitrogen_fixer ||
          p.category === 'cover_crop'
      )
      .slice(0, 5);
    if (soilers.length) {
      guilds.push({
        id: 'soil_builder_starter',
        label: 'Soil-builder / N-fix starter',
        rationale:
          'Nutrient or biology levers are weak — start with N-fixers and soil-building cover before heavy-feeding canopy crops.',
        lever_targets: ['nutrientCycling', 'soilBiology', 'soilStructure'],
        members: soilers.map(guildMember),
      });
    }
  }

  // Fallback polyculture if nothing else
  if (!guilds.length && plants.length >= 3) {
    guilds.push({
      id: 'mixed_polyculture',
      label: 'Mixed polyculture starter',
      rationale: 'Diverse multi-function set from top site fits.',
      lever_targets: profile.fecundity?.weakest?.map((w) => w.category) || [],
      members: plants.slice(0, 5).map(guildMember),
    });
  }

  return guilds;
}

function guildMember(p) {
  return {
    id: p.id,
    common_name: p.common_name,
    score: p.score,
    guild_layer: p.guild_layer,
    primary_value: p.primary_value,
    suggested_quantity: p.economics?.suggested_quantity ?? null,
  };
}

function loadEconomics() {
  if (economicsCache) return economicsCache;
  const p = path.join(__dirname, '..', 'data', 'crops', 'economics.json');
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      economicsCache = {
        items: raw.items || raw || {},
        disclaimer: raw.disclaimer,
        currency: raw.currency || 'CAD',
        year: raw.year,
        _source: 'economics.json',
      };
      // Optional overlay from farmfit export economics
      const farmfitEcon = path.join(__dirname, '..', 'data', 'crops', 'farmfit-economics.json');
      if (fs.existsSync(farmfitEcon)) {
        const fe = JSON.parse(fs.readFileSync(farmfitEcon, 'utf8'));
        const items = fe.items || fe;
        economicsCache.items = { ...economicsCache.items, ...items };
        economicsCache._source = 'economics.json + farmfit-economics.json';
      }
      return economicsCache;
    }
  } catch (e) {
    console.warn('economics load failed', e.message);
  }
  economicsCache = { items: {}, _source: 'none' };
  return economicsCache;
}

/**
 * Hard filters + soft scoring against Site Condition Profile.
 * Hardiness (with microclimate-effective zone) is the hard gate; texture/drainage/moisture
 * can hard-fail when clearly incompatible; other factors soft-score 0–100.
 */
function scoreCrop(crop, ctx, profile = null) {
  const reasons = [];
  const limits = [];
  const lever_benefits = [];
  let score = 100;
  let hard_filter_pass = true;

  // ——— HARD FILTER: hardiness (effective zone after microclimate push) ———
  const zSite = zoneIndex(ctx.zone);
  const zMin = zoneIndex(crop.hardiness_min);
  const zMax = zoneIndex(crop.hardiness_max);
  if (zSite < zMin) {
    hard_filter_pass = false;
    score = 0;
    limits.push(`Hard filter: site zone ${ctx.zone} colder than min ${crop.hardiness_min}`);
  } else if (zSite > zMax + 3) {
    score -= 25;
    limits.push(`Warmer than typical max ${crop.hardiness_max}`);
  } else {
    reasons.push(`Hardiness OK (${crop.hardiness_min}–${crop.hardiness_max}, site ${ctx.zone})`);
  }

  // ——— HARD FILTER: tropical ———
  if (isTropicalLeaning(crop)) {
    hard_filter_pass = false;
    score = 0;
    limits.push('Hard filter: tropical / warm-climate crop');
  }

  // Frost-free days (soft unless extreme)
  const ffdMin = num(crop.frost_free_min_days) ?? 90;
  if (ctx.ffd < ffdMin - 25) {
    hard_filter_pass = false;
    score = 0;
    limits.push(`Hard filter: season ${ctx.ffd} FFD << ${ffdMin} needed`);
  } else if (ctx.ffd < ffdMin - 10) {
    score -= 35;
    limits.push(`Short season: ${ctx.ffd} FFD < ~${ffdMin}`);
  } else if (ctx.ffd < ffdMin) {
    score -= 12;
    limits.push(`Marginal season: ${ctx.ffd} FFD vs ${ffdMin}`);
  } else {
    reasons.push(`Season length OK (${ctx.ffd} FFD)`);
  }

  // Precipitation / moisture regime
  const pMin = num(crop.precip_min_mm);
  const pMax = num(crop.precip_max_mm);
  const waterReq = String(crop.water_requirement || '').toLowerCase();
  if (pMin != null && ctx.precip < pMin - 120) {
    score -= 28;
    limits.push(`Dry: ${ctx.precip} mm < ${pMin} mm min`);
  } else if (pMin != null && ctx.precip < pMin) {
    score -= 10;
    limits.push(`Somewhat dry vs ${pMin} mm`);
  } else if (pMax != null && ctx.precip > pMax + 200) {
    score -= 15;
    limits.push(`Wet: ${ctx.precip} mm > ${pMax} mm max`);
  } else {
    reasons.push(`Precip OK (~${ctx.precip} mm)`);
  }
  // Moisture regime soft match
  if (ctx.water_regime === 'dry' && /wet|aquatic|bog/i.test(waterReq + (crop.notes || ''))) {
    score -= 20;
    limits.push('Wet-loving species on dry regime');
  }
  if (ctx.water_regime === 'wet' && /drought|xeric|dry/i.test(waterReq + (crop.notes || ''))) {
    score -= 12;
  }

  // Boost moisture-loving / wetland-edge species when any water is nearby
  const moistureLoving = isMoistureLovingPlant(crop);
  const nearWater =
    ctx.wetland_on_site ||
    ctx.small_water_confirmed ||
    ctx.small_water_possible ||
    ctx.water_regime === 'wet' ||
    ctx.water_regime === 'mesic_wet';
  if (nearWater && moistureLoving) {
    const dist = ctx.small_water_nearest_m;
    // Distance decay: full boost on-site → half by ~200 m
    let boost = ctx.wetland_on_site || ctx.small_water_confirmed ? 14 : 9;
    if (dist != null && dist > 0) {
      boost = Math.round(boost * Math.max(0.4, 1 - dist / 250));
    }
    if (ctx.small_water_possible && !ctx.small_water_confirmed && !ctx.wetland_on_site) {
      boost = Math.max(5, Math.round(boost * 0.75)); // modest for possible-only
      reasons.push('Moisture-loving fit near possible seeps (verify on site walk)');
    } else {
      reasons.push('Moisture-loving / wetland-edge fit near detected water');
    }
    score += boost;
    lever_benefits.push('water');
  }
  if (ctx.wetland_on_site && /willow|dogwood|alder|sedge|wetland|riparian/i.test(`${crop.common_name} ${crop.notes || ''}`)) {
    score += 6;
    reasons.push('Wetland-edge compatible (inventory)');
    lever_benefits.push('water');
  }

  // Texture
  const textures = crop.textures || [];
  if (textures.length && ctx.texture) {
    if (textures.includes(ctx.texture) || textureCompatible(textures, ctx.texture)) {
      reasons.push(`Texture match (${ctx.texture})`);
    } else {
      // Hard fail only for clear sand-only vs heavy clay mismatches
      if (isTextureHardFail(textures, ctx.texture)) {
        hard_filter_pass = false;
        score = 0;
        limits.push(`Hard filter: texture ${ctx.texture} incompatible`);
      } else {
        score -= 18;
        limits.push(`Texture ${ctx.texture} not ideal`);
      }
    }
  }

  // Drainage
  const drains = crop.drainage || [];
  if (drains.length && ctx.drainage) {
    if (drains.includes(ctx.drainage) || drainageCompatible(drains, ctx.drainage)) {
      reasons.push(`Drainage match (${ctx.drainage})`);
    } else if (
      (ctx.drainage === 'poor' || ctx.drainage === 'imperfect') &&
      drains.every((d) => d === 'rapid' || d === 'well')
    ) {
      hard_filter_pass = false;
      score = 0;
      limits.push(`Hard filter: needs better drainage than ${ctx.drainage}`);
    } else {
      score -= 16;
      limits.push(`Drainage ${ctx.drainage} not ideal`);
    }
  }

  // pH
  if (ctx.ph != null && crop.ph_min != null && crop.ph_max != null) {
    if (ctx.ph < crop.ph_min - 0.5 || ctx.ph > crop.ph_max + 0.5) {
      score -= 12;
      limits.push(`pH ${ctx.ph} outside ${crop.ph_min}–${crop.ph_max}`);
    } else {
      reasons.push('pH OK');
    }
  }

  if (ctx.chinook && crop.chinook_sensitive) {
    score -= 25;
    limits.push('Chinook-sensitive woody / early flower');
  }

  if (!hard_filter_pass) {
    return emptyScored(crop, reasons, limits, 0, 'poor', false, lever_benefits);
  }

  // ——— SOFT: weak fecundity levers ———
  const weakest = ctx.weakest || [];
  const nFix = !!(crop.nitrogen_fixer || crop.plant_specs?.nitrogen_fixer);
  const windish = /caragana|sea.?buckthorn|buffalo|willow|poplar|spruce|pine|ash|shelter|wind/i.test(
    `${crop.common_name} ${crop.id} ${crop.notes || ''}`
  );
  const soilish =
    crop.category === 'cover_crop' ||
    nFix ||
    /clover|vetch|alfalfa|comfrey|dynamic/i.test(`${crop.common_name} ${crop.notes || ''}`);
  const edible =
    crop.edibility_rating != null ||
    crop.plant_specs?.edibility_rating != null ||
    /fruit|berry|nut|vegetable|edible/i.test(`${crop.common_name} ${crop.notes || ''}`);

  for (const w of weakest) {
    const cat = w.category;
    const sev = w.score != null && w.score < 40 ? 12 : w.score != null && w.score < 55 ? 8 : 4;
    if (cat === 'nutrientCycling' && nFix) {
      score += sev;
      lever_benefits.push('nutrientCycling');
      reasons.push('Boosts weak nutrient cycling (N-fixer)');
    }
    if ((cat === 'soilStructure' || cat === 'soilBiology') && soilish) {
      score += sev;
      lever_benefits.push(cat);
      reasons.push(`Supports weak ${cat}`);
    }
    if (cat === 'microclimate' && windish) {
      score += sev;
      lever_benefits.push('microclimate');
      reasons.push('Wind-tolerant — improves microclimate lever');
    }
    if (cat === 'water' && (soilish || /deep.?root|mulch|drought/i.test(crop.notes || ''))) {
      score += Math.round(sev * 0.6);
      lever_benefits.push('water');
    }
    if (cat === 'vegetativeStructure' && (crop.guild_layer || crop.category === 'tree' || crop.category === 'shrub')) {
      score += sev;
      lever_benefits.push('vegetativeStructure');
    }
    if (cat === 'faunaIntegration' && (crop.alberta_native || edible || /pollinator|wildlife/i.test(crop.notes || ''))) {
      score += Math.round(sev * 0.7);
      lever_benefits.push('faunaIntegration');
    }
  }

  // Goal boosts applied after enrichPlantValues (see planPlantings) so primary_value is known.
  // Lightweight pre-boost here for hard-filter survivors only.
  const goals = ctx.goals || [];
  if (goals.includes('max_food') && edible) score += 6;
  if (goals.includes('max_nitrogen') && nFix) score += 8;
  if (goals.includes('windbreak') && windish) score += 8;
  if (goals.includes('soil_building') && soilish) score += 6;

  // Fill missing layers
  const layer = crop.guild_layer || 'herbaceous';
  if ((ctx.missing_layers || []).includes(layer)) {
    score += 6;
    reasons.push(`Fills missing layer: ${layer}`);
    lever_benefits.push('vegetativeStructure');
  }

  // Wind exposure
  if (ctx.wind_exposure === 'open' && windish) {
    score += 6;
    reasons.push('Wind-tolerant for open site');
  }
  if (ctx.wind_exposure === 'open' && crop.chinook_sensitive) {
    score -= 8;
  }

  // Succession fit
  if (
    (ctx.succession === 'pioneer' || ctx.succession === 'early_successional') &&
    (crop.category === 'cover_crop' || nFix || /caragana|sea.?buckthorn|wolf.?willow|buffalo/i.test(crop.id || ''))
  ) {
    score += 6;
    reasons.push('Pioneer / early-succession fit');
  }
  if (
    (ctx.succession === 'mid_successional' || ctx.succession === 'climax') &&
    (crop.food_forest || crop.plant_specs?.food_forest || layer === 'canopy' || layer === 'understory')
  ) {
    score += 4;
  }

  // Catalog quality signals (unchanged)
  if (crop.alberta_native) {
    score += 8;
    reasons.push('Alberta native / naturalized prairie-boreal species');
  } else if (crop.region_focus === 'alberta' || crop.region_focus === 'cold_temperate') {
    score += 3;
  }

  if (crop._vendor_product) {
    score -= 18;
    if (!crop.scientific_name) score -= 5;
    if (/mix(ture)?|blend|jumbo|sprinkle bag/i.test(crop.common_name || '')) score -= 10;
  } else {
    score += 12;
    reasons.push('Curated catalog entry');
  }

  const src = crop.spec_source || '';
  if (src.includes('permapeople') && src.includes('usda')) {
    score += 8;
    reasons.push('Specs: Permapeople + USDA');
  } else if (src.includes('pfaf') && src.includes('usda')) {
    score += 7;
    reasons.push('Specs: PFAF + USDA PLANTS');
  } else if (src.includes('pfaf') || src.includes('permapeople')) {
    score += 5;
    reasons.push(src.includes('pfaf') ? 'Specs from PFAF' : 'Specs from Permapeople');
  } else if (src.includes('usda')) {
    score += 4;
    reasons.push('Specs cross-checked with USDA PLANTS');
  } else if (src === 'inferred') {
    score -= 3;
  }

  if (crop.alberta_in_range || crop.plant_specs?.alberta_in_range) {
    score += 4;
    reasons.push('USDA range includes Alberta');
  }
  if (nFix) {
    score += 2;
    reasons.push('Nitrogen fixer (PFAF/USDA)');
  }
  if (crop.food_forest || crop.plant_specs?.food_forest) score += 1;

  if (
    (crop.category === 'cover_crop' ||
      crop.id === 'caragana' ||
      crop.id === 'sea-buckthorn' ||
      crop.id === 'wolf-willow' ||
      crop.id === 'buffalo-berry') &&
    score > 40
  ) {
    score += 3;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const suitability =
    score >= 80 ? 'excellent' : score >= 65 ? 'good' : score >= 50 ? 'fair' : score >= 35 ? 'marginal' : 'poor';

  return emptyScored(
    crop,
    reasons,
    limits,
    score,
    suitability,
    true,
    [...new Set(lever_benefits)]
  );
}

function emptyScored(crop, reasons, limits, score, suitability, hard_filter_pass, lever_benefits) {
  return {
    id: crop.id,
    common_name: crop.common_name,
    scientific_name: crop.scientific_name || null,
    category: crop.category,
    guild_layer: crop.guild_layer,
    alberta_native: !!crop.alberta_native,
    _vendor_product: !!crop._vendor_product,
    source_vendors: crop.source_vendors || null,
    product_urls: crop.product_urls || null,
    spec_source: crop.spec_source || null,
    spec_confidence: crop.spec_confidence || null,
    light_requirement: crop.light_requirement || null,
    water_requirement: crop.water_requirement || null,
    hardiness_min: crop.hardiness_min || null,
    hardiness_max: crop.hardiness_max || null,
    frost_free_min_days: crop.frost_free_min_days ?? null,
    precip_min_mm: crop.precip_min_mm ?? null,
    precip_max_mm: crop.precip_max_mm ?? null,
    alberta_in_range:
      crop.alberta_in_range ?? crop.plant_specs?.alberta_in_range ?? null,
    nitrogen_fixer: crop.nitrogen_fixer ?? crop.plant_specs?.nitrogen_fixer ?? null,
    edibility_rating:
      crop.edibility_rating ?? crop.plant_specs?.edibility_rating ?? null,
    food_forest: crop.food_forest ?? crop.plant_specs?.food_forest ?? null,
    plant_specs: crop.plant_specs
      ? {
          spec_source: crop.plant_specs.spec_source,
          usda_symbol: crop.plant_specs.usda_symbol,
          usda_url: crop.plant_specs.usda_url,
          permapeople_url: crop.plant_specs.permapeople_url,
          pfaf_url: crop.plant_specs.pfaf_url,
          canada_provinces: crop.plant_specs.canada_provinces,
          edible: crop.plant_specs.edible,
          edible_parts: crop.plant_specs.edible_parts,
          edibility_rating: crop.plant_specs.edibility_rating,
          nitrogen_fixer: crop.plant_specs.nitrogen_fixer,
          food_forest: crop.plant_specs.food_forest,
          growth_rate: crop.plant_specs.growth_rate,
          attribution: crop.plant_specs.attribution,
        }
      : null,
    score,
    suitability,
    hard_filter_pass,
    lever_benefits: lever_benefits || [],
    reasons,
    limits,
    notes: crop.notes || null,
  };
}

function textureCompatible(allowed, site) {
  // Map close relatives
  const groups = {
    sand: ['sand', 'loamy_sand', 'sandy_loam'],
    sandy_loam: ['sand', 'loamy_sand', 'sandy_loam', 'loam'],
    loam: ['sandy_loam', 'loam', 'silt_loam', 'clay_loam'],
    silt_loam: ['loam', 'silt_loam', 'silt', 'clay_loam'],
    clay_loam: ['loam', 'clay_loam', 'clay', 'silt_loam'],
    clay: ['clay', 'clay_loam'],
  };
  const g = groups[site] || [site];
  return allowed.some((a) => g.includes(a) || a === site);
}

function isTextureHardFail(allowed, site) {
  const sandOnly = allowed.every((a) => /sand/.test(a) && !/loam|clay|silt/.test(a));
  const clayOnly = allowed.every((a) => a === 'clay');
  if (sandOnly && /clay/.test(site) && !/loam/.test(site)) return true;
  if (clayOnly && site === 'sand') return true;
  return false;
}

function drainageCompatible(allowed, site) {
  const order = ['rapid', 'well', 'moderately_well', 'imperfect', 'poor'];
  const si = order.indexOf(site);
  return allowed.some((a) => {
    const ai = order.indexOf(a);
    if (ai < 0 || si < 0) return a === site;
    return Math.abs(ai - si) <= 1;
  });
}

/** Moisture-loving / wetland-edge species heuristic for small-water boosts. */
function isMoistureLovingPlant(crop) {
  const name = `${crop.common_name || ''} ${crop.scientific_name || ''} ${crop.id || ''} ${crop.notes || ''} ${crop.water_requirement || ''}`;
  if (/willow|dogwood|alder|sedge|cattail|birch|highbush|cranberry|currant|riparian|wetland|marsh|bog|swamp|moisture|wet.?meadow|water.?loving/i.test(name)) {
    return true;
  }
  if (/wet|moist|mesic|hydric/i.test(String(crop.water_requirement || ''))) return true;
  const drains = crop.drainage || [];
  if (drains.some((d) => /poor|imperfect|very.?poor/i.test(String(d)))) return true;
  return false;
}

function plantSignals(row) {
  const name = `${row.common_name || ''} ${row.scientific_name || ''} ${row.id || ''} ${row.notes || ''}`;
  const nFix = !!(row.nitrogen_fixer || row.plant_specs?.nitrogen_fixer);
  return {
    edible:
      row.edibility_rating != null ||
      row.plant_specs?.edibility_rating != null ||
      row.plant_specs?.edible === true ||
      row.primary_value === 'food_production' ||
      /fruit|berry|nut|vegetable|edible|orchard/i.test(name),
    nFix,
    windish:
      row.primary_value === 'wind_protection' ||
      /caragana|sea.?buckthorn|buffalo|willow|poplar|spruce|pine|ash|shelter|wind/i.test(name),
    soilish:
      row.category === 'cover_crop' ||
      nFix ||
      row.primary_value === 'soil_building' ||
      /clover|vetch|alfalfa|comfrey|cover/i.test(name),
    medicinal:
      row.primary_value === 'medicinal' ||
      row.category === 'herb' ||
      row.category === 'medicinal' ||
      /medicinal|echinacea|yarrow|calendula|chamomile|mint|sage|lavender/i.test(name),
    fodder: /forage|fodder|hay|pasture|alfalfa|clover|vetch/i.test(name + (row.category || '')),
    wetland: /willow|dogwood|sedge|alder|birch|cranberry|riparian|wetland/i.test(name),
    native: !!row.alberta_native,
    pollinator:
      /pollinator|bee|nectar|flower/i.test(name) ||
      row.category === 'herb' ||
      row.primary_value === 'biodiversity',
  };
}

function isTropicalLeaning(crop) {
  const zMin = zoneIndex(crop.hardiness_min);
  // Minimum hardiness zone 8+ means too warm for AB
  if (zMin >= zoneIndex('8a')) return true;
  const name = `${crop.common_name || ''} ${crop.scientific_name || ''}`.toLowerCase();
  return /banana|mango|papaya|cacao|coffee|coconut|cassava|taro|breadfruit|durian|rambutan|lychee|vanilla|pineapple|avocado|guava|sugarcane|teak|rubber|oil palm|passionfruit|dragon fruit|starfruit|manioc|yam\b|citrus|orange tree|lemon tree|lime tree/.test(
    name
  );
}

function loadCatalog() {
  if (catalogCache) return catalogCache;

  const byId = new Map();

  // Vendor-scraped inventory first (breadth); curated packs overwrite same ids
  const vendorPath = path.join(__dirname, '..', 'data', 'crops', 'vendor-catalog.json');
  loadInto(byId, vendorPath, 'vendor-catalog.json', { mergeSuppliers: true });

  const basePath = path.join(__dirname, '..', 'data', 'crops', 'alberta-catalog.json');
  loadInto(byId, basePath, 'alberta-catalog.json', { mergeSuppliers: true });

  // Alberta natives / prairie-hardy pack (overrides same ids, adds many natives)
  const nativesPath = path.join(__dirname, '..', 'data', 'crops', 'alberta-natives.json');
  loadInto(byId, nativesPath, 'alberta-natives.json', { mergeSuppliers: true });

  const farmfitLocal = path.join(__dirname, '..', 'data', 'crops', 'farmfit-export.json');
  loadInto(byId, farmfitLocal, 'farmfit-export.json', { mergeSuppliers: true });

  if (process.env.GROWING_GUIDE_CROPS_PATH) {
    loadInto(byId, process.env.GROWING_GUIDE_CROPS_PATH, process.env.GROWING_GUIDE_CROPS_PATH, {
      mergeSuppliers: true,
    });
  }

  // Optional: auto-discover farmfit-export next to Growing Guide path
  const gg = process.env.GROWING_GUIDE_PATH;
  if (gg) {
    const candidates = [
      path.join(gg, 'farmfit', 'data', 'crops-export.json'),
      path.join(gg, 'farmfit', 'public', 'crops-export.json'),
      path.join(gg, 'crops-export.json'),
    ];
    for (const c of candidates) loadInto(byId, c, c, { mergeSuppliers: true });
  }

  // Overlay Permapeople + USDA plant-specs cache (spec_source tracking)
  const specsMeta = loadPlantSpecsCache().meta || {};
  catalogCache = [...byId.values()].map((c) => applyPlantSpecs(c));
  catalogCache._source = catalogSourceLabel;
  if (!specsMeta.empty) {
    catalogCache._source = `${catalogSourceLabel} + plant-specs (Permapeople/USDA)`;
  }
  catalogCache._specs_meta = specsMeta;
  return catalogCache;
}

function loadInto(map, filePath, label, opts = {}) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.crops || raw.plants || [];
    let n = 0;
    for (const c of list) {
      if (!c?.id && !c?.common_name) continue;
      const id = c.id || slug(c.common_name || c.scientific_name);
      const next = normalizeCrop({ ...c, id });
      if (opts.mergeSuppliers && map.has(id)) {
        map.set(id, mergeCropRecords(map.get(id), next));
      } else {
        map.set(id, next);
      }
      n++;
    }
    if (n) {
      catalogSourceLabel = catalogSourceLabel
        ? `${catalogSourceLabel} + ${label}`
        : label;
    }
  } catch (e) {
    console.warn('crop catalog load failed', filePath, e.message);
  }
}

function mergeCropRecords(prev, next) {
  // Curated later loads win on core agronomic fields; keep supplier links from both
  const suppliers = {
    seeds: [
      ...(prev.suppliers?.seeds || []),
      ...(next.suppliers?.seeds || []),
    ].slice(0, 8),
    saplings: [
      ...(prev.suppliers?.saplings || []),
      ...(next.suppliers?.saplings || []),
    ].slice(0, 8),
    fertilizer: [
      ...(prev.suppliers?.fertilizer || []),
      ...(next.suppliers?.fertilizer || []),
    ].slice(0, 5),
  };
  const source_vendors = [
    ...new Set([...(prev.source_vendors || []), ...(next.source_vendors || [])]),
  ];
  const product_urls = [
    ...new Set([...(prev.product_urls || []), ...(next.product_urls || [])]),
  ].slice(0, 12);

  // Prefer non-vendor-only record for scientific name / notes when present
  const preferCurated = !next._vendor_product || prev._vendor_product === false;
  const base = preferCurated ? { ...prev, ...next } : { ...next, ...prev };

  return {
    ...base,
    suppliers,
    source_vendors,
    product_urls,
    alberta_native: !!(prev.alberta_native || next.alberta_native),
    _vendor_product: !!(prev._vendor_product && next._vendor_product),
  };
}

function normalizeCrop(c) {
  const crop = {
    id: c.id,
    common_name: c.common_name || c.name || c.id,
    scientific_name: c.scientific_name || c.latin || null,
    category: c.category || c.type || 'perennial',
    guild_layer: c.guild_layer || c.layer || 'herbaceous',
    hardiness_min: normalizeZone(c.hardiness_min || c.zone_min || '3a'),
    hardiness_max: normalizeZone(c.hardiness_max || c.zone_max || '7a'),
    frost_free_min_days: num(c.frost_free_min_days ?? c.min_ffd),
    precip_min_mm: num(c.precip_min_mm ?? c.rainfall_min),
    precip_max_mm: num(c.precip_max_mm ?? c.rainfall_max),
    ph_min: num(c.ph_min),
    ph_max: num(c.ph_max),
    textures: c.textures || c.soil_textures || [],
    drainage: c.drainage || c.drainage_classes || [],
    chinook_sensitive: !!c.chinook_sensitive,
    alberta_native: !!(c.alberta_native || c.native_alberta),
    region_focus: c.region_focus || (c.alberta_native ? 'alberta' : null),
    notes: c.notes || c.description || null,
    suppliers: c.suppliers || null,
    source_vendors: c.source_vendors || null,
    product_urls: c.product_urls || null,
    search_terms: c.search_terms || null,
    _vendor_product: !!c._vendor_product,
    // Spec provenance: curated | inferred | usda_plants | permapeople | permapeople+usda
    spec_source:
      c.spec_source ||
      (c._vendor_product ? 'inferred' : 'curated'),
    spec_confidence: c.spec_confidence || null,
    light_requirement: c.light_requirement || null,
    water_requirement: c.water_requirement || null,
    growth_rate: c.growth_rate || null,
    nitrogen_fixer: c.nitrogen_fixer ?? null,
    edible: c.edible ?? null,
    edible_parts: c.edible_parts || null,
    alberta_in_range: c.alberta_in_range ?? null,
    plant_specs: c.plant_specs || null,
  };
  if (c.economics) crop._inline_economics = c.economics;
  return crop;
}

function groupBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item) || 'other';
    if (!out[k]) out[k] = [];
    out[k].push(item);
  }
  return out;
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export {
  PLANT_GOALS,
  normalizePlantGoals,
  getPlantGoalsPayload,
  goalsLabel,
};
