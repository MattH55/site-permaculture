// ============================================================
// ECOCROP Limiting-Factor Model for Crop Suitability Scoring
// Based on FAO ECOCROP / Recocrop methodology
// ============================================================

import {
  ClimateNormals,
  SoilBasics,
  SuitabilityParams,
  SuitabilityResult,
  FactorScore,
  SuitabilityLevel,
  BadgeVariant,
  LandProfile,
} from '@/types';

/**
 * Score a single environmental parameter using trapezoidal membership.
 * Returns 0-1 where:
 *   1.0 = within optimal range
 *   0.0-1.0 = between absolute limit and optimal (linear interpolation)
 *   0.0 = outside absolute limits (hard constraint)
 */
function trapezoidalScore(
  value: number,
  absMin: number,
  optMin: number,
  optMax: number,
  absMax: number
): number {
  // Outside absolute limits
  if (value <= absMin || value >= absMax) return 0;
  // Within optimal range
  if (value >= optMin && value <= optMax) return 1.0;
  // Between absMin and optMin
  if (value > absMin && value < optMin) {
    return (value - absMin) / (optMin - absMin);
  }
  // Between optMax and absMax
  return (absMax - value) / (absMax - optMax);
}

/**
 * Score temperature suitability.
 * Uses mean annual temperature as primary, plus cold/warm month extremes as constraints.
 */
function scoreTemperature(params: SuitabilityParams, climate: ClimateNormals): FactorScore[] {
  const factors: FactorScore[] = [];

  // Mean annual temperature
  const meanTempScore = trapezoidalScore(
    climate.annual_temp_mean,
    params.temp_min_abs,
    params.temp_opt_min,
    params.temp_opt_max,
    params.temp_max_abs
  );
  factors.push({
    factor: 'temp_mean',
    score: meanTempScore,
    label: 'Mean Temperature',
    detail: `${climate.annual_temp_mean.toFixed(1)}°C (optimal: ${params.temp_opt_min}-${params.temp_opt_max}°C)`,
  });

  // Coldest month - must not go below absolute min
  const coldScore =
    climate.temp_coldest_month >= params.temp_min_abs ? 1.0 : 0.0;
  factors.push({
    factor: 'temp_cold',
    score: coldScore,
    label: 'Coldest Month',
    detail: `${climate.temp_coldest_month.toFixed(1)}°C (minimum: ${params.temp_min_abs}°C)`,
  });

  // Warmest month - must not exceed absolute max
  const hotScore =
    climate.temp_warmest_month <= params.temp_max_abs ? 1.0 : 0.0;
  factors.push({
    factor: 'temp_hot',
    score: hotScore,
    label: 'Warmest Month',
    detail: `${climate.temp_warmest_month.toFixed(1)}°C (maximum: ${params.temp_max_abs}°C)`,
  });

  return factors;
}

/**
 * Score rainfall suitability.
 */
function scoreRainfall(params: SuitabilityParams, climate: ClimateNormals): FactorScore[] {
  const factors: FactorScore[] = [];

  const precipScore = trapezoidalScore(
    climate.annual_precip_mm,
    params.rainfall_min_mm,
    params.rainfall_opt_min_mm,
    params.rainfall_opt_max_mm,
    params.rainfall_max_mm
  );
  factors.push({
    factor: 'precip_annual',
    score: precipScore,
    label: 'Annual Rainfall',
    detail: `${climate.annual_precip_mm.toFixed(0)} mm (optimal: ${params.rainfall_opt_min_mm}-${params.rainfall_opt_max_mm} mm)`,
  });

  // Growing season precip check - use driest month as stress indicator
  if (params.drought_tolerance) {
    const dryMonthRatio = climate.precip_driest_month / (climate.annual_precip_mm / 12);
    let droughtScore = 1.0;
    if (params.drought_tolerance === 'low' && dryMonthRatio < 0.2) droughtScore = 0.3;
    else if (params.drought_tolerance === 'medium' && dryMonthRatio < 0.1) droughtScore = 0.4;
    else if (params.drought_tolerance === 'high' && dryMonthRatio < 0.05) droughtScore = 0.5;
    factors.push({
      factor: 'drought_stress',
      score: droughtScore,
      label: 'Dry Season Stress',
      detail: `Driest month: ${climate.precip_driest_month.toFixed(0)} mm (tolerance: ${params.drought_tolerance})`,
    });
  }

  return factors;
}

/**
 * Score soil pH suitability.
 */
