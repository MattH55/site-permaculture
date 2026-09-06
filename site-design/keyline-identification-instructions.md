# Task: Keyline Identification (No New Data Source Needed)

## Goal
Identify the keyline point(s) and derive the keyline pattern for a parcel's primary valley(s), per Yeomans keyline design method — this becomes the reference geometry that swale/cultivation lines should follow instead of generic topography-informed estimates.

## Background (for implementation context, not user-facing text)
A valley's longitudinal profile is convex (steepening) near the ridge and concave (flattening) lower down. The **keypoint** is the inflection point where that transition happens — roughly where the valley "opens up." The **keyline** is the contour line passing through the keypoint. In proper keyline design, cultivation/swale lines run parallel to the keyline's bearing (not to the true contour everywhere else), which is what causes the pattern to converge toward ridges and diverge into valleys — the mechanism that redistributes water from wet valley floors toward drier ridges.

## Reuse, don't refetch
Use the DTM already resolved by the terrain pipeline for this parcel (same one used for slope/aspect and swale estimation). Inherit its `data_source` and confidence — see the resolution gate below.

## Processing steps

1. **Extract valley lines.** Run flow-accumulation/flow-routing on the DTM (D8 or D-infinity) using an existing hydrology library (e.g. `whitebox`, `richdem`, or a GDAL-based flow-routing tool) — do not hand-roll flow routing. Threshold flow accumulation to isolate the primary valley(s) relevant at parcel scale (a small property may have zero, one, or a couple of minor valleys — this is expected, not an error case).
2. **Get the longitudinal profile.** For each identified valley (talweg line), sample elevation along its length to build a profile (distance along valley vs. elevation).
3. **Find the keypoint.** Look for the inflection point in the profile's curvature (sign change in the second derivative of elevation vs. distance) — this is the mathematical definition of "where convex becomes concave." It typically falls in the middle-to-lower third of the valley, but don't hardcode a position assumption; derive it from the actual profile.
4. **Flag ambiguous cases rather than guessing.** If a valley's profile has multiple plausible inflection points, is too short/noisy to have a clear one, or the DTM resolution is too coarse to resolve one reliably, mark that valley's keypoint as `"ambiguous"` or `"undetermined"` and surface it for manual placement rather than silently picking a candidate. A wrong keypoint produces a wrong keyline pattern across the whole design, so a flagged gap is much better than false confidence here.
5. **Derive the keyline.** Extract the contour line at the keypoint's elevation, within the valley extent.
6. **Generate guide lines.** Produce a set of lines parallel to the keyline's bearing (not to changing elevation contours), offset at a configurable plan-distance interval, spanning the primary valley and its adjacent ridge — these are the reference lines swale/cultivation placement should snap to. If an existing open-source keyline-generation reference/algorithm is available, use it rather than inventing the offset geometry from scratch; if none is suitable, implement as fixed-interval parallel offsets from the keyline's bearing, clipped to the valley/ridge extent.

## Resolution gate

Keyline identification needs a genuinely fine DTM (LiDAR-quality, sub-5m) to resolve a real inflection point — a coarse global fallback DEM (SRTM/Copernicus at 30m) will usually not have enough vertical/horizontal detail to find a valid keypoint. If the parcel's DTM source is a coarse fallback, skip keypoint detection and return `"insufficient_resolution"` rather than emitting a low-quality guess that would drive incorrect swale placement.

## Output schema

```json
{
  "primary_valleys": [
    {
      "valley_id": "",
      "talweg": "<polyline>",
      "keypoint": { "lat": 0.0, "lon": 0.0, "elevation_m": 0.0, "status": "resolved" | "ambiguous" | "insufficient_resolution" },
      "keyline": "<polyline, contour at keypoint elevation>",
      "guide_lines": [ { "geometry": "<polyline>", "offset_m": 0.0 } ]
    }
  ],
  "data_source": "<inherited from DTM>",
  "confidence": "<inherited from DTM, forced to low/insufficient if resolution gate triggers>"
}
```

## Caching

Key off the same DTM cache entry as the rest of the terrain layer — recompute if the underlying DTM is ever replaced (e.g. a fallback parcel later gets covered by better LiDAR).
