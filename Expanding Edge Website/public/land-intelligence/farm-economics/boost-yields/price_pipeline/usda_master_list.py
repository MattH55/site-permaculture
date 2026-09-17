"""Ingest the USDA AMS specialty-crop master list (full-coverage spec, Section 1.1).

Source: the canonical PDF at
https://www.ams.usda.gov/sites/default/files/media/USDASpecialtyCropDefinition.pdf
("USDA Definition of Specialty Crop"), retrieved and cached under
``data/raw/usda_master_list/``. This is the authoritative, government-published list;
the companion HTML page (https://www.ams.usda.gov/services/grants/scbgp/specialty-crop)
repeats the same appendices as body text and is not parsed separately.

The PDF is six appendices:

    A  Fruits and Tree Nuts            (eligible)
    B  Vegetables                      (eligible)
    C  Culinary Herbs and Spices       (eligible)
    D  Medicinal Herbs                 (eligible)
    E  Floriculture and Nursery Crops  (eligible; divided into named subsections)
    F  Ineligible Crops                (not eligible; divided into named subsections)

Appendices A-D are flat lists. B has a small number of *compound* entries (a parent crop
with indented variant lines, e.g. "Bean" / "Snap or Green" / "Lima" / "Dry, Edible") --
these are preserved as parent+variant rows rather than merged or split into independent
crops, per the spec's explicit instruction not to silently normalize compound entries.

E and F are each divided into named subsections (e.g. "Christmas Trees", "Oil Seed
Crops") that are themselves plain lines in the extracted text, indistinguishable from a
crop name by formatting alone once run through PyMuPDF's plain-text extraction. This
module hard-codes the two subsection-header lists below, transcribed directly from the
same retrieved document (see ``FLORICULTURE_SUBSECTIONS`` / ``INELIGIBLE_SUBSECTIONS``),
rather than guessing header-vs-crop from indentation heuristics that don't hold in these
two appendices. If the source PDF is revised and a subsection is renamed or added, this
list must be updated by hand and the mismatch will surface as an unrecognized-header
crop row in the output (a subsection name appearing as a "crop"), not a silent drop.
"""
from __future__ import annotations

import csv
import datetime
import os
from dataclasses import dataclass, field

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
RAW_DIR = os.path.join(PROJECT_ROOT, "data", "raw", "usda_master_list")
PDF_PATH = os.path.join(RAW_DIR, "USDASpecialtyCropDefinition.pdf")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")

SOURCE_URL = "https://www.ams.usda.gov/sites/default/files/media/USDASpecialtyCropDefinition.pdf"
SOURCE_PAGE_URL = "https://www.ams.usda.gov/services/grants/scbgp/specialty-crop"

# (appendix letter, category name, is_eligible_specialty)
APPENDICES = [
    ("A", "Fruits and Tree Nuts", True),
    ("B", "Vegetables", True),
    ("C", "Culinary Herbs and Spices", True),
    ("D", "Medicinal Herbs", True),
    ("E", "Floriculture and Nursery Crops", True),
    ("F", "Ineligible Crops", False),
]

# Transcribed verbatim from the retrieved PDF's Appendix E page headings.
FLORICULTURE_SUBSECTIONS = [
    "Annual Bedding Plants",
    "Broadleaf Evergreens",
    "Christmas Trees",
    "Cut Cultivated Greens",
    "Cut Flowers",
    "Deciduous Flowering Trees",
    "Deciduous Shade Trees",
    "Deciduous Shrubs",
    "Foliage Plants",
    "Fruit And Nut Plants",
    "Landscape Conifers",
    "Potted Flowering Plants",
    "Potted Herbaceous Perennials",
    "Propagative Materials",
]

# Transcribed verbatim from the retrieved PDF's Appendix F page headings.
INELIGIBLE_SUBSECTIONS = [
    "Oil Seed Crops (including oil and non-oil cultivars)",
    "Field and Grain Crops",
    "Forage Crops",
    "Fiber Crops",
]

_APPENDIX_HEADER_PREFIX = "APPENDIX"

# Lines that are page furniture, not content, in the extracted text.
_NOISE_LINES = {"", "USDA Definition of Specialty Crop", "BACKGROUND"}


@dataclass
class MasterListRow:
    crop_name: str
    category: str
    appendix: str
    subsection: str | None
    parent_crop: str | None  # set when this row is a variant line under a compound entry
    is_eligible_specialty: bool
    source_url: str
    retrieved_at: str

    def to_dict(self) -> dict:
        return {
            "crop_name": self.crop_name,
            "category": self.category,
            "appendix": self.appendix,
            "subsection": self.subsection or "",
            "parent_crop": self.parent_crop or "",
            "is_eligible_specialty": self.is_eligible_specialty,
            "source_url": self.source_url,
            "retrieved_at": self.retrieved_at,
        }


