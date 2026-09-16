"""Source-discovery engine for the v3 price layer (§28, §29, §43-49).

The engine is deliberately offline and deterministic in this build: it matches each crop's
identity record against the master source catalog (§30) and records *where price data
credibly exists*, with what access state, under which price concept. Nothing is fetched;
a match is a defensible place to look, not a retrieved price.

Two disciplines define the module:

* §2 — the status vocabulary distinguishes "no source found after a comprehensive search"
  (``searched_no_match``) from "not searched" (``not_yet_searched``). Because this build's
  search universe is the catalog, a crop-country with no catalog candidate is honestly
  ``not_yet_searched``, never ``searched_no_match`` and never Tier E.
* §45 — an access problem (``requires_key``, ``requires_auth``, ``manual_only``) is
  recorded as ``source_found=true, price_retrieved=false``; it must never collapse into
  "no source".
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from . import wide_crop_identity as ID
from . import wide_source_scoring as SC
from .wide_source_catalog import CatalogSource, WideSourceCatalog

# §42 access states that block retrieval even though the source is found (§45).
_ACCESS_BLOCKED = {"requires_key", "requires_auth", "blocked", "temporarily_unavailable"}

# §44 matrix short codes for source classes.
CLASS_CODES = {
    "GOVERNMENT_STATISTICS": "GS", "GOVERNMENT_MARKET_NEWS": "GMN",
    "GOVERNMENT_TRADE": "GT", "PRODUCER_ORGANIZATION": "PO",
    "AUCTION_MARKET": "AM", "WHOLESALE_MARKET": "WM",
    "RETAIL_DATA": "RD", "EXCHANGE": "EX", "UNIVERSITY_EXTENSION": "UE",
    "INDUSTRY_DATA": "ID", "COMMERCIAL_DATA": "CD", "OTHER": "OT",
}


@dataclass(frozen=True)
class CandidateSource:
    """§28 discovery output: one crop x country x catalog source."""

    crop_id: str
    country: str
    source_id: str
    source_name: str
    organization: str
    source_class: str
    price_type: str
    market_level: str | None
    match_method: str                  # catalog_crop_match | catalog_group_match
    match_confidence: str              # §32 high|medium|low
    status: str                        # §2 closed vocabulary
    access_status: str                 # §42 closed vocabulary
    authority: int                     # §31
    frequency: str
    historical_available: bool
    data_url: str | None
    source_url: str | None
    currency: str
    retrieval_blockers: tuple[str, ...] = ()

    def to_row(self) -> dict[str, object]:
        """Row shape for ``wide_crop_source_map.csv`` (§56)."""
        return {
            "crop_id": self.crop_id, "country": self.country,
            "source_id": self.source_id, "source_name": self.source_name,
            "source_class": self.source_class, "price_type": self.price_type,
            "market_level": self.market_level or "",
            "match_method": self.match_method,
            "match_confidence": self.match_confidence,
            "status": self.status, "access_status": self.access_status,
            "source_authority_score": self.authority,
            "frequency": self.frequency,
            "historical_available": self.historical_available,
            "data_url": self.data_url or "", "source_url": self.source_url or "",
            "currency": self.currency,
            "retrieval_blockers": " | ".join(self.retrieval_blockers),
        }


def _status_for(source: CatalogSource, env: dict[str, str]) -> str:
    """§2 status for a catalog match in this build (nothing fetched yet).

    Access-blocked sources are ``access_blocked`` (§45) — with one refinement: a
    ``requires_key`` source whose key IS present in ``env`` is not currently blocked,
    so it reports ``source_found_not_price`` like any other unretrieved source. The
    block is a property of this run's access, not of the source itself.
    ``price_found`` is unreachable here by construction.
    """
    if source.access_status == "requires_key":
        if not env.get(source.env_key or ""):
            return "access_blocked"
        return "source_found_not_price"
    if source.access_status in _ACCESS_BLOCKED:
        return "access_blocked"
    return "source_found_not_price"


def _blockers_for(source: CatalogSource, env: dict[str, str]) -> list[str]:
    out: list[str] = []
    if source.access_status == "requires_key":
        key = source.env_key or "API_KEY"
        if not env.get(key):
            out.append(f"environment variable {key} not set")
    elif source.access_status == "requires_auth":
        out.append("requires account authorization")
    elif source.access_status == "manual_only":
        out.append("no machine endpoint cataloged; manual retrieval required")
    elif source.access_status == "disabled":
        out.append("parser not implemented in this build")
    elif source.access_status in {"blocked", "temporarily_unavailable", "deprecated"}:
        out.append(f"access_status={source.access_status}")
    if source.price_type == "aggregate_sales_value":
        out.append("value-only series: economic value, not a per-unit price (§63)")
    return out


def _match(source: CatalogSource, crop: str, crop_group: str) -> tuple[str, str] | None:
    """Match method + §32 confidence, or None when the source does not cover the crop."""
    if crop in set(source.crops):
        return ("catalog_crop_match", "high")          # commodity-specific series
    groups = set(source.crop_groups)
    if crop_group in groups:
        return ("catalog_group_match", "medium")       # e.g. mushroom survey for shiitake
    if "all" in groups:
        return ("catalog_group_match", "low")          # generic coverage, mapping unverified
    return None


def discover_crop(identity: ID.CropIdentity, crop_group: str,
                  seed_countries: tuple[str, ...], catalog: WideSourceCatalog,
                  env: dict[str, str] | None = None) -> list[CandidateSource]:
    """§28: every credible candidate source for one crop across its countries (§7)."""
    env = env if env is not None else dict(os.environ)
    out: list[CandidateSource] = []
    for country in ID.target_countries_for(identity, seed_countries):
        for source in catalog.for_crop_country(identity.crop_id, crop_group, country):
            m = _match(source, identity.crop_id, crop_group)
            if m is None:
                continue
            method, confidence = m
            out.append(CandidateSource(
                crop_id=identity.crop_id, country=country,
                source_id=source.source_id, source_name=source.source_name,
                organization=source.organization,
                source_class=source.source_class, price_type=source.price_type,
                market_level=source.market_level,
                match_method=method, match_confidence=confidence,
                status=_status_for(source, env), access_status=source.access_status,
                authority=source.authority, frequency=source.frequency,
                historical_available=source.historical_available,
                data_url=source.data_url, source_url=source.source_url,
                currency=source.currency,
                retrieval_blockers=tuple(_blockers_for(source, env)),
            ))
    return out


def discover_all(seed, catalog: WideSourceCatalog,
                 env: dict[str, str] | None = None) -> dict[str, list[CandidateSource]]:
    """Run discovery for every crop in the v2 seed list, keyed by crop id."""
    identities = ID.identities_for_seed(seed)
    return {
        c.crop: discover_crop(identities[c.crop], c.crop_group, c.target_countries,
                              catalog, env)
        for c in seed.crops
    }


# --------------------------------------------------------------------- §47 audit

def search_audit_rows(seed, catalog: WideSourceCatalog, checked_at: str,
                      env: dict[str, str] | None = None) -> list[dict[str, object]]:
    """§47 structured search log: one row per crop x country with the queries used.

    The ``queries`` field is the programmatically generated §6 query set — the searches
    that WOULD be issued against each family — so a reviewer can see the search was
    genuinely broad even though this build executes none of them over the network.
    """
    identities = ID.identities_for_seed(seed)
    rows: list[dict[str, object]] = []
    for c in seed.crops:
        identity = identities[c.crop]
        cands = discover_crop(identity, c.crop_group, c.target_countries, catalog, env)
        for country in ID.target_countries_for(identity, c.target_countries):
            in_country = [k for k in cands if k.country == country]
            if in_country:
                status = ("access_blocked" if all(k.status == "access_blocked"
                                                  for k in in_country)
                          else "source_found_not_price")
                families = sorted({k.source_id for k in in_country})
            else:
                status = "not_yet_searched"            # §2: honest, not searched_no_match
                families = []
            rows.append({
                "crop": c.crop, "country": country, "status": status,
                "source_families_checked": len(catalog.sources),
                "candidate_sources": len(in_country),
                "families": ";".join(families),
                "queries": ";".join(identity.search_queries()),
                "checked_at": checked_at,
            })
    return rows


# --------------------------------------------------------------------- §46 review

def manual_review_rows(seed, catalog: WideSourceCatalog,
                       env: dict[str, str] | None = None) -> list[dict[str, object]]:
    """§46 queue: deterministic flags only — never a silent resolution."""
    identities = ID.identities_for_seed(seed)
    rows: list[dict[str, object]] = []
    # (a) scientific-name conflicts: two crops sharing a scientific name (Agaricus trio).
    by_sci: dict[str, list[str]] = {}
    for c in seed.crops:
        sci = identities[c.crop].scientific_name
        if sci:
            by_sci.setdefault(sci, []).append(c.crop)
    for sci, crops in sorted(by_sci.items()):
        if len(crops) > 1:
            rows.append({
                "crop": "|".join(sorted(crops)), "issue": "scientific_name_conflict",
                "detail": f"{sci} is shared by {len(crops)} seed crops; attribution "
                          f"needs a variety/grade dimension (§46)",
                "action": "verify variety-level mapping before attributing observations",
            })
    # (b) wasabi-style synonym collisions with non-equivalent products (§52).
    rows.append({
        "crop": "wasabi", "issue": "ambiguous_synonym",
        "detail": "'Japanese horseradish' collides with horseradish "
                  "(Armoracia rusticana), a different crop (§52)",
        "action": "require Eutrema/Wasabia match or explicit wasabi wording",
    })
    # (c) form-rich crops where a source must not merge forms (§36).
    for c in seed.crops:
        if len(identities[c.crop].forms) >= 3:
            rows.append({
                "crop": c.crop, "issue": "form_distinction_required",
                "detail": f"forms {list(identities[c.crop].forms)} are not "
                          f"economically interchangeable (§36)",
                "action": "retain the source's form field verbatim; never merge forms",
            })
    # (d) crops whose only catalog coverage is value/index/trade concepts (§62-65).
    for c in seed.crops:
        cands = discover_crop(identities[c.crop], c.crop_group, c.target_countries,
                              catalog, env)
        if cands and all(not SC.carries_unit_price(k.price_type) for k in cands):
            rows.append({
                "crop": c.crop, "issue": "price_concept_gap",
                "detail": "catalog coverage is value/index/trade-unit-value only",
                "action": "no unit price without a valid denominator (§63)",
            })
    return rows


# ------------------------------------------------------------- §48/§49 candidates

def candidate_crop_rows(seed, catalog: WideSourceCatalog) -> list[dict[str, object]]:
    """§48: candidate specialty crops from the catalog's commodity universes.

    A candidate is only a discovery *lead* (§49): the heuristic tags say why it looks
    specialty/exotic/high-value; nothing here adds it to the seed list.
    """
    existing = {c.crop.lower() for c in seed.crops}
    rows: list[dict[str, object]] = []
    for universe, items in (catalog.commodity_universes or {}).items():
        for item in items or []:
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            key = name.lower().replace(" ", "_")
            if key in existing or name.lower() in existing:
                continue
            tags = [str(t) for t in (item.get("tags") or [])]
            rows.append({
                "candidate_name": name,
                "source": str(item.get("source") or universe),
                "source_category": universe,
                "reason_candidate": "heuristic tags (§49): " + ",".join(tags)
                                    if tags else f"listed in {universe}",
            })
    return rows


# --------------------------------------------------------------------- §44 matrix

def coverage_matrix_rows(discovered: dict[str, list[CandidateSource]],
                         countries: list[str]) -> list[dict[str, object]]:
    """§44 crop x country matrix. Cells list source-class codes actually discovered —
    real discovery statuses, never assumed coverage. ``—`` = nothing cataloged."""
    rows: list[dict[str, object]] = []
    for crop, cands in discovered.items():
        row: dict[str, object] = {"crop": crop}
        for country in countries:
            in_country = [k for k in cands if k.country == country]
            if not in_country:
                row[country] = "—"
                continue
            codes = sorted({CLASS_CODES.get(k.source_class, "OT") for k in in_country})
            # A class is starred when at least one of its sources is price-carrying and
            # not access-blocked — the closest this build gets to "usable".
            usable = {CLASS_CODES.get(k.source_class, "OT") for k in in_country
                      if k.status == "source_found_not_price"
                      and SC.carries_unit_price(k.price_type)}
            row[country] = " ".join(c + ("*" if c in usable else "") for c in codes)
        rows.append(row)
    return rows


# --------------------------------------------------------------------- §43 breadth

def breadth_rows(discovered: dict[str, list[CandidateSource]], seed,
                 checked_at: str) -> list[dict[str, object]]:
    """§43 per-crop search-breadth summary."""
    rows: list[dict[str, object]] = []
    for c in seed.crops:
        cands = discovered.get(c.crop, [])
        countries = sorted({k.country for k in cands})
        usable = [k for k in cands if k.status == "source_found_not_price"
                  and SC.carries_unit_price(k.price_type)]
        best = max(cands, key=lambda k: k.authority, default=None)
        rows.append({
            "crop": c.crop,
            "countries_checked": len(countries),
            "candidate_sources": len(cands),
            "usable_price_sources": len(usable),
            "price_observations": 0,                   # nothing fetched in this build
            "best_source_class": best.source_class if best else "",
            "best_price_type": best.price_type if best else "",
            "last_checked": checked_at,
        })
    return rows
