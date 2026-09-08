# Task: Independent Location-Suitability Scoring — Pond, Solar, Wind

## Goal
Produce three separate continuous suitability-score layers across the parcel — pond, solar, wind — each scored independently on its own criteria. This is deliberately **not** a combined/reconciled score; where two layers both rate the same spot highly, that's expected and left for a later reconciliation pass, not resolved here.

## Shared framework (applies to all three)

- Score 0–100 per cell, built from a documented, normalized combination of sub-criteria — normalize each sub-criterion to 0–100 before combining, don't combine raw mismatched units.
- Separate **hard exclusions** (score forced to 0 / excluded from consideration — e.g. existing water body, structure footprint) from **soft scoring factors** (things that raise or lower the score but don't disqualify).
- Classify into bands (poor/fair/good/excellent) for easy display, in addition to the raw continuous score.
- Extract top-N candidate zones/points per layer, same pattern as the existing solar candidate-zone output.
- Confidence flagging follows the same DTM-resolution and data-source-provenance rules used throughout the rest of the pipeline — don't reinvent a different confidence convention here.

---

## Pond suitability score

This is a **lightweight screening layer**, not a substitute for the full CN-based water-balance model — running full catchment delineation and water-balance simulation at every grid cell across a parcel would be far too expensive. This layer's job is to narrow the whole parcel down to a manageable handful of promising candidates; final numbers for any specific site should still go through the existing pond-water-balance model before being presented as a firm recommendation.

Sub-criteria:
- **Flow accumulation** at the cell (reuse the existing flow-accumulation grid) — higher accumulation is a proxy for more catchment draining through that point. Normalize on a log scale, since flow accumulation is heavily skewed.
- **Local slope** — flatter favors pond siting; score should fall off sharply above a configurable threshold (start around 5–10%).
- **Proximity to the identified valley/keyline network** — a bonus, since these are already-identified natural water-collection lines.
- **Soil holding capacity** — from the existing soil texture/drainage layer, sampled at the point itself. Note this is the **opposite** implication from the septic-siting use of the same soil data: poor drainage (clay-heavy, low infiltration) is *favorable* here (better at holding water in an unlined pond) but was a red flag for septic suitability. Keep these interpretations clearly separate in code and in any report text — don't let one soil-suitability number get reused with the wrong sign.

Hard exclusions: existing mapped water bodies, structure footprints + buffer, slope above the pond-infeasible threshold, and catchment area below a configurable minimum (a pour point with barely any contributing catchment isn't a real candidate no matter how flat it is).

---

## Solar suitability score

Largely a repackaging of the existing horizon-shading model's output as a formal suitability layer, plus a couple of additions:

- **Base score** from the existing annual-insolation raster, normalized to 0–100.
- **Canopy shading deduction** — already computed in the horizon-shading work, carry it through directly.
- **Slope/orientation bonus (soft, not required)** — a south-facing slope roughly matching the optimal panel tilt angle for the site's latitude gets a modest bonus, since panel efficiency improves with better incidence angle. Keep this a small bonus, not a requirement — flat ground is still perfectly viable for solar and shouldn't be scored poorly just for lacking a favorable slope.

Hard exclusions: existing water bodies, structure footprints (unless the intent is rooftop siting, which is a different sub-case not covered here), and slope steep enough to complicate mounting.

---

## Wind suitability score (new — no prior layer to build on)

### New input needed
A regional wind-resource baseline — the Global Wind Atlas (free, ~250m resolution, global mean wind speed) or Environment and Climate Change Canada's wind atlas. Sample this once per parcel as the starting regional value; everything else in this layer modulates that baseline locally rather than replacing it.

Sub-criteria:
- **Regional baseline** from the wind atlas at the parcel's location.
- **Terrain exposure factor** — reuse the horizon-profile computation already built for solar shading (the underlying geometry question — "how much is this point shielded by surrounding terrain" — is the same one, just applied to wind instead of sun). Score higher for points with high local relative elevation and low obstruction specifically in the prevailing wind sector(s) from the existing wind-rose data, not just averaged across all directions.
- **Obstruction/turbulence penalty** — deduct score based on proximity to tall canopy or structures within a standard clearance multiple of their height (a common siting rule of thumb is keeping blade-swept height well clear of nearby obstruction height), and only where that obstruction actually sits upwind of the point relative to the prevailing direction — a tall stand of trees downwind of a candidate site doesn't cause the same turbulence problem as one upwind.

Hard exclusions: minimum setback distance from property boundaries and dwellings (flag the specific distance used as a placeholder pending an actual regulatory figure for the jurisdiction, same convention used for the pond riparian-setback placeholder), and areas within the canopy/structure clearance zone regardless of wind direction (too close is too close).

---

## Output schema (shared shape across all three)

```json
{
  "suitability_type": "pond" | "solar" | "wind",
  "suitability_raster": "<reference or inline grid, 0-100>",
  "band_classification": "poor" | "fair" | "good" | "excellent",
  "top_candidate_zones": [
    { "geometry": "<polygon or point>", "score": 0.0, "basis": ["..."] }
  ],
  "hard_exclusions_applied": ["existing_water", "structure_buffer", "steep_slope", "setback_violation"],
  "data_source": { "...": "per sub-criterion, same composite pattern as other layers" },
  "confidence": "..."
}
```

## Confidence flagging

Same weakest-contributing-source rule as the other composite layers — report which specific input dragged down confidence (e.g. wind atlas resolution is coarse relative to parcel scale; DTM fallback source affects terrain-exposure accuracy) rather than a single blended number.

## Caching

Cache per parcel, keyed to the versions of every contributing layer (terrain, canopy, soil, structures, wind atlas), same invalidation pattern used throughout. The wind atlas value itself changes essentially never, so it's safe to cache indefinitely per location rather than per parcel-version.
