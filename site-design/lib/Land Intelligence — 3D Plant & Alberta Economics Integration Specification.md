# Land Intelligence — 3D Plant & Alberta Economics Integration

## 1. Product objective

Build a spatial plant intelligence and land-economics system inside Land Intelligence.

For any location on a 3D property model, the system should be able to answer:

> What plants are biologically suitable here?

> What will they cost to establish?

> What value could they produce?

> Which options provide the best combination of suitability, cost, utility and economic return?

The system must support both:

### Landscape mode

Examples:

- shade tree
- privacy screen
- windbreak
- ornamental
- native habitat
- pollinator planting
- erosion control
- edible landscape
- low-maintenance planting

### Productive land mode

Examples:

- fruit
- berries
- nuts
- vegetables
- forage
- specialty crops
- agroforestry
- market garden
- greenhouse crops

---

# 2. Overall architecture

```text
                         LAND INTELLIGENCE
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
       3D LAND MODEL       PLANT DATABASE     ALBERTA ECONOMICS
             │                  │                  │
             ▼                  ▼                  ▼
      Site Conditions      Plant Requirements    Prices / Costs
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                    SPATIAL SUITABILITY ENGINE
                                │
                                ▼
                    ECONOMIC EVALUATION ENGINE
                                │
                                ▼
                      RECOMMENDATION ENGINE
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
        3D PLACEMENT       COST / VALUE        LAND PLAN
```

---

# 3. 3D model becomes the site-condition engine

Every potentially plantable location should have an environmental profile.

Create:

```sql
site_environment
```

Fields:

```text
id
property_id
geometry

latitude
longitude
elevation_m

slope_degrees
aspect_degrees

annual_solar_kwh_m2
growing_season_solar_kwh_m2

solar_jan
solar_feb
solar_mar
solar_apr
solar_may
solar_jun
solar_jul
solar_aug
solar_sep
solar_oct
solar_nov
solar_dec

direct_solar
diffuse_solar

morning_solar
afternoon_solar

annual_precipitation_mm
growing_degree_days
frost_free_days

min_temperature_c
max_temperature_c

hardiness_zone_canada
hardiness_zone_usda

soil_ph
soil_texture
soil_depth_cm
soil_drainage
soil_moisture
organic_matter
available_rooting_depth_cm

water_availability
irrigation_available

building_distance_m
road_distance_m
property_boundary_distance_m
utility_distance_m

existing_canopy_cover
existing_tree_density
```

---

# 4. Climate integration for Alberta

Use Alberta's climate infrastructure for local site conditions.

The Alberta Climate Information Service provides meteorological data and maps derived from more than 330 stations. Alberta also provides the Alberta Soil Information Viewer as a decision-support resource for soil information.

Ingest:

```text
ACIS climate
Alberta soil information
Canadian Plant Hardiness Zones
```

The Canadian Plant Hardiness system should be preferred over simply importing a US hardiness zone. NRC describes the Canadian system as integrating multiple climatic conditions, and the site now exposes a 1991–2020 2025 update.

Store both where useful:

```text
canadian_hardiness_zone
usda_hardiness_zone
```

---

# 5. Plant database

Retain the plant intelligence schema defined previously:

```text
plant_taxon
plant_synonym
plant_climate
plant_solar
plant_soil
plant_water
plant_morphology
plant_phenology
plant_ecology
plant_use
plant_occurrence
plant_requirement
plant_value_provenance
```

Core biological inputs:

```text
temperature envelope
precipitation envelope
hardiness
solar requirement
shade tolerance
soil pH
soil texture
drainage
moisture
drought tolerance
root depth
mature height
mature width
growth rate
phenology
native status
invasive status
uses
```

---

# 6. Add a nursery/commercial product layer

The biological species is not the same thing as the product the landowner purchases.

Create:

```sql
plant_product
```

Fields:

```text
id
taxon_id

vendor_id
vendor_name
vendor_location

product_name
scientific_name
cultivar

container_size
container_volume
height_min_cm
height_max_cm

caliper_mm

bare_root
containerized
balled_and_burlapped
plug
seed
cutting

availability_status

price_cad
price_unit

observed_at
effective_date
expiry_date

source_url
source_record_id

currency
tax_included

shipping_cost
delivery_available
delivery_radius_km
```

This allows:

```text
Malus domestica
```

