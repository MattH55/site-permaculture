"""Normalized observation records.

Field names follow the instruction document's provenance list verbatim
(Source / Dataset / Year-date / Geography / Market level / Original unit /
Normalized unit / Observed-derived) so the frontend can render provenance
without inventing labels.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

REQUIRED_FIELDS = (
    "observation_id", "crop_id", "source_id", "price_type", "region",
    "reference_date", "original_value", "original_unit", "currency",
    "normalized_value", "normalized_unit", "record_origin",
)


@dataclass
class Observation:
    """One price observation, already unit-resolved.

    ``normalized_value`` may be ``None``. When it is, ``conversion_basis`` holds
    the reason code from :mod:`price_pipeline.units` and the row is routed to the
    quarantine file by ``write_dataset``. Quarantining is a first-class outcome:
    the point is that the number is visible-but-not-converted, never that it is
    dropped, and never that a conversion is invented to fill it in.
    """

    observation_id: str
    crop_id: str | None
    source_id: str
    source_title: str
    publisher: str
    price_type: str
    region: str
    reference_date: str            # YYYY, YYYY-MM or YYYY-MM-DD
    date_granularity: str
    original_value: float | None
    original_unit: str
    currency: str = "CAD"
    normalized_value: float | None = None
    normalized_unit: str = "CAD/tonne"
    conversion_basis: str | None = None
    conversion_factor: float | None = None
    conversion_detail: str = ""
    record_origin: str = "observed"    # observed | derived | forecast
    source_commodity: str = ""
    variant: str | None = None
    grade: str | None = None
    market: str | None = None
    soil_zone: str | None = None
    year_status: str | None = None     # 'p' preliminary | 'r' revised | None final
    status_symbol: str | None = None   # raw StatCan STATUS / SYMBOL
    doc_file: str | None = None
    doc_page: int | None = None
    doc_table: str | None = None
    source_url: str | None = None
    licence: str | None = None
    retrieved_at: str | None = None
    raw_sha256: str | None = None
    raw_repr: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_quarantined(self) -> bool:
        return self.normalized_value is None


def make_observation_id(*parts: Any) -> str:
    """Stable id so re-runs overwrite rather than duplicate.

    Hashing the identity tuple means a re-run of the same source produces the same
    key, which lets ``validate`` diff two runs and lets the frontend cache forever.
    """
    joined = "|".join("" if p is None else str(p) for p in parts)
    return "px-" + hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def dump_json(payload: Any) -> str:
    """Canonical JSON: sorted keys, no incidental whitespace drift between runs."""
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
