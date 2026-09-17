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


def cmd_dashboard(args: argparse.Namespace) -> int:
    """Section 5.2 dashboard. Discovery (Section 3) hasn't run yet in this build, so
    every category is reported as 0% complete -- an honest empty dashboard, not a
    placeholder pretending progress exists."""
    registry, _ = REG.ingest_and_audit()
    by_category: dict[str, int] = {}
    for row in registry:
        by_category[row.category] = by_category.get(row.category, 0) + 1
    print(f"{'category':<45} {'total':>6} {'discovered':>11}")
    for cat, total in sorted(by_category.items()):
        print(f"{cat:<45} {total:>6} {0:>11}  (discovery not yet run)")
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

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