to have multiple commercial products:

```text
Apple 'Goodland'
#5 container
$XX

Apple 'Norkent'
#7 container
$YY

Apple 'September Ruby'
bare root
$ZZ
```

Do not collapse these into one plant record.

---

# 7. Alberta vendor price acquisition

Build a vendor ingestion framework.

Source classes:

```text
Alberta garden centres
Alberta nurseries
Alberta wholesale nurseries
Alberta tree farms
Alberta horticultural suppliers
Alberta seed suppliers
Alberta farm suppliers
```

Prioritize suppliers with:

- online catalogues
- downloadable price lists
- structured product pages
- searchable inventories
- recurring seasonal price lists

For example, Cheyenne Tree Farm in Beaumont publishes a 2026 retail price list, making it a useful initial Alberta price source.

The ingestion system should distinguish:

```text
retail price
wholesale price
contractor price
farm-gate price
```

Never combine them without labeling.

---

# 8. Price observation model

Prices are volatile.

Therefore:

```sql
plant_price_observation
```

Fields:

```text
id
plant_product_id

price_cad
price_unit
size
quantity

vendor_id
location

observed_at
available_from
available_to

source_url
source_type

confidence
```

Every recommendation should use the most recent valid price observation.

Do NOT hard-code today's price into the plant master record.

---

# 9. Price normalization

Normalize commercial products into comparable units.

Example:

```text
$49.95 / #5 container
$89.95 / #10 container
$12.50 / bare-root tree
```

Retain original unit.

Derived fields:

```text
price_per_plant
price_per_cm_height
price_per_caliper_mm
price_per_mature_canopy_m2
price_per_expected_yield
```

The derived values are analytical—not vendor-reported facts.

---

# 10. Establishment-cost model

Plant purchase price is only one component.

Create:

```sql
plant_establishment_cost
```

Fields:

```text
taxon_id

plant_material_cost
soil_amendment_cost
compost_cost
mulch_cost
fertilizer_cost
irrigation_cost
staking_cost
guard_cost

delivery_cost
excavation_cost
planting_labor_cost

initial_water_cost
weed_control_cost

first_year_maintenance_cost
second_year_maintenance_cost
third_year_maintenance_cost

total_initial_cost
```

For residential landscape calculations:

```text
Initial Cost =
plant
+ delivery
+ excavation
+ soil amendment
+ irrigation
+ planting labour
+ staking/protection
```

---

# 11. Alberta agricultural economics

Do not treat retail nursery prices as the complete economic model.

Alberta already maintains agricultural cost/return modelling infrastructure.

Use:

- Cropping Alternatives
- Crop Budget Calculator
- CropChoices
- AgriProfit$

The Alberta Crop Budget Calculator supports value of production, capital costs, marginal returns, break-even yield and break-even price calculations.

Cropping Alternatives incorporates prices, yields, seed, fertilizer, chemical, insurance, trucking/marketing, machinery/storage, operating interest, contribution margin and capital costs.

AgriProfit$ provides annual Alberta farm cost-of-production benchmarking.

Use those datasets as the economic layer for agricultural plants where applicable.

---

# 12. Create agricultural economic profiles

```sql
plant_economic_profile
```

Fields:

```text
taxon_id

yield_per_plant
yield_per_m2
yield_per_ha

yield_start_year
mature_yield_year
productive_lifespan_years

market_price_cad_per_kg
market_price_cad_per_unit

gross_revenue_per_plant
gross_revenue_per_m2
gross_revenue_per_ha

variable_cost_per_plant
variable_cost_per_m2
variable_cost_per_ha

annual_labor_cost
annual_irrigation_cost
annual_fertilizer_cost
annual_protection_cost

annual_maintenance_cost

initial_establishment_cost

gross_margin
net_margin

break_even_price
break_even_yield
```

Every value needs:

```text
source
date
region
production system
confidence
```

---

# 13. Separate three economic concepts

This is critical.

The model must distinguish:

### Cost

What does it cost to put the plant there?

### Utility value

What is the value of what the plant does?

Examples:

```text
shade
privacy
wind protection
erosion control
aesthetic value
habitat
```

### Market return

What revenue can the plant generate?

Examples:

```text
apples
berries
nuts
timber
nursery products
forage
```

Do not combine these into one score prematurely.

---

# 14. Utility value model

Create:

