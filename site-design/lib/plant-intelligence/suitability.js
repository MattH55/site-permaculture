/**
 * Transparent weighted suitability: climate × solar × soil × water × space × ecological.
 * Hard constraints reject; unknown fields reduce confidence, not score.
 */

export const DEFAULT_WEIGHTS = {
  climate: 1,
  solar: 1,
  soil: 1,
  water: 1,
  space: 1,
  ecological: 1,
};

const HARDINESS_INDEX = {
  '1a': 1, '1b': 1.5, '2a': 2, '2b': 2.5, '3a': 3, '3b': 3.5,
  '4a': 4, '4b': 4.5, '5a': 5, '5b': 5.5, '6a': 6, '6b': 6.5,
  '7a': 7, '7b': 7.5, '8a': 8, '8b': 8.5, '9a': 9, '9b': 9.5,
};

export function scorePlant(plant, site = {}, weights = DEFAULT_WEIGHTS) {
  const constraints = [];
  const reasons = [];
  const unknown = [];

  const climate = scoreClimate(plant, site, constraints, reasons, unknown);
  const solar = scoreSolar(plant, site, constraints, reasons, unknown);
  const soil = scoreSoil(plant, site, constraints, reasons, unknown);
  const water = scoreWater(plant, site, constraints, reasons, unknown);
  const space = scoreSpace(plant, site, constraints, reasons, unknown);
  const ecological = scoreEcological(plant, site, constraints, reasons, unknown);

  const hardFail = constraints.some((c) => c.hard);
  const parts = { climate, solar, soil, water, space, ecological };
  let product = 1;
  let used = 0;
  for (const [k, v] of Object.entries(parts)) {
    const w = weights[k] ?? 1;
    if (v.unknown) continue;
    product *= v.score ** w;
    used++;
  }
  if (!used) product = 0.5;
  if (hardFail) product = 0;

  const confidence = confidenceFrom(plant, unknown, used);
  return {
    taxon_id: plant.taxon?.id,
    scientific_name: plant.taxon?.scientific_name,
    common_name: plant.taxon?.common_names?.[0] || null,
    suitability: hardFail ? 0 : round3(product),
    confidence: round3(confidence),
    scores: {
      climate: round3(climate.score),
      solar: round3(solar.score),
      soil: round3(soil.score),
      water: round3(water.score),
      space: round3(space.score),
      ecological: round3(ecological.score),
    },
    constraints: constraints.map((c) => c.message),
    reasons,
    unknown_fields: unknown,
    hard_fail: hardFail,
    sources: plant.sources || [],
  };
}

function scoreClimate(plant, site, constraints, reasons, unknown) {
  const c = plant.climate || {};
  const bits = [];
  if (site.temperature_min_c != null && c.temp_min_c != null) {
    if (site.temperature_min_c < c.temp_min_c - 8) {
      constraints.push({ hard: true, message: `Site min temp ${site.temperature_min_c}°C is below plant absolute min ${c.temp_min_c}°C` });
      return { score: 0 };
    }
    bits.push(envelope(site.temperature_min_c, c.temp_min_c, c.temp_opt_min_c, c.temp_opt_max_c, c.temp_max_c));
    if (site.temperature_min_c >= (c.temp_opt_min_c ?? c.temp_min_c)) reasons.push('Compatible temperature range');
  } else unknown.push('temperature');

  if (site.temperature_max_c != null && c.temp_max_c != null) {
    if (site.temperature_max_c > c.temp_max_c + 6) {
      constraints.push({ hard: true, message: `Site max temp ${site.temperature_max_c}°C exceeds plant max ${c.temp_max_c}°C` });
      return { score: 0 };
    }
  }

  if (site.annual_precipitation_mm != null && (c.precip_min_mm != null || c.precip_max_mm != null)) {
    bits.push(envelope(site.annual_precipitation_mm, c.precip_min_mm, null, null, c.precip_max_mm));
    reasons.push('Precipitation within EcoCrop envelope');
  } else unknown.push('precipitation');

  if (site.hardiness_zone && c.hardiness_zone_min) {
    const si = HARDINESS_INDEX[String(site.hardiness_zone).toLowerCase()];
    const pi = HARDINESS_INDEX[String(c.hardiness_zone_min).toLowerCase()];
    if (si != null && pi != null && si + 0.2 < pi) {
      constraints.push({ hard: true, message: `Site zone ${site.hardiness_zone} is colder than plant min ${c.hardiness_zone_min}` });
      return { score: 0 };
    }
    if (si != null && pi != null) {
      bits.push(si >= pi ? 1 : 0.4);
      reasons.push(`Hardiness ${c.hardiness_zone_min} fits zone ${site.hardiness_zone}`);
    }
  }

  if (site.frost_free_days != null && c.frost_free_days_min != null) {
    bits.push(site.frost_free_days >= c.frost_free_days_min ? 1 : site.frost_free_days >= c.frost_free_days_min - 15 ? 0.5 : 0.2);
  }

  if (site.elevation_m != null && c.altitude_max_m != null && site.elevation_m > c.altitude_max_m + 200) {
    bits.push(0.3);
  }

  if (!bits.length) return { score: 1, unknown: true };
  return { score: avg(bits) };
}

