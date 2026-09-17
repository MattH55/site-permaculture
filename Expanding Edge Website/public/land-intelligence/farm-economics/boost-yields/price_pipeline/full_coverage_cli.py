"""CLI for the full-coverage specialty-crop price database build (Section 6).

Implements the two ingestion commands and the identity audit from the spec. The
per-crop and per-category ``discover`` commands are deliberately NOT implemented here
-- see HANDOFF.md at the boost-yields root for why, and what the next agent needs to
build them.
"""
from __future__ import annotations

import argparse
import json
import os

from . import crop_registry_full as REG
from . import discovery as DISC
from . import napcs_ca as NAPCS
from . import usda_master_list as USDA

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")


def cmd_ingest_master_list(args: argparse.Namespace) -> int:
    if args.source == "usda":
        rows = USDA.ingest()
        print(f"usda_master_crop_list: {len(rows)} rows -> output/usda_master_crop_list.csv")
    elif args.source == "napcs-ca":
        rows = NAPCS.ingest()
        print(f"napcs_agricultural_codes: {len(rows)} rows -> output/napcs_agricultural_codes.csv")
    else:
        print(f"unknown --source {args.source!r}; expected usda or napcs-ca")
        return 1
    return 0


def cmd_audit_identity(args: argparse.Namespace) -> int:
    registry, findings = REG.ingest_and_audit()
    unreviewed = [f for f in findings if f["flag_type"] == "candidate_ambiguous_shared_keyword"]
    if args.json:
        print(json.dumps({
            "crops": len(registry),
            "findings": len(findings),
            "unreviewed": len(unreviewed),
        }, indent=2))
    else:
        print(f"crop_registry: {len(registry)} crops")
        print(f"identity findings: {len(findings)} ({len(unreviewed)} unreviewed)")
        print("wrote output/crop_registry.csv, output/crop_identity_audit.csv")
    return 0


def cmd_discover(args: argparse.Namespace) -> int:
    """Run the Section 3 automated discovery pass for one category (or all)."""
    registry, _ = REG.ingest_and_audit()
    records = DISC.run_discovery(registry, category_filter=args.category)
    out_path = os.path.join(OUTPUT_DIR, "crop_discovery_record.csv")
    # Merge with any existing records from a prior category run rather than clobbering.
    existing: dict[str, DISC.CropDiscoveryRecord] = {}
    if os.path.exists(out_path):
        import csv as _csv
        with open(out_path, encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                for boolfield in ("checked_us_nass", "checked_us_nass_special_survey",
                                  "checked_us_ams", "checked_us_ams_farmers_market",
                                  "checked_us_census_specialty", "checked_us_trade",
                                  "checked_ca_statcan", "checked_ca_provincial",
                                  "checked_ca_census", "checked_ca_trade"):
                    row[boolfield] = row[boolfield] == "True"
                for nullable in ("selected_tier_us", "selected_tier_ca",
                                  "selected_source_us", "selected_source_ca"):
                    row[nullable] = row[nullable] or None
                existing[row["crop_id"]] = DISC.CropDiscoveryRecord(**row)
    for rec in records:
        existing[rec.crop_id] = rec
    merged = list(existing.values())
    DISC.write_discovery_records_csv(merged, out_path)

    tier_selected = sum(1 for r in records if r.selected_tier_ca or r.selected_tier_us)
    leads = sum(1 for r in records if "lead" in r.reviewer_notes)
    print(f"discovered {len(records)} crops in this run"
          f"{f' (category filter: {args.category})' if args.category else ''}")
    print(f"  real retrieved tier confirmed : {tier_selected}")
    print(f"  leads recorded for manual review: {leads}")
    print(f"  no lead found                 : {len(records) - tier_selected - leads}")
    print(f"wrote output/crop_discovery_record.csv ({len(merged)} total records across all runs)")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    """Section 5.2 dashboard. Categories with no discovery run yet show 0/total."""
    registry, _ = REG.ingest_and_audit()
    by_category: dict[str, int] = {}
    for row in registry:
        by_category[row.category] = by_category.get(row.category, 0) + 1

    discovered_by_category: dict[str, int] = {}
    disc_path = os.path.join(OUTPUT_DIR, "crop_discovery_record.csv")
    crop_to_category = {row.crop_id: row.category for row in registry}
    if os.path.exists(disc_path):
        import csv as _csv
        with open(disc_path, encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                cat = crop_to_category.get(row["crop_id"])
                if cat:
                    discovered_by_category[cat] = discovered_by_category.get(cat, 0) + 1

    print(f"{'category':<55} {'total':>6} {'discovered':>11}")
    for cat, total in sorted(by_category.items()):
        done = discovered_by_category.get(cat, 0)
        note = "" if done else "  (discovery not yet run)"
        print(f"{cat:<55} {total:>6} {done:>11}{note}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="full_coverage_cli",
        description="Full-coverage (v3) specialty-crop master-list ingestion and identity audit.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_ingest = sub.add_parser("ingest-master-list", help="fetch/parse a master crop list")
    p_ingest.add_argument("--source", required=True, choices=["usda", "napcs-ca"])
    p_ingest.set_defaults(func=cmd_ingest_master_list)

    p_audit = sub.add_parser("audit-identity", help="build crop_registry and run the identity audit")
    p_audit.add_argument("--json", action="store_true")
    p_audit.set_defaults(func=cmd_audit_identity)

    p_dash = sub.add_parser("dashboard", help="print the discovery_progress_dashboard")
    p_dash.set_defaults(func=cmd_dashboard)

    p_disc = sub.add_parser("discover", help="run the Section 3 automated discovery pass")
    p_disc.add_argument("--category", default=None,
                        help="category prefix to restrict discovery to, e.g. 'Vegetables'")
    p_disc.set_defaults(func=cmd_discover)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
