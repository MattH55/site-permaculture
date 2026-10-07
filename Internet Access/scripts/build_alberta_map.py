"""Build Alberta CARI+ vs National Broadband joined layers for the map."""

from __future__ import annotations

import csv
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
PUBLIC = ROOT / "public" / "data"

ARCGIS = (
    "https://services.arcgis.com/wjcPoefzjpzCgffS/arcgis/rest/services/"
    "NationalBroadbandCoverage_gdb/FeatureServer"
)
# Midpoints of ISED 50/10 household-share bands
BB50_MID = {
    "0": 0.0,
    ">0% - 25%": 12.5,
    ">0% to 25%": 12.5,
    ">25% - 50%": 37.5,
    ">25% to 50%": 37.5,
    ">50% - 75%": 62.5,
    ">50% to 75%": 62.5,
    ">75% -  100%": 87.5,
    ">75% to 100%": 87.5,
    ">75% - 100%": 87.5,
}
BB50_RANK = {
    "0": 0,
    ">0% - 25%": 1,
    ">0% to 25%": 1,
    ">25% - 50%": 2,
    ">25% to 50%": 2,
    ">50% - 75%": 3,
    ">50% to 75%": 3,
    ">75% -  100%": 4,
    ">75% to 100%": 4,
    ">75% - 100%": 4,
}
LAYER_BAND = {
    0: (">75% to 100%", 87.5, 4),
    1: (">50% to 75%", 62.5, 3),
    2: (">25% to 50%", 37.5, 2),
    3: (">0% to 25%", 12.5, 1),
}

AB_ENVELOPE = (-120.1, 48.95, -109.95, 60.05)


def find_map_csv(prefix: str) -> Path:
    folder = RAW / "map_csv"
    for p in folder.iterdir():
        if p.name.startswith(prefix):
            return p
    raise FileNotFoundError(prefix)


def load_cari(path: Path, prefix: str) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"DAUID": str})
    df = df.loc[:, ~df.columns.str.match(r"^Unnamed")]
    df["DAUID"] = df["DAUID"].str.zfill(8)
    rename = {
        "MIN_DA_Norm": f"{prefix}_min_norm",
        "DIS_DA_Norm": f"{prefix}_dis_norm",
        "MIN_Score": f"{prefix}_min_score",
        "DIS_Score": f"{prefix}_dis_score",
    }
    return df.rename(columns=rename)


def stream_gaf_alberta() -> pd.DataFrame:
    zpath = RAW / "GAF_2021.zip"
    rows = []
    with zipfile.ZipFile(zpath) as zf:
        name = zf.namelist()[0]
        with zf.open(name) as fh:
            import io

            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            reader = csv.DictReader(text)
            for row in reader:
                if row.get("PRUID_PRIDU") != "48":
                    continue
                rows.append(
                    {
                        "DAUID": str(row["DAUID_ADIDU"]).zfill(8),
                        "CSDUID": row["CSDUID_SDRIDU"],
                        "CSDNAME": row["CSDNAME_SDRNOM"],
                        "CSDTYPE": row["CSDTYPE_SDRGENRE"],
                        "CDNAME": row["CDNAME_DRNOM"],
                        "ERNAME": row["ERNAME_RENOM"],
                        "CMANAME": row["CMANAME_RMRNOM"],
                        "CMATYPE": row["CMATYPE_RMRGENRE"],
                        "POPCTR": row["POPCTRRANAME_CTRPOPRRNOM"],
                        "POPCLASS": row["POPCTRRACLASS_CTRPOPRRCLASSE"],
                        "SACTYPE": row["SACTYPE_CSSGENRE"],
                        "lat": row["DARPLAT_ADLAT"],
                        "lon": row["DARPLONG_ADLONG"],
                        "pop": row["DBPOP2021_IDPOP2021"],
                        "tdwell": row["DBTDWELL2021_IDTLOG2021"],
                        "urdwell": row["DBURDWELL2021_IDRHLOG2021"],
                        "ir": row["DBIR2021_IDRI2021"],
                    }
                )
    gaf = pd.DataFrame(rows)
    for col in ("lat", "lon", "pop", "tdwell", "urdwell"):
        gaf[col] = pd.to_numeric(gaf[col], errors="coerce")
    gaf["ir"] = pd.to_numeric(gaf["ir"], errors="coerce").fillna(0)

    def first_nonempty(s):
        s = s.dropna().astype(str).str.strip()
        s = s[s != ""]
        return s.iloc[0] if len(s) else ""

    agg = (
        gaf.groupby("DAUID", as_index=False)
        .agg(
            CSDUID=("CSDUID", first_nonempty),
            CSDNAME=("CSDNAME", first_nonempty),
            CSDTYPE=("CSDTYPE", first_nonempty),
            CDNAME=("CDNAME", first_nonempty),
            ERNAME=("ERNAME", first_nonempty),
            CMANAME=("CMANAME", first_nonempty),
            CMATYPE=("CMATYPE", first_nonempty),
            POPCTR=("POPCTR", first_nonempty),
            POPCLASS=("POPCLASS", first_nonempty),
            SACTYPE=("SACTYPE", first_nonempty),
            lat=("lat", "first"),
            lon=("lon", "first"),
            pop=("pop", "sum"),
            tdwell=("tdwell", "sum"),
            urdwell=("urdwell", "sum"),
            ir=("ir", "max"),
        )
    )
    return agg


