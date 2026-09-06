# Task: Add a Canopy/Tree Layer to the 3D Property Map

## Goal
Given a parcel boundary (polygon drawn on Google Maps), produce a canopy height model (CHM) and a set of tree instance positions (x, y, height, crown radius) for that parcel, using the best available data source, with automatic fallback when local LiDAR doesn't cover the area.

## Data source priority (check in this order)

**ABMI LiDAR is disabled by default — do not build the bulk-download/local-cache path.** ABMI's only released bundle (Christina Lake, ~5,600 km²) covers a small fraction of Alberta and the app needs to work province-wide, so the ~138GB download isn't worth the infrastructure right now. Keep the coverage-gate function as a stub (`abmi_covers(bbox) -> false` always, or simply omitted from the chain below) so it can be slotted back in later if ABMI's 2024–2025 releases end up covering enough of the province to matter, without needing to redesign this module. If it's ever revisited, the correct architecture is tile-level/windowed access (via a cloud-hosted COG conversion), not a local 200GB bulk cache — see prior discussion.

1. **NRCan HRDEM** — already integrated elsewhere in this pipeline for terrain. Primary source.
   - Coverage: assembled from many regional acquisitions; patchy, varies by tile.
   - Only usable for canopy if the specific tile has **both** a DTM and a DSM product (some tiles are DTM-only — check before using).
   - If both exist: `CHM = DSM - DTM`.

2. **Fallback: Meta/WRI Global Canopy Height Map** — use whenever HRDEM doesn't cover the parcel, or has DTM only.
   - Source: 1m global canopy height raster built from Maxar imagery + GEDI spaceborne LiDAR.
   - Access: Google Earth Engine (dataset commonly referenced as the Meta/WRI "Global Canopy Height" asset — confirm current GEE asset ID at runtime, as these are periodically renamed/reprocessed).
   - Lower fidelity than local LiDAR (single-epoch, coarser vertical accuracy, no true point cloud), but global coverage and zero acquisition cost. Since this is now the fallback for most of the province (not just gap-filling around good local coverage), expect it to be the source for a meaningful share of parcels — make sure the confidence-flagging below actually surfaces in reports rather than being an edge case.

## Decision logic (pseudocode)

```
function get_canopy_layer(parcel_bbox):
    source = null
    chm_raster = null

    if hrdem_covers(parcel_bbox) and hrdem_has_dsm(parcel_bbox):
        dtm = fetch_hrdem_dtm(parcel_bbox)
        dsm = fetch_hrdem_dsm(parcel_bbox)
        chm_raster = dsm - dtm
        source = "NRCAN_HRDEM"

    else:
        chm_raster = fetch_gee_global_canopy_height(parcel_bbox)
        source = "GEE_GLOBAL_CANOPY_FALLBACK"

    return chm_raster, source
```

`hrdem_covers` and `hrdem_has_dsm` should be implemented as a real coverage-index lookup (bounding-box intersection against HRDEM's published tile/extent index), not an assumption — coverage changes over time and must be checked against the live index at request time, not hardcoded.

## Processing steps once a CHM raster is obtained

1. **Clip** the CHM to the parcel polygon (not just the bbox).
2. **Threshold** to remove noise: treat CHM values below ~0.5–1m as ground/non-vegetation.
3. **Tree detection**: run local-maxima + watershed segmentation on the CHM to extract individual tree points (height, crown radius, canopy area). Use an existing library rather than a custom implementation (e.g. `lidR`-equivalent local-maxima filtering, or an off-the-shelf Python raster segmentation routine) — do not hand-roll a segmentation algorithm.
4. **Output schema** per detected tree, to feed the existing site-report/JSON pipeline:
   ```json
   {
     "x": <float, parcel-local or lat/lon>,
     "y": <float>,
     "height_m": <float>,
     "crown_radius_m": <float>,
     "data_source": "NRCAN_HRDEM" | "GEE_GLOBAL_CANOPY_FALLBACK"
   }
   ```
5. **Rendering**: instance a generic 3D tree mesh at each point, scaled by `height_m`, for the digital twin viewer. Species/type differentiation is out of scope for this pass — flag as a future enhancement if imagery-based NDVI classification is added later.

## Confidence flagging (integration with existing report pipeline)

The `data_source` field must propagate into any downstream report/output that references canopy or shade data, and should map to a confidence level consistent with the pipeline's existing evidence-confidence convention:
- `NRCAN_HRDEM` → high confidence
- `GEE_GLOBAL_CANOPY_FALLBACK` → moderate/low confidence — any report text generated from this layer (e.g. shade estimates, biomass notes) should note it's based on global remote-sensing data rather than a local survey.

## Caching

Cache fetched rasters per parcel bbox (not per-request) since none of these sources update frequently. Store `data_source` alongside the cached raster so re-renders and reports stay consistent with how the data was originally sourced, even if coverage indices change later.
