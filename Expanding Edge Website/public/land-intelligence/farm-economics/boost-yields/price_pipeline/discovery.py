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

CHECKLIST_FIELDS = (
    "checked_us_nass",
    "checked_us_nass_special_survey",
    "checked_us_ams",
    "checked_us_ams_farmers_market",
    "checked_us_census_specialty",
    "checked_us_trade",
    "checked_ca_statcan",
    "checked_ca_provincial",
    "checked_ca_census",
    "checked_ca_trade",
)

# First-word keywords that match too many catalog sentences to be a crop lead.
_MATCH_STOPWORDS = {
    "and", "or", "other", "all", "types", "including", "wild", "grain", "grains",
    "field", "crop", "crops", "plant", "plants", "seed", "seeds", "flowering",
    "potted", "cut", "cultivated", "annual", "deciduous", "herbaceous",
    "table", "garden", "english",
}

# USDA crop_id -> already-retrieved Alberta pipeline crop_id. Only aliases that
# name the SAME commodity (mustard seed == Alberta 'mustard' oilseed; dry edible
# beans == Alberta 'dry-beans'). Never alias a known identity-trap sibling.
ALBERTA_ID_ALIASES = {
    "mustard-seed": "mustard",
    "bean-dry-edible": "dry-beans",
    "pea-dry-edible": "dry-peas",
}

# Human reads of the automated pass's named leads. These never invent a retrieved
# price series; they only confirm/reject a catalog lead, or attach an Alberta
# alias that discover_crop already applied. Re-runs overlay these notes.
MANUAL_LEAD_REVIEWS: dict[str, dict] = {
    "mustard-and-other-greens": {
        "decision": "reject_lead",
        "note": "REJECTED: ca_ab_weekly_crop_market_review covers mustard seed "
                "(oilseed cash bids), not leafy mustard greens.",
    },
    "flax": {
        "decision": "reject_lead",
        "note": "REJECTED: WCMR / Alberta observations price flaxseed (oilseed), "
                "not fiber flax. Same-named sibling is crop_id flaxseed.",
    },
    "grain-sorghum": {
        "decision": "reject_lead",
        "note": "REJECTED: Cropping Alternatives coverage_note names grains/"
                "oilseeds/pulses generically; sorghum is not in the retrieved "
                "2026 Cropping Alternatives parse or Alberta observations.",
    },
    "rice-including-wild": {
        "decision": "reject_lead",
        "note": "REJECTED: earlier automated pass matched 'rice' as a substring "
                "of 'PRICE RECEIVED' on the mushrooms survey; word-boundary "
                "matching no longer produces that lead. StatCan 18-10-0245 does "
                "not name rice. No retrieved series in this repo.",
    },
    "bean": {
        "decision": "reject_lead",
        "note": "REJECTED: parent 'Bean' heading is not a priced commodity; "
                "StatCan 18-10-0245 names dry beans specifically (see "
                "bean-dry-edible).",
    },
    "bean-snap-or-green": {
        "decision": "reject_lead",
        "note": "REJECTED: StatCan 18-10-0245 coverage is dry beans, not snap/"
                "green beans. Alberta fresh-beans observations are not "
                "usable_for_farm_economics.",
    },
    "bean-lima": {
        "decision": "reject_lead",
        "note": "REJECTED: StatCan 18-10-0245 coverage is dry beans, not lima.",
    },
    "mushroom-cultivated": {
        "decision": "confirm_lead_unretrieved",
        "note": "CONFIRMED LEAD (not retrieved): NASS Mushrooms special survey "
                "has_price_field=true, verbatim 'MUSHROOMS - PRICE RECEIVED, "
                "MEASURED IN $ / LB'. Needs NASS_API_KEY before Tier A.",
    },
    "hops": {
        "decision": "confirm_lead_unretrieved",
        "note": "CONFIRMED LEAD (not retrieved): NASS Hops special survey "
                "has_price_field=true, verbatim 'HOPS - PRICE RECEIVED, "
                "MEASURED IN $ / LB'. Needs NASS_API_KEY before Tier A.",
    },
}

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


def _significant_words(name: str) -> list[str]:
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", name)]
    return [w for w in words if w not in _MATCH_STOPWORDS and len(w) >= 4]


def _contains_word(text: str, word: str) -> bool:
    if not word:
        return False
    return re.search(rf"\b{re.escape(word)}s?\b", text, re.I) is not None


def _match_terms(name: str) -> list[str]:
    """Words used to hunt catalog text.

    A single significant word (e.g. 'mushroom', 'hops') is used as-is. When the
    crop name has a qualifier ('Bean, Snap or Green', 'Mustard and Other Greens'),
    only the qualifier(s) are used so a family word cannot attach the wrong
    sibling's source.
    """
    words = _significant_words(name)
    if len(words) >= 2:
        return words[1:]
    return words


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
    alias = ALBERTA_ID_ALIASES.get(crop_id)
    if alias:
        candidates.add(alias)
    for cand in candidates:
        if cand in alberta_usable:
            return cand
    return None


def _match_special_survey(crop_name: str, surveys: list[WC.SpecialSurvey]) -> WC.SpecialSurvey | None:
    words = _match_terms(crop_name)
    if not words:
        return None
    for s in surveys:
        haystack = " ".join([
            s.key.replace("_", " "),
            s.report_title,
            s.verbatim_series_hint or "",
        ])
        if any(_contains_word(haystack, w) for w in words):
            return s
    return None


