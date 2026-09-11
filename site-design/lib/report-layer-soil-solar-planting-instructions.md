# Report Layer Upgrades — Coding Agent Instructions

## Context

The underlying analytical layers (horizon-shading solar model, soil data layer,
plantable-area identification, crop/guild suitability via `planPlantings()`,
building footprint + roof geometry) already exist in the pipeline. This task is
about surfacing more of that data *in the report itself*, plus deepening the
soil layer and adding two new report-facing views: a dual-framing solar-hours
heatmap and a planting-zone suitability map.

---

## Part 1: Additional report features sourced from the 3D model

Add as new report sections/renders, each pulling from data already computed
elsewhere in the pipeline — none of these need a new data source:

1. **Shadow-study renders** — pre-render (or client-side render) the parcel at
   spring equinox / summer solstice / winter solstice, each at morning/noon/
   afternoon sun position, using the existing terrain + canopy + building
   geometry. Static images or a scrubber in the interactive view. This is the
   visual companion to the solar-hours heatmap in Part 3 — the heatmap gives
   the number, this gives the "what it actually looks like."

2. **Per-roof-face solar readout** — once a building has roof-plane geometry
   (per the prior building-rendering instructions), run the same
   horizon-shading calculation used for the ground-level solar layer against
   each roof face individually. Output annual kWh/m² per face and flag the
   best-oriented face. This turns the existing building models into an actual
   rooftop-solar screening tool, not just visual props.

3. **Cut/fill estimate for pad/driveway siting** — if the user has selected or
   the report suggests a building pad or driveway route, compute earth volume
   moved (raise/lower to a target grade) from the DTM under that footprint.
   Simple integral over the footprint, not a full grading-plan.

4. **View-corridor check** — for a chosen house/deck point, ray-cast outward
   across terrain to flag which directions have unobstructed sightlines vs.
   which are blocked by terrain or existing structures within N meters.
   Lightweight — reuse the horizon-shading model's ray-casting machinery
   rather than writing new geometry code.

5. **Canopy volume estimate** — rough standing-timber/board-feet figure from
   the CHM × footprint area, clearly labeled as a rough planning estimate, not
   a forestry cruise. Useful context if a woodlot-value or clearing-cost
   question ever comes up in the report.

6. **Erosion-risk overlay** — see Part 2, item 3. Renders as a colored overlay
   on the terrain mesh same as the other suitability layers.

None of these need new report *pages* necessarily — most slot into the
existing report structure as additional cards/sections next to the pond/solar/
wind suitability scores already there.

---

## Part 2: Deepening the soil assessment

Current state: AGRASID (Alberta, polygon-level) with SoilGrids as fallback,
collapsed to one blended value per point.

1. **Expose the SoilGrids depth profile instead of one number.** SoilGrids
   returns values at 0–5, 5–15, 15–30, 30–60, 60–100, 100–200 cm. Surface
   topsoil (0–30cm, relevant to annual crops/gardens) and subsoil (30cm+,
   relevant to tree roots, drainage, foundations) as distinct figures in the
   report rather than one averaged value. This is a data-shape change, not a
   new data source — you already have the API response, just not currently
   unpacking all of it.

2. **Add Topographic Wetness Index (TWI) as a within-polygon drainage
   refinement.** Compute from the existing DTM (standard flow-accumulation /
   local-slope formula — reuse the flow-accumulation grid already built for
   the pond/keyline layers). Soil-survey polygons are coarse; TWI lets two
   points in the same mapped soil unit get different effective-drainage
   scores based on actual local terrain. Blend with the soil-survey drainage
   class rather than replacing it — flag which one is driving the final
   number in the confidence metadata.

3. **Add a RUSLE-lite erosion-risk score.** `erosion_risk = K (soil
   erodibility, from AGRASID/SoilGrids) × slope_factor (from existing slope
   layer) × rainfall_erosivity_proxy (from existing rainfall distribution
   data)`. Don't implement full RUSLE (needs cover-management and support-
   practice factors you don't have reliable data for) — this is a relative
   screening score for flagging high-erosion-risk zones, band it poor/fair/
   good/excellent same as the other suitability layers and label it clearly
   as a simplified proxy in the confidence metadata.

