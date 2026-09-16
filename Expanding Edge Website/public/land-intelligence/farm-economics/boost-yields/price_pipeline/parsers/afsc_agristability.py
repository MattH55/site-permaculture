"""AFSC 2026 AgriStability Commodity Price List -- "Other Crops" grid.

One page carrying several price blocks, each with its own unit printed *inside* the
grid on a unit row:

    y≈173   $/tonne  bushel  tonne  bushel  tonne  bushel  tonne  bushel
            (Flax, Feed Peas, Edible Peas Yellow, Edible Peas Green)
    y≈398   $/lb     (Chickpeas 7mm/8mm/9mm, Lentils, Mustard, Canary Seed)

Units therefore alternate positionally and change mid-page, so the unit is read
from the unit row governing the block a value belongs to -- never assumed once for
the document. 'bushel' means the published test weight, read through
``units.bushel_mass_kg``, which returns None for crops with no declared mass; those
rows quarantine rather than convert by guess.

Crop names are stacked over up to three lines above their unit row and share no
single y, so a name is assembled by *column x* across the header band: every word
whose centre falls in the column's x-span belongs to that column. Reading labels
row-by-row pairs 'Flax' with 'Feed' and loses 'Peas' entirely.

Month names sit in a left column; only January-June carry values in this edition,
so the remaining months print no numbers and produce nothing.

KNOWN LIMITATION -- block-2 parent commodity names
--------------------------------------------------
The ``$/lb`` block prints each grade word ('7mm', 'Desi', 'Small', 'Yellow',
'Oriental') in its own column, but the parent commodity ('Chickpeas', 'Lentils',
'Mustard') is centred *between* its grade columns on a line that also carries that
row's own words. There is no reliable x-position that ties a parent to its children,
so parents are recovered only where the layout makes the association unambiguous.

Consequently a few ``source_commodity`` labels omit their parent:

    'Desi'      should read 'Chickpeas Desi'
    'Small'     should read 'Lentils Small Yellow'
    'Yellow'    should read 'Lentils Small Yellow'
    'Oriental'  should read 'Mustard Oriental'

The *values* and *units* for these rows are correct; only the label is incomplete,
so the rows still join to the right ``crop_id`` where one exists. Six candidate
strategies (fixed radius, extent overlap, line-level clustering, nearest-centre,
midpoint partitioning, width heuristics) were each tried and each repaired some
columns while breaking others, so this is left explicit rather than guessed at.
Fix by reading the block's parent names from the source PDF's text layer directly
if that layer ever becomes reliable, or by maintaining an explicit alias map here.
"""

from __future__ import annotations

import re
from typing import Any, Iterator

import pymupdf

from .. import crops, units
from ..models import Observation, make_observation_id
from ..pdfrow import Row, page_rows, to_number
from .base import ParseContext, raw_repr_of

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
# The forage page abbreviates its month columns ('Jan', 'Feb', 'June', 'July'), so
# both spellings must resolve or that page reads as having no month header at all.
MONTH_ALIASES = {}
for _i, _name in enumerate(MONTHS, start=1):
    MONTH_ALIASES[_name.lower()] = _i
    MONTH_ALIASES[_name[:3].lower()] = _i
MONTH_ALIASES["sept"] = 9


def _month_index(text: str) -> int | None:
    """Month number for a full or abbreviated month label, else None."""
    return MONTH_ALIASES.get(text.strip(",:.").lower())

# Unit words that may appear on a unit row. 'bushel' is spelled out here because
# this document uses the bare word rather than '$/bushel'.
_UNIT_WORDS = {"tonne": "tonne", "bushel": "bu", "lb": "lb", "lbs": "lb",
               "kg": "kg", "cwt": "cwt", "ton": "ton"}


def _is_month(text: str) -> bool:
    return _month_index(text) is not None


def _unit_of(text: str) -> str | None:
    """Unit for a token like '$/tonne', 'bushel' or '$/lb'."""
    body = text.strip().lower().lstrip("$").lstrip("/").strip().rstrip(".")
    return _UNIT_WORDS.get(body)


def _is_unit_text(text: str) -> bool:
    """True for any token carrying a currency/unit mark, including a bare '$/'."""
    t = text.strip().lower()
    if _unit_of(t):
        return True
    return t in {"$", "$/", "/", "$/"}


