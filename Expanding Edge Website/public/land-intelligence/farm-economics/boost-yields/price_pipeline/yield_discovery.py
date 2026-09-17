"""yield_discovery_record: per-crop checklist. Searches are recorded even when empty."""
from __future__ import annotations

import csv
import datetime
import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass, fields

from . import crop_registry_full as REG
from . import yield_elements as YE
from . import yield_schema as YS

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
DISCOVERY_CSV = os.path.join(OUTPUT_DIR, "yield_discovery_record.csv")
RAW_DIR = os.path.join(PROJECT_ROOT, "raw", "yield-literature")
CROSSREF = "https://api.crossref.org/works"


@dataclass
class YieldDiscoveryRecord:
    crop_id: str
    crop_name: str
    category: str
    checked_peer_reviewed_search: bool = False
    checked_extension_trials: bool = False
    checked_extension_guidance: bool = False
    checked_industry_trials: bool = False
    elements_found_count: int = 0
    highest_tier_found: str = ""
    reviewer_notes: str = ""
    checked_at: str = ""

    def to_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def _highest_tier(elements: list) -> str:
    rank = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5}
    tiers = [getattr(e, "source_tier", None) or e.get("source_tier") for e in elements]
    tiers = [t for t in tiers if t in rank]
    if not tiers:
        return ""
    return min(tiers, key=lambda t: rank[t])


def records_from_elements(
    registry: list, elements: list[YE.YieldElement], *, checked_at: str,
) -> list[YieldDiscoveryRecord]:
    by_crop: dict[str, list[YE.YieldElement]] = {}
    for el in elements:
        by_crop.setdefault(el.crop_id, []).append(el)
    out: list[YieldDiscoveryRecord] = []
    for row in registry:
        crop_id = row.crop_id if not isinstance(row, dict) else row["crop_id"]
        crop_name = row.crop_name if not isinstance(row, dict) else row["crop_name"]
        category = row.category if not isinstance(row, dict) else row["category"]
        found = by_crop.get(crop_id, [])
        rec = YieldDiscoveryRecord(
            crop_id=crop_id, crop_name=crop_name, category=category,
            checked_at=checked_at,
        )
        if found:
            rec.checked_peer_reviewed_search = True
            rec.elements_found_count = len(found)
            rec.highest_tier_found = _highest_tier(found)
            rec.reviewer_notes = (
                f"imported {len(found)} yield-factors rows with source URLs; "
                "extension/industry boxes not claimed from this import"
            )
        else:
            rec.reviewer_notes = "no yield_elements yet; searches not run"
        out.append(rec)
    return out


def crossref_search(crop_name: str, element_type: str, *, rows: int = 10) -> dict:
    """Title/author search only. Does not invent effect sizes from titles."""
    q = f"{crop_name} yield {element_type.replace('_', ' ')}"
    url = CROSSREF + "?" + urllib.parse.urlencode({
        "query": q, "rows": str(rows), "select": "DOI,title,issued,container-title,URL",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "LandIntelligence/boost-yields"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    os.makedirs(RAW_DIR, exist_ok=True)
    slug = YE._slug(crop_name, element_type)
    path = os.path.join(RAW_DIR, f"crossref_{slug}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"query": q, "url": url, "response": payload}, fh)
    items = ((payload.get("message") or {}).get("items") or [])
    titles = []
    for it in items:
        title = " ".join(it.get("title") or [])
        doi = it.get("DOI") or ""
        titles.append({"title": title, "doi": doi, "url": it.get("URL") or ""})
    return {
        "query": q,
        "n": len(titles),
        "hits": titles,
        "raw_path": os.path.relpath(path, PROJECT_ROOT).replace("\\", "/"),
    }


def apply_crossref(rec: YieldDiscoveryRecord, result: dict) -> YieldDiscoveryRecord:
    rec.checked_peer_reviewed_search = True
    rec.reviewer_notes = (
        f"CrossRef search {result['query']!r} returned {result['n']} works "
        f"(raw {result['raw_path']}). Titles/DOIs stored; no claimed_effect "
        "inserted from titles alone."
    )
    return rec


def write_discovery_csv(rows: list[YieldDiscoveryRecord], path: str | None = None) -> str:
    out_path = path or DISCOVERY_CSV
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = [f.name for f in fields(YieldDiscoveryRecord)]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())
    return out_path


def load_discovery_csv(path: str | None = None) -> list[dict]:
    p = path or DISCOVERY_CSV
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def in_review_queue(row: dict, *, tier: str | None = None) -> bool:
    if tier:
        return (row.get("highest_tier_found") or "") == tier
    if (row.get("highest_tier_found") or "") == "D":
        return True
    checked = [
        row.get("checked_peer_reviewed_search") in (True, "True", "true"),
        row.get("checked_extension_trials") in (True, "True", "true"),
        row.get("checked_extension_guidance") in (True, "True", "true"),
    ]
    return not all(checked)


def dashboard_rows(registry: list, elements: list, records: list[dict]) -> list[dict]:
    cats: dict[str, dict] = {}
    for row in registry:
        cat = row.category if not isinstance(row, dict) else row["category"]
        slot = cats.setdefault(cat, {
            "category": cat, "crops": 0, "with_elements": 0,
            "tier_a": 0, "tier_b": 0, "tier_c": 0, "tier_d": 0, "tier_e": 0,
        })
        slot["crops"] += 1
    el_by_crop: dict[str, list] = {}
    for el in elements:
        cid = el.crop_id if not isinstance(el, dict) else el["crop_id"]
        el_by_crop.setdefault(cid, []).append(el)
    crop_cat = {
        (r.crop_id if not isinstance(r, dict) else r["crop_id"]):
        (r.category if not isinstance(r, dict) else r["category"])
        for r in registry
    }
    for cid, found in el_by_crop.items():
        cat = crop_cat.get(cid)
        if not cat or cat not in cats:
            continue
        cats[cat]["with_elements"] += 1
        best = _highest_tier(found)
        key = {"A": "tier_a", "B": "tier_b", "C": "tier_c", "D": "tier_d", "E": "tier_e"}.get(best)
        if key:
            cats[cat][key] += 1
    return [cats[k] for k in sorted(cats)]
