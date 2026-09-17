"""AMS My Market News (MARS) retrieval. Credentials from AMS_API_KEY.

Auth is HTTP Basic with the API key as username and an empty password, per
https://mymarketnews.ams.usda.gov/mymarketnews-api/authentication
"""
from __future__ import annotations

import base64
import csv
import datetime
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
RAW_DIR = os.path.join(PROJECT_ROOT, "raw", "ams")
CATALOG_PATH = os.path.join(RAW_DIR, "reports_catalog.json")
INDEX_PATH = os.path.join(RAW_DIR, "terminal_index.json")
REPORT_MAP_PATH = os.path.join(PROJECT_ROOT, "output", "crop_ams_report_map.csv")

API_BASE = "https://marsapi.ams.usda.gov/services/v1.2"
USER_AGENT = "LandIntelligence/boost-yields"

# Active U.S. terminal-market fruit/vegetable/nut reports used as the AMS
# checklist for those categories. Discontinued and foreign markets are excluded.
ACTIVE_US_TERMINAL_SLUGS = {
    "fruit": ["AJ_FV010", "BP_FV010", "BH_FV010", "HX_FV010", "CA_FV010",
              "DU_FV010", "HC_FV010", "MH_FV010", "NX_FV010", "NA_FV010"],
    "vegetables": ["AJ_FV020", "BP_FV020", "BH_FV020", "HX_FV020", "CA_FV020",
                   "DU_FV020", "HC_FV020", "MH_FV020", "NX_FV020", "NA_FV020"],
    "nuts": ["AJ_FV040", "BP_FV040", "BH_FV040", "HX_FV040", "CA_FV040",
             "DU_FV040", "HC_FV040", "MH_FV040", "NX_FV040", "NA_FV040"],
    "ornamentals": ["BH_FV201", "MH_FV221"],
}

# Wholesale Market Misc Herbs (FV055) reports exist in the catalog but are
# discontinued in MARS — AMS's own migration gap, not a parser bug.
DISCONTINUED_HERB_SLUGS = [
    "AJ_FV055", "BP_FV055", "BH_FV055", "HX_FV055", "CA_FV055", "DA_FV055",
    "DU_FV055", "HC_FV055", "MH_FV055", "NX_FV055", "NA_FV055", "SX_FV055",
    "XX_FV055",
]


def _api_key() -> str:
    key = (os.environ.get("AMS_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("AMS_API_KEY is not set")
    return key


def _headers() -> dict[str, str]:
    token = base64.b64encode((_api_key() + ":").encode()).decode()
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Authorization": "Basic " + token,
    }


def _get_json(url: str) -> dict | list:
    req = urllib.request.Request(url, headers=_headers())
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def write_raw(name: str, payload: dict | list, *, source_url: str = "") -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, name)
    data = json.dumps(payload).encode("utf-8")
    with open(path, "wb") as fh:
        fh.write(data)
    sidecar = {
        "raw_file": os.path.relpath(path, PROJECT_ROOT).replace("\\", "/"),
        "sha256": hashlib.sha256(data).hexdigest(),
        "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "n_bytes": len(data),
        "source_url": source_url,
    }
    with open(path + ".meta.json", "w", encoding="utf-8") as fh:
        json.dump(sidecar, fh, indent=2)
    return path


def _has_price(value) -> bool:
    if value is None or value == "":
        return False
    try:
        return float(str(value).replace(",", "")) != 0 or str(value).strip() == "0"
    except ValueError:
        return False


def retrieve_report_details(slug_id: str) -> dict:
    """Pull Report Details and retain a commodity+price extract, not 100k raw rows."""
    url = f"{API_BASE}/reports/{urllib.parse.quote(str(slug_id), safe='')}/Report%20Details"
    data = _get_json(url)
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected AMS details payload for {slug_id}")
    rows = data.get("results") or []
    by_name: dict[str, dict] = {}
    for row in rows:
        name = (row.get("commodity") or row.get("crop") or "").strip()
        if not name:
            continue
        rec = by_name.setdefault(name, {
            "commodity": name,
            "n_rows": 0,
            "n_with_price": 0,
            "group": row.get("group") or "",
            "category": row.get("category") or "",
        })
        rec["n_rows"] += 1
        if _has_price(row.get("low_price")) or _has_price(row.get("high_price")):
            rec["n_with_price"] += 1
    extract = {
        "slug_id": slug_id,
        "source_url": url,
        "report_section": data.get("reportSection"),
        "stats": data.get("stats") or {},
        "commodities": sorted(by_name.values(), key=lambda r: r["commodity"]),
    }
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(slug_id))
    write_raw(f"report_{safe}_details_extract.json", extract, source_url=url)
    return extract


