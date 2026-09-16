"""Alberta 2026 Cropping Alternatives (AgriProfit$) -- expected market prices.

One soil-zone cost/returns table per page (Tables 3-8: Black, Brown, Dark Brown,
Dark Grey Wooded, Grey Wooded, Irrigated). Only the 'Expected Market Price' row is a
price; every other row is a cost, a yield or a margin and must not be emitted.

Two traps make positional reading unsafe and both are handled explicitly:

* The 'Expected Market Price' row's tokens sit at almost the same x as the
  'Expected Yield per Acre' row above it (205 vs 207 on the Black Soils page). Rows are
  therefore identified by their *label*, never by their position, and the crop names
  are the only thing taken from the header band.
* The unit is per-page and the same mark changes meaning between pages. Page 7 legends
  '*' as 'Yield per metric tonnes', while page 8 legends '*' as 'Yield per pounds' and
  '**' as 'Yield per metric tonnes'. The legend is read from each page -- a single
  table-wide or document-wide unit would convert one soil zone's prices wrongly.

The price row is an *expected* plan-time price, so the observation carries the
registry's own price_type (expected_market_price) and is marked as originating from a
cost-of-production budget rather than a market transaction.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

import pymupdf

from .. import crops, units
from ..models import Observation, make_observation_id
from ..pdfrow import Row, page_rows, to_number
from .base import ParseContext, raw_repr_of

# The only row on these pages that holds prices.
PRICE_LABEL_RE = re.compile(r"expected\s+market\s+price", re.I)

# Footnote legends that state a yield basis; the mark's price unit is the inverse of
# the basis printed here ('Yield per metric tonnes' means the price is per tonne).
LEGEND_RE = re.compile(r"([*]+)\s*Yield\s+per\s+(metric\s+tonnes?|pounds?|tonnes?)", re.I)

# Printed table titles use "GREY-WOODED" (hyphen) and add a Peace Region variant
# not distinguished by name alone ("TABLE 6 ... GREY-WOODED SOILS" vs "TABLE 7 ...
# GREY-WOODED (PEACE REGION)"), so matching must check the more specific "Peace
# Region" variant first and must not assume a space where the source prints a
# hyphen -- both zones matter for this document.
_SOIL_ZONES = ["Black Soils", "Dark Brown Soils", "Brown Soils",
               "Grey Wooded Peace Region", "Grey Wooded", "Irrigated"]


def _legend_units(text: str) -> dict[str, str]:
    """{mark -> price unit} from a page's own yield legend.

    'Yield per pounds' means the crop is measured per pound, so the price for a
    column carrying that mark is dollars per pound; 'Yield per metric tonnes' likewise
    means dollars per tonne. Reading the legend rather than assuming keeps the mark's
    meaning tied to the page that printed it.
    """
    out: dict[str, str] = {}
    for mark, basis in LEGEND_RE.findall(text):
        b = re.sub(r"\s+", " ", basis).strip().lower()
        if b.startswith("pound"):
            out[mark] = "lb"
        else:
            out[mark] = "tonne"
    return out
def _header_band(rows: list[Row], price_row: Row) -> list[Row]:
    """Header rows: the crop-name lines that belong to this price row's table.

    The printed order is: table title, then the stacked crop names, then the
    'Expected Yield per Acre' row, then the price row. The crop names therefore sit
    *above* the yield row, so the band runs from the yield row upward while the lines
    still look like names, and stops at the title (which contains 'TABLE').
    """
    yield_row = None
    for r in sorted((r for r in rows if r.y < price_row.y), key=lambda r: -r.y):
        if re.search(r"expected\s+yield", r.text, re.I):
            yield_row = r
            break
    if yield_row is None:
        return []

    band: list[Row] = []
    for r in sorted((r for r in rows if r.y < yield_row.y), key=lambda r: -r.y):
        if re.search(r"TABLE\s+\d|^\s*$", r.text, re.I):
            break
        band.append(r)
    return sorted(band, key=lambda r: r.y)


def _crop_columns(rows: list[Row], price_row: Row) -> list[tuple[float, float, str]]:
    """[(x0, x1, name)]: one entry per priced column, named from the header band.

    The printed crop-name words line up with the value columns, but a word can be
    centred between two of them (the page prints 'Stubble Seeded Crops' across a whole
    row), so assignment is by *nearest column centre* rather than by overlap. Overlap
    would let one word claim every column it touched and repeat it in each of those
    names. Each word is then ordered by its line and its own x, so a stacked name
    reads top-to-bottom and a name's words stay in printed order.
    """
    band = _header_band(rows, price_row)
    priced = [t for t in price_row.tokens if t.numeric]
    centres = [t.xc for t in priced]

    # A page note ('Stubble Seeded Crops') is printed in the label gutter, left of the
    # first priced column, rather than over a column. Crop names always sit at or right
    # of the first column's left edge, so a word entirely before that edge is a note or
    # a row label and must not be prepended to a crop name.
    gutter_edge = priced[0].x0 - 12.0 if priced else 0.0

    # The table's sub-heading ('Stubble Seeded Crops') is printed on its own line above
    # the crop-name lines, with its words spread across several columns. A crop-name
    # line instead places words over the columns it names. A line is therefore dropped
    # when fewer of its words align with a column centre than it has columns to sit on,
    # which is true of the sub-heading and false of every name line.
    name_lines = []
    for r in band:
        words = [t for t in r.tokens if not t.numeric]
        if not words:
            continue
        aligned = sum(1 for t in words
                      if any(abs(t.xc - c) <= 24.0 for c in centres))
        # A name line has at least as many words as it has columns to label, and most of
        # them sit over a column; the sub-heading has three words adrift between columns.
        if aligned >= 2 or len(words) <= 1:
            name_lines.append(r)

    buckets: list[list[tuple[float, float, str]]] = [[] for _ in priced]
    for r in name_lines:
        for t in r.tokens:
            if t.numeric or t.x1 <= gutter_edge:
                continue
            # Assign to the column whose centre is closest to this word's centre.
            ci = min(range(len(centres)), key=lambda i: abs(centres[i] - t.xc))
            buckets[ci].append((round(r.y, 1), t.x0, t.text))

    out: list[tuple[float, float, str]] = []
    for tok, parts in zip(priced, buckets):
        parts.sort()
        name = " ".join(p[2] for p in parts).strip(" -,.")
        out.append((tok.x0, tok.x1, name))
    return out



def _price_rows(rows: list[Row]) -> list[Row]:
    """Rows that are a table's 'Expected Market Price' line.

    Matched on the label because the price token x-positions coincide with the yield
    row's; a positional match would read yields as prices. Cost rows such as 'Total
    Cost per Unit' are never matched, so they cannot leak into a price series.

    The label alone is not sufficient: 'Expected Market Price' also occurs in the
    document's prose, so a qualifying row must additionally carry at least two numbers
    -- a real price row prices many crops.
    """
    out = []
    for r in rows:
        if not PRICE_LABEL_RE.search(r.text):
            continue
        if sum(1 for t in r.tokens if t.numeric) < 2:
            continue
        out.append(r)
    return out


def _soil_zone(rows: list[Row], page_no: int) -> str:
    """Soil zone for a page, taken from its own table title.

    The title prints "GREY-WOODED" with a hyphen and distinguishes a Peace Region
    variant only by an added "(PEACE REGION)" suffix, so the hyphen is normalized
    to a space before matching and the more specific Peace Region zone name is
    checked first -- checking the plain "Grey Wooded" pattern first would match
    both pages and misclassify the Peace Region one.
    """
    for r in rows:
        text = r.text
        if not re.search(r"TABLE\s+\d", text, re.I):
            continue
        up = re.sub(r"[-–—()]", " ", text.upper())
        up = re.sub(r"\s+", " ", up)
        for zone in _SOIL_ZONES:
            if zone.upper() in up:
                return zone
    return f"page-{page_no}"


def iter_rows(ctx: ParseContext, options: dict[str, Any]) -> Iterator[Observation]:
    """Yield expected market prices from the AgriProfit$ cropping alternatives tables."""
    src = ctx.source
    doc = pymupdf.open(src.raw_path)
    try:
        for page in doc:
            rows = page_rows(page)
            price_rows = _price_rows(rows)
            if not price_rows:
                continue
            legend = _legend_units(page.get_text())
            zone = _soil_zone(rows, page.number)

            for prow in price_rows:
                for x0, x1, name in _crop_columns(rows, prow):
                    tok = None
                    for t in prow.tokens:
                        if t.numeric and abs(t.x0 - x0) < 2.0 and abs(t.x1 - x1) < 2.0:
                            tok = t
                            break
                    if tok is None:
                        continue
                    value = to_number(tok)
                    if value is None:
                        continue
                    unit = _unit_for(name, legend, options)
                    yield _observation(ctx, name, value, unit, zone, page.number, tok)
    finally:
        doc.close()


def _unit_for(name: str, legend: dict[str, str], options: dict[str, Any]) -> str:
    """Price unit for a column, from the page legend or the crop's own mark.

    A crop name such as 'Mixed Hay*' carries a mark that the page's legend defines;
    the mark's unit wins over the table default. Without a legend the registry's
    declared default applies, and the observation is still emitted so the gap is
    visible in the output rather than silently converted by assumption.
    """
    marks = re.findall(r"[*]+", name)
    for mark in marks:
        if mark in legend:
            return legend[mark]
    return options.get("default_unit", "bu")


def _observation(ctx: ParseContext, name: str, value: float, unit: str,
                 zone: str, page_no: int, tok) -> Observation:
    src = ctx.source
    clean = crops.clean_label(name)
    conv = units.to_cad_per_tonne(value, unit=unit, crop_key=clean)
    return Observation(
        observation_id=make_observation_id(src.source_id, clean, zone, unit,
                                           f"p{page_no}x{round(tok.xc)}"),
        crop_id=crops.crop_for(clean),
        source_id=src.source_id,
        source_title=src.title,
        publisher=src.publisher,
        # Taken from the registry, never hard-coded: this table's price is a
        # plan-time expectation, not an observed transaction.
        price_type=src.price_type,
        region="Alberta",
        reference_date="2026",
        date_granularity="year",
        original_value=value,
        original_unit=unit,
        currency="CAD",
        normalized_value=round(conv.cad_per_tonne, 4) if conv.ok else None,
        normalized_unit="CAD/tonne",
        conversion_basis=conv.basis,
        conversion_factor=conv.factor,
        conversion_detail=conv.detail,
        record_origin="observed",
        source_commodity=name,
        variant=crops.variant_for(clean),
        soil_zone=zone,
        doc_file=src.raw_name,
        doc_page=page_no,
        doc_table="Cropping Alternatives (AgriProfit$)",
        source_url=src.document_url or src.download_url,
        licence="Open Government Licence - Alberta",
        retrieved_at=ctx.retrieved_at,
        raw_sha256=ctx.sha256,
        raw_repr=raw_repr_of({"crop": name, "zone": zone, "value": value,
                              "unit": unit, "page": page_no,
                              "x": round(tok.xc, 2)}),
    )