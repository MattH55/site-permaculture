"""Loader and validator for the v3 §30 master source catalog.

Mirrors the discipline of :mod:`wide_catalogs` (v2): a catalog entry is a *place to look*,
never a retrieved observation. Validation enforces the closed vocabularies from
:mod:`wide_source_scoring` — a source with an unknown class, price type, or access state
is a structural error, because downstream scoring and discovery would silently mis-rank it.

The loader supplies explicit defaults for the §30 capability fields so compact YAML flow
entries (the provincial and national-agency blocks) are still fully-formed records.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import yaml

from . import wide_source_scoring as SC

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
WIDE_SOURCE_CATALOG_PATH = os.path.join(
    PROJECT_ROOT, "data", "wide_source_catalog.yaml"
)

# §30 field set every loaded entry exposes (defaults applied where YAML omits them).
_FIELD_DEFAULTS: dict[str, object] = {
    "region": None, "market_level": None,
    "api_available": False, "download_available": False, "scrape_available": False,
    "historical_available": False, "frequency": "varies", "current_data": True,
    "coverage_start": None, "coverage_end": None,
    "currency": "", "unit": "",
    "methodology_url": None, "data_url": None, "source_url": None,
    "env_key": None, "crop_groups": ["all"], "crops": [],
    "verbatim_series_hint": None, "notes": "",
}


class WideSourceCatalogError(RuntimeError):
    """Raised when the master source catalog is structurally invalid."""


@dataclass(frozen=True)
class CatalogSource:
    """One §30 catalog entry, fully defaulted and validated."""

    source_id: str
    source_name: str
    organization: str
    country: str                       # ISO code, "EU", or "GLOBAL"
    region: str | None
    source_class: str                  # §3 dimension 1 (closed vocabulary)
    price_type: str                    # §3 dimension 2 (closed vocabulary)
    market_level: str | None
    api_available: bool
    download_available: bool
    scrape_available: bool
    historical_available: bool
    frequency: str
    current_data: bool
    coverage_start: str | None
    coverage_end: str | None
    currency: str
    unit: str
    methodology_url: str | None
    data_url: str | None
    source_url: str | None
    access_status: str                 # §42 closed vocabulary
    env_key: str | None
    crop_groups: tuple[str, ...] = field(default_factory=tuple)
    crops: tuple[str, ...] = field(default_factory=tuple)
    verbatim_series_hint: str | None = None
    notes: str = ""

    @property
    def authority(self) -> int:
        """§31 source-authority score (publisher authority, not price quality)."""
        return SC.authority_score(self.source_class)

    @property
    def is_global(self) -> bool:
        return self.country.upper() in {"GLOBAL", "EU"}

    def covers_crop(self, crop: str, crop_group: str) -> bool:
        groups = set(self.crop_groups)
        return crop in set(self.crops) or "all" in groups or crop_group in groups

    def covers_country(self, country: str) -> bool:
        return self.is_global or self.country.upper() == country.upper()

    def to_row(self) -> dict[str, object]:
        """Row shape for ``wide_source_catalog.csv`` (§56)."""
        return {
            "source_id": self.source_id, "source_name": self.source_name,
            "organization": self.organization, "country": self.country,
            "region": self.region or "", "source_class": self.source_class,
            "price_type": self.price_type, "market_level": self.market_level or "",
            "api_available": self.api_available,
            "download_available": self.download_available,
            "scrape_available": self.scrape_available,
            "historical_available": self.historical_available,
            "frequency": self.frequency, "current_data": self.current_data,
            "coverage_start": self.coverage_start or "",
            "coverage_end": self.coverage_end or "",
            "currency": self.currency, "unit": self.unit,
            "methodology_url": self.methodology_url or "",
            "data_url": self.data_url or "", "source_url": self.source_url or "",
            "access_status": self.access_status, "env_key": self.env_key or "",
            "source_authority_score": self.authority, "notes": self.notes,
        }


def _coerce_source(raw: dict) -> CatalogSource:
    merged = {**_FIELD_DEFAULTS, **(raw or {})}
    source_id = str(merged.get("source_id") or "").strip()
    if not source_id:
        raise WideSourceCatalogError("catalog entry missing source_id")
    source_class = str(merged.get("source_class") or "").strip()
    if source_class not in SC.SOURCE_CLASSES:
        raise WideSourceCatalogError(
            f"{source_id}: unknown source_class {source_class!r}; "
            f"expected one of {list(SC.SOURCE_CLASSES)}"
        )
    price_type = str(merged.get("price_type") or "").strip()
    if price_type not in SC.PRICE_TYPES:
        raise WideSourceCatalogError(
            f"{source_id}: unknown price_type {price_type!r}; "
            f"expected one of {list(SC.PRICE_TYPES)}"
        )
    access_status = str(merged.get("access_status") or "").strip()
    if access_status not in SC.ACCESS_STATES:
        raise WideSourceCatalogError(
            f"{source_id}: unknown access_status {access_status!r}; "
            f"expected one of {list(SC.ACCESS_STATES)}"
        )
    groups = merged.get("crop_groups") or []
    if isinstance(groups, str):
        groups = [groups]
    crops = merged.get("crops") or []
    if isinstance(crops, str):
        crops = [crops]
    country = str(merged.get("country") or "").strip().upper()
    if not country:
        raise WideSourceCatalogError(f"{source_id}: missing country")
    return CatalogSource(
        source_id=source_id,
        source_name=str(merged.get("source_name") or "").strip(),
        organization=str(merged.get("organization") or "").strip(),
        country=country,
        region=(merged.get("region") or None),
        source_class=source_class,
        price_type=price_type,
        market_level=(merged.get("market_level") or None),
        api_available=bool(merged.get("api_available", False)),
        download_available=bool(merged.get("download_available", False)),
        scrape_available=bool(merged.get("scrape_available", False)),
        historical_available=bool(merged.get("historical_available", False)),
        frequency=str(merged.get("frequency") or "varies").strip(),
        current_data=bool(merged.get("current_data", True)),
        coverage_start=(merged.get("coverage_start") or None),
        coverage_end=(merged.get("coverage_end") or None),
        currency=str(merged.get("currency") or "").strip(),
        unit=str(merged.get("unit") or "").strip(),
        methodology_url=(merged.get("methodology_url") or None),
        data_url=(merged.get("data_url") or None),
        source_url=(merged.get("source_url") or None),
        access_status=access_status,
        env_key=(merged.get("env_key") or None),
        crop_groups=tuple(str(g).strip() for g in groups),
        crops=tuple(str(c).strip() for c in crops),
        verbatim_series_hint=(merged.get("verbatim_series_hint") or None),
        notes=str(merged.get("notes") or "").strip(),
    )


@dataclass(frozen=True)
class WideSourceCatalog:
    sources: tuple[CatalogSource, ...]
    commodity_universes: dict
    last_checked: str

    def by_id(self, source_id: str) -> CatalogSource | None:
        for s in self.sources:
            if s.source_id == source_id:
                return s
        return None

    def for_crop_country(self, crop: str, crop_group: str, country: str) -> list[CatalogSource]:
        """§28: candidate sources for one crop in one country, authority-descending."""
        hits = [s for s in self.sources
                if s.covers_country(country) and s.covers_crop(crop, crop_group)]
        hits.sort(key=lambda s: (-s.authority, s.source_id))
        return hits


def load_source_catalog(path: str | None = None) -> WideSourceCatalog:
    with open(path or WIDE_SOURCE_CATALOG_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict) or not doc.get("sources"):
        raise WideSourceCatalogError("wide_source_catalog declares no sources")
    sources = tuple(_coerce_source(raw) for raw in doc["sources"])
    ids = [s.source_id for s in sources]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise WideSourceCatalogError(f"duplicate source_id(s): {dupes}")
    return WideSourceCatalog(
        sources=sources,
        commodity_universes=doc.get("commodity_universes") or {},
        last_checked=str(doc.get("last_checked") or ""),
    )

