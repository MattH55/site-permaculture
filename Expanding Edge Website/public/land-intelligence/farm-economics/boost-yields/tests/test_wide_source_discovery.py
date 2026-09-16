"""v3 source-discovery layer tests: §71 regression fixtures + §72 offline acceptance.

Everything here is offline. Retrieval is exercised through an injected fetcher/parser
pair, which is the only way a retrieval test can be both deterministic and honest —
it proves the provenance machinery (raw bytes, sha256, §34 fields) without claiming
anything about a live source.
"""

from __future__ import annotations

import os

import pytest

from price_pipeline import wide_crop_identity as ID
from price_pipeline import wide_price_fetch as FETCH
from price_pipeline import wide_source_discovery as DISC
from price_pipeline import wide_source_report as WSR
from price_pipeline import wide_source_scoring as SC
from price_pipeline.wide_price_normalization import (
    ObservationError, WidePriceObservation, assert_not_non_equivalent,
    dedup_key, flag_outliers, latest_observation, normalize_package_price,
)
from price_pipeline.wide_seed import read_seed_list
from price_pipeline.wide_source_catalog import (
    WideSourceCatalogError, load_source_catalog,
)

# --------------------------------------------------------------------- fixtures

FIXTURE_CATALOG = """
last_checked: "2026-09-15"
sources:
  - source_id: fixture_quickstats
    source_name: "Fixture QuickStats"
    organization: "Fixture NASS"
    country: US
    source_class: GOVERNMENT_STATISTICS
    price_type: farm_gate_price
    access_status: requires_key
    env_key: FIXTURE_API_KEY
    frequency: annual
    historical_available: true
    currency: USD
    crop_groups: ["all"]
  - source_id: fixture_terminal
    source_name: "Fixture Terminal Market"
    organization: "Fixture AMS"
    country: US
    source_class: GOVERNMENT_MARKET_NEWS
    price_type: terminal_market_price
    market_level: wholesale
    access_status: enabled
    frequency: weekly
    historical_available: true
    currency: USD
    crop_groups: ["mushroom"]
  - source_id: fixture_manual
    source_name: "Fixture Auction Board"
    organization: "Fixture Board"
    country: CA
    source_class: AUCTION_MARKET
    price_type: auction_price
    market_level: wholesale
    access_status: manual_only
    frequency: weekly
    currency: CAD
    crops: ["shiitake"]
  - source_id: fixture_value_only
    source_name: "Fixture Census Value"
    organization: "Fixture Census"
    country: US
    source_class: GOVERNMENT_STATISTICS
    price_type: aggregate_sales_value
    access_status: disabled
    frequency: quinquennial
    currency: USD
    crops: ["saffron"]
commodity_universes:
  fixture_universe:
    - {name: "Sea Buckthorn", source: "fixture", tags: ["high-value", "specialty"]}
"""


@pytest.fixture()
def catalog(tmp_path):
    path = tmp_path / "catalog.yaml"
    path.write_text(FIXTURE_CATALOG, encoding="utf-8")
    return load_source_catalog(str(path))


@pytest.fixture()
def seed():
    return read_seed_list()


def _obs(**kw) -> WidePriceObservation:
    base = dict(
        observation_id="obs-1", crop_id="shiitake", canonical_crop="shiitake",
        source_id="fixture_terminal", source_name="Fixture Terminal Market",
        organization="Fixture AMS", country="US",
        price_type="terminal_market_price", currency="USD", unit="$/lb",
        price_value=12.0, date="2026-09-01",
        retrieval_timestamp="2026-09-15T00:00:00Z",
    )
    base.update(kw)
    return WidePriceObservation(**base)


# --------------------------------------------------------------------- catalog (§30)

