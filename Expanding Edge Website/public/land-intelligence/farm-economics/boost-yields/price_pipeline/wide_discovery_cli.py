"""Command-line interface for the v3 source-discovery-first price layer (§57).

Parallel to :mod:`wide_cli` (v2) — the v2 CLI answers "which defensible tier does this
crop support?"; this CLI answers "where does price data credibly exist for this crop,
under which source class and price type, and what (if anything) have we retrieved?".
The honesty contract is unchanged: a fetch that retrieves nothing exits 2 with an
explanation of what WAS found, never an invented number.

Commands (§57):
    discover --crop C [--all]     candidate sources for one crop or the full seed list
    fetch    --crop C | --group G | --country CC | --all
                                  run retrieval over candidates (parsers permitting)
    audit                         write the §47 search audit + §46 manual review queue
    report                        write all §56 deliverables
    status                        validate the §30 master source catalog
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import wide_crop_identity as ID
from . import wide_price_fetch as FETCH
from . import wide_source_discovery as DISC
from . import wide_source_report as WSR
from .wide_seed import read_seed_list
from .wide_source_catalog import WideSourceCatalogError, load_source_catalog

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

# Same exit-code contract as v1/v2 so callers can chain the CLIs.
EXIT_OK = 0
EXIT_NO_SOURCE = 2
EXIT_UNKNOWN_CROP = 3
EXIT_INVALID = 1


def _stamp() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load(seed_path: str | None = None):
    return read_seed_list(seed_path), load_source_catalog()


def _countries(seed) -> list[str]:
    seen: list[str] = []
    for c in seed.crops:
        for cc in c.target_countries:
            if cc not in seen:
                seen.append(cc)
    return sorted(seen)


def _match_crop(seed, query: str):
    """Exact canonical match wins; substring matching otherwise; ambiguity reported."""
    q = (query or "").strip().lower()
    if not q:
        return []
    exact = [c for c in seed.crops if c.crop.lower() == q]
    if exact:
        return exact
    return [c for c in seed.crops if q in c.crop.lower().replace("_", " ")
            or q in c.crop.lower()]


def _discover_for(seed_crops, seed, catalog) -> dict[str, list[DISC.CandidateSource]]:
    identities = ID.identities_for_seed(seed)
    wanted = {c.crop for c in seed_crops}
    return {
        c.crop: DISC.discover_crop(identities[c.crop], c.crop_group, c.target_countries,
                                   catalog)
        for c in seed.crops if c.crop in wanted
    }


# --------------------------------------------------------------------- commands

def cmd_discover(args: argparse.Namespace) -> int:
    """§57: list candidate sources — the discovery layer's primary output."""
    seed, catalog = _load(args.seed)
    if args.crop:
        matches = _match_crop(seed, args.crop)
        if not matches:
            print(f"unknown crop: {args.crop!r}", file=sys.stderr)
            return EXIT_UNKNOWN_CROP
        if len(matches) > 1 and not args.first:
            print("ambiguous crop query; matches: "
                  + ", ".join(c.crop for c in matches), file=sys.stderr)
            return EXIT_UNKNOWN_CROP
        seed_crops = matches[:1] if args.first else matches
    else:
        seed_crops = list(seed.crops)
    discovered = _discover_for(seed_crops, seed, catalog)
    if args.out:
        WSR.write_crop_source_map(discovered, args.out)
        print(f"wrote {os.path.join(args.out, 'wide_crop_source_map.csv')}")
    for crop, cands in discovered.items():
        print(f"{crop}: {len(cands)} candidate source(s)")
        for k in cands:
            print(f"  [{k.country}] {k.source_id} ({k.source_class}/{k.price_type}, "
                  f"{k.match_confidence}, {k.access_status})"
                  + (f" -- {'; '.join(k.retrieval_blockers)}"
                     if k.retrieval_blockers else ""))
    return EXIT_OK if any(discovered.values()) else EXIT_NO_SOURCE