```sql
plant_utility_value
```

Fields:

```text
taxon_id

shade_value
privacy_value
windbreak_value
erosion_control_value
pollinator_value
wildlife_value
aesthetic_value

carbon_value
stormwater_value
soil_improvement_value

food_value
```

Initially store these as qualitative or normalized scores:

```text
0.0–1.0
```

with provenance.

Eventually these can become monetized.

---

# 15. Property economics

Create:

```sql
site_economic_context
```

Fields:

```text
property_id
location
land_value_per_m2
estimated_water_cost
electricity_cost
labor_cost
delivery_cost
soil_amendment_cost
mulch_cost
irrigation_cost
```

This allows two identical plants to have different economics at different locations.

---

# 16. 3D spatial suitability engine

For every plantable cell:

```text
site_environment
        +
plant_requirements
        ↓
biological suitability
```

Calculate:

```text
climate_score
solar_score
soil_score
water_score
space_score
ecological_score
```

Return:

```text
biological_suitability
```

from 0–1.

---

# 17. Economic scoring

For every biologically viable plant calculate:

```text
establishment_cost
annual_maintenance_cost
expected_utility
expected_market_revenue
expected_lifetime_value
```

For productive plants:

```text
NPV
IRR
payback_year
break_even_year
```

For landscape plants, use:

```text
cost_per_unit_utility
```

rather than pretending an ornamental tree has agricultural revenue.

---

# 18. Economic model

For productive plants:

```text
NPV =
- initial_establishment_cost
+
Σ(
    annual_revenue
    - annual_operating_cost
  ) / (1 + discount_rate)^year
```

Allow configurable:

```text
discount_rate
inflation
price_growth
yield_growth
labor_growth
```

Do not present economic projections as forecasts unless explicitly based on forecast data.

Label them:

```text
scenario
estimate
assumption
```

---

# 19. Planting density

The 3D model should calculate how many plants fit.

For each plant:

```text
mature_width
root_spread
required_spacing
```

Generate:

```text
planting_grid
```

subject to:

```text
property boundaries
buildings
roads
utilities
existing vegetation
minimum spacing
maximum density
user constraints
```

Then economic calculations can operate at:

```text
per plant
per m²
per planting bed
per acre
per hectare
per property
```

---

# 20. Example recommendation

Suppose the user clicks a 400 m² sunny area.

The system determines:

```text
Solar:
7.1 equivalent full-sun hours

Soil:
pH 6.5
loam
1.0 m rooting depth

Canadian hardiness:
4b

Available water:
moderate

Area:
400 m²
```

The recommendation engine could return:

```text
1. Apple
Biological suitability: 94%
Establishment cost: $$
Expected productive life: XX years
Expected first harvest: year X
Economic profile: strong
Utility: food + shade

2. Saskatoon berry
Biological suitability: 97%
Establishment cost: $
Expected harvest: year X
Economic profile: strong
Utility: food + wildlife

3. Chokecherry
Biological suitability: 96%
Establishment cost: $
Economic profile: low direct market return
Utility: wildlife + native habitat

4. Spruce
Biological suitability: 91%
Establishment cost: $$$
Economic profile: no direct crop return
Utility: windbreak + privacy
```

The exact numerical values must be calculated from the ingested evidence, not invented.

---

# 21. 3D visualization

Each recommendation should have a corresponding 3D representation.

When selected:

```text
candidate plant
       ↓
mature geometry
       ↓
placement preview
```

Show:

```text
current size
5-year size
10-year size
mature size
```

For trees, display:

```text
trunk
canopy
root-zone radius
shadow
```

For shrubs:

```text
mature footprint
```

For crops:

```text
planting density
bed footprint
expected canopy
```

---

# 22. Dynamic shadow interaction

This should be a central feature.

When a plant is placed:

```text
plant geometry
      ↓
shadow calculation
      ↓
new solar raster
      ↓
neighboring site environments
      ↓
new plant suitability
```

Thus:

> **Planting one tree changes the recommendation map around it.**

The user should be able to toggle:

```text
existing vegetation
planned vegetation
buildings
fences
terrain
```

on/off.

---

# 23. Scenario planner

Create:

```sql
land_scenario
```

Example:

```text
Scenario A:
10 apple trees
20 m berry hedge
3 spruce windbreaks
```

The engine calculates:

