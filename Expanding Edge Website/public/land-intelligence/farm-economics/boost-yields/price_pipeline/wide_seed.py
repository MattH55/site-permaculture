"""Seed-list reader for the wide-coverage (v2) specialty-crop price pipeline.

v2 §1.1 replaces the single-workbook seed of v1 with ``seed/specialty_crop_seed_list.csv``
covering many crops at once across both U.S. and Canadian sources. Where v1's workbook
reader preserved a published sheet verbatim, this reader's obligation is different: a seed
row is a *starting hypothesis*, not a source of truth.

The one discipline that matters most here (v2 §1.1): ``known_tier_hint`` is prior knowledge
that exists ONLY to help the agent order its work — checking likely Tier A/B crops before
likely Tier E crops. It is *never* authoritative and must never be written into
``crop_source_status.selected_tier`` without a discovery run confirming it. So this reader
keeps the hint in a clearly-named field and offers no accessor that would let it leak into
a classification.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
DEFAULT_SEED_LIST = os.path.join(
    PROJECT_ROOT, "seed", "specialty_crop_seed_list.csv"
)

# Closed crop-group taxonomy (v2 §1.1). A row with any other group is a structural error,
# because group is what the --by-group coverage rollup aggregates on.
CROP_GROUPS = (
    "culinary_herb",
    "medicinal_herb",
    "mushroom",
    "botanical_ornamental",
    "pulse_specialty",
    "oilseed_specialty",
    "root_spice",
    "sweetener",
    "microgreen_leafy",
    "other",
)

# ISO 3166-1 alpha-2 country codes this pipeline tracks. v2 §1.2 makes country first-class.
COUNTRIES = ("US", "CA")

# ISO 4217 currencies paired to those countries. Conversion is never done in-table (§1.2).
CURRENCIES = ("USD", "CAD")


class SeedListError(RuntimeError):
    """Raised when the seed list's structure is not what the pipeline expects."""


@dataclass(frozen=True)
class SeedCrop:
    """One row of the seed list, preserved as authored.

    ``known_tier_hint`` is deliberately *not* named ``tier`` anywhere in this object: the
    word "tier" alone is how a hint starts masquerading as a finding.
    """

    crop: str
    crop_group: str
    known_tier_hint: str | None
    target_countries: tuple[str, ...]
    notes: str
    row_number: int


@dataclass
class SeedList:
    path: str
    crops: list[SeedCrop]

    def by_group(self, group: str) -> list[SeedCrop]:
        return [c for c in self.crops if c.crop_group == group]

    def groups(self) -> list[str]:
        seen: list[str] = []
        for c in self.crops:
            if c.crop_group not in seen:
                seen.append(c.crop_group)
        return seen


def _normalize_hint(raw: str) -> str | None:
    """``""`` -> None; otherwise upper-cased. ``B2`` and ``D/E`` pass through unchanged."""
    h = (raw or "").strip().upper()
    return h or None


def _parse_countries(raw: str) -> tuple[str, ...]:
    out: list[str] = []
    for part in (raw or "").replace("|", ",").replace(";", ",").split(","):
        code = part.strip().upper()
        if code:
            out.append(code)
    return tuple(out)


def read_seed_list(path: str | None = None) -> SeedList:
    """Read and structurally validate the seed list.

    Raises on any problem that would make a downstream coverage report silently wrong —
    an unknown crop_group, an unknown country code, or a duplicated crop. A duplicated crop
    is fatal because two rows with the same ``crop`` key would collide in the config's
    crop-specific override map and in ``crop_source_status``.
    """
    path = path or DEFAULT_SEED_LIST
    if not os.path.exists(path):
        raise FileNotFoundError(f"seed list missing: {path}")

    crops: list[SeedCrop] = []
    seen_crops: set[str] = set()
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        required = {"crop", "crop_group", "target_countries"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SeedListError(
                f"seed list is missing column(s) {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for idx, row in enumerate(reader, start=2):
            crop = (row.get("crop") or "").strip()
            if not crop:
                continue
            group = (row.get("crop_group") or "").strip()
            if group not in CROP_GROUPS:
                raise SeedListError(
                    f"row {idx} ({crop!r}): unknown crop_group {group!r}; "
                    f"expected one of {list(CROP_GROUPS)}"
                )
            countries = _parse_countries(row.get("target_countries") or "")
            if not countries:
                raise SeedListError(
                    f"row {idx} ({crop!r}): target_countries is empty; "
                    f"expected a subset of {list(COUNTRIES)}"
                )
            unknown = [c for c in countries if c not in COUNTRIES]
            if unknown:
                raise SeedListError(
                    f"row {idx} ({crop!r}): unknown target country {unknown}; "
                    f"expected a subset of {list(COUNTRIES)}"
                )
            if crop in seen_crops:
                raise SeedListError(
                    f"row {idx}: duplicate crop {crop!r}; each crop key must be unique"
                )
            seen_crops.add(crop)
            crops.append(SeedCrop(
                crop=crop,
                crop_group=group,
                known_tier_hint=_normalize_hint(row.get("known_tier_hint") or ""),
                target_countries=countries,
                notes=(row.get("notes") or "").strip(),
                row_number=idx,
            ))

    if not crops:
        raise SeedListError("seed list contains no crop rows")
    return SeedList(path=path, crops=crops)
