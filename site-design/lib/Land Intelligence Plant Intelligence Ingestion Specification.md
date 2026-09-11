# Land Intelligence — Plant Intelligence Ingestion Specification

## 1. Objective

Build a machine-readable plant intelligence database for Land Intelligence that can recommend plants for specific locations within a 3D land/property model.

The system must combine:

1. Plant taxonomy
2. Plant environmental requirements
3. Plant functional traits
4. Plant morphology
5. Plant phenology
6. Geographic occurrence data
7. Climate requirements
8. Soil requirements
9. Solar/light requirements
10. Water/moisture requirements
11. Ecological status and uses

The resulting dataset must support queries of the form:

> Given the environmental conditions at location X on property Y, rank the plants that are suitable for planting there.

The system must preserve **source provenance for every imported value**.

---

# 2. Primary data sources

Implement ingestion adapters for these sources.

## 2.1 FAO ECOCROP

Purpose:

- environmental requirements
- temperature limits
- precipitation
- light
- photoperiod
- soil
- pH
- altitude
- latitude
- climate characteristics

Preferred acquisition:

1. Obtain official downloadable/API data where available.
2. If no machine-readable endpoint exists for a required field, implement a controlled scraper.
3. Store the original source record before normalization.

Important fields to capture:

```text
crop/species name
scientific name
minimum temperature
maximum temperature
optimal temperature
minimum precipitation
maximum precipitation
minimum altitude
maximum altitude
minimum latitude
maximum latitude
light intensity
photoperiod
soil pH
soil depth
soil texture
soil fertility
soil drainage
salinity tolerance
climate zone
life cycle
growth form
```

---

# 3.2 USDA PLANTS

Purpose:

North American plant characteristics and ecological requirements.

Acquire the official downloadable datasets wherever possible rather than scraping individual HTML pages.

Capture:

```text
symbol
scientific name
common names
family
genus
species
duration
growth habit
native status
federal status
state status
active growth period
growth rate
mature height
mature spread
drought tolerance
moisture use
anaerobic tolerance
shade tolerance
temperature minimum
precipitation minimum
precipitation maximum
root depth
soil drainage
soil texture
soil pH
fire resistance
salinity tolerance
```

Also ingest distribution/state-level information where available.

---

# 3.3 TRY Plant Trait Database

Purpose:

Global plant functional traits.

Use the official TRY data-access mechanism and comply with its access and redistribution conditions.

Do not build the architecture around HTML scraping.

Import:

```text
taxon
trait
trait value
unit
measurement method
sampling location
sampling date
source publication
dataset
observation count
```

Prioritize these trait classes:

### Morphology

```text
plant height
stem diameter
leaf area
crown dimensions where available
wood density
growth form
```

### Leaf traits

```text
specific leaf area
leaf area
leaf dry matter content
leaf nitrogen
leaf phosphorus
leaf thickness
leaf mass
```

### Physiology

```text
photosynthetic pathway
photosynthetic traits
stomatal traits
water-use traits
```

### Phenology

```text
leaf emergence
leafing
flowering
fruiting
senescence
dormancy
```

### Root traits

```text
root depth
root diameter
root biomass
root density
root traits
```

Do not discard observations because they differ.

Store the observations and derive aggregate values separately.

---

# 3.4 GBIF

Purpose:

Taxonomic backbone and empirical geographic distribution.

Use GBIF APIs and bulk downloads rather than scraping GBIF pages.

Acquire:

```text
species
synonyms
taxonomic hierarchy
accepted name
taxon key
scientific name
canonical name
rank
kingdom
phylum
class
order
family
genus
species
```

Then acquire occurrence records for plants.

Prioritize:

```text
species
latitude
longitude
country
state/province
elevation
year
basis of record
dataset
institution
occurrence status
```

Do not initially ingest every GBIF occurrence globally.

Build a configurable occurrence-ingestion system capable of:

```text
species → occurrence query → normalized occurrence records
```

Start with species relevant to the geographic markets served by Land Intelligence.

---

