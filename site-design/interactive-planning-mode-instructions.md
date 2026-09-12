# Task: Interactive Planning Mode (Optimal-Location Overlays + Click-to-Place)

## Goal
Add a second mode to the 3D twin, separate from the base "as-surveyed" representation: a planning view where the user sees pre-computed optimal-location overlays for solar, pond, and planting, and can click to drop a candidate feature anywhere and get live, on-demand analysis for that exact spot using the models already built.

## Architecture: two layers, not two apps

Keep this as a mode toggle on the same twin, not a separate rendering pipeline — the terrain, canopy, and existing-structure layers stay identical between modes; what changes is whether an editable "proposed features" overlay is shown and interactive. This also keeps the existing-vs-proposed rendering distinction (ghost/translucent for proposed, solid for existing) consistent across both the planting-placement work and this new mode, rather than inventing a second visual convention.

## Optimal-location overlays (pre-computed, shown by default in planning mode)

### Solar
Already produces exactly what's needed — surface the `candidate_zones` output from the solar horizon-shading model directly as a highlighted overlay (top annual-insolation zones), with winter-specific top zones available as a toggle since that's a different priority (passive heating / greenhouse siting) than raw annual maximum.

### Pond
Don't brute-force test every point on the parcel — that's expensive and most points aren't real candidates anyway. Generate candidate pour points from data already computed:
- Natural low-flow-convergence points from the flow-accumulation grid (built for keyline identification) — these are the physically sensible spots for a pond to actually catch water.
- The valley's keypoint location specifically, since that's the traditional keyline-dam siting spot and it's already been identified.
- Run the pond water-balance model (with a reasonable default assumed surface area) against this short list of candidates rather than an exhaustive grid, rank by net annual balance, and surface the top few as the "optimal" overlay.

### Planting
Also already available — surface each plantable zone's top-ranked crop/guild match (from the suitability + placement work) as the default label shown on hover/click, and separately highlight whichever single zone scores best for a selected goal (e.g. "best zone for max food") as a distinguished "top pick" rather than treating all zones as equally emphasized.

## Click-to-place workflow

1. User selects a feature type (solar / pond / planting) and clicks a location on the twin — anywhere, not just inside a pre-highlighted optimal zone, since users will want to test their own ideas against the model's opinion.
2. Run the relevant model live, scoped to that point:
   - **Solar**: horizon-profile + sun-path calc for that single point — this is cheap enough to run interactively without precomputing the whole parcel raster on the fly.
   - **Pond**: run the water-balance model for that point with a user-adjustable assumed surface area (default to a reasonable starting size, let the user resize and re-run). This is heavier than the solar case (catchment delineation per click) — see performance note below.
   - **Planting**: if the click falls inside an existing plantable zone, show that zone's existing ranked recommendations; if it falls outside all identified zones (e.g. on excluded/forested/water ground), say so plainly rather than forcing a result — clicking on a lake shouldn't return a planting recommendation.
3. Show the result inline at the clicked point (small popup/panel) with the same confidence flagging already built into each underlying model — a user-placed pond candidate should show the same seepage/evaporation-assumption caveats as a pre-computed one, not a stripped-down version.
4. Let the user accept a proposed feature into the "plan" (adds it to the proposed-features overlay, rendered in the ghost/proposed visual style) or discard it.

## Performance note on the pond case

Live catchment delineation on every click can be slow if the underlying hydrology library isn't fast enough for interactive use. If it isn't, precompute and cache catchment delineations for a reasonable grid of candidate points across the parcel ahead of time (not just the top-ranked ones — enough coverage that most user clicks land near an already-cached point) and snap a click to the nearest precomputed catchment rather than recomputing from scratch every time, falling back to a live computation with a loading indicator only when the click is far from any cached point.

## Output schema (proposed feature object)

```json
{
  "feature_id": "",
  "type": "solar" | "pond" | "planting",
  "position": { "lat": 0.0, "lon": 0.0 },
  "user_params": { "assumed_surface_area_m2": 0.0 },
  "evaluation": { "...": "output of the relevant model for this point" },
  "status": "proposed" | "accepted" | "discarded"
}
```

## Confidence flagging

Every click-to-place evaluation carries the same confidence/simplification flags as the underlying model it called (DTM-resolution dependency for solar/pond, evaporation-model simplification, canopy-shading assumption, etc.) — don't strip these out just because the result is being shown in a quick interactive popup rather than a full report; that's exactly the context where a user might otherwise mistake a rough estimate for a precise one.

## Caching

Cache each click-to-place evaluation by `(feature_type, position, user_params)` so re-clicking the same spot with the same assumed size doesn't re-run the model, and invalidate consistently with whatever upstream layer versioning is already used elsewhere in the pipeline.
