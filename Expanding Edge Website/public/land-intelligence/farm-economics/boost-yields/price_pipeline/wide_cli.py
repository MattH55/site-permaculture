"""Command-line interface for the wide-coverage (v2) specialty-crop price pipeline.

Companion to :mod:`price_pipeline.usda_cli`, not a replacement. The v1 CLI answers "what is
the U.S. price record for one workbook crop?"; this CLI answers "across the whole seed list
and both countries, what was checked, and what defensible tier did it support?" (v2 §1.6).

The honesty contract is identical, and the §35 refusal sentence is quoted verbatim from the
v1 report module so both layers refuse in the same words. A ``fetch`` for a crop with no
retrieved source returns ``No defensible recurring price source identified`` with exit code
2 — never a guessed or unofficial number.

Commands (v2 Part 4):
    discover  --seed ...        run discovery across the full seed list
    fetch     --crop C          one crop's record (or the refusal), across its countries
    fetch     --group G         every crop in a crop_group
    fetch     --country CA      restrict to the Canadian source track
    report    [--by-group]      write deliverables; --by-group/--by-country print rollups
    status                      validate seed list + wide registry consistency
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from . import usda_report as R
from . import wide_catalogs as WC
from . import wide_registry as WR
from . import wide_report as WREP
from .wide_seed import SeedList, read_seed_list

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

# Reuse the v1 exit-code contract so the two CLIs are interchangeable to a caller.
EXIT_OK = 0
EXIT_NO_SOURCE = 2
EXIT_UNKNOWN_CROP = 3
EXIT_INVALID = 1


def _load(seed_path: str | None = None, registry_path: str | None = None):
    seed = read_seed_list(seed_path)
    doc = WR.load_wide_registry(registry_path)
    return seed, doc


def _stamp() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")



# --------------------------------------------------------------------- fetch matching

def _match_crop(seed: SeedList, query: str) -> list:
    """Match a free-text crop query to seed crops.

    Exact match on the canonical ``crop`` key wins outright; otherwise substring matching.
    An ambiguous query (more than one crop) is reported, not silently resolved — the same
    substitution guard v1's CLI enforces, because picking one of several matches is how a
    pipeline starts reporting a price for the wrong crop.
    """
    q = (query or "").strip().lower()
    if not q:
        return []
    exact = [c for c in seed.crops if c.crop.lower() == q]
    if exact:
        return exact
    return [c for c in seed.crops if q in c.crop.lower().replace("_", " ")
            or q in c.crop.lower()]


def _record_for(classes: list[WREP.WideClassification],
                crop: str, country: str | None) -> dict[str, Any]:
    """The machine-readable fetch record for one crop (optionally one country)."""
    rows = [c for c in classes if c.crop == crop
            and (country is None or c.source_country == country)]
    priced = [c for c in rows if c.price_available]
    return {
        "crop": crop,
        "country_filter": country,
        "price_available": bool(priced),
        "message": None if priced else WREP.NO_SOURCE_MESSAGE,
        "observations": [
            {
                "source_country": c.source_country,
                "currency": c.currency,
                "selected_tier": c.selected_tier,
                "market_level": c.market_level,
                "price_available": c.price_available,
                "economic_value_available": c.economic_value_available,
                "confidence": c.confidence,
                "reason": c.reason,
                "last_checked": c.last_checked,
            }
            for c in sorted(rows, key=lambda c: c.source_country)
        ],
    }


def _render_human(record: dict[str, Any]) -> str:
    lines = [f"crop: {record['crop']}"]
    if record["country_filter"]:
        lines.append(f"country filter: {record['country_filter']}")
    if not record["price_available"]:
        lines.append(f"status: {record['message']}")
    for obs in record["observations"]:
        lines.append("")
        lines.append(f"  [{obs['source_country']} / {obs['currency']}] "
                     f"tier {obs['selected_tier'] or '-'} "
                     f"({obs['market_level'] or '-'})")
        lines.append(f"    price_available: {obs['price_available']}")
        lines.append(f"    confidence: {obs['confidence']}")
        lines.append(f"    reason: {obs['reason']}")
    return "\n".join(lines)


# --------------------------------------------------------------------- commands

def cmd_fetch(args: argparse.Namespace) -> int:
    seed, doc = _load(args.seed, args.registry)
    stamp = _stamp()
    classes = WREP.classify_seed_list(seed, doc, last_checked=stamp)
    country = args.country.upper() if args.country else None

    if args.group:
        members = seed.by_group(args.group)
        if not members:
            print(f"No crop_group {args.group!r}. Known: "
                  f"{', '.join(seed.groups())}", file=sys.stderr)
            return EXIT_UNKNOWN_CROP
        records = [
            _record_for(classes, c.crop, country)
            for c in members
            if country is None or country in c.target_countries
        ]
        if args.json:
            print(json.dumps({"crop_group": args.group, "records": records},
                             indent=2, ensure_ascii=False))
        else:
            for rec in records:
                print(_render_human(rec))
                print("")
        return EXIT_OK if any(r["price_available"] for r in records) else EXIT_NO_SOURCE

    if not args.crop:
        print("fetch requires --crop, --group, or --country", file=sys.stderr)
        return EXIT_INVALID

    hits = _match_crop(seed, args.crop)
    if not hits:
        known = ", ".join(sorted(c.crop for c in seed.crops))
        print(f"No crop matching {args.crop!r} in the seed list.", file=sys.stderr)
        print(f"Known crops: {known}", file=sys.stderr)
        return EXIT_UNKNOWN_CROP
    if len(hits) > 1 and not args.first:
        print(f"{args.crop!r} matches {len(hits)} crops: "
              f"{', '.join(h.crop for h in hits)}", file=sys.stderr)
        print("Narrow the name, or pass --first to take the first match.",
              file=sys.stderr)
        return EXIT_UNKNOWN_CROP

    crop = hits[0]
    if country and country not in crop.target_countries:
        print(f"{crop.crop!r} does not target country {country}; "
              f"targets {list(crop.target_countries)}", file=sys.stderr)
        return EXIT_NO_SOURCE

    record = _record_for(classes, crop.crop, country)
    if args.json:
        print(json.dumps(record, indent=2, ensure_ascii=False))
    else:
        print(_render_human(record))
    return EXIT_OK if record["price_available"] else EXIT_NO_SOURCE


def cmd_report(args: argparse.Namespace) -> int:
    seed, doc = _load(args.seed, args.registry)
    stamp = _stamp()
    classes = WREP.classify_seed_list(seed, doc, last_checked=stamp)
    out = args.out or OUTPUT_DIR

    status_path = os.path.join(out, "crop_source_status.csv")
    audit_path = os.path.join(out, "source_audit.csv")
    by_group_path = os.path.join(out, "coverage_by_group.csv")
    by_country_path = os.path.join(out, "coverage_by_country.csv")
    WREP.write_crop_source_status(status_path, classes)
    WREP.write_source_audit(audit_path, classes)
    WREP.write_coverage_by_group(by_group_path, classes)
    WREP.write_coverage_by_country(by_country_path, classes)

    by_group = WREP.coverage_by_group(classes)
    by_country = WREP.coverage_by_country(classes)

    if args.json:
        print(json.dumps({
            "generated_at": stamp,
            "crops": len(seed.crops),
            "rows": len(classes),
            "by_group": by_group,
            "by_country": by_country,
            "files": [status_path, audit_path, by_group_path, by_country_path],
        }, indent=2))
        return EXIT_OK

    print(f"crops seeded : {len(seed.crops)}")
    print(f"status rows  : {len(classes)} (one per crop x country)")
    print("\ncoverage by country:")
    for r in by_country:
        print(f"  {r['source_country']}: {r['crops']} crops, "
              f"{r['tier_c_or_better']} at tier C or better, "
              f"{r['price_available']} with a price")
    print("\ncoverage by group:")
    for r in by_group:
        flag = "  [SPOT-CHECK: 100% Tier A]" if r["flag_full_tier_a"] else ""
        print(f"  {r['crop_group']}: {r['crops']} crops — "
              f"A={r['tier_A']} B={r['tier_B']} B2={r['tier_B2']} "
              f"C={r['tier_C']} D={r['tier_D']} E={r['tier_E']} "
              f"unclassified={r['unclassified']}{flag}")
    print("")
    for path in (status_path, audit_path, by_group_path, by_country_path):
        print(f"wrote {os.path.relpath(path, PROJECT_ROOT)}")
    return EXIT_OK



def cmd_discover(args: argparse.Namespace) -> int:
    """Classify the full seed list and write the status/audit deliverables.

    In this build no source is enabled, so discovery *classifies* every crop-country pair
    and records the searches performed, but asserts no retrieved tier. A reviewer can see
    exactly what would be checked before any fetch is attempted (v2 Part 4).
    """
    seed, doc = _load(args.seed, args.registry)
    stamp = _stamp()
    classes = WREP.classify_seed_list(seed, doc, last_checked=stamp)
    out = args.out or OUTPUT_DIR
    WREP.write_crop_source_status(os.path.join(out, "crop_source_status.csv"), classes)
    WREP.write_source_audit(os.path.join(out, "source_audit.csv"), classes)
    WREP.write_coverage_by_group(os.path.join(out, "coverage_by_group.csv"), classes)
    WREP.write_coverage_by_country(os.path.join(out, "coverage_by_country.csv"), classes)
    ca = WC.load_ca_catalog()
    surveys = WC.load_special_surveys()
    summary = {
        "generated_at": stamp,
        "crops": len(seed.crops),
        "rows": len(classes),
        "ca_sources_catalogued": len(ca),
        "nass_special_surveys_catalogued": len(surveys),
        "tier_selected": sum(1 for c in classes
                             if c.classification_status == WREP.STATUS_TIER_SELECTED),
        "checked_no_source": sum(1 for c in classes
                                 if c.classification_status == WREP.STATUS_CHECK_ONLY),
    }
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"discovered {summary['crops']} crops -> {summary['rows']} crop-country rows")
        print(f"  ca sources catalogued      : {summary['ca_sources_catalogued']}")
        print(f"  nass special surveys known : {summary['nass_special_surveys_catalogued']}")
        print(f"  tier selected              : {summary['tier_selected']}")
        print(f"  checked, no source         : {summary['checked_no_source']}")
    return EXIT_OK


def cmd_status(args: argparse.Namespace) -> int:
    """Validate seed list + wide registry consistency (v2 Part 3 / Part 5)."""
    seed, doc = _load(args.seed, args.registry)
    problems = WR.validate(doc, seed_groups=set(seed.groups()))
    families = WR.source_families(doc)
    if args.json:
        print(json.dumps({
            "crops": len(seed.crops),
            "groups": seed.groups(),
            "source_families": sorted(families),
            "problems": problems,
        }, indent=2))
    else:
        print(f"crops   : {len(seed.crops)} across {len(seed.groups())} groups")
        print(f"families: {', '.join(sorted(families))}")
        if problems:
            print("\nVALIDATION PROBLEMS:")
            for problem in problems:
                print(f"  - {problem}")
            return EXIT_INVALID
        print("validation: clean")
    return EXIT_OK if not problems else EXIT_INVALID



def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wide_cli",
        description=(
            "Wide-coverage specialty-crop price layer (US + CA). Reports source coverage "
            "and classification only; never emits a price that was not retrieved from a "
            "defensible source."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def _common(p):
        p.add_argument("--seed", default=None, help="path to the seed list CSV")
        p.add_argument("--registry", default=None,
                       help="path to wide_price_sources.yaml")

    p_fetch = sub.add_parser(
        "fetch", help="look up a crop/group/country record (or the refusal)")
    p_fetch.add_argument("--crop", default=None, help='crop name, e.g. "shiitake"')
    p_fetch.add_argument("--group", default=None, help="crop_group, e.g. mushroom")
    p_fetch.add_argument("--country", default=None, help="restrict to a country (US|CA)")
    p_fetch.add_argument("--first", action="store_true",
                         help="take the first match instead of reporting an ambiguous query")
    p_fetch.add_argument("--json", action="store_true")
    _common(p_fetch)
    p_fetch.set_defaults(func=cmd_fetch)

    p_report = sub.add_parser(
        "report", help="write status, audit and coverage deliverables")
    p_report.add_argument("--by-group", action="store_true",
                          help="print the by-group rollup")
    p_report.add_argument("--by-country", action="store_true",
                          help="print the by-country rollup")
    p_report.add_argument("--out", default=None, help="output directory")
    p_report.add_argument("--json", action="store_true")
    _common(p_report)
    p_report.set_defaults(func=cmd_report)

    p_disc = sub.add_parser(
        "discover", help="classify the full seed list and write the maps")
    p_disc.add_argument("--out", default=None, help="output directory")
    p_disc.add_argument("--json", action="store_true")
    _common(p_disc)
    p_disc.set_defaults(func=cmd_discover)

    p_status = sub.add_parser(
        "status", help="validate the seed list and wide registry")
    p_status.add_argument("--json", action="store_true")
    _common(p_status)
    p_status.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