def fetch_coverage_layer(layer_id: int) -> gpd.GeoDataFrame:
    cache = RAW / f"coverage_{layer_id}.geojson"
    if cache.exists() and cache.stat().st_size > 100:
        return gpd.read_file(cache)

    xmin, ymin, xmax, ymax = AB_ENVELOPE
    features = []
    offset = 0
    page = 2000
    while True:
        params = {
            "where": "1=1",
            "geometry": f"{xmin},{ymin},{xmax},{ymax}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "Percent_Coverage",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultOffset": str(offset),
            "resultRecordCount": str(page),
        }
        url = f"{ARCGIS}/{layer_id}/query?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": "SPI-CARI-broadband/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        feats = payload.get("features") or []
        features.extend(feats)
        print(f"  layer {layer_id} offset {offset} +{len(feats)}", flush=True)
        if len(feats) < page or not payload.get("exceededTransferLimit"):
            break
        offset += page
        time.sleep(0.2)

    geo = {"type": "FeatureCollection", "features": features}
    cache.write_text(json.dumps(geo), encoding="utf-8")
    if not features:
        return gpd.GeoDataFrame(columns=["bb50_label", "geometry"], crs="EPSG:4326")
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    label, mid, rank = LAYER_BAND[layer_id]
    gdf["bb50_label"] = gdf.get("Percent_Coverage", label).fillna(label)
    gdf["bb50_mid"] = mid
    gdf["bb50_rank"] = rank
    return gdf


def load_communities() -> gpd.GeoDataFrame:
    path = find_map_csv("Data_Com")
    df = pd.read_csv(path)
    df["Latitude"] = pd.to_numeric(df["Latitude"], errors="coerce")
    df["Longitude"] = pd.to_numeric(df["Longitude"], errors="coerce")
    df = df.dropna(subset=["Latitude", "Longitude"])
    df = df[
        (df["Longitude"].between(AB_ENVELOPE[0], AB_ENVELOPE[2]))
        & (df["Latitude"].between(AB_ENVELOPE[1], AB_ENVELOPE[3]))
    ].copy()
    df["satellite_dep"] = pd.to_numeric(df["satellite_dep"], errors="coerce").fillna(0).astype(int)
    df["no_fibre"] = (
        pd.to_numeric(df["wo_backbone_fibre_sans_fibre_dorsale"], errors="coerce")
        .fillna(0)
        .astype(int)
    )
    df["cti_backbone"] = (
        pd.to_numeric(df["CTI_backbone_dorsale_BPI"], errors="coerce").fillna(0).astype(int)
    )
    gdf = gpd.GeoDataFrame(
        df,
        geometry=[Point(xy) for xy in zip(df["Longitude"], df["Latitude"])],
        crs="EPSG:4326",
    )
    return gdf