function scoreSolar(plant, site, constraints, reasons, unknown) {
  const s = plant.solar || {};
  const siteSun = site.annual_solar_kwh_m2 ?? site.growing_season_solar_kwh_m2 ?? null;
  const shade = (s.shade_tolerance || '').toLowerCase();
  const req = (s.light_requirement || '').toLowerCase();
  if (siteSun == null && !site.light_class) {
    unknown.push('solar');
    return { score: 1, unknown: true };
  }
  const fullSun = siteSun != null ? siteSun >= 1100 : site.light_class === 'full_sun';
  const shadeSite = siteSun != null ? siteSun < 700 : site.light_class === 'shade';
  if (shade === 'intolerant' || /very bright|clear skies|full.?sun/.test(req)) {
    if (shadeSite) return { score: 0.25 };
    reasons.push('Excellent solar exposure for a full-sun plant');
    return { score: fullSun ? 1 : 0.7 };
  }
  if (shade === 'tolerant' || /shady|full.?shade/.test(req)) {
    return { score: shadeSite ? 1 : 0.65 };
  }
  reasons.push('Light requirement compatible');
  return { score: 0.85 };
}

function scoreSoil(plant, site, constraints, reasons, unknown) {
  const s = plant.soil || {};
  const bits = [];
  if (site.soil_ph != null && s.ph_min != null && s.ph_max != null) {
    if (site.soil_ph < s.ph_min - 0.4 || site.soil_ph > s.ph_max + 0.4) {
      constraints.push({ hard: true, message: `Soil pH ${site.soil_ph} outside plant range ${s.ph_min}–${s.ph_max}` });
      return { score: 0 };
    }
    bits.push(site.soil_ph >= s.ph_min && site.soil_ph <= s.ph_max ? 1 : 0.55);
    reasons.push('Compatible soil pH');
  } else unknown.push('soil_ph');

  if (site.soil_texture && s.texture_preferences?.length) {
    const t = String(site.soil_texture).toLowerCase();
    const ok = s.texture_preferences.some((p) => t.includes(String(p).toLowerCase()) || String(p).toLowerCase().includes(t));
    bits.push(ok ? 1 : 0.45);
  }

  if (site.soil_drainage && s.drainage_requirement) {
    const d = String(site.soil_drainage).toLowerCase();
    const need = String(s.drainage_requirement).toLowerCase();
    bits.push(need.includes(d) || d.includes(need.split(' ')[0]) || /well/.test(need) === /well/.test(d) ? 0.9 : 0.5);
  }

  if (site.available_rooting_depth_cm != null && s.soil_depth_min_cm != null) {
    if (site.available_rooting_depth_cm < s.soil_depth_min_cm * 0.6) {
      constraints.push({ hard: true, message: `Rooting depth ${site.available_rooting_depth_cm} cm is insufficient (need ~${s.soil_depth_min_cm} cm)` });
      return { score: 0 };
    }
    bits.push(site.available_rooting_depth_cm >= s.soil_depth_min_cm ? 1 : 0.6);
    reasons.push('Adequate rooting depth');
  }

  if (!bits.length) return { score: 1, unknown: true };
  return { score: avg(bits) };
}

