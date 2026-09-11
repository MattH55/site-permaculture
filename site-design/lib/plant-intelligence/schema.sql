-- Plant Intelligence MVP schema (PostgreSQL / PostGIS).
-- Runtime today is a JSON canonical store (data/plant-intelligence/canonical.json)
-- with the same fields. Apply this when a Postgres is provisioned.

CREATE TABLE IF NOT EXISTS plant_taxon (
  id TEXT PRIMARY KEY,
  gbif_taxon_key BIGINT,
  scientific_name TEXT NOT NULL,
  canonical_name TEXT,
  accepted_name TEXT,
  scientific_name_source TEXT,
  rank TEXT,
  kingdom TEXT,
  phylum TEXT,
  class TEXT,
  order_name TEXT,
  family TEXT,
  genus TEXT,
  species TEXT,
  subspecies TEXT,
  variety TEXT,
  cultivar TEXT,
  taxonomic_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plant_synonym (
  id SERIAL PRIMARY KEY,
  taxon_id TEXT REFERENCES plant_taxon(id),
  synonym TEXT NOT NULL,
  source TEXT,
  source_record_id TEXT
);

CREATE TABLE IF NOT EXISTS plant_data_source (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_version TEXT,
  source_url TEXT,
  retrieved_at TIMESTAMPTZ,
  license TEXT,
  citation TEXT
);

CREATE TABLE IF NOT EXISTS raw_source_record (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_record_id TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  source_url TEXT,
  raw_payload JSONB NOT NULL,
  checksum TEXT NOT NULL,
  UNIQUE (source, source_record_id, checksum)
);

CREATE TABLE IF NOT EXISTS plant_climate (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  temp_min_c DOUBLE PRECISION,
  temp_opt_min_c DOUBLE PRECISION,
  temp_opt_max_c DOUBLE PRECISION,
  temp_max_c DOUBLE PRECISION,
  precip_min_mm DOUBLE PRECISION,
  precip_max_mm DOUBLE PRECISION,
  gdd_min DOUBLE PRECISION,
  gdd_opt DOUBLE PRECISION,
  frost_free_days_min INTEGER,
  altitude_min_m DOUBLE PRECISION,
  altitude_max_m DOUBLE PRECISION,
  latitude_min DOUBLE PRECISION,
  latitude_max DOUBLE PRECISION,
  hardiness_zone_min TEXT,
  hardiness_zone_max TEXT
);

CREATE TABLE IF NOT EXISTS plant_solar (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  shade_tolerance TEXT,
  light_requirement TEXT,
  light_min TEXT,
  light_opt_min TEXT,
  light_opt_max TEXT,
  light_max TEXT,
  photoperiod_min TEXT,
  photoperiod_max TEXT,
  photosynthetic_pathway TEXT
);

CREATE TABLE IF NOT EXISTS plant_soil (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  ph_min DOUBLE PRECISION,
  ph_max DOUBLE PRECISION,
  soil_depth_min_cm DOUBLE PRECISION,
  drainage_requirement TEXT,
  texture_preferences TEXT[],
  fertility_requirement TEXT,
  salinity_tolerance TEXT,
  anaerobic_tolerance TEXT
);

CREATE TABLE IF NOT EXISTS plant_water (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  moisture_requirement TEXT,
  drought_tolerance TEXT,
  flood_tolerance TEXT,
  waterlogging_tolerance TEXT
);

CREATE TABLE IF NOT EXISTS plant_morphology (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  growth_form TEXT,
  mature_height_min_m DOUBLE PRECISION,
  mature_height_max_m DOUBLE PRECISION,
  mature_width_min_m DOUBLE PRECISION,
  mature_width_max_m DOUBLE PRECISION,
  growth_rate TEXT,
  root_depth_min_m DOUBLE PRECISION,
  root_depth_max_m DOUBLE PRECISION,
  evergreen BOOLEAN,
  deciduous BOOLEAN,
  woody BOOLEAN
);

CREATE TABLE IF NOT EXISTS plant_phenology (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  leaf_out_start_day INTEGER,
  flowering_start_day INTEGER,
  fruiting_start_day INTEGER,
  senescence_start_day INTEGER,
  dormancy_start_day INTEGER
);

CREATE TABLE IF NOT EXISTS plant_ecology (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  native_regions TEXT[],
  habitat TEXT,
  wetland_status TEXT,
  invasive_status TEXT,
  invasive_regions TEXT[],
  conservation_status TEXT,
  fire_adapted BOOLEAN,
  nitrogen_fixing BOOLEAN
);

CREATE TABLE IF NOT EXISTS plant_use (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  edible TEXT,
  fruit TEXT,
  nut TEXT,
  medicinal TEXT,
  ornamental TEXT,
  shade_tree TEXT,
  windbreak TEXT,
  timber TEXT,
  pollinator TEXT,
  wildlife TEXT,
  agroforestry TEXT
);

CREATE TABLE IF NOT EXISTS plant_value_provenance (
  id SERIAL PRIMARY KEY,
  taxon_id TEXT REFERENCES plant_taxon(id),
  table_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  source_id TEXT REFERENCES plant_data_source(id),
  source_record_id TEXT,
  confidence DOUBLE PRECISION,
  retrieved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS plant_occurrence (
  id SERIAL PRIMARY KEY,
  taxon_id TEXT REFERENCES plant_taxon(id),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  elevation_m DOUBLE PRECISION,
  country TEXT,
  admin1 TEXT,
  year INTEGER,
  basis_of_record TEXT,
  dataset TEXT,
  institution TEXT,
  source_record_id TEXT
);
-- SELECT AddGeometryColumn('plant_occurrence','geometry',4326,'POINT',2);

CREATE TABLE IF NOT EXISTS plant_derived_traits (
  taxon_id TEXT PRIMARY KEY REFERENCES plant_taxon(id),
  climate_envelope_min JSONB,
  climate_envelope_max JSONB,
  method TEXT,
  version TEXT,
  input_sources TEXT[],
  confidence DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_environment (
  property_id TEXT,
  geometry TEXT,
  elevation_m DOUBLE PRECISION,
  slope_degrees DOUBLE PRECISION,
  aspect_degrees DOUBLE PRECISION,
  annual_solar_kwh_m2 DOUBLE PRECISION,
  growing_season_solar_kwh_m2 DOUBLE PRECISION,
  annual_precipitation_mm DOUBLE PRECISION,
  temperature_min_c DOUBLE PRECISION,
  temperature_max_c DOUBLE PRECISION,
  growing_degree_days DOUBLE PRECISION,
  frost_free_days INTEGER,
  soil_ph DOUBLE PRECISION,
  soil_texture TEXT,
  soil_depth_cm DOUBLE PRECISION,
  soil_drainage TEXT,
  soil_moisture TEXT,
  available_rooting_depth_cm DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS taxonomic_unresolved (
  id SERIAL PRIMARY KEY,
  original_name TEXT,
  source TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor (
  vendor_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT,
  home_url TEXT
);

CREATE TABLE IF NOT EXISTS vendor_location (
  vendor_id TEXT REFERENCES vendor(vendor_id),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  municipality TEXT,
  province TEXT,
  postal_code TEXT,
  delivery_radius_km DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS plant_product (
  id TEXT PRIMARY KEY,
  taxon_id TEXT,
  vendor_id TEXT,
  product_name TEXT,
  scientific_name TEXT,
  cultivar TEXT,
  container_size TEXT,
  price_cad DOUBLE PRECISION,
  price_unit TEXT,
  price_class TEXT,
  observed_at DATE,
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS plant_price_observation (
  id SERIAL PRIMARY KEY,
  plant_product_id TEXT,
  price_cad DOUBLE PRECISION,
  price_unit TEXT,
  vendor_id TEXT,
  observed_at DATE,
  source_url TEXT,
  source_type TEXT,
  confidence DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS plant_establishment_cost (
  taxon_id TEXT,
  plant_material_cost DOUBLE PRECISION,
  delivery_cost DOUBLE PRECISION,
  excavation_cost DOUBLE PRECISION,
  planting_labor_cost DOUBLE PRECISION,
  total_initial_cost DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS plant_economic_profile (
  taxon_id TEXT,
  yield_per_plant DOUBLE PRECISION,
  market_price_cad_per_kg DOUBLE PRECISION,
  productive_lifespan_years INTEGER,
  source TEXT,
  region TEXT,
  production_system TEXT,
  confidence DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS plant_utility_value (
  taxon_id TEXT PRIMARY KEY,
  shade_value DOUBLE PRECISION,
  privacy_value DOUBLE PRECISION,
  windbreak_value DOUBLE PRECISION,
  pollinator_value DOUBLE PRECISION,
  wildlife_value DOUBLE PRECISION,
  food_value DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS land_scenario (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