def load_hex_ab() -> pd.DataFrame:
    path = find_map_csv("Data_Hex")
    df = pd.read_csv(path)
    df = df[df["HEXuid_HEXidu"].astype(str).str.startswith("AB")].copy()

    def parse_count(v):
        if pd.isna(v):
            return np.nan
        s = str(v).strip()
        if s in {"", "NA", "N/A"}:
            return np.nan
        if s.startswith("<"):
            return 2.0
        try:
            return float(s.replace(",", ""))
        except ValueError:
            return np.nan

    for src, dest in (
        ("SumPop_2021_SommePop", "hex_pop"),
        ("SumURD_2021_SommeRH", "hex_urdwell"),
        ("SumTD_2021_SommeTL", "hex_tdwell"),
    ):
        df[dest] = df[src].map(parse_count)
    df["avail_5_1"] = df["Expr1"].astype(str).str.upper().eq("T").astype(int)
    label = df["Expr2"].astype(str).str.strip()
    df["bb50_label"] = label.replace({"0": "0%"})
    df["bb50_mid"] = label.map(lambda x: BB50_MID.get(x, 0.0))
    df["bb50_rank"] = label.map(lambda x: BB50_RANK.get(x, 0)).fillna(0).astype(int)
    return df


def nearest_community(da_pts: gpd.GeoDataFrame, comm: gpd.GeoDataFrame) -> pd.DataFrame:
    left = da_pts.to_crs(3400)
    right = comm.to_crs(3400)
    joined = gpd.sjoin_nearest(
        left[["DAUID", "geometry"]],
        right[["Name_en", "satellite_dep", "no_fibre", "cti_backbone", "geometry"]],
        how="left",
        distance_col="place_m",
    )
    joined = joined.sort_values("place_m").drop_duplicates("DAUID", keep="first")
    return joined[
        ["DAUID", "Name_en", "satellite_dep", "no_fibre", "cti_backbone", "place_m"]
    ].rename(columns={"Name_en": "place"})


def load_mlab_tests() -> pd.DataFrame:
    path = PROC / "alberta-mlab-tests.csv"
    if not path.exists():
        raise FileNotFoundError(path)
    df = pd.read_csv(path)
    df["lat"] = pd.to_numeric(df["lat"], errors="coerce")
    df["lon"] = pd.to_numeric(df["lon"], errors="coerce")
    df["download_mbps"] = pd.to_numeric(df["download_mbps"], errors="coerce")
    df["upload_mbps"] = pd.to_numeric(df["upload_mbps"], errors="coerce")
    df["download_rtt_ms"] = pd.to_numeric(df.get("download_rtt_ms"), errors="coerce")
    return df.dropna(subset=["lat", "lon"])


def aggregate_mlab_to_da(das: gpd.GeoDataFrame, tests: pd.DataFrame) -> tuple[pd.DataFrame, gpd.GeoDataFrame]:
    pts = gpd.GeoDataFrame(
        tests.copy(),
        geometry=[Point(xy) for xy in zip(tests["lon"], tests["lat"])],
        crs="EPSG:4326",
    )
    joined = gpd.sjoin(
        pts.to_crs(3400),
        das[["DAUID", "geometry"]].to_crs(3400),
        how="inner",
        predicate="within",
    )
    if joined.empty:
        # fall back to nearest DA for points that miss polygon edges
        joined = gpd.sjoin_nearest(
            pts.to_crs(3400),
            das[["DAUID", "geometry"]].to_crs(3400),
            how="left",
            max_distance=25000,
        )

    def top_isp(s):
        s = s.dropna().astype(str)
        s = s[s != ""]
        return s.value_counts().index[0] if len(s) else ""

    agg = (
        joined.groupby("DAUID", as_index=False)
        .agg(
            mlab_n=("uuid", "count"),
            mlab_dl=("download_mbps", "median"),
            mlab_ul=("upload_mbps", "median"),
            mlab_rtt=("download_rtt_ms", "median"),
            mlab_isp=("isp", top_isp),
            mlab_city=("city", top_isp),
        )
    )
    pts_out = pts.copy()
    return agg, pts_out