def retrieve_report_catalog() -> list[dict]:
    data = _get_json(f"{API_BASE}/reports")
    if not isinstance(data, list):
        raise RuntimeError("unexpected AMS reports catalog payload")
    write_raw("reports_catalog.json", data)
    return data


def retrieve_report(slug_id: str, *, report_section: str | None = None) -> dict:
    url = f"{API_BASE}/reports/{urllib.parse.quote(str(slug_id))}"
    if report_section:
        url += "?" + urllib.parse.urlencode({"q": f"reportSection={report_section}"})
    data = _get_json(url)
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected AMS report payload for {slug_id}")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", str(slug_id))
    write_raw(f"report_{safe}.json", data)
    return data


def load_catalog() -> list[dict] | None:
    if not os.path.exists(CATALOG_PATH):
        return None
    with open(CATALOG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def load_index() -> dict | None:
    if not os.path.exists(INDEX_PATH):
        return None
    with open(INDEX_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def build_catalog_index(reports: list[dict]) -> dict:
    """Record that AMS terminal fruit/veg/nut reports exist. Does not invent prices.

    A crop is marked ams_terminal_group_exists for its category so discovery can
    set checked_us_ams true. Unit prices are only attached after a Report Details
    pull names the commodity.
    """
    by_slug = {str(r.get("slug_name") or ""): r for r in reports}
    groups = {}
    for group, slugs in ACTIVE_US_TERMINAL_SLUGS.items():
        present = []
        for slug in slugs:
            rec = by_slug.get(slug)
            if rec:
                present.append({
                    "slug_id": rec.get("slug_id"),
                    "slug_name": rec.get("slug_name"),
                    "report_title": rec.get("report_title"),
                    "report_status": rec.get("report_status"),
                })
        groups[group] = present
    doc = {
        "source": f"{API_BASE}/reports",
        "n_reports_in_catalog": len(reports),
        "active_us_terminal": groups,
        "discontinued_herb_reports": [
            {
                "slug_name": s,
                "report_title": (by_slug.get(s) or {}).get("report_title"),
                "ams_api_coverage": "not_yet_migrated",
            }
            for s in DISCONTINUED_HERB_SLUGS if s in by_slug
        ],
        "by_commodity": {},
    }
    write_raw("terminal_index.json", doc)
    return doc


def merge_details_into_index(extracts: list[dict], nass_commodity_map: dict[str, list[str]]) -> dict:
    """Map AMS Report Details commodities onto crop_ids. Price-less names are skipped."""
    index = load_index() or {"by_commodity": {}, "active_us_terminal": {}}
    by_crop: dict[str, list[dict]] = dict(index.get("by_commodity") or {})
    for extract in extracts:
        slug = str(extract.get("slug_id") or "")
        for rec in extract.get("commodities") or []:
            if not rec.get("n_with_price"):
                continue
            name = rec["commodity"]
            key = name.strip().upper()
            crop_ids = nass_commodity_map.get(key) or nass_commodity_map.get(key.rstrip("S"))
            if not crop_ids:
                continue
            for crop_id in crop_ids:
                by_crop.setdefault(crop_id, []).append({
                    "commodity": name,
                    "slug_id": slug,
                    "n_with_price": rec["n_with_price"],
                    "report_title": slug,
                })
    index["by_commodity"] = by_crop
    write_raw("terminal_index.json", index)
    os.makedirs(os.path.dirname(REPORT_MAP_PATH), exist_ok=True)
    with open(REPORT_MAP_PATH, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "crop", "ams_commodity", "slug_id", "n_with_price", "notes",
        ])
        writer.writeheader()
        for crop_id, hits in sorted(by_crop.items()):
            hit = hits[0]
            writer.writerow({
                "crop": crop_id,
                "ams_commodity": hit.get("commodity") or "",
                "slug_id": hit.get("slug_id") or "",
                "n_with_price": hit.get("n_with_price") or 0,
                "notes": "AMS Report Details contained a priced row for this commodity",
            })
    return index