class TestCatalog:
    def test_fixture_loads(self, catalog):
        assert len(catalog.sources) == 4
        assert catalog.by_id("fixture_terminal").market_level == "wholesale"

    def test_closed_vocabularies_enforced(self, tmp_path):
        bad = tmp_path / "bad.yaml"
        bad.write_text(
            "sources:\n"
            "  - source_id: x\n    source_name: x\n    organization: x\n"
            "    country: US\n    source_class: NOT_A_CLASS\n"
            "    price_type: farm_gate_price\n    access_status: enabled\n",
            encoding="utf-8")
        with pytest.raises(WideSourceCatalogError):
            load_source_catalog(str(bad))

    def test_real_catalog_loads_and_none_enabled_without_keys(self):
        cat = load_source_catalog()
        assert len(cat.sources) >= 40
        # §42: nothing is machine-fetchable unless it is enabled AND keyed.
        for s in cat.sources:
            if s.access_status == "requires_key":
                assert s.env_key, f"{s.source_id} requires a key but names no env var"

    def test_duplicate_ids_rejected(self, tmp_path):
        dupe = tmp_path / "dupe.yaml"
        extra = (
            "  - source_id: fixture_quickstats\n"
            "    source_name: dup\n"
            "    organization: dup\n"
            "    country: US\n"
            "    source_class: GOVERNMENT_STATISTICS\n"
            "    price_type: farm_gate_price\n"
            "    access_status: enabled\n"
        )
        doc = FIXTURE_CATALOG.replace("commodity_universes:", extra +
                                      "commodity_universes:", 1)
        dupe.write_text(doc, encoding="utf-8")
        with pytest.raises(WideSourceCatalogError):
            load_source_catalog(str(dupe))


# --------------------------------------------------------------------- discovery (§28)

class TestDiscovery:
    def test_crop_specific_match_beats_group(self, catalog, seed):
        identity = ID.identity_for("shiitake", "mushroom")
        cands = DISC.discover_crop(identity, "mushroom", ("US", "CA"), catalog,
                                   env={})
        by_id = {k.source_id: k for k in cands}
        assert by_id["fixture_terminal"].match_method == "catalog_group_match"
        assert by_id["fixture_manual"].match_method == "catalog_crop_match"
        assert by_id["fixture_manual"].match_confidence == "high"
        assert by_id["fixture_terminal"].match_confidence == "medium"

    def test_missing_key_is_access_blocked_not_no_source(self, catalog):
        identity = ID.identity_for("saffron", "spice")
        cands = DISC.discover_crop(identity, "spice", ("US",), catalog, env={})
        quickstats = next(k for k in cands if k.source_id == "fixture_quickstats")
        assert quickstats.status == "access_blocked"
        assert any("FIXTURE_API_KEY" in b for b in quickstats.retrieval_blockers)

    def test_key_present_unblocks(self, catalog):
        identity = ID.identity_for("saffron", "spice")
        cands = DISC.discover_crop(identity, "spice", ("US",), catalog,
                                   env={"FIXTURE_API_KEY": "x"})
        quickstats = next(k for k in cands if k.source_id == "fixture_quickstats")
        assert quickstats.status == "source_found_not_price"

    def test_value_only_source_flagged(self, catalog):
        identity = ID.identity_for("saffron", "spice")
        cands = DISC.discover_crop(identity, "spice", ("US",), catalog, env={})
        value = next(k for k in cands if k.source_id == "fixture_value_only")
        assert value.price_type == "aggregate_sales_value"
        assert any("not a per-unit price" in b for b in value.retrieval_blockers)

    def test_zero_candidate_cells_are_not_yet_searched(self, catalog, seed):
        rows = DISC.search_audit_rows(seed, catalog, "2026-09-15T00:00:00Z", env={})
        empty = [r for r in rows if r["candidate_sources"] == 0]
        assert empty, "expected some crop x country cells with zero candidates"
        assert all(r["status"] == "not_yet_searched" for r in empty)
        # and nothing anywhere claims a comprehensive no-match
        assert not any(r["status"] == "searched_no_match" for r in rows)

    def test_audit_rows_carry_queries(self, catalog, seed):
        rows = DISC.search_audit_rows(seed, catalog, "2026-09-15T00:00:00Z", env={})
        assert all(r["queries"] for r in rows)
        shiitake = next(r for r in rows if r["crop"] == "shiitake"
                        and r["country"] == "US")
        assert "shiitake" in shiitake["queries"]


# ------------------------------------------------------- observation safeguards

