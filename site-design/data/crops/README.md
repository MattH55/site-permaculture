# Planting catalog (Growing Guide / farmfit integration)

Site reports score crops against climate, soil, and hardiness using EcoCrop-style
rules aligned with **OpenSourceMed Growing Guide → farmfit**
(`…/OpenSourceMed/Growing Guide/farmfit`).

## Default catalog

`alberta-catalog.json` — Alberta-first perennials, food-forest layers, medicinals,
and cover crops. Parameterized like EcoCrop (hardiness, frost-free days, precip,
pH, texture, drainage).

## Hook up the full Growing Guide catalog

When OneDrive / the farmfit repo is available:

1. Export or copy crop records from  
   `Growing Guide/farmfit/src/lib/data/crop-seed.ts`  
   and specialty / growable-medicine taxa into JSON.
2. Save as `data/crops/farmfit-export.json` **or** set:

```
GROWING_GUIDE_CROPS_PATH=C:\path\to\crops.json
```

3. Expected JSON shape (array or `{ "crops": [...] }`):

```json
{
  "crops": [
    {
      "id": "echinacea-purpurea",
      "common_name": "Purple coneflower",
      "scientific_name": "Echinacea purpurea",
      "category": "medicinal",
      "guild_layer": "herbaceous",
      "hardiness_min": "3a",
      "hardiness_max": "9a",
      "frost_free_min_days": 100,
      "precip_min_mm": 350,
      "precip_max_mm": 1200,
      "ph_min": 6,
      "ph_max": 7.5,
      "textures": ["loam", "sandy_loam", "clay_loam"],
      "drainage": ["well", "moderately_well"],
      "chinook_sensitive": false,
      "notes": "…"
    }
  ]
}
```

The loader merges farmfit export **on top of** the Alberta default catalog (by `id`).