def spatial_bb50(da_pts: gpd.GeoDataFrame) -> pd.DataFrame:
    frames = []
    for layer_id in range(4):
        print(f"Fetching 50/10 coverage layer {layer_id}...", flush=True)
        gdf = fetch_coverage_layer(layer_id)
        if gdf.empty:
            continue
        if "bb50_mid" not in gdf.columns:
            label, mid, rank = LAYER_BAND[layer_id]
            gdf["bb50_label"] = label
            gdf["bb50_mid"] = mid
            gdf["bb50_rank"] = rank
        frames.append(gdf[["bb50_label", "bb50_mid", "bb50_rank", "geometry"]])
    if not frames:
        out = da_pts[["DAUID"]].copy()
        out["bb50_label"] = "0%"
        out["bb50_mid"] = 0.0
        out["bb50_rank"] = 0
        return out

    cov = pd.concat(frames, ignore_index=True)
    cov = gpd.GeoDataFrame(cov, geometry="geometry", crs="EPSG:4326")
    cov = cov.to_crs(3400)
    pts = da_pts.to_crs(3400)
    hit = gpd.sjoin(pts[["DAUID", "geometry"]], cov, how="left", predicate="intersects")
    hit = hit.sort_values("bb50_rank", ascending=False).drop_duplicates("DAUID", keep="first")
    hit["bb50_label"] = hit["bb50_label"].fillna("0%")
    hit["bb50_mid"] = hit["bb50_mid"].fillna(0.0)
    hit["bb50_rank"] = hit["bb50_rank"].fillna(0).astype(int)
    return hit[["DAUID", "bb50_label", "bb50_mid", "bb50_rank"]]


def pearson(x, y) -> float | None:
    mask = np.isfinite(x) & np.isfinite(y)
    if mask.sum() < 10:
        return None
    return float(np.corrcoef(x[mask], y[mask])[0, 1])


