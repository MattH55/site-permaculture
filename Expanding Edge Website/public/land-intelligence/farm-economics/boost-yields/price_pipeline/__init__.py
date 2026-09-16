"""Alberta specialty-crop price pipeline.

Design contract
---------------
1. Every observation carries exactly one ``price_type`` from the closed taxonomy in
   ``price_sources.yaml``. Aggregations must filter on it first; blending an
   insurance reference price with a realized farm price is the principal failure
   mode this pipeline exists to prevent.
2. Nothing is ever silently converted. A value only reaches ``CAD/tonne`` when the
   unit is mass-based, or when a commodity-specific bushel mass is *declared by the
   source itself* (published test-weight table, an explicit metric twin series, a
   same-row $/kg pair, or a crop-sales cross-check). Otherwise the row is
   quarantined with a reason.
3. Licence-restricted commercial cash-bid data is externalized as a citation and
   never enters the observation store.
"""

__all__ = ["registry", "units", "crops", "models"]
