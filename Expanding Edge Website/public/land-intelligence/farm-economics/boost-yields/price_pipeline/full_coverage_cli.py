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
        registry, category_filter=args.category, crop_filter=args.crop,
        live_us=True)
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


def cmd_retrieve_us(args: argparse.Namespace) -> int:
    """Pull NASS QuickStats / AMS catalog using env API keys. Never stores keys."""
    from . import nass_quickstats as NASS
    from . import ams_market_news as AMS
    if not args.nass and not args.ams:
        args.nass = True
        args.ams = True
    if args.nass:
        if not os.environ.get("NASS_API_KEY"):
            print("NASS_API_KEY is not set")
            return 1
        comms = NASS.retrieve_price_received_universe()
        print(f"NASS PRICE RECEIVED universe: {len(comms)} commodities")
        mushroom = NASS.retrieve_commodity("MUSHROOMS")
        hops = NASS.retrieve_commodity("HOPS")
        print(f"  mushrooms unit-price rows: {len(mushroom)}")
        print(f"  hops unit-price rows: {len(hops)}")
        years = args.years or ["2024", "2025", "2026"]
        annual = NASS.retrieve_national_annual_years(years)
        print(f"  national annual {years}: {len(annual)} unit-price rows")
        doc = NASS.build_index(mushroom + hops + annual, comms)
        print(f"  mapped crop_ids: {len(doc['by_crop_id'])}")
    if args.ams:
        if not os.environ.get("AMS_API_KEY"):
            print("AMS_API_KEY is not set")
            return 1
        reports = AMS.retrieve_report_catalog()
        doc = AMS.build_catalog_index(reports)
        print(f"AMS catalog: {doc['n_reports_in_catalog']} reports")
        for group, rows in doc["active_us_terminal"].items():
            print(f"  active US terminal {group}: {len(rows)}")
        print(f"  discontinued herb FV055 slugs: {len(doc.get('discontinued_herb_reports') or [])}")
        from . import nass_quickstats as NASS_MAP
        extracts = []
        for slug in ("2315", "2314", "BH_FV201"):
            print(f"  pulling Report Details extract for {slug}...")
            extracts.append(AMS.retrieve_report_details(slug))
            n = len(extracts[-1].get("commodities") or [])
            priced = sum(1 for c in extracts[-1].get("commodities") or [] if c.get("n_with_price"))
            print(f"    commodities {n} with_price {priced}")
        merged = AMS.merge_details_into_index(extracts, NASS_MAP.NASS_COMMODITY_TO_CROP_IDS)
        print(f"  AMS crop_ids with priced details: {len(merged.get('by_commodity') or {})}")
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


def cmd_yield_discover(args: argparse.Namespace) -> int:
    from . import yield_discovery as YD
    from . import yield_elements as YE
    registry, _ = REG.ingest_and_audit()
    all_elements = YE.import_existing_yield_factors()
    YE.write_taxonomy()
    YE.write_elements_csv(all_elements)
    elements = all_elements
    work_registry = registry
    if args.element_type:
        elements = [e for e in elements if e.element_type == args.element_type]
    if args.crop:
        needle = args.crop.strip().lower()
        elements = [e for e in elements if needle in (e.crop_id, e.element_name.lower())]
        work_registry = [r for r in registry if needle in (r.crop_id, r.crop_name.lower())]
    if args.category:
        work_registry = [r for r in work_registry if r.category.startswith(args.category)]
        ids = {r.crop_id for r in work_registry}
        elements = [e for e in elements if e.crop_id in ids]
    checked_at = __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc).date().isoformat()
    records = YD.records_from_elements(work_registry, all_elements, checked_at=checked_at)
    existing = {r["crop_id"]: r for r in YD.load_discovery_csv()}
    if args.crossref:
        targets = work_registry
        et = args.element_type or "soil_fertility"
        for row in targets[:12]:  # cap live searches this run
            try:
                result = YD.crossref_search(row.crop_name, et)
            except Exception as exc:
                rec = next(r for r in records if r.crop_id == row.crop_id)
                rec.reviewer_notes = f"CrossRef search failed: {type(exc).__name__}"
                continue
            rec = next(r for r in records if r.crop_id == row.crop_id)
            YD.apply_crossref(rec, result)
    if existing:
        merged = {r["crop_id"]: YD.YieldDiscoveryRecord(
            crop_id=r["crop_id"],
            crop_name=r.get("crop_name") or "",
            category=r.get("category") or "",
            checked_peer_reviewed_search=r.get("checked_peer_reviewed_search") in (True, "True", "true"),
            checked_extension_trials=r.get("checked_extension_trials") in (True, "True", "true"),
            checked_extension_guidance=r.get("checked_extension_guidance") in (True, "True", "true"),
            checked_industry_trials=r.get("checked_industry_trials") in (True, "True", "true"),
            elements_found_count=int(r.get("elements_found_count") or 0),
            highest_tier_found=r.get("highest_tier_found") or "",
            reviewer_notes=r.get("reviewer_notes") or "",
            checked_at=r.get("checked_at") or checked_at,
        ) for r in existing.values()}
        for rec in records:
            merged[rec.crop_id] = rec
        records = list(merged.values())
    YD.write_discovery_csv(records)
    print(f"yield_elements: {len(all_elements)} rows -> output/yield_elements.csv")
    print(f"yield_discovery_record: {len(records)} rows")
    print(f"  with elements: {sum(1 for r in records if r.elements_found_count)}")
    return 0