# 4. Canonical taxonomy model

All plant records must resolve to a canonical taxonomic identity.

Create:

```sql
plant_taxon
```

Fields:

```text
id
gbif_taxon_key
scientific_name
canonical_name
accepted_name
rank
kingdom
phylum
class
order
family
genus
species
subspecies
variety
cultivar
taxonomic_status
created_at
updated_at
```

Create:

```sql
plant_synonym
```

Fields:

```text
id
taxon_id
synonym
source
source_record_id
```

Every source record should retain its original taxonomic name.

Never overwrite the source name with the normalized name.

---

# 5. Raw ingestion layer

Create a raw source schema.

Example:

```text
raw_ecocrop
raw_usda_plants
raw_try
raw_gbif
```

Every raw record should contain:

```text
id
source
source_record_id
retrieved_at
source_url
raw_payload
checksum
```

`raw_payload` should preserve the original JSON/CSV/XML/HTML-derived record.

The raw layer is immutable.

If a source changes, create a new ingestion version.

---

# 6. Normalized plant requirements

Create:

```sql
plant_requirement
```

Structure:

```text
id
taxon_id
requirement_type
variable
minimum_value
optimal_minimum
optimal_maximum
maximum_value
unit
qualitative_value
source_id
confidence
observation_count
method
```

Examples:

```text
temperature / minimum / -30 / °C
temperature / optimal_minimum / 15 / °C
temperature / optimal_maximum / 25 / °C
temperature / maximum / 35 / °C

precipitation / minimum / 500 / mm/year
precipitation / maximum / 1200 / mm/year

soil_ph / minimum / 5.5
soil_ph / maximum / 7.0

shade_tolerance / qualitative / intermediate
```

Do not force categorical data into numerical values prematurely.

---

# 7. Canonical environmental schema

Create structured tables rather than putting everything into one JSON blob.

## plant_climate

```text
taxon_id
temp_min_c
temp_opt_min_c
temp_opt_max_c
temp_max_c
precip_min_mm
precip_max_mm
gdd_min
gdd_opt
frost_free_days_min
altitude_min_m
altitude_max_m
latitude_min
latitude_max
hardiness_zone_min
hardiness_zone_max
```

## plant_solar

```text
taxon_id
shade_tolerance
light_requirement
light_min
light_opt_min
light_opt_max
light_max
photoperiod_min
photoperiod_max
photosynthetic_pathway
```

## plant_soil

```text
taxon_id
ph_min
ph_max
soil_depth_min_cm
drainage_requirement
texture_preferences
fertility_requirement
salinity_tolerance
anaerobic_tolerance
```

## plant_water

```text
taxon_id
moisture_requirement
drought_tolerance
flood_tolerance
waterlogging_tolerance
```

---

# 8. Plant morphology

Create:

```sql
plant_morphology
```

Fields:

```text
taxon_id
growth_form
mature_height_min_m
mature_height_max_m
mature_width_min_m
mature_width_max_m
growth_rate
root_depth_min_m
root_depth_max_m
root_spread_min_m
root_spread_max_m
canopy_density
evergreen
deciduous
woody
```

Where only categorical information exists, retain the categorical value.

Do not invent numerical estimates.

---

# 9. Phenology

Create:

```sql
plant_phenology
```

Fields:

```text
taxon_id
leaf_out_start_day
leaf_out_end_day
flowering_start_day
flowering_end_day
fruiting_start_day
fruiting_end_day
senescence_start_day
senescence_end_day
dormancy_start_day
dormancy_end_day
```

Support uncertainty:

```text
value
minimum
maximum
source
confidence
```

Phenology must ultimately be capable of being mapped onto a day-of-year model.

---

# 10. Ecological and land-use attributes

Create:

```sql
plant_ecology
```

Fields:

```text
taxon_id
native_regions
habitat
wetland_status
invasive_status
invasive_regions
conservation_status
fire_adapted
erosion_control
pollinator_value
wildlife_value
nitrogen_fixing
```

Create:

```sql
plant_use
```

