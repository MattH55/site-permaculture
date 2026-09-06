# Task: Frost Pocket / Cold-Air Drainage Mapping (No New Data Source Needed)

## Goal
Identify areas on the parcel likely to pool cold air — closed depressions, valley floors, and flat ground at the base of slopes — since planting frost-sensitive fruit trees there is a common and costly siting mistake. This is a pure DTM derivative, same reuse principle as slope/aspect and keyline identification.

## Reuse, don't refetch

Use the same cached DTM (and, where already computed, the slope derivative) already resolved for this parcel. Inherit `data_source`/confidence from it — coarse fallback DEMs (30m global) will only catch large-scale basins and will miss small but locally important cold-air traps, so confidence should downgrade accordingly (see below).

## Processing steps

1. **Closed-depression detection.** Run a standard depression-filling algorithm on the DTM (e.g. `richdem`'s or `whitebox`'s fill-depressions routine — use an existing library, don't hand-roll flood-fill). The difference between the filled surface and the original DTM identifies closed basins and their depth; any cell with a nonzero difference is part of a depression.
2. **Relative-elevation flagging.** Depressions alone miss the more common case — an open valley floor or a flat bench at the toe of a slope, which pools cold air just as effectively without being a hydrologically closed basin. Compute a Topographic Position Index (TPI) or equivalent relative-elevation metric (a cell's elevation minus the mean elevation of its surrounding neighborhood) at a neighborhood radius meaningful at parcel scale (start around 20–50m, make it configurable) to flag "low/flat relative to its surroundings" even outside closed depressions.
3. **Toe-of-slope adjacency.** Reuse the slope derivative to check whether a flagged low/flat cell sits immediately downhill from distinctly steeper terrain — that adjacency (steep slope draining into a flat area) is the classic cold-air-drainage signature and should raise the risk classification of that cell.
4. **Composite classification.** Combine the three signals above into a `low` / `moderate` / `high` frost-pocket risk rating per area, rather than relying on any single metric alone — e.g. a closed depression scores higher than an open flat, and a flat area with steep terrain draining into it scores higher than an isolated flat with no adjacent slope.
5. **Canopy interaction (optional refinement, not required for first pass).** Dense tree cover or shelterbelts can partially block cold-air drainage and change where it actually pools — note this as a future refinement using the existing canopy layer, not something to build into the first version.
6. **Extract discrete zones.** In addition to the raw classified raster, extract polygon zones for `moderate`/`high` risk areas specifically, sized meaningfully at planting scale, so the report/schema can say "avoid frost-sensitive plantings here" rather than only showing a continuous heatmap.

## Output schema

```json
{
  "frost_pocket_raster": "<reference or inline grid>",
  "risk_zones": [
    {
      "geometry": "<polygon>",
      "risk_level": "moderate" | "high",
      "basis": ["closed_depression", "low_relative_elevation", "toe_of_slope"]
    }
  ],
  "data_source": "<inherited from DTM>",
  "confidence": "<inherited from DTM, downgraded when DTM source is a coarse fallback>"
}
```

## Confidence flagging

Same DTM-quality dependency as slope/aspect and keyline identification: a LiDAR-quality DTM can resolve frost pockets down to a scale that matters for individual tree placement, while a 30m global fallback DEM will only catch large obvious basins and should be flagged as low confidence for anything but the biggest, most obvious low spots. Any report text built from this layer (e.g. "avoid this zone for stone fruit") should note when it's based on a coarse fallback DTM rather than local LiDAR.

## Integration note

This pairs naturally with guild siting: once both this layer and the canopy/shade layer exist, a "best spot for guild X" recommendation can screen out flagged frost-pocket zones automatically rather than relying on a general suitability score. Not required for this pass — just worth keeping the output schema compatible with that downstream use (polygon zones with a risk level, not just a raw raster) so it can be consumed that way later.

## Caching

Key off the same DTM cache entry as the rest of the terrain layer, same as slope/aspect and keyline identification.
