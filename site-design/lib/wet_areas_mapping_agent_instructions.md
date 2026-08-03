# Agent Instructions: Integrate Alberta Wet Areas Mapping (Depth-to-Water)

## Goal
Add a free, government-hosted groundwater/depth-to-water screening
layer to the site-report pipeline, using the Government of Alberta's
public Wet Areas Mapping services. This should (1) render as a map
overlay in the property-mapping UI, and (2) provide a queryable
depth-to-water estimate for a specific point or property polygon that
feeds into `fecundity_report.js`'s water-lever data and any future
well-siting logic.

## Known endpoints (verify before hardcoding — see Step 0)
- Predicted streams (vector feature layer):
  `https://geospatial.alberta.ca/titan/rest/services/environment/wet_areas_mapping_predicted_streams/MapServer`
  WMS: same path + `/WMS`
- Classified depth-to-water estimates (raster/image layer):
  `https://geospatial.alberta.ca/umbriel/rest/services/hydrography/wet_areas_mapping_classified_depth_to_water_estimates/ImageServer`
  WMS: same path + `/WMS`

These are standard **ArcGIS Server** endpoints (MapServer = vector/feature
service, ImageServer = raster service). Both expose REST operations and
a WMS-compatible interface. Data is published under the **Open
Government Licence – Alberta** — free to use, attribution required
(cite "Government of Alberta" and the Open Government Licence in any
report or UI that displays this data).

---

## Step 0 — Verify the live service schema before writing any parsing code

Do not assume field names or layer IDs from this document. Fetch each
service's metadata first:

```
GET https://geospatial.alberta.ca/titan/rest/services/environment/wet_areas_mapping_predicted_streams/MapServer?f=json
GET https://geospatial.alberta.ca/umbriel/rest/services/hydrography/wet_areas_mapping_classified_depth_to_water_estimates/ImageServer?f=json
```

Record from the response: the service's `spatialReference` (needed to
reproject property coordinates before querying), the ImageServer's
`pixelType` and any classification/legend info (for interpreting
returned raster values as depth-to-water categories), and — for the
MapServer — its sub-layer IDs and field names (`GET .../MapServer/0?f=json`
for layer 0, etc.). If either URL is unreachable or returns an error,
stop and flag it — do not fall back to guessed endpoint paths.

---

## Step 1 — Add the WMS layers to the property-mapping UI

In whatever mapping library the property-selection tool uses (Leaflet,
per the earlier basemap recommendation), add both layers as togglable
overlays on top of the Esri World Imagery basemap:

```js
L.tileLayer.wms('https://geospatial.alberta.ca/umbriel/rest/services/hydrography/wet_areas_mapping_classified_depth_to_water_estimates/ImageServer/WMS', {
  layers: '0', // confirm actual layer name/index from Step 0's GetCapabilities
  format: 'image/png',
  transparent: true,
  attribution: 'Government of Alberta — Wet Areas Mapping (Open Government Licence – Alberta)'
}).addTo(map);
```

Fetch `.../WMS?service=WMS&request=GetCapabilities` for each endpoint
first to confirm the correct `layers` parameter value and supported
`format`/CRS options — don't hardcode `layers: '0'` without checking.

Give the user a legend for the depth-to-water classification (pull the
class breaks/labels from the ImageServer's renderer info in the Step 0
JSON response) so the overlay is interpretable, not just colored.

## Step 2 — Build a point/polygon query function

This is the part that feeds `fecundity_report.js`. Use the ImageServer's
`identify` operation to get a depth-to-water value at a specific point
(e.g. the centroid of a property, or a specific proposed well/pond
location):

```
GET {ImageServer_URL}/identify
    ?geometry={"x":<lon>,"y":<lat>,"spatialReference":{"wkid":4326}}
    &geometryType=esriGeometryPoint
    &returnGeometry=false
    &f=json
```

Parse the response's `value` (raw classified value) and cross-reference
it against the class-break labels retrieved in Step 0 to produce a
human-readable category (e.g. "0-2m", "2-5m", ">5m" — actual breaks
depend on what Step 0's renderer metadata shows).

For an area estimate rather than a single point (e.g. "what's the range
of depth-to-water across this whole parcel"), use `exportImage` with
the property polygon's bounding box and sample multiple points, or use
the MapServer's `query` operation against the predicted-streams layer
with the polygon as `geometry` and `esriGeometryPolygon` as
`geometryType`, `spatialRel: esriSpatialRelIntersects`, to check if any
predicted stream lines fall on/near the property.

## Step 3 — Wire the result into the pipeline's data model

Add a new field to the `rawData` shape that `fecundity_report.js`'s
`inferIndicators()` accepts — e.g. `wetAreasMapping: { depthToWaterCategory, nearestPredictedStreamM }`
— and extend `inferIndicators()` to set `hasPondOrWetland` (or a new
`depthToWaterCategory` indicator, if you extend `fecundity_assessment.js`'s
`water` category with an additional indicator) with provenance tagged
as `'inferred (high confidence — Government of Alberta Wet Areas Mapping)'`.
This is a genuinely authoritative source, not a coarse proxy — it's fair
to give it a **high**, not moderate, confidence tag, unlike the other
inferred indicators already in that module.

Do not silently overwrite a `measured` value (e.g. an actual resistivity
survey result) with this layer's estimate — `inferIndicators()` already
only fills gaps where a measured value is absent; keep that behavior.

## Step 4 — Caching and failure handling

- Cache query results per property (keyed by parcel ID or rounded
  lat/long) — this is a government service with no published rate-limit
  guarantee, so avoid re-querying it on every page load for the same
  property.
- If the service is unreachable or returns no data for a given point
  (e.g. outside coverage), the field should simply be omitted from
  `rawData`, not populated with a placeholder/zero value —
  `inferIndicators()` is already built to handle missing fields
  gracefully.
- Log (don't surface to the client) any schema mismatch between what
  Step 0 discovered and what a later query returns, in case Alberta
  updates the service — these are unversioned government endpoints and
  can change without notice.

## Step 5 — Testing

1. Confirm both `?f=json` metadata calls succeed and log the actual
   layer IDs, field names, and classification breaks discovered.
2. Query `identify` for at least 3 known points across Alberta with
   visibly different terrain (e.g. a river valley, a dry upland area, a
   wetland-adjacent area) and confirm the returned classification
   changes sensibly between them.
3. Confirm the WMS overlay actually renders in the Leaflet map and
   toggles independently of the Esri basemap.
4. Run `fecundity_report.js`'s `generateFecundityReport()` with and
   without `wetAreasMapping` data present, and confirm the water
   category's `dataBasis` line correctly reflects the new source when
   present, and behaves exactly as before when absent.