```text
total capital cost
annual maintenance
projected revenue
land area used
water demand
solar impact
```

and compares it to:

```text
Scenario B
Scenario C
```

---

# 24. Economics-aware recommendation ranking

Do not rank plants solely by biological suitability.

Provide multiple ranking modes.

### Best biological fit

```text
highest suitability
```

### Lowest establishment cost

```text
lowest initial cost
```

### Best economic return

```text
highest NPV / margin
```

### Best utility per dollar

```text
utility / establishment cost
```

### Best food production

```text
expected production / area
```

### Best low-maintenance solution

```text
utility
÷
maintenance requirement
```

### Best overall

Use configurable weights.

---

# 25. Alberta market geography

Price data must be spatial.

Create:

```sql
vendor_location
```

Fields:

```text
vendor_id
name
latitude
longitude
municipality
province
postal_code
delivery_radius_km
```

The recommendation engine should calculate:

```text
plant_price
+
delivery
```

instead of assuming the nearest listed nursery is free to ship from.

Example:

```text
Plant = $45

Vendor A:
20 km away
pickup
$45 total

Vendor B:
180 km away
$35 plant
$80 delivery

Effective cost:
Vendor A = $45
Vendor B = $115
```

---

# 26. Alberta price acquisition priority

Build the first price dataset from:

```text
Alberta retail nurseries
Alberta tree farms
Alberta wholesale nurseries
Alberta agricultural suppliers
```

Cheyenne Tree Farm should be an initial source because it is an Alberta supplier and currently publishes a 2026 retail price list.

Then expand vendor coverage.

Each scraper/API adapter should output the same canonical format:

```text
vendor
scientific name
common name
cultivar
product size
price
availability
observed_at
source_url
```

---

# 27. Price freshness

Assign each price a freshness score.

Example:

```text
0–30 days       = current
31–90 days      = recent
91–180 days     = stale
181–365 days    = historical
>365 days       = archival
```

Recommendations should prefer current observations.

Never silently represent a historical price as today's price.

---

# 28. Seasonal availability

This is particularly important for Alberta nurseries.

Store:

```text
season_start
season_end
available_months
```

The recommendation engine can then distinguish:

> biologically appropriate

from:

> currently purchasable.

---

# 29. Agricultural revenue source hierarchy

For productive plants, prioritize:

```text
1. Alberta government agricultural economics
2. Alberta producer/commodity benchmarks
3. Canadian government statistics
4. Alberta market prices
5. local farm-gate prices
6. local retail prices
7. secondary market sources
```

Separate:

```text
farm-gate price
wholesale price
consumer retail price
```

because they represent different economic opportunities.

---

# 30. Economic uncertainty

Every economic output should contain:

```text
base case
low case
high case
```

Example:

```text
Apple orchard

Initial cost:
Low       $X
Base      $Y
High      $Z

Annual revenue:
Low       $X
Base      $Y
High      $Z
```

Use ranges rather than false precision.

---

# 31. Final composite recommendation object

The API should return something like:

```json
{
  "plant": {
    "taxon_id": "...",
    "scientific_name": "...",
    "common_name": "...",
    "cultivar": "..."
  },

  "location": {
    "lat": 0,
    "lon": 0,
    "area_m2": 0
  },

  "biological": {
    "suitability": 0.94,
    "climate": 0.97,
    "solar": 0.93,
    "soil": 0.91,
    "water": 0.88,
    "space": 0.98
  },

  "commercial": {
    "plant_price_cad": 0,
    "delivery_cad": 0,
    "establishment_cost_cad": 0,
    "maintenance_cost_annual_cad": 0
  },

  "economic": {
    "yield": null,
    "revenue_annual": null,
    "gross_margin": null,
    "npv": null,
    "payback_year": null
  },

  "utility": {
    "food": 0.9,
    "shade": 0.7,
    "wildlife": 0.8,
    "privacy": 0.2
  },

  "confidence": 0.87,

  "reasons": [
    "Strong solar match",
    "Compatible soil pH",
    "Adequate rooting depth"
  ]
}
```

---

# 32. Database additions

Add these tables to the existing Plant Intelligence schema:

```text
vendor
vendor_location

plant_product
plant_price_observation

plant_establishment_cost
plant_economic_profile
plant_utility_value

site_economic_context
land_scenario
scenario_planting

economic_assumption
economic_observation
```

