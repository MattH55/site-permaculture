# Task: FireSmart Home Ignition Zone Assessment

## Goal
For each detected structure, assess defensible-space wildfire risk using FireSmart Canada's three-zone Home Ignition Zone framework, scored from vegetation density/proximity data already in the pipeline — no new data source needed, this is a composite of layers already built.

## Important caveat before building this

Verify the current official FireSmart Home Ignition Zone distances, spacing thresholds, and zone-specific requirements against FireSmart Canada's published guidance at build time rather than treating the distances below as fixed — this spec uses the commonly-cited zone boundaries (0–10m / 10–30m / 30–100m) as a starting structure, but exact spacing/density thresholds within each zone should come from the current official guide, the same way other layers in this pipeline flag regulatory setback figures as placeholders pending verification.

## Reuse existing layers — no new data source needed

- Building footprints (from the building-detection layer).
- Canopy layer — cover %, and individual tree detections with crown radius (for crown-spacing calculations).
- Conifer/deciduous classification, once built — FireSmart guidance treats conifers as higher-risk than deciduous due to resin content and flammability.
- Slope/aspect derivative — fire spreads faster upslope, which should make zones asymmetric rather than simple concentric circles (see step 2).

## Known limitation to flag, not silently ignore

The current canopy layer only captures overstory above roughly a 2m height threshold. FireSmart's zone assessment cares a lot about **ladder fuels** — shrubs and low vegetation that let a ground fire climb into the canopy — which sit below that threshold and aren't currently modeled. Flag this explicitly as a gap in the output (e.g. `"ladder_fuel_assessment": "not_available"`) rather than presenting a risk score as if it fully accounts for FireSmart's actual criteria.

## Processing steps

### 1. Generate zone geometry per building
Buffer outward from the building footprint edge (not a centroid point — actual distance from the wall is what matters) at the three standard FireSmart distances to produce three concentric zone polygons: Zone 1 (immediate), Zone 2 (intermediate), Zone 3 (extended).

### 2. Adjust for slope
Fire moves faster upslope, so a structure sitting below a slope faces effectively higher risk from vegetation upslope of it than the same physical distance on flat or downhill ground. Extend the zone boundaries on the uphill-facing side relative to the building (using the existing slope/aspect data) rather than treating all three zones as uniform circles — flag the specific extension factor used as needing verification against current FireSmart slope guidance, same as the zone-distance caveat above.

### 3. Score vegetation within each zone
For each zone polygon per building, compute:
- **Canopy cover %** within the zone (from the existing canopy layer).
- **Conifer % of canopy cover** within the zone, once the conifer/deciduous classification exists — conifer-heavy zones score higher risk.
- **Minimum crown spacing** between neighboring trees within the zone, using the existing individual tree-detection output (crown radius per tree) — tightly spaced crowns let fire jump tree-to-tree, which is a meaningfully different risk than the same canopy-cover percentage spread out with gaps.
- **Any woody vegetation presence at all**, specifically for Zone 1 — this zone's standard is strictest (ideally minimal-to-no flammable vegetation directly adjacent to the structure), so even sparse vegetation here should flag differently than the same amount in Zone 2 or 3.

### 4. Roll up to an overall rating
Combine per-zone scores into a single categorical rating per building (Low / Moderate / High / Extreme), weighted so Zone 1 findings dominate the rating rather than being averaged away by better conditions in Zones 2–3 — a clean Zone 3 doesn't offset a risky Zone 1, since Zone 1 is closest to the structure and highest priority by design.

### 5. Surface specific, actionable contributing factors
Don't stop at a single opaque score — report what's actually driving it (e.g. "3 conifer trees within Zone 1," "tight crown spacing along the north side in Zone 2") so a report can point to concrete remediation actions. This is also what should feed the service-recommendation engine's vegetation-management/fuel-reduction recommendation, giving it a specific reason and location rather than a generic "consider FireSmart assessment" note.

## Output schema

```json
{
  "building_id": "",
  "zones": [
    {
      "zone_number": 1,
      "geometry": "<polygon>",
      "canopy_cover_pct": 0.0,
      "conifer_pct_of_cover": 0.0,
      "min_crown_spacing_m": 0.0,
      "risk_flags": ["woody_vegetation_present_in_zone_1", "tight_crown_spacing"]
    }
  ],
  "overall_risk_rating": "low" | "moderate" | "high" | "extreme",
  "contributing_factors": ["..."],
  "ladder_fuel_assessment": "not_available",
  "data_source": "<inherited from canopy/tree-detection/DTM layers>"
}
```

## Confidence flagging

Inherits confidence from whatever canopy/tree-detection/DTM sources cover the parcel — a parcel relying on the GEE global canopy fallback will have a correspondingly rougher FireSmart assessment than one with local LiDAR-derived individual tree detections. Always surface the `ladder_fuel_assessment: "not_available"` flag in report text rather than letting the overall rating imply completeness it doesn't have.

## Caching

Cache per building, keyed to the building footprint and the canopy/tree-detection layer versions — recompute if either changes (e.g. a parcel gets better LiDAR coverage later, or vegetation is cleared and the canopy layer is refreshed).
