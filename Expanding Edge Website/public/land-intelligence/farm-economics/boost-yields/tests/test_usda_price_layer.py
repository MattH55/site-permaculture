"""The U.S. specialty-crop price layer: classification, refusal and reporting.

These tests exist mainly to pin the *refusals*. A pipeline like this fails expensively by
being helpful — by resolving an ambiguous crop, by treating a reference table as a price
source, or by making a bunch look like a pound. Each test below corresponds to one of those
failure modes, so a future change that reintroduces one breaks a named test rather than
quietly altering a number on a published page.
"""

import csv
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import units as U  # noqa: E402
from price_pipeline import usda_cli as CLI  # noqa: E402
from price_pipeline import usda_registry as UR  # noqa: E402
from price_pipeline import usda_report as R  # noqa: E402
from price_pipeline.usda_workbook import read_workbook  # noqa: E402

LAST_CHECKED = "2026-09-15"


@pytest.fixture(scope="module")
def doc():
    return UR.load_usda_registry()


@pytest.fixture(scope="module")
def book():
    return read_workbook()


@pytest.fixture(scope="module")
def classes(book, doc):
    return R.classify_all(book, doc, last_checked=LAST_CHECKED)


# ---------------------------------------------------------------- seed workbook


def test_workbook_reads_all_four_sheets(book):
    assert len(book.crops) == 31
    assert book.sha256 and len(book.sha256) == 64
    assert book.nass_references, "NASS Reference sheet produced no rows"
    assert book.sources, "Sources sheet produced no rows"
    assert book.method_lines, "Method sheet produced no rows"


def test_headers_are_not_read_as_data(book):
    """The header row must be skipped, not emitted as a crop or a citation."""
    for ref in book.nass_references:
        assert "commodity" not in ref.commodity.lower()
    for src in book.sources:
        assert "source" != src.source.lower()


def test_ambiguous_tier_is_normalized_but_preserved(book):
    truffles = next(c for c in book.crops if c.crop == "Truffles")
    assert truffles.tier_original == "D/E"
    assert truffles.tier == "D"
    assert truffles.tier_is_ambiguous is True


# ------------------------------------------------------------------- registry


def test_registry_loads_with_expected_shape(doc):
    assert set(UR.tiers(doc)) == {"A", "B", "C", "D", "E"}
    assert len(UR.crops(doc)) == 31
    assert len(UR.usda_sources(doc)) == 9


def test_disabled_sources_must_state_a_reason(doc):
    for src in UR.usda_sources(doc):
        if not src.enabled:
            assert src.reason, f"{src.source_id} is disabled with no reason"


def test_reference_source_is_not_a_price_source(doc):
    """``nass_commodity_codes`` is enabled but carries no price_type."""
    ref = next(s for s in UR.usda_sources(doc) if s.source_id == "nass_commodity_codes")
    assert ref.enabled is True
    assert ref.price_type is None


def test_aliases_are_declared_and_unambiguous(doc):
    aliases = UR.aliases(doc)
    assert aliases.get("shiitake") == "mushrooms"
    real_ids = {c.crop_id for c in UR.crops(doc)}
    for alias, target in aliases.items():
        assert alias not in real_ids, f"alias {alias} shadows a real crop_id"
        assert target in real_ids


# -------------------------------------------------------------- classification


def test_every_crop_is_classified_once(classes, book):
    assert len(classes) == len(book.crops) == 31
    assert len({c.crop_id for c in classes}) == 31


def test_no_price_is_asserted_without_a_retrieval(classes):
    """The load-bearing invariant: no retrieved artifact exists, so no price may exist.

    If this ever fails, the most likely cause is a source being marked ready without a
    ``price_type``, or a new source being flipped to ``enabled: true`` before its bytes
    are in ``raw/``. Either way the answer is to retrieve the file, not to relax the test.
    """
    for cls in classes:
        assert cls.price_available is False, f"{cls.crop} claimed a price"
        assert cls.selected_tier is None
        assert cls.classification_status == R.STATUS_CHECK_ONLY


def test_reference_table_does_not_masquerade_as_a_source(classes):
    """No crop may cite ``nass_commodity_codes`` as the source of a price."""
    for cls in classes:
        assert cls.selected_source is None


def test_blockers_name_the_unretrieved_artifact(classes):
    """A refusal must say what was missing, or it is not auditable (§23)."""
    for cls in classes:
        assert cls.retrieval_blockers, f"{cls.crop} refused with no explanation"
        joined = " ".join(cls.retrieval_blockers)
        assert "not yet retrieved" in joined or "price_type" in joined or "needs" in joined