def _unit_rows(rows: list[Row]) -> list[Row]:
    """Rows that declare units for a block of columns.

    Two shapes occur in this document and both must be found:

    * several unit words across the row, one per column ('$/ tonne bushel tonne
      bushel ...'), which repeats the unit for each commodity; and
    * a single unit word at the left margin ('$/lb') that governs every column to
      its right, with the commodity grades printed beside it.

    Requiring two or more unit words would miss the second shape entirely and silently
    drop that whole block, so a lone unit word also qualifies as long as it is not
    itself a data row.
    """
    out = []
    for r in rows:
        hits = [t for t in r.tokens if _unit_of(t.text)]
        if not hits or any(_is_month(t.text) for t in r.tokens):
            continue
        if len(hits) >= 2 or not any(t.numeric for t in r.tokens):
            out.append(r)
    return out


def _data_rows(rows: list[Row]) -> list[Row]:
    """Rows whose first token is a month name and that carry numbers."""
    return [r for r in rows
            if r.tokens and _is_month(r.tokens[0].text)
            and any(t.numeric for t in r.tokens)]


def _block_columns(urow: Row, data_rows: list[Row], y_bottom: float) -> list[tuple[float, str]]:
    """[(x_centre, unit)] for one block's value columns.

    When the unit row repeats a unit per column, those positions are authoritative.
    When it declares a single unit at the left (the '$/lb' block), the columns are
    instead the distinct numeric x-positions used by the block's own data rows, and
    the one declared unit applies to all of them. Deriving the grid this way keeps
    every column tied to text that is actually printed for this block.
    """
    hits = [(t.xc, _unit_of(t.text)) for t in urow.tokens if _unit_of(t.text)]
    if len(hits) >= 2:
        return hits

    unit = hits[0][1]
    # Collect the numeric column centres from the data rows that this block owns.
    # A centre must be supported by more than one row: a footer date ('July 7, 2026')
    # contributes stray numbers at its own x, and requiring repeat use keeps those
    # from becoming phantom price columns.
    counts: dict[float, int] = {}
    for r in data_rows:
        if not (urow.y < r.y < y_bottom):
            continue
        seen: list[float] = []
        for t in r.tokens:
            if not t.numeric or _is_month(t.text):
                continue
            if all(abs(t.xc - c) > 3.0 for c in seen):
                seen.append(t.xc)
        for c in seen:
            counts[c] = counts.get(c, 0) + 1

    centres = sorted(c for c, n in counts.items() if n >= 2)
    return [(c, unit) for c in centres]


def _column_spans(cols: list[tuple[float, str]]) -> list[tuple[float, float, float, str]]:
    """[(x_lo, x_hi, x_centre, unit)]: one exclusive span per value column.

    Column boundaries are the midpoints between neighbouring numeric columns. A fixed
    radius around the centre fails here because a stacked name's words sit at
    different x from the value below them, so words would be split across columns or
    dropped. Midpoint spans assign each heading word to exactly one column and
    preserve the printed order.
    """
    xs = sorted({x for x, _ in cols})
    spans = []
    for i, x in enumerate(xs):
        lo = (xs[i - 1] + x) / 2 if i > 0 else x - 40.0
        hi = (xs[i + 1] + x) / 2 if i + 1 < len(xs) else x + 40.0
        unit = next(u for xx, u in cols if xx == x)
        spans.append((lo, hi, x, unit))
    return spans


def _groups_of_two(spans: list[tuple[float, float, float, str]]):
    """Pair consecutive columns, because this document names a crop once over its
    tonne-and-bushel pair.

    'Flax' is printed once, centred between its $/tonne and $/bushel columns, and so
    is 'Feed Peas'; a per-column label would therefore produce '' for the first and
    '' for the second. Pairing (tonne, bushel) and labelling the pair reproduces the
    document's own model of a commodity.
    """
    return [spans[i:i + 2] for i in range(0, len(spans) - 1, 2)]


