# Task: Add Slope & Aspect Derivatives (No New Data Source Needed)

## Goal
Compute slope and aspect rasters directly from the DTM the pipeline already fetches for terrain/swale work (NRCan HRDEM, or whatever fallback DTM source was used for a given parcel). This is a pure computation step — do not fetch a second elevation dataset for this.

## Important: reuse, don't refetch

The terrain pipeline already resolves a DTM for every parcel (with its own local-first/fallback logic and a `data_source` tag). Slope and aspect must be derived from that exact same DTM raster, and must inherit its `data_source` and confidence level — slope/aspect quality is entirely bounded by the DTM's resolution and vintage. A LiDAR-derived DTM gives clean, fine-grained slope/aspect; a coarser global fallback DEM (if the terrain pipeline ever falls back to one, e.g. SRTM/Copernicus at 30m) will smear over small terrain features that matter at swale/keyline scale — so this derivative's confidence should visibly downgrade when the upstream DTM does.

## Processing steps

1. Pull the cached DTM raster + its `data_source`/confidence for the parcel from the terrain layer — do not re-fetch.
2. Compute slope using a standard 3×3-neighborhood gradient method (Horn's algorithm or equivalent, whatever the existing GIS processing library provides natively — don't hand-roll the gradient math). Output both:
   - `slope_pct` (rise/run, the convention swale/keyline literature usually uses)
   - `slope_deg` (angle, more intuitive for site-report narrative text)
3. Compute aspect (compass direction of steepest downslope) the same way, as `aspect_deg` (0–360°) and a classified `aspect_class` (N/NE/E/SE/S/SW/W/NW).
4. Handle flat cells explicitly: where slope is at/near zero, aspect is undefined — assign `aspect_class: "Flat"` rather than an arbitrary compass direction, since a flat-cell aspect value from most gradient algorithms is noise, not information.
5. Classify slope into the suitability bands already relevant to your design-element logic, e.g.:
   - `<5%` — flat, check for frost-pocket/drainage risk in low areas
   - `5–15%` — moderate, good swale/keyline candidate range
   - `15–30%` — steep, terrace or contour-planting candidate
   - `>30%` — steep, flag for erosion risk / limited earthworks suitability
   (Adjust these bands to whatever thresholds the design-element rubric already uses elsewhere in the schema, rather than introducing a second set of cutoffs.)
6. South-facing (in the northern hemisphere) slope/aspect combinations are relevant to microclimate notes (warmer, earlier snowmelt) — worth surfacing in the fecundity/report narrative when parcel aspect skews strongly one direction, since it's a free signal already sitting in this derivative.

## Output schema

```json
{
  "slope_pct": 0.0,
  "slope_deg": 0.0,
  "aspect_deg": 0.0,
  "aspect_class": "N|NE|E|SE|S|SW|W|NW|Flat",
  "slope_suitability_class": "flat|moderate|steep|very_steep",
  "data_source": "<inherited from the DTM used>",
  "confidence": "<inherited from the DTM used>"
}
```

## Caching

Key this off the same cache entry as the underlying DTM (not a separate cache), so slope/aspect are automatically recomputed and stay consistent if the DTM is ever re-sourced (e.g. a parcel that fell back to a coarse DEM later gets covered by a real LiDAR flight).
