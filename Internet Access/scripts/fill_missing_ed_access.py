"""Fill 24-hour ED travel times and CARI+ scores for every Alberta 2021 DA.

figshare 30721058 omits eight unpopulated 2021 DAs (Willmore Wilderness and
northern Wood Buffalo / Old Fort). Companion centroid travel times exist for
five of them. The rest get an OSRM driving route to the nearest Alberta
hospital-based 24-hour ED. Scores are assigned from official Alberta DAs with
the most similar minutes and kilometres (k-nearest neighbours on log scale).
"""

from __future__ import annotations

import json
import math
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "cari_ed"
PUBLIC = ROOT / "public" / "data"

MISSING = {
    "48140055",
    "48160089",
    "48160091",
    "48160092",
    "48160094",
    "48160095",
    "48160101",
    "48160102",
}


def _num(v):
    if v is None or v == "":
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def knn_scores(minutes: float | None, km: float | None, ref: pd.DataFrame, k: int = 8) -> dict:
    if minutes is None and km is None:
        return {
            "min_score": 18.0,
            "dis_score": 18.0,
            "min_norm": 1.0,
            "dis_norm": 1.0,
            "cari": 1.0,
        }
    dists = []
    for r in ref.itertuples(index=False):
        parts = []
        if minutes and r.minutes and r.minutes > 0:
            parts.append((math.log(minutes) - math.log(r.minutes)) ** 2)
        if km and r.km and r.km > 0:
            parts.append((math.log(km) - math.log(r.km)) ** 2)
        if not parts:
            continue
        dists.append((math.sqrt(sum(parts) / len(parts)), r))
    dists.sort(key=lambda t: t[0])
    take = dists[:k]
    if not take:
        return knn_scores(None, None, ref, k)
    if take[0][0] < 1e-12:
        r = take[0][1]
        cari = (float(r.min_norm) + float(r.dis_norm)) / 2
        return {
            "min_score": round(float(r.min_score), 3),
            "dis_score": round(float(r.dis_score), 3),
            "min_norm": round(float(r.min_norm), 4),
            "dis_norm": round(float(r.dis_norm), 4),
            "cari": round(float(cari), 4),
        }
    ws, ms, ds, mn, dn = [], 0.0, 0.0, 0.0, 0.0
    for dist, r in take:
        w = 1.0 / (dist + 1e-6)
        ws.append(w)
        ms += w * float(r.min_score)
        ds += w * float(r.dis_score)
        mn += w * float(r.min_norm)
        dn += w * float(r.dis_norm)
    tw = sum(ws)
    return {
        "min_score": round(min(18.0, ms / tw), 3),
        "dis_score": round(min(18.0, ds / tw), 3),
        "min_norm": round(min(1.0, mn / tw), 4),
        "dis_norm": round(min(1.0, dn / tw), 4),
        "cari": round(min(1.0, (mn + dn) / (2 * tw)), 4),
    }


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def osrm_route(lat, lon, elat, elon) -> dict | None:
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{lon},{lat};{elon},{elat}?overview=false"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "landintelligence-ed-fill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    if data.get("code") != "Ok" or not data.get("routes"):
        return None
    rt = data["routes"][0]
    return {"min": rt["duration"] / 60.0, "km": rt["distance"] / 1000.0}


def nearest_osrm(lat: float, lon: float, eds: list[dict]) -> dict | None:
    ranked = sorted(eds, key=lambda e: haversine_km(lat, lon, e["lat"], e["lon"]))
    best = None
    for ed in ranked[:8]:
        rt = osrm_route(lat, lon, ed["lat"], ed["lon"])
        if not rt:
            continue
        if best is None or rt["min"] < best["min"]:
            best = {**rt, "ed": ed["name"], "city": ed["city"], "elat": ed["lat"], "elon": ed["lon"]}
    return best


def load_ref() -> pd.DataFrame:
    cari = pd.read_csv(RAW / "CARI_24_HR_ED.csv", dtype={"DAUID": str})
    cari = cari.loc[:, ~cari.columns.str.match(r"^Unnamed")]
    cari["DAUID"] = cari["DAUID"].str.zfill(8)
    cari = cari[cari["DAUID"].str.startswith("48")]
    cent = pd.read_csv(RAW / "DA_Centroid_to_24hrED.csv", dtype={"From_DAUID": str})
    cent["From_DAUID"] = cent["From_DAUID"].str.zfill(8)
    m = cari.merge(cent, left_on="DAUID", right_on="From_DAUID", how="inner")
    return pd.DataFrame(
        {
            "da": m["DAUID"],
            "minutes": pd.to_numeric(m["Total_Minutes"], errors="coerce"),
            "km": pd.to_numeric(m["Total_Kilometers"], errors="coerce"),
            "min_score": pd.to_numeric(m["MIN_Score"], errors="coerce"),
            "dis_score": pd.to_numeric(m["DIS_Score"], errors="coerce"),
            "min_norm": pd.to_numeric(m["MIN_DA_Norm"], errors="coerce"),
            "dis_norm": pd.to_numeric(m["DIS_DA_Norm"], errors="coerce"),
        }
    ).dropna()


def load_eds() -> list[dict]:
    path = PUBLIC / "alberta-eds.json"
    return json.loads(path.read_text(encoding="utf-8"))