def _label_for_group(rows: list[Row], group, y_top: float, y_bottom: float) -> str:
    """Crop name printed over a group of columns.

    The x-window is the group's full horizontal extent, so a name centred over the
    pair (rather than over either column) is captured intact.
    """
    lo = min(g[0] for g in group) + 2.0
    hi = max(g[1] for g in group) - 0.5
    parts: list[tuple[float, float, str]] = []
    for r in rows:
        if not (y_top <= r.y < y_bottom):
            continue
        for t in r.tokens:
            if t.numeric or _unit_of(t.text) or _is_month(t.text):
                continue
            if lo <= t.xc <= hi:
                parts.append((round(r.y, 1), t.x0, t.text))
    parts.sort()
    return " ".join(p[2] for p in parts).strip(" -,.")


def _label_for_span(rows: list[Row], lo: float, hi: float, y_top: float,
                    y_bottom: float) -> str:
    """Crop name for a single column, stacked top-to-bottom within its span.

    Words are ordered top-to-bottom then left-to-right, so a heading printed on
    successive lines such as 'Large' over 'Green' reads as 'Large Green' exactly as
    the page presents it, without assuming which line a name word will appear on.
    """
    parts: list[tuple[float, float, str]] = []
    for r in rows:
        if not (y_top <= r.y < y_bottom):
            continue
        for t in r.tokens:
            if t.numeric or _unit_of(t.text) or _is_month(t.text):
                continue
            if lo <= t.xc <= hi:
                parts.append((round(r.y, 1), t.x0, t.text))
    parts.sort()
    return " ".join(p[2] for p in parts).strip(" -,.")


def _parent_names(rows: list[Row], spans, y_top: float, y_bottom: float) -> dict[int, str]:
    """{column index -> parent commodity} for headings printed over several columns.

    In the '$/lb' block the page prints one commodity name per group of grade columns
    ('Chickpeas' over Kabuli/Desi, 'Lentils' over Large Green/Small Green, 'Mustard'
    over Brown/Oriental). A parent word is centred *between* the columns it owns, so
    its own extent does not reach them and a fixed radius cannot find them.

    A parent is recognised structurally: it is the only word on its line, printed
    above the grade words, and it is not assignable to any single existing column
    span. Grade words, by contrast, always sit at (or within) the centre of the column
    they name. Parent words are read left to right and each owns the columns between
    the midpoint to its previous and next sibling, which is the partition the printed
    layout describes and cannot double-claim a column.
    """
    if not spans:
        return {}
    centres = [s[2] for s in spans]

    # Parent names share a single line above the grade words, so candidates are taken
    # one line at a time: the line whose words none of the column centres fall under.
    # Treating words individually would let one parent claim every column to its right
    # whenever its siblings happen not to be recognised.
    parent_line: list[tuple[float, str]] = []
    for r in rows:
        if not (y_top <= r.y < y_bottom):
            continue
        words = [t for t in r.tokens
                 if not t.numeric and not _is_unit_text(t.text) and not _is_month(t.text)]
        if not words:
            continue
        mids = [((t.x0 + t.x1) / 2.0, t.text) for t in words]
        # A line is the parent line when its words sit between the columns rather than
        # over them; grade lines have one word directly over each column centre.
        straddling = [m for m in mids
                      if not any(abs(m[0] - c) <= 16.0 for c in centres)]
        if straddling and len(straddling) == len(mids):
            parent_line = sorted(straddling)
            break

    if not parent_line:
        return {}
    boundaries = [(parent_line[i][0] + parent_line[i + 1][0]) / 2.0
                  for i in range(len(parent_line) - 1)]

    owners: dict[int, str] = {}
    for i, (mid, text) in enumerate(parent_line):
        lo = boundaries[i - 1] if i > 0 else float("-inf")
        hi = boundaries[i] if i < len(boundaries) else float("inf")
        for ci, xc in enumerate(centres):
            if lo <= xc < hi:
                owners.setdefault(ci, text)
    return owners


