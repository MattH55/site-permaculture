# Alberta water well control points

## Production source (preferred)

**Alberta Water Well Information Database (AWWI)**  
- Download (bulk Access / Well_Reports.zip, ~200MB+):  
  https://groundwater.alberta.ca/WaterWells/d/  
  https://groundwater.alberta.ca/WaterWells/Downloads/Well_Reports.zip  
- Open Government: https://open.alberta.ca/opendata/e8c42d2b-f8e4-4c7f-8540-9f7b3681ee41  

Export or convert to JSON lines / JSON array:

```json
[
  {
    "lat": 53.801,
    "lng": -113.65,
    "depth_m": 28.5,
    "swl_m": 12.0,
    "formation": "Empress / buried channel (typical)",
    "source": "AWWI"
  }
]
```

Save as `data/wells/local-wells.json` (gitignored if large) or set:

```
WATER_WELLS_PATH=/absolute/path/to/wells.json
```

The estimator loads, in order:

1. `WATER_WELLS_PATH` if set  
2. `data/wells/local-wells.json` if present  
3. `data/wells/seed-control.json` (interim regional seed for demos)

## Bedrock topography (AGS Map 610 v2)

- Publication: https://ags.aer.ca/publications/all-publications/map-610  
- Grid: AGS Digital Data 2020-0022 (ASCII) — download once, host statically  
- Until the grid is installed, the service uses a **regional parametric proxy** for bedrock elevation / drift thickness (documented in provenance).

Place a future grid sampler behind `lib/well-depth.js` → `bedrockElevationM(lat, lng)`.

## Confidence tiers

| nearby_well_count | confidence |
|---|---|
| ≥ 8 within search radius | `well_control_dense` |
| 1–7 | `well_control_sparse` |
| 0 | `no_nearby_wells_bedrock_model_only` |
