"""End-to-end price pipeline runner.

``collect()`` builds a :class:`ParseContext` per enabled registry source, dispatches
to its parser, and returns every observation plus a :class:`RunReport` describing
what happened to each source. A missing raw artifact or a registry `parser:` value
with no dispatch entry is recorded as a *skip*, never a crash — one absent download
or one drifted registry entry must not abort every other source's run.

``write_dataset()`` writes the three files ``prices.js`` (the frontend layer) reads
from ``data/price-observations/``:

* ``sources.json`` — small manifest: totals, the price_type taxonomy (with
  ``values_included`` always present, defaulted ``True``), and a per-source report.
* ``observations.json`` — converted rows, partitioned by ``price_type`` so no file
  ever mixes taxonomies.
* ``quarantine.json`` — rows whose ``normalized_value`` is ``None``, with
  ``conversion_basis``/``conversion_detail`` retained as the reason. Visible, never
  dropped.

A price_type the registry externalizes by policy (``values_included: false`` —
currently only ``commercial_bid_reference_link``) is dropped before either file is
written, so a licence-restricted value can never reach the dataset even if a parser
bug ever emitted one.
"""

from __future__ import annotations

import datetime
import os
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from . import registry
from .models import Observation, dump_json
from .parsers import ParseContext
from .parsers import get as get_parser


@dataclass
class SourceResult:
    """What happened when the runner tried to parse one registered source."""

    source_id: str
    parser: str
    price_type: str
    status: str                # "parsed" | "skipped"
    doc_file: str
    count: int = 0
    quarantined: int = 0
    sha256: str | None = None
    reason: str = ""

    def to_manifest_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "parser": self.parser,
            "price_type": self.price_type,
            "status": self.status,
            "observations": self.count,
            "quarantined": self.quarantined,
            "doc_file": self.doc_file,
            "raw_sha256": self.sha256,
            "reason": self.reason,
        }


@dataclass
class RunReport:
    retrieved_at: str
    results: list[SourceResult] = field(default_factory=list)

    @property
    def skipped(self) -> list[SourceResult]:
        return [r for r in self.results if r.status == "skipped"]

    @property
    def parsed(self) -> list[SourceResult]:
        return [r for r in self.results if r.status == "parsed"]


def collect(
    *, retrieved_at: str, source_ids: list[str] | None = None,
) -> tuple[list[Observation], RunReport]:
    """Parse every matching enabled source. Returns (rows, report)."""
    doc = registry.load_registry()
    report = RunReport(retrieved_at=retrieved_at)
    rows: list[Observation] = []

    specs = registry.sources(doc)
    if source_ids is not None:
        wanted = set(source_ids)
        specs = [s for s in specs if s.source_id in wanted]

    for src in specs:
        try:
            parser = get_parser(src.parser)
        except KeyError as exc:
            report.results.append(SourceResult(
                source_id=src.source_id, parser=src.parser, price_type=src.price_type,
                status="skipped", doc_file=src.raw_name, reason=str(exc),
            ))
            print(f"SKIP {src.source_id}: {exc}", flush=True)
            continue

        try:
            ctx = ParseContext.build(src, retrieved_at=retrieved_at)
        except FileNotFoundError as exc:
            report.results.append(SourceResult(
                source_id=src.source_id, parser=src.parser, price_type=src.price_type,
                status="skipped", doc_file=src.raw_name, reason=str(exc),
            ))
            print(f"SKIP {src.source_id}: {exc}", flush=True)
            continue

        src_rows = list(parser(ctx, src.options))
        converted = sum(1 for r in src_rows if not r.is_quarantined)
        quarantined = len(src_rows) - converted
        rows.extend(src_rows)
        report.results.append(SourceResult(
            source_id=src.source_id, parser=src.parser, price_type=src.price_type,
            status="parsed", doc_file=src.raw_name, count=converted,
            quarantined=quarantined, sha256=ctx.sha256,
        ))
        print(f"{src.source_id}: {converted} converted, {quarantined} quarantined", flush=True)

    return rows, report


def write_dataset(rows: list[Observation], report: RunReport, *, out_dir: str) -> dict[str, Any]:
    """Write sources.json / observations.json / quarantine.json. Returns the manifest."""
    os.makedirs(out_dir, exist_ok=True)
    doc = registry.load_registry()

    price_types_meta: dict[str, Any] = {}
    for ptype, meta in (doc.get("price_types") or {}).items():
        m = dict(meta)
        m.setdefault("values_included", True)
        price_types_meta[ptype] = m
    excluded_types = {p for p, m in price_types_meta.items() if m.get("values_included") is False}

    kept: dict[str, list[dict[str, Any]]] = defaultdict(list)
    quarantined: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for obs in sorted(rows, key=lambda o: o.observation_id):
        if obs.price_type in excluded_types:
            continue
        row = obs.to_dict()
        (quarantined if obs.is_quarantined else kept)[obs.price_type].append(row)

    by_price_type = {k: len(v) for k, v in kept.items()}
    total_obs = sum(by_price_type.values())
    total_quarantined = sum(len(v) for v in quarantined.values())

    manifest = {
        "generated_at": report.retrieved_at,
        "totals": {
            "observations": total_obs,
            "quarantined": total_quarantined,
            "sources_parsed": len(report.parsed),
            "sources_skipped": len(report.skipped),
        },
        "price_types": price_types_meta,
        "sources": [r.to_manifest_dict() for r in report.results],
    }

    with open(os.path.join(out_dir, "sources.json"), "w", encoding="utf-8") as fh:
        fh.write(dump_json(manifest))
    with open(os.path.join(out_dir, "observations.json"), "w", encoding="utf-8") as fh:
        fh.write(dump_json({"count": total_obs, "by_price_type": by_price_type,
                             "observations": dict(kept)}))
    with open(os.path.join(out_dir, "quarantine.json"), "w", encoding="utf-8") as fh:
        fh.write(dump_json({"count": total_quarantined, "observations": dict(quarantined)}))

    return manifest


def main() -> int:
    retrieved_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows, report = collect(retrieved_at=retrieved_at)
    manifest = write_dataset(rows, report, out_dir=registry.DATA_DIR)
    print(f"TOTAL: {manifest['totals']}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