def _header_band(rows: list[Row], urow: Row, prev: Row | None,
                 heading: str = "") -> tuple[float, float]:
    """(y_top, y_bottom) of the name lines belonging to ``urow``.

    The band must start *below* the page's title and note text, otherwise title words
    are absorbed into the first crop's name ('Other Crops Edible Yellow Peas'). The
    upper bound is the previous unit row when there is one. For the first block the
    walk starts below the last prose line, identified by punctuation or length rather
    than by word count -- 'Other Crops' is only two words but is still a title.
    """
    if prev is not None:
        return prev.y, urow.y
    # Every word of a name line belongs to some group; the page title ('Other Crops')
    # is centred on the page and can straddle group boundaries, so geometry alone
    # cannot separate it. The heading is therefore taken from the source's own title,
    # which the registry already records, and rows matching it are excluded outright
    # instead of being guessed at from position.
    xs = [t.xc for t in urow.tokens if _unit_of(t.text)]
    if not xs:
        return urow.y - 40.0, urow.y
    groups = _groups_of_two(_column_spans(
        [(t.xc, _unit_of(t.text)) for t in urow.tokens if _unit_of(t.text)]))
    group_extents = [(min(g[0] for g in grp) + 4.0, max(g[1] for g in grp) - 4.0)
                     for grp in groups]

    def assigned(tokens) -> bool:
        return all(any(glo <= t.xc <= ghi for glo, ghi in group_extents)
                   for t in tokens)

    top = urow.y
    for r in reversed([r for r in rows if r.y < urow.y]):
        words = [t for t in r.tokens if not t.numeric and not _is_unit_text(t.text)]
        if not words:
            continue
        if _is_prose(r) or _is_heading(r, heading) or not assigned(words):
            break
        top = r.y
    return top - 4.0, urow.y


def _is_heading(row: Row, heading: str) -> bool:
    """True when the row is the page's grid heading rather than a commodity name."""
    if not heading:
        return False
    return row.text.strip().lower() == heading.strip().lower()


def _title_suffix(title: str) -> str:
    """The grid heading implied by a registry title, e.g. '... - Other Crops'.

    The registry names each document as '<program> - <page heading>', which is the
    same text printed above the grid, so it identifies the heading without the parser
    having to know any particular document's wording.
    """
    return title.rsplit(" - ", 1)[-1].strip() if " - " in title else ""


_PROSE_RE = re.compile(r"[:.;]|\d|\(\d|^Note$|^For more", re.I)


def _is_prose(row: Row) -> bool:
    """True for title/note lines that must never contribute to a crop name."""
    text = row.text
    return bool(_PROSE_RE.search(text))


def iter_rows(ctx: ParseContext, options: dict[str, Any]) -> Iterator[Observation]:
    """Yield AgriStability reference prices for other crops, by month."""
    src = ctx.source
    doc = pymupdf.open(src.raw_path)
    try:
        for page in doc:
            rows = page_rows(page)
            unit_rows = _unit_rows(rows)
            if not unit_rows:
                continue

            for idx, urow in enumerate(unit_rows):
                # This block runs from its own unit row down to the next block's, and
                # its header band runs from the previous unit row down to itself.
                y_bottom = unit_rows[idx + 1].y if idx + 1 < len(unit_rows) else 1e9
                prev = unit_rows[idx - 1] if idx > 0 else None
                heading = options.get("heading") or _title_suffix(src.title)
                header_top, header_bottom = _header_band(rows, urow, prev, heading)

                data_rows = _data_rows(rows)
                cols = _block_columns(urow, data_rows, y_bottom)
                if not cols:
                    continue
                spans = _column_spans(cols)
                # A block whose unit row repeats one unit per column names a crop once
                # over each tonne/bushel pair; a block with a single declared unit has
                # one named column per commodity. Choosing the grouping from the unit
                # row's own shape keeps a per-column name from being merged with its
                # neighbour in the second case.
                repeat_per_column = len(
                    [t for t in urow.tokens if _unit_of(t.text)]) >= 2

                if repeat_per_column:
                    groups = _groups_of_two(spans)
                    parents = {}
                else:
                    # One named column per commodity: the grade word stacks in the
                    # column and any parent commodity name is attached from above.
                    groups = [[s] for s in spans]
                    parents = _parent_names(rows, spans, header_top, header_bottom)

                for row in data_rows:
                    if not (urow.y < row.y < y_bottom):
                        continue
                    month = row.tokens[0].text.strip(",:.")
                    for gi, group in enumerate(groups):
                        if repeat_per_column:
                            label = _label_for_group(rows, group, header_top,
                                                     header_bottom)
                        else:
                            s = group[0]
                            label = _label_for_span(rows, s[0], s[1], header_top,
                                                    header_bottom)
                            parent = parents.get(gi, "")
                            if parent and parent.lower() not in label.lower():
                                label = f"{parent} {label}".strip()
                        if not label:
                            continue
                        # One crop name per group: emit each column under it.
                        for lo, hi, x, unit in group:
                            tok = row.number_at(x, tol=9.0)
                            if tok is None:
                                continue
                            value = to_number(tok)
                            if value is None:
                                continue
                            yield _observation(ctx, label, value, unit, month,
                                               page.number, tok)
    finally:
        doc.close()


