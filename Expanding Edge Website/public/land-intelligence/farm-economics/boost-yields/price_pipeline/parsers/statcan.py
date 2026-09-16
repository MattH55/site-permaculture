"""Statistics Canada CSV-in-ZIP table parser.

Layout, as confirmed from the raw downloads:

    <tableid>.zip
      +-- <tableid>.csv           REF_DATE | GEO | DGUID | <dim...> | UOM | UOM_ID
      |                           SCALAR_FACTOR | SCALAR_ID | VECTOR | COORDINATE
      |                           | VALUE | STATUS | SYMBOL | TERMINATED | DECIMALS
      +-- <tableid>_MetaData.csv

Alberta selection is a literal ``GEO == "Alberta"``; DGUID is retained rather than
assumed stable.

Three hazards this parser handles explicitly:

* 32100359 publishes every statistic as parallel metric and imperial series.
  Ingesting both double-counts, so the imperial row is skipped *only* when a
  metric twin with a real value exists. Otherwise the imperial row is kept and
  converted, because silently losing a year is worse than an honest conversion.
* Blank VALUE carrying a STATUS/SYMBOL flag (".." not available, "x" confidential,
  "r" revised, "t" usable without qualification) is routine. That is a skip, never
  a zero.
* SCALAR_FACTOR != "units" means the printed value is, say, thousands. None of the
  price series here use a scalar, so an unexpected one quarantines the row instead
  of being multiplied through.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from typing import Any, Iterator

from .. import crops, units
from ..models import Observation, make_observation_id
from .base import ParseContext, raw_repr_of

REF_DATE_PATTERN = re.compile(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$")

# UOM spellings StatCan uses for the imperial side of the twin series.
IMPERIAL_UOMS = {"dollars per bushel", "dollars per hundredweight", "dollars per ton",
                 "dollars per pound"}
METRIC_UOMS = {"dollars per tonne", "dollars per metric tonne", "dollars per kilogram"}

# Skip codes that mean "there is no number here" rather than "the number is 0".
MISSING_VALUE_TOKENS = {"", "..", "...", "x"}
MISSING_SYMBOL_TOKENS = {"x", "...", ".."}


def read_zip_csv(raw_path: str) -> list[dict[str, str]]:
    """Read the data (not metadata) CSV out of a StatCan ZIP."""
    with zipfile.ZipFile(raw_path) as zf:
        name = next(n for n in zf.namelist()
                    if n.lower().endswith(".csv") and "_metadata" not in n.lower())
        with zf.open(name) as fh:
            return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline="")))


def reference_date(ref_date: str) -> tuple[str, str]:
    """(reference_date, granularity) from StatCan's REF_DATE."""
    m = REF_DATE_PATTERN.match((ref_date or "").strip())
    if not m:
        return (ref_date or "").strip(), "unknown"
    year, month, day = m.groups()
    if month and day:
        return f"{year}-{month}-{day}", "day"
    if month:
        return f"{year}-{month}", "month"
    return year, "year"


def member_of(row: dict[str, str], options: dict[str, Any]) -> tuple[str, str]:
    """(member, dimension_value) for a row given the source's column config."""
    member_col = options.get("member_column")
    dim_col = options.get("dimension_column")
    if member_col:
        return (row.get(member_col) or "").strip(), (row.get(dim_col) or "").strip()
    member = (row.get(dim_col) or "").strip()
    return member, member


def alberta_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    """Keep only the Alberta geography rows."""
    return [r for r in rows if (r.get("GEO") or "").strip() == "Alberta"]


def _metric_twin_keys(rows: list[dict[str, str]], options: dict[str, Any]) -> set[tuple[str, str]]:
    """(REF_DATE, member) pairs that have a metric row with a real value."""
    keys: set[tuple[str, str]] = set()
    for r in alberta_rows(rows):
        if (r.get("UOM") or "").strip().lower() not in METRIC_UOMS:
            continue
        if (r.get("VALUE") or "").strip() in MISSING_VALUE_TOKENS:
            continue
        member, _ = member_of(r, options)
        keys.add(((r.get("REF_DATE") or "").strip(), member))
    return keys


def _parse_value(row: dict[str, str]) -> float | None:
    raw = (row.get("VALUE") or "").strip()
    symbol = (row.get("SYMBOL") or "").strip()
    if raw in MISSING_VALUE_TOKENS or symbol in MISSING_SYMBOL_TOKENS:
        return None
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def iter_rows(ctx: ParseContext, options: dict[str, Any]) -> Iterator[Observation]:
    """Yield normalized observations for one StatCan table."""
    src = ctx.source
    dim_col = options.get("dimension_column")
    keep_contains = [k.lower() for k in (options.get("select_members_containing") or [])]
    prefer_metric = "metric" in (options.get("unit_preference") or [])

    rows = alberta_rows(read_zip_csv(src.raw_path))
    twins = _metric_twin_keys(rows, options) if prefer_metric else set()

    for r in rows:
        member, dim_value = member_of(r, options)
        if keep_contains and not any(k in dim_value.lower() for k in keep_contains):
            continue
        if not member:
            continue

        uom = (r.get("UOM") or "").strip()
        value = _parse_value(r)
        if value is None:
            continue

        # Skip the imperial twin only when the metric figure genuinely exists.
        if prefer_metric and uom.lower() in IMPERIAL_UOMS:
            if ((r.get("REF_DATE") or "").strip(), member) in twins:
                continue

        ref_date, granularity = reference_date(r.get("REF_DATE") or "")
        scalar = (r.get("SCALAR_FACTOR") or "units").strip()

        conv = units.to_cad_per_tonne(value, unit=uom, crop_key=member)
        if conv.ok and scalar not in ("units", ""):
            conv = units.Conversion(None, uom, "scalar-factor-unhandled", None,
                                    f"SCALAR_FACTOR={scalar!r}; refusing to scale blindly")

        yield Observation(
            observation_id=make_observation_id(src.source_id, member, ref_date, uom),
            crop_id=crops.crop_for(member),
            source_id=src.source_id,
            source_title=src.title,
            publisher=src.publisher,
            price_type=src.price_type,
            region="Alberta",
            reference_date=ref_date,
            date_granularity=granularity,
            original_value=value,
            original_unit=uom,
            currency="CAD",
            normalized_value=round(conv.cad_per_tonne, 4) if conv.ok else None,
            normalized_unit="CAD/tonne",
            conversion_basis=conv.basis,
            conversion_factor=conv.factor,
            conversion_detail=conv.detail,
            record_origin="observed",
            source_commodity=member,
            variant=crops.variant_for(member),
            grade=dim_value if dim_value and dim_value != member else None,
            status_symbol=((r.get("STATUS") or "").strip() or (r.get("SYMBOL") or "").strip()) or None,
            doc_file=src.raw_name,
            source_url=src.table_url or src.download_url,
            licence="Open Government Licence - Canada",
            retrieved_at=ctx.retrieved_at,
            raw_sha256=ctx.sha256,
            raw_repr=raw_repr_of(r),
        )
