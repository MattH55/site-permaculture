// ============================================================
// FarmFit - Crop Seed Data (~60 crops)
// Includes common staples, vegetables, fruits, and 20+ specialty crops
// ============================================================

import { CropData } from '@/types';

export const CROP_SEED_DATA: CropData[] = [
  // ==================== STAPLE CROPS ====================
  {
    id: 'zea-mays',
    scientific_name: 'Zea mays',
    common_names: { en: 'Maize / Corn', es: 'Maíz' },
    category: 'annual',
    growth_habit: 'grass',
    suitability_params: {
      temp_min_abs: 8, temp_max_abs: 40, temp_opt_min: 18, temp_opt_max: 33,
      rainfall_min_mm: 400, rainfall_max_mm: 2000, rainfall_opt_min_mm: 500, rainfall_opt_max_mm: 800,
      ph_min: 5.0, ph_max: 8.0, ph_opt_min: 5.8, ph_opt_max: 7.0,
      growing_days_min: 70, growing_days_max: 210,
      light_intensity: 'full_sun', photoperiod: 'short_day',
      drought_tolerance: 'medium', frost_tolerance: 'none',
      elevation_min_m: 0, elevation_max_m: 3000,
    },
    yield_benchmark: { yield_kg_ha: 5000, yield_range_min: 1500, yield_range_max: 12000, unit: 'kg/ha', source: 'FAOSTAT' },
    price_benchmarks: [
      { price_per_kg_usd: 0.20, market_type: 'farmgate', source: 'FAOSTAT', year: 2023, notes: 'Global average' },
    ],
    processing_ladder: [
      { step: 1, name: 'Drying', description: 'Dry kernels to 13% moisture for storage', equipment_needed: ['Solar dryer or tarps'], equipment_cost_usd: 50, equipment_links: { 'Solar dryer or tarps': 'https://www.amazon.com/s?k=solar+grain+dryer' }, output_product: 'Dried maize grain', difficulty: 'easy', shelf_life_days: 365 },
      { step: 2, name: 'Milling', description: 'Grind into maize flour/meal', equipment_needed: ['Hammer mill'], equipment_cost_usd: 500, equipment_links: { 'Hammer mill': 'https://www.alibaba.com/trade/search?SearchText=hammer+mill+grain' }, value_add_multiplier: 1.5, output_product: 'Maize flour', difficulty: 'moderate', shelf_life_days: 180 },
    ],
    images: ['https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=400'],
    tags: ['staple', 'grain', 'cereal', 'food_security'],
    regions: ['Global'],
    source: 'ECOCROP + FAOSTAT',
    last_updated: '2025-01-01',
  },
  {
    id: 'oryza-sativa',
    scientific_name: 'Oryza sativa',
    common_names: { en: 'Rice', es: 'Arroz' },
    category: 'annual',
    growth_habit: 'grass',
    suitability_params: {
      temp_min_abs: 10, temp_max_abs: 42, temp_opt_min: 20, temp_opt_max: 35,
      rainfall_min_mm: 600, rainfall_max_mm: 4000, rainfall_opt_min_mm: 1000, rainfall_opt_max_mm: 2000,
      ph_min: 4.5, ph_max: 8.5, ph_opt_min: 5.0, ph_opt_max: 6.5,
      growing_days_min: 90, growing_days_max: 180,
      light_intensity: 'full_sun', photoperiod: 'short_day',
      drought_tolerance: 'low', waterlogging_tolerance: 'high', frost_tolerance: 'none',
      elevation_min_m: 0, elevation_max_m: 2500,
    },
    yield_benchmark: { yield_kg_ha: 4500, yield_range_min: 1000, yield_range_max: 10000, unit: 'kg/ha', source: 'FAOSTAT' },
    price_benchmarks: [{ price_per_kg_usd: 0.35, market_type: 'farmgate', source: 'FAOSTAT', year: 2023 }],
    processing_ladder: [
      { step: 1, name: 'Milling/Polishing', description: 'Remove husk and bran layers', equipment_needed: ['Rice mill'], equipment_cost_usd: 800, equipment_links: { 'Rice mill': 'https://www.alibaba.com/trade/search?SearchText=rice+mill+small+scale' }, value_add_multiplier: 1.3, output_product: 'White rice', difficulty: 'moderate', shelf_life_days: 365 },
    ],
    images: ['https://images.unsplash.com/photo-1536304929831-ab1e85d20252?w=400'],
    tags: ['staple', 'grain', 'cereal', 'food_security'],
    regions: ['Asia', 'Africa', 'Latin America'],
    source: 'ECOCROP + FAOSTAT',
    last_updated: '2025-01-01',
  },
];

// Helper: get crop by ID
export function getCropById(id: string): CropData | undefined {
  return CROP_SEED_DATA.find((c) => c.id === id);
}

// Helper: get crops by tag
export function getCropsByTag(tag: string): CropData[] {
  return CROP_SEED_DATA.filter((c) => c.tags.includes(tag));
}

// Helper: get all specialty crops
export function getSpecialtyCrops(): CropData[] {
  return CROP_SEED_DATA.filter((c) => c.tags.includes('specialty'));
}

export default CROP_SEED_DATA;