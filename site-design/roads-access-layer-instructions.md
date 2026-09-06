# Task: Add a Roads/Access & Amenity-Distance Layer to the 3D Property Map

## Goal
Populate the existing schema fields — distance to nearest settlement, distance to nearest city center (with city name), distance to other amenities — using local government data where available, OpenStreetMap as the general-purpose fallback, and Overture Maps as a last resort where OSM coverage is thin. Unlike the canopy/water layers, this one is usually a **merge**, not a strict either/or: different sources are often better for different sub-fields even within the same parcel.

## Data sources

1. **AltaLIS / Alberta Transportation — Roads** (Alberta parcels only)
   - Classified road network (highway/local, paved/gravel), province-wide, government-maintained.
   - Use for: nearest-road distance, road class/surface type (relevant to site-access notes in reports).

2. **Statistics Canada Population Centres (POPCTR) & named places** (Canada-wide)
   - Official settlement points/polygons with names and population.
   - Use for: "nearest settlement" and "nearest city center (with city name)" fields — these need an authoritative name, which raw OSM place tags don't reliably guarantee.

3. **OpenStreetMap (Overpass API or regional extracts)** — primary for amenities everywhere, primary for everything outside Canada (e.g. Honduras/Roatán parcels)
   - Use for: amenity POIs — grocery, hospital/clinic, school, fire station, fuel — via standard OSM tags (`shop=supermarket`, `amenity=hospital`, etc.)
   - Also usable as a secondary road network source to fill gaps in AltaLIS coverage.
   - Coverage quality varies a lot by region — dense and reliable in urban/settled Alberta, much thinner in remote areas and in parts of rural Honduras. Treat OSM completeness as itself a per-region variable, not a constant.

4. **Fallback: Overture Maps (Places + Transportation themes)**
   - Global, aggregates multiple commercial + OSM sources with regular refresh cycles.
   - Use only where OSM returns nothing or clearly incomplete results (e.g. zero amenities within a plausible radius, or a road network with obvious gaps) — it can fill holes OSM has in some regions, though it isn't uniformly better everywhere.

## Decision logic (pseudocode)

```
function get_access_layer(parcel_point, country):
    result = {}

    if country == "Canada":
        result.nearest_road = fetch_altalis_roads(parcel_point)   # if Alberta
        result.settlement = fetch_statcan_popctr(parcel_point)    # named, authoritative

    osm_amenities = fetch_osm_amenities(parcel_point, radius_km=25)
    if is_sparse(osm_amenities, expected_types=["grocery","hospital","school","fuel"]):
        overture_amenities = fetch_overture_places(parcel_point, radius_km=25)
        osm_amenities = merge_fill_gaps(osm_amenities, overture_amenities)

    result.amenities = osm_amenities

    if not result.get("nearest_road"):
        result.nearest_road = fetch_osm_roads(parcel_point)

    if not result.get("settlement"):
        result.settlement = fetch_osm_or_overture_place(parcel_point)

    return result
```

`is_sparse` should be a real completeness check (e.g. "no amenity of type X found within N km when population density / imagery suggests one should exist"), not a fixed count threshold — what counts as sparse in rural Alberta and rural Honduras will differ.

## Processing steps

1. For each amenity type in the schema (grocery, hospital, school, fire station, fuel, etc.), compute straight-line distance from parcel centroid, and flag if road-network routing distance is wanted as a future enhancement (straight-line will understate real travel distance in areas with sparse road connectivity — worth noting in the report text either way).
2. Deduplicate amenities that appear in both OSM and Overture results (match on name + proximity) before computing nearest-of-type.
3. For settlement/city-center fields, prefer the StatsCan-sourced name in Canada; for non-Canada parcels, use the OSM/Overture place name and tag it as such.
4. Attach `data_source` per field, since different fields on the same parcel can legitimately come from different sources.

## Output schema

```json
{
  "nearest_road": { "distance_m": 0.0, "road_class": "", "surface": "", "data_source": "" },
  "nearest_settlement": { "name": "", "distance_m": 0.0, "data_source": "" },
  "nearest_city_center": { "name": "", "distance_m": 0.0, "data_source": "" },
  "amenities": [
    { "type": "grocery", "name": "", "distance_m": 0.0, "data_source": "" }
  ]
}
```

## Confidence flagging

- `ALTALIS_ROADS`, `STATCAN_POPCTR` → high confidence.
- `OSM` → moderate confidence by default; treat as high in dense urban/settled areas and note lower confidence when the surrounding region has visibly thin OSM tagging (few nodes/ways in the query radius).
- `OVERTURE_FALLBACK` → moderate/low confidence — note it's a supplementary source when it appears in a report.

## Caching

Cache per parcel point + radius, same pattern as the other layers. Amenity data changes faster than roads/terrain (businesses open/close), so use a shorter cache TTL for the amenities sub-layer than for the road network sub-layer.
