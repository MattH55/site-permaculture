# Permaculture Site Design — Rules & Data Sources (Alberta-first)

Companion to `site-design-schema.json`. This schema is built to share its
`location` / `terrain` / `hydrology` / `soil` / `climate` fields with the
existing EcoCrop-based crop-suitability schema, so a single site record can
drive both "what can grow here" and "what earthworks/structures belong here."

## 1. If→then placement ruleset

These are the rules a generator would apply to a populated site record to
auto-populate the `design_elements` array.

**Value framing (recommendation engine):** Eligibility stays if→then. Each
matched element is then annotated with `primary_value`, `secondary_values`,
and a parcel-specific `value_headline` (water harvest, wind protection, food,
soil building, compliance, etc.) so the Expanding Edge product leads with
client outcomes, not technique jargon. See `lib/recommendation-values.js`.
The API also returns a `recommendations` envelope: `summary_sentence`,
`priority_ordered`, `by_value`, plus Phase 2 `value_counts` (filter chips)
and `related_services` (Expanding Edge CTAs: water/earthworks, shelterbelt,
food forest, kitchen garden, full site design).

| # | Condition (on schema fields) | → Recommended element | Notes |
|---|---|---|---|
| 1 | `slope_percent` 2–15 AND `drainage_class` in {well, moderately_well, imperfect} | `swale` on contour | Standard water-harvesting range; below 2% swales add little, above ~15% berms destabilize |
| 2 | `slope_percent` > 15 | `terrace` instead of swale | Alberta foothill/coulee sites |
| 3 | `keypoint_present` = true | `keyline_cultivation` | Line runs off-contour from keypoint toward ridge |
| 4 | `landform_position` = valley_floor AND `wetland_class` = null AND `flood_risk_zone` = false | `pond` / `water_harvesting_earthwork` | Excludes regulated wetlands (Water Act) and flood hazard zones |
| 5 | `wetland_class` != null | No earthworks; flag `needs_site_visit` | Alberta Water Act approval required for any wetland alteration |
| 6 | `soil.depth_to_bedrock_cm` < 30 OR `cli_agricultural_capability_class` in {5,6,7} | `hugelkultur_mound` or raised bed | Builds soil depth where native soil is shallow/poor |
| 7 | `climate.prevailing_wind_direction` known AND site has open exposure | `windbreak` / `shelterbelt_zone`, placed perpendicular to that direction, upwind of Zone 1–2 | In Alberta this is very often a west/northwest-facing shelterbelt |
| 8 | `climate.chinook_exposure` = true | Prioritize windbreak + avoid early-flowering woody species regardless of listed hardiness zone | Freeze-thaw cycling from chinooks damages plants a hardiness-zone lookup alone wouldn't flag |
| 9 | `existing_vegetation.successional_stage` in {pioneer, early_successional} | `food_forest_guild` deferred; recommend nitrogen-fixer/groundcover cover crop phase first | Sequences soil-building before productive polyculture |
| 10 | `existing_vegetation.successional_stage` in {mid_successional, climax} or cover-crop phase complete | `food_forest_guild` | Layer selection then filtered by `plant_hardiness_zone` / `frost_free_days` against the crop-suitability schema |
| 11 | Small footprint (<0.1 ha) AND high desired diversity | `herb_spiral` or `keyhole_bed` | Zone 1 intensive elements |
| 12 | `erosion_risk` = high | Any earthwork gets `confidence: needs_site_visit`; recommend groundcover stabilization before swale/terrace construction | |

## 2. Alberta-first data sources

Primary (free, official Alberta/Canada sources):

- **Elevation / slope / aspect / keypoints** — Alberta Elevation LiDAR-derived DEM, Alberta Open Government Portal (best resolution where flown); fallback Canadian Digital Elevation Model (CDEM), Natural Resources Canada, for province-wide coverage.
- **Soils** — Agricultural Region of Alberta Soil Inventory Database (AGRASID), Alberta Agriculture and Irrigation — soil series, texture, drainage class, erosion risk.
- **Agricultural capability** — Canada Land Inventory (CLI) soil capability for agriculture, Agriculture and Agri-Food Canada (1–7 class system, still widely used as a coarse suitability filter).
- **Wetlands** — Alberta Merged Wetland Inventory (AMWI), Alberta Environment and Protected Areas — needed to keep pond/swale siting clear of regulated wetlands.
- **Watercourses / watersheds / streamflow** — Alberta River Basins mapping (Alberta Environment and Protected Areas) and HYDAT / Water Survey of Canada (ECCC) for gauged flow data.
- **Flood hazard** — Alberta Flood Hazard Mapping Program.
- **Water wells / groundwater depth** — Alberta Water Well Information Database (existing well logs, public search).
- **Climate normals, frost-free days, precipitation** — ECCC Canadian Climate Normals (1991–2020), by station or gridded product.
- **Plant hardiness** — Natural Resources Canada Plant Hardiness Zones (2014), which also has a "climate change adjusted" projection layer worth including for forward-looking design.
- **Land cover / existing vegetation** — Alberta Biodiversity Monitoring Institute (ABMI) land cover product; AAFC Annual Crop Inventory for cropland history specifically.
- **Legal land description / parcel boundaries** — Alberta Township System (ATS) via Alberta Land Titles / SPIN2, useful as the join key across several of the above provincial datasets, most of which are indexed by ATS or by township/range grid.

