# Feature Spec: Site Hydrology & Wind Report Module

**Audience:** coding agent implementing this as a feature of the Expanding Edge Permaculture site-report pipeline.
**Scope:** everything below is buildable now. See "Explicitly out of scope" at the end for what to skip and why.

---

## 1. Overview

Given a property boundary (polygon drawn on a map, matching the existing "draw a box on Google Maps" input pattern), produce:

1. A **wind rose + shelterbelt design overlay** — major prevailing wind direction(s), a wind-speed-reduction heatmap for a proposed shelterbelt, and a time-staged view showing the protected envelope growing as the shelterbelt matures.
2. A **contour + swale placement map** — elevation contours over the property with proposed swale lines drawn on-contour.
3. A **rainfall model** — mean (typical year) and distribution (deluge/return-period) rainfall for the site.
4. A **pond catchment volume estimate** — expected fill volume and peak/deluge inflow rate for a proposed pond location.
5. A **swale-effect soil moisture prediction** — modeled soil moisture over a season, comparing open ground to a swale-adjacent zone.
6. A **soil moisture display** combining two live data sources (station-based and satellite-based).

All of these hang off the same property polygon input and the same underlying rainfall/contour data pulls — build the data-fetch layer once and share it across features.

---

## 2. Data sources (external APIs / datasets to integrate)