def cmd_fetch(args: argparse.Namespace) -> int:
    """§57: attempt retrieval over the discovered candidates (honest summary §59)."""
    seed, catalog = _load(args.seed)
    if args.crop:
        seed_crops = _match_crop(seed, args.crop)
        if not seed_crops:
            print(f"unknown crop: {args.crop!r}", file=sys.stderr)
            return EXIT_UNKNOWN_CROP
    elif args.group:
        seed_crops = [c for c in seed.crops if c.crop_group == args.group]
        if not seed_crops:
            print(f"unknown crop_group: {args.group!r}", file=sys.stderr)
            return EXIT_UNKNOWN_CROP
    else:  # --country alone or --all
        seed_crops = list(seed.crops)
    discovered = _discover_for(seed_crops, seed, catalog)
    candidates = [k for cands in discovered.values() for k in cands
                  if args.country is None or k.country == args.country]
    report = FETCH.fetch_candidates(candidates, retrieved_at=_stamp(),
                                    raw_dir=(os.path.join(args.out, "raw")
                                             if args.out else None))
    summary = report.summary()
    if args.out:
        WSR.write_fetch_summary(report, args.out)
        obs_path = WSR.write_observations(report.observations, args.out)
        if obs_path:
            print(f"wrote {obs_path}")
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"candidates: {summary['sources_attempted']}  "
              f"retrieved: {summary['sources_with_price']}  "
              f"observations: {summary['observations']}  "
              f"access-blocked: {summary['access_blocked']}")
        if not report.observations:
            print("No price observations retrieved. This is not 'no data exists': "
                  "see wide_fetch_summary.csv for per-source reasons "
                  "(missing keys, manual-only sources, unimplemented parsers).")
    return EXIT_OK if report.observations else EXIT_NO_SOURCE


def cmd_audit(args: argparse.Namespace) -> int:
    """§47/§46: the search log and the manual-review queue — evidence, not verdicts."""
    seed, catalog = _load(args.seed)
    out = args.out or OUTPUT_DIR
    audit = WSR.write_search_audit(seed, catalog, _stamp(), out)
    review = WSR.write_manual_review(seed, catalog, out)
    print(f"wrote {audit}")
    print(f"wrote {review}")
    return EXIT_OK


def cmd_report(args: argparse.Namespace) -> int:
    """§56: write every v3 deliverable and summarize what was written."""
    seed, catalog = _load(args.seed)
    out = args.out or OUTPUT_DIR
    discovered = DISC.discover_all(seed, catalog)
    written = WSR.write_all(discovered, seed, catalog, _stamp(), _countries(seed), out)
    if args.json:
        print(json.dumps({k: os.path.basename(v) for k, v in written.items()},
                         indent=2))
    else:
        for name, path in written.items():
            print(f"{name:16s} {path}")
    return EXIT_OK


def cmd_status(args: argparse.Namespace) -> int:
    """Validate the §30 catalog: loads cleanly, vocabularies closed, IDs unique."""
    try:
        catalog = load_source_catalog()
    except WideSourceCatalogError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return EXIT_INVALID
    classes = sorted({s.source_class for s in catalog.sources})
    ptypes = sorted({s.price_type for s in catalog.sources})
    if args.json:
        print(json.dumps({
            "sources": len(catalog.sources),
            "source_classes": classes,
            "price_types": ptypes,
            "last_checked": catalog.last_checked,
            "enabled": sum(1 for s in catalog.sources if s.access_status == "enabled"),
        }, indent=2))
    else:
        print(f"sources : {len(catalog.sources)} "
              f"({sum(1 for s in catalog.sources if s.access_status == 'enabled')} enabled)")
        print(f"classes : {', '.join(classes)}")
        print(f"types   : {', '.join(ptypes)}")
        print("validation: clean")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wide_discovery_cli",
        description=(
            "v3 source-discovery-first specialty-crop price layer. Catalogs where price "
            "data credibly exists (source class x price type) and retrieves only through "
            "registered, tested parsers. Never emits a price that was not retrieved."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_disc = sub.add_parser("discover", help="list candidate sources for a crop or all")
    p_disc.add_argument("--crop", default=None)
    p_disc.add_argument("--first", action="store_true",
                        help="take the first match instead of reporting ambiguity")
    p_disc.add_argument("--out", default=None, help="also write wide_crop_source_map.csv")
    p_disc.add_argument("--seed", default=None)
    p_disc.set_defaults(func=cmd_discover)

    p_fetch = sub.add_parser("fetch", help="attempt retrieval over candidates")
    sel = p_fetch.add_mutually_exclusive_group()
    sel.add_argument("--crop", default=None)
    sel.add_argument("--group", default=None)
    sel.add_argument("--all", action="store_true")
    p_fetch.add_argument("--country", default=None, help="restrict to a country code")
    p_fetch.add_argument("--out", default=None)
    p_fetch.add_argument("--json", action="store_true")
    p_fetch.add_argument("--seed", default=None)
    p_fetch.set_defaults(func=cmd_fetch)

    p_audit = sub.add_parser("audit", help="write search audit + manual review queue")
    p_audit.add_argument("--out", default=None)
    p_audit.add_argument("--seed", default=None)
    p_audit.set_defaults(func=cmd_audit)

    p_rep = sub.add_parser("report", help="write all §56 deliverables")
    p_rep.add_argument("--out", default=None)
    p_rep.add_argument("--json", action="store_true")
    p_rep.add_argument("--seed", default=None)
    p_rep.set_defaults(func=cmd_report)

    p_stat = sub.add_parser("status", help="validate the master source catalog")
    p_stat.add_argument("--json", action="store_true")
    p_stat.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
