"""Section 3: individualized per-crop discovery, run against the full crop_registry.

This is an AUTOMATED FIRST PASS, not the finished discovery the spec ultimately wants.
Every record this module produces has ``checked_by: "automated"`` and, where it finds
nothing, ``confidence: "low"`` -- promoting a record to ``checked_by: "manual_review"``
with a real API/report lookup is exactly the work HANDOFF.md hands to the next agent.
Two deliberate limits this pass has, both because no NASS/AMS API key is configured in
this environment (see usda_price_sources.yaml's ``nass_quickstats_api``/
``ams_market_news_api`` entries, both ``enabled: false`` for this reason):

1. It can only assert a *retrieved, defensible* tier where a real retrieval already
   exists elsewhere in this repo -- concretely, the Alberta ``price_pipeline`` runner's
   already-parsed ``data/price-observations/observations.json`` (real Statistics
   Canada / AAFC / Weekly Crop Market Review data, not this module's own fetch). A
   crop_registry row whose crop_id (or a close variant of it) appears there with a
   ``usable_for_farm_economics: true`` price type gets ``selected_tier_ca`` set for
   real, with ``selected_source_ca`` naming the underlying source.
2. For everything else it can only run the CHECKLIST -- does this crop's name turn up
   in the NASS special-survey list, the CA source catalog, or the v2 wide-coverage
   registry's ``crops:``/group-default search-order hints -- and record what it found
   as a lead for a human (or an API-key-equipped follow-up run) to chase, never as a
   confirmed tier. This satisfies the spec's Section 3.1 rule that "not yet checked"
   must be distinguished from "checked, found nothing", but it does NOT satisfy
   "every applicable checked_* field is true" -- most fields here stay false, honestly,
   because the underlying report was never actually opened and read.
"""
from __future__ import annotations

import csv
import datetime
import os
import re
from dataclasses import dataclass, field, fields

from . import crop_registry_full as REG
from . import wide_catalogs as WC

_TRAP_CROP_IDS = {cid for trap in REG.KNOWN_IDENTITY_TRAPS for cid in trap["crop_ids"]}

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
FARM_ECONOMICS_DIR = os.path.dirname(PROJECT_ROOT)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

ALBERTA_OBSERVATIONS_PATH = os.path.join(
    PROJECT_ROOT, "data", "price-observations", "observations.json")
ALBERTA_SOURCES_PATH = os.path.join(
    PROJECT_ROOT, "data", "price-observations", "sources.json")

WIDE_REGISTRY_PATH = os.path.join(PROJECT_ROOT, "wide_price_sources.yaml")


@dataclass
class CropDiscoveryRecord:
    crop_id: str
    crop_name: str
    checked_us_nass: bool = False
    checked_us_nass_special_survey: bool = False
    checked_us_ams: bool = False
    checked_us_ams_farmers_market: bool = False
    checked_us_census_specialty: bool = False
    checked_us_trade: bool = False
    checked_ca_statcan: bool = False
    checked_ca_provincial: bool = False
    checked_ca_census: bool = False
    checked_ca_trade: bool = False
    selected_tier_us: str | None = None
    selected_tier_ca: str | None = None
    selected_source_us: str | None = None
    selected_source_ca: str | None = None
    confidence_us: str = "low"
    confidence_ca: str = "low"
    reviewer_notes: str = ""
    checked_at: str = ""
    checked_by: str = "automated"

    def to_dict(self) -> dict:
        return {f.name: getattr(self, f.name) for f in fields(self)}


def _keyword(name: str) -> str:
    words = re.findall(r"[A-Za-z]+", name)
    return words[0].lower() if words else ""


