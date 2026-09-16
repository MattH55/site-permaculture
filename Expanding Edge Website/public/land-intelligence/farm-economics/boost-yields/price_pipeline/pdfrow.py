"""Coordinate-based table reconstruction for the AFSC / Cropping Alternatives PDFs.

These documents have no extractable table structure: cells are positioned glyphs
whose only relationship is spatial. Plain ``page.get_text()`` interleaves the crop
name of one row with the numbers of the next, which is exactly the corruption this
module exists to avoid.

Everything here works on ``page.get_text("words")`` tuples::

    (x0, y0, x1, y1, text, block_no, line_no, word_no)
"""

from __future__ import annotations

from dataclasses import dataclass, field
import re

import pymupdf


@dataclass
class Token:
    text: str
    x0: float
    x1: float
    y0: float
    y1: float

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def numeric(self) -> bool:
        return bool(NUM_RE.fullmatch(self.text))


# Footnote marks that AFSC / Cropping Alternatives attach directly to a number, e.g.
# "0.19*", "19.78**", "12.93\u2021". Verified against the source PDFs in _probe31: pymupdf
# decodes them as genuine U+002A/U+2020/U+2021, so no character repair is needed.
# '%' is deliberately absent - the retail and spring-adjust grids carry percent-change
# columns, and treating "6.8%" as a price would corrupt the row.
MARK_CHARS = "*\u2020\u2021"
NUM_RE = re.compile(r"^-?[\d,]+(?:\.\d+)?[" + MARK_CHARS + r"]*$")
TRAILING_MARK_RE = re.compile(r"([" + MARK_CHARS + r"]+)$")


def marks(token: Token | str) -> str:
    """Footnote marks attached to a token, e.g. '19.78**' -> '**'."""
    text = token.text if isinstance(token, Token) else str(token)
    m = TRAILING_MARK_RE.search(text)
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# Footnote bands: the publisher's own statement of what each mark means.
#
# The mark->unit relation is NOT stable across documents, and does not even mean
# the same thing twice inside one document family:
#   afsc_spring_adjust   "*"  = $ per pound
#   afsc_spring_noadjust "*"  = $ per ton,  "**" = $ per cwt, "\u2021" = $ per bu
#   cropping_alts        "*" / "**" annotate YIELD, never price.
# So every parser must read the page it is on and only then trust a mark.
# ---------------------------------------------------------------------------

UNIT_WORDS = (
    "pound|pounds|lb|lbs|tonne|tonnes|metric ton|ton|tons|cwt|hundredweight|"
    "bushel|bushels|bu|kg|kilogram|kilograms"
)
FOOTNOTE_RE = re.compile(
    r"^([*\u2020\u2021]{1,2})\s+(?:Price|price)\s+"
    r"(?:expressed|shown|given|listed|stated|based)?\s*"
    r"(?:in|of|per)?\s*\$?\s*(?:per|/)?\s*(" + UNIT_WORDS + r")\b"
)


def footnote_units(rows: list["Row"]) -> dict[str, str]:
    """Map footnote marks to units, reading only rows that define a *price* mark.

    Yield footnotes ("*Yield per pounds") are skipped on purpose: a yield unit says
    nothing about the unit of the price column, and silently borrowing it is exactly
    the class of error this pipeline exists to prevent.
    """
    out: dict[str, str] = {}
    for row in rows:
        text = row.text.strip()
        m = FOOTNOTE_RE.match(text)
        if m:
            out[m.group(1)] = normalize_footnote_unit(m.group(2))
    return out


def normalize_footnote_unit(raw: str) -> str:
    r = raw.strip().lower()
    return {"pounds": "lb", "pound": "lb", "lbs": "lb", "tons": "ton",
            "tonnes": "tonne", "bushels": "bu", "kilograms": "kg"}.get(r, r)


# Missing-value placeholders the sources actually print. U+2026 HORIZONTAL
# ELLIPSIS appears in the AFSC grids as a run of '…' characters; the plain-dot
# spelling is kept too because the two are not interchangeable once decoded.
MARK_NOT_FOUND = "---"
NON_VALUES = {"---", "NA", "N/A", "TBD", "", "-", "......"}
NON_VALUE_CHARS = {".", "-", "\u2026", "\u00b7", " "}


def to_number(token: Token | str) -> float | None:
    """Parse a numeric token, ignoring thousands separators and footnote marks."""
    text = token.text if isinstance(token, Token) else str(token)
    body = TRAILING_MARK_RE.sub("", text).replace(",", "").strip()
    if body in NON_VALUES or set(body) <= NON_VALUE_CHARS:
        return None
    try:
        return float(body)
    except ValueError:
        return None


