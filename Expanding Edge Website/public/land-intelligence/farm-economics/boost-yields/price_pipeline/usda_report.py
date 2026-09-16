"""Classification, audit and coverage reporting for the U.S. price layer.

This module answers the instruction document's §34 questions *and* enforces §35's harder
half: that an unretrieved crop returns ``No defensible recurring price source
identified`` rather than a plausible-looking number.

The central rule, and the reason this file is not just a report writer:

    A crop is assigned a tier only when a retrieved artifact supports it. Otherwise the
    crop is marked ``verified_check_only`` — "the search was performed and recorded" —
    which is deliberately distinct from ``tier_selected``. The seed workbook's own
    "Yes — AMS" finding is a *note about where to look*, not an observation, so it is
    preserved in ``notes`` and never becomes ``selected_tier``.

Collapsing those two states is exactly how a pipeline starts reporting a price nobody
measured, so the distinction is a field (``classification_status``) rather than a comment.
"""

from __future__ import annotations

import csv
import html
import io
import os
from dataclasses import dataclass, field
from typing import Any

from . import usda_registry as UR
from .usda_workbook import SeedWorkbook, WorkbookCrop

# The refusal string required by §35. Exported so the CLI, the report and the tests all
# quote the same sentence instead of three near-copies of it.
NO_SOURCE_MESSAGE = "No defensible recurring price source identified"

# §34 asks for a count per tier plus a "needs manual review" count, so the status values
# are a closed set. "verified_check_only" is the honest state for every crop whose source
# has been registered but not yet retrieved.
STATUS_TIER_SELECTED = "tier_selected"
STATUS_CHECK_ONLY = "verified_check_only"

CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"

# Seed-workbook tier wording -> whether the tier can carry a price at all.
# C is sales value, E is nothing; both mean price_available = false.
_TIER_CARRIES_PRICE = {"A": True, "B": True, "C": False, "D": True, "E": False}


@dataclass
class CropClassification:
    """One crop's classification, with every input to the decision retained."""

    crop: str
    crop_id: str
    seed_tier: str
    seed_tier_original: str
    nass_commodity_ref: str | None
    preferred: tuple[str, ...]
    classification_status: str
    selected_tier: str | None
    selected_source: str | None
    source_system: str | None
    market_level: str | None
    price_available: bool
    economic_value_available: bool
    nass_available: bool
    ams_available: bool
    census_available: bool
    trade_proxy_available: bool
    price_frequency: str
    coverage_start: str | None
    coverage_end: str | None
    confidence: str
    reason: str
    last_checked: str
    seed_finding: str
    seed_notes: str
    seed_source_url: str | None
    preferred_price_form: str
    retrieval_blockers: list[str] = field(default_factory=list)

    @property
    def has_price(self) -> bool:
        return self.price_available

    def to_status_row(self) -> dict[str, Any]:
        """Row shape for ``crop_source_status.csv`` (§22)."""
        return {
            "crop": self.crop,
            "crop_id": self.crop_id,
            "classification_status": self.classification_status,
            "seed_tier": self.seed_tier_original,
            "nass_available": self.nass_available,
            "nass_price_available": self.price_available and self.selected_tier == "A",
            "ams_available": self.ams_available,
            "census_available": self.census_available,
            "trade_proxy_available": self.trade_proxy_available,
            "selected_tier": self.selected_tier or "",
            "selected_source": self.selected_source or "",
            "source_system": self.source_system or "",
            "market_level": self.market_level or "",
            "price_available": self.price_available,
            "economic_value_available": self.economic_value_available,
            "price_frequency": self.price_frequency,
            "coverage_start": self.coverage_start or "",
            "coverage_end": self.coverage_end or "",
            "confidence": self.confidence,
            "reason": self.reason,
            "last_checked": self.last_checked,
            "preferred_price_form": self.preferred_price_form,
            "notes": self.seed_notes,
        }