def cmd_yield_review_queue(args: argparse.Namespace) -> int:
    from . import yield_discovery as YD
    rows = YD.load_discovery_csv()
    queue = [r for r in rows if YD.in_review_queue(r, tier=args.tier)]
    if args.json:
        print(json.dumps(queue, indent=2))
        return 0
    print(f"yield-review-queue: {len(queue)} of {len(rows)}"
          f"{f' (tier {args.tier})' if args.tier else ''}")
    for r in queue[:40]:
        print(f"{r.get('crop_id',''):<36} tier={r.get('highest_tier_found') or '-':<2} "
              f"n={r.get('elements_found_count')} {(r.get('reviewer_notes') or '')[:70]}")
    if len(queue) > 40:
        print(f"... {len(queue) - 40} more")
    return 0


def cmd_yield_dashboard(args: argparse.Namespace) -> int:
    from . import yield_discovery as YD
    from . import yield_elements as YE
    registry, _ = REG.ingest_and_audit()
    elements = YE.import_existing_yield_factors()
    records = YD.load_discovery_csv()
    rows = YD.dashboard_rows(registry, elements, records)
    if args.json:
        print(json.dumps(rows, indent=2))
        return 0
    print(f"{'category':<55} {'crops':>6} {'with_el':>7} {'A':>4} {'B':>4} {'C':>4} {'D':>4} {'E':>4}")
    for r in rows:
        if r["with_elements"] == 0 and r["crops"] > 20:
            continue
        print(f"{r['category']:<55} {r['crops']:>6} {r['with_elements']:>7} "
              f"{r['tier_a']:>4} {r['tier_b']:>4} {r['tier_c']:>4} "
              f"{r['tier_d']:>4} {r['tier_e']:>4}")
    shown = [r for r in rows if not (r["with_elements"] == 0 and r["crops"] > 20)]
    hidden = len(rows) - len(shown)
    if hidden:
        print(f"... {hidden} categories with 0 elements omitted")
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

    p_ret = sub.add_parser("retrieve-us", help="retrieve NASS/AMS into raw/ using env keys")
    p_ret.add_argument("--nass", action="store_true")
    p_ret.add_argument("--ams", action="store_true")
    p_ret.add_argument("--years", nargs="*", default=None)
    p_ret.set_defaults(func=cmd_retrieve_us)

    p_yd = sub.add_parser("yield-discover", help="import/search yield-improvement elements")
    p_yd.add_argument("--category", default=None)
    p_yd.add_argument("--crop", default=None)
    p_yd.add_argument("--element-type", default=None, dest="element_type")
    p_yd.add_argument("--crossref", action="store_true",
                      help="run a CrossRef title search; does not invent effect sizes")
    p_yd.set_defaults(func=cmd_yield_discover)

    p_yq = sub.add_parser("yield-review-queue", help="yield discovery review queue")
    p_yq.add_argument("--tier", default=None, help="filter by highest_tier_found, e.g. D")
    p_yq.add_argument("--json", action="store_true")
    p_yq.set_defaults(func=cmd_yield_review_queue)

    p_yda = sub.add_parser("yield-dashboard", help="yield coverage by category x tier")
    p_yda.add_argument("--json", action="store_true")
    p_yda.set_defaults(func=cmd_yield_dashboard)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