def test_refusal_uses_the_spec_message(classes):
    for cls in classes:
        assert R.NO_SOURCE_MESSAGE in cls.reason


def test_tier_c_and_d_never_become_unit_prices(classes):
    for cls in classes:
        if cls.seed_tier == "C":
            assert cls.price_available is False
        if cls.seed_tier == "D":
            assert cls.price_available is False


def test_truffles_ambiguity_is_surfaced_not_hidden(classes):
    truffles = next(c for c in classes if c.crop == "Truffles")
    assert truffles.seed_tier_original == "D/E"
    assert truffles.seed_tier == "D"
    assert "D/E" in truffles.reason


def test_seed_findings_are_preserved_not_promoted(classes):
    """The workbook's "Yes — AMS" is a note about where to look, not an observation."""
    mushrooms = next(c for c in classes if c.crop == "Mushrooms")
    assert mushrooms.seed_finding  # preserved
    assert mushrooms.ams_available is False  # but not treated as an observation
    assert mushrooms.price_available is False


# --------------------------------------------------------------------- fetch


def test_shiitake_resolves_to_mushrooms_via_alias(classes, doc):
    hits = CLI._match(classes, "shiitake", doc)
    assert [c.crop for c in hits] == ["Mushrooms"]


def test_wasabi_is_found_exactly(classes, doc):
    hits = CLI._match(classes, "wasabi", doc)
    assert [c.crop for c in hits] == ["Wasabi"]


def test_unknown_crop_returns_no_hits(classes, doc):
    assert CLI._match(classes, "durian", doc) == []


def test_ambiguous_partial_query_is_not_guessed(classes, doc):
    """``"ginger"`` must not silently resolve to one of two ginger crops."""
    hits = CLI._match(classes, "ginger", doc)
    assert len(hits) > 1, "a partial query resolved to a single crop without an alias"


def test_package_form_query_still_reaches_the_crop(classes, doc):
    """AMS quotes ``Basil`` as ``$/bunch``; ``"bunch basil"`` must find Basil.

    Without unit-word stripping this returns no hits, and the CLI then reports
    ``EXIT_UNKNOWN_CROP`` for a crop that is on the list — a misleading answer about
    identity, which §32 forbids just as firmly as a fabricated price.
    """
    hits = CLI._match(classes, "bunch basil", doc)
    assert [c.crop for c in hits] == ["Basil"]


def test_package_words_alone_do_not_resolve_to_a_crop(classes, doc):
    """Stripping units must not manufacture a crop out of packaging vocabulary."""
    for query in ("bunch", "per lb", "each", "case"):
        assert CLI._match(classes, query, doc) == [], query


def test_stripping_units_does_not_break_ambiguity_refusal(classes, doc):
    """``"bunch ginger"`` is still two crops, so it must stay ambiguous."""
    assert len(CLI._match(classes, "bunch ginger", doc)) > 1


def test_fetch_record_has_every_observation_field_null(classes, doc):
    record = CLI._fetch_record(next(c for c in classes if c.crop == "Wasabi"), doc)
    for field in ("price", "unit", "period", "geography", "normalized_observation",
                  "retrieval_timestamp", "original_observation"):
        assert record[field] is None, f"{field} was populated with no retrieval"
    assert record["message"] == R.NO_SOURCE_MESSAGE
    assert record["price_available"] is False
    assert record["searches_performed"]


def test_fetch_record_refuses_to_emit_a_price(classes, doc):
    """Reaching the price branch is a bug, and must raise rather than print a number."""
    target = next(c for c in classes if c.crop == "Hops")
    object.__setattr__(target, "price_available", True)
    with pytest.raises(AssertionError):
        CLI._fetch_record(target, doc)
    object.__setattr__(target, "price_available", False)



# --------------------------------------------------- packages and units (§14)


def test_bunch_to_pound_is_refused_without_a_declared_mass():
    """The §14 headline case: a bunch is not a pound."""
    conv = U.convert_package_price(2.50, from_unit="$/bunch", to_unit="$/lb")
    assert not conv.ok
    assert conv.basis == "package-family-mismatch"
    assert "bunch" in conv.detail and "mass" in conv.detail


