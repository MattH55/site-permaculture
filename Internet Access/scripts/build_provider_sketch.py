"""Build ISED Approximate Provider Service-Area Sketch polygons for Alberta.

Joins official 25 km² hex centroids (CanHEX) to ISP_Hex_FSI technology /
provider rows, tiles hexes with a Voronoi diagram, and dissolves by
ISED last-mile technology type.
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PUBLIC = ROOT / "public" / "data"

TECH_MAP = {
    "fibre to the home": "ftth",
    "coaxial cable": "cable",
    "dsl": "dsl",
    "fixed wireless": "fixed_wireless",
    "mobile wireless": "mobile",
    "satellite": "satellite",
}
TECH_META = {
    "ftth": {"label": "Fibre to the home", "color": "#4aa3e0"},
    "cable": {"label": "Coaxial cable", "color": "#e05a5a"},
    "dsl": {"label": "DSL", "color": "#9b6bce"},
    "fixed_wireless": {"label": "Fixed wireless", "color": "#c4e38a"},
    "mobile": {"label": "Mobile wireless", "color": "#6ec6c1"},
    "satellite": {"label": "Satellite", "color": "#e0a14a"},
}


def find_map_csv(prefix: str) -> Path:
    folder = RAW / "map_csv"
    for p in folder.iterdir():
        if p.name.startswith(prefix):
            return p
    raise FileNotFoundError(prefix)


def load_ab_hex_points() -> gpd.GeoDataFrame:
    zpath = RAW / "CHX_EXO_CSV.zip"
    with zipfile.ZipFile(zpath) as zf:
        text = io.TextIOWrapper(zf.open("CHX_EXO.csv"), encoding="utf-8-sig", newline="")
        rows = []
        for rec in csv.DictReader(text):
            hid = rec["HEXuid_HEXidu"]
            if not hid.startswith("AB"):
                continue
            rows.append(
                {
                    "hex": hid,
                    "lat": float(rec["Latitude"]),
                    "lon": float(rec["Longitude"]),
                }
            )
    gdf = gpd.GeoDataFrame(
        rows,
        geometry=[Point(r["lon"], r["lat"]) for r in rows],
        crs="EPSG:4326",
    )
    return gdf


def load_isp_ab() -> pd.DataFrame:
    path = find_map_csv("ISP_Hex")
    df = pd.read_csv(path, dtype=str, encoding="latin-1")
    df = df[df["HEXuid_HEXidu"].astype(str).str.startswith("AB")].copy()
    df["hex"] = df["HEXuid_HEXidu"].astype(str)
    df["provider"] = df["Name_Nom"].astype(str).str.strip()
    df["tech"] = df["Technology"].astype(str).str.strip().str.lower().map(TECH_MAP)
    df = df.dropna(subset=["tech"])
    return df[["hex", "provider", "tech"]]


def alberta_outline() -> gpd.GeoDataFrame:
    shp = next((RAW / "ab_boundaries").rglob("AB_CD_2021.shp"))
    gdf = gpd.read_file(shp).to_crs(3400)
    geom = unary_union(gdf.geometry)
    return gpd.GeoDataFrame({"id": [1]}, geometry=[geom], crs="EPSG:3400")


def hex_polygons(points: gpd.GeoDataFrame, outline: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    pts = points.to_crs(3400)
    envelope = outline.geometry.iloc[0].buffer(20000)
    vor = pts.voronoi_polygons(extend_to=envelope)
    cells = gpd.GeoDataFrame(geometry=list(vor.geometry), crs=pts.crs)
    hit = gpd.sjoin(pts[["hex", "geometry"]], cells, how="left", predicate="within")
    hit = hit.drop_duplicates("hex", keep="first")
    cells = cells.reset_index(drop=True)
    cells["cell_i"] = cells.index
    hit = hit.rename(columns={"index_right": "cell_i"})
    hexes = cells.merge(hit[["hex", "cell_i"]], on="cell_i", how="inner")
    hexes = hexes.drop(columns=["cell_i"])
    clipped = gpd.overlay(hexes, outline, how="intersection", keep_geom_type=True)
    clipped = clipped[~clipped.geometry.is_empty].copy()
    return clipped[["hex", "geometry"]]


def slug(name: str) -> str:
    out = []
    for ch in name.lower().strip():
        out.append(ch if ch.isalnum() else "-")
    s = "".join(out)
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-") or "provider"


def dissolve_layers(hexes: gpd.GeoDataFrame, isp: pd.DataFrame) -> gpd.GeoDataFrame:
    joined = hexes.merge(isp, on="hex", how="inner")
    frames = []
    for tech, meta in TECH_META.items():
        sub = joined[joined["tech"] == tech]
        if sub.empty:
            continue
        geom = unary_union(sub.geometry)
        if geom.is_empty:
            continue
        providers = sorted({p for p in sub["provider"] if p and p.lower() != "nan"})
        frames.append(
            {
                "kind": "tech",
                "id": tech,
                "tech": tech,
                "provider": "",
                "label": meta["label"],
                "color": meta["color"],
                "hexes": int(sub["hex"].nunique()),
                "providers": providers,
                "provider_n": len(providers),
                "geometry": geom,
            }
        )
        for name, part in sub.groupby("provider"):
            if not name or str(name).lower() == "nan":
                continue
            pgeom = unary_union(part.geometry)
            if pgeom.is_empty:
                continue
            frames.append(
                {
                    "kind": "provider",
                    "id": f"{slug(str(name))}__{tech}",
                    "tech": tech,
                    "provider": str(name),
                    "label": f"{name} · {meta['label']}",
                    "color": meta["color"],
                    "hexes": int(part["hex"].nunique()),
                    "providers": [str(name)],
                    "provider_n": 1,
                    "geometry": pgeom,
                }
            )
    out = gpd.GeoDataFrame(frames, crs=hexes.crs)
    out["geometry"] = out.geometry.simplify(500, preserve_topology=True)
    return out.to_crs(4326)


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    print("Loading hex centroids...", flush=True)
    points = load_ab_hex_points()
    print(f"  {len(points)} Alberta hexes", flush=True)
    print("Loading ISP / technology rows...", flush=True)
    isp = load_isp_ab()
    print(f"  {len(isp)} last-mile rows, {isp['hex'].nunique()} hexes", flush=True)
    cache = ROOT / "data" / "processed" / "ab-hex-tiles.gpkg"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        print("Loading cached hex tiles...", flush=True)
        hexes = gpd.read_file(cache)
    else:
        print("Building hex tiles...", flush=True)
        outline = alberta_outline()
        hexes = hex_polygons(points, outline)
        hexes.to_file(cache, driver="GPKG")
    print("Dissolving by technology and provider...", flush=True)
    sketch = dissolve_layers(hexes, isp)
    path = PUBLIC / "alberta-provider-sketch.geojson"
    sketch.to_file(path, driver="GeoJSON")
    print(f"Wrote {path} ({path.stat().st_size / 1e6:.2f} MB), {len(sketch)} features", flush=True)
    for rec in sketch.itertuples():
        if rec.kind == "tech":
            print(f"  TECH {rec.id}: {rec.hexes} hexes, {rec.provider_n} providers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
