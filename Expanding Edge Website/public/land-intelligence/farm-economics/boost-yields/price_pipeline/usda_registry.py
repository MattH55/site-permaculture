"""Registry for the U.S. (Tier A–E) specialty-crop price layer.

Separate from :mod:`price_pipeline.registry`, which governs the Alberta ingestion layer,
because the two answer different questions. The Alberta registry says *what may be
ingested*; this one says *for each crop, which sources are searched, in what order, and
what the search found*. Conflating them would let a search-priority list masquerade as an
availability claim, which section 26 explicitly forbids.

Two invariants are enforced here rather than trusted:

1. Every crop's ``preferred`` entries name real, registered source families. A typo in a
   priority list is otherwise invisible: the crop simply classifies as "not found".
2. A disabled source must state a ``reason``, so a reader can tell "not retrieved yet"
   from "retrieved and empty".
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import yaml

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
USDA_REGISTRY_PATH = os.path.join(PROJECT_ROOT, "usda_price_sources.yaml")

# Tier C and Tier D never yield a producer price: C is a sales-value aggregate and D is a
# border proxy. Kept as a named constant because the validator, the classifier and the
# coverage report all have to agree on it.
PROXY_TIERS = frozenset({"C", "D"})


class UsdaRegistryError(RuntimeError):
    """Raised when the U.S. registry is internally inconsistent."""


@dataclass(frozen=True)
class TierSpec:
    tier: str
    label: str
    source_system: str | None
    market_level: str | None
    definition: str
    price_available: bool
    caveat: str | None = None

    @property
    def is_proxy(self) -> bool:
        return self.tier in PROXY_TIERS


@dataclass(frozen=True)
class UsdaSourceSpec:
    source_id: str
    title: str
    publisher: str
    tier: str
    kind: str
    enabled: bool
    price_type: str | None = None
    download_url: str | None = None
    document_url: str | None = None
    source_url: str | None = None
    raw_name: str | None = None
    credential_env: str | None = None
    coverage_note: str = ""
    reason: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def raw_path(self) -> str | None:
        if not self.raw_name:
            return None
        return os.path.join(PROJECT_ROOT, "raw", self.raw_name)


@dataclass(frozen=True)
class CropSpec:
    crop_id: str
    preferred: tuple[str, ...]
    nass_commodity_ref: str | None = None
    variety_notes: str | None = None
    search_aliases: tuple[str, ...] = ()


_RESERVED_SOURCE_KEYS = {
    "source_id", "title", "publisher", "tier", "kind", "enabled", "price_type",
    "download_url", "document_url", "source_url", "raw_name", "credential_env",
    "coverage_note", "reason",
}


def load_usda_registry(path: str | None = None) -> dict[str, Any]:
    """Read and structurally validate the U.S. registry."""
    with open(path or USDA_REGISTRY_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict):
        raise UsdaRegistryError("registry root must be a mapping")

    tspecs = doc.get("tiers") or {}
    if not tspecs:
        raise UsdaRegistryError("registry declares no tiers")

    levels = set(doc.get("market_levels") or [])
    if not levels:
        raise UsdaRegistryError("registry declares no market_levels")

    for tier, meta in tspecs.items():
        level = meta.get("market_level")
        if level is not None and level not in levels:
            raise UsdaRegistryError(
                f"tier {tier!r} declares unknown market_level {level!r}")

    seen: set[str] = set()
    for entry in doc.get("sources") or []:
        sid = entry.get("source_id")
        if not sid:
            raise UsdaRegistryError("source entry missing source_id")
        if sid in seen:
            raise UsdaRegistryError(f"duplicate source_id {sid!r}")
        seen.add(sid)
        if entry.get("tier") not in tspecs:
            raise UsdaRegistryError(
                f"source {sid!r} has unknown tier {entry.get('tier')!r}")
        # A dormant source must say why, or a reader cannot tell "not retrieved yet"
        # from "retrieved and empty".
        if not entry.get("enabled", True) and not entry.get("reason"):
            raise UsdaRegistryError(f"disabled source {sid!r} has no reason")

    _validate_crop_priorities(doc)
    return doc


def _validate_crop_priorities(doc: dict[str, Any]) -> None:
    """Every ``preferred`` token must name a registered source family."""
    known = _source_families(doc)
    for crop_id, entry in (doc.get("crops") or {}).items():
        preferred = entry.get("preferred") or []
        if not preferred:
            raise UsdaRegistryError(f"crop {crop_id!r} declares no preferred sources")
        for token in preferred:
            if token not in known:
                raise UsdaRegistryError(
                    f"crop {crop_id!r} prefers unknown source {token!r}; "
                    f"known families are {sorted(known)}")


def _source_families(doc: dict[str, Any]) -> set[str]:
    """Source families, derived from ``source_id`` rather than hard-coded.

    ``nass_crop_values`` and ``ams_terminal_reports`` reduce to ``nass`` and ``ams``, so
    adding another NASS publication to the registry automatically makes it addressable
    from a crop's priority list without touching this module.
    """
    out = set()
    for entry in doc.get("sources") or []:
        sid = entry.get("source_id") or ""
        if sid:
            out.add(sid.split("_", 1)[0])
    return out


def tiers(doc: dict[str, Any] | None = None) -> dict[str, TierSpec]:
    doc = doc or load_usda_registry()
    out: dict[str, TierSpec] = {}
    for tier, meta in (doc.get("tiers") or {}).items():
        out[tier] = TierSpec(
            tier=tier,
            label=meta.get("label", tier),
            source_system=meta.get("source_system"),
            market_level=meta.get("market_level"),
            definition=meta.get("definition", ""),
            price_available=bool(meta.get("price_available", False)),
            caveat=meta.get("caveat"),
        )
    return out


def tier_meta(doc: dict[str, Any], tier: str) -> TierSpec:
    try:
        return tiers(doc)[tier]
    except KeyError:
        raise UsdaRegistryError(f"unknown tier {tier!r}") from None


def usda_sources(
    doc: dict[str, Any] | None = None, *, include_disabled: bool = True,
) -> list[UsdaSourceSpec]:
    doc = doc or load_usda_registry()
    out: list[UsdaSourceSpec] = []
    for entry in doc.get("sources") or []:
        if not entry.get("enabled", True) and not include_disabled:
            continue
        out.append(UsdaSourceSpec(
            source_id=entry["source_id"],
            title=entry.get("title", entry["source_id"]),
            publisher=entry.get("publisher", ""),
            tier=entry["tier"],
            kind=entry.get("kind", ""),
            enabled=bool(entry.get("enabled", True)),
            price_type=entry.get("price_type"),
            download_url=entry.get("download_url"),
            document_url=entry.get("document_url"),
            source_url=entry.get("source_url"),
            raw_name=entry.get("raw_name"),
            credential_env=entry.get("credential_env"),
            coverage_note=entry.get("coverage_note", ""),
            reason=entry.get("reason", ""),
            extra={k: v for k, v in entry.items() if k not in _RESERVED_SOURCE_KEYS},
        ))
    return out


def crops(doc: dict[str, Any] | None = None) -> list[CropSpec]:
    doc = doc or load_usda_registry()
    out: list[CropSpec] = []
    for crop_id, entry in (doc.get("crops") or {}).items():
        out.append(CropSpec(
            crop_id=crop_id,
            preferred=tuple(entry.get("preferred") or ()),
            nass_commodity_ref=entry.get("nass_commodity_ref"),
            variety_notes=entry.get("variety_notes"),
            search_aliases=tuple(entry.get("search_aliases") or ()),
        ))
    return out


def aliases(doc: dict[str, Any] | None = None) -> dict[str, str]:
    """Map every declared alias -> its crop_id.

    Aliases exist so that a caller asking for ``shiitake`` reaches the ``mushrooms`` row
    instead of being told the crop is unknown. They are declared in the registry and
    validated for collisions because an alias is a *claim of identity*: letting
    ``shiitake`` resolve to two different crops would make the price attribution
    arbitrary, which is the failure mode §32 forbids.
    """
    doc = doc or load_usda_registry()
    out: dict[str, str] = {}
    for crop in crops(doc):
        for alias in crop.search_aliases:
            out[alias] = crop.crop_id
    return out


def market_levels(doc: dict[str, Any]) -> set[str]:
    """The declared market levels. A set because the registry only requires membership."""
    return set(doc.get("market_levels") or [])


def source_families(doc: dict[str, Any]) -> set[str]:
    """Public wrapper over the family derivation, for callers outside this module."""
    return _source_families(doc)


def validate(doc: dict[str, Any]) -> list[str]:
    """Return every internal inconsistency, rather than raising on the first.

    ``load_usda_registry`` raises on the *fatal* structural problems, because a registry
    with an unknown tier cannot be interpreted at all. These are the softer checks that a
    report should be able to print in full and still render: a crop whose priority list
    names only disabled families is registerable but yields no price for anyone, and a
    reader deserves to see all such crops at once instead of one per run.

    Returning a list rather than raising is deliberate — the CLI's ``status`` command uses
    it to answer "is this registry usable for a price layer?" without a traceback.
    """
    problems: list[str] = []
    tspecs = tiers(doc)
    families = _source_families(doc)
    enabled_families: set[str] = set()
    for src in usda_sources(doc):
        if src.enabled:
            enabled_families.add(src.source_id.split("_", 1)[0])

    if not usda_sources(doc):
        problems.append("registry declares no sources")

    for level in market_levels(doc):
        if not isinstance(level, str):
            problems.append(f"market_level {level!r} is not a plain string")

    for src in usda_sources(doc):
        if src.tier not in tspecs:
            problems.append(f"source {src.source_id!r} has unknown tier {src.tier!r}")
        if not src.enabled and not src.reason:
            problems.append(f"disabled source {src.source_id!r} has no reason")
        if src.credential_env and not src.enabled:
            # Fine, but worth surfacing: this is the shape that hides a credential sweep.
            problems.append(
                f"source {src.source_id!r} is disabled and expects {src.credential_env}"
            )

    for crop in crops(doc):
        unknown = [t for t in crop.preferred if t not in families]
        if unknown:
            problems.append(
                f"crop {crop.crop_id!r} prefers unknown source(s) {unknown}"
            )
        elif not any(t in enabled_families for t in crop.preferred):
            # Not an error: §26 lets the config express priority ahead of availability. It
            # is reported so the coverage report can distinguish "not retrieved" from
            # "nothing to retrieve".
            problems.append(
                f"crop {crop.crop_id!r} has no enabled source in its priority list "
                f"{list(crop.preferred)}"
            )

    # An alias pointing at two crops would make attribution arbitrary, and one colliding
    # with a real crop_id would silently shadow that crop's own row.
    real_ids = {c.crop_id for c in crops(doc)}
    claimed: dict[str, str] = {}
    for crop in crops(doc):
        if crop.search_aliases and crop.crop_id not in real_ids:
            problems.append(f"crop {crop.crop_id!r} declares aliases but is not addressable")
        for alias in crop.search_aliases:
            if alias in real_ids:
                problems.append(
                    f"alias {alias!r} on crop {crop.crop_id!r} collides with a crop_id"
                )
            if alias in claimed and claimed[alias] != crop.crop_id:
                problems.append(
                    f"alias {alias!r} claimed by both {claimed[alias]!r} "
                    f"and {crop.crop_id!r}"
                )
            claimed[alias] = crop.crop_id
    return problems

