# Task: Building Detection & 3D Model Generation

## Goal
Identify existing structures on the parcel and render them as 3D models in the twin — footprint from open datasets, height from data already in the pipeline, geometry from either procedural extrusion or a matching low-poly asset. This mirrors the tree pipeline's shape (detect → get dimensions → render) applied to structures.

## Footprint sources

1. **Microsoft Canadian Building Footprints** — ML-detected polygons from aerial imagery, strong rural/acreage coverage across Canada. Primary source.
2. **OpenStreetMap buildings** — fallback/supplement, consistent with the merge pattern already used for the roads/amenities and plantable-area exclusion layers (dedupe overlapping footprints rather than picking one source exclusively). Also the only source likely to carry a `building=*` type tag (house, barn, farm_auxiliary, shed, garage, greenhouse) or `roof:shape`, where mapped — sparse outside towns, so treat any tag hit as a bonus rather than something to rely on.

If this parcel's structure-footprint data was already fetched for the plantable-area exclusion layer, reuse that fetch rather than re-querying the same sources.

## Height — reuse, don't refetch

Sample the existing DSM and DTM (from the HRDEM terrain pipeline) at each footprint and compute `height_m = DSM - DTM`, the identical calculation already used for the canopy height model, just applied to a building polygon instead of a forest polygon. No new elevation data source needed. Inherit the DTM/DSM's `data_source` and confidence, same as every other DTM-derivative layer in this pipeline.

## Building type inference

1. **Tagged (high confidence)**: use OSM's `building=*` value directly where present.
2. **Heuristic (lower confidence, flag as inferred)**: where untagged, infer a rough type from footprint size and shape — e.g. a large elongated footprint suggests a barn/shop, a small square footprint suggests a shed, a mid-sized roughly-square-to-rectangular footprint in a residential-scale range suggests a house. Keep this heuristic simple and documented, and always tag its output as `"inferred"` rather than presenting it with the same confidence as an actual OSM tag.

## Rendering: procedural extrusion (default) + asset swap-in (where recognized)

### Procedural extrusion — the reliable fallback for every building
Extrude the footprint polygon straight up to `height_m`, cap with a basic roof (gable by default, or read `roof:shape` from OSM where tagged). This works for every footprint regardless of type-inference confidence or asset availability — nothing should render as a flat missing gap just because it wasn't recognized as a specific building type.

### Asset swap-in — for recognized farm-structure types
Use the Quaternius low-poly farm-buildings pack (barn, shed, workshop, garage variants) for footprints classified (tagged or confidently inferred) as those types — this matches the art style of the Kenney/Quaternius tree assets already adopted for vegetation, so buildings and trees read as one consistent visual language rather than two different art styles side by side.
1. Load the matching asset via `GLTFLoader`, same pattern as the tree pipeline.
2. Scale to the footprint's actual bounding box (measure the asset's real bounding box before scaling, same measured-not-assumed approach used to fix the tree scale bug — don't assume a fixed asset-to-footprint ratio).
3. Rotate to match the footprint's dominant edge orientation rather than leaving assets axis-aligned to a fixed direction, so buildings sit naturally relative to their actual footprint shape.
4. Fall back to procedural extrusion for any building whose footprint dimensions don't reasonably fit any available asset variant, rather than forcing a mismatched asset onto it.

## Rendering treatment: these are real, not proposed

Unlike the recommended-planting overlay (which uses a ghost/translucent material to distinguish proposed-but-not-yet-planted content), detected buildings are existing structures — render them in the same solid, non-ghosted style as existing/detected trees, not the proposed-feature style used elsewhere in the twin. Keep this distinction consistent across the whole rendering system: solid = actually there, ghost/translucent = proposed/hypothetical.

## Output schema

```json
{
  "buildings": [
    {
      "footprint": "<polygon>",
      "height_m": 0.0,
      "building_type": "house" | "barn" | "shed" | "garage" | "farm_auxiliary" | "unknown",
      "type_confidence": "tagged" | "inferred",
      "render_mode": "asset" | "extrusion",
      "data_source": { "footprint": "MICROSOFT_FOOTPRINTS" | "OSM", "height": "<inherited from DSM/DTM>" }
    }
  ]
}
```

## Integration notes

- The plantable-area-identification layer already excludes structure footprints from available planting ground — reuse the exact same footprint fetch for both tasks rather than maintaining two separate queries against the same sources.
- The roads/access layer's amenity distance calculations and this layer's building detection both touch structure-adjacent data — no direct dependency, but worth keeping the same footprint cache available to both rather than duplicating fetches.
- In the interactive planning mode, detected buildings should factor into the pond/solar/wind suitability layers' hard exclusions (structure footprint + buffer) exactly as already specified there — this task is what actually populates that exclusion data with real geometry instead of an assumed absence.

## Confidence flagging

Three independent confidence signals, don't collapse into one: footprint source (Microsoft vs. OSM), height (inherited from whichever DTM/DSM source covers the parcel), and building-type (tagged vs. heuristic-inferred). A report or render referencing a specific building should be able to say, e.g., "footprint from Microsoft (high confidence), height from HRDEM LiDAR (high confidence), type inferred from footprint shape (lower confidence)" rather than one blended number hiding which part is actually uncertain.

## Caching

Cache per parcel, keyed to the footprint source version and the DTM/DSM cache entry used for height — invalidate consistently with the other DTM-derivative layers if the underlying terrain source ever changes.