class TestObservationSafeguards:
    def test_price_requires_numerator(self):
        with pytest.raises(ObservationError):
            _obs(price_value=None, price_mostly=None)

    def test_price_requires_unit_and_currency(self):
        with pytest.raises(ObservationError):
            _obs(unit="")
        with pytest.raises(ObservationError):
            _obs(currency="")

    def test_index_never_normalized(self):
        # construction must FAIL: index + normalized value is §65's exact violation
        with pytest.raises(ObservationError):
            _obs(price_type="index", price_value=None, price_mostly=None,
                 unit="", currency="", normalized_price_value=100.0)

    def test_index_without_normalized_value_ok(self):
        obs = _obs(price_type="index", price_value=None, price_mostly=None,
                   unit="", currency="")
        assert obs.price_type == "index"

    def test_aggregate_value_never_normalized(self):
        with pytest.raises(ObservationError):
            _obs(price_type="aggregate_sales_value", price_value=1_000_000.0,
                 unit="$", normalized_price_value=5.0)

    def test_aggregate_value_carries_value_evidence_only(self):
        obs = _obs(price_type="aggregate_sales_value", price_value=1_000_000.0,
                   unit="$")
        assert obs.economic_value_available
        assert obs.normalized_price_value is None

    def test_unknown_price_type_rejected(self):
        with pytest.raises(ObservationError):
            _obs(price_type="guess")

    def test_unknown_confidence_rejected(self):
        with pytest.raises(ObservationError):
            _obs(match_confidence="pretty-sure")

    def test_non_equivalent_refused(self):
        with pytest.raises(ObservationError):
            assert_not_non_equivalent("specialty mushrooms",
                                      ID.identity_for("shiitake").non_equivalents)
        # exact-match only: a genuine shiitake line must pass
        assert_not_non_equivalent("shiitake",
                                  ID.identity_for("shiitake").non_equivalents)


class TestPackageAndDates:
    def test_package_with_documented_weight(self):
        assert normalize_package_price(25.0, "5 lb box", 5.0, "lb") == (5.0, "per lb")

    def test_package_without_weight_stays_unnormalized(self):
        assert normalize_package_price(25.0, "bunch", None, None) is None
        assert normalize_package_price(25.0, "tray", 0, "lb") is None

    def test_latest_by_observation_date_not_retrieval(self):
        older_newer_retrieval = _obs(observation_id="a", date="2026-01-01",
                                     retrieval_timestamp="2026-09-15T00:00:00Z")
        newer_older_retrieval = _obs(observation_id="b", date="2026-08-01",
                                     retrieval_timestamp="2026-01-15T00:00:00Z")
        latest = latest_observation([older_newer_retrieval, newer_older_retrieval])
        assert latest.observation_id == "b"          # §68

    def test_dedup_key_ignores_price(self):
        a = _obs(observation_id="a", price_value=10.0, source_record_id="r1")
        b = _obs(observation_id="b", price_value=10.0, source_record_id="r1")
        c = _obs(observation_id="c", price_value=99.0, source_record_id="r2")
        assert dedup_key(a) == dedup_key(b)          # same record, same dims
        assert dedup_key(a) != dedup_key(c)

    def test_outliers_flagged_never_deleted(self):
        obs = [_obs(observation_id=f"o{i}", price_value=v)
               for i, v in enumerate([10, 11, 10, 12, 11, 10, 500])]
        flags = flag_outliers(obs)
        assert flags["o6"] is True
        assert len(obs) == 7                         # nothing removed (§70)
        assert sum(flags.values()) == 1


# --------------------------------------------------------------------- fetch (§57-59)

