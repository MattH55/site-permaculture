"""Observation schema and normalization safeguards for the v3 price layer.

This module is where §73 ("coverage without conflation") is enforced in code. The rules
it hard-fails on are exactly the ones a pipeline most often violates silently:

* §62 — a ``value``/``sales``/``amount`` field is never a price; an observation needs a
  price numerator AND a price unit/basis.
* §63 — aggregate sales values carry ``economic_value_available`` only; no $/lb is ever
  manufactured from them.
* §64 — trade unit values stay ``trade_unit_value`` forever (quality mix, freight,
  tariffs and currency effects are not stripped out).
* §65 — a price index has a base year, not a currency; it never enters
  ``normalized_price_value``.
* §35 — package prices are normalized only with a documented package weight.
* §36 — forms (fresh/dried/extract/...) are never merged.
* §50 — a source category that names a non-equivalent bucket ("specialty mushrooms" for
  shiitake) is rejected rather than silently attributed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any

from . import wide_source_scoring as SC

PARSER_VERSION = "3.0.0"

# §34 minimum field set, in output order (parquet/CSV writers use this as the schema).
OBSERVATION_FIELDS = (
    "observation_id", "crop_id", "canonical_crop", "source_id", "source_name",
    "organization", "country", "region", "market", "market_level", "price_type",
    "commodity_original", "variety", "cultivar", "form",
    "date", "year", "month", "week", "period", "period_type",
    "price_value", "price_low", "price_high", "price_mostly",
    "currency", "unit", "package", "package_weight",
    "normalized_price_value", "normalized_unit",
    "quantity", "quantity_unit", "origin", "destination",
    "source_url", "source_record_id", "source_page", "source_file",
    "retrieval_timestamp", "raw_file", "sha256",
    "source_authority_score", "match_confidence", "parser_version",
)


class ObservationError(ValueError):
    """Raised when an observation would violate a §62-65 / §35-36 / §50 safeguard."""


@dataclass(frozen=True)
class WidePriceObservation:
    """§34 observation record. Constructing one validates the safeguards above."""

    observation_id: str
    crop_id: str
    canonical_crop: str
    source_id: str
    source_name: str
    organization: str
    country: str
    price_type: str
    currency: str
    unit: str
    retrieval_timestamp: str
    source_url: str | None = None
    region: str | None = None
    market: str | None = None
    market_level: str | None = None
    commodity_original: str | None = None
    variety: str | None = None
    cultivar: str | None = None
    form: str | None = None
    date: str | None = None
    year: int | None = None
    month: int | None = None
    week: int | None = None
    period: str | None = None
    period_type: str | None = None
    price_value: float | None = None
    price_low: float | None = None
    price_high: float | None = None
    price_mostly: float | None = None
    package: str | None = None
    package_weight: float | None = None      # documented weight in `unit`'s basis
    normalized_price_value: float | None = None
    normalized_unit: str | None = None
    quantity: float | None = None
    quantity_unit: str | None = None
    origin: str | None = None
    destination: str | None = None
    source_record_id: str | None = None
    source_page: str | None = None
    source_file: str | None = None
    raw_file: str | None = None
    sha256: str | None = None
    source_authority_score: int = 0
    match_confidence: str = "medium"
    parser_version: str = PARSER_VERSION

    def __post_init__(self):
        if self.price_type not in SC.PRICE_TYPES:
            raise ObservationError(f"unknown price_type {self.price_type!r}")
        # §62: a currency-denominated price needs a value and a unit/basis.
        if SC.carries_unit_price(self.price_type):
            if self.price_value is None and self.price_mostly is None:
                raise ObservationError(
                    f"{self.price_type} observation without price_value/price_mostly "
                    f"(§62: a price requires a numerator)"
                )
            if not self.unit:
                raise ObservationError(
                    f"{self.price_type} observation without a price unit/basis (§62)"
                )
            if not self.currency:
                raise ObservationError("price observation without currency (§8)")
        # §65: an index is not a currency price.
        if self.price_type == "index" and self.normalized_price_value is not None:
            raise ObservationError(
                "index observations keep index_value/base_year, never "
                "normalized_price_value (§65)"
            )
        # §63: aggregate sales never becomes a normalized unit price.
        if self.price_type == "aggregate_sales_value" and \
                self.normalized_price_value is not None:
            raise ObservationError(
                "aggregate_sales_value must not be normalized to a unit price (§63)"
            )
        if self.match_confidence not in SC.MATCH_CONFIDENCE:
            raise ObservationError(
                f"match_confidence must be one of {list(SC.MATCH_CONFIDENCE)}"
            )

    @property
    def economic_value_available(self) -> bool:
        """§63: value evidence exists even when no unit price does."""
        return self.price_type == "aggregate_sales_value" and self.price_value is not None

    def to_row(self) -> dict[str, Any]:
        row = {f: getattr(self, f) for f in OBSERVATION_FIELDS}
        return row


# --------------------------------------------------------------------- §35 packages

def normalize_package_price(price: float, package: str | None,
                            package_weight: float | None,
                            weight_unit: str | None) -> tuple[float, str] | None:
    """§35: "$25 / 5 lb box" -> (5.0, "$/lb"); "$25 / bunch" -> None.

    The ONLY path to a per-weight figure is a documented package weight. A bunch, head,
    tray or flat without a published weight is returned unnormalized — the original
    observation keeps its package basis, and nothing is invented.
    """
    if package_weight is None or package_weight <= 0 or not weight_unit:
        return None
    return (price / package_weight, f"per {weight_unit}")


# --------------------------------------------------------------------- §50 guard

def assert_not_non_equivalent(commodity_original: str,
                              non_equivalents: tuple[str, ...] | list[str]) -> None:
    """§50: reject a source category the identity says is NOT this crop.

    "specialty mushrooms" is not shiitake; refusing the mapping loudly is the whole
    point — the alternative is a confidently wrong price series.
    """
    text = (commodity_original or "").strip().lower()
    for ne in non_equivalents:
        if text == ne.strip().lower():
            raise ObservationError(
                f"{commodity_original!r} is a declared non-equivalent for this crop (§50); "
                f"refusing to attribute the observation"
            )


# --------------------------------------------------------------------- §40 checksums

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------- §55 dedup

def dedup_key(obs: WidePriceObservation) -> tuple:
    """§55: deduplicate ONLY on same source + same record + same dimensions.

    Two independent sources reporting the same crop/date/price are NOT duplicates —
    that collision is corroboration, and this key deliberately excludes price.
    """
    return (
        obs.source_id, obs.source_record_id, obs.crop_id, obs.country,
        obs.market_level, obs.price_type, obs.form, obs.date, obs.period,
    )


# --------------------------------------------------------------------- §68/§69

def latest_observation(obs: list[WidePriceObservation]) -> WidePriceObservation | None:
    """§68: latest by OBSERVATION date, never by retrieval timestamp."""
    dated = [o for o in obs if o.date]
    if not dated:
        return None
    return max(dated, key=lambda o: o.date)


def history_stats(obs: list[WidePriceObservation]) -> dict[str, Any]:
    """§69: coverage stats. ``missing_periods`` is None unless a frequency is known —
    a gap count is only meaningful against an expected calendar, and inventing one is
    exactly the kind of quiet assumption this pipeline exists to avoid.
    """
    dated = sorted(o.date for o in obs if o.date)
    return {
        "coverage_start": dated[0] if dated else None,
        "coverage_end": dated[-1] if dated else None,
        "n_observations": len(obs),
        "frequency": None,
        "missing_periods": None,
    }


# --------------------------------------------------------------------- §70 outliers

def flag_outliers(obs: list[WidePriceObservation],
                  iqr_factor: float = 3.0) -> dict[str, bool]:
    """§70: flag possible outliers (IQR x factor) — never delete them.

    Returns ``{observation_id: possible_outlier}``. The factor is 3.0 ("extreme") rather
    than 1.5 because legitimate specialty-crop prices are highly dispersed; flagging
    ordinary dispersion would train users to ignore the flag.
    """
    vals = [o.price_value for o in obs
            if o.price_value is not None and SC.carries_unit_price(o.price_type)]
    out = {o.observation_id: False for o in obs}
    if len(vals) < 4:
        return out
    s = sorted(vals)
    q1, q3 = s[len(s) // 4], s[(3 * len(s)) // 4]
    iqr = q3 - q1
    lo, hi = q1 - iqr_factor * iqr, q3 + iqr_factor * iqr
    for o in obs:
        if o.price_value is not None and (o.price_value < lo or o.price_value > hi):
            out[o.observation_id] = True
    return out

