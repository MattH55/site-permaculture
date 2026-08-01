# Dataset Catalog & Implementation Guide: Semantic Feature Overlay on HRDEM 3D Model

This document supplements the workflow spec already written. It gives concrete, queryable data sources for each feature category, plus the technical steps a coding agent needs to fetch, reproject, and rasterize/vectorize them onto the existing terrain.

Scope note: sources below are Alberta-first with a national/global fallback for any property outside Alberta-specific coverage (e.g. HRDEM gaps, or if the schema later expands beyond the province).

---

## 1. Water (rivers, streams, lakes, ponds, reservoirs)

**Primary — Alberta Base Hydrography (Government of Alberta)**
- Access: ESRI REST FeatureServer/MapServer, queryable by bounding box, returns GeoJSON directly
- Base URL: `https://geospatial.alberta.ca/titan/rest/services/environment/inland_base_hydrography_update_10tm_nad83_aep/MapServer`
- Layers include hydro polygons (lakes, ponds, reservoirs, oxbows), hydro lines (rivers, streams, canals), and hydro points (falls, rapids)
- Native CRS: NAD83 / 10TM AEP (EPSG 3400) — must reproject
- Query pattern: `{layer_url}/query?geometry={xmin},{ymin},{xmax},{ymax}&geometryType=esriGeometryEnvelope&outFields=*&f=geojson`
- License: Open Government Licence – Alberta (free, no auth required)
- Coverage caveat: this layer is strongest in southern Alberta; for other regions fall back to the older **Alberta Base Features – Hydrography** theme via AltaLIS (`https://www.altalis.com`, free registration) which has full provincial coverage.

**National fallback — NRCan CanVec Hydro Features**
- Access: WFS/download via Natural Resources Canada Open Maps (GeoBase)
- Portal: `https://open.canada.ca/data/en/dataset/8ba2aa2a-7bb9-4448-b4d7-f164409fe056` (CanVec series)
- Use when a property falls outside Alberta provincial hydrography coverage.

---

## 2. Wetlands (marsh, swamp, bog, fen, shallow open water)

