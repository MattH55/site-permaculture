# Task: Zone & Sector Overlay

## Goal
Given a homestead/house point on the parcel, generate the permaculture zone rings (0–5, by frequency of use) and sector overlays (wind, sun) so guild/planting placement can be recommended relative to actual use patterns and site geometry, not just general terrain suitability.

## Homestead point

This overlay is anchored to a homestead point, which is often user-chosen rather than fixed per parcel (a user may want to compare a couple of candidate house sites before deciding). If no point has been placed yet, default to the parcel centroid and clearly flag it as a placeholder in the output rather than presenting it as the user's actual choice.

## Zone rings

Standard permaculture zone convention — treat these radii as **configurable defaults, not fixed constants**, since appropriate zone sizing depends heavily on parcel size and terrain difficulty (a 2-acre parcel and a 160-acre parcel shouldn't get the same absolute zone-1 radius):

- Zone 0 — the house itself
- Zone 1 — daily-visited area (kitchen garden, herbs)
- Zone 2 — frequent but not daily (orchard, small livestock, main garden)
- Zone 3 — main crop/pasture, infrequent visits
- Zone 4 — semi-managed woodlot/forage, occasional harvest
- Zone 5 — unmanaged/wild, remainder of parcel

### Terrain-adjusted boundaries (not pure Euclidean rings)

A straight-line-distance ring is a poor proxy for "how often will someone actually walk there" once slope is involved — steep terrain between the house and a plot makes it effectively farther in visit-frequency terms even if it's close as the crow flies. Compute zone boundaries using a slope-adjusted travel-time/cost-distance surface instead of Euclidean buffers:
- Reuse the existing slope derivative (don't refetch terrain).
- Apply a standard slope-adjusted walking-speed function (e.g. Tobler's hiking function) to convert the slope raster into a travel-time-cost surface from the homestead point.
- Generate zone boundaries as travel-time isochrones rather than distance rings.
- Keep a Euclidean-ring option available as a fallback/comparison mode for flat parcels where the distinction won't matter much, but default to the terrain-adjusted version.

## Sector overlays

### Wind sectors
Reuse the wind-rose data already integrated for shelterbelt design (don't refetch) — render prevailing wind direction(s) as sector wedges radiating from the homestead point, at the same confidence level as the source wind-rose data.

### Sun sectors
Pure astronomical computation, no external data source needed: given the parcel's latitude/longitude, compute the solar azimuth range at winter solstice and summer solstice using standard solar-position formulas. Render as two sector wedges showing the yearly range of sun angles — useful for siting winter-sun-access plantings/structures and anticipating summer shade needs. This is deterministic given location + date, so it's always high confidence.

### Fire-risk sector (optional, lower priority — build only if relevant to the site's region)
If wildfire exposure is a relevant concern for the parcel's region, flag the prevailing direction of hot/dry-season wind (a subset of the existing wind-rose data, filtered to fire-season months) as an elevated fire-approach sector. Treat this as an optional module gated by region rather than something every parcel gets by default.

## Output schema

```json
{
  "homestead_point": { "lat": 0.0, "lon": 0.0, "is_placeholder": true },
  "zones": [
    { "zone_number": 0, "boundary_type": "cost_distance" | "euclidean", "geometry": "<polygon>" }
  ],
  "sectors": {
    "wind": [ { "direction_deg_from": 0, "direction_deg_to": 0, "label": "prevailing_wind", "data_source": "<inherited from wind-rose layer>" } ],
    "sun": [ { "season": "winter_solstice" | "summer_solstice", "azimuth_range_deg": [0, 0] } ],
    "fire_risk": [ { "direction_deg_from": 0, "direction_deg_to": 0, "data_source": "<inherited>" } ]
  }
}
```

## Confidence flagging

- Zone geometry: inherits the underlying DTM's confidence (for the cost-distance surface) — flag explicitly if `homestead_point.is_placeholder` is true, since the whole overlay is provisional until the user actually places a homestead point.
- Sun sectors: always high confidence (deterministic astronomy).
- Wind/fire-risk sectors: inherit confidence from whatever wind-rose data source is already in use elsewhere in the pipeline.

## Caching

Cache keyed on `(parcel_id, homestead_point)`, not just parcel bbox — a user may explore multiple candidate homestead locations on the same parcel and each needs its own cached zone/sector result.