@dataclass
class Row:
    y: float
    tokens: list[Token] = field(default_factory=list)

    @property
    def text(self) -> str:
        return " ".join(t.text for t in self.tokens)

    @property
    def label(self) -> str:
        """Non-numeric leading words - normally the crop name."""
        return " ".join(t.text for t in self.tokens if not t.numeric).strip()

    def label_left_of(self, x_limit: float) -> str:
        """Row label built only from tokens left of ``x_limit``.

        AFSC prints the percent-change columns as ``6%`` / ``-11%``. Those are not
        numeric to :class:`Token` (the trailing sign defeats the pattern) and would
        otherwise be glued onto the crop name. Restricting by x keeps the crop and
        its grade text and drops every value column.
        """
        parts = [t.text for t in self.tokens
                 if t.x0 < x_limit and not t.numeric and not t.text.endswith("%")]
        return re.sub(r"\s+", " ", " ".join(parts)).strip(" -")

    def number_at(self, x: float, tol: float = 6.0) -> Token | None:
        best, best_d = None, tol + 1.0
        for t in self.tokens:
            if not t.numeric:
                continue
            if t.x0 - tol <= x <= t.x1 + tol:
                d = abs(t.xc - x)
                if d < best_d:
                    best, best_d = t, d
        return best

    def near(self, x: float, tol: float = 8.0) -> Token | None:
        best, best_d = None, tol + 1.0
        for t in self.tokens:
            d = abs(t.xc - x)
            if d < best_d:
                best, best_d = t, d
        return best


def page_rows(page: pymupdf.Page, tolerance: float = 4.0) -> list[Row]:
    """Group a page's words into visual rows by y proximity.

    Greedy clustering with a tolerance beats fixed-bucket rounding: on the AFSC
    pages, a numeric cell and its wrapped crop label are 2.5pt apart while the next
    data row is 12.5pt away, so a tolerance of 4 collapses label+numbers into one
    logical row while still separating real rows. Fixed-bucket rounding splits that
    same 2.5pt pair whenever the boundary happens to land between them, and the
    crop name ends up attached to its neighbour's price.
    """
    toks = sorted(
        (Token(text=w[4], x0=w[0], y0=w[1], x1=w[2], y1=w[3]) for w in page.get_text("words")),
        key=lambda t: (t.y0, t.x0),
    )
    rows: list[Row] = []
    for tok in toks:
        if rows and abs(tok.y0 - rows[-1].y) <= tolerance:
            rows[-1].tokens.append(tok)
        else:
            rows.append(Row(y=tok.y0, tokens=[tok]))
    for r in rows:
        r.tokens.sort(key=lambda t: t.x0)
    return rows


def rows_in_band(rows: list[Row], lo: float, hi: float) -> list[Row]:
    return [r for r in rows if lo <= r.y <= hi]


def label_rows(rows: list[Row]) -> list[tuple[float, str]]:
    """Rows that carry words but no numbers - header / crop-name lines."""
    return [(r.y, r.label) for r in rows if r.label and not any(t.numeric for t in r.tokens)]


def numeric_rows(rows: list[Row]) -> list[Row]:
    """Rows that carry at least one numeric token."""
    return [r for r in rows if any(t.numeric for t in r.tokens)]


def build_column_anchors(rows: list[Row], min_count: int = 2, cluster: float = 8.0) -> list[float]:
    """Derive column centre positions by clustering numeric token centres.

    Centres, not left edges: AFSC left-aligns the grid in its "eligible for fall
    adjustment" document but centre-aligns the "not eligible" one, so clustering
    x0 would fragment the second into phantom columns. Clustering centres absorbs
    both alignments plus the width added by footnote marks like ``0.19*``.
    """
    xs = sorted(t.xc for r in rows for t in r.tokens if t.numeric)
    if not xs:
        return []
    clusters: list[list[float]] = [[xs[0]]]
    for x in xs[1:]:
        if x - clusters[-1][-1] <= cluster:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    return [sum(c) / len(c) for c in clusters if len(c) >= min_count]


@dataclass
class Column:
    """A named value column occupying an x span, derived from a header row."""

    name: str
    x0: float
    x1: float

    @property
    def xc(self) -> float:
        return (self.x0 + self.x1) / 2.0

    def contains(self, x: float) -> bool:
        return self.x0 <= x <= self.x1


def columns_from_header(row: Row, names: dict[str, str], pad: float = 4.0) -> list[Column]:
    """Turn a header row's unit words into x spans.

    ``names`` maps the header token text as printed to a column name. Adjacent
    columns are separated at the midpoint between their header tokens, which gives
    a number that overflows its own cell a clean owner.
    """
    hits: list[tuple[str, Token]] = []
    for t in row.tokens:
        if t.text in names:
            hits.append((names[t.text], t))
    hits.sort(key=lambda h: h[1].x0)
    cols: list[Column] = []
    for i, (name, tok) in enumerate(hits):
        left = tok.x0 - pad if i == 0 else (hits[i - 1][1].x1 + tok.x0) / 2.0
        right = tok.x1 + pad if i == len(hits) - 1 else (tok.x1 + hits[i + 1][1].x0) / 2.0
        cols.append(Column(name=name, x0=left, x1=right))
    return cols


def token_for_column(row: Row, col: Column) -> Token | None:
    """The numeric token in ``row`` whose centre falls inside ``col``."""
    candidates = [t for t in row.tokens if t.numeric and col.contains(t.xc)]
    if not candidates:
        return None
    return min(candidates, key=lambda t: abs(t.xc - col.xc))

