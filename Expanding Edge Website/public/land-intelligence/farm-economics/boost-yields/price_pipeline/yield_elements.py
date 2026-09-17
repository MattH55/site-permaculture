"""yield_elements table and import from data/yield-factors (real sources only)."""
from __future__ import annotations

import csv
import datetime
import json
import os
import re
from dataclasses import dataclass, fields

from . import yield_schema as YS

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
YF_DIR = os.path.join(PROJECT_ROOT, "data", "yield-factors")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
ELEMENTS_CSV = os.path.join(OUTPUT_DIR, "yield_elements.csv")
TAXONOMY_JSON = os.path.join(OUTPUT_DIR, "element_taxonomy.json")


@dataclass
class YieldElement:
    element_id: str
    crop_id: str
    element_type: str
    element_name: str
    claimed_effect: str
    effect_direction: str
    baseline_comparison: str
    study_context: str
    source_tier: str
    source_type: str
    source_url: str
    source_citation: str
    publication_year: str
    study_design: str
    sample_size_or_reps: str
    conflict_of_interest_flag: bool
    confidence: str
    retrieval_timestamp: str
    raw_source_path: str
    reviewer_notes: str = ""

    def to_dict(self) -> dict:
        d = {f.name: getattr(self, f.name) for f in fields(self)}
        d["conflict_of_interest_flag"] = bool(self.conflict_of_interest_flag)
        return d


def _slug(*parts: str) -> str:
    text = "-".join(p.strip().lower() for p in parts if p)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")[:120]


def _tier_from_existing(row: dict) -> tuple[str, str, str, str]:
    """(source_tier, source_type, study_design, confidence) from yield-factors row."""
    et = (row.get("evidence_type") or "").lower()
    url = (row.get("source_url") or "") + " " + (row.get("doi") or "")
    if "meta" in et:
        return "A", "peer_reviewed", "meta_analysis", "high"
    if "field" in et or "trial" in et:
        design = "greenhouse_trial" if "greenhouse" in (row.get("conditions") or "").lower() \
            else "replicated_field_trial"
        return "A", "peer_reviewed", design, "high"
    if "extension" in et or "bulletin" in url.lower():
        return "B", "extension_trial", "replicated_field_trial", "medium"
    if row.get("doi") or "doi.org" in url.lower():
        return "A", "peer_reviewed", "observational", "medium"
    return "C", "extension_guidance", "none", "low"


def _claimed_effect(row: dict) -> str:
    size = row.get("effect_size")
    unit = (row.get("effect_unit") or "").strip()
    if size is None:
        return ""  # spec: do not backfill a percentage for qualitative guidance
    direction = YS.direction_for(row.get("direction") or "")
    sign = "+" if direction == "increase" else ""
    if direction == "decrease":
        sign = ""
        # keep the reported number; direction field carries the sign
    return f"{sign}{size} {unit}".strip()


def import_existing_yield_factors(*, retrieved_at: str | None = None) -> list[YieldElement]:
    """Load data/yield-factors/*.json. Skip rows with no source_url/doi. Skip unmapped crops."""
    retrieved_at = retrieved_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    out: list[YieldElement] = []
    if not os.path.isdir(YF_DIR):
        return out
    for name in sorted(os.listdir(YF_DIR)):
        if not name.endswith(".json") or name == "schema.json":
            continue
        path = os.path.join(YF_DIR, name)
        rel = os.path.relpath(path, PROJECT_ROOT).replace("\\", "/")
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        if not isinstance(payload, list):
            continue
        for row in payload:
            url = (row.get("source_url") or "").strip()
            doi = (row.get("doi") or "").strip()
            if not url and doi:
                url = f"https://doi.org/{doi}"
            if not url:
                continue
            yf_crop = (row.get("crop_id") or "").strip()
            crop_id = YS.YIELD_FACTOR_CROP_MAP.get(yf_crop)
            if not crop_id:
                continue
            element_type = YS.element_type_for_category(row.get("factor_category") or "")
            if not element_type:
                continue
            if element_type not in YS.ELEMENT_TYPES:
                continue
            name_text = (row.get("factor") or row.get("intervention") or "").strip()
            if not name_text:
                continue
            tier, source_type, design, confidence = _tier_from_existing(row)
            reps = row.get("study_count")
            out.append(YieldElement(
                element_id=_slug(crop_id, row.get("factor_id") or name_text),
                crop_id=crop_id,
                element_type=element_type,
                element_name=name_text,
                claimed_effect=_claimed_effect(row),
                effect_direction=YS.direction_for(row.get("direction") or ""),
                baseline_comparison=(row.get("comparator") or row.get("baseline") or "").strip(),
                study_context=(row.get("conditions") or row.get("geography") or "").strip(),
                source_tier=tier,
                source_type=source_type,
                source_url=url,
                source_citation=(row.get("source_title") or "").strip(),
                publication_year=str(row.get("source_year") or ""),
                study_design=design,
                sample_size_or_reps="" if reps is None else str(reps),
                conflict_of_interest_flag=source_type == "industry_trial",
                confidence=confidence,
                retrieval_timestamp=retrieved_at,
                raw_source_path=rel,
                reviewer_notes="imported from data/yield-factors; pass=existing_literature",
            ))
    return out


def write_elements_csv(rows: list[YieldElement], path: str | None = None) -> str:
    out_path = path or ELEMENTS_CSV
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = [f.name for f in fields(YieldElement)]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())
    return out_path


def load_elements_csv(path: str | None = None) -> list[dict]:
    p = path or ELEMENTS_CSV
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def write_taxonomy(path: str | None = None) -> str:
    out_path = path or TAXONOMY_JSON
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    doc = {
        "version": YS.TAXONOMY_CHANGELOG[0]["version"],
        "element_types": list(YS.ELEMENT_TYPES),
        "changelog": YS.TAXONOMY_CHANGELOG,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    return out_path
