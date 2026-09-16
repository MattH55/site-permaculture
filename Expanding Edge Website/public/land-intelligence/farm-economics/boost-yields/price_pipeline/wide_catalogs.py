"""Loaders for the v2 source catalogs: Canadian sources and the NASS special-survey checklist.

Both are *catalogs of places to look*, not retrieved observations. They populate the
``ca_source_catalog`` / mapping deliverables (v2 Part 6) and feed discovery its search
order. The NASS checklist exists because v1 Section 9's generic ``statisticcat_desc`` text
search underspecifies dedicated special surveys (§1.5) — these are enumerated and verified
by name instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import yaml

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
CA_CATALOG_PATH = os.path.join(PROJECT_ROOT, "data", "ca_source_catalog.yaml")
SPECIAL_SURVEYS_PATH = os.path.join(
    PROJECT_ROOT, "data", "known_nass_special_surveys.yaml"
)


class CatalogError(RuntimeError):
    """Raised when a catalog's structure is not what the pipeline expects."""


# --------------------------------------------------------------------- Canadian sources

@dataclass(frozen=True)
class CaSource:
    source_id: str
    source_title: str
    publishing_agency: str
    jurisdiction: str           # 'federal' | 'provincial'
    province: str | None
    report_type: str
    frequency: str
    format: str                 # 'api' | 'csv' | 'pdf' | 'html'
    api_endpoint: str | None
    source_url: str | None
    ca_tier: str
    enabled: bool
    coverage_note: str
    reason: str

    def to_row(self) -> dict[str, object]:
        """Row shape for ``ca_source_catalog.csv`` (v2 §2.3)."""
        return {
            "source_id": self.source_id,
            "source_title": self.source_title,
            "publishing_agency": self.publishing_agency,
            "jurisdiction": self.jurisdiction,
            "province": self.province or "",
            "report_type": self.report_type,
            "frequency": self.frequency,
            "format": self.format,
            "api_endpoint": self.api_endpoint or "",
            "source_url": self.source_url or "",
            "ca_tier": self.ca_tier,
            "enabled": self.enabled,
            "coverage_note": self.coverage_note,
            "reason": self.reason,
        }


def load_ca_catalog(path: str | None = None) -> list[CaSource]:
    with open(path or CA_CATALOG_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict) or not doc.get("sources"):
        raise CatalogError("ca_source_catalog declares no sources")
    out: list[CaSource] = []
    for raw in doc["sources"]:
        raw = raw or {}
        out.append(CaSource(
            source_id=str(raw.get("source_id") or "").strip(),
            source_title=str(raw.get("source_title") or "").strip(),
            publishing_agency=str(raw.get("publishing_agency") or "").strip(),
            jurisdiction=str(raw.get("jurisdiction") or "").strip(),
            province=(raw.get("province") or None),
            report_type=str(raw.get("report_type") or "").strip(),
            frequency=str(raw.get("frequency") or "").strip(),
            format=str(raw.get("format") or "").strip(),
            api_endpoint=(raw.get("api_endpoint") or None),
            source_url=(raw.get("source_url") or None),
            ca_tier=str(raw.get("ca_tier") or "").strip(),
            enabled=bool(raw.get("enabled", False)),
            coverage_note=str(raw.get("coverage_note") or "").strip(),
            reason=str(raw.get("reason") or "").strip(),
        ))
    return out


# --------------------------------------------------------------------- NASS special surveys

@dataclass(frozen=True)
class SpecialSurvey:
    key: str
    report_title: str
    frequency: str
    has_price_field: bool
    unit: str | None
    verbatim_series_hint: str | None
    notes: str

    def to_row(self) -> dict[str, object]:
        return {
            "survey_key": self.key,
            "report_title": self.report_title,
            "frequency": self.frequency,
            "has_price_field": self.has_price_field,
            "unit": self.unit or "",
            "verbatim_series_hint": self.verbatim_series_hint or "",
            "notes": self.notes,
        }


def load_special_surveys(path: str | None = None) -> list[SpecialSurvey]:
    with open(path or SPECIAL_SURVEYS_PATH, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict) or not doc.get("surveys"):
        raise CatalogError("known_nass_special_surveys declares no surveys")
    out: list[SpecialSurvey] = []
    for raw in doc["surveys"]:
        raw = raw or {}
        out.append(SpecialSurvey(
            key=str(raw.get("key") or "").strip(),
            report_title=str(raw.get("report_title") or "").strip(),
            frequency=str(raw.get("frequency") or "").strip(),
            has_price_field=bool(raw.get("has_price_field", False)),
            unit=(raw.get("unit") or None),
            verbatim_series_hint=(raw.get("verbatim_series_hint") or None),
            notes=str(raw.get("notes") or "").strip(),
        ))
    return out
