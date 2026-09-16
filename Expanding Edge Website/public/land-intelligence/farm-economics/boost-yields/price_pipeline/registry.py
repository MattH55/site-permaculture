"""Load and sanity-check the price source registry.

The registry (``price_sources.yaml``) is the single place that decides what may be
ingested and what ``price_type`` a source is allowed to emit. Keeping that as data
rather than code means the provenance policy is reviewable in one file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import yaml

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
REGISTRY_PATH = os.path.join(PROJECT_ROOT, "price_sources.yaml")
RAW_DIR = os.path.join(PROJECT_ROOT, "raw")
DATA_DIR = os.path.join(PROJECT_ROOT, "data", "price-observations")


class RegistryError(RuntimeError):
    """Raised when the registry is internally inconsistent."""


@dataclass(frozen=True)
class SourceSpec:
    """A single ingested source plus the policy that governs it."""

    source_id: str
    title: str
    publisher: str
    price_type: str
    parser: str
    kind: str
    raw_name: str
    download_url: str | None = None
    document_url: str | None = None
    table_url: str | None = None
    geography: tuple[str, ...] = ("Alberta",)
    enabled: bool = True
    options: dict[str, Any] = field(default_factory=dict)

    @property
    def raw_path(self) -> str:
        return os.path.join(RAW_DIR, self.raw_name)


def _known_price_types(doc: dict[str, Any]) -> set[str]:
    return dict(doc.get("price_types") or {})


def load_registry(path: str | None = None) -> dict[str, Any]:
    """Read and structurally validate the registry."""
    with open(path or REGISTRY_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict):
        raise RegistryError("registry root must be a mapping")

    types = _known_price_types(doc)
    if not types:
        raise RegistryError("registry declares no price_types")

    seen: set[str] = set()
    for entry in doc.get("sources") or []:
        sid = entry.get("source_id")
        if not sid:
            raise RegistryError("source entry missing source_id")
        if sid in seen:
            raise RegistryError(f"duplicate source_id {sid!r}")
        seen.add(sid)
        ptype = entry.get("price_type")
        if ptype not in types:
            raise RegistryError(f"source {sid!r} has unknown price_type {ptype!r}")
        # A policy-excluded source must never be marked ingestable.
        if types[ptype].get("values_included") is False and entry.get("enabled"):
            raise RegistryError(
                f"source {sid!r} is price_type {ptype!r}, which is externalized "
                "by policy and cannot be enabled"
            )
        for required in ("parser", "kind", "raw_name"):
            if not entry.get(required):
                raise RegistryError(f"source {sid!r} missing {required!r}")
    return doc


_RESERVED = {
    "source_id", "title", "publisher", "price_type", "parser", "kind",
    "raw_name", "download_url", "document_url", "table_url", "geography", "enabled",
}


def sources(doc: dict[str, Any] | None = None, *, include_disabled: bool = False) -> list[SourceSpec]:
    """Materialize source specs from the registry."""
    doc = doc or load_registry()
    out: list[SourceSpec] = []
    for entry in doc.get("sources") or []:
        if not entry.get("enabled", True) and not include_disabled:
            continue
        out.append(
            SourceSpec(
                source_id=entry["source_id"],
                title=entry.get("title", entry["source_id"]),
                publisher=entry.get("publisher", ""),
                price_type=entry["price_type"],
                parser=entry["parser"],
                kind=entry["kind"],
                raw_name=entry["raw_name"],
                download_url=entry.get("download_url"),
                document_url=entry.get("document_url"),
                table_url=entry.get("table_url"),
                geography=tuple(entry.get("geography") or ("Alberta",)),
                enabled=bool(entry.get("enabled", True)),
                options={k: v for k, v in entry.items() if k not in _RESERVED},
            )
        )
    return out


def price_type_meta(doc: dict[str, Any], price_type: str) -> dict[str, Any]:
    """Label/definition/caveat block for a price_type."""
    meta = (doc.get("price_types") or {}).get(price_type)
    if meta is None:
        raise RegistryError(f"unknown price_type {price_type!r}")
    return meta


def external_reference_links(doc: dict[str, Any]) -> list[dict[str, Any]]:
    """Citation-only commercial/restricted references (never ingested)."""
    return list((doc.get("external_references") or {}).get("references") or [])