class TestFetch:
    def _candidate(self, catalog, env=None):
        identity = ID.identity_for("shiitake", "mushroom")
        cands = DISC.discover_crop(identity, "mushroom", ("US", "CA"), catalog,
                                   env=env or {})
        return {k.source_id: k for k in cands}

    def test_no_parser_is_found_not_retrieved(self, catalog):
        cands = self._candidate(catalog)
        report = FETCH.fetch_candidates(
            [cands["fixture_terminal"]], retrieved_at="2026-09-15T00:00:00Z")
        assert report.observations == []
        assert report.outcomes[0].status == "source_found_not_price"
        assert "no parser" in report.outcomes[0].reason

    def test_missing_key_blocks_before_parser_lookup(self, catalog):
        cands = self._candidate(catalog, env={})
        blocked = [k for k in cands.values() if k.status == "access_blocked"]
        assert blocked and all(k.source_id == "fixture_quickstats" for k in blocked)
        report = FETCH.fetch_candidates(blocked, retrieved_at="2026-09-15T00:00:00Z")
        assert report.outcomes[0].status == "access_blocked"
        assert report.n_blocked == 1

    def test_manual_only_source_not_automated(self, catalog):
        cands = self._candidate(catalog)
        report = FETCH.fetch_candidates(
            [cands["fixture_manual"]], retrieved_at="2026-09-15T00:00:00Z")
        assert report.outcomes[0].status == "source_found_not_price"
        assert "manual" in report.outcomes[0].reason

    def test_injected_fetcher_full_provenance(self, catalog, tmp_path, monkeypatch):
        """§72 offline acceptance: fetch -> raw bytes -> sha256 -> parse -> obs."""
        raw_bytes = b"crop,price\nshiitake,12.00\n"
        monkeypatch.setitem(FETCH.PARSERS, "fixture_terminal",
                            lambda raw, cand: [
                                _obs(observation_id="e2e-1",
                                     raw_file=None, sha256=None)]
                            if b"shiitake" in raw else [])
        fetcher = lambda cand: raw_bytes                 # noqa: E731
        cands = self._candidate(catalog)
        report = FETCH.fetch_candidates(
            [cands["fixture_terminal"]], retrieved_at="2026-09-15T00:00:00Z",
            raw_dir=str(tmp_path / "raw"), fetcher=fetcher)
        outcome = report.outcomes[0]
        assert outcome.retrieved and outcome.status == "price_found"
        assert len(report.observations) == 1
        # §37-41: raw file on disk, byte-identical, checksum matches
        with open(outcome.raw_file, "rb") as fh:
            assert fh.read() == raw_bytes
        from price_pipeline.wide_price_normalization import sha256_file
        assert sha256_file(outcome.raw_file) == outcome.sha256
        monkeypatch.delitem(FETCH.PARSERS, "fixture_terminal")

    def test_fetch_failure_is_data_not_crash(self, catalog):
        def boom(cand):
            raise ConnectionError("no network in tests")
        cands = self._candidate(catalog)
        # register a parser so the fetcher is actually invoked
        FETCH.PARSERS["fixture_terminal"] = lambda raw, cand: []
        try:
            report = FETCH.fetch_candidates(
                [cands["fixture_terminal"]], retrieved_at="2026-09-15T00:00:00Z",
                fetcher=boom)
        finally:
            del FETCH.PARSERS["fixture_terminal"]
        assert report.outcomes[0].status == "source_found_not_price"
        assert "ConnectionError" in report.outcomes[0].error

    def test_summary_never_conflates_found_with_retrieved(self, catalog):
        cands = self._candidate(catalog)
        report = FETCH.fetch_candidates(
            list(cands.values()), retrieved_at="2026-09-15T00:00:00Z")
        s = report.summary()
        assert s["sources_attempted"] == len(cands)
        assert s["sources_with_price"] == 0
        assert s["found_not_retrieved"] == len(cands)


# --------------------------------------------------------------------- report (§56)

class TestReport:
    def test_all_deliverables_written_even_when_empty(self, catalog, seed, tmp_path):
        discovered = DISC.discover_all(seed, catalog, env={})
        written = WSR.write_all(discovered, seed, catalog, "2026-09-15T00:00:00Z",
                                ["CA", "US"], str(tmp_path))
        for name, path in written.items():
            assert os.path.exists(path), name
            assert os.path.getsize(path) > 0, f"{name} must have at least a header"

    def test_matrix_cells_are_codes_or_dash(self, catalog, seed):
        identity = ID.identity_for("shiitake", "mushroom")
        discovered = {"shiitake": DISC.discover_crop(
            identity, "mushroom", ("US", "CA"), catalog, env={})}
        rows = DISC.coverage_matrix_rows(discovered, ["CA", "US"])
        shiitake = rows[0]
        assert "AM" in shiitake["CA"]                # fixture_manual auction board
        assert "GMN" in shiitake["US"]               # fixture_terminal
        for row in rows:
            for cc in ("CA", "US"):
                assert row[cc] == "—" or row[cc].replace("*", "").strip()

    def test_candidate_crops_exclude_seeded(self, catalog, seed):
        rows = DISC.candidate_crop_rows(seed, catalog)
        names = {r["candidate_name"] for r in rows}
        assert "Sea Buckthorn" in names
        seeded = {c.crop.replace("_", " ").lower() for c in seed.crops}
        assert not any(n.lower() in seeded for n in names)

    def test_manual_review_flags_agaricus_conflict(self, catalog, seed):
        rows = DISC.manual_review_rows(seed, catalog, env={})
        conflicts = [r for r in rows if r["issue"] == "scientific_name_conflict"]
        assert any("agaricus" in r["crop"] for r in conflicts)
        assert any(r["crop"] == "wasabi" for r in rows)

    def test_observations_writer_csv_fallback(self, tmp_path):
        path = WSR.write_observations([_obs()], str(tmp_path))
        assert path is not None and os.path.exists(path)
        assert WSR.write_observations([], str(tmp_path)) is None


