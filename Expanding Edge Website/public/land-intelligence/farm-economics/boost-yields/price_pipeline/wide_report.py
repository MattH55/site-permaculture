"""Classification, audit and coverage rollups for the wide (v2) price layer.

v2 §1.6 reframes the success signal: with a wide seed list, the primary output is
*coverage classification* — an honest spread of tiers across many crops and two countries —
not a count of retrieved prices. So this module's job is to say, for every crop and every
targeted country, "what was checked, and what defensible tier did the check support",
without ever letting a search-order hint or a proxy masquerade as a measured price.

Three v1 disciplines carry over unchanged, because they are the ones a wide pipeline fails
expensively by relaxing:

* A tier is assigned only when a retrieved artifact supports it. Until then a crop-country
  pair is ``checked_no_source`` — "the search was performed and recorded".
* A reference table, a census sales value, or a border unit value is *evidence about a
  market*, never a producer price. ``price_available`` stays false for Tier C and E.
* §35's refusal sentence is quoted verbatim from :mod:`usda_report` so the wide layer and
  the U.S. layer refuse in the same words.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from . import usda_report as R          # reuse §35 refusal string and status vocabulary
from . import wide_registry as WR
from .wide_seed import SeedCrop, SeedList

NO_SOURCE_MESSAGE = R.NO_SOURCE_MESSAGE

# A crop-country classification state. "checked_no_source" is the honest state for every
# pair whose sources have been registered but not yet retrieved; it is deliberately distinct
# from "tier_selected", exactly as v1 distinguished "verified_check_only" from "tier_selected".
STATUS_TIER_SELECTED = R.STATUS_TIER_SELECTED
STATUS_CHECK_ONLY = R.STATUS_CHECK_ONLY

# Country -> ISO 4217 currency. Stored alongside the price, never converted (v2 §1.2).
COUNTRY_CURRENCY = {"US": "USD", "CA": "CAD"}


@dataclass
class WideClassification:
    """One crop's classification *in one country*, with every input retained.

    A crop targeted at both countries yields two of these rows in ``crop_source_status`` —
    they are different markets with different currencies, not competing estimates of one
    number (v2 §1.3).
    """

    crop: str
    crop_group: str
    source_country: str
    currency: str
    classification_status: str
    selected_tier: str | None
    market_level: str | None
    price_available: bool
    economic_value_available: bool
    confidence: str
    reason: str
    last_checked: str
    preferred: tuple[str, ...]
    known_tier_hint: str | None      # provenance only; never feeds selected_tier
    nass_special_survey: str | None
    seed_notes: str
    searches_performed: list[str] = field(default_factory=list)
    retrieval_blockers: list[str] = field(default_factory=list)

    @property
    def has_price(self) -> bool:
        return self.price_available

    def to_status_row(self) -> dict[str, Any]:
        """Row shape for ``crop_source_status.csv`` (v2 §2.1 / Part 6)."""
        return {
            "crop": self.crop,
            "crop_group": self.crop_group,
            "source_country": self.source_country,
            "currency": self.currency,
            "classification_status": self.classification_status,
            "selected_tier": self.selected_tier or "",
            "market_level": self.market_level or "",
            "price_available": self.price_available,
            "economic_value_available": self.economic_value_available,
            "confidence": self.confidence,
            "reason": self.reason,
            "last_checked": self.last_checked,
            "preferred": ";".join(self.preferred),
            "nass_special_survey": self.nass_special_survey or "",
            "notes": self.seed_notes,
        }

    def to_audit_row(self) -> dict[str, Any]:
        """Row shape for ``source_audit.csv`` — what was actually checked, and what blocked it."""
        return {
            "crop": self.crop,
            "crop_group": self.crop_group,
            "source_country": self.source_country,
            "preferred": ";".join(self.preferred),
            "searches_performed": ";".join(self.searches_performed),
            "selected_tier": self.selected_tier or "",
            "classification_status": self.classification_status,
            "retrieval_blockers": ";".join(self.retrieval_blockers),
            "last_checked": self.last_checked,
        }


def _searches_performed(pref: WR.CropPreference, country: str,
                        families: dict[str, WR.SourceFamily]) -> list[str]:
    """The discovery steps that would be (and were) run for this crop in this country.

    Recorded even when nothing was retrieved, because a Tier E claim is only defensible if
    the audit trail shows what was checked (v2 Part 5 / v1 §23).
    """
    searches: list[str] = []
    for fam_name in pref.preferred:
        fam = families.get(fam_name)
        if fam is None:
            continue
        if fam.country != country:
            continue
        searches.append(f"{fam_name} (tier {fam.tier}, {fam.market_level})")
    return searches


def classify_crop_country(
    crop: SeedCrop,
    country: str,
    pref: WR.CropPreference,
    doc: dict[str, Any],
    *,
    last_checked: str,
    retrieved: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> WideClassification:
    """Classify one crop in one country.

    ``retrieved`` maps ``(crop, country)`` to a discovery result. When absent/empty the
    pair is honestly ``checked_no_source`` — the search order is recorded, but no tier is
    asserted. This is the wide analogue of v1's rule that the seed workbook's "Yes — AMS"
    finding is a note about where to look, not an observation.
    """
    families = WR.source_families(doc)
    currency = COUNTRY_CURRENCY[country]
    searches = _searches_performed(pref, country, families)

    # Sources relevant to this country, in search order. A crop whose preferred families are
    # all in the OTHER country has nothing to check here — an expected, reportable gap.
    country_families = [
        f for f in (families.get(n) for n in pref.preferred)
        if f is not None and f.country == country
    ]

    result = (retrieved or {}).get((crop.crop, country))
    blockers: list[str] = []
    if not country_families:
        blockers.append(
            f"no {country} source family in search order "
            f"{list(pref.preferred) or '[]'}"
        )

    if result is None:
        # Nothing retrieved. The honest classification: checked, no defensible source yet.
        if country_families:
            reason = (
                f"{country} sources registered ({', '.join(n for n in pref.preferred if n in families and families[n].country == country)}) "
                f"but not yet retrieved; tier requires a retrieved artifact"
            )
        else:
            reason = (
                f"no {country} source identified for this crop; "
                f"asymmetric coverage is expected (v2 §1.3), not a gap to fill by invention"
            )
        return WideClassification(
            crop=crop.crop,
            crop_group=crop.crop_group,
            source_country=country,
            currency=currency,
            classification_status=STATUS_CHECK_ONLY,
            selected_tier=None,
            market_level=None,
            price_available=False,
            economic_value_available=False,
            confidence=R.CONFIDENCE_LOW if country_families else R.CONFIDENCE_MEDIUM,
            reason=reason,
            last_checked=last_checked,
            preferred=pref.preferred,
            known_tier_hint=crop.known_tier_hint,
            nass_special_survey=pref.nass_special_survey,
            seed_notes=crop.notes,
            searches_performed=searches,
            retrieval_blockers=blockers,
        )

    # A retrieved artifact exists. Select the strongest tier it supports, honoring B2.
    tier = str(result.get("tier") or "").strip()
    if tier not in WR.TIER_ORDER:
        raise ValueError(f"retrieved result for {crop.crop}/{country} has bad tier {tier!r}")
    market_level = result.get("market_level") or (
        families[result["family"]].market_level if result.get("family") in families else None
    )
    confidence = result.get("confidence") or (
        WR.tier_b2_confidence(doc).default if tier == "B2" else R.CONFIDENCE_HIGH
    )
    return WideClassification(
        crop=crop.crop,
        crop_group=crop.crop_group,
        source_country=country,
        currency=currency,
        classification_status=STATUS_TIER_SELECTED,
        selected_tier=tier,
        market_level=market_level,
        price_available=WR.TIER_CARRIES_PRICE[tier],
        economic_value_available=(tier == "C"),
        confidence=confidence,
        reason=result.get("reason") or f"retrieved from {result.get('family', 'unknown')}",
        last_checked=last_checked,
        preferred=pref.preferred,
        known_tier_hint=crop.known_tier_hint,
        nass_special_survey=pref.nass_special_survey,
        seed_notes=crop.notes,
        searches_performed=searches,
        retrieval_blockers=blockers,
    )


def classify_seed_list(
    seed: SeedList,
    doc: dict[str, Any],
    *,
    last_checked: str,
    retrieved: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> list[WideClassification]:
    """Classify every crop against every country it targets (one row per pair)."""
    out: list[WideClassification] = []
    for crop in seed.crops:
        pref = WR.preferred_for(doc, crop.crop, crop.crop_group)
        for country in crop.target_countries:
            out.append(classify_crop_country(
                crop, country, pref, doc,
                last_checked=last_checked, retrieved=retrieved,
            ))
    return out


# --------------------------------------------------------------------- coverage rollups

def _tier_histogram(classes: list[WideClassification]) -> dict[str, int]:
    """Count of *tier-selected* rows per tier, in preference order.

    Checked-but-unclassified rows are reported separately as ``unclassified`` so a high
    aggregate "X% have some source" can never hide a distribution that is mostly E (§1.6).
    """
    hist: dict[str, int] = {t: 0 for t in WR.TIER_ORDER}
    hist["unclassified"] = 0
    for c in classes:
        if c.selected_tier:
            hist[c.selected_tier] += 1
        else:
            hist["unclassified"] += 1
    return hist


def coverage_by_group(classes: list[WideClassification]) -> list[dict[str, Any]]:
    """Rollup #1 (v2 §1.6): coverage by crop_group, with a tier histogram per group.

    Also emits the §20 anti-overclaim flag: a group reporting 100% Tier A is a signal to
    re-check that discovery was not too permissive (e.g. silently matching a group-level
    series to every crop), not evidence of unusually good luck.
    """
    groups: dict[str, list[WideClassification]] = {}
    for c in classes:
        groups.setdefault(c.crop_group, []).append(c)
    rows: list[dict[str, Any]] = []
    for group in sorted(groups):
        members = groups[group]
        hist = _tier_histogram(members)
        classified = [m for m in members if m.selected_tier]
        all_a = bool(classified) and all(m.selected_tier == "A" for m in classified)
        rows.append({
            "crop_group": group,
            "crops": len({m.crop for m in members}),
            "rows": len(members),
            **{f"tier_{t}": hist[t] for t in WR.TIER_ORDER},
            "unclassified": hist["unclassified"],
            "price_available": sum(1 for m in members if m.price_available),
            "flag_full_tier_a": all_a,   # §20: spot-check, don't celebrate
        })
    return rows


def coverage_by_country(classes: list[WideClassification]) -> list[dict[str, Any]]:
    """Rollup #2 (v2 §1.6): coverage by country, with a tier histogram per country."""
    countries: dict[str, list[WideClassification]] = {}
    for c in classes:
        countries.setdefault(c.source_country, []).append(c)
    rows: list[dict[str, Any]] = []
    for country in sorted(countries):
        members = countries[country]
        hist = _tier_histogram(members)
        rows.append({
            "source_country": country,
            "crops": len({m.crop for m in members}),
            "rows": len(members),
            **{f"tier_{t}": hist[t] for t in WR.TIER_ORDER},
            "unclassified": hist["unclassified"],
            "tier_c_or_better": sum(
                1 for m in members
                if m.selected_tier in ("A", "B", "B2", "C")
            ),
            "price_available": sum(1 for m in members if m.price_available),
        })
    return rows


