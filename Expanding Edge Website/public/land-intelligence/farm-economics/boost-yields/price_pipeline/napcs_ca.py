"""Ingest Statistics Canada's NAPCS Canada 2022 v1.0 Agricultural Goods extension
variant (full-coverage spec, Section 1.2).

Source: https://www.statcan.gc.ca/en/media/5274 (linked from the NAPCS Canada 2022
index page), retrieved and cached under ``data/raw/napcs/``.

Empirical granularity finding (spec 1.2 requires checking this, not assuming it):
this file goes down to named-variety detail for the crops this pipeline already has
Canadian price data for -- e.g. mustard seed is split by colour (Brown/Oriental/
Yellow/Other), lentils by type (Large green/Red/Small green/Other), chickpeas by
type (Desi/Kabuli/Other), and specialty mushrooms are named individually (Shiitake,
Oyster). Culinary herbs are NOT itemized by species: basil, oregano, dill, etc. all
fold into a single "Fresh fine herbs" / "Other fresh fine herbs" leaf (code
114221382). This is recorded per-row as ``maps_to_multiple_crops`` rather than forced
into a fake one-crop-per-code mapping -- see ``crop_registry.audit_identity`` for how
that gets used.
"""
from __future__ import annotations

import csv
import os

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
RAW_PATH = os.path.join(PROJECT_ROOT, "data", "raw", "napcs",
                         "napcs_agricultural_goods_variant.csv")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

SOURCE_URL = "https://www.statcan.gc.ca/en/media/5274"

# Leaf codes (Level 5 or 6) empirically confirmed to bucket several distinct crops
# together rather than naming one crop -- see module docstring. Adding a code here is
# a discovery-time decision, not an ingestion-time guess: it is only added once the
# raw "Class title" has been read and confirmed generic (e.g. "Other fresh fine
# herbs"), never merely inferred from the code's numeric position.
KNOWN_MULTI_CROP_LEAVES = {
    "114221382": "Other fresh fine herbs (basil, oregano, dill, cilantro, etc. are "
                  "not separately coded)",
    "114221723": "Other fresh mushrooms, n.e.c. (specialty varieties besides "
                 "Agaricus/Shiitake/Oyster are not separately coded)",
    "115139531": "Other spice seeds, n.e.c.",
}


def _row_code(raw: dict) -> str:
    return (raw.get("Code") or "").strip()


def load_napcs_agricultural_codes(path: str | None = None) -> list[dict]:
    path = path or RAW_PATH
    with open(path, encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        raw_rows = list(reader)

    rows: list[dict] = []
    for raw in raw_rows:
        code = _row_code(raw)
        if not code:
            continue
        rows.append({
            "code": code,
            "level": (raw.get("Level/Niveau") or "").strip(),
            "parent_code": (raw.get("Parent ") or raw.get("Parent") or "").strip(),
            "description": (raw.get("Class title") or "").strip(),
            "maps_to_multiple_crops": KNOWN_MULTI_CROP_LEAVES.get(code, ""),
            "source_url": SOURCE_URL,
        })
    return rows


def write_napcs_codes_csv(rows: list[dict], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ["code", "level", "parent_code", "description",
                  "maps_to_multiple_crops", "source_url"]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def find_by_keyword(rows: list[dict], keyword: str) -> list[dict]:
    kw = keyword.lower()
    return [r for r in rows if kw in r["description"].lower()]


def ingest(path: str | None = None, out_path: str | None = None) -> list[dict]:
    out_path = out_path or os.path.join(OUTPUT_DIR, "napcs_agricultural_codes.csv")
    rows = load_napcs_agricultural_codes(path)
    write_napcs_codes_csv(rows, out_path)
    return rows


if __name__ == "__main__":  # pragma: no cover
    result = ingest()
    print(f"parsed {len(result)} rows -> output/napcs_agricultural_codes.csv")
    by_level: dict[str, int] = {}
    for r in result:
        by_level[r["level"]] = by_level.get(r["level"], 0) + 1
    for level, count in sorted(by_level.items()):
        print(f"  level {level}: {count}")
