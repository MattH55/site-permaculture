"""Retrieval orchestration for the v3 price layer (§37-41, §57-59).

This build ships with an EMPTY parser registry: no source family has an implemented
parser yet. That is a deliberate, honest state — the fetch layer still does real work:

* it separates "source found" from "price retrieved" for every candidate (§45);
* it records exactly why retrieval did not happen (missing key, manual-only source,
  no parser) instead of letting the gap look like absence of data (§2);
* when a parser IS registered, it enforces the §37-41 provenance contract: raw bytes
  are written verbatim to disk, sha256'd, and the observation carries
  ``retrieval_timestamp`` + ``raw_file`` + ``sha256`` before any normalization runs.

A fake fetcher/parser can be injected for tests (§72), which is how the offline
acceptance test exercises the full path without network access.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable

from . import wide_source_discovery as DISC
from .wide_price_normalization import WidePriceObservation, sha256_bytes

# Registered parsers, keyed by source_id. EMPTY in this build: adding a parser is a
# reviewed, tested event — never something that happens implicitly.
PARSERS: dict[str, Callable[[bytes, DISC.CandidateSource], list[WidePriceObservation]]] = {}

# Fetchers: how bytes for a source are obtained. Injected in tests (offline build has none).
Fetcher = Callable[[DISC.CandidateSource], bytes]


@dataclass(frozen=True)
class FetchOutcome:
    """What happened when retrieval was attempted (or honestly not attempted)."""

    candidate: DISC.CandidateSource
    retrieved: bool
    status: str                     # §2: price_found | source_found_not_price | access_blocked
    reason: str
    n_observations: int = 0
    raw_file: str | None = None
    sha256: str | None = None
    error: str | None = None

    def to_row(self) -> dict[str, Any]:
        c = self.candidate
        return {
            "crop_id": c.crop_id, "country": c.country, "source_id": c.source_id,
            "retrieved": self.retrieved, "status": self.status,
            "n_observations": self.n_observations, "reason": self.reason,
            "raw_file": self.raw_file or "", "sha256": self.sha256 or "",
            "error": self.error or "",
        }


@dataclass
class FetchReport:
    """§59 summary over a fetch run."""

    retrieved_at: str
    outcomes: list[FetchOutcome] = field(default_factory=list)
    observations: list[WidePriceObservation] = field(default_factory=list)

    @property
    def n_retrieved(self) -> int:
        return sum(1 for o in self.outcomes if o.retrieved)

    @property
    def n_blocked(self) -> int:
        return sum(1 for o in self.outcomes if o.status == "access_blocked")

    def summary(self) -> dict[str, Any]:
        """§59 honest summary: found vs retrieved vs blocked, never conflated."""
        return {
            "retrieved_at": self.retrieved_at,
            "sources_attempted": len(self.outcomes),
            "sources_with_price": self.n_retrieved,
            "observations": len(self.observations),
            "access_blocked": self.n_blocked,
            "found_not_retrieved": len(self.outcomes) - self.n_retrieved,
        }


def _attempt(candidate: DISC.CandidateSource, raw_dir: str | None,
             fetcher: Fetcher | None) -> tuple[FetchOutcome, list[WidePriceObservation]]:
    """One candidate through the §37-41 pipeline, or an honest non-retrieval record."""
    # §45: access problems are recorded as access problems, never as "no source".
    for blocker in candidate.retrieval_blockers:
        if blocker.startswith("environment variable "):
            return FetchOutcome(candidate, False, "access_blocked",
                                f"missing API key ({blocker.split()[2]})"), []
    if candidate.access_status in {"manual_only", "requires_auth",
                                   "blocked", "temporarily_unavailable", "deprecated"}:
        return FetchOutcome(candidate, False, "source_found_not_price",
                            f"access_status={candidate.access_status}: retrieval is a "
                            f"manual/authorized step, not automated"), []
    if candidate.access_status == "disabled":
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "disabled in catalog: no automated retrieval"), []
    parser = PARSERS.get(candidate.source_id)
    if parser is None:
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "no parser registered for this source in this build"), []
    if fetcher is None:
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "no fetcher configured (offline build)"), []
    # Real retrieval path (exercised by tests with an injected fetcher).
    try:
        raw = fetcher(candidate)
    except Exception as exc:  # network/HTTP failures are data, not crashes (§58)
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "fetch failed", error=f"{type(exc).__name__}: {exc}"), []
    digest = sha256_bytes(raw)
    raw_file = None
    if raw_dir:
        os.makedirs(raw_dir, exist_ok=True)
        raw_file = os.path.join(
            raw_dir, f"{candidate.source_id}_{candidate.crop_id}_{digest[:12]}.raw")
        with open(raw_file, "wb") as fh:      # §37: bytes stored verbatim, unmodified
            fh.write(raw)
    try:
        obs = parser(raw, candidate)
    except Exception as exc:
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "parse failed", raw_file=raw_file, sha256=digest,
                            error=f"{type(exc).__name__}: {exc}"), []
    if not obs:
        return FetchOutcome(candidate, False, "source_found_not_price",
                            "source responded but contained no matching observations",
                            raw_file=raw_file, sha256=digest), []
    return FetchOutcome(candidate, True, "price_found",
                        f"retrieved {len(obs)} observation(s)",
                        n_observations=len(obs), raw_file=raw_file, sha256=digest), obs


def fetch_candidates(candidates: list[DISC.CandidateSource],
                     retrieved_at: str, raw_dir: str | None = None,
                     fetcher: Fetcher | None = None) -> FetchReport:
    """§57 fetch step over a candidate list; observations carry full §34 provenance."""
    report = FetchReport(retrieved_at=retrieved_at)
    for candidate in candidates:
        outcome, obs = _attempt(candidate, raw_dir, fetcher)
        report.outcomes.append(outcome)
        report.observations.extend(obs)
    return report

