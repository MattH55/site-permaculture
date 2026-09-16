"""Wide-coverage (v2) config loader: group defaults, crop overrides, country tracks.

This module turns ``wide_price_sources.yaml`` into a resolved, validated structure. It sits
alongside :mod:`price_pipeline.usda_registry` rather than replacing it, for the same reason
v1 kept its registry separate from the Alberta one: the two answer different questions.

Three v2 rules are enforced *here*, not trusted to the config author:

1. **Override, never merge** (v2 Part 3). A crop-specific ``preferred`` list fully replaces
   its group default. ``preferred_for`` returns exactly one list — the crop's if present,
   else the group's — and there is no code path that concatenates the two.

2. **Tier hints are not classifications** (v2 §1.1). The loader carries no field into which
   a ``known_tier_hint`` could be promoted.

3. **B2 sits between B and C** (v2 §1.4). The tier preference order is explicit so that a
   family claiming Tier B2 is ranked correctly and so the classifier can tell a real B2
   observation from a relabeled B.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import yaml

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
WIDE_REGISTRY_PATH = os.path.join(PROJECT_ROOT, "wide_price_sources.yaml")

# Tier preference order, strongest evidence first. B2 is a *real* tier inserted between the
# federal wholesale survey (B) and the aggregate census (C) — v2 §1.4. "D/E" is not a tier
# here; it is a workbook authoring state that v1 resolves, and the wide pipeline never
# emits it as a selected tier.
TIER_ORDER = ("A", "B", "B2", "C", "D", "E")

# Tiers that can carry a per-unit price. C is sales-value-only; E is nothing.
TIER_CARRIES_PRICE = {"A": True, "B": True, "B2": True, "C": False, "D": True, "E": False}


class WideRegistryError(RuntimeError):
    """Raised when the wide registry is internally inconsistent."""


@dataclass(frozen=True)
class SourceFamily:
    """A named source family and the tier/market_level/country it implies."""

    family: str
    country: str
    tier: str
    market_level: str


@dataclass(frozen=True)
class CropPreference:
    """One crop's resolved search order, after applying the override rule."""

    crop: str
    preferred: tuple[str, ...]
    nass_special_survey: str | None = None
    overridden: bool = False          # True when a crop-specific entry replaced the group default
    source: str = "group_default"     # "crop_override" | "group_default"


@dataclass(frozen=True)
class TierB2Confidence:
    default: str = "medium"
    multi_year_threshold_years: int = 3
    one_off: str = "low"


def source_families(doc: dict[str, Any]) -> dict[str, SourceFamily]:
    out: dict[str, SourceFamily] = {}
    for name, raw in (doc.get("source_families") or {}).items():
        raw = raw or {}
        tier = str(raw.get("tier") or "").strip()
        if tier not in TIER_ORDER:
            raise WideRegistryError(
                f"source_family {name!r} has unknown tier {tier!r}; "
                f"expected one of {list(TIER_ORDER)}"
            )
        out[name] = SourceFamily(
            family=name,
            country=str(raw.get("country") or "").strip().upper(),
            tier=tier,
            market_level=str(raw.get("market_level") or "").strip(),
        )
    return out


def tier_b2_confidence(doc: dict[str, Any]) -> TierB2Confidence:
    raw = doc.get("tier_b2_confidence") or {}
    return TierB2Confidence(
        default=str(raw.get("default") or "medium"),
        multi_year_threshold_years=int(raw.get("multi_year_threshold_years") or 3),
        one_off=str(raw.get("one_off") or "low"),
    )


def _families_for(entry: Any) -> tuple[str, ...]:
    if not isinstance(entry, dict):
        return ()
    pref = entry.get("preferred") or []
    return tuple(str(p).strip() for p in pref if str(p).strip())


def group_defaults(doc: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    return {
        str(group).strip(): _families_for(entry)
        for group, entry in (doc.get("_defaults") or {}).items()
    }


def preferred_for(doc: dict[str, Any], crop: str, crop_group: str) -> CropPreference:
    """Resolve a crop's search order under the override-not-merge rule.

    A crop-specific entry wins outright; the group default is consulted only when no
    crop-specific entry exists. There is deliberately no third branch that would merge
    them — that is the exact ambiguity v2 Part 3 forbids.
    """
    crops_cfg = doc.get("crops") or {}
    if crop in crops_cfg:
        entry = crops_cfg[crop] or {}
        return CropPreference(
            crop=crop,
            preferred=_families_for(entry),
            nass_special_survey=(entry.get("nass_special_survey") or None),
            overridden=True,
            source="crop_override",
        )
    defaults = group_defaults(doc)
    return CropPreference(
        crop=crop,
        preferred=defaults.get(crop_group, ()),
        nass_special_survey=None,
        overridden=False,
        source="group_default",
    )


def validate(doc: dict[str, Any], seed_groups: set[str] | None = None) -> list[str]:
    """Return every internal inconsistency rather than raising on the first.

    Mirrors :func:`usda_registry.validate`: structural unknowns (a preferred family that
    names nothing registered) are fatal to interpretation, but are returned as a list so a
    report can print them all and still render.
    """
    problems: list[str] = []
    families = source_families(doc)

    for group, pref in group_defaults(doc).items():
        if seed_groups is not None and group not in seed_groups:
            problems.append(
                f"group default {group!r} matches no crop_group in the seed list"
            )
        unknown = [f for f in pref if f not in families]
        if unknown:
            problems.append(f"group default {group!r} prefers unknown family {unknown}")

    for crop, entry in (doc.get("crops") or {}).items():
        for fam in _families_for(entry):
            if fam not in families:
                problems.append(f"crop {crop!r} prefers unknown family {fam!r}")

    # A crop override with an EMPTY preferred list is almost always a typo: the author
    # meant to inherit the group default but instead suppressed it. Flag for review.
    for crop, entry in (doc.get("crops") or {}).items():
        if isinstance(entry, dict) and "preferred" in entry and not _families_for(entry):
            problems.append(
                f"crop {crop!r} has a crop-specific entry with an empty preferred list; "
                f"this suppresses the group default entirely"
            )
    return problems


def load_wide_registry(path: str | None = None) -> dict[str, Any]:
    """Read and structurally validate the wide registry."""
    with open(path or WIDE_REGISTRY_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict):
        raise WideRegistryError("wide registry root must be a mapping")
    if not doc.get("source_families"):
        raise WideRegistryError("wide registry declares no source_families")
    if "_defaults" not in doc and "crops" not in doc:
        raise WideRegistryError("wide registry declares neither _defaults nor crops")
    return doc