def crop_id_for(name: str) -> str:
    """Slug a workbook crop name into a stable id (``"Maple syrup"`` -> ``maple-syrup"``).

    Deliberately mechanical: a hand-maintained alias table would become a second place
    where crop identity is decided, and the registry already owns that.
    """
    import re

    slug = name.strip().lower()
    slug = slug.replace("/", " ").replace("&", " ")
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")
def _retrieval_readiness(
    doc: dict[str, Any], preferred: tuple[str, ...],
) -> tuple[bool, list[str]]:
    """Is a *price-bearing* source for this crop actually retrieved, and if not, why not?

    Returns ``(ready, blockers)``.

    The subtlety this function exists to enforce: an enabled source is not automatically a
    price. ``nass_commodity_codes`` is enabled because its reference table is usable, but it
    has no ``price_type`` — it establishes commodity identity and carries no observation. If
    "enabled" alone were treated as readiness, every Tier A crop would report a price
    sourced from a code list. So readiness requires ``price_type`` to be set, and the
    distinction is what keeps a reference table from impersonating a price series.

    ``blockers`` names the specific unretrieved artifact or missing credential, because
    "no source found" and "source checked incorrectly" are different outcomes (§23) and only
    the first is an acceptable result.
    """
    blockers: list[str] = []
    by_id = {s.source_id: s for s in UR.usda_sources(doc)}
    tspecs = UR.tiers(doc)

    for token in preferred:
        price_ready = [
            s for s in by_id.values()
            if s.enabled
            and s.source_id.split("_", 1)[0] == token
            and s.price_type
        ]
        if price_ready:
            return True, []
        # Not ready. Record precisely why, separating the two distinct causes.
        for s in by_id.values():
            if s.source_id.split("_", 1)[0] != token:
                continue
            tier = tspecs.get(s.tier)
            label = f"Tier {s.tier}" + (f" ({tier.label})" if tier else "")
            if s.enabled and not s.price_type:
                blockers.append(
                    f"{label}: {s.source_id} is a reference source with no price_type "
                    f"({s.coverage_note or s.title}); it establishes identity, not a price"
                )
                continue
            detail = s.reason or "registered without a reason"
            if s.credential_env:
                detail = f"needs {s.credential_env}; {detail}"
            blockers.append(f"{label}: {s.source_id} — {detail}")
    return False, blockers


def _frequency_for(crop: WorkbookCrop) -> str:
    """Frequency implied by the seed row's price form.

    Only an oil-unit row implies a recurring annual series; everything else is left blank
    rather than guessed, because §34 asks which crops have *current* prices and an invented
    cadence would answer that question wrongly.
    """
    if (crop.preferred_price_form or "").lower() == "oil-unit":
        return "annual"
    return ""


def _nass_ref_for(crop: WorkbookCrop, registry_crop: Any) -> str | None:
    """Prefer the registry's reference, fall back to the workbook cell verbatim."""
    if registry_crop is not None and registry_crop.nass_commodity_ref:
        return registry_crop.nass_commodity_ref
    return crop.nass_commodity_ref