def _slug(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def _load_alberta_usable_crops() -> dict[str, set[str]]:
    """crop_id (Alberta pipeline's own slug) -> set of price_types usable for farm economics."""
    import json
    with open(ALBERTA_SOURCES_PATH, encoding="utf-8") as fh:
        source_meta = json.load(fh)
    usable_types = {
        ptype for ptype, meta in source_meta.get("price_types", {}).items()
        if meta.get("usable_for_farm_economics")
    }
    with open(ALBERTA_OBSERVATIONS_PATH, encoding="utf-8") as fh:
        doc = json.load(fh)
    out: dict[str, set[str]] = {}
    for ptype, rows in doc.get("observations", {}).items():
        if ptype not in usable_types:
            continue
        for row in rows:
            cid = row.get("commodity_id") or row.get("crop_id") or row.get("crop")
            if not cid:
                continue
            out.setdefault(cid, set()).add(ptype)
    return out


def _load_wide_registry_crop_keys() -> set[str]:
    import yaml
    with open(WIDE_REGISTRY_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    return set((doc or {}).get("crops", {}).keys())


def _match_alberta(crop_id: str, crop_name: str, alberta_usable: dict[str, set[str]]) -> str | None:
    slug = _slug(crop_name)
    candidates = {slug, slug.rstrip("s"), slug + "s", crop_id}
    for cand in candidates:
        if cand in alberta_usable:
            return cand
    return None


def _match_special_survey(crop_name: str, surveys: list[WC.SpecialSurvey]) -> WC.SpecialSurvey | None:
    kw = _keyword(crop_name)
    if not kw:
        return None
    for s in surveys:
        hint = (s.verbatim_series_hint or "") + " " + s.report_title
        if kw in hint.lower() or kw in s.key.lower():
            return s
    return None


def _match_ca_catalog(crop_name: str, ca_sources: list[WC.CaSource]) -> WC.CaSource | None:
    kw = _keyword(crop_name)
    if not kw or len(kw) < 4:
        return None
    for s in ca_sources:
        if kw in (s.coverage_note or "").lower() or kw in s.source_title.lower():
            return s
    return None


def discover_crop(
    crop_id: str, crop_name: str, category: str,
    *, alberta_usable: dict[str, set[str]],
    surveys: list[WC.SpecialSurvey], ca_sources: list[WC.CaSource],
    wide_crop_keys: set[str],
    checked_at: str,
) -> CropDiscoveryRecord:
    rec = CropDiscoveryRecord(crop_id=crop_id, crop_name=crop_name, checked_at=checked_at)
    notes: list[str] = []

    # 1. Real, already-retrieved Alberta data (the one source of TRUE positives here).
    alberta_match = _match_alberta(crop_id, crop_name, alberta_usable)
    rec.checked_ca_provincial = True
    if alberta_match:
        rec.selected_tier_ca = "B"
        rec.selected_source_ca = "ab_price_pipeline (Alberta Weekly Crop Market " \
            "Review / Statistics Canada Table 32-10-0077-01, already retrieved and " \
            f"parsed this repo's Alberta price_pipeline; matched crop_id {alberta_match!r})"
        rec.confidence_ca = "high"
        notes.append(f"real match in data/price-observations/observations.json as {alberta_match!r}")
    else:
        notes.append("no matching crop_id in the already-retrieved Alberta observations")

    # 2. NASS special-survey checklist (Section 3.2) -- a lead, not a confirmed tier.
    survey_hit = _match_special_survey(crop_name, surveys)
    if survey_hit is not None:
        rec.checked_us_nass_special_survey = True
        notes.append(f"NASS special survey lead: {survey_hit.key!r} "
                     f"({survey_hit.report_title}) -- not retrieved, needs manual_review")

    # 3. CA source catalog (provincial/AAFC programs beyond Alberta's already-parsed ones).
    ca_hit = _match_ca_catalog(crop_name, ca_sources)
    if ca_hit is not None and not alberta_match:
        notes.append(f"CA source catalog lead: {ca_hit.source_id!r} "
                     f"({ca_hit.source_title}) -- not retrieved, needs manual_review")

    # 4. wide_price_sources.yaml's own crops: search-order hints (already-researched
    #    leads from the prior spec, e.g. saffron -> trade only, wasabi -> exhaustive-fail).
    wide_key_hit = None
    for key in wide_crop_keys:
        if key.replace("_", " ") == crop_name.lower() or key == crop_id.replace("-", "_"):
            wide_key_hit = key
            break
    if wide_key_hit:
        notes.append(f"wide_price_sources.yaml search-order hint already recorded "
                     f"under crops.{wide_key_hit} (v2 prior spec) -- hint only, not a retrieval")

    if not notes:
        notes.append("no lead found by this automated pass; needs a manual search "
                      "(NASS QuickStats, AMS Market News, provincial ag ministry sites)")

    if crop_id in _TRAP_CROP_IDS:
        notes.append("CAUTION: this crop_id is a known identity trap (see "
                      "crop_identity_audit.csv) -- any keyword-matched lead above must "
                      "be manually confirmed to refer to THIS commodity use, not a "
                      "same-named sibling (e.g. mustard greens vs. mustard seed)")

    rec.reviewer_notes = "; ".join(notes)
    return rec


def run_discovery(
    registry_rows: list, *, category_filter: str | None = None,
    checked_at: str | None = None,
) -> list[CropDiscoveryRecord]:
    checked_at = checked_at or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    alberta_usable = _load_alberta_usable_crops()
    surveys = WC.load_special_surveys()
    ca_sources = WC.load_ca_catalog()
    wide_crop_keys = _load_wide_registry_crop_keys()

    out: list[CropDiscoveryRecord] = []
    for row in registry_rows:
        category = getattr(row, "category", None) if not isinstance(row, dict) else row["category"]
        if category_filter and not category.startswith(category_filter):
            continue
        crop_id = row.crop_id if not isinstance(row, dict) else row["crop_id"]
        crop_name = row.crop_name if not isinstance(row, dict) else row["crop_name"]
        out.append(discover_crop(
            crop_id, crop_name, category,
            alberta_usable=alberta_usable, surveys=surveys, ca_sources=ca_sources,
            wide_crop_keys=wide_crop_keys, checked_at=checked_at,
        ))
    return out


def write_discovery_records_csv(records: list[CropDiscoveryRecord], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = [f.name for f in fields(CropDiscoveryRecord)]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow(r.to_dict())
