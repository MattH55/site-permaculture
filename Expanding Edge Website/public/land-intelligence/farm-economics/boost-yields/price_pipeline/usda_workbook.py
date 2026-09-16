"""Seed-workbook reader for the U.S. specialty-crop price master list.

Section 1 of the instruction document names ``usda_specialty_crop_price_master.xlsx`` as
the initial seed list and requires that the workbook's own data be *preserved rather than
replaced*. So this module copies every cell it reads into the emitted records rather than
re-deriving values, and it keeps the workbook's four sheets separate because they record
four different kinds of claim:

* ``Method`` — the tier definitions. Read as the human-readable prose behind the registry.
* ``Target Batch`` — the crop list with its per-crop infrastructure finding. This is the
  sheet that carries claims like "Yes — AMS", which are *findings*, not verified
  observations. They are preserved verbatim in ``notes`` and never promoted to a price.
* ``NASS Reference`` — code identity only.
* ``Sources`` — the citation list.

Reading the workbook with ``openpyxl`` in ``data_only`` mode means a formula cell yields
its cached value, which is what the published sheet displays.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import openpyxl

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
DEFAULT_WORKBOOK = os.path.join(PROJECT_ROOT, "usda_specialty_crop_price_master.xlsx")

SHEET_TARGET_BATCH = "Target Batch"
SHEET_NASS_REFERENCE = "NASS Reference"
SHEET_SOURCES = "Sources"
SHEET_METHOD = "Method"

# Tiers the workbook may declare. "D/E" is a real value in the seed sheet: it means the
# author could not decide between a trade proxy and no source, so a single tier cannot be
# asserted without a retrieval. It is normalized to the *stronger* of the two (D) while
# keeping the original text, because collapsing it to E would hide that a proxy was
# considered, and collapsing it to D alone would hide that no proxy was retrieved.
TIER_AMBIGUOUS = "D/E"


class WorkbookError(RuntimeError):
    """Raised when the seed workbook's structure is not what the pipeline expects."""


@dataclass(frozen=True)
class WorkbookCrop:
    """One row of ``Target Batch``, preserved as published."""

    crop: str
    preferred_price_form: str
    tier: str
    tier_original: str
    nass_commodity_ref: str | None
    dedicated_unit_price: str
    infrastructure_finding: str
    source_url: str | None
    notes: str
    row_number: int

    @property
    def tier_is_ambiguous(self) -> bool:
        return self.tier_original.strip().upper() == TIER_AMBIGUOUS


@dataclass(frozen=True)
class NASSReference:
    commodity: str
    code: str
    description: str
    source_note: str


@dataclass(frozen=True)
class SourceCitation:
    source: str
    establishes: str
    url: str


@dataclass
class SeedWorkbook:
    path: str
    sha256: str
    crops: list[WorkbookCrop] = field(default_factory=list)
    nass_references: list[NASSReference] = field(default_factory=list)
    sources: list[SourceCitation] = field(default_factory=list)
    method_lines: list[tuple[str, str]] = field(default_factory=list)


def _cell(row: tuple[Any, ...], idx: int) -> str:
    if idx >= len(row) or row[idx] is None:
        return ""
    return str(row[idx]).strip()


def _normalize_tier(raw: str) -> str:
    """``"D/E"`` -> ``"D"``; anything else passes through upper-cased."""
    t = (raw or "").strip().upper()
    if t == TIER_AMBIGUOUS:
        return "D"
    return t


def _split_code(field_text: str) -> str | None:
    """Split ``"35599999 — Mushrooms All"`` into the code, or return None.

    The workbook prints an em dash that survives xlsx decoding, so the split accepts both
    the em dash and a plain hyphen. A cell with no code prefix yields ``None`` rather than
    the whole string, because a description is not an identifier.
    """
    text = (field_text or "").strip()
    if not text:
        return None
    for sep in ("\u2014", "-", ":"):
        head = text.split(sep, 1)[0].strip()
        if head.isdigit():
            return head
    return None


def _sha256(path: str) -> str:
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_workbook(path: str | None = None) -> SeedWorkbook:
    """Read all four sheets of the seed workbook.

    Every sheet is required. A missing sheet means the workbook is not the artifact this
    pipeline was written against, and silently proceeding would emit a partial crop list
    that looks complete.
    """
    path = path or DEFAULT_WORKBOOK
    if not os.path.exists(path):
        raise FileNotFoundError(f"seed workbook missing: {path}")

    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    try:
        missing = {SHEET_TARGET_BATCH, SHEET_NASS_REFERENCE, SHEET_SOURCES, SHEET_METHOD}
        missing -= set(wb.sheetnames)
        if missing:
            raise WorkbookError(
                f"seed workbook is missing sheet(s) {sorted(missing)}; "
                f"found {wb.sheetnames}")

        book = SeedWorkbook(path=path, sha256=_sha256(path))

        # --- Method: (label, text) pairs, prose only -------------------------
        for row in wb[SHEET_METHOD].iter_rows(values_only=True):
            label, text = _cell(row, 0), _cell(row, 1)
            if label or text:
                book.method_lines.append((label, text))

        # --- Target Batch: the crop list -------------------------------------
        rows = list(wb[SHEET_TARGET_BATCH].iter_rows(values_only=True))
        if not rows:
            raise WorkbookError("Target Batch is empty")
        for idx, row in enumerate(rows[1:], start=2):
            crop = _cell(row, 0)
            if not crop:
                continue
            tier_original = _cell(row, 2)
            book.crops.append(WorkbookCrop(
                crop=crop,
                preferred_price_form=_cell(row, 1),
                tier=_normalize_tier(tier_original),
                tier_original=tier_original,
                nass_commodity_ref=_cell(row, 3) or None,
                dedicated_unit_price=_cell(row, 4),
                infrastructure_finding=_cell(row, 5),
                source_url=_cell(row, 6) or None,
                notes=_cell(row, 7),
                row_number=idx,
            ))

        # --- NASS Reference: code identity only ------------------------------
        ref_rows = list(wb[SHEET_NASS_REFERENCE].iter_rows(values_only=True))
        for row in ref_rows[1:]:
            commodity = _cell(row, 0)
            if not commodity:
                continue
            book.nass_references.append(NASSReference(
                commodity=commodity,
                code=_cell(row, 1),
                description=_cell(row, 2),
                source_note=_cell(row, 3),
            ))

        # --- Sources: citations ----------------------------------------------
        source_rows = list(wb[SHEET_SOURCES].iter_rows(values_only=True))
        for row in source_rows[1:]:
            name = _cell(row, 0)
            if not name:
                continue
            book.sources.append(SourceCitation(
                source=name,
                establishes=_cell(row, 1),
                url=_cell(row, 2),
            ))

        if not book.crops:
            raise WorkbookError("Target Batch contains no crop rows")
        return book
    finally:
        wb.close()


def invalid_tiers(book: SeedWorkbook, known: set[str]) -> list[str]:
    """Crop rows whose tier is not one the registry defines.

    Surfaced as a list rather than raised, because a workbook row with an unexpected tier
    should appear in the audit trail as a review item, not abort the run.
    """
    out = []
    for c in book.crops:
        if c.tier and c.tier not in known:
            out.append(f"{c.crop}: tier {c.tier_original!r} (row {c.row_number})")
    return out

