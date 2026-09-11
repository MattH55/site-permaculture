# Task: Wildlife Layer — Species Range Data + Crowd-Sourced Observations

## Goal
For each parcel, produce two related but distinct sub-layers: (1) **expected species** — which species' known ranges overlap the parcel, from authoritative range/status datasets, and (2) **confirmed nearby observations** — actual recent sightings from citizen-science platforms within a buffer around the parcel. Together these feed wildlife-relevant recommendations (fencing, habitat packages, security/monitoring) and risk caveats (species at risk, permitting sensitivity) into the existing recommendation engine, using the same local-first/global-fallback and confidence-flagging pattern as the other layers.

Keep the two sub-layers separate in the schema rather than merging them — a range polygon says "could plausibly occur here," an observation point says "was actually seen nearby on this date." They carry different confidence and should be labeled differently in report text ("expected" vs. "confirmed nearby").

## Data sources, local-first → global fallback

**Alberta-specific (highest confidence, curated):**
- **ACIMS** (Alberta Conservation Information Management System) — tracked/rare species element occurrences. Note: ACIMS deliberately generalizes or withholds precise locations for sensitive species (see Sensitive Species handling below).
- **FWMIS** (Fish and Wildlife Management Information System, Alberta Environment and Protected Areas) — game/regulated species distribution and management-unit data.
- **Alberta Biodiversity Monitoring Institute (ABMI)** — species detection data from its monitoring station network, where it overlaps the parcel region (same coverage caveats as the existing ABMI LiDAR stub — check current coverage before relying on it).

**National:**
- **COSEWIC** / **Species at Risk Public Registry** (Canada) — federal conservation status and range for at-risk species.

**Global / crowd-sourced (broadest coverage, lower per-record confidence):**
- **GBIF** (Global Biodiversity Information Facility) occurrence API — aggregates iNaturalist research-grade records plus museum/survey datasets; query occurrences within a buffer around the parcel.
- **iNaturalist API** directly — useful if you want finer control than GBIF's aggregation (e.g., filtering to research-grade only, or pulling recent observations GBIF hasn't ingested yet).
- **eBird** — bird-specific. Use eBird Status & Trends for range/abundance polygons (expected-species sub-layer) and the eBird API for recent nearby checklists (observations sub-layer).
- **IUCN Red List spatial data** — range polygons plus conservation status, useful as a global fallback where Alberta/national range data doesn't exist for a species.

## Sensitive-species handling (important, don't skip)

GBIF, iNaturalist, and ACIMS all deliberately obscure or withhold precise coordinates for species vulnerable to poaching, collection, or disturbance (many raptors, at-risk plants, den/nest sites). Do not attempt to de-obscure or infer a tighter location than the source provides. Design the schema and report language around this from the start:
- For an obscured/generalized record, store the source's generalized geometry as-is and mark `location_precision: "obscured"`.
- Report text for at-risk species should stay at the level of "range/habitat for [species] overlaps this parcel" rather than implying a pinpointed location, regardless of how precise the underlying polygon looks.
- Never attempt to reverse-engineer exact locations from clustering multiple obscured records.

## Output schema

```json
{
  "expected_species": [
    {
      "common_name": "string",
      "scientific_name": "string",
      "taxon_group": "mammal" | "bird" | "reptile" | "amphibian" | "fish" | "insect" | "plant" | "other",
      "conservation_status": "string | null",   // e.g. ACIMS/COSEWIC/IUCN rank
      "range_source": "ACIMS" | "FWMIS" | "COSEWIC" | "EBIRD_STATUS_TRENDS" | "IUCN_REDLIST_FALLBACK",
      "confidence": "high" | "moderate" | "low",
      "location_precision": "exact" | "generalized" | "obscured" | "range_polygon_only"
    }
  ],
  "observations_nearby": [
    {
      "common_name": "string",
      "scientific_name": "string",
      "observed_date": "YYYY-MM-DD",
      "source": "GBIF" | "INATURALIST" | "EBIRD",
      "research_grade": true,
      "distance_from_parcel_m": 0,
      "location_precision": "exact" | "generalized" | "obscured"
    }
  ],
  "species_at_risk_flagged": ["scientific_name", "..."],
  "buffer_radius_m": 5000,
  "data_snapshot_date": "YYYY-MM-DD"
}
```

## Confidence flagging

- `ACIMS`, `FWMIS`, `COSEWIC` → high confidence (curated, expert-reviewed).
- `GBIF` / `iNaturalist` occurrence records → moderate confidence — presence-only data with strong sampling bias toward populated/accessible areas and active citizen-science users, so absence of records near a rural or remote parcel means "under-surveyed," not "species absent." Report text should reflect this (don't state a species is absent from a property just because no observations exist nearby).
- `eBird Status & Trends`, `IUCN Red List` range polygons → lower confidence when used alone — these indicate the species' broader range/habitat suitability, not confirmed local presence.

## Trigger conditions → work-package recommendations

- Ungulates (deer, elk) present in expected-species or observations → **Deer/Wildlife Fence** package (Security).
- Predators (cougar, bear, coyote) present → livestock-guardian and **Environmental/Wildlife Camera monitoring** recommendations (Security).
- Pollinator indicator species (native bees, butterflies) present or expected → **Pollinator Habitat** package (Vegetation & Animals).
- Wetland/riparian-associated species present → cross-reference with the surface-water layer; supports **Riparian/Wetland Restoration** package.
- Any `species_at_risk_flagged` entry → do **not** auto-generate a removal/clearing-type recommendation touching that area; instead emit a permitting/consultation caveat in the report ("provincial/federal species-at-risk regulations may apply — recommend a habitat assessment before major ground disturbance in this area").

## Caching

Unlike the mostly-static terrain layers, occurrence data grows continuously. Cache per parcel bbox + buffer radius as usual, but treat the cache as time-sensitive: re-fetch `observations_nearby` on a recurring basis (e.g., quarterly) rather than once, since new sightings accumulate. `expected_species` (range-based) can follow the same longer cache lifetime as the other layers, tied to source dataset version rather than a fixed interval.