---

# 33. API additions

Existing:

```http
GET /api/plants/recommend
```

Add:

```http
GET /api/sites/{site_id}/plants
```

```http
GET /api/plants/{taxon_id}/economics
```

```http
GET /api/plants/{taxon_id}/prices
```

```http
GET /api/vendors/nearby
```

```http
POST /api/property/simulate-planting
```

```http
POST /api/property/scenarios
```

```http
GET /api/property/scenarios/{scenario_id}
```

---

# 34. 3D model API

The 3D model should be able to request:

```http
GET /api/site-environment/{property_id}
```

and:

```http
GET /api/site-environment/{property_id}/solar
```

The suitability engine should be able to request a spatial subset:

```http
GET /api/site-environment/{property_id}/cells?
    bounds=...
```

This allows the frontend to paint a suitability heatmap directly onto the 3D terrain.

---

# 35. 3D visualization modes

Add map/model layers:

```text
Solar exposure
Water suitability
Soil suitability
Plant suitability
Native species
Food production
Establishment cost
Annual maintenance
Expected revenue
Economic return
```

Most importantly:

### Plant Suitability Heatmap

```text
RED       unsuitable
ORANGE    marginal
YELLOW    acceptable
GREEN     highly suitable
```

### Economic Opportunity Heatmap

```text
low return
moderate return
high return
```

The user can overlay them.

The intersection becomes:

> **Biologically suitable + economically attractive**

---

# 36. Example user workflow

User opens a property.

### Step 1

3D model calculates:

```text
terrain
solar
shade
soil
water
microclimate
```

### Step 2

User selects:

> Food production

### Step 3

Land Intelligence identifies all suitable planting cells.

### Step 4

Plant database generates candidate species.

### Step 5

Alberta vendor database determines current acquisition costs.

### Step 6

Alberta agricultural economics supplies production assumptions where available.

### Step 7

Engine ranks candidates.

### Step 8

3D model displays:

```text
Apple
████████████ 94%

Saskatoon
███████████  92%

Plum
██████████   86%
```

with:

```text
establishment cost
annual maintenance
estimated production
economic scenario
```

### Step 9

User places selected plants.

### Step 10

The model recalculates:

```text
shadows
solar
water demand
plant competition
future suitability
economics
```

---

# 37. Important separation

The system must maintain these distinct concepts:

```text
BIOLOGICAL SUITABILITY
        ≠
COMMERCIAL AVAILABILITY
        ≠
ECONOMIC RETURN
        ≠
LANDSCAPE VALUE
```

The final recommendation combines them but does not erase their individual scores.

This allows Land Intelligence to say:

> **Excellent biological choice, poor economic choice**

or:

> **Moderate biological choice, exceptional utility per dollar**

or:

> **Excellent crop economics, but unsuitable for this particular location.**

That distinction is fundamental to the product.

---

# 38. MVP implementation sequence

## Phase 1 — Spatial plant matching

Implement:

```text
3D site environment
+
USDA/ECOCROP/GBIF plant intelligence
+
NRC hardiness
+
solar suitability
```

Output:

```text
what can grow where
```

## Phase 2 — Alberta commercial layer

Implement:

```text
Alberta vendors
+
product sizes
+
current prices
+
availability
+
delivery
```

Output:

```text
what can be purchased
and what it costs
```

## Phase 3 — Economics

Implement:

```text
establishment costs
+
maintenance
+
yield
+
market prices
+
Alberta crop budgets
```

Output:

```text
what is economically attractive
```

## Phase 4 — Dynamic 3D simulation

Implement:

```text
plant placement
→ mature geometry
→ shadow
→ changed solar
→ changed suitability
→ changed economics
```

Output:

```text
what happens if I change the land
```

---

# 39. The resulting Land Intelligence product

The final system should allow the user to select a portion of their land and ask:

> **"What should I do with this?"**

Land Intelligence can then reason across:

```text
PHYSICAL
terrain
solar
water
soil
microclimate
space

BIOLOGICAL
plants
growth
ecology
compatibility

COMMERCIAL
availability
nursery
price
delivery

ECONOMIC
establishment
maintenance
yield
revenue
margin
NPV

SPATIAL
placement
density
shadow
competition
future growth
```

The result is not a plant recommender.

It is a **land-use optimization layer for the 3D property model.**