**Alberta Merged Wetland Inventory**
- Access: ESRI REST, GeoJSON-capable
- Base URL: `https://geospatial.alberta.ca/titan/rest/services/environment/alberta_merged_wetland_inventory/MapServer`
- Classification field: `CWCS_Class` — values map to bog / fen / marsh / swamp / shallow open water (Canadian Wetland Classification System)
- Native CRS: EPSG 3400 (10TM) — reproject
- Caveat (from the dataset's own use limitation): this is a *regional* generalized product, not site-specific — expect some polygon boundary imprecision at the scale of a single property. Flag this in the UI when the wetland layer is shown for a specific parcel.

---

## 3. Vegetation / land cover (forest, shrubland, grassland, cropland, bare ground)

Two tiers depending on how much detail you want:

**Tier A — Alberta Vegetation Inventory (AVI)** — richest attribute detail (species, crown closure %, height, age class) but polygon-based and inconsistent capture era across the province.
- Access: Government of Alberta Open Government portal + AltaLIS; not a simple REST bbox query in all cases — check `open.alberta.ca` dataset page for current service endpoint before building against it.
- Use for: forest polygons specifically, where you want species/height beyond a simple land-cover class.

**Tier B — AAFC Annual Crop Inventory + national Land Cover (simpler, uniform, good default)**
- Agriculture and Agri-Food Canada **Annual Crop Inventory**: 30m raster, yearly, covers all of Alberta's agricultural land, classifies cropland by crop type. Portal: `https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9`
- **Land Cover of Canada (30m, NRCan/CCRS)**: forest, shrubland, grassland, wetland, bare ground, water classes for the whole country. Portal: `https://open.canada.ca/data/en/dataset/4e615eae-b90c-420b-adee-2ca35896caf6`
- These are GeoTIFFs, not vector polygons — for the "project onto terrain" step this means a raster classification lookup per terrain grid cell rather than a polygon overlay.

**Tier C — ESA WorldCover (10m global, free, simplest to integrate)**
- 10m resolution, 11 classes including tree cover, shrubland, grassland, cropland, built-up, bare/sparse vegetation
- Access: `https://esa-worldcover.org/en` — Cloud-Optimized GeoTIFFs, or via Microsoft Planetary Computer STAC API (`https://planetarycomputer.microsoft.com/api/stac/v1`, collection `esa-worldcover`) which supports bbox queries and returns COG URLs directly — this is the easiest of the three for an agent to query programmatically.

**Recommendation:** use ESA WorldCover as the default ground-texture classifier (simple, global, STAC-queryable) and layer AVI forest polygons on top where available for higher-fidelity tree cover in Alberta.

---

## 4. Buildings

**NRCan Automatically Extracted Buildings**
- Portal: `https://open.canada.ca/data/en/dataset/7a5cda52-c7df-427f-9ced-26f19a8a64d6`
- LiDAR/imagery-derived footprints, growing coverage tied to HRDEM availability — will be sparse in areas without LiDAR.

**Microsoft Canadian Building Footprints (better rural coverage)**
- GitHub: `https://github.com/microsoft/CanadianBuildingFootprints`
- Distributed as GeoJSON per province (Alberta file downloadable directly), ~12.6M footprints nationally, computer-vision-derived from satellite/aerial imagery.
- No API — download the Alberta GeoJSON once, clip to bbox locally, cache.

**Recommendation:** use Microsoft footprints as the primary source (best rural coverage, single download, no rate limits) and cross-check against NRCan's layer where both exist to drop duplicates.

---

## 5. Transportation (roads, trails, railways)

**Alberta Base Features — Access theme (AltaLIS)**
- Full provincial coverage of roads, trails, railways at 1:20,000 scale
- Free via `open.alberta.ca` / AltaLIS open data portal (registration required, no cost)

**National fallback — NRCan National Road Network (NRN) + CanVec Transportation theme**
- Portal: `https://open.canada.ca/data/en/dataset/3d282116-e556-400c-9306-ca1a3cada77f` (NRN)
- Use for railways specifically — CanVec's transportation theme includes rail lines that NRN (roads-focused) does not.

---

## 6. Optional infrastructure (oil & gas wells, pipelines, transmission lines)

**Alberta Energy Regulator (AER) Spatial Data**
- Portal: `https://www.aer.ca/data-and-performance-reports/activity-and-data/spatial-data`
- Downloadable ZIP shapefiles, updated monthly: well locations, an "Enhanced Pipeline Shapefile" with accompanying CSV attribute layout, and coal mine boundaries.
- No REST/bbox query — download the province-wide ZIP and clip locally; re-download periodically (monthly) to stay current.

**Transmission lines**
- FortisAlberta Electrical Facility Data via AltaLIS (shapefile, covers FortisAlberta's service territory — roughly half the province, not all of it)
- For provincial transmission (not just distribution), AESO (Alberta Electric System Operator) publishes a transmission line GIS layer — check `aeso.ca` for current access terms before building against it, as availability/licensing has changed over time and should be verified at implementation time rather than assumed.

---

## Implementation Instructions for the Coding Agent

### Step 1 — Bounding box + CRS handling
- Derive the property bbox from the existing HRDEM model's extent.
- Most Alberta provincial layers are in EPSG:3400 (10TM AEP); national/global layers are typically EPSG:4326 or 3857. Reproject everything to the CRS the terrain mesh already uses before any spatial join — do this once per fetch, not per feature.
- Suggested libraries: `pyproj` for CRS transforms, `shapely` for geometry ops, `geopandas` for vector I/O and reprojection in one call (`gdf.to_crs(...)`).

### Step 2 — Fetch layer
- For ESRI REST sources (hydrography, wetlands): single HTTP GET per layer with the bbox query pattern shown above, `f=geojson`. Cache the raw response per property (these don't change often).
- For download-only sources (AER, Microsoft footprints, AVI): download once, store locally, clip to bbox with `geopandas.clip()` on subsequent runs rather than re-downloading.
- For raster land cover (WorldCover / AAFC): fetch only the COG tiles intersecting the bbox (STAC query returns tile URLs — use `rasterio` with windowed reads, don't pull the whole tile into memory).

### Step 3 — Apply priority-based rasterization
Per the priority order already specified (water > wetlands > buildings > roads > infrastructure > land cover):
- Rasterize each vector layer onto the terrain's grid resolution as a categorical mask, highest priority last so it overwrites lower-priority cells (`rasterio.features.rasterize`, or do it manually with numpy boolean masking in priority order).
- End result: one categorical raster aligned to the terrain mesh, one category per grid cell, ready to drive texture/material assignment in Step 4.

### Step 4 — Render mapping
- Water polygons → flat plane at mapped elevation (or terrain-following if it's a stream) with a water material/shader.
- Forest/shrubland/grassland/cropland/bare ground → texture or vertex-color assignment per terrain cell based on the categorical raster from Step 3.
- Buildings → extrude each footprint polygon vertically by a fixed default height (unless a height attribute exists in the source, which NRCan's layer sometimes includes) as a simple box mesh, base clamped to the terrain elevation at the footprint centroid.
- Roads/trails/railways → drape the line geometry onto the terrain surface (sample terrain elevation at each vertex along the line, don't assume flat).
- Wetlands → shallow-water shader variant, distinct from open-water material.

### Step 5 — Layer toggles
- Keep each category as a separate mesh group/scene node so visibility toggles are a simple show/hide per group, not a re-render.

### Suggested stack
- Python for the data pipeline (geopandas, shapely, pyproj, rasterio, requests)
- Output an intermediate format (e.g. GeoJSON per category, already reprojected and clipped) that the 3D rendering layer (whatever you're using — three.js/React Three Fiber, given the existing artifact stack) consumes directly, keeping the GIS pipeline and the rendering code decoupled.

### Licensing note
All sources above are free (Open Government Licence – Alberta, or NRCan/AAFC open data terms) — no paid API keys required. Microsoft's building footprints are released under ODbL. Confirm current terms at fetch time since licensing pages do get updated.
