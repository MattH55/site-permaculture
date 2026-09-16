"""Dataset writer: partitioning, quarantining, provenance and price_type purity.

The purity assertions are the point of this file. Rows are never blended across
price_type values and a policy-externalized source must never reach an output, so the
tests check the written files rather than the writer's intentions. A regression that
merged an ``insurance_reference_price`` into an ``average_farm_price`` average would
pass every parser test and still be wrong.

The writer is exercised against a temporary directory with synthesised observations so
the assertions hold whether or not ``raw/`` has been populated.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import registry, runner  # noqa: E402
from price_pipeline.models import Observation  # noqa: E402

STAMP = "2026-09-15T00:00:00Z"


def _obs(**kw):
    base = dict(
        observation_id=kw.pop("observation_id", "px-test"),
        crop_id="wheat", source_id="src", source_title="t", publisher="p",
        price_type="average_farm_price", region="Alberta",
        reference_date="2026", date_granularity="year",
        original_value=250.0, original_unit="tonne", currency="CAD",
        normalized_value=250.0, normalized_unit="CAD/tonne",
        conversion_basis="mass", record_origin="observed",
    )
    base.update(kw)
    return Observation(**base)


def _report(results=None):
    rep = runner.RunReport(retrieved_at=STAMP)
    for r in results or []:
        rep.results.append(r)
    return rep


def test_rows_are_partitioned_by_price_type(tmp_path):
    rows = [
        _obs(observation_id="a", price_type="average_farm_price"),
        _obs(observation_id="b", price_type="insurance_reference_price"),
        _obs(observation_id="c", price_type="average_farm_price"),
    ]
    runner.write_dataset(rows, _report(), out_dir=str(tmp_path))

    doc = json.loads((tmp_path / "observations.json").read_text(encoding="utf-8"))
    assert doc["count"] == 3
    assert doc["by_price_type"] == {"average_farm_price": 2,
                                    "insurance_reference_price": 1}
    # Every row must sit under a key equal to its own price_type.
    for ptype, items in doc["observations"].items():
        assert items
        assert {r["price_type"] for r in items} == {ptype}


def test_quarantined_rows_are_split_out_and_keep_their_reason(tmp_path):
    rows = [
        _obs(observation_id="ok"),
        _obs(observation_id="q1", normalized_value=None,
             conversion_basis="bushel-mass-undeclared",
             conversion_detail="no published bushel mass",
             original_unit="bu", original_value=6.8),
    ]
    runner.write_dataset(rows, _report(), out_dir=str(tmp_path))

    good = json.loads((tmp_path / "observations.json").read_text(encoding="utf-8"))
    bad = json.loads((tmp_path / "quarantine.json").read_text(encoding="utf-8"))

    assert good["count"] == 1
    assert all(r["normalized_value"] is not None
               for items in good["observations"].values() for r in items)

    assert bad["count"] == 1
    q = bad["observations"]["average_farm_price"][0]
    assert q["observation_id"] == "q1"
    assert q["conversion_basis"] == "bushel-mass-undeclared"
    assert q["conversion_detail"], "quarantine must explain itself"
    assert q["original_value"] == 6.8, "the original number must be preserved"
    assert q["normalized_value"] is None



def test_no_externalized_price_type_reaches_either_file(tmp_path):
    """commercial_bid_reference_link is citation-only and must never be written."""
    rows = [
        _obs(observation_id="ok"),
        _obs(observation_id="leak", price_type="commercial_bid_reference_link"),
    ]
    runner.write_dataset(rows, _report(), out_dir=str(tmp_path))

    for name in ("observations.json", "quarantine.json"):
        text = (tmp_path / name).read_text(encoding="utf-8")
        assert "commercial_bid_reference_link" not in text, name


def test_manifest_records_digests_and_skip_reasons(tmp_path):
    parsed = runner.SourceResult(
        source_id="s1", parser="statcan", price_type="average_farm_price",
        status="parsed", count=5, quarantined=2, sha256="deadbeef",
        doc_file="x.zip")
    skipped = runner.SourceResult(
        source_id="s2", parser="afsc_spring", price_type="insurance_reference_price",
        status="skipped", reason="raw artifact not present", doc_file="y.pdf")

    runner.write_dataset([_obs()], _report([parsed, skipped]), out_dir=str(tmp_path))
    doc = json.loads((tmp_path / "sources.json").read_text(encoding="utf-8"))

    by_id = {s["source_id"]: s for s in doc["sources"]}
    assert by_id["s1"]["raw_sha256"] == "deadbeef"
    assert by_id["s2"]["status"] == "skipped"
    assert by_id["s2"]["reason"]
    assert doc["totals"]["sources_parsed"] == 1
    assert doc["totals"]["sources_skipped"] == 1
    # Provenance policy is published alongside the numbers.
    assert "price_types" in doc
    assert doc["price_types"]["commercial_bid_reference_link"]["values_included"] is False


def test_missing_artifact_is_a_skip_not_a_failure():
    """A partial download must not stop the other sources from running."""
    rows, report = runner.collect(retrieved_at=STAMP, source_ids=["__nope__"])
    assert rows == []
    assert report.skipped == []

    # Any source with no artifact on disk must be reported as skipped, with a reason.
    rows, report = runner.collect(retrieved_at=STAMP)
    for r in report.results:
        if r.status == "skipped":
            assert r.reason


def test_unknown_parser_is_reported_as_a_skip_not_a_crash(monkeypatch):
    """Registry drift surfaces as a named skip instead of a silent zero-row source."""
    doc = registry.load_registry()
    mutated = json.loads(json.dumps(doc))
    mutated["sources"][0]["parser"] = "does_not_exist"
    monkeypatch.setattr(registry, "load_registry", lambda *a, **k: mutated)

    rows, report = runner.collect(retrieved_at=STAMP)
    assert report.results[0].status == "skipped"
    assert "does_not_exist" in report.results[0].reason


def test_written_dataset_is_canonical_and_stable(tmp_path):
    """Re-writing the same rows must produce byte-identical files."""
    rows = [_obs(observation_id=str(i)) for i in range(5)]
    runner.write_dataset(rows, _report(), out_dir=str(tmp_path))
    first = (tmp_path / "observations.json").read_bytes()

    runner.write_dataset(rows, _report(), out_dir=str(tmp_path))
    assert (tmp_path / "observations.json").read_bytes() == first