Fields:

```text
taxon_id
edible
fruit
nut
medicinal
ornamental
shade_tree
windbreak
hedge
screening
timber
erosion_control
pollinator
wildlife
agroforestry
```

Values should be:

```text
true
false
unknown
```

Do not infer `false` merely because a source doesn't mention a use.

---

# 11. Empirical occurrence layer

Create:

```sql
plant_occurrence
```

Fields:

```text
id
taxon_id
latitude
longitude
elevation_m
country
admin1
year
basis_of_record
dataset
institution
source_record_id
geometry
```

Use PostGIS geometry.

Create spatial indexes.

---

# 12. Source provenance

Every normalized value must be traceable to a source.

Create:

```sql
plant_data_source
```

Fields:

```text
id
source_name
source_version
source_url
retrieved_at
license
citation
```

Create:

```sql
plant_value_provenance
```

Fields:

```text
id
taxon_id
table_name
field_name
value
unit
source_id
source_record_id
confidence
retrieved_at
```

Example:

```text
Apple
temperature_min
-30°C
USDA PLANTS
record ABC123
high
```

If ECOCROP says -25°C and USDA says -30°C, retain both.

---

# 13. Derived values

Never overwrite source values with derived values.

Create a separate derived layer:

```sql
plant_derived_traits
```

Examples:

```text
climate_envelope_min
climate_envelope_max
solar_envelope
water_envelope
soil_envelope
empirical_occurrence_envelope
recommended_hardiness
```

Every derived value must contain:

```text
method
version
input_sources
confidence
created_at
```

---

# 14. Property/site environmental model

The plant database is only half of the system.

Land Intelligence should generate a standardized environmental profile for every potential planting location.

Create:

```sql
site_environment
```

Fields:

```text
property_id
geometry
elevation_m
slope_degrees
aspect_degrees

annual_solar_kwh_m2
growing_season_solar_kwh_m2

spring_solar_kwh_m2
summer_solar_kwh_m2
fall_solar_kwh_m2
winter_solar_kwh_m2

morning_solar
afternoon_solar

annual_precipitation_mm
temperature_min_c
temperature_max_c
growing_degree_days
frost_free_days

soil_ph
soil_texture
soil_depth_cm
soil_drainage
soil_moisture

available_rooting_depth_cm
```

This table becomes the interface between the property model and the plant model.

---

# 15. Solar calculation

The 3D engine should calculate solar exposure rather than relying exclusively on plant database categories.

For each planting cell:

```text
ray tracing / solar simulation
        ↓
terrain obstruction
building obstruction
tree obstruction
        ↓
direct radiation
diffuse radiation
        ↓
monthly radiation
daily radiation
annual radiation
```

Store the resulting raster or spatial tiles.

Do not store only a single "sun/shade" classification.

The raw radiation data should remain available.

---

# 16. Suitability engine

Implement the first version as a transparent weighted scoring model.

For plant P and location L:

```text
suitability =
    climate_score
    × solar_score
    × soil_score
    × water_score
    × space_score
    × ecological_score
```

Before scoring, apply hard constraints.

## Hard constraints

Reject if:

```text
minimum temperature is below plant tolerance

OR

maximum temperature exceeds plant tolerance

OR

soil pH is outside absolute tolerance

OR

rooting depth is insufficient

OR

known invasive restriction applies

OR

plant is incompatible with site conditions
```

If a requirement is unknown, do not automatically reject.

Mark it as:

```text
unknown
```

and reduce confidence rather than suitability unless evidence establishes incompatibility.

---

# 17. Solar scoring

Convert plant solar requirements into a normalized range.

For example:

```text
plant_light_min
plant_light_optimal_min
plant_light_optimal_max
plant_light_max
```

Compare:

```text
site_solar
```

against that envelope.

Return:

```text
solar_score
```

between 0 and 1.

Also calculate:

```text
solar_confidence
```

based on how well the plant's light requirements are documented.

---

# 18. Climate scoring

Calculate:

