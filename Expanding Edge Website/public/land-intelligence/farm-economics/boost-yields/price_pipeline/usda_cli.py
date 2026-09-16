"""Command-line interface for the U.S. specialty-crop price pipeline (§27, §35).

Section 35 defines success by two commands:

    python -m price_pipeline.usda_cli fetch --crop "shiitake"
    python -m price_pipeline.usda_cli fetch --crop "wasabi"

The first must return a machine-readable record with its price, unit, period, market
level, geography, tier, source, retrieval timestamp, original and normalized observation,
plus enough provenance to reproduce it. The second must return the refusal string rather
than a number. Neither may invent anything, so this module contains no fallback price and
no default value for any observation field.

``--json`` prints the record; the default renders it for a human. Both paths read the same
record, so the human output can never disagree with the machine output.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from typing import Any

from . import usda_registry as UR
from . import usda_report as R
from .usda_workbook import read_workbook

PROJECT_ROOT = UR.PROJECT_ROOT
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

EXIT_OK = 0
EXIT_NO_SOURCE = 2      # distinguishable so a caller can branch without parsing prose
EXIT_UNKNOWN_CROP = 3


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _load() -> tuple[list[R.CropClassification], dict[str, Any], str, str]:
    book = read_workbook()
    doc = UR.load_usda_registry()
    stamp = _now()
    classes = R.classify_all(book, doc, last_checked=stamp[:10])
    return classes, doc, stamp, book.sha256


PACKAGE_WORDS = frozenset({
    "bag", "bin", "box", "bunch", "bunches", "carton", "case", "clamshell", "count",
    "crate", "ct", "cwt", "dozen", "each", "flat", "gram", "grams", "half", "kilo",
    "kilogram", "kilograms", "lb", "lbs", "ounce", "ounces", "oz", "pack", "package",
    "per", "pint", "pound", "pounds", "quart", "stem", "stems", "tub", "unit",
})


def _match(
    classes: list[R.CropClassification], query: str, doc: dict[str, Any],
) -> list[R.CropClassification]:
    """Resolve a user's crop query against the seed list.

    Resolution order, and nothing fuzzy beyond it:

    1. exact slug match on the crop name (``"Mushrooms"`` -> ``mushrooms``);
    2. a declared alias (``"shiitake"`` -> ``mushrooms``);
    3. the query, with packaging/unit words dropped, as a substring of exactly one
       crop slug.

    Step 3 is restricted to a *single* hit deliberately. Fuzzy matching that picks the
    nearest-looking crop is the substitution §32 forbids — ``"ginger"`` must not silently
    return ginger root when galanga is also on the list. Ambiguity is reported instead.

    The package-word stripping exists because AMS quotes ``Basil`` as ``$/bunch``, so
    ``"bunch basil"`` is how the package form is named. Without this the query resolves to
    nothing and the caller gets a misleading "unknown crop" for a crop that is present.
    Stripping only ever removes unit nouns, so it cannot manufacture a crop identity: if
    nothing remains, or the residue is still ambiguous, the caller is told rather than
    handed a guess.
    """
    q = R.crop_id_for(query)
    if not q:
        return []

    def _resolve(slug: str) -> list[R.CropClassification]:
        exact = [c for c in classes if c.crop_id == slug]
        if exact:
            return exact
        alias_target = UR.aliases(doc).get(slug)
        if alias_target:
            hit = [c for c in classes if c.crop_id == alias_target]
            if hit:
                return hit
        return [c for c in classes if slug in c.crop_id]

    hits = _resolve(q)
    if hits:
        return hits

    residue = R.crop_id_for(" ".join(
        w for w in q.split("-") if w and w not in PACKAGE_WORDS
    ))
    return _resolve(residue) if residue else []


def _fetch_record(cls: R.CropClassification, doc: dict[str, Any]) -> dict[str, Any]:
    """The §35 record. Every field is present; unretrieved fields are explicitly null."""
    tspecs = UR.tiers(doc)
    tier_spec = tspecs.get(cls.selected_tier) if cls.selected_tier else None
    record: dict[str, Any] = {
        "crop": cls.crop,
        "crop_id": cls.crop_id,
        "classification_status": cls.classification_status,
        "price_available": cls.price_available,
        "economic_value_available": cls.economic_value_available,
        "message": None if cls.price_available else R.NO_SOURCE_MESSAGE,
        # --- observation fields: null, never guessed -------------------------
        "price": None,
        "price_low": None,
        "price_high": None,
        "price_mostly": None,
        "unit": None,
        "currency": None,
        "normalized_price_usd_per_lb": None,
        "normalized_price_usd_per_kg": None,
        "period": None,
        "period_type": None,
        "geography": None,
        "variety": None,
        "grade": None,
        "package": None,
        "market": None,
        # --- classification / provenance -------------------------------------
        "market_level": cls.market_level,
        "source_tier": cls.selected_tier,
        "source_system": cls.source_system,
        "source_tier_definition": tier_spec.definition if tier_spec else None,
        "source_id": cls.selected_source,
        "source_url": cls.seed_source_url,
        "retrieval_timestamp": None,
        "original_observation": None,
        "normalized_observation": None,
        "checked_at": cls.last_checked,
        "seed_tier": cls.seed_tier_original,
        "seed_finding": cls.seed_finding,
        "nass_commodity_ref": cls.nass_commodity_ref,
        "confidence": cls.confidence,
        "reason": cls.reason,
        "retrieval_blockers": cls.retrieval_blockers,
        "searches_performed": R.audit_record(cls)["checks"],
    }
    if cls.price_available:
        # Unreachable in this build: no retrieval adapter exists, so nothing can
        # legitimately report a price yet. It is a hard error rather than a silent pass
        # because the only way to reach it is a classification bug, and a classification bug
        # that flows into a published price is the exact failure this pipeline exists to
        # prevent.
        raise AssertionError(
            f"{cls.crop!r} classified price_available with no retrieval adapter; "
            "refusing to emit a price"
        )
    return record


def _render_human(record: dict[str, Any]) -> str:
    """Human rendering of the same record the JSON path prints.

    When no source is available the refusal is printed first: the remaining lines report
    *which* searches were made, which is the part that makes the refusal auditable rather
    than merely negative.
    """
    lines: list[str] = []
    if record["price_available"]:
        lines.append(f"{record['crop']}: {record['price']} {record['unit']} "
                     f"({record['period']}, {record['market_level']})")
    else:
        lines.append(f"{record['crop']}: {record['message']}")
    lines.append("")
    lines.append(f"  tier (seed)      : {record['seed_tier']}")
    lines.append(f"  tier (selected)  : {record['source_tier'] or 'none'}")
    lines.append(f"  market level     : {record['market_level'] or 'n/a'}")
    lines.append(f"  price available  : {'yes' if record['price_available'] else 'no'}")
    lines.append(f"  economic value   : "
                 f"{'yes' if record['economic_value_available'] else 'no'}")
    lines.append(f"  confidence       : {record['confidence']}")
    lines.append(f"  checked at       : {record['checked_at']}")
    if record["nass_commodity_ref"]:
        lines.append(f"  NASS reference   : {record['nass_commodity_ref']}")
    lines.append("")
    lines.append("  searches performed:")
    for check in record["searches_performed"]:
        lines.append(f"    - {check}")
    if record["retrieval_blockers"]:
        lines.append("")
        lines.append("  why no price:")
        for blocker in record["retrieval_blockers"]:
            lines.append(f"    - {blocker}")
    lines.append("")
    lines.append(f"  reason: {record['reason']}")
    return "\n".join(lines)


def cmd_fetch(args: argparse.Namespace) -> int:
    classes, doc, _stamp, _sha = _load()
    hits = _match(classes, args.crop, doc)
    if not hits:
        known = ", ".join(sorted(c.crop for c in classes))
        print(f"No crop matching {args.crop!r} in the seed list.", file=sys.stderr)
        print(f"Known crops: {known}", file=sys.stderr)
        return EXIT_UNKNOWN_CROP
    if len(hits) > 1 and not args.first:
        print(f"{args.crop!r} matches {len(hits)} crops: "
              f"{', '.join(h.crop for h in hits)}", file=sys.stderr)
        print("Narrow the name, or pass --first to take the first match.", file=sys.stderr)
        return EXIT_UNKNOWN_CROP

    record = _fetch_record(hits[0], doc)
    if args.json:
        print(json.dumps(record, indent=2, ensure_ascii=False))
    else:
        print(_render_human(record))
    return EXIT_OK if record["price_available"] else EXIT_NO_SOURCE


def cmd_report(args: argparse.Namespace) -> int:
    """Write the three §33–34 deliverables and summarize them."""
    classes, doc, stamp, sha = _load()
    out = args.out or OUTPUT_DIR
    status_path = os.path.join(out, "crop_source_status.csv")
    audit_path = os.path.join(out, "source_audit.csv")
    cov_path = os.path.join(out, "coverage_report.html")

    R.write_crop_source_status(status_path, classes)
    R.write_source_audit(audit_path, classes)
    html_doc = R.render_coverage_html(
        classes, doc, generated_at=stamp, workbook_sha256=sha,
    )
    os.makedirs(out, exist_ok=True)
    with open(cov_path, "w", encoding="utf-8") as fh:
        fh.write(html_doc)

    facts = R.coverage_facts(classes, doc)
    if args.json:
        print(json.dumps({
            "generated_at": stamp,
            "workbook_sha256": sha,
            "crops": len(classes),
            "by_selected_tier": facts["by_selected_tier"],
            "price_available": len(facts["price_available"]),
            "needs_manual_review": len(facts["needs_manual_review"]),
            "files": [status_path, audit_path, cov_path],
        }, indent=2))
    else:
        print(f"crops classified      : {len(classes)}")
        for tier, count in sorted(facts["by_selected_tier"].items()):
            print(f"  tier {tier} selected      : {count}")
        print(f"  price available     : {len(facts['price_available'])}")
        print(f"  needs manual review : {len(facts['needs_manual_review'])}")
        print("")
        for path in (status_path, audit_path, cov_path):
            print(f"wrote {os.path.relpath(path, PROJECT_ROOT)}")
    return EXIT_OK


def cmd_status(args: argparse.Namespace) -> int:
    """Registry self-check: tiers, sources, crops and validation problems (§26)."""
    doc = UR.load_usda_registry()
    problems = UR.validate(doc)
    crops = UR.crops(doc)
    sources = UR.usda_sources(doc)
    if args.json:
        print(json.dumps({
            "tiers": {t: s.label for t, s in UR.tiers(doc).items()},
            "crops": len(crops),
            "sources": len(sources),
            "enabled_sources": sum(1 for s in sources if s.enabled),
            "market_levels": sorted(UR.market_levels(doc)),
            "problems": problems,
        }, indent=2))
    else:
        print(f"tiers   : {', '.join(sorted(UR.tiers(doc)))}")
        print(f"crops   : {len(crops)}")
        print(f"sources : {len(sources)} "
              f"({sum(1 for s in sources if s.enabled)} enabled)")
        print("")
        if problems:
            print("VALIDATION PROBLEMS:")
            for problem in problems:
                print(f"  - {problem}")
            return 1
        print("validation: clean")
    return EXIT_OK if not problems else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="usda_cli",
        description=(
            "U.S. specialty-crop price layer. Reports source availability only; never "
            "emits a price that was not retrieved from a defensible source."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser(
        "fetch", help="look up one crop's price record (or the refusal)",
    )
    p_fetch.add_argument("--crop", required=True, help='crop name, e.g. "shiitake"')
    p_fetch.add_argument("--json", action="store_true", help="print the machine record")
    p_fetch.add_argument(
        "--first", action="store_true",
        help="take the first match instead of reporting an ambiguous query",
    )
    p_fetch.set_defaults(func=cmd_fetch)

    p_report = sub.add_parser("report", help="write status, audit and coverage files")
    p_report.add_argument("--out", default=None, help="output directory")
    p_report.add_argument("--json", action="store_true", help="print a JSON summary")
    p_report.set_defaults(func=cmd_report)

    p_status = sub.add_parser("status", help="validate the registry")
    p_status.add_argument("--json", action="store_true", help="print a JSON summary")
    p_status.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