def main() -> int:
    PROC.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    print("Loading CARI+...", flush=True)
    ed = load_cari(RAW / "cari_ed" / "CARI_24_HR_ED.csv", "ed")
    gen = load_cari(RAW / "CARI_Plus_Gen_Pop_Final.csv", "popc")
    cari = ed.merge(gen, on="DAUID", how="outer")

    print("Streaming Alberta GAF blocks...", flush=True)
    gaf = stream_gaf_alberta()
    print(f"  {len(gaf)} Alberta DAs in GAF", flush=True)

    print("Reading DA polygons...", flush=True)
    da_path = next((RAW / "ab_boundaries").rglob("AB_DA_2021.shp"))
    das = gpd.read_file(da_path)
    das["DAUID"] = das["DAUID"].astype(str).str.zfill(8)
    das = das.to_crs(4326)

    print("Reading CSD names...", flush=True)
    csd_path = next((RAW / "ab_boundaries").rglob("AB_CSD_2021.shp"))
    csds = gpd.read_file(csd_path)
    if "CSDNAME" not in csds.columns:
        # keep whatever name field exists for optional overlay
        pass

    table = das[["DAUID", "LANDAREA", "geometry"]].merge(gaf, on="DAUID", how="left")
    table = table.merge(cari, on="DAUID", how="left")

    pts_df = table.dropna(subset=["lat", "lon"]).copy()
    pts = gpd.GeoDataFrame(
        pts_df[["DAUID", "lat", "lon"]],
        geometry=[Point(xy) for xy in zip(pts_df["lon"], pts_df["lat"])],
        crs="EPSG:4326",
    )

    print("Joining nearest ISED communities...", flush=True)
    comm = load_communities()
    near = nearest_community(pts, comm)
    table = table.merge(near, on="DAUID", how="left")

    print("Joining M-Lab NDT measured speeds...", flush=True)
    mlab_pts = None
    try:
        tests = load_mlab_tests()
        mlab_agg, mlab_pts = aggregate_mlab_to_da(table, tests)
        table = table.merge(mlab_agg, on="DAUID", how="left")
        print(f"  {int(table['mlab_n'].fillna(0).gt(0).sum())} DAs with M-Lab tests", flush=True)
    except Exception as exc:
        print(f"  M-Lab join failed ({exc})", flush=True)
        table["mlab_n"] = 0
        table["mlab_dl"] = np.nan
        table["mlab_ul"] = np.nan
        table["mlab_rtt"] = np.nan
        table["mlab_isp"] = ""
        table["mlab_city"] = ""

    print("Joining ISED 50/10 coverage as secondary advertised layer...", flush=True)
    try:
        bb = spatial_bb50(pts)
        table = table.merge(bb, on="DAUID", how="left")
    except Exception as exc:
        print(f"  coverage fetch failed ({exc}); falling back to unmatched 0%", flush=True)
        table["bb50_label"] = "0%"
        table["bb50_mid"] = 0.0
        table["bb50_rank"] = 0

    table["bb50_label"] = table["bb50_label"].fillna("0%")
    table["bb50_mid"] = table["bb50_mid"].fillna(0.0)
    table["bb50_rank"] = table["bb50_rank"].fillna(0).astype(int)
    table["mlab_n"] = pd.to_numeric(table.get("mlab_n"), errors="coerce").fillna(0).astype(int)

    hex_ab = load_hex_ab()
    hex_stats = {
        "hex_count": int(len(hex_ab)),
        "hex_with_pop": int(hex_ab["hex_pop"].notna().sum()),
        "share_5_1": float(hex_ab["avail_5_1"].mean()) if len(hex_ab) else None,
        "share_50_10_over_75": float((hex_ab["bb50_rank"] == 4).mean()) if len(hex_ab) else None,
        "hex_bb50_rank_counts": {
            str(int(k)): int(v) for k, v in hex_ab["bb50_rank"].value_counts().sort_index().items()
        },
    }

    # Composite CARI+ index: mean of ED travel-time and distance normalized scores
    table["cari_ed"] = table[["ed_min_norm", "ed_dis_norm"]].mean(axis=1)
    table["cari_popc"] = table[["popc_min_norm", "popc_dis_norm"]].mean(axis=1)
    missing_ed = table["cari_ed"].isna()
    if missing_ed.any():
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from fill_missing_ed_access import knn_scores, load_ref

        ref = load_ref()
        cent = pd.read_csv(RAW / "cari_ed" / "DA_Centroid_to_24hrED.csv", dtype={"From_DAUID": str})
        cent["From_DAUID"] = cent["From_DAUID"].str.zfill(8)
        travel = cent.set_index("From_DAUID")
        for idx in table.index[missing_ed]:
            da = str(table.at[idx, "DAUID"]).zfill(8)
            minutes = km = None
            if da in travel.index:
                minutes = pd.to_numeric(travel.at[da, "Total_Minutes"], errors="coerce")
                km = pd.to_numeric(travel.at[da, "Total_Kilometers"], errors="coerce")
                if isinstance(minutes, pd.Series):
                    minutes = minutes.iloc[0]
                    km = km.iloc[0]
                if pd.isna(minutes):
                    minutes = None
                if pd.isna(km):
                    km = None
            scores = knn_scores(minutes, km, ref)
            table.at[idx, "ed_min_score"] = scores["min_score"]
            table.at[idx, "ed_dis_score"] = scores["dis_score"]
            table.at[idx, "ed_min_norm"] = scores["min_norm"]
            table.at[idx, "ed_dis_norm"] = scores["dis_norm"]
            table.at[idx, "cari_ed"] = scores["cari"]
        print(f"  Filled CARI+ 24-hour ED scores for {int(missing_ed.sum())} DAs omitted from figshare", flush=True)

    # Rural flag: SAC 1=CMA, 2=CA, 3=strong metro influence ... 7/8 rural/remote
    table["sactype"] = pd.to_numeric(table["SACTYPE"], errors="coerce")
    table["rural"] = table["sactype"].fillna(0).ge(4).astype(int)

    print("Simplifying geometries...", flush=True)
    simple = table.to_crs(3400)
    simple["geometry"] = simple.geometry.simplify(250, preserve_topology=True)
    simple = simple.to_crs(4326)
    simple = simple[~simple.geometry.is_empty & simple.geometry.notna()].copy()

    keep_cols = [
        "DAUID",
        "CSDNAME",
        "CSDTYPE",
        "CDNAME",
        "ERNAME",
        "CMANAME",
        "POPCTR",
        "place",
        "LANDAREA",
        "pop",
        "tdwell",
        "urdwell",
        "ir",
        "rural",
        "sactype",
        "ed_min_norm",
        "ed_dis_norm",
        "ed_min_score",
        "ed_dis_score",
        "popc_min_norm",
        "popc_dis_norm",
        "popc_min_score",
        "popc_dis_score",
        "cari_ed",
        "cari_popc",
        "mlab_n",
        "mlab_dl",
        "mlab_ul",
        "mlab_rtt",
        "mlab_isp",
        "mlab_city",
        "bb50_label",
        "bb50_mid",
        "bb50_rank",
        "satellite_dep",
        "no_fibre",
        "cti_backbone",
        "place_m",
        "lat",
        "lon",
        "geometry",
    ]
    for col in keep_cols:
        if col not in simple.columns:
            simple[col] = np.nan
    out = simple[keep_cols].copy()
    rename = {
        "DAUID": "da",
        "CSDNAME": "csd",
        "CSDTYPE": "csd_type",
        "CDNAME": "cd",
        "ERNAME": "er",
        "CMANAME": "cma",
        "POPCTR": "popctr",
        "LANDAREA": "area_km2",
        "place_m": "place_km",
    }
    out = out.rename(columns=rename)
    out["place_km"] = pd.to_numeric(out["place_km"], errors="coerce") / 1000.0
    num_cols = [
        "area_km2",
        "pop",
        "tdwell",
        "urdwell",
        "ir",
        "rural",
        "sactype",
        "ed_min_norm",
        "ed_dis_norm",
        "ed_min_score",
        "ed_dis_score",
        "popc_min_norm",
        "popc_dis_norm",
        "popc_min_score",
        "popc_dis_score",
        "cari_ed",
        "cari_popc",
        "mlab_n",
        "mlab_dl",
        "mlab_ul",
        "mlab_rtt",
        "bb50_mid",
        "bb50_rank",
        "satellite_dep",
        "no_fibre",
        "cti_backbone",
        "place_km",
        "lat",
        "lon",
    ]
    for col in num_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce")
        if col in {"pop", "tdwell", "urdwell", "ir", "rural", "sactype", "bb50_rank", "satellite_dep", "no_fibre", "cti_backbone", "mlab_n"}:
            out[col] = out[col].fillna(0).astype(int)
        else:
            out[col] = out[col].round(4)

    geo_path = PUBLIC / "alberta-da.geojson"
    out.to_file(geo_path, driver="GeoJSON")
    print(f"Wrote {geo_path} ({geo_path.stat().st_size/1e6:.2f} MB)", flush=True)

    # Compact scatter / table extract
    scatter = pd.DataFrame(out.drop(columns="geometry"))
    scatter_path = PUBLIC / "alberta-da.csv"
    scatter.to_csv(scatter_path, index=False)

    comm_out = comm.rename(
        columns={
            "Name_en": "name",
            "Latitude": "lat",
            "Longitude": "lon",
            "satellite_dep": "satellite",
            "no_fibre": "no_fibre",
            "cti_backbone": "cti",
        }
    )[["name", "lat", "lon", "satellite", "no_fibre", "cti"]]
    comm_out.to_json(PUBLIC / "alberta-places.json", orient="records")

    if mlab_pts is not None and len(mlab_pts):
        sample = mlab_pts.dropna(subset=["download_mbps"]).copy()
        if len(sample) > 4000:
            sample = sample.sample(4000, random_state=1)
        pts_json = [
            {
                "lat": float(r.lat),
                "lon": float(r.lon),
                "dl": None if pd.isna(r.download_mbps) else round(float(r.download_mbps), 2),
                "ul": None if pd.isna(r.upload_mbps) else round(float(r.upload_mbps), 2),
                "rtt": None if pd.isna(r.download_rtt_ms) else round(float(r.download_rtt_ms), 1),
                "isp": "" if pd.isna(r.isp) else str(r.isp),
                "city": "" if pd.isna(r.city) else str(r.city),
            }
            for r in sample.itertuples()
        ]
        (PUBLIC / "alberta-mlab-points.json").write_text(json.dumps(pts_json), encoding="utf-8")

    valid = scatter.dropna(subset=["cari_ed", "mlab_dl"])
    valid_bb = scatter.dropna(subset=["cari_ed", "bb50_mid"])
    summary = {
        "da_count": int(len(out)),
        "pop": int(out["pop"].sum()),
        "tdwell": int(out["tdwell"].sum()),
        "urdwell": int(out["urdwell"].sum()),
        "mean_cari_ed": float(out["cari_ed"].mean(skipna=True)),
        "mean_cari_popc": float(out["cari_popc"].mean(skipna=True)),
        "mean_ed_min_score": float(out["ed_min_score"].mean(skipna=True)),
        "mean_ed_dis_score": float(out["ed_dis_score"].mean(skipna=True)),
        "median_ed_min_score": float(out["ed_min_score"].median(skipna=True)),
        "share_rural_da": float(out["rural"].mean()),
        "mlab_tests": int(out["mlab_n"].sum()),
        "mlab_das": int((out["mlab_n"] > 0).sum()),
        "median_mlab_dl": float(out.loc[out["mlab_n"] > 0, "mlab_dl"].median()) if (out["mlab_n"] > 0).any() else None,
        "median_mlab_ul": float(out.loc[out["mlab_n"] > 0, "mlab_ul"].median()) if (out["mlab_n"] > 0).any() else None,
        "median_mlab_rtt": float(out.loc[out["mlab_n"] > 0, "mlab_rtt"].median()) if (out["mlab_n"] > 0).any() else None,
        "share_50_10_over_75": float((out["bb50_rank"] == 4).mean()),
        "share_50_10_zero": float((out["bb50_rank"] == 0).mean()),
        "share_satellite_place": float((out["satellite_dep"] == 1).mean()),
        "share_no_fibre": float((out["no_fibre"] == 1).mean()),
        "corr_cari_ed_mlab_dl": pearson(valid["cari_ed"].to_numpy(), valid["mlab_dl"].to_numpy()) if len(valid) else None,
        "corr_cari_ed_bb50": pearson(valid_bb["cari_ed"].to_numpy(), valid_bb["bb50_mid"].to_numpy()),
        "corr_cari_ed_rural": pearson(
            scatter.dropna(subset=["cari_ed"])["cari_ed"].to_numpy(),
            scatter.dropna(subset=["cari_ed"])["rural"].to_numpy(),
        ),
        "corr_ed_min_tdwell": pearson(
            scatter.dropna(subset=["ed_min_score", "tdwell"])["ed_min_score"].to_numpy(),
            np.log1p(scatter.dropna(subset=["ed_min_score", "tdwell"])["tdwell"].to_numpy()),
        ),
        "bb50_rank_counts": {
            str(int(k)): int(v) for k, v in out["bb50_rank"].value_counts().sort_index().items()
        },
        "hex": hex_stats,
        "sources": {
            "cari_ed": "McGaughey & Peters CARI+ 24-hour ED (OSF k7t32, 2021 DA)",
            "cari_popc": "McGaughey & Peters CARI+ access to population centres (OSF k7t32)",
            "broadband": "M-Lab NDT7 measured download/upload/RTT from archive-measurement-lab (https://d3f2vqxgk3exj.cloudfront.net/data/)",
            "advertised": "ISED National Broadband Data 50/10 household-share bands (secondary)",
            "logged": "Statistics Canada 2021 GAF DBTDWELL2021_IDTLOG2021 / DBURDWELL / DBPOP, plus ISED hex SumTD/SumURD/SumPop",
        },
    }
    (PUBLIC / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (PROC / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