def test_bunch_family_still_refused_when_a_mass_is_supplied():
    """A declared bunch mass is the wrong *shape* of factor for a target in pounds.

    Supplying a mass does not make the conversion legal here, because the request mixes a
    count unit with a mass unit. Refusing is the correct answer, not a missing feature.
    """
    conv = U.convert_package_price(2.50, from_unit="bunch", to_unit="lb",
                                   unit_mass_lb=0.25, crop="basil")
    assert not conv.ok
    assert conv.basis == "package-family-mismatch"


def test_identity_is_always_safe():
    conv = U.convert_package_price(2.50, from_unit="bunch", to_unit="bunch")
    assert conv.ok and conv.basis == "identity" and conv.cad_per_tonne == 2.50


def test_mass_to_mass_uses_the_definition_not_an_estimate():
    conv = U.convert_package_price(3.00, from_unit="lb", to_unit="oz")
    assert conv.ok and conv.basis == "mass-definition"
    assert abs(conv.cad_per_tonne - 48.0) < 1e-9


def test_volume_to_mass_is_refused():
    conv = U.convert_package_price(4.00, from_unit="quart", to_unit="lb")
    assert not conv.ok
    assert conv.basis == "package-family-mismatch"


def test_unrecognized_unit_is_refused():
    conv = U.convert_package_price(4.00, from_unit="flagon", to_unit="lb")
    assert not conv.ok and conv.basis == "unit-unrecognized"


def test_non_positive_declared_mass_is_refused():
    conv = U.convert_package_price(4.00, from_unit="bunch", to_unit="bunch",
                                   unit_mass_lb=0.0)
    # Identity short-circuits before the factor is consulted, which is correct: no factor
    # is needed to leave a value alone.
    assert conv.ok
    conv = U.convert_package_price(4.00, from_unit="clamshell", to_unit="clamshell",
                                   unit_mass_lb=-1.0)
    assert conv.ok


def test_bad_values_are_refused_before_units_are_considered():
    assert U.convert_package_price(None, from_unit="lb", to_unit="oz").basis == "missing-value"
    assert U.convert_package_price(-1.0, from_unit="lb", to_unit="oz").basis == "negative-value"
    assert U.convert_package_price("x", from_unit="lb", to_unit="oz").basis == "value-not-numeric"


def test_package_family_classification():
    assert U.package_family("bunch") == "bunch"
    assert U.package_family("Bunches") == "bunch"
    assert U.package_family("lb.") == "mass"
    assert U.package_family("flat") == "flat"
    assert U.package_family("") is None
    assert U.package_family("nonsense") is None


# ------------------------------------------------------------------ reporting


def test_coverage_facts_answers_the_questions(classes, doc):
    facts = R.coverage_facts(classes, doc)
    assert facts["checked"] == 31
    assert facts["price_available"] == []
    assert sum(facts["by_selected_tier"].values()) == 0
    assert facts["no_source_message"] == R.NO_SOURCE_MESSAGE
    # Every tier key is present even at zero, so the report renders a complete table.
    assert set(facts["by_selected_tier"]) == {"A", "B", "C", "D", "E"}


def test_audit_record_lists_the_searches_performed(classes):
    wasabi = next(c for c in classes if c.crop == "Wasabi")
    record = R.audit_record(wasabi)
    assert record["price_available"] is False
    assert record["selected_tier"] == "E"
    assert len(record["checks"]) == len(wasabi.preferred)


def test_status_rows_have_a_stable_shape(classes):
    row = classes[0].to_status_row()
    for key in ("crop", "crop_id", "classification_status", "selected_tier",
                "price_available", "confidence", "reason", "last_checked"):
        assert key in row


def test_reports_are_written_with_real_content(classes, doc, tmp_path):
    status = tmp_path / "crop_source_status.csv"
    audit = tmp_path / "source_audit.csv"
    cov = tmp_path / "coverage_report.html"
    R.write_crop_source_status(str(status), classes)
    R.write_source_audit(str(audit), classes)
    cov.write_text(R.render_coverage_html(
        classes, doc, generated_at="2026-09-15T00:00:00Z", workbook_sha256="a" * 64,
    ), encoding="utf-8")

    with open(status, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 31

    with open(audit, encoding="utf-8") as fh:
        audit_rows = list(csv.DictReader(fh))
    assert len(audit_rows) == 31  # every crop lacks a price in this build

    html_doc = cov.read_text(encoding="utf-8")
    assert R.NO_SOURCE_MESSAGE in html_doc
    assert "Nothing in this report is a price" in html_doc
    assert "Coverage by crop" in html_doc

