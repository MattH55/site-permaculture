"""§54 crop-code map: how each crop is named inside each source family.

A source's commodity vocabulary is never assumed to match ours. For every crop x source
pair this map records the *best known code or verbatim series name*, the confidence in
that mapping (§32), and WHY — so a fetch for "shiitake" against NASS asks for "SHIITAKE"
deliberately, and a fetch against a source with no known mapping is honestly marked
``unmapped`` rather than silently queried with a guessed string.

Codes come from three places, in strict precedence:
1. the catalog entry's own ``verbatim_series_hint`` (curated, highest confidence);
2. curated per-crop overrides below (§50-53 territory — hand-checked);
3. the crop identity's aliases (low confidence — a query string, not a verified code).
"""

from __future__ import annotations

from . import wide_crop_identity as ID
from .wide_source_catalog import WideSourceCatalog

# Hand-checked source-specific codes. Keyed by (source_id, crop_id) -> (code, confidence,
# note). Only entries a human has verified belong here; everything else falls through to
# the alias fallback marked "low".
CURATED_CODES: dict[tuple[str, str], tuple[str, str, str]] = {
    ("nass_quickstats", "shiitake"): (
        "SHIITAKE", "high", "NASS Census/QuickStats commodity descriptor for shiitake"),
    ("nass_quickstats", "ginger"): (
        "GINGER", "high", "NASS commodity descriptor"),
    ("nass_quickstats", "turmeric"): (
        "TURMERIC", "high", "NASS commodity descriptor"),
    ("nass_quickstats", "maple_syrup"): (
        "MAPLE SYRUP", "high", "NASS commodity descriptor (syrup, not sap)"),
    ("nass_special_mushrooms", "shiitake"): (
        "Shiitake", "high", "NASS Mushrooms report variety line"),
    ("nass_special_mushrooms", "agaricus_white_button"): (
        "Agaricus", "medium",
        "report line is genus-level; variety split needs grade dimension (§46)"),
}


def code_map_rows(seed, catalog: WideSourceCatalog) -> list[dict[str, object]]:
    """One row per crop x candidate source: the code to query with, or ``unmapped``."""
    identities = ID.identities_for_seed(seed)
    rows: list[dict[str, object]] = []
    for c in seed.crops:
        identity = identities[c.crop]
        seen: set[str] = set()
        for country in ID.target_countries_for(identity, c.target_countries):
            for source in catalog.for_crop_country(c.crop, c.crop_group, country):
                if source.source_id in seen:
                    continue
                seen.add(source.source_id)
                curated = CURATED_CODES.get((source.source_id, c.crop))
                if curated:
                    code, confidence, note = curated
                elif source.verbatim_series_hint:
                    code, confidence, note = (
                        source.verbatim_series_hint, "medium",
                        "from catalog verbatim_series_hint (curated at source level)")
                else:
                    code = identity.canonical_name
                    confidence, note = (
                        "low", "alias fallback — query string, not a verified source "
                               "code; a failed match here is unmapped, not no-data")
                rows.append({
                    "crop_id": c.crop, "source_id": source.source_id,
                    "source_code": code, "match_confidence": confidence,
                    "note": note,
                })
    return rows