def fill_lookup(lookup: dict, da_rows: list[dict], ref: pd.DataFrame, eds: list[dict]) -> dict:
    da_by_id = {str(r["da"]).zfill(8): r for r in da_rows}
    for da in sorted(set(da_by_id) | set(lookup) | MISSING):
        rec = lookup.setdefault(da, {})
        row = da_by_id.get(da, {})
        if rec.get("min_score") is not None and rec.get("min") is not None:
            continue
        minutes = rec.get("min")
        km = rec.get("km")
        if minutes is None or km is None:
            lat, lon = _num(row.get("lat")), _num(row.get("lon"))
            if lat is not None and lon is not None:
                routed = nearest_osrm(lat, lon, eds)
                if routed:
                    minutes = minutes if minutes is not None else round(routed["min"], 1)
                    km = km if km is not None else round(routed["km"], 1)
                    rec.setdefault("ed", routed["ed"])
                    rec.setdefault("city", routed["city"])
                    rec.setdefault("elat", routed["elat"])
                    rec.setdefault("elon", routed["elon"])
        if minutes is not None:
            rec["min"] = round(float(minutes), 1)
        if km is not None:
            rec["km"] = round(float(km), 1)
        if rec.get("min_score") is None:
            scores = knn_scores(rec.get("min"), rec.get("km"), ref)
            rec.update(scores)
        elif rec.get("cari") is None and rec.get("min_norm") is not None and rec.get("dis_norm") is not None:
            rec["cari"] = round((rec["min_norm"] + rec["dis_norm"]) / 2, 4)
    return lookup


def patch_tabular(lookup: dict) -> None:
    csv_path = PUBLIC / "alberta-da.csv"
    df = pd.read_csv(csv_path, dtype={"da": str})
    df["da"] = df["da"].str.zfill(8)
    for i, row in df.iterrows():
        rec = lookup.get(row["da"])
        if not rec or rec.get("min_score") is None:
            continue
        if pd.isna(row.get("ed_min_score")) or row.get("ed_min_score") == "":
            df.at[i, "ed_min_score"] = rec["min_score"]
            df.at[i, "ed_dis_score"] = rec["dis_score"]
            df.at[i, "ed_min_norm"] = rec["min_norm"]
            df.at[i, "ed_dis_norm"] = rec["dis_norm"]
            df.at[i, "cari_ed"] = rec["cari"]
    df.to_csv(csv_path, index=False)

    geo_path = PUBLIC / "alberta-da.geojson"
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    filled = 0
    for feat in geo["features"]:
        props = feat.get("properties") or {}
        da = str(props.get("da") or "").zfill(8)
        rec = lookup.get(da)
        if not rec or rec.get("min_score") is None:
            continue
        if props.get("ed_min_score") is None or props.get("cari_ed") is None:
            props["ed_min_score"] = rec["min_score"]
            props["ed_dis_score"] = rec["dis_score"]
            props["ed_min_norm"] = rec["min_norm"]
            props["ed_dis_norm"] = rec["dis_norm"]
            props["cari_ed"] = rec["cari"]
            filled += 1
    geo_path.write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")

    summary_path = PUBLIC / "summary.json"
    if summary_path.exists():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        cari = pd.to_numeric(df["cari_ed"], errors="coerce")
        mins = pd.to_numeric(df["ed_min_score"], errors="coerce")
        diss = pd.to_numeric(df["ed_dis_score"], errors="coerce")
        summary["da_count"] = int(len(df))
        summary["da_with_cari_ed"] = int(cari.notna().sum())
        summary["mean_cari_ed"] = float(cari.mean())
        summary["mean_ed_min_score"] = float(mins.mean())
        summary["mean_ed_dis_score"] = float(diss.mean())
        summary["median_ed_min_score"] = float(mins.median())
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Patched CSV/GeoJSON. GeoJSON features filled this pass: {filled}")


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(PUBLIC / "alberta-da.csv", dtype={"da": str})
    df["da"] = df["da"].str.zfill(8)
    da_rows = df.to_dict("records")
    lookup_path = PUBLIC / "alberta-da-ed-access.json"
    lookup = json.loads(lookup_path.read_text(encoding="utf-8")) if lookup_path.exists() else {}
    lookup = {str(k).zfill(8): v for k, v in lookup.items()}
    ref = load_ref()
    eds = load_eds()
    lookup = fill_lookup(lookup, da_rows, ref, eds)
    lookup_path.write_text(json.dumps(lookup), encoding="utf-8")
    patch_tabular(lookup)
    missing_score = [k for k, v in lookup.items() if v.get("min_score") is None]
    missing_min = [k for k, v in lookup.items() if v.get("min") is None]
    csv_miss = int(pd.to_numeric(df["cari_ed"], errors="coerce").isna().sum())
    # re-read after patch
    df2 = pd.read_csv(PUBLIC / "alberta-da.csv", dtype={"da": str})
    csv_miss = int(pd.to_numeric(df2["cari_ed"], errors="coerce").isna().sum())
    print(
        f"Lookup DAs {len(lookup)}  no score {len(missing_score)}  no minutes {len(missing_min)}  "
        f"CSV missing cari_ed {csv_miss}"
    )
    for da in sorted(MISSING):
        rec = lookup.get(da, {})
        print(f"  {da}: min={rec.get('min')} km={rec.get('km')} score={rec.get('min_score')} cari={rec.get('cari')} ed={rec.get('ed')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
