"""CLI for the full-coverage specialty-crop price database build (Section 6).

Commands: ingest-master-list, audit-identity, discover (--category / --crop),
dashboard, review-queue.
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
DISCOVERY_CSV = os.path.join(OUTPUT_DIR, "crop_discovery_record.csv")


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
    """Run the Section 3 discovery pass for one category, one crop, or all."""
    registry, _ = REG.ingest_and_audit()
    records = DISC.run_discovery(
        registry, category_filter=args.category, crop_filter=args.crop)
    if args.crop and not records:
        print(f"no crop_registry row matched --crop {args.crop!r}")
        return 1
    existing = DISC.load_discovery_records_csv(DISCOVERY_CSV)
    merged = DISC.merge_discovery_records(existing, records)
    DISC.write_discovery_records_csv(merged, DISCOVERY_CSV)

    tier_selected = sum(1 for r in records if r.selected_tier_ca or r.selected_tier_us)
    open_leads = sum(1 for r in records if DISC.has_open_catalog_lead(r))
    confirmed_leads = sum(1 for r in records if "CONFIRMED LEAD" in r.reviewer_notes)
    rejected = sum(1 for r in records if r.reviewer_notes.startswith("REJECTED:")
                   or "; REJECTED:" in r.reviewer_notes)
    print(f"discovered {len(records)} crops in this run"
          f"{f' (category: {args.category})' if args.category else ''}"
          f"{f' (crop: {args.crop})' if args.crop else ''}")
    print(f"  real retrieved tier confirmed : {tier_selected}")
    print(f"  confirmed leads (not retrieved): {confirmed_leads}")
    print(f"  rejected false leads          : {rejected}")
    print(f"  open leads still needing review: {open_leads}")
    print(f"wrote output/crop_discovery_record.csv ({len(merged)} total records across all runs)")
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    """Section 5.2 discovery_progress_dashboard."""
    registry, _ = REG.ingest_and_audit()
    records = DISC.load_discovery_records_csv(DISCOVERY_CSV)
    rows = DISC.dashboard_rows(registry, records)
    if args.json:
        print(json.dumps(rows, indent=2))
        return 0
    headers = ("category", "total", "done", "A", "B", "B2", "C", "D", "E", "avg_conf")
    print(f"{headers[0]:<55} {headers[1]:>6} {headers[2]:>6} "
          f"{headers[3]:>4} {headers[4]:>4} {headers[5]:>4} "
          f"{headers[6]:>4} {headers[7]:>4} {headers[8]:>4} {headers[9]:>8}")
    for row in rows:
        note = "" if row["discovered"] else "  (discovery not yet run)"
        avg = "" if row["avg_confidence"] is None else f"{row['avg_confidence']:.2f}"
        print(f"{row['category']:<55} {row['total_crops']:>6} "
              f"{row['discovery_complete']:>6} {row['tier_a']:>4} {row['tier_b']:>4} "
              f"{row['tier_b2']:>4} {row['tier_c']:>4} {row['tier_d']:>4} "
              f"{row['tier_e']:>4} {avg:>8}{note}")
    return 0


def cmd_review_queue(args: argparse.Namespace) -> int:
    """List discovery records with low confidence or an incomplete checklist."""
    records = DISC.load_discovery_records_csv(DISCOVERY_CSV)
    queue = [r for r in records if DISC.in_review_queue(r)]
    queue.sort(key=lambda r: (r.crop_id, r.crop_name))
    if args.json:
        print(json.dumps([r.to_dict() for r in queue], indent=2))
        return 0
    print(f"review-queue: {len(queue)} of {len(records)} discovery records")
    print(f"{'crop_id':<36} {'conf_us':>7} {'conf_ca':>7} {'tier_us':>7} "
          f"{'tier_ca':>7} incomplete  notes")
    for rec in queue:
        incomplete = "yes" if DISC.checklist_incomplete(rec) else "no"
        notes = (rec.reviewer_notes or "").replace("\n", " ")
        if len(notes) > 90:
            notes = notes[:87] + "..."
        print(f"{rec.crop_id:<36} {rec.confidence_us:>7} {rec.confidence_ca:>7} "
              f"{(rec.selected_tier_us or '-'):>7} {(rec.selected_tier_ca or '-'):>7} "
              f"{incomplete:<11} {notes}")
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
    p_dash.add_argument("--json", action="store_true")
    p_dash.set_defaults(func=cmd_dashboard)

    p_disc = sub.add_parser("discover", help="run the Section 3 discovery pass")
    p_disc.add_argument("--category", default=None,
                        help="category prefix, e.g. 'Vegetables'")
    p_disc.add_argument("--crop", default=None,
                        help="single crop_id or crop_name, e.g. saffron")
    p_disc.set_defaults(func=cmd_discover)

    p_queue = sub.add_parser("review-queue",
                             help="list low-confidence or incomplete discovery records")
    p_queue.add_argument("--json", action="store_true")
    p_queue.set_defaults(func=cmd_review_queue)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