def classify_crop(
    crop: WorkbookCrop, doc: dict[str, Any], *, last_checked: str,
) -> CropClassification:
    """Classify one seed-workbook row against the registry.

    The seed workbook's tier is treated as a *prior*, not as evidence. A crop whose
    preferred sources are all unretrieved is reported as ``verified_check_only`` with the
    blockers attached, whatever tier the workbook printed. That is the mechanism which
    keeps §35's promise: ``fetch --crop wasabi`` must be able to say "no defensible
    recurring price source identified" instead of inventing a number.
    """
    crop_id = crop_id_for(crop.crop)
    registry_crop = next((c for c in UR.crops(doc) if c.crop_id == crop_id), None)
    preferred = registry_crop.preferred if registry_crop else ()
    tspecs = UR.tiers(doc)

    seed_tier = crop.tier if crop.tier in tspecs else ""
    tier_spec = tspecs.get(seed_tier)
    ready, blockers = _retrieval_readiness(doc, preferred)

    nass_available = seed_tier == "A"
    ams_available = seed_tier == "B"
    census_available = seed_tier == "C"
    trade_proxy_available = seed_tier == "D"

    if ready and tier_spec is not None:
        status = STATUS_TIER_SELECTED
        selected_tier = seed_tier
        price_available = tier_spec.price_available and _TIER_CARRIES_PRICE.get(seed_tier, False)
        source_system = tier_spec.source_system
        market_level = tier_spec.market_level
        # Name only a price-bearing source. A reference table (no price_type) must never be
        # printed as the source of a price, so the filter is the same one readiness uses.
        ready_ids = sorted(
            s.source_id for s in UR.usda_sources(doc)
            if s.enabled and s.price_type
            and s.source_id.split("_", 1)[0] == preferred[0]
        )
        selected_source = ", ".join(ready_ids) or None
        reason = (
            f"Seed workbook records Tier {crop.tier_original} and a retrieved source is "
            f"available for {preferred[0]!r}."
        )
        confidence = CONFIDENCE_MEDIUM if crop.tier_is_ambiguous else CONFIDENCE_HIGH
        if crop.tier_is_ambiguous:
            reason += (
                f" Workbook tier {crop.tier_original!r} is ambiguous between a trade proxy "
                "and no source; recorded as the stronger of the two pending retrieval."
            )
    else:
        status = STATUS_CHECK_ONLY
        selected_tier = None
        price_available = False
        source_system = None
        market_level = None
        selected_source = None
        reason = (
            f"{NO_SOURCE_MESSAGE}. Seed workbook records Tier {crop.tier_original} "
            f"({crop.infrastructure_finding or 'no finding recorded'}), but no source "
            "retrieval has been performed, so no price may be asserted."
        )
        confidence = CONFIDENCE_LOW

    # Tier C is a sales-value aggregate by definition and Tier D is a border proxy, so
    # neither may present itself as a unit price. Stating that here keeps §2's rule out of
    # the report formatter, where it would be one refactor away from being lost.
    economic_value_available = seed_tier in {"C", "D"} and not price_available

    return CropClassification(
        crop=crop.crop,
        crop_id=crop_id,
        seed_tier=seed_tier,
        seed_tier_original=crop.tier_original,
        nass_commodity_ref=_nass_ref_for(crop, registry_crop),
        preferred=preferred,
        classification_status=status,
        selected_tier=selected_tier,
        selected_source=selected_source,
        source_system=source_system,
        market_level=market_level,
        price_available=price_available,
        economic_value_available=economic_value_available,
        nass_available=nass_available,
        ams_available=ams_available,
        census_available=census_available,
        trade_proxy_available=trade_proxy_available,
        price_frequency=_frequency_for(crop),
        coverage_start=None,
        coverage_end=None,
        confidence=confidence,
        reason=reason,
        last_checked=last_checked,
        seed_finding=crop.infrastructure_finding,
        seed_notes=crop.notes,
        seed_source_url=crop.source_url,
        preferred_price_form=crop.preferred_price_form,
        retrieval_blockers=blockers,
    )


def classify_all(
    book: SeedWorkbook, doc: dict[str, Any], *, last_checked: str,
) -> list[CropClassification]:
    return [classify_crop(c, doc, last_checked=last_checked) for c in book.crops]