function scorePh(params: SuitabilityParams, profile: LandProfile): FactorScore[] {
  const factors: FactorScore[] = [];
  const ph = profile.ph_override ?? profile.soil?.ph_mean ?? 7.0;

  const phScore = trapezoidalScore(ph, params.ph_min, params.ph_opt_min, params.ph_opt_max, params.ph_max);
  factors.push({
    factor: 'soil_ph',
    score: phScore,
    label: 'Soil pH',
    detail: `pH ${ph.toFixed(1)} (optimal: ${params.ph_opt_min}-${params.ph_opt_max})`,
  });

  return factors;
}

/**
 * Score growing season length suitability.
 */
function scoreGrowingSeason(params: SuitabilityParams, climate: ClimateNormals): FactorScore[] {
  const factors: FactorScore[] = [];

  // Growing season check: does the local growing season cover the crop's needs?
  const seasonScore =
    climate.growing_season_days >= params.growing_days_min ? 1.0
    : climate.growing_season_days / params.growing_days_min;

  factors.push({
    factor: 'growing_season',
    score: Math.min(1, seasonScore),
    label: 'Growing Season',
    detail: `${climate.growing_season_days} days available (min needed: ${params.growing_days_min})`,
  });

  return factors;
}

/**
 * Score elevation suitability if data available.
 */
function scoreElevation(params: SuitabilityParams, elevation?: number): FactorScore | null {
  if (elevation === undefined || params.elevation_min_m === undefined || params.elevation_max_m === undefined) {
    return null;
  }
  const inRange = elevation >= params.elevation_min_m && elevation <= params.elevation_max_m;
  return {
    factor: 'elevation',
    score: inRange ? 1.0 : 0.0,
    label: 'Elevation',
    detail: `${elevation}m (range: ${params.elevation_min_m}-${params.elevation_max_m}m)`,
  };
}

/**
 * Determine suitability level and badge color from overall score.
 */
function getLevelAndBadge(score: number): { level: SuitabilityLevel; badge: BadgeVariant } {
  if (score >= 0.8) return { level: 'excellent', badge: 'green' };
  if (score >= 0.6) return { level: 'suitable', badge: 'yellow' };
  if (score >= 0.4) return { level: 'marginal', badge: 'orange' };
  return { level: 'unsuitable', badge: 'red' };
}

/**
 * Map latitude/longitude to broad geographic region.
 */
function getRegionFromLocation(lat: number, lng: number): string {
  // Simplified global region mapping
  if (lat > 50) return 'Europe';
  if (lat > 30 && lat <= 50) return 'North America';
  if (lat > 15 && lat <= 30) return 'North Africa / Middle East';
  if (lat > 0 && lat <= 15) return 'Sub-Saharan Africa';
  if (lat > -15 && lat <= 0) return 'Central Africa';
  if (lat > -35 && lat <= -15) return 'Southern Africa';
  if (lat > -45 && lat <= -35) return 'Southern Africa';
  if (lng > 60 && lng < 180) return 'Asia';
  if (lng > 100 && lng < 150) return 'Southeast Asia';
  if (lat > -60 && lat < -40) return 'South America';
  if (lat > -35 && lat < -15) return 'South America';
  if (lat > 0 && lat < 20 && lng > -90 && lng < -60) return 'Central America';
  return 'Tropical/Global';
}

/**
 * Score geographic/regional suitability.
 * Checks if the crop is grown in regions that include the user's location.
 */
function scoreRegion(cropRegions: string[], lat: number, lng: number): FactorScore {
  const userRegion = getRegionFromLocation(lat, lng);

  // Global crops get full score
  if (cropRegions.includes('Global')) {
    return {
      factor: 'region',
      score: 1.0,
      label: 'Geographic Range',
      detail: `Crop is grown globally (your region: ${userRegion})`,
    };
  }

  // Check for exact region match
  const regionMatch = cropRegions.some(
    (r) => r.toLowerCase() === userRegion.toLowerCase() ||
           userRegion.toLowerCase().includes(r.toLowerCase()) ||
           r.toLowerCase().includes(userRegion.toLowerCase())
  );

  if (regionMatch) {
    return {
      factor: 'region',
      score: 1.0,
      label: 'Geographic Range',
      detail: `Crop grows in ${cropRegions.join(', ')} (match: ${userRegion})`,
    };
  }

  // Partial credit if crop grows in similar climatic zones
  // Tropical crops work in tropical/equatorial regions
  const isTropical = cropRegions.some((r) => r.toLowerCase().includes('tropical'));
  const userIsTropical = Math.abs(lat) < 30;
  if (isTropical && userIsTropical) {
    return {
      factor: 'region',
      score: 0.6,
      label: 'Geographic Range',
      detail: `Crop is tropical; your region (${userRegion}) is also tropical`,
    };
  }

  // No match
  return {
    factor: 'region',
    score: 0.2,
    label: 'Geographic Range',
    detail: `Crop grows in ${cropRegions.join(', ')} but you're in ${userRegion}`,
  };
}