| Data | Source | Notes |
|---|---|---|
| Wind rose (direction + speed frequency) | ACIS Alberta — `acis.alberta.ca/wind-rose.jsp` | Pick nearest station to property centroid; support a configurable date range |
| Precipitation normals (mean) | ACIS Alberta climate normals | Same station network as wind |
| Soil moisture (station-based, % field capacity) | ACIS Alberta soil moisture product | Same station network |
| Extreme rainfall / return-period rainfall | ClimateData.ca IDF curves — use the **climate-change-scaled** curves, not raw historical | Durations: 1hr, 6hr, 24hr at minimum. Return periods: 1-in-2, 1-in-10, 1-in-25 (add 1-in-100 if easy) |
| Soil moisture (satellite-based, % saturation) | AAFC / SMOS surface soil moisture map | ~25km resolution — coarser, use as a regional cross-check display, not the primary per-property number |
| Contour lines / elevation | AltaLIS Base Features (free, 10m contour intervals, 20m in mountainous areas) — fallback to NRCan LiDAR-derived HRDEM where available for higher resolution | AltaLIS requires free registration |
| Soil texture / infiltration parameters | Existing client soil test data (already part of the pipeline elsewhere — reuse, don't refetch) | Needed for runoff coefficient / Curve Number and field capacity / wilting point |

**Build order suggestion:** contour/elevation fetch and wind rose fetch are independent and can be built in parallel; rainfall (mean + IDF) and soil moisture depend on the same ACIS station lookup as wind, so share that station-resolution logic.

---

## 3. Feature: Wind rose + shelterbelt overlay

### 3.1 Wind rose ingestion
- Pull wind rose data (direction bins × speed frequency) for the nearest ACIS station to the property centroid.
- Identify the **major prevailing direction(s)**. Support the multi-direction case: if two or more direction bins have comparable frequency (no single dominant spoke), flag the site as needing a multi-directional/checkerboard shelterbelt layout rather than a single linear belt.

### 3.2 Shelterbelt envelope (protected zone) per major direction
For each identified major wind direction, compute a protected-zone polygon:
- Orient the polygon perpendicular to that wind direction, downwind of a shelterbelt line placed at the client's chosen/proposed location.
- Zone extent: downwind reach of up to **30x barrier height (H)**, with the **strongest effect concentrated around 5x H** — do not model this as a uniform-strength rectangle; the wind-speed-reduction heatmap (3.3) should show a gradient, strongest near the belt and tapering with distance, not a flat protected/unprotected boundary.
- If multiple major directions were flagged in 3.1, generate one envelope per direction and show them as overlapping/combined layers on the same map (checkerboard-pattern case).

### 3.3 Wind-speed-reduction heatmap
- Render a heatmap over the property showing modeled wind speed reduction (%) at each point, derived from:
  - Distance downwind from the shelterbelt line (in multiples of H)
  - A reduction curve peaking at ~50% wind speed reduction around 5H, tapering to near-zero by ~30H
- This is a property-wide heatmap, not just the single envelope polygon — show the full gradient so the client can see where protection is strong vs. weak.

### 3.4 Time-staged growth view
Shelterbelt height (H) changes over time as trees grow, which changes the heatmap and envelope size. Generate the heatmap/envelope at a minimum of these stages:
- Year 0-2 (near-zero height — show minimal/no protection)
- Year 3-5 (juvenile height)
- Year 8-10 (semi-mature)
- Year 15-20+ (mature)

Height-per-year should be **species-dependent** — pull growth-rate assumptions from a small lookup table (fast growers like poplar vs. slow growers like spruce) rather than a single fixed curve, since the pipeline's existing shelterbelt species recommendations already vary by row/purpose. Allow the report to show a mixed-species belt's height curve as the blend of its component rows if that's easier than a single scalar.

UI: a year slider or discrete tabs (0-2 / 3-5 / 8-10 / 15-20+) that re-renders the heatmap/envelope at each stage.

---

## 4. Feature: Contour + swale placement map

- Fetch contour/elevation data (AltaLIS or LiDAR) for the property polygon.
- Render contour lines over the property boundary.
- Reuse the pipeline's existing topography-based swale meterage estimation logic to determine swale placement (on-contour, within the ≤5% slope ideal / up to ~15% with reinforcement constraint already established elsewhere in the pipeline).
- Draw proposed swale line(s) on the contour map as an overlay.
- Output: a single combined map artifact (contours + swale lines) suitable for inclusion in the client-facing site report — this should be the same map surface the shelterbelt heatmap (section 3) and pond siting (section 5) layer onto, i.e. one property map with multiple optional overlay layers, not several separate disconnected images.

---

## 5. Feature: Rainfall model (mean + distribution)

### 5.1 Mean rainfall
- Pull ACIS climate normals (monthly/annual precipitation) for the nearest station.
- Output: a daily or monthly mean precipitation series for the property.

### 5.2 Distribution / deluge rainfall
- Pull climate-change-scaled IDF curve values from ClimateData.ca for the nearest ECCC station.
- Output: rainfall intensity (mm/h) for at least 1hr/6hr/24hr durations at 1-in-2, 1-in-10, and 1-in-25 year return periods.
- This feeds the pond spillway sizing (6.2) and swale overflow risk check — expose it as a discrete "design storm" selector (client/report can choose which return period to design against, default to 1-in-25).

---

## 6. Feature: Pond catchment volume estimate

### 6.1 Catchment delineation
- From the contour/elevation data (section 4), delineate the watershed area draining to the proposed pond location.

### 6.2 Volume estimate
- Runoff coefficient (or SCS Curve Number) method:
  `Runoff volume = Catchment area × Rainfall depth × Runoff coefficient`
- Runoff coefficient derived from land cover + soil type (reuse existing soil test data).
- Compute two outputs:
  - **Expected fill volume** using mean rainfall (5.1)
  - **Peak inflow rate** using the selected IDF design storm (5.2) — this is what determines spillway/overflow sizing, must be presented as a distinct number from the mean-rainfall fill volume, not blended together.

---

## 7. Feature: Swale-effect soil moisture prediction

Implement as a simple daily/monthly "bucket" model, run twice per relevant zone (open ground vs. swale-adjacent):

```
SoilMoisture(t+1) = SoilMoisture(t) + Rainfall(t) + SwaleInfiltration(t) − DeepDrainage(t)
```
bounded between wilting point and field capacity (from soil test data).

- `SwaleInfiltration(t)` = intercepted upslope runoff (from the same catchment delineation logic as 6.1, sized to the swale's capacity from its cross-section/length) that infiltrates into the swale-adjacent zone rather than running off.
- Run once with mean rainfall (5.1) → typical seasonal trajectory.
- Run once with an IDF design-storm event inserted → check for swale overflow / capacity exceedance.
- Output: a comparison chart, open-ground soil moisture vs. swale-adjacent soil moisture, with the wilting point plotted as a reference line — the client-facing point is showing whether/when open ground crosses below the wilting point during a modeled drought period, and whether the swale-adjacent zone stays above it.

**Do not include** an evapotranspiration adjustment for wind shielding or shade in this model (see section 8) — this bucket model's only inputs are rainfall + swale infiltration + drainage.

---

## 8. Feature: Soil moisture display (both data sources)

- Fetch and plot both:
  - ACIS station-based soil moisture (% of field capacity) — primary, higher-resolution line
  - AAFC/SMOS satellite-based soil moisture (% saturation, ~25km resolution) — secondary, regional cross-check line
- Display both on one chart (already prototyped) rather than reconciling into a single number — the discrepancy between station and satellite readings is expected and fine to show as-is.

---

## 9. Explicitly out of scope for this build

**Do not implement:**
- Evapotranspiration (ET₀) adjustment for wind-shielding (Penman-Monteith wind-speed term reduction) or for shade (radiation-term reduction / canopy transmittance).
- Any soil-moisture bucket term derived from reduced ET due to shelterbelt or shade.
- Tree canopy / shade percentage estimation (NDVI or otherwise) — this was scoped specifically to feed the shade-ET feature above and has no other consumer in this spec; skip it too.

**Report copy — include as static/narrative text, not computed output:**
Add a fixed note in the client-facing report (wherever shelterbelt and shade features are discussed) stating that shelterbelts and shade are expected to reduce evaporative water loss and improve soil moisture retention beyond what's modeled here, and that this can be economically meaningful — particularly (but not exclusively) during drought periods, when soil moisture is a documented limiting factor for crop/plant yield. This is qualitative framing only; do not attach a computed percentage or number to this claim, since the underlying model is deliberately not being built in this pass. If useful, this note can point to the internal marketing-claims reference doc, which already has literature-backed ET reduction ranges (~10-30% for shelterbelt-sheltered zones, ~30% for pond evaporation specifically) on file for whenever this feature is picked back up — those numbers should NOT be surfaced in the client report until the underlying model is actually built and validated, to avoid claiming a computed result that doesn't yet exist.

---

## 10. Suggested build order

1. Contour/elevation fetch + swale placement map (4) — foundational, other features layer on top of the same map surface
2. Wind rose fetch + shelterbelt heatmap/envelope (3) — independent of contours, can parallel-build
3. Rainfall mean + IDF fetch (5) — needed before pond/swale-effect features
4. Pond catchment volume (6) — depends on 4 + 5
5. Swale-effect soil moisture bucket (7) — depends on 4 + 5
6. Soil moisture dual-source display (8) — independent, can build anytime
7. Combine all layers into the single property report map + assemble the static out-of-scope note into report copy
