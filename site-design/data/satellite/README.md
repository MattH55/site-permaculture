# Satellite vegetation indices + regional SOC

Supports the fecundity pipeline two-tier model:

| Layer | Scale | Confidence | Client use |
|-------|--------|------------|------------|
| Sentinel-2 NDVI / NDRE / SAVI / NDMI | ~10 m property | medium–high | Vegetative vigor, canopy/cover proxy |
| Landsat multi-year NDVI trend | 30 m | moderate | Stress / greening trend screen |
| Sentinel-1 RTC moisture proxy | ~10 m | low–moderate | Water lever **supplement only** |
| SoilGrids SOC | ~250 m | **low–moderate** | **Regional context only** — never a numeric SOC claim |

## APIs (no key required)

- **Microsoft Planetary Computer** STAC + Data API  
  - STAC: `https://planetarycomputer.microsoft.com/api/stac/v1`  
  - Statistics / tilejson: `https://planetarycomputer.microsoft.com/api/data/v1`  
  - Rate limits: public fair-use; results cached under `data/cache/satellite/` (7 days).
- **SoilGrids 2.0** (ISRIC)  
  - `https://rest.isric.org/soilgrids/v2.0/properties/query`  
  - SOC unit: raw `dg/kg` ÷ 10 → `g/kg`.

## CLI

```bash
node scripts/satellite-indices.mjs --lat 53.80 --lng -113.65
node scripts/satellite-indices.mjs --geojson site.geojson --start 2025-05-01 --end 2026-07-01
node scripts/satellite-indices.mjs --lat 53.55 --lng -113.50 --no-cache --out /tmp/sat.json
```

## Pipeline integration

`lib/pipeline.js` calls `fetchSatelliteIndices(polygon)` then `toFecundityPatch()` and merges into `generateFecundityReport()`.

- Real `ndviCoverPct` replaces coarse tree-cover estimates when S2 succeeds.
- Completeness rises via new indicators: satellite vigor, moisture proxy, Landsat trend.
- `claims[]` records per-field confidence; SOC `value` stays `null` without lab data.

## Alberta notes

- Frequent cloud cover → wider date window and higher cloud threshold with fallback logged.
- Winter snow → prefer May–September scenes when available.
- Never invent SOC numbers if SoilGrids returns no samples for the AOI.

## Attribution

> Sentinel-2 data via Copernicus / ESA (Microsoft Planetary Computer); Landsat via USGS; regional SOC from SoilGrids (ISRIC). Vegetation indices are property-scale indicators; soil organic carbon remains low-confidence without laboratory verification.
