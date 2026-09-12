# Alberta CARI+ vs broadband

Interactive map of **2021 dissemination areas in Alberta** joining:

- **CARI+ 24-hour emergency department access** (travel time and distance scores) from [Rural Data](https://rural-data.com/mapping-access-to-24-hour-emergency-departments/) / [OSF k7t32](https://osf.io/k7t32/)
- **CARI+ access to population centres** (same release)
- **M-Lab NDT measured speeds** (download, upload, min RTT, ISP) from the public archive documented at [d3f2vqxgk3exj.cloudfront.net/data](https://d3f2vqxgk3exj.cloudfront.net/data/) — NDT7 + annotation2 for Calgary (`yyc`) and Edmonton (`yeg`) servers, Alberta clients only
- **ISED 50/10 advertised household share** kept as a secondary comparison layer
- **Logged dwelling / population parameters** from the 2021 Census Geographic Attribute File (`DBTDWELL2021_IDTLOG2021`, usual-resident dwellings, block population) plus ISED hex `SumTD` / `SumURD` / `SumPop`

## Open the map

```powershell
python -m http.server 8765 --directory public
```

Then open http://localhost:8765/

Site-wide `robots.txt` and `sitemap.xml` belong at the host root:

- https://landintelligence.online/robots.txt
- https://landintelligence.online/sitemap.xml

Those files live in the Land Intelligence site (`Expanding Edge/Expanding Edge Website/public/land-intelligence/`). This app’s pages stay at `/internet-access/`. The root sitemap lists the whole Land Intelligence site plus this map. Submit `https://landintelligence.online/sitemap.xml` in Search Console after you deploy both the site root and `/internet-access/`.

### Distance to a 24-hour emergency department

In the right-hand panel, click the map, search an address, or use your location. The tool reports:

1. **CARI+ 24-hour ED scores** from [figshare 30721058](https://figshare.com/articles/dataset/CARI_for_24-Hour_Emergency_Department_Accessibility/30721058) (standardized 0–18 and normalized 0–1, March 2023), assigned to your 2021 dissemination area. Methodology: McGaughey & Peters, *Canadian Geographies* 2026, [doi:10.1111/cag.70082](https://doi.org/10.1111/cag.70082).
2. **Computed road path** (minutes and km) from the population-weighted DA centroid to the nearest hospital-based 24-hour ED (*Scientific Data* 2024 travel-time methods).
3. **From your pin**: an OSRM driving route to the nearest ED, the same class of estimate the authors used to validate ArcGIS against Google Maps.

Assumptions match the papers: personal vehicle, posted speeds, 2021/current roads, no live traffic, no temporary ED closures.

Colour the map by M-Lab download/upload/RTT, CARI+ scores, advertised 50/10, or logged dwellings. Green dots are individual NDT tests. Restrict to rural/remote DAs (SAC 4–8). Click a DA for the full joined record.

## Rebuild

```powershell
python scripts\ingest_mlab.py 5 6
python scripts\build_alberta_map.py
```

Requires `geopandas`, `pandas`, `shapely`, `pyogrio`, and the files already under `data/raw/` (CARI+ CSVs, ISED map CSVs, Alberta 2021 DA shapefile, 2021 GAF zip).

## How to read the scores

| Field | Meaning |
| --- | --- |
| `ed_min_score` / `ed_dis_score` | CARI+ standardized travel-time and travel-distance to the nearest 24-hour ED (0–18; **higher = more remote**) |
| `ed_min_norm` / `ed_dis_norm` | Same scores scaled 0–1 |
| `cari_ed` | Mean of the two ED normalized scores |
| `popc_*` / `cari_popc` | Same structure for access to population centres |
| `mlab_dl` / `mlab_ul` / `mlab_rtt` | Median M-Lab NDT7 download Mbps, upload Mbps, min RTT (ms) |
| `mlab_n` / `mlab_isp` | Test count in the DA and most common ISP (ASN name) |
| `bb50_label` / `bb50_mid` | ISED advertised share of households with 50/10 Mbps or better (secondary) |
| `tdwell` / `urdwell` / `pop` | Logged total private dwellings, usual-resident dwellings, 2021 population |

DA counts are city-heavy. Use the rural filter, or the hexagon summary in the chart panel, for the land-area picture of broadband.

## Licences

- CARI+: CC BY 4.0 (McGaughey & Peters)
- M-Lab NDT: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- National Broadband Data and PHH/hex attributes: Open Government Licence – Canada
- Alberta census boundaries: adapted from Statistics Canada 2021 boundary files; Open Government Licence – Alberta
- Geographic Attribute File: Statistics Canada 2021
