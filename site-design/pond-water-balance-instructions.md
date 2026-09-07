# Task: Pond Catchment Water Balance Model

## Goal
Given a candidate pond location (and assumed surface area/depth), compute a real water balance — catchment-derived inflow, direct rainfall, evaporation, and seepage — rather than the current topography + rainfall estimate. This replaces a single "expected water-catch" number with a proper sized/validated design check.

## Reuse existing layers — no new data source needed

- Flow-accumulation/routing grid already built for keyline identification (same DTM, same hydrology library).
- Canopy cover classification (for land-cover-based runoff).
- Soil texture/drainage class (for hydrologic soil grouping and seepage estimate).
- Rainfall mean + distribution already modeled elsewhere in the pipeline.
- Wind exposure and sun-sector/insolation data (for evaporation modulation).

## Processing steps

### 1. Catchment delineation
Using the candidate pond point as a pour point, delineate the upstream contributing catchment from the existing flow-accumulation grid (standard watershed-from-pour-point operation — use the hydrology library already in use, don't reimplement).

### 2. Runoff via the SCS/NRCS Curve Number method
Use the standard engineering approach rather than ad-hoc runoff coefficients:
- Classify the catchment into hydrologic soil groups (A/B/C/D) from the existing soil texture/drainage layer.
- Classify land cover within the catchment (forest / open pasture-bare soil / structures) from the canopy layer and any structure-footprint data.
- Look up the standard Curve Number (CN) for each soil-group × land-cover combination (published NRCS CN tables — use an existing reference table, don't estimate values).
- Apply the standard SCS CN runoff equation to each rainfall event/period in the existing rainfall distribution to get runoff depth, then multiply by catchment area for volume.

### 3. Direct rainfall on pond surface
Rainfall depth × assumed pond surface area, added directly to inflow (separate from catchment runoff, since this scales with pond size rather than catchment size).

### 4. Evaporation losses
Full Penman-equation evaporation needs humidity/temperature data this pipeline doesn't currently have — use a simplified approach and flag it explicitly as a simplification: start from a regional pan-evaporation baseline (a reasonable published normal for the region) and modulate it by the site's relative wind exposure and solar exposure (both derivable from the wind-rose and sun-sector/horizon-shading layers) rather than treating evaporation as flat regardless of site conditions. A pond sited in a sheltered, shaded spot should show lower modeled evaporation than an exposed, sun-baked one — that comparison is the useful output even before full weather-station-grade precision is available.

### 5. Seepage/infiltration
This depends on a design assumption that must be explicit, not inferred:
- **Lined pond** — treat seepage as effectively zero.
- **Unlined/natural pond** — estimate seepage rate from the soil texture/drainage class at the specific pond-bed location (not the catchment-wide average — sample soil data at the pond point itself). Flag this as an estimate; an unlined pond's real seepage depends on factors (compaction, clay content at depth) beyond what a surface soil survey captures, so present it as a planning-stage estimate, not a guarantee.

### 6. Net balance over time
Don't collapse this to a single annual number. Run the balance through the existing rainfall time distribution to produce a seasonal fill/draw-down pattern (a simplified hydrograph), and separately identify:
- **Design-storm peak inflow** (from the upper tail of the rainfall distribution) — needed for spillway/overflow sizing, this is a different number from the average annual inflow and both should be reported.
- **Dry-period minimum level** — worst-case drawdown given a low-rainfall stretch plus modeled evaporation, relevant to whether the pond can be relied on through a dry season.

### 7. Sizing validation
If a target use volume is known (irrigation demand, livestock water, fire-suppression reserve), check the modeled net balance against it and flag under/oversizing rather than just reporting raw numbers with no interpretation.

## Output schema

```json
{
  "pond_point": { "lat": 0.0, "lon": 0.0 },
  "assumed_surface_area_m2": 0.0,
  "catchment_area_m2": 0.0,
  "catchment_landcover_breakdown": { "forest_pct": 0.0, "open_pct": 0.0, "structure_pct": 0.0 },
  "effective_curve_number": 0.0,
  "annual_inflow_m3": { "catchment_runoff": 0.0, "direct_rainfall": 0.0 },
  "design_storm_peak_inflow_m3": 0.0,
  "annual_evaporation_m3": 0.0,
  "annual_seepage_m3": 0.0,
  "liner_assumption": "lined" | "unlined",
  "net_annual_balance_m3": 0.0,
  "monthly_level_time_series": [ { "month": 1, "net_change_m3": 0.0 } ],
  "data_source": {
    "terrain": "",
    "soil": "",
    "canopy": "",
    "rainfall": ""
  }
}
```

## Confidence flagging

Flag the evaporation estimate as a simplified model (pan-evaporation baseline adjusted by exposure, not a full Penman calculation) every time it's surfaced in a report. Flag seepage as a planning-stage estimate for unlined ponds specifically. As with other derived layers, report the weakest contributing source (e.g. if soil data at the pond point came from the SoilGrids fallback rather than AGRASID) rather than a single blended confidence value.

## Caching

Cache keyed on `(parcel_id, pond_point, assumed_surface_area)` — a user is likely to compare multiple candidate pond locations and sizes on the same parcel, and each combination needs its own cached result. Invalidate if any contributing layer (terrain, soil, canopy, rainfall) is updated, same pattern as the other composite layers.
