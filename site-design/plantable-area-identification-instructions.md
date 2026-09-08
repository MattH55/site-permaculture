# Task: Available Planting Space Identification

## Goal
Produce a polygon layer of open ground actually available for new planting, by combining the layers already built (canopy, water, slope, frost-pocket) plus one new input (structure footprints), rather than a suitability *score* over the whole parcel. This is what lets a report say "here are the specific patches you can plant" instead of "this parcel scores well for orchard crops in general."

## New input needed: structure footprints

None of the existing layers exclude buildings/driveways/existing hardscape. Add:

1. **Microsoft Canadian Building Footprints** — ML-detected building polygons from aerial imagery, notably more complete for rural/acreage buildings than OSM in Canada (OSM building coverage leans urban/volunteer-mapped). Use as primary for Alberta parcels.
2. **OpenStreetMap buildings** — fallback/supplement where the Microsoft dataset has gaps, and primary for non-Canada parcels (e.g. Honduras), consistent with the roads/amenities layer's existing pattern.

Merge rather than strict-fallback, same as the roads/amenities layer: dedupe overlapping footprints between the two sources rather than picking one exclusively.

## Composite exclusion / constraint logic

Build this as layered exclusions and constraints, not a single blended score — different exclusions mean different things to a user and should stay distinguishable in the output:

1. **Existing canopy (hard exclusion by default).** Anywhere the canopy layer already shows tree cover above a configurable height threshold (e.g. ~2m) counts as already-vegetated, not available for *new* planting. Keep this separate from "understory/guild planting beneath existing canopy" — that's a legitimate future use case but out of scope for this pass; for now, existing canopy = excluded.
2. **Water + riparian buffer (hard exclusion).** Reuse the water-body layer, buffered by a configurable setback distance (default to whatever riparian setback convention is already used elsewhere in the pipeline if one exists; otherwise flag the chosen default distance clearly as a placeholder pending an actual regulatory figure).
3. **Structure footprints + buffer (hard exclusion).** Buildings and any other footprint layer available, buffered by a small configurable margin.
4. **Slope (constraint, not hard exclusion below the "avoid" band).** Reuse the existing slope-suitability bands from the slope/aspect derivative rather than inventing new thresholds — don't hard-exclude moderate/steep slopes, tag them as "requires terracing/contour planting" so the report can still surface them as an option with a caveat.
5. **Frost pockets (constraint, not exclusion).** Tag zones flagged moderate/high frost risk rather than excluding them — they're unsuitable for frost-sensitive species specifically, not unplantable in general.

## Processing steps

1. Compute the hard-exclusion mask (canopy + water buffer + structure buffer) and subtract it from the parcel polygon.
2. Split the remaining open area into discrete contiguous patches.
3. Discard slivers below a configurable minimum useful area (small edge fragments along a mask boundary aren't meaningfully plantable — set a sensible default like a few square meters and make it adjustable, not hardcoded as a magic number buried in logic).
4. For each remaining patch, attach: area, average slope, dominant aspect, soil texture class (where available), frost-risk level, distance to nearest water — pulling straight from the layers already built rather than recomputing anything.
5. Attribute each patch's `data_source` as the set of contributing layers' sources, so confidence can reflect the weakest link — e.g. a patch sitting in an area where the canopy layer had to use the global fallback should say so, even if soil data for that same patch came from AGRASID directly.

## Output schema

```json
{
  "planting_zones": [
    {
      "geometry": "<polygon>",
      "area_m2": 0.0,
      "avg_slope_pct": 0.0,
      "dominant_aspect": "N|NE|E|SE|S|SW|W|NW",
      "soil_texture_class": "",
      "frost_risk_level": "low" | "moderate" | "high",
      "distance_to_water_m": 0.0,
      "constraints": ["steep_terracing_required", "frost_risk"],
      "contributing_sources": {
        "canopy": "",
        "water": "",
        "slope": "",
        "soil": "",
        "structures": ""
      }
    }
  ]
}
```

## Confidence flagging

Report the weakest contributing source per patch rather than an overall single confidence value — a patch is only as trustworthy as its least-certain input layer. Surface this explicitly (e.g. "soil data for this patch is from the global fallback, not AGRASID") rather than burying it in an aggregate score.

## Caching

This is a derived layer sitting on top of several others — cache invalidation needs to key off the versions/cache-entries of every contributing layer (canopy, water, slope, soil, structures), not just the parcel bbox, so a change to any one upstream layer correctly invalidates this one.
