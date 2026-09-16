"""AFSC Spring Insurance Price grids (both eligible / not-eligible lists).

Two registry sources (``afsc_spring_adjusted``, ``afsc_spring_not_adjusted``)
share this one parser, but explicitly NOT a shared x-grid — the registry's
``layout_note`` for each source warns the column positions differ, so every
column mapping here is derived per-page from that page's own header row via
``pdfrow.columns_from_header``. Never hard-code a coordinate.

Layout, confirmed against ``out45.txt``:

* "Eligible for Fall Insurance Price Adjustments" (the *adjusted* list): each
  data row carries Commercial $/kg, Commercial $/bu, Pedigreed $/kg,
  Pedigreed $/bu, then two percent-change columns (not prices). A trailing
  ``*`` on a $/bu value means the printed figure is actually $/pound — read
  via ``pdfrow.marks()`` against that page's own footnote
  (``pdfrow.footnote_units()``), never assumed.
* "Not Eligible" (the *not-adjusted* list): Commercial $/kg, Commercial
  $/lbs, Pedigreed $/kg, Pedigreed $/lbs. Marks here mean different units
  again (``*`` = $/ton, ``**`` = $/cwt, ``‡`` = $/bu) per that document's own
  footnote block — again read, never assumed.

Both documents print the crop label and its numeric row on the same
reconstructed line (unlike the AgriStability / Cropping Alternatives grids),
so ``pdfrow.page_rows`` already yields one row per crop and no separate
label/value pairing step is needed here.

A row that is pure header/footnote/section text yields no numeric token in
any price column, so it is skipped naturally rather than needing a prefix
denylist — the same reason "---" cells never produce a zero: they are simply
not ``Token.numeric``.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

import pymupdf

from .. import crops, units
from ..models import Observation, make_observation_id
from .base import ParseContext, raw_repr_of
from .. import pdfrow

DATE_RE = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|"
    r"November|December)\s+(\d{1,2}),?\s+(\d{4})"
)
MONTHS = {
    "January": "01", "February": "02", "March": "03", "April": "04",
    "May": "05", "June": "06", "July": "07", "August": "08",
    "September": "09", "October": "10", "November": "11", "December": "12",
}


def _page_date(rows: list[pdfrow.Row]) -> tuple[str, str]:
    """(reference_date, granularity) from a footer date like 'February 12, 2026'."""
    text = " ".join(r.text for r in rows)
    m = DATE_RE.search(text)
    if not m:
        return "", ""
    month, day, year = m.groups()
    return f"{year}-{MONTHS[month]}-{int(day):02d}", "day"


def _resolve_unit(token: pdfrow.Token, header_unit: str, footnotes: dict[str, str]) -> str:
    """The unit a specific cell actually means, given the page's own footnote map.

    A trailing mark on the cell overrides the header's default unit for that one
    cell only; an unmarked cell uses the header's declared unit.
    """
    mark = pdfrow.marks(token)
    if mark and mark in footnotes:
        return footnotes[mark]
    return header_unit


def _emit(
    ctx: ParseContext,
    row: pdfrow.Row,
    label: str,
    grade: str,
    token: pdfrow.Token | None,
    header_unit: str,
    footnotes: dict[str, str],
    page_no: int,
    ref_date: str,
    granularity: str,
) -> Observation | None:
    if token is None:
        return None
    value = pdfrow.to_number(token)
    if value is None:
        return None
    src = ctx.source
    unit = _resolve_unit(token, header_unit, footnotes)
    conv = units.to_cad_per_tonne(value, unit=unit, crop_key=label,
                                   allow_afsc_test_weight=True)
    return Observation(
        observation_id=make_observation_id(src.source_id, label, grade, unit, ref_date),
        crop_id=crops.crop_for(label),
        source_id=src.source_id,
        source_title=src.title,
        publisher=src.publisher,
        price_type=src.price_type,
        region="Alberta",
        reference_date=ref_date or "2026",
        date_granularity=granularity or "year",
        original_value=value,
        original_unit=unit,
        currency="CAD",
        normalized_value=round(conv.cad_per_tonne, 4) if conv.ok else None,
        normalized_unit="CAD/tonne",
        conversion_basis=conv.basis,
        conversion_factor=conv.factor,
        conversion_detail=conv.detail,
        record_origin="observed",
        source_commodity=label,
        variant=crops.variant_for(label),
        grade=grade,
        doc_file=src.raw_name,
        doc_page=page_no,
        source_url=src.document_url or src.download_url,
        licence="AFSC program document",
        retrieved_at=ctx.retrieved_at,
        raw_sha256=ctx.sha256,
        raw_repr=raw_repr_of({"row": row.text, "cell": token.text}),
    )


def _iter_page(ctx: ParseContext, page: pymupdf.Page, page_no: int) -> Iterator[Observation]:
    rows = pdfrow.page_rows(page)
    footnotes = pdfrow.footnote_units(rows)
    ref_date, granularity = _page_date(rows)

    header = next((r for r in rows if any(t.text in ("$/kg", "$/bu", "$/lbs") for t in r.tokens)), None)
    if header is None:
        return

    cols = pdfrow.columns_from_header(header, {"$/kg": "kg", "$/bu": "bu", "$/lbs": "lb"})
    if len(cols) < 2:
        return
    # Left-to-right visual order is always Commercial then Pedigreed, in pairs.
    pairs = [cols[i:i + 2] for i in range(0, len(cols) - 1, 2)]
    grade_names = ["Commercial", "Pedigreed"]

    x_limit = cols[0].x0
    for row in rows:
        if row.y <= header.y:
            continue
        label = row.label_left_of(x_limit)
        if not label:
            continue
        any_value = False
        for pair, grade in zip(pairs, grade_names):
            for col in pair:
                tok = pdfrow.token_for_column(row, col)
                obs = _emit(ctx, row, label, grade, tok, col.name, footnotes,
                            page_no, ref_date, granularity)
                if obs is not None:
                    any_value = True
                    yield obs
        if not any_value:
            continue


def iter_rows(ctx: ParseContext, options: dict[str, Any]) -> Iterator[Observation]:
    with pymupdf.open(ctx.raw_path) as doc:
        for page in doc:
            yield from _iter_page(ctx, page, page.number)
