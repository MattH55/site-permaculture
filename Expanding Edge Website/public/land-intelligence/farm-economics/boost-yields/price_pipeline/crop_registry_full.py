"""Merge USDA + NAPCS into the canonical ``crop_registry`` (full-coverage spec,
Section 1.3), and run the Section 2 identity-disambiguation audit.

Named ``crop_registry_full`` (not ``crop_registry``) to avoid colliding with any
per-country *source* registry module name used by the prior two specs' Python
modules in this package -- this one is the master crop identity table the wide/CA/US
source registries are expected to resolve against, not a source registry itself.

Nothing here fabricates a NAPCS match: ``napcs_code_match`` is left null unless a
keyword drawn from the USDA crop name is found, case-insensitively, in exactly one
NAPCS leaf description. An ambiguous (multiple leaves) or absent match is recorded as
null, never guessed -- Section 1.2 explicitly forbids forcing a 1:1 mapping where the
two lists disagree on granularity.
"""
from __future__ import annotations

import csv
import datetime
import os
import re
from dataclasses import dataclass, field

from . import napcs_ca as NAPCS
from . import usda_master_list as USDA

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

# Identity traps confirmed by direct inspection this session (spec Section 2). Each
# entry names the crop_id(s) it applies to and why; ``audit_identity`` attaches these
# verbatim rather than deriving them, because the reasoning behind each one (why the
# two uses are genuinely different commodities, not just a naming coincidence) is not
# something a keyword-collision heuristic can determine on its own.
KNOWN_IDENTITY_TRAPS = [
    {
        "crop_ids": ["mustard-and-other-greens", "mustard-seed"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["leafy_vegetable", "oilseed_commodity"],
        "resolution": "tracked as two separate crop_registry rows (already distinct "
                       "entries in the USDA master list: Appendix B vegetable vs "
                       "Appendix F ineligible oilseed); never merge a discovered "
                       "price series for one into the other.",
    },
    {
        "crop_ids": ["flaxseed", "flax"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["oilseed_commodity", "fiber_crop"],
        "resolution": "The USDA master list itself lists 'Flaxseed' under Oil Seed "
                       "Crops and 'Flax' under Fiber Crops as two separate ineligible "
                       "entries (confirmed by direct PDF inspection, appendix F). Both "
                       "are excluded from the US specialty-crop definition; the "
                       "oilseed form is the one with a real Alberta price series "
                       "(Weekly Crop Market Review) from the prior spec's work.",
    },
    {
        "crop_ids": ["flaxseed"],
        "flag_type": "excluded_from_us_specialty_definition",
        "conflicting_uses": [],
        "resolution": "still_priced_in: CA_provincial (Alberta Weekly Crop Market "
                       "Review, already ingested by the prior spec's pipeline).",
    },
    {
        "crop_ids": ["hemp"],
        "flag_type": "excluded_from_us_specialty_definition",
        "conflicting_uses": [],
        "resolution": "still_priced_in: hemp seed may appear in NAPCS oilseed codes "
                       "(115122411 Hemp seeds) or US/CA trade series; the fiber/"
                       "industrial-hemp use (NAPCS 115139211) is a different product "
                       "and must not be blended with a hemp-seed price series.",
    },
    {
        "crop_ids": ["pepper", "culinary-herbs-and-spices-pepper"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["vegetable_capsicum", "spice_piper"],
        "resolution": "USDA Appendix B lists Pepper next to potato/cauliflower "
                       "(Capsicum vegetable); Appendix C lists Pepper next to bay/"
                       "dill/fennel (spice). Keep two crop_ids; never share a price "
                       "series.",
    },
    {
        "crop_ids": ["citrus", "citrus-trees"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["fresh_fruit", "nursery_planting_stock"],
        "resolution": "Fruit vs fruit-and-nut planting stock. Different markets; "
                       "keep separate crop_ids.",
    },
    {
        "crop_ids": ["asparagus", "asparagus-fern"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["vegetable_spear", "ornamental_cut_green"],
        "resolution": "Vegetable asparagus vs floriculture Asparagus fern (cut "
                       "cultivated greens). Different commodities.",
    },
    {
        "crop_ids": ["passion-fruit", "passion-flower"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["fresh_fruit", "medicinal_herb"],
        "resolution": "Passion fruit (edible) vs passion flower (medicinal herb). "
                       "Related genus, different commodities.",
    },
    {
        "crop_ids": ["bean", "bean-snap-or-green", "bean-lima", "bean-dry-edible"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["parent_heading", "snap_bean", "lima_bean", "dry_edible_bean"],
        "resolution": "USDA compound entry: parent heading plus three priced "
                       "commodities. Snap/lima/dry edible have distinct markets; "
                       "the parent 'Bean' row is not itself a price series.",
    },
    {
        "crop_ids": ["pea", "pea-garden", "pea-english-or-edible-pod", "pea-dry-edible"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["parent_heading", "garden_pea", "edible_pod_pea", "dry_edible_pea"],
        "resolution": "USDA compound entry: parent heading plus garden / English "
                       "or edible-pod / dry edible. Dry peas are a prairie pulse "
                       "market; garden/pod peas are not the same series.",
    },
    {
        "crop_ids": ["cotton", "cottonseed", "fiber-crops-cotton"],
        "flag_type": "multi_commodity_same_name",
        "conflicting_uses": ["lint_field_crop", "oilseed", "lint_fiber_crop"],
        "resolution": "Cottonseed (oilseed) is distinct from cotton lint. Appendix F "
                       "lists lint twice (Field and Grain Crops + Fiber Crops); those "
                       "two lint rows are duplicate listings of the same commodity, "
                       "not a third product.",
    },
]

# Keyword-collision candidates from the scanner that a human has now read.
# Keyed by frozenset of crop_ids. Genuine commodity splits were promoted into
# KNOWN_IDENTITY_TRAPS above; everything here is a reviewed non-trap or a
# same-plant dual listing that must stay as separate rows but is not a
# mustard-greens-vs-seed class of error.
REVIEWED_IDENTITY_CANDIDATES = [
    {
        "crop_ids": ["azalea", "potted-flowering-plants-azalea"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["nursery_shrub", "potted_flowering_plant"],
        "resolution": "Same plant in two Appendix E subsections. Keep distinct "
                       "crop_ids; not a commodity-identity trap.",
    },
    {
        "crop_ids": ["comfrey", "medicinal-herbs-comfrey"],
        "flag_type": "same_plant_dual_usda_listing",
        "conflicting_uses": ["culinary_herb", "medicinal_herb"],
        "resolution": "Same plant on Appendix C and Appendix D. Keep both rows; "
                       "do not merge until a source names which use it prices.",
    },
    {
        "crop_ids": ["delphinium", "potted-herbaceous-perennials-delphinium"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["cut_or_garden_form", "potted_perennial"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["fenugreek", "medicinal-herbs-fenugreek"],
        "flag_type": "same_plant_dual_usda_listing",
        "conflicting_uses": ["culinary_herb", "medicinal_herb"],
        "resolution": "Same plant on Appendix C and Appendix D. Keep both rows.",
    },
    {
        "crop_ids": ["flowering-bulbs", "flowering-cherry", "flowering-pear",
                     "flowering-plum"],
        "flag_type": "scanner_false_positive",
        "conflicting_uses": [],
        "resolution": "Shared leading word 'flowering' only. Four unrelated "
                       "nursery items; not an identity trap.",
    },
    {
        "crop_ids": ["cut-cultivated-greens-holly", "holly"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["cut_cultivated_green", "landscape_plant"],
        "resolution": "Same plant, cut-greens vs landscape form. Keep distinct "
                       "crop_ids; not a mustard-class trap.",
    },
    {
        "crop_ids": ["horehound", "medicinal-herbs-horehound"],
        "flag_type": "same_plant_dual_usda_listing",
        "conflicting_uses": ["culinary_herb", "medicinal_herb"],
        "resolution": "Same plant on Appendix C and Appendix D. Keep both rows.",
    },
    {
        "crop_ids": ["hydrangea", "potted-flowering-plants-hydrangea"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["nursery_form", "potted_flowering_plant"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["ivy", "potted-herbaceous-perennials-ivy"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["nursery_form", "potted_perennial"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["lavender", "medicinal-herbs-lavender"],
        "flag_type": "same_plant_dual_usda_listing",
        "conflicting_uses": ["culinary_herb", "medicinal_herb"],
        "resolution": "Same plant on Appendix C and Appendix D. Keep both rows.",
    },
    {
        "crop_ids": ["lemon-balm", "lemon-thyme"],
        "flag_type": "scanner_false_positive",
        "conflicting_uses": [],
        "resolution": "Shared leading word 'lemon' only. Two distinct culinary herbs.",
    },
    {
        "crop_ids": ["lily", "potted-flowering-plants-lily"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["nursery_form", "potted_flowering_plant"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["orchid", "potted-flowering-plants-orchid"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["nursery_form", "potted_flowering_plant"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["parsley", "culinary-herbs-and-spices-parsley"],
        "flag_type": "same_plant_dual_usda_listing",
        "conflicting_uses": ["vegetable", "culinary_herb"],
        "resolution": "Same plant listed as a vegetable (Appendix B) and a culinary "
                       "herb (Appendix C). Keep both rows; not Capsicum-vs-Piper.",
    },
    {
        "crop_ids": ["peanut", "field-and-grain-crops-peanut"],
        "flag_type": "same_plant_duplicate_ineligible_listing",
        "conflicting_uses": ["oilseed", "field_and_grain"],
        "resolution": "Appendix F lists peanut under Oil Seed Crops and again under "
                       "Field and Grain Crops. Duplicate ineligible listing of one "
                       "commodity; keep both rows, do not treat as two products.",
    },
    {
        "crop_ids": ["deciduous-shrubs-rose", "potted-flowering-plants-rose", "rose"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["cut_flower_or_unspecified", "deciduous_shrub",
                             "potted_flowering_plant"],
        "resolution": "Same plant across Appendix E subsections. Distinct crop_ids "
                       "already; not a commodity-identity trap.",
    },
    {
        "crop_ids": ["cut-flowers-snapdragon", "snapdragon"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["cut_flower", "other_nursery_form"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
    {
        "crop_ids": ["sweet-corn", "sweet-potato"],
        "flag_type": "scanner_false_positive",
        "conflicting_uses": [],
        "resolution": "Shared leading word 'sweet' only. Unrelated crops.",
    },
    {
        "crop_ids": ["deciduous-shrubs-viburnum", "viburnum"],
        "flag_type": "same_plant_multiple_nursery_forms",
        "conflicting_uses": ["deciduous_shrub", "other_nursery_form"],
        "resolution": "Same plant, two Appendix E subsections. Not a trap.",
    },
]


@dataclass
class CropRegistryRow:
    crop_id: str
    crop_name: str
    category: str
    usda_master_list_match: bool
    napcs_code_match: str | None
    aliases: list[str] = field(default_factory=list)
    is_eligible_specialty_us: bool = True
    added_at: str = ""
    status: str = "active"

    def to_dict(self) -> dict:
        return {
            "crop_id": self.crop_id,
            "crop_name": self.crop_name,
            "category": self.category,
            "usda_master_list_match": self.usda_master_list_match,
            "napcs_code_match": self.napcs_code_match or "",
            "aliases": "|".join(self.aliases),
            "is_eligible_specialty_us": self.is_eligible_specialty_us,
            "added_at": self.added_at,
            "status": self.status,
        }


def _slug(name: str) -> str:
    slug = name.strip().lower()
    slug = slug.replace("&", " and ").replace("/", " ")
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def _crop_display_name(usda_row: dict) -> str:
    if usda_row["parent_crop"]:
        return f"{usda_row['parent_crop']}, {usda_row['crop_name']}"
    return usda_row["crop_name"]


def _keyword_for_match(name: str) -> str:
    # Use the first alphabetic word of the crop name as the NAPCS search keyword.
    # A short, deliberately crude heuristic: it is only ever used to look for a
    # SINGLE unambiguous hit, per the no-forced-mapping rule above.
    words = re.findall(r"[A-Za-z]+", name)
    return words[0].lower() if words else ""


def _match_napcs(name: str, napcs_rows: list[dict]) -> str | None:
    keyword = _keyword_for_match(name)
    if not keyword or len(keyword) < 4:
        return None
    hits = [r for r in napcs_rows if keyword in r["description"].lower()]
    leaf_hits = [r for r in hits if r["level"] in ("5", "6")]
    if len(leaf_hits) == 1:
        return leaf_hits[0]["code"]
    return None


def build_crop_registry(
    usda_rows: list[dict] | None = None,
    napcs_rows: list[dict] | None = None,
    *, retrieved_at: str | None = None,
) -> list[CropRegistryRow]:
    retrieved_at = retrieved_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    if usda_rows is None:
        usda_rows = [r.to_dict() for r in USDA.ingest()]
    if napcs_rows is None:
        napcs_rows = NAPCS.ingest()

    seen_ids: dict[str, int] = {}
    out: list[CropRegistryRow] = []
    for row in usda_rows:
        display = _crop_display_name(row)
        base_id = _slug(display)
        # de-duplicate crop_id collisions (e.g. "Dry, Edible" appears under both
        # Bean and Pea) by suffixing with the parent slug.
        crop_id = base_id
        if crop_id in seen_ids:
            disambiguator = row["subsection"] or row["parent_crop"] or row["category"]
            crop_id = _slug(f"{disambiguator}-{row['crop_name']}")
        if crop_id in seen_ids:
            # still colliding (e.g. same subsection repeats a name) -- last resort,
            # an explicit numbered suffix rather than a silent overwrite.
            crop_id = f"{crop_id}-{seen_ids[base_id] + 1}"
        seen_ids[crop_id] = seen_ids.get(crop_id, 0) + 1
        seen_ids[base_id] = seen_ids.get(base_id, 0) + 1

        is_eligible = str(row["is_eligible_specialty"]).lower() == "true"
        napcs_match = _match_napcs(row["crop_name"], napcs_rows)
        out.append(CropRegistryRow(
            crop_id=crop_id,
            crop_name=display,
            category=row["category"] if not row.get("subsection") else
                      f"{row['category']} / {row['subsection']}",
            usda_master_list_match=True,
            napcs_code_match=napcs_match,
            is_eligible_specialty_us=is_eligible,
            added_at=retrieved_at,
        ))
    return out


def write_crop_registry_csv(rows: list[CropRegistryRow], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ["crop_id", "crop_name", "category", "usda_master_list_match",
                  "napcs_code_match", "aliases", "is_eligible_specialty_us",
                  "added_at", "status"]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())


def audit_identity(registry: list[CropRegistryRow]) -> list[dict]:
    """Section 2 identity audit: known traps plus an automated collision scan.

    The automated scan flags crop_id pairs sharing the same leading keyword (e.g. two
    different registry rows both starting with "mustard") that are NOT already
    covered by ``KNOWN_IDENTITY_TRAPS``, so a reviewer sees new candidates instead of
    only the pre-researched ones.
    """
    known_ids = {cid for trap in KNOWN_IDENTITY_TRAPS for cid in trap["crop_ids"]}
    reviewed_by_ids = {
        frozenset(item["crop_ids"]): item for item in REVIEWED_IDENTITY_CANDIDATES
    }
    by_keyword: dict[str, list[str]] = {}
    for row in registry:
        kw = _keyword_for_match(row.crop_name)
        if kw:
            by_keyword.setdefault(kw, []).append(row.crop_id)

    findings = list(KNOWN_IDENTITY_TRAPS)
    for kw, crop_ids in sorted(by_keyword.items()):
        unique_ids = sorted(set(crop_ids))
        if len(unique_ids) < 2:
            continue
        if set(unique_ids) & known_ids:
            continue  # already accounted for above
        reviewed = reviewed_by_ids.get(frozenset(unique_ids))
        if reviewed:
            findings.append(dict(reviewed))
            continue
        findings.append({
            "crop_ids": unique_ids,
            "flag_type": "candidate_ambiguous_shared_keyword",
            "conflicting_uses": [],
            "resolution": "NOT YET REVIEWED -- automated keyword collision, requires "
                          "a human read of each crop_name to confirm whether this is "
                          "a genuine identity trap or coincidental shared word "
                          "(e.g. two unrelated crops that both contain 'other').",
        })
    return findings


def write_identity_audit_csv(findings: list[dict], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "crop_ids", "flag_type", "conflicting_uses", "resolution"])
        writer.writeheader()
        for f in findings:
            writer.writerow({
                "crop_ids": "|".join(f["crop_ids"]),
                "flag_type": f["flag_type"],
                "conflicting_uses": "|".join(f["conflicting_uses"]),
                "resolution": f["resolution"],
            })


def ingest_and_audit(out_dir: str | None = None) -> tuple[list[CropRegistryRow], list[dict]]:
    out_dir = out_dir or OUTPUT_DIR
    registry = build_crop_registry()
    write_crop_registry_csv(registry, os.path.join(out_dir, "crop_registry.csv"))
    findings = audit_identity(registry)
    write_identity_audit_csv(findings, os.path.join(out_dir, "crop_identity_audit.csv"))
    return registry, findings


if __name__ == "__main__":  # pragma: no cover
    registry, findings = ingest_and_audit()
    matched = sum(1 for r in registry if r.napcs_code_match)
    print(f"crop_registry: {len(registry)} rows -> output/crop_registry.csv")
    print(f"  napcs matched: {matched} ({matched / len(registry):.0%})")
    print(f"identity audit: {len(findings)} findings -> output/crop_identity_audit.csv")
    unreviewed = sum(1 for f in findings if f["flag_type"] == "candidate_ambiguous_shared_keyword")
    print(f"  known traps: {len(findings) - unreviewed}, unreviewed candidates: {unreviewed}")
