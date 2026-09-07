# Task: Solar Siting via Horizon-Shading Model

## Goal
Produce a real solar-exposure heatmap across the parcel that accounts for terrain self-shading (nearby ridges/hills blocking sunrise/sunset) and seasonal canopy shading — replacing a simple aspect/slope-based insolation guess with an actual sun-path-vs-horizon calculation.

## Reuse existing layers — no new data source needed

- The parcel DTM (same one used everywhere else in the terrain pipeline).
- Canopy/tree-detection layer (for individual tree shadow-casting).
- Sun-sector data already computed for the zone overlay (winter/summer solstice azimuth range) — this task extends that from "range of angles" to "actual blocked/unblocked sun hours."

## Processing steps

### 1. Horizon profile per point
For each grid cell (or specific candidate site, if run on-demand rather than parcel-wide), compute the horizon elevation angle in multiple azimuth directions (e.g. every 5–10°) out to a meaningful search radius — this captures nearby ridgelines or hills that block the sun well before/after the geometrically "ideal" sunrise/sunset. Use an existing viewshed/horizon-analysis function from the hydrology/terrain library already in use if one is available; if not, implement as radial sampling of the DTM at increasing distance per azimuth, taking the maximum elevation angle observed as that azimuth's horizon angle. Don't hand-roll this from scratch if a library function exists — it's a well-established GIS operation.

### 2. Sun path per representative date
Using standard solar-position formulas (same math already used for the sun-sector overlay), compute the sun's azimuth and elevation through the day for a small set of representative dates — at minimum winter solstice, summer solstice, and the equinoxes, matching what's already used elsewhere so results stay comparable.

### 3. Compare sun path against horizon profile
At each time step, the sun is visible at a given point only if its elevation exceeds the horizon-profile elevation at its current azimuth. This gives the **actual** local sunrise/sunset time at that specific point (delayed relative to the theoretical flat-horizon time), not just a generic "faces south" assumption.

### 4. Layer canopy shadow-casting
Separately from terrain shading, check whether nearby trees (from the canopy/tree-detection layer) cast a shadow over the point at each time step, based on tree height, distance, and sun angle. Account for seasonal variation where species type is known: deciduous trees lose most shading capacity in winter, while conifers hold it year-round. If the canopy layer doesn't yet distinguish species/type, default to a conservative assumption (treat as evergreen/full shading year-round) and flag this explicitly as a simplification rather than silently underestimating winter sun access.

### 5. Integrate to annual/seasonal insolation
Sum unblocked sun hours (terrain-clear AND canopy-clear) across the representative dates to produce an insolation estimate per point — report both an annual figure and season-specific figures (winter vs. summer), since a site's best months for solar and its best months for, say, passive-solar building heating aren't necessarily the same, and a use case prioritizing winter sun (heating, greenhouse) needs the winter number specifically, not just an annual average.

### 6. Extract candidate zones
In addition to the continuous heatmap, extract discrete top-candidate polygons (highest insolation, or highest *winter-specific* insolation if that's the framing the report needs) rather than leaving the user to interpret a raw raster — this is the same "sun-trap" identification useful for guild siting, reused here for solar-panel/greenhouse siting.

## Output schema

```json
{
  "solar_exposure_raster": "<reference or inline grid, annual insolation hours>",
  "candidate_zones": [
    {
      "geometry": "<polygon>",
      "annual_insolation_hours": 0.0,
      "winter_insolation_hours": 0.0,
      "summer_insolation_hours": 0.0,
      "sunrise_delay_min_solstice": 0.0,
      "sunset_delay_min_solstice": 0.0
    }
  ],
  "canopy_shading_assumption": "species_aware" | "worst_case_evergreen",
  "data_source": "<inherited from DTM>",
  "confidence": "<inherited from DTM, downgraded for coarse fallback>"
}
```

## Confidence flagging

Same DTM-resolution dependency as keyline and frost-pocket work: a coarse global fallback DEM will poorly represent the small nearby terrain features (a modest rise a few hundred meters away) that actually determine local horizon shading, so downgrade confidence accordingly when the fallback DTM is in use. Also always surface the `canopy_shading_assumption` field in any report text — "worst_case_evergreen" likely understates real winter sun access wherever deciduous trees dominate, and that's worth saying plainly rather than leaving as a buried default.

## Caching

Cache the parcel-wide raster per parcel (keyed to the same DTM/canopy cache entries, invalidate together). If run on-demand for specific candidate points (e.g. a user testing a few solar-panel locations) rather than the whole parcel, cache per `(parcel_id, point)` the same way the pond model does.