/**
 * Compute tolerance-bonus adjustments.
 * Rewards crops whose tolerance profiles match site constraints.
 */
function computeToleranceBonus(params: SuitabilityParams, climate: ClimateNormals): number {
  let bonus = 0;

  // Frost tolerance bonus for cold sites
  if (climate.temp_coldest_month < 5) {
    const frostBonus = { none: 0, light: 0.02, moderate: 0.05, high: 0.08 };
    bonus += frostBonus[params.frost_tolerance || 'none'];
  }

  // Drought tolerance bonus for dry sites
  if (climate.annual_precip_mm < 600) {
    const droughtBonus = { low: 0, medium: 0.03, high: 0.06 };
    bonus += droughtBonus[params.drought_tolerance || 'low'];
  }

  return bonus;
}

/**
 * Main scoring function: score one crop against a land profile.
 * Returns SuitabilityResult with all factor scores.
 * Now includes geographic range suitability.
 */
export function scoreCrop(
  cropName: string,
  params: SuitabilityParams,
  profile: LandProfile,
  cropRegions?: string[]
): SuitabilityResult {
  if (!profile.climate) {
    return {
      crop_id: cropName,
      overall_score: 0,
      level: 'unsuitable',
      badge: 'gray',
      factors: [],
      limiting_factors: ['No climate data available'],
      hard_fail: true,
      fail_reason: 'Climate data not loaded for this profile.',
    };
  }

  const climate = profile.climate;
  const allFactors: FactorScore[] = [];

  // Temperature scores
  const tempFactors = scoreTemperature(params, climate);
  allFactors.push(...tempFactors);

  // Rainfall scores
  const precipFactors = scoreRainfall(params, climate);
  allFactors.push(...precipFactors);

  // pH score
  const phFactors = scorePh(params, profile);
  allFactors.push(...phFactors);

  // Growing season
  const seasonFactors = scoreGrowingSeason(params, climate);
  allFactors.push(...seasonFactors);

  // Elevation (if data available)
  const elevFactor = scoreElevation(params, profile.location.elevation);
  if (elevFactor) allFactors.push(elevFactor);

  // Geographic/regional suitability (if crop regions provided)
  if (cropRegions && cropRegions.length > 0) {
    const regionFactor = scoreRegion(cropRegions, profile.location.lat, profile.location.lng);
    allFactors.push(regionFactor);
  }

  // Check for hard failures (only critical factors with score 0)
  // temp_cold is a hard fail only for truly frost-sensitive crops in near-freezing conditions
  // temp_hot is rarely a hard fail — most tropical crops tolerate warmth
  const hardFailFactors = allFactors.filter(
    (f) => f.score === 0 && ['temp_cold'].includes(f.factor)
  );

  const limitingFactors = allFactors
    .filter((f) => f.score < 0.6)
    .map((f) => f.label);

  if (hardFailFactors.length > 0) {
    return {
      crop_id: cropName,
      overall_score: 0,
      level: 'unsuitable',
      badge: 'red',
      factors: allFactors,
      limiting_factors: limitingFactors.length > 0 ? limitingFactors : ['Critical climate mismatch'],
      hard_fail: true,
      fail_reason: `Hard constraint failed: ${hardFailFactors.map((f) => f.label).join(', ')}`,
    };
  }

  // Weighted average of all factor scores
  const weights: Record<string, number> = {
    temp_mean: 0.18,
    temp_cold: 0.14,
    temp_hot: 0.09,
    precip_annual: 0.18,
    drought_stress: 0.07,
    soil_ph: 0.09,
    growing_season: 0.11,
    elevation: 0.04,
    region: 0.10, // Geographic range matching
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const f of allFactors) {
    const w = weights[f.factor] || 1.0 / allFactors.length;
    weightedSum += f.score * w;
    totalWeight += w;
  }

  let overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Apply tolerance bonus
  overallScore = Math.min(1.0, overallScore + computeToleranceBonus(params, climate));

  const { level, badge } = getLevelAndBadge(overallScore);

  return {
    crop_id: cropName,
    overall_score: overallScore,
    level,
    badge,
    factors: allFactors,
    limiting_factors: limitingFactors.length > 0 ? limitingFactors : ['None significant'],
    hard_fail: false,
  };
}

/**
 * Batch score all crops against a land profile.
 * Now includes crop regions for geographic suitability.
 */
export function scoreAllCrops(
  crops: { id: string; common_names: Record<string, string>; suitability_params: SuitabilityParams; regions?: string[] }[],
  profile: LandProfile
): SuitabilityResult[] {
  return crops
    .map((crop) => scoreCrop(crop.id, crop.suitability_params, profile, crop.regions))
    .sort((a, b) => b.overall_score - a.overall_score);
}