def _match_ca_catalog(crop_name: str, ca_sources: list[WC.CaSource]) -> WC.CaSource | None:
    words = _match_terms(crop_name)
    if not words:
        return None
    for s in ca_sources:
        haystack = f"{s.coverage_note or ''} {s.source_title}"
        if any(_contains_word(haystack, w) for w in words):
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
                      "crop_identity_audit.csv) -- any keyword-matched catalog hit "
                      "above must be manually confirmed to refer to THIS commodity "
                      "use, not a same-named sibling (e.g. mustard greens vs. mustard seed)")

    rec.reviewer_notes = "; ".join(notes)
    return _apply_manual_review(rec)


def _apply_manual_review(rec: CropDiscoveryRecord) -> CropDiscoveryRecord:
    review = MANUAL_LEAD_REVIEWS.get(rec.crop_id)
    if not review:
        return rec
    rec.checked_by = "manual_review"
    extra = review["note"]
    if rec.reviewer_notes:
        rec.reviewer_notes = rec.reviewer_notes + "; " + extra
    else:
        rec.reviewer_notes = extra
    if review["decision"] == "reject_lead":
        # Drop unretrieved catalog leads; keep a real already-retrieved tier.
        if rec.selected_tier_us is None:
            rec.selected_source_us = None
        if rec.selected_tier_ca is None:
            rec.selected_source_ca = None
    return rec


def _row_matches_crop_filter(crop_id: str, crop_name: str, crop_filter: str) -> bool:
    needle = crop_filter.strip().lower()
    return needle in {
        crop_id.lower(),
        crop_name.lower(),
        _slug(crop_name),
        crop_id.replace("_", "-"),
    }


def run_discovery(
    registry_rows: list, *, category_filter: str | None = None,
    crop_filter: str | None = None,
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
        if crop_filter and not _row_matches_crop_filter(crop_id, crop_name, crop_filter):
            continue
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


def _coerce_record(row: dict) -> CropDiscoveryRecord:
    data = dict(row)
    for boolfield in CHECKLIST_FIELDS:
        val = data.get(boolfield)
        data[boolfield] = val is True or val == "True" or val == "true"
    for nullable in ("selected_tier_us", "selected_tier_ca",
                     "selected_source_us", "selected_source_ca"):
        data[nullable] = data.get(nullable) or None
    known = {f.name for f in fields(CropDiscoveryRecord)}
    return CropDiscoveryRecord(**{k: data[k] for k in known if k in data})


def load_discovery_records_csv(path: str) -> list[CropDiscoveryRecord]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        return [_coerce_record(row) for row in csv.DictReader(fh)]


def merge_discovery_records(
    existing: list[CropDiscoveryRecord],
    incoming: list[CropDiscoveryRecord],
) -> list[CropDiscoveryRecord]:
    by_id = {r.crop_id: r for r in existing}
    for rec in incoming:
        by_id[rec.crop_id] = rec
    return list(by_id.values())


def checklist_incomplete(rec: CropDiscoveryRecord) -> bool:
    return any(not getattr(rec, field) for field in CHECKLIST_FIELDS)


def has_open_catalog_lead(rec: CropDiscoveryRecord) -> bool:
    notes = rec.reviewer_notes or ""
    if "needs manual_review" not in notes:
        return False
    if rec.checked_by == "manual_review" and (
        "REJECTED:" in notes or "CONFIRMED LEAD" in notes
    ):
        return False
    return True


def in_review_queue(rec: CropDiscoveryRecord) -> bool:
    if rec.confidence_us == "low" or rec.confidence_ca == "low":
        return True
    if checklist_incomplete(rec):
        return True
    return has_open_catalog_lead(rec)


def _confidence_score(value: str) -> int | None:
    return {"high": 3, "medium": 2, "low": 1}.get(value)


def _best_tier(rec: CropDiscoveryRecord) -> str | None:
    rank = {"A": 1, "B": 2, "B2": 3, "C": 4, "D": 5, "E": 6}
    candidates = [t for t in (rec.selected_tier_us, rec.selected_tier_ca) if t]
    if not candidates:
        return None
    return min(candidates, key=lambda t: rank.get(t, 99))


def dashboard_rows(
    registry_rows: list,
    records: list[CropDiscoveryRecord],
) -> list[dict]:
    by_category: dict[str, int] = {}
    for row in registry_rows:
        cat = row.category if not isinstance(row, dict) else row["category"]
        by_category[cat] = by_category.get(cat, 0) + 1
    rec_by_id = {r.crop_id: r for r in records}
    crop_to_category = {
        (row.crop_id if not isinstance(row, dict) else row["crop_id"]):
        (row.category if not isinstance(row, dict) else row["category"])
        for row in registry_rows
    }

    out: list[dict] = []
    for cat, total in sorted(by_category.items()):
        cat_recs = [r for cid, r in rec_by_id.items()
                    if crop_to_category.get(cid) == cat]
        complete = sum(1 for r in cat_recs if not checklist_incomplete(r))
        tiers = {"A": 0, "B": 0, "B2": 0, "C": 0, "D": 0, "E": 0}
        scores: list[int] = []
        for r in cat_recs:
            best = _best_tier(r)
            if best in tiers:
                tiers[best] += 1
            for conf in (r.confidence_us, r.confidence_ca):
                score = _confidence_score(conf)
                if score is not None:
                    scores.append(score)
        avg = round(sum(scores) / len(scores), 2) if scores else None
        out.append({
            "category": cat,
            "total_crops": total,
            "discovery_complete": complete,
            "tier_a": tiers["A"],
            "tier_b": tiers["B"],
            "tier_b2": tiers["B2"],
            "tier_c": tiers["C"],
            "tier_d": tiers["D"],
            "tier_e": tiers["E"],
            "avg_confidence": avg,
            "discovered": len(cat_recs),
        })
    return out
