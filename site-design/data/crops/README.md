# Planting catalog (Growing Guide / farmfit + Alberta natives)

Site reports score crops against climate, soil, and hardiness using EcoCrop-style
rules aligned with **OpenSourceMed Growing Guide → farmfit**, then **boost Alberta
natives** and **penalize tropical** species.

## Default catalogs (bundled)

| File | Contents |
|---|---|
| `alberta-catalog.json` | Cold-hardy food forest, medicinals, annuals, covers |
| `alberta-natives.json` | **Alberta-native** trees, shrubs, prairie forbs/grasses |

Load order: base catalog → natives → farmfit export (by `id`).

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
