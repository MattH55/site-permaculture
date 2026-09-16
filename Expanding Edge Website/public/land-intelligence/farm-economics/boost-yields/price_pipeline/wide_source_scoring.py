"""Source-class / price-type ontology and quality scoring for the v3 discovery layer.

v3 §3 replaces Tier A-E as the database's fundamental ontology with two independent
dimensions — *source class* (who publishes it) and *price type* (what supply-chain concept
the number measures). The old tiers survive only as a simplified reporting rollup in v2;
nothing in v3 writes a tier.

Two scores are kept strictly separate, per §31 and §32:

* ``source_authority_score`` — how authoritative the *publisher* is (5 = official
  government statistics down to 0 = anecdotal). It says nothing about whether a given
  observation matches the requested crop, and must never be read as a recommendation.
* ``match_confidence`` — how sure we are the observation *is the requested crop*
  (high/medium/low), driven by exact-commodity / scientific-name / variety matching.
"""

from __future__ import annotations

# --------------------------------------------------------------------- §3 dimension 1

SOURCE_CLASSES = (
    "GOVERNMENT_STATISTICS",
    "GOVERNMENT_MARKET_NEWS",
    "GOVERNMENT_TRADE",
    "PRODUCER_ORGANIZATION",
    "AUCTION_MARKET",
    "WHOLESALE_MARKET",
    "RETAIL_DATA",
    "EXCHANGE",
    "UNIVERSITY_EXTENSION",
    "INDUSTRY_DATA",
    "COMMERCIAL_DATA",
    "OTHER",
)

# --------------------------------------------------------------------- §3 dimension 2

PRICE_TYPES = (
    "producer_price",
    "farm_gate_price",
    "auction_price",
    "shipping_point_price",
    "wholesale_price",
    "terminal_market_price",
    "retail_price",
    "consumer_price",
    "trade_unit_value",
    "index",
    "aggregate_sales_value",
    "cost_return",
    "other",
)

# Price types that carry a currency-denominated per-unit number. ``index`` and
# ``aggregate_sales_value`` are deliberately excluded: an index has a base year, not a
# currency (§65), and an aggregate sales value has no valid denominator (§63).
PRICE_TYPE_CARRIES_UNIT_PRICE = frozenset(
    pt for pt in PRICE_TYPES if pt not in {"index", "aggregate_sales_value", "other"}
)

# --------------------------------------------------------------------- §31 authority

SOURCE_CLASS_AUTHORITY: dict[str, int] = {
    "GOVERNMENT_STATISTICS": 5,      # official government statistical observation
    "GOVERNMENT_MARKET_NEWS": 4,     # official government market-report observation
    "GOVERNMENT_TRADE": 4,           # official customs/trade statistics
    "PRODUCER_ORGANIZATION": 4,      # official producer / marketing board
    "UNIVERSITY_EXTENSION": 3,       # university / extension survey
    "AUCTION_MARKET": 3,             # auction / market organization
    "WHOLESALE_MARKET": 3,           # market operator's own published report
    "RETAIL_DATA": 3,                # official retail price datasets (ERS, CPI)
    "EXCHANGE": 3,                   # commodity exchange settlement data
    "INDUSTRY_DATA": 2,              # established industry source
    "COMMERCIAL_DATA": 1,            # commercial listing
    "OTHER": 0,                      # anecdotal / unverified
}

# --------------------------------------------------------------------- §32 confidence

MATCH_CONFIDENCE = ("high", "medium", "low")

# --------------------------------------------------------------------- §2 statuses

# Discovery statuses. The crucial v3 distinction (§2): "no price source found"
# (searched_no_match, after a comprehensive search) is not "no price source exists", and an
# unsearched crop is ``not_yet_searched`` — never silently Tier E.
DISCOVERY_STATUSES = (
    "price_found",
    "source_found_not_price",
    "source_found_but_unusable",
    "searched_no_match",
    "not_yet_searched",
    "access_blocked",
    "manual_review",
)

# --------------------------------------------------------------------- §42 access states

ACCESS_STATES = (
    "enabled",
    "disabled",
    "requires_key",
    "requires_auth",
    "temporarily_unavailable",
    "blocked",
    "deprecated",
    "manual_only",
)


def authority_score(source_class: str) -> int:
    """§31 score for a source class; unknown classes score 0 rather than failing loud."""
    return SOURCE_CLASS_AUTHORITY.get(source_class, 0)


def carries_unit_price(price_type: str) -> bool:
    """True when the price type is a currency-denominated per-unit measure."""
    return price_type in PRICE_TYPE_CARRIES_UNIT_PRICE
