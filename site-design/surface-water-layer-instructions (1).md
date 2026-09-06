# Task: Add a Surface Water Layer to the 3D Property Map

## Goal
Given a parcel boundary, produce a surface water layer (mapped lakes/ponds/rivers extents, plus optionally a predicted-stream network) for both 3D rendering and the site-report/fecundity pipeline, using the best available local data with a global fallback.

Note: this is distinct from the Wet Areas Mapping (WAM) integration already used elsewhere in the pipeline for groundwater/depth-to-water screening. WAM is a hydrological *model* (predicted streams, depth-to-water raster) used for the fecundity report. This task is about actual mapped surface water body *extent* — for rendering water in the 3D twin and for a literal "distance to nearest water source" schema field.

## Data source priority (check in this order)

1. **AltaLIS / Alberta Base Features — Water Bodies & Watercourses**
   - Vector polygons/lines for lakes, ponds, rivers, and named watercourses, provincial base mapping.
   - Coverage: province-wide, but vintage and update frequency vary — check the dataset's last-revised date per tile/region.
   - Access via Alberta's geospatial portal (geospatial.alberta.ca / open.alberta.ca) or AltaLIS.

2. **Alberta Wet Areas Mapping (WAM)** — already integrated for groundwater screening.
   - Reuse the existing WAM integration for the predicted-stream network and depth-to-water raster rather than re-fetching. This adds ephemeral/intermittent drainage that vector water-body datasets often miss (useful for spring runoff and pond-siting analysis).

3. **LiDAR-derived water masking (bonus, when LiDAR is already being pulled for terrain/canopy)**
   - Water surfaces return very few or no LiDAR points (near-infrared pulses are largely absorbed or specularly reflected by open water), so a "sparse/no-return" mask within the DTM extent is a decent low-cost validator for standing water bodies larger than a few meters across.
   - Use this only to cross-check or fill small gaps in the vector datasets above, not as a primary source — it can false-positive on other low-return surfaces.

4. **National Hydro Network (NHN)** — federal fallback if Alberta's provincial data has a gap or an outdated tile.
   - Vector lakes/rivers/wetlands, free via Natural Resources Canada / open.canada.ca. National coverage but generally coarser and less frequently updated than the provincial dataset.

5. **Fallback: JRC Global Surface Water** (Pekel et al., European Commission Joint Research Centre)
   - Landsat-derived global water occurrence/seasonality raster, 30m resolution, accessible via Google Earth Engine.
   - Use only if none of the above cover the parcel or all are stale/missing for that tile. Much coarser than any of the vector sources above — a 30m pixel can blur small ponds entirely, so flag small-water-body results from this source as low confidence.

## Decision logic (pseudocode)

```
function get_surface_water_layer(parcel_bbox):
    source = null
    water_features = null

    if altalis_water_covers(parcel_bbox) and altalis_water_is_current(parcel_bbox):
        water_features = fetch_altalis_water(parcel_bbox)
        source = "ALTALIS_WATER_BODIES"

    else if nhn_covers(parcel_bbox):
        water_features = fetch_nhn_water(parcel_bbox)
        source = "NHN_FEDERAL"

    else:
        water_features = fetch_jrc_global_surface_water(parcel_bbox)
        source = "JRC_GLOBAL_SURFACE_WATER_FALLBACK"

    # Always layer in WAM predicted streams regardless of which primary source was used
    wam_streams = fetch_wam_predicted_streams(parcel_bbox)  # reuse existing integration

    # Optional cross-check using LiDAR sparse-return mask, if LiDAR was already fetched for this parcel
    if lidar_available_for_parcel(parcel_bbox):
        lidar_water_mask = derive_water_mask_from_lidar_returns(parcel_bbox)
        water_features = reconcile(water_features, lidar_water_mask)

    return water_features, wam_streams, source
```

As with the canopy layer, `altalis_water_covers`, `altalis_water_is_current`, and `nhn_covers` must be real coverage/freshness checks against the live index — not hardcoded assumptions.

## Processing steps

1. Clip water polygons/lines to the parcel + a buffer (e.g. 500m–1km) so "distance to nearest water source" can be computed even when the water body itself sits outside the parcel.
2. Compute `distance_to_nearest_water_m` from parcel centroid (or parcel boundary, whichever the schema currently uses) to the nearest water feature edge.
3. Rasterize/mesh water polygons for the 3D renderer: flat plane at the DTM elevation of the water edge (or a mean-water-level elevation if available) clipped to the polygon extent.
4. Overlay WAM predicted streams as a separate line layer (not merged into the mapped water bodies), since they represent a different kind of information (probability of ephemeral flow vs. confirmed standing/flowing water).

## Output schema

```json
{
  "water_bodies": [
    {
      "type": "lake" | "pond" | "river" | "wetland",
      "geometry": <polygon or polyline, parcel-local coords>,
      "data_source": "ALTALIS_WATER_BODIES" | "NHN_FEDERAL" | "JRC_GLOBAL_SURFACE_WATER_FALLBACK"
    }
  ],
  "predicted_streams": [
    { "geometry": <polyline>, "data_source": "WAM" }
  ],
  "distance_to_nearest_water_m": <float>,
  "nearest_water_source_type": "lake" | "pond" | "river" | "wetland" | "predicted_stream"
}
```

## Confidence flagging

- `ALTALIS_WATER_BODIES`, `NHN_FEDERAL`, `WAM` → high confidence.
- `JRC_GLOBAL_SURFACE_WATER_FALLBACK` → moderate/low confidence, especially for water bodies under ~1 hectare (may be missed or blurred at 30m resolution). Any report text derived from this source (e.g. "distance to water") should note the lower-resolution source when it's the fallback in use.

## Caching

Cache per parcel bbox, same as the canopy layer, and store `data_source` alongside cached geometry so reports stay consistent with how the data was originally sourced if coverage indices are updated later.
