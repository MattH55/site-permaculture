# Planting catalog (Growing Guide / farmfit + Alberta natives)

Site reports score crops against climate, soil, and hardiness using EcoCrop-style
rules aligned with **OpenSourceMed Growing Guide → farmfit**, then **boost Alberta
natives** and **penalize tropical** species.

## Default catalogs (bundled)

| File | Contents |
|---|---|
| `vendor-catalog.json` | **Scraped plant varieties** from seed/nursery vendors (breadth) |
| `vendor-listings.json` | Raw product listings (title, URL, vendor) from the scrape |
| `alberta-catalog.json` | Curated cold-hardy food forest, medicinals, annuals, covers |
| `alberta-natives.json` | **Alberta-native** trees, shrubs, prairie forbs/grasses |

Load order: vendor catalog → alberta catalog → natives → farmfit export (by `id`).  
Curated packs **overwrite** agronomic fields for matching ids; **supplier links merge**.

## Refresh vendor plant lists

```bash
npm run scrape:vendors
```

Scrapes Shopify/WooCommerce/sitemaps/HTML plant finders for vendors in `vendors.json` (plant sellers only — not Amazon/fertilizer). Re-run periodically; stock and names change.

## Plant growing specifications

| Priority | Source | Role | Access |
|----------|--------|------|--------|
| 1 | **[Permapeople](https://permapeople.org)** | Primary API — layer/guild, light, water, edible | Free API keys (CC BY-SA 4.0) |
| 2 | **[PFAF](https://pfaf.org)** | Richest temperate content — hardiness, soil/shade/moisture, edibility 0–5, N-fix, food forest | Local SQLite offline mirror (not live scrape) |
| 3 | **[USDA PLANTS](https://plants.usda.gov)** | NA range, Alberta occurrence, FFD, precip, pH, soils | Public domain REST |
| 4 | **[Perenual](https://perenual.com)** | Optional freemium fallback | `PERENUAL_API_KEY` |

```bash
# Once: community PFAF mirror (~47 MB) — attribute pfaf.org
npm run pfaf:download

# Curated Alberta crops → PFAF + USDA (+ Permapeople if keys set)
npm run enrich:plant-specs:curated

# Broader catalog
# $env:PERMAPEOPLE_KEY_ID="..."; $env:PERMAPEOPLE_KEY_SECRET="..."
npm run enrich:plant-specs -- --limit 200
```

Writes `data/crops/plant-specs.json`. Scorer sets `spec_source` e.g. `pfaf+usda_plants`.

**PFAF licensing:** Official bulk DB sold on pfaf.org. We use the [community SQLite mirror](https://github.com/saulshanabrook/pfaf-data) for research/offline only — **attribute pfaf.org**; do not redistribute the raw DB commercially without a PFAF license. `data/crops/pfaf/data.sqlite` is gitignored.

**Attribution:** Permapeople.org (CC BY-SA 4.0); pfaf.org; USDA PLANTS (public domain).

## Export from farmfit

From `site-design`:

```bash
node scripts/export-farmfit-crops.mjs --guide "C:\Users\...\OpenSourceMed\Growing Guide"
```

Or from farmfit (script copied there as `scripts/export-crops-for-site-design.mjs`):

```bash
cd farmfit
node scripts/export-crops-for-site-design.mjs --guide ".."
```

Writes `data/crops/farmfit-export.json` (and `farmfit/public/crops-export.json` if writable).

**Default filter drops tropical / hardiness-min ≥ 8a crops.** Use `--all` to keep everything.

Env: `GROWING_GUIDE_PATH`, `GROWING_GUIDE_CROPS_PATH`.

## JSON shape

```json
{
  "crops": [
    {
      "id": "chokecherry",
      "common_name": "Chokecherry",
      "scientific_name": "Prunus virginiana",
      "category": "shrub",
      "guild_layer": "shrub",
      "hardiness_min": "2a",
      "hardiness_max": "7a",
      "frost_free_min_days": 90,
      "precip_min_mm": 300,
      "precip_max_mm": 900,
      "ph_min": 5.5,
      "ph_max": 7.5,
      "textures": ["loam", "sandy_loam"],
      "drainage": ["well", "moderately_well"],
      "chinook_sensitive": false,
      "alberta_native": true,
      "notes": "…"
    }
  ]
}
```