Secondary / supplementary:

- **Topographic base mapping** — Natural Resources Canada CanVec / Toporama for general reference layers (roads, hydrography lines) alongside the DEM.
- **Ecodistrict/ecoregion context** — Natural Regions and Subregions of Alberta classification, useful as a coarse sanity check on native vegetation and expected precipitation regime.

## 2c. Land value — assessed / aggregate only (informational panel)

Does **not** feed swale, keyline, guild, or planting scoring.

| Field | Source (phase 1) |
|-------|------------------|
| Urban sample | Calgary Socrata `4bsw-nn7w`; Edmonton `dkk9-cj3x` + `q7d6-ambg` |
| Rural $/acre | Alberta Agriculture CLI × municipality table (2015) + FCC provincial cultivated % trend adjuster |
| Sale prices | **Not available free/bulk** — Alberta Land Titles pay-per-lookup |

Expanding-radius sample: 800 m → 1.5 → 3 → 5 → 10 → 15 km until n ≥ 15 (or cap). Always surface `nearby_land_value_sample_n` and `nearby_land_value_search_radius_m`.

**Phase 1 decision:** rural = CLI aggregate only. County parcel rolls deferred (same fragmentation as zoning).

## 2b. Proximity, amenities, and crime — sources and a caveat

- **Nearest water source** — same Alberta hydrography / Wet Areas Mapping ArcGIS REST endpoints already listed above, queried as a nearest-feature (not intersects) search from the site centroid.
- **Nearest city, with name** — Statistics Canada Population Centres (POPCTR) boundary file for population-based classification, or the Alberta municipal boundary layer (AltaLIS/geodiscover) for named polygons + centroids.
- **Nearest settlement (any size)** — GeoNames Canada or the StatCan Geographic Attribute File, cross-checked against the province's own hamlet lists (Alberta has many unincorporated hamlets inside Specialized and Rural Municipalities that don't show up as "cities" but matter for local supply runs).
- **Amenities** (grocery, hardware, hospital, fuel, school, vet, fire/police) — OpenStreetMap via the Overpass API is free and needs no key, though rural POI coverage can be patchy; Google Places API is more complete/current but has per-request billing. Worth prototyping on OSM first and only paying for Places if coverage gaps show up in testing.
- **Crime risk** — **caveat: this cannot be a point-level estimate.** Canadian police-reported crime data (Statistics Canada Table 35-10-0177-01, and the annual Crime Severity Index) is published by *police service / detachment jurisdiction*, not by address or parcel. The best you can honestly give a user is "your property falls within [jurisdiction]'s reporting area, which had a Crime Severity Index of X in [year], and rural Alberta as a whole runs meaningfully higher than urban Alberta." Precise RCMP detachment boundary polygons aren't reliably published, so in practice this likely resolves to nearest municipality/rural-crime-watch-zone as a proxy — flag that approximation in the UI rather than presenting a false sense of precision.

## 3. Well depth prediction — methodology and sources

**Do not predict well depth from topography alone.** The signal that matters is nearby actual well records; topography and regional bedrock modeling are secondary covariates that help interpolate between them.

- **Primary source**: Alberta Water Well Information Database — real drilled depth + static water level for existing wells, queryable by area. This is the main input.
- **Secondary covariate**: AGS "Bedrock Topography of Alberta, Version 2" (Map 610) — a geostatistical grid already built from well litholog data + oil/gas stratigraphic picks + outcrop locations + a coarse DEM. Use its value at the target point as one feature, not as the estimate itself.
- **Secondary covariate**: AGS provincial hydrostratigraphic mapping (hydraulic head, unit geometry by formation) where available, to name a likely target aquifer/formation.
- **Method**: regression-kriging (or IDW if starting simple) over nearby Water Well Information Database records within a search radius, with surface elevation and the AGS bedrock-topography grid value as additional regression covariates. Output a depth range, not a point estimate.
- **Confidence tiering**: base confidence on `nearby_well_count` within the search radius — dense well control (many nearby records) = trustworthy range; sparse control = wider range, flagged; zero nearby wells = fall back to the regional bedrock-topography grid alone and mark lowest confidence.
- **Always pair with a disclaimer** recommending a local licensed driller for a site-specific quote — geological heterogeneity (buried channels, lens pinch-outs) means real depth can vary sharply over short distances even with dense well control nearby.

## 4. Suggested pipeline

1. Geocode site → ATS legal description + lat/long.
2. Pull DEM tile → derive slope, aspect, landform position, keypoint candidates.
3. Query AGRASID + CLI by ATS/quarter-section → soil block.
4. Query AMWI + flood hazard + HYDAT/river basins → hydrology block.
5. Query nearest ECCC climate station + NRCan hardiness zone raster → climate block.
6. Query ABMI land cover → existing_vegetation block.
6b. Query hydrography (nearest-feature), POPCTR/municipal boundaries, GeoNames, Overpass/Places, and the StatCan crime table by jurisdiction → populate `proximity_context`.
6c. Query nearby Water Well Information Database records + AGS bedrock topography grid value at the point → run regression-kriging → populate `predicted_well_depth`.
7. Run the if→then ruleset (Section 1) against the assembled record → populate `design_elements`.
8. Join on the same site_id against the EcoCrop crop-suitability schema to filter guild/food-forest species by what's actually viable at that hardiness zone and soil type.
