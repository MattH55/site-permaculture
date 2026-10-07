"""Export Alberta 24-hour ED locations and DA travel times from McGaughey & Peters."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "cari_ed"
PUBLIC = ROOT / "public" / "data"


def main() -> int:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    eds = pd.read_csv(RAW / "24hrED_Locations.csv")
    eds["POSTAL_CODE"] = eds["POSTAL_CODE"].astype(str)
    ab_box = (eds["X"].between(-120.1, -109.9)) & (eds["Y"].between(48.95, 60.1))
    ab_pc = eds["POSTAL_CODE"].str.upper().str.startswith("T")
    eds = eds[ab_box | ab_pc].copy()
    ed_out = []
    for rec in eds.to_dict("records"):
        ed_out.append(
            {
                "name": str(rec["24-hr_ED"]).strip(),
                "address": str(rec["ADDRESS"]).strip(),
                "city": str(rec["CITY"]).strip().title(),
                "postal": str(rec["POSTAL_CODE"]).replace(" ", "").upper(),
                "lon": float(rec["X"]),
                "lat": float(rec["Y"]),
            }
        )
    (PUBLIC / "alberta-eds.json").write_text(json.dumps(ed_out), encoding="utf-8")

    da = pd.read_csv(RAW / "DA_Centroid_to_24hrED.csv", dtype={"From_DAUID": str})
    da["From_DAUID"] = da["From_DAUID"].str.zfill(8)
    da = da[da["From_DAUID"].str.startswith("48")].copy()
    lookup = {}
    for r in da.itertuples(index=False):
        lookup[str(r.From_DAUID)] = {
            "min": round(float(r.Total_Minutes), 1) if pd.notna(r.Total_Minutes) else None,
            "km": round(float(r.Total_Kilometers), 1) if pd.notna(r.Total_Kilometers) else None,
            "ed": str(r.To_Hospital).strip() if pd.notna(r.To_Hospital) else "",
            "city": str(r.To_City).strip().title() if pd.notna(r.To_City) else "",
            "elat": float(r.To_Y) if pd.notna(r.To_Y) else None,
            "elon": float(r.To_X) if pd.notna(r.To_X) else None,
        }

    cari = pd.read_csv(RAW / "CARI_24_HR_ED.csv", dtype={"DAUID": str})
    cari = cari.loc[:, ~cari.columns.str.match(r"^Unnamed")]
    cari["DAUID"] = cari["DAUID"].str.zfill(8)
    cari = cari[cari["DAUID"].str.startswith("48")]
    for rec in cari.to_dict("records"):
        row = lookup.setdefault(str(rec["DAUID"]), {})
        row["min_score"] = round(float(rec["MIN_Score"]), 3) if pd.notna(rec["MIN_Score"]) else None
        row["dis_score"] = round(float(rec["DIS_Score"]), 3) if pd.notna(rec["DIS_Score"]) else None
        row["min_norm"] = round(float(rec["MIN_DA_Norm"]), 4) if pd.notna(rec["MIN_DA_Norm"]) else None
        row["dis_norm"] = round(float(rec["DIS_DA_Norm"]), 4) if pd.notna(rec["DIS_DA_Norm"]) else None
        row["cari"] = None
        if row.get("min_norm") is not None and row.get("dis_norm") is not None:
            row["cari"] = round((row["min_norm"] + row["dis_norm"]) / 2, 4)

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from fill_missing_ed_access import fill_lookup, load_ref

    csv_path = PUBLIC / "alberta-da.csv"
    if csv_path.exists():
        das = pd.read_csv(csv_path, dtype={"da": str})
        das["da"] = das["da"].str.zfill(8)
        lookup = fill_lookup(lookup, das.to_dict("records"), load_ref(), ed_out)

    (PUBLIC / "alberta-da-ed-access.json").write_text(json.dumps(lookup), encoding="utf-8")
    scored = sum(1 for v in lookup.values() if v.get("min_score") is not None)
    print(f"EDs {len(ed_out)}  DAs {len(lookup)}  with CARI+ scores {scored}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
