"""AMS My Market News (MARS) retrieval. Credentials from AMS_API_KEY.

Auth is HTTP Basic with the API key as username and an empty password, per
https://mymarketnews.ams.usda.gov/mymarketnews-api/authentication
"""
from __future__ import annotations

import base64
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
}


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


def write_raw(name: str, payload: dict | list) -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return path


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
        "by_commodity": {},  # filled when Report Details are retrieved
    }
    write_raw("terminal_index.json", doc)
    return doc