4. **Soil-test override path.** Add a schema field for a user-submitted lab
   soil test (texture, pH, organic matter, nutrient levels) that, when
   present, overrides the modeled estimate for that specific parcel/zone going
   forward — cache it separately from the modeled value so a future re-run of
   the modeled layer doesn't silently clobber real data. This is also the
   natural hook for a paid soil-test upsell tied into the procurement/services
   layer, worth flagging to the person even though it's a business decision,
   not a build task.

### Soil output schema addition

```json
{
  "soil_profile": {
    "topsoil_0_30cm": { "texture": "", "organic_carbon_pct": 0.0, "ph": 0.0 },
    "subsoil_30cm_plus": { "texture": "", "bulk_density": 0.0 },
    "drainage_class_survey": "",
    "twi_adjusted_drainage": "",
    "erosion_risk_score": 0.0,
    "erosion_risk_band": "poor" | "fair" | "good" | "excellent",
    "lab_test_override": null,
    "data_source": { "topsoil": "", "subsoil": "", "twi": "computed" }
  }
}
```

---

## Part 3: Solar-hours heatmap — dual framing

The horizon-shading model already produces an annual-insolation raster with
canopy shading. Don't rebuild it — split its *output presentation* into two
report views that answer different questions:

1. **Solar-install framing**: annual total kWh/m², evaluated per roof face
   (Part 1, item 2) and across open ground for a proposed installation.
   Single annual number is the right unit here.

2. **Planting framing**: growing-season-specific sun hours (e.g. average daily
   sun hours during the frost-free window, not an annual total — a spot that's
   great in July but shaded all spring is a poor garden site even with decent
   annual totals). Cross-reference with the existing frost-pocket layer so a
   zone that's sunny but frost-prone is flagged, not just scored on light
   alone.

Render both as heatmaps over the parcel, toggleable in the report UI rather
than as two separate static images, since a user comparing a garden spot to a
solar-panel spot benefits from seeing both on the same base map.

---

## Part 4: Planting-zone suitability map

This is primarily a wiring task — the plantable-area-identification layer and
the existing `planPlantings()` crop/guild engine already produce the
underlying data; it isn't currently rendered as a report-facing map.

1. Render the plantable-area zones as a colored overlay on the parcel map,
   banded poor/fair/good/excellent per the existing suitability-scoring
   convention used elsewhere in the pipeline.
2. For each zone, call `planPlantings()` with that zone's Site Condition
   Profile (now including the growing-season solar figure from Part 3 and the
   soil profile from Part 2 — expand the Site Condition Profile schema to
   carry these if it doesn't already) and surface the top 3–5 recommended
   crops/guilds per zone directly on the map (click/tap a zone → see
   recommendations, driving factors, and confidence).
3. Driving factors shown per zone: soil profile, season-specific solar hours,
   distance to water, frost-pocket flag, slope/aspect — reuse the existing
   "weakest contributing source" confidence convention so the zone-level
   recommendation shows the same confidence discipline as the rest of the
   report.

### Zone output schema addition

```json
{
  "planting_zones": [
    {
      "geometry": "<polygon>",
      "suitability_band": "poor" | "fair" | "good" | "excellent",
      "site_condition_profile": {
        "soil": {},
        "growing_season_sun_hours": 0.0,
        "frost_pocket": false,
        "slope_pct": 0.0,
        "aspect_deg": 0.0
      },
      "recommended_plantings": [
        { "species_or_guild": "", "confidence": "high" | "moderate" | "low" }
      ]
    }
  ]
}
```

---

## Suggested build order

1. Soil depth-profile unpacking + TWI drainage refinement (Part 2, items 1–2)
   — cheap, no new data sources, immediately improves report accuracy.
2. Dual-framing solar heatmap (Part 3) — mostly a presentation-layer split of
   existing data.
3. Planting-zone map wiring (Part 4) — depends on #1 and #2 being in place
   since the Site Condition Profile needs both.
4. Erosion-risk score (Part 2, item 3) and soil-test override path (Part 2,
   item 4) — independent, can slot in anytime.
5. Part 1 items (shadow renders, per-roof solar, cut/fill, view-corridor,
   canopy volume) — lowest priority, mostly report polish once the building
   geometry work (from last session) lands.