# --------------------------------------------------------------------- writers

def _write_csv(path: str, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    import csv
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_crop_source_status(path: str, classes: list[WideClassification]) -> None:
    fields = [
        "crop", "crop_group", "source_country", "currency", "classification_status",
        "selected_tier", "market_level", "price_available", "economic_value_available",
        "confidence", "reason", "last_checked", "preferred", "nass_special_survey", "notes",
    ]
    _write_csv(path, [c.to_status_row() for c in classes], fields)


def write_source_audit(path: str, classes: list[WideClassification]) -> None:
    fields = [
        "crop", "crop_group", "source_country", "preferred", "searches_performed",
        "selected_tier", "classification_status", "retrieval_blockers", "last_checked",
    ]
    _write_csv(path, [c.to_audit_row() for c in classes], fields)


def write_coverage_by_group(path: str, classes: list[WideClassification]) -> None:
    rows = coverage_by_group(classes)
    fields = (
        ["crop_group", "crops", "rows"]
        + [f"tier_{t}" for t in WR.TIER_ORDER]
        + ["unclassified", "price_available", "flag_full_tier_a"]
    )
    _write_csv(path, rows, fields)


def write_coverage_by_country(path: str, classes: list[WideClassification]) -> None:
    rows = coverage_by_country(classes)
    fields = (
        ["source_country", "crops", "rows"]
        + [f"tier_{t}" for t in WR.TIER_ORDER]
        + ["unclassified", "tier_c_or_better", "price_available"]
    )
    _write_csv(path, rows, fields)

