# Task: Add/Extend the Soil Data Layer with a Global Fallback

## Goal
The pipeline already uses AGRASID for Alberta soil data. Add a coverage check plus a global fallback (SoilGrids) for parcels outside AGRASID's extent, or where AGRASID has no polygon for the specific parcel (e.g. some forested, mountainous, or urban-fringe areas aren't part of the agricultural soil survey).

## Data sources

1. **AGRASID** (Agricultural Region of Alberta Soil Inventory Database) — already integrated, keep as primary for Alberta.
   - Polygon-based soil survey: soil series, texture class, drainage class, parent material.
   - Coverage: the agricultural region of Alberta specifically — it does not cover the whole province (forested/mountainous Alberta and some other areas fall outside its survey extent).

2. **Fallback: SoilGrids** (ISRIC, global gridded soil property model)
   - 250m resolution, continuous global coverage — usable anywhere, including outside Alberta entirely (relevant given other work spans Honduras/Roatán).
   - Provides: pH, organic carbon %, sand/silt/clay %, bulk density, cation exchange capacity, and depth-to-bedrock, at multiple depth intervals (0–5cm, 5–15cm, 15–30cm, etc.).
   - Access via the ISRIC REST/WCS API or as a Google Earth Engine asset.
   - Does not provide a direct "drainage class" or "soil series name" — those would need to be inferred or left blank when this source is in use.

## Decision logic (pseudocode)

```
function get_soil_data(parcel_polygon):
    if agrasid_covers(parcel_polygon):
        soil_polygons = fetch_agrasid(parcel_polygon)
        if soil_polygons is not empty:
            return build_soil_profile_from_agrasid(soil_polygons), "AGRASID"

    # AGRASID doesn't cover this parcel, or returned no polygons for it
    soilgrids_samples = fetch_soilgrids(parcel_polygon)
    return build_soil_profile_from_soilgrids(soilgrids_samples), "SOILGRIDS_FALLBACK"
```

`agrasid_covers` must check against AGRASID's actual survey extent, not just "is this in Alberta" — the agricultural survey region is a subset of the province.

## Processing steps

### AGRASID path
1. Spatially join the parcel polygon against AGRASID soil-series polygons.
2. If the parcel intersects multiple soil series, report each with its area-weighted % of the parcel rather than picking just the dominant one — mixed-series parcels are common and the design-element recommendations may want to know if, e.g., 30% of the parcel sits on a poorly-drained series.
3. Extract: soil series name, texture class, drainage class, parent material for each intersecting polygon.

### SoilGrids path
1. Sample the raster at a grid of points across the parcel (density scaled to parcel size — a handful of points for a small acreage, more for a larger property) rather than a single centroid sample, then area-weight or average.
2. Pull values at the 0–5cm and 5–15cm depth intervals as the primary rooting-zone reference (deeper intervals optional, useful for tree/perennial root-zone assessment).
3. Convert sand/silt/clay percentages into a USDA texture class using the standard soil texture triangle, since the schema's texture field elsewhere is categorical (from AGRASID) — don't leave this as raw percentages if downstream logic expects a texture class string.
4. Leave `drainage_class` null or mark as "not available from this source" rather than guessing — inferring drainage from slope + texture is possible but should be a clearly separate, explicitly-flagged inference, not presented as sourced data.

## Output schema

```json
{
  "soil_data_source": "AGRASID" | "SOILGRIDS_FALLBACK",
  "soil_units": [
    {
      "area_pct_of_parcel": 0.0,
      "soil_series": "" ,
      "texture_class": "",
      "drainage_class": "",
      "parent_material": "",
      "ph": 0.0,
      "organic_carbon_pct": 0.0,
      "depth_to_bedrock_cm": null
    }
  ]
}
```
(`soil_series`, `drainage_class`, `parent_material` will be null when the fallback source is used.)

## Confidence flagging

- `AGRASID` → high confidence (direct field survey).
- `SOILGRIDS_FALLBACK` → moderate/low confidence — it's a 250m machine-learning interpolation, not a field survey, so a small parcel may not reflect real local heterogeneity. Any report text built from this source (soil suitability notes, amendment recommendations) should say so, and drainage-class inferences (if added later) should be flagged as inferred, not measured.

## Caching

Cache per parcel polygon, same pattern as the other layers, storing `soil_data_source` alongside the cached values.