def _extract_pdf_text(pdf_path: str) -> str:
    import pymupdf
    doc = pymupdf.open(pdf_path)
    try:
        return "\n".join(f"=== page {i} ===\n{page.get_text()}" for i, page in enumerate(doc))
    finally:
        doc.close()


def _split_pages(raw_text: str) -> list[str]:
    pages: list[str] = []
    current: list[str] = []
    for line in raw_text.splitlines():
        if line.strip().startswith("=== page"):
            if current:
                pages.append("\n".join(current))
            current = []
        else:
            current.append(line)
    if current:
        pages.append("\n".join(current))
    return pages


def _find_appendix_start(pages: list[str]) -> dict[str, int]:
    """Map appendix letter -> the index of the page whose text contains that header."""
    starts: dict[str, int] = {}
    for idx, page in enumerate(pages):
        for line in page.splitlines():
            stripped = line.strip()
            if stripped.startswith(_APPENDIX_HEADER_PREFIX):
                # e.g. "APPENDIX A – PLANTS COMMONLY CONSIDERED FRUITS AND TREE NUTS"
                letter = stripped.split()[1].rstrip(":").rstrip("–").rstrip("-")
                starts[letter] = idx
    return starts


def _clean_line(line: str) -> str:
    return line.replace(" ", " ").strip()


def parse_master_list(raw_text: str, *, retrieved_at: str | None = None) -> list[MasterListRow]:
    retrieved_at = retrieved_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    pages = _split_pages(raw_text)
    appendix_start = _find_appendix_start(pages)
    letters = sorted(appendix_start, key=lambda l: appendix_start[l])
    rows: list[MasterListRow] = []

    for pos, letter in enumerate(letters):
        category = next((name for l, name, _ in APPENDICES if l == letter), letter)
        is_eligible = next((elig for l, _, elig in APPENDICES if l == letter), True)
        start = appendix_start[letter]
        end = appendix_start[letters[pos + 1]] if pos + 1 < len(letters) else len(pages)
        appendix_pages = pages[start:end]

        subsections = FLORICULTURE_SUBSECTIONS if letter == "E" else (
            INELIGIBLE_SUBSECTIONS if letter == "F" else None)

        current_subsection: str | None = None
        pending_parent: str | None = None
        pending_parent_indent: int | None = None

        for page in appendix_pages:
            for raw_line in page.splitlines():
                if not raw_line.strip() or raw_line.strip() in _NOISE_LINES:
                    continue
                stripped = raw_line.strip()
                if stripped.startswith(_APPENDIX_HEADER_PREFIX):
                    continue
                if stripped.upper().startswith("APPENDIX") or "PLANTS COMMONLY" in stripped.upper():
                    continue
                if "CROPS" in stripped.upper() and stripped.upper() == stripped and letter in ("E", "F"):
                    # a residual all-caps banner line (title wraps across two lines in E/F)
                    continue

                name = _clean_line(stripped)
                if not name:
                    continue

                if subsections is not None and name in subsections:
                    current_subsection = name
                    pending_parent = None
                    continue

                indent = len(raw_line) - len(raw_line.lstrip(" "))
                is_variant = (
                    subsections is None and pending_parent is not None
                    and indent > (pending_parent_indent or 0)
                )

                if is_variant:
                    rows.append(MasterListRow(
                        crop_name=name, category=category, appendix=letter,
                        subsection=current_subsection, parent_crop=pending_parent,
                        is_eligible_specialty=is_eligible,
                        source_url=SOURCE_URL, retrieved_at=retrieved_at,
                    ))
                else:
                    rows.append(MasterListRow(
                        crop_name=name, category=category, appendix=letter,
                        subsection=current_subsection, parent_crop=None,
                        is_eligible_specialty=is_eligible,
                        source_url=SOURCE_URL, retrieved_at=retrieved_at,
                    ))
                    if subsections is None:
                        pending_parent = name
                        pending_parent_indent = indent

    return rows


def write_master_list_csv(rows: list[MasterListRow], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fieldnames = ["crop_name", "category", "appendix", "subsection", "parent_crop",
                  "is_eligible_specialty", "source_url", "retrieved_at"]
    with open(out_path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_dict())


def ingest(pdf_path: str | None = None, out_path: str | None = None) -> list[MasterListRow]:
    pdf_path = pdf_path or PDF_PATH
    out_path = out_path or os.path.join(OUTPUT_DIR, "usda_master_crop_list.csv")
    raw_text = _extract_pdf_text(pdf_path)
    rows = parse_master_list(raw_text)
    write_master_list_csv(rows, out_path)
    return rows


if __name__ == "__main__":  # pragma: no cover
    result = ingest()
    print(f"parsed {len(result)} rows -> output/usda_master_crop_list.csv")
    by_appendix: dict[str, int] = {}
    for r in result:
        by_appendix[r.appendix] = by_appendix.get(r.appendix, 0) + 1
    for letter, count in sorted(by_appendix.items()):
        print(f"  appendix {letter}: {count}")