function scoreWater(plant, site, constraints, reasons, unknown) {
  const w = plant.water || {};
  const c = plant.climate || {};
  if (site.annual_precipitation_mm == null && site.soil_moisture == null) {
    unknown.push('water');
    return { score: 1, unknown: true };
  }
  if (site.annual_precipitation_mm != null && c.precip_min_mm != null) {
    const p = site.annual_precipitation_mm;
    if (p < c.precip_min_mm * 0.5) return { score: 0.3 };
    if (c.precip_max_mm != null && p > c.precip_max_mm * 1.4) return { score: 0.45 };
    reasons.push('Moisture regime matches precipitation envelope');
    return { score: 0.9 };
  }
  return { score: 0.8 };
}

function scoreSpace(plant, site, constraints, reasons, unknown) {
  const m = plant.morphology || {};
  const need = m.mature_width_max_m || m.mature_width_min_m || (m.mature_height_max_m ? m.mature_height_max_m * 0.6 : null);
  if (site.available_space_m == null && site.available_vertical_m == null) {
    unknown.push('space');
    return { score: 1, unknown: true };
  }
  if (need != null && site.available_space_m != null) {
    if (site.available_space_m < need * 0.4) {
      constraints.push({ hard: false, message: `Tight horizontal space (${site.available_space_m} m) vs mature width ~${need} m` });
      return { score: 0.35 };
    }
    reasons.push('Fits available space at this location');
    return { score: site.available_space_m >= need ? 1 : 0.7 };
  }
  if (m.mature_height_max_m != null && site.available_vertical_m != null) {
    return { score: site.available_vertical_m >= m.mature_height_max_m ? 1 : 0.5 };
  }
  return { score: 0.85 };
}

function scoreEcological(plant, site, constraints, reasons, unknown) {
  const e = plant.ecology || {};
  if (e.invasive_status === 'invasive' && site.region && (e.invasive_regions || []).includes(site.region)) {
    constraints.push({ hard: true, message: 'Known invasive restriction for this region' });
    return { score: 0 };
  }
  let s = 0.8;
  if (e.native_regions?.length && site.region) {
    if (e.native_regions.some((r) => String(r).toLowerCase().includes(String(site.region).toLowerCase()))) {
      s = 1;
      reasons.push('Native / documented for this region');
    }
  } else unknown.push('native_status');
  return { score: s };
}

function envelope(x, min, optMin, optMax, max) {
  if (min != null && x < min) return 0;
  if (max != null && x > max) return 0;
  if (optMin != null && optMax != null && x >= optMin && x <= optMax) return 1;
  if (optMin != null && x < optMin && min != null) return 0.4 + 0.6 * ((x - min) / Math.max(optMin - min, 1e-6));
  if (optMax != null && x > optMax && max != null) return 0.4 + 0.6 * ((max - x) / Math.max(max - optMax, 1e-6));
  return 0.85;
}

function confidenceFrom(plant, unknown, used) {
  const nProv = plant.provenance?.length || 0;
  const nSrc = new Set(plant.sources || []).size;
  let c = 0.55 + Math.min(0.3, nSrc * 0.12) + Math.min(0.1, nProv * 0.01);
  if (plant.gbif?.gbif_taxon_key) c += 0.05;
  c -= Math.min(0.25, unknown.length * 0.04);
  if (used < 2) c -= 0.1;
  return Math.max(0.35, Math.min(0.97, c));
}

function avg(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}