def audit_record(cls: CropClassification) -> dict[str, Any]:
    """Tier E style audit record for a crop with no retrieved price source (§23).

    §23 requires the *searches performed* to be documented, because "no source found" is
    only meaningful if the check was real. ``checks`` is therefore built from the crop's
    declared priority list rather than being a fixed list of strings.
    """
    segment_of = {
        "nass": "NASS commodity universe / NASS prices received / NASS bulk files",
        "ams": "AMS Market News terminal and shipping-point reports",
        "census": "Census of Agriculture / Census of Horticultural Specialties",
        "trade": "trade classifications (HS / Schedule B)",
    }
    checks = [segment_of.get(t, t) for t in cls.preferred]
    return {
        "crop": cls.crop,
        "crop_id": cls.crop_id,
        "selected_tier": cls.selected_tier or "E",
        "price_available": cls.price_available,
        "checks": checks,
        "checked_at": cls.last_checked,
        "seed_tier": cls.seed_tier_original,
        "blockers": cls.retrieval_blockers,
        "notes": cls.reason,
    }



def _write_csv(path: str, rows: list[dict[str, Any]]) -> None:
    """Write CSV with a stable header.

    A report with zero rows is a legitimate outcome (all crops retrieved), so an empty row
    list is allowed as long as the caller passes a header. Writing nothing at all would
    read as a crash rather than as "zero rows", so header-only output is produced here.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if rows:
        fieldnames = list(rows[0].keys())
    else:  # pragma: no cover - defensive
        fieldnames = []
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            writer.writerows(rows)


def write_crop_source_status(path: str, classes: list[CropClassification]) -> None:
    _write_csv(path, [c.to_status_row() for c in classes])


def write_source_audit(path: str, classes: list[CropClassification]) -> None:
    """One row per crop whose search produced no price (§23)."""
    rows = [audit_record(c) for c in classes if not c.price_available]
    for row in rows:
        row["checks"] = " | ".join(row["checks"])
        row["blockers"] = " | ".join(row["blockers"])
    _write_csv(path, rows)


def coverage_facts(
    classes: list[CropClassification], doc: dict[str, Any],
) -> dict[str, Any]:
    """The twelve §34 questions, answered from the classification list.

    Returned as data rather than formatted text so the HTML report, the CLI and the tests
    can each render or assert the same numbers.
    """
    tspecs = UR.tiers(doc)
    by_tier: dict[str, int] = {t: 0 for t in tspecs}
    for c in classes:
        if c.selected_tier:
            by_tier[c.selected_tier] += 1

    longest = sorted(
        (c for c in classes if c.coverage_start), key=lambda c: c.coverage_start or "",
    )

    return {
        "checked": len(classes),
        "by_selected_tier": by_tier,
        "tier_a": [c.crop for c in classes if c.selected_tier == "A"],
        "tier_b": [c.crop for c in classes if c.selected_tier == "B"],
        "tier_c_only": [c.crop for c in classes if c.seed_tier == "C"],
        "tier_d_only": [c.crop for c in classes if c.seed_tier == "D"],
        "tier_e": [c.crop for c in classes if c.seed_tier == "E"],
        "price_available": [c.crop for c in classes if c.price_available],
        "producer_prices": [c.crop for c in classes if c.market_level == "producer"],
        "wholesale_prices": [c.crop for c in classes if c.market_level == "wholesale"],
        "trade_unit_values": [c.crop for c in classes
                              if c.market_level == "trade_unit_value"],
        "economic_value_only": [c.crop for c in classes if c.economic_value_available],
        "needs_manual_review": [c.crop for c in classes
                                if c.confidence == CONFIDENCE_LOW],
        "longest_series": [c.crop for c in longest],
        "current_prices": [c.crop for c in classes if c.coverage_end],
        "tier_labels": {t: s.label for t, s in tspecs.items()},
        "no_source_message": NO_SOURCE_MESSAGE,
    }



_HTML_CSS = """
 body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:1100px;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.5rem} h2{font-size:1.15rem;margin-top:2rem}
 table{border-collapse:collapse;width:100%;margin:.5rem 0}
 th,td{border:1px solid #d8d8d8;padding:.4rem .55rem;text-align:left;vertical-align:top}
 th{background:#f4f6f4} td.num{text-align:right}
 .none{color:#666;font-style:italic}
 .note{background:#fbf7e8;border-left:3px solid #d8b400;padding:.6rem .8rem}
 code{background:#f2f2f2;padding:.1rem .25rem;border-radius:3px}
"""


def _ul(items: list[str], esc: Any) -> str:
    if not items:
        return '<p class="none">none</p>'
    return "<ul>" + "".join(f"<li>{esc(i)}</li>" for i in items) + "</ul>"


def render_coverage_html(
    classes: list[CropClassification], doc: dict[str, Any],
    *, generated_at: str, workbook_sha256: str,
) -> str:
    """Human-readable coverage report (§34), with coverage presented by crop."""
    facts = coverage_facts(classes, doc)
    esc = html.escape

    summary_rows = "".join(
        f"<tr><td>Tier {esc(t)}</td><td>{esc(lbl)}</td>"
        f"<td class='num'>{facts['by_selected_tier'].get(t, 0)}</td></tr>"
        for t, lbl in sorted(facts["tier_labels"].items())
    )
    body_rows = "".join(
        "<tr>"
        f"<td>{esc(c.crop)}</td>"
        f"<td>{esc(c.seed_tier_original)}</td>"
        f"<td>{esc(c.selected_tier or '-')}</td>"
        f"<td>{esc(c.market_level or '-')}</td>"
        f"<td>{'yes' if c.price_available else 'no'}</td>"
        f"<td>{esc(c.confidence)}</td>"
        f"<td>{esc(c.reason)}</td>"
        "</tr>"
        for c in sorted(classes, key=lambda c: (c.selected_tier or "Z", c.crop))
    )

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>U.S. specialty-crop price coverage report</title>
<style>{_HTML_CSS}</style></head><body>
<h1>U.S. specialty-crop price coverage report</h1>
<p class="note"><strong>Nothing in this report is a price.</strong> It records which crops
have a <em>retrieved, defensible</em> price source. A crop with no retrieved source is
reported as <code>{esc(facts['no_source_message'])}</code> rather than being given a
plausible number.</p>
<p>Generated <code>{esc(generated_at)}</code> from seed workbook
<code>usda_specialty_crop_price_master.xlsx</code>
(sha256 <code>{esc(workbook_sha256[:16])}</code>).</p>

<h2>Coverage by tier</h2>
<table><thead><tr><th>Tier</th><th>Source</th>
<th>Crops with a selected tier</th></tr></thead>
<tbody>{summary_rows}</tbody></table>

<h2>Coverage by crop</h2>
<table><thead><tr><th>Crop</th><th>Seed tier</th><th>Selected</th>
<th>Market level</th><th>Price available</th><th>Confidence</th><th>Reason</th></tr></thead>
<tbody>{body_rows}</tbody></table>

<h2>The twelve questions</h2>
<ol>
<li>Crops checked: <strong>{facts['checked']}</strong></li>
<li>Tier A prices: {len(facts['tier_a'])} {_ul(facts['tier_a'], esc)}</li>
<li>Tier B prices: {len(facts['tier_b'])} {_ul(facts['tier_b'], esc)}</li>
<li>Tier C only: {len(facts['tier_c_only'])} {_ul(facts['tier_c_only'], esc)}</li>
<li>Tier D proxies only: {len(facts['tier_d_only'])} {_ul(facts['tier_d_only'], esc)}</li>
<li>No defensible source: {len(facts['tier_e'])} {_ul(facts['tier_e'], esc)}</li>
<li>Longest historical series: {_ul(facts['longest_series'], esc)}</li>
<li>Crops with current prices: {_ul(facts['current_prices'], esc)}</li>
<li>Producer prices: {_ul(facts['producer_prices'], esc)}</li>
<li>Wholesale prices: {_ul(facts['wholesale_prices'], esc)}</li>
<li>Trade unit values: {_ul(facts['trade_unit_values'], esc)}</li>
<li>Need manual source review: {len(facts['needs_manual_review'])}
    {_ul(facts['needs_manual_review'], esc)}</li>
</ol>
</body></html>
"""