```text
temperature_score
precipitation_score
growing_season_score
frost_score
elevation_score
```

Then:

```text
climate_score =
weighted average of available climate components
```

Weights must be configurable.

---

# 19. Soil scoring

Calculate:

```text
ph_score
texture_score
drainage_score
depth_score
fertility_score
salinity_score
```

Again, only score dimensions for which data exists.

---

# 20. Space scoring

This is particularly important in the 3D model.

Compare:

```text
available horizontal space
available vertical space
rooting volume
distance to structures
distance to utilities
distance to property boundaries
distance to roads
distance to other vegetation
```

against:

```text
mature_height
mature_width
root_spread
```

This allows Land Intelligence to distinguish:

> biologically suitable

from:

> actually appropriate for this location.

---

# 21. Recommendation API

Expose:

```http
GET /api/plants/recommend
```

Parameters:

```text
property_id
latitude
longitude
radius
purpose
max_results
```

Example:

```text
/api/plants/recommend?
property_id=123
latitude=53.52
longitude=-113.49
purpose=shade_tree
max_results=20
```

Return:

```json
{
  "location": {},
  "recommendations": [
    {
      "taxon_id": "...",
      "scientific_name": "...",
      "common_name": "...",
      "suitability": 0.94,
      "confidence": 0.87,
      "scores": {
        "climate": 0.96,
        "solar": 0.93,
        "soil": 0.91,
        "water": 0.95,
        "space": 0.94
      },
      "constraints": [],
      "reasons": [
        "Excellent solar exposure",
        "Compatible soil pH",
        "Adequate rooting depth"
      ]
    }
  ]
}
```

---

# 22. Reverse recommendation

Also implement:

```http
GET /api/sites/{site_id}/plants
```

This should answer:

> What can I plant here?

The interface should support filters:

```text
food
fruit
nut
shade
privacy
windbreak
pollinator
native
low-maintenance
ornamental
erosion-control
wildlife
```

---

# 23. Forward simulation

Eventually support:

```http
POST /api/property/simulate-planting
```

Input:

```text
plant
location
quantity
spacing
```

The simulation should:

1. Add mature plant geometry.
2. Recalculate shadow geometry.
3. Recalculate solar exposure.
4. Recalculate affected planting cells.
5. Re-run suitability.
6. Report affected plants/areas.

Example output:

```text
Planting 3 mature spruce trees here:

Garden solar reduction:
- morning: 8%
- afternoon: 31%
- annual: 19%

Affected planting opportunities:
- vegetables: -12%
- apple: -18%
- blueberry: +2%
```

This is a later-stage feature but the database architecture should support it.

---

# 24. Ingestion pipeline

Implement ingestion as repeatable jobs:

```text
SOURCE
  ↓
DOWNLOAD
  ↓
RAW STORAGE
  ↓
VALIDATION
  ↓
TAXONOMIC RESOLUTION
  ↓
NORMALIZATION
  ↓
UNIT NORMALIZATION
  ↓
PROVENANCE
  ↓
CANONICAL DATABASE
  ↓
DERIVED TRAITS
  ↓
SEARCH INDEX
```

Every ingestion job must be idempotent.

Running the same source twice must not create duplicate canonical records.

---

# 25. Unit normalization

Use SI units internally.

Normalize:

```text
temperature → °C
precipitation → mm/year
height → m
width → m
root depth → m
elevation → m
solar radiation → kWh/m²
soil pH → dimensionless
```

Preserve original values and units in the raw layer.

---

# 26. Confidence system

Every plant attribute should have a confidence score.

Suggested levels:

```text
0.95–1.00 = multiple authoritative sources agree
0.85–0.94 = single authoritative quantitative source
0.70–0.84 = reliable secondary/trait evidence
0.50–0.69 = inferred/derived
<0.50      = weak evidence
```

Do not present confidence as scientific certainty.

It represents **data confidence**, not biological certainty.

---

# 27. Taxonomic matching

Taxonomic resolution is a critical component.

Implement:

```text
source scientific name
        ↓
name normalization
        ↓
GBIF matching
        ↓
accepted taxon
        ↓
canonical taxon_id
```

Store:

```text
match_method
match_confidence
original_name
accepted_name
```

Never silently discard unmatched species.

Create an:

```text
taxonomic_unresolved
```

queue for manual review.

---

# 28. Initial implementation priority

Do NOT attempt to ingest every possible trait initially.

Build the MVP around the fields required for useful spatial recommendation.

### Phase 1

Ingest:

1. USDA PLANTS
2. ECOCROP
3. GBIF taxonomy
4. GBIF occurrences

Core fields:

```text
taxonomy
temperature
precipitation
light/shade
soil pH
soil texture
soil moisture
drainage
drought tolerance
mature height
mature spread
root depth
growth form
native status
invasive status
```

This is enough to build the first recommendation engine.

### Phase 2

Add:

5. TRY
6. phenology
7. functional traits
8. more detailed ecological traits

### Phase 3

Add:

9. cultivar-level information
10. local nursery availability
11. regional planting recommendations
12. user/property observations

---

# 29. Database architecture

Recommended stack:

```text
PostgreSQL
     +
PostGIS
     +
object storage
     +
Python ingestion workers
     +
FastAPI
     +
vector/search index
```

Use PostgreSQL/PostGIS for:

```text
taxonomy
traits
requirements
provenance
occurrences
property/environment relationships
spatial queries
```

Use object storage for:

```text
raw source files
raw JSON
CSV downloads
large occurrence datasets
solar rasters
3D-derived environmental rasters
```

---

# 30. Directory structure

```text
plant-intelligence/
│
├── ingestion/
│   ├── ecocrop/
│   ├── usda_plants/
│   ├── try/
│   └── gbif/
│
├── taxonomy/
│   ├── resolver.py
│   └── synonyms.py
│
├── normalization/
│   ├── climate.py
│   ├── soil.py
│   ├── solar.py
│   ├── morphology.py
│   └── phenology.py
│
├── suitability/
│   ├── climate.py
│   ├── solar.py
│   ├── soil.py
│   ├── water.py
│   ├── space.py
│   └── scorer.py
│
├── spatial/
│   ├── occurrences.py
│   ├── solar.py
│   └── site_environment.py
│
├── api/
│   └── recommendations.py
│
└── tests/
```

---

# 31. Critical design principle

The plant database and 3D land model must remain separate systems connected through a common environmental schema.

```text
             PLANT INTELLIGENCE
                    │
                    │
                    ▼
          plant requirements
                    │
                    │
                    ▼
          ┌─────────────────┐
          │ SUITABILITY API │
          └─────────────────┘
                    ▲
                    │
                    │
          site environmental
               conditions
                    ▲
                    │
             3D LAND MODEL
```

This allows Land Intelligence to improve either side independently.

The plant database can become much richer without changing the 3D engine.

The 3D engine can become more sophisticated without changing the plant records.

---

# 32. First deliverable

The coding agent's first milestone should be:

### "Plant Intelligence MVP"

It should produce:

1. PostgreSQL/PostGIS schema
2. ECOCROP ingestion adapter
3. USDA PLANTS ingestion adapter
4. GBIF taxonomy resolver
5. GBIF occurrence ingestion
6. canonical plant table
7. plant climate table
8. plant solar table
9. plant soil table
10. plant morphology table
11. provenance tables
12. normalized units
13. taxonomic reconciliation
14. basic suitability scoring
15. `/api/plants/recommend` endpoint
16. test dataset containing at least 500 resolved species
17. documentation describing every field and source

The MVP should be able to take:

```text
latitude
longitude
elevation
solar exposure
temperature
precipitation
soil pH
soil texture
soil moisture
available rooting depth
available space
```

and return:

```text
Top 20 suitable plants
+
suitability score
+
confidence
+
individual component scores
+
reasons
+
hard constraints
+
source provenance
```

This is the minimum useful bridge between the **Land Intelligence 3D model** and the plant knowledge base.