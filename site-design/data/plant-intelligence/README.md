# Plant Intelligence

Phase 1 MVP of `lib/Land Intelligence Plant Intelligence Ingestion Specification.md`.

The plant knowledge base is **separate** from the 3D land model. They meet at `site_environment` fields (temperature, precipitation, solar kWh/m², soil pH/texture/drainage, rooting depth, space).

## Run ingestion

```bash
# EcoCrop CSV is downloaded to raw/ecocrop/EcoCrop_DB.csv (FAO EcoCrop via OpenCLIM dump)
node scripts/ingest-plant-intelligence.mjs
# Optional GBIF name match for curated catalog taxa:
node scripts/ingest-plant-intelligence.mjs --gbif=40
```

Writes `canonical.json` (≥ 2,500 EcoCrop taxa + Alberta catalog overlays).

## Sources

| Source | Role | Access |
|---|---|---|
| FAO EcoCrop | Climate, pH, light, drainage, texture, altitude | Local CSV (`raw/ecocrop/`) |
| USDA PLANTS | Hardiness, soils, NA range | Via existing `plant-specs.json` |
| PFAF | Temperate traits | Via `plant-specs.json` |
| LI catalogs | Alberta natives / farmfit | `data/crops/*.json` |
| GBIF | Taxonomy + optional AB occurrences | API, optional `--gbif` |

TRY is Phase 2 (official access required). Raw payloads stay immutable; a source change is a new checksum.

## 3D + Alberta economics

Click-to-place planting on the 3D twin builds a `site_environment` (solar, soil, climate) and ranks plants with **separate** biological / commercial / market / utility scores.

```
GET /api/plants/recommend?rank=cost|return|food|utility_per_dollar|biological|overall
GET /api/plants/amelanchier-alnifolia/prices?latitude=53.55&longitude=-113.5
GET /api/plants/malus-domestica/economics
GET /api/vendors/nearby?latitude=53.55&longitude=-113.5
POST /api/property/simulate-planting
POST /api/property/scenarios
```

Nursery prices: Cheyenne Tree Farm published retail lists (2024 caliper / 2026 potted) plus TreeTime catalog searches. Freshness is labeled (`current` … `archival`). Retail is never mixed with wholesale.

## Recommend

```
GET /api/plants/recommend?latitude=53.55&longitude=-113.5&temperature_min_c=-30&annual_precipitation_mm=450&soil_ph=6.5&hardiness_zone=3a&max_results=20
POST /api/plants/recommend   { site environment JSON }
GET /api/sites/:siteId/plants?purpose=native
```

Scoring: `climate × solar × soil × water × space × ecological` after hard constraints. Unknown fields lower **confidence**, not automatic rejection.

Units internally: °C, mm/year, m, kWh/m².

## Schema

PostgreSQL/PostGIS DDL: `lib/plant-intelligence/schema.sql`. Runtime store is JSON until Postgres is provisioned.