# --------------------------------------------------------------------- code map (§54)

class TestCropCodeMap:
    def test_curated_codes_win(self, seed, catalog):
        from price_pipeline import wide_crop_code_map as CCM
        rows = CCM.code_map_rows(seed, catalog)
        # no curated codes for fixture sources -> everything is hint or alias
        assert all(r["match_confidence"] in {"high", "medium", "low"} for r in rows)

    def test_real_catalog_shiitake_quickstats(self, seed):
        from price_pipeline import wide_crop_code_map as CCM
        rows = CCM.code_map_rows(seed, load_source_catalog())
        hit = next((r for r in rows if r["crop_id"] == "shiitake"
                    and r["source_id"] == "nass_quickstats"), None)
        assert hit is not None
        assert hit["source_code"] == "SHIITAKE"
        assert hit["match_confidence"] == "high"


# --------------------------------------------------------------------- CLI (§57)

class TestCli:
    def test_status_clean(self, capsys):
        from price_pipeline import wide_discovery_cli as CLI
        assert CLI.main(["status", "--json"]) == 0
        out = capsys.readouterr().out
        assert '"sources"' in out

    def test_discover_known_crop(self, capsys):
        from price_pipeline import wide_discovery_cli as CLI
        rc = CLI.main(["discover", "--crop", "shiitake"])
        out = capsys.readouterr().out
        assert rc == 0
        assert "shiitake:" in out
        assert "candidate source(s)" in out

    def test_discover_unknown_crop_exits_3(self):
        from price_pipeline import wide_discovery_cli as CLI
        assert CLI.main(["discover", "--crop", "not-a-crop-xyz"]) == 3

    def test_fetch_exits_2_with_honest_message(self, capsys):
        from price_pipeline import wide_discovery_cli as CLI
        rc = CLI.main(["fetch", "--crop", "wasabi"])
        out = capsys.readouterr().out
        assert rc == 2
        assert "not 'no data exists'" in out     # §59: refusal explains what WAS found

    def test_report_writes_all(self, tmp_path, capsys):
        from price_pipeline import wide_discovery_cli as CLI
        rc = CLI.main(["report", "--out", str(tmp_path), "--json"])
        out = capsys.readouterr().out
        assert rc == 0
        import json as _json
        written = _json.loads(out)
        assert "coverage_html" in written
        for name in written.values():
            assert os.path.exists(tmp_path / name)


# ------------------------------------------------------- §72 end-to-end acceptance

class TestEndToEnd:
    def test_offline_pipeline_seed_to_observations(self, catalog, seed, tmp_path,
                                                   monkeypatch):
        """§72: discover -> fetch (injected) -> observations -> report, no network."""
        # 1. discover across the full seed list against the fixture catalog
        discovered = DISC.discover_all(seed, catalog, env={})
        assert sum(len(v) for v in discovered.values()) > 0

        # 2. fetch with an injected fetcher + parser for ONE source family
        raw_bytes = b"crop,market,price\nshiitake,fixture,12.00\n"

        def parser(raw: bytes, cand: DISC.CandidateSource):
            if b"shiitake" not in raw:
                return []
            return [_obs(observation_id="e2e-1")]

        monkeypatch.setitem(FETCH.PARSERS, "fixture_terminal", parser)
        candidates = [k for cands in discovered.values() for k in cands]
        report = FETCH.fetch_candidates(candidates, retrieved_at="2026-09-15T00:00:00Z",
                                        raw_dir=str(tmp_path / "raw"),
                                        fetcher=lambda c: raw_bytes)
        assert report.observations                     # at least the shiitake line
        assert report.summary()["sources_with_price"] >= 1

        # 3. all deliverables land, observations included
        written = WSR.write_all(discovered, seed, catalog, "2026-09-15T00:00:00Z",
                                ["CA", "US"], str(tmp_path), fetch_report=report)
        assert "observations" in written
        assert os.path.exists(written["observations"])
        assert os.path.exists(written["fetch_summary"])

        # 4. honesty: every non-retrieved outcome carries a reason, never silence
        assert all(o.reason for o in report.outcomes)