def _observation(ctx: ParseContext, label: str, value: float, unit: str,
                 month: str, page_no: int, tok) -> Observation:
    src = ctx.source
    clean = crops.clean_label(label)
    # AFSC declares no test weight for most of these specialty crops, so a bushel
    # figure with no published mass quarantines instead of converting.
    conv = units.to_cad_per_tonne(value, unit=unit, crop_key=clean,
                                  allow_afsc_test_weight=True)
    # The model carries no separate month field: a monthly figure is dated as
    # YYYY-MM and flagged with date_granularity so it cannot be mistaken for an
    # annual average.
    num = _month_index(month)
    ref_date = f"2026-{num:02d}" if num else "2026"
    return Observation(
        observation_id=make_observation_id(src.source_id, clean, month, unit,
                                           f"p{page_no}x{round(tok.xc)}"),
        crop_id=crops.crop_for(clean),
        source_id=src.source_id,
        source_title=src.title,
        publisher=src.publisher,
        price_type=src.price_type,
        region="Alberta",
        reference_date=ref_date,
        date_granularity="month" if num else "year",
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
        variant=crops.variant_for(clean),
        doc_file=src.raw_name,
        doc_page=page_no,
        source_url=src.document_url or src.download_url,
        licence="AFSC program document",
        retrieved_at=ctx.retrieved_at,
        raw_sha256=ctx.sha256,
        raw_repr=raw_repr_of({"label": label, "month": month, "value": value,
                              "unit": unit, "page": page_no}),
    )



def iter_rows_forage(ctx: ParseContext, options: dict[str, Any]) -> Iterator[Observation]:
    """Yield forage-seed prices from the transposed AgriStability forage grid.

    This page is the transpose of the "other crops" grid: months run across the top
    and crops run down the left, so one page holds twelve prices per crop row rather
    than one price per month row. The unit is declared once ('$/lb' at x≈132) and
    applies to every value on the page, but the crop label is *left* of that unit
    column and may span several tokens ('Smooth Brome', 'Sweet Clover'), so the
    label is taken as everything left of the unit column rather than a fixed width.
    """
    src = ctx.source
    doc = pymupdf.open(src.raw_path)
    try:
        for page in doc:
            rows = page_rows(page)
            header = _forage_header(rows)
            if header is None:
                continue
            unit_col, months, label_limit, header_y = header

            for row in rows:
                if row.y <= header_y:
                    continue
                # A data row here is: label word(s), then numbers under the month
                # columns. Rows with no number are titles or footers.
                nums = [t for t in row.tokens if t.numeric]
                if not nums:
                    continue
                label = _forage_label(row, label_limit)
                if not label:
                    continue
                for x, month in months:
                    tok = row.number_at(x, tol=9.0)
                    if tok is None:
                        continue
                    value = to_number(tok)
                    if value is None:
                        continue
                    yield _observation(ctx, label, value, unit_col, month,
                                       page.number, tok)
    finally:
        doc.close()


def _forage_header(rows: list[Row]):
    """(unit, [(x, month)], header_y, label_x_limit) for the forage page.

    Returns None when no month header row is present, so a page without this layout
    is skipped rather than mined for coincidences.
    """
    for row in rows:
        months = [(t.xc, t.text.strip(",:.")) for t in row.tokens
                  if _is_month(t.text)]
        if len(months) < 6:
            continue
        # The unit is declared on this same row, left of the first month.
        first_x = min(x for x, _ in months)
        unit = None
        unit_x = first_x
        for t in row.tokens:
            u = _unit_of(t.text)
            if u and t.xc < first_x:
                unit, unit_x = u, t.xc
        if unit is None:
            continue
        return unit, months, unit_x, row.y
    return None

def _forage_label(row: Row, label_x_limit: float) -> str:
    """Crop (and grade) text left of the unit column, e.g. 'Smooth Brome Certified'."""
    parts = [t.text for t in row.tokens
             if t.x0 < label_x_limit - 6.0 and not t.numeric]
    return " ".join(parts).strip(" -,.")