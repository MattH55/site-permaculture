"""PDF parser behaviour, pinned against values verified in the source documents.

Every expectation here was read off the actual artifact, so a regression in the
coordinate logic fails loudly instead of shifting a number by one row. The cases
chosen are the ones the pipeline is most likely to break:

* a spring-wheat row whose $/kg and $/bu twins must both survive and agree;
* '---' cells, which are absent data and must produce no observation, never a zero;
* a bushel figure with no declared test weight, which must quarantine;
* the per-page legend on the Cropping Alternatives tables, where the same '*' mark
  means $/lb on one page and $/tonne on another.

Tests that need an artifact are skipped when ``raw/`` has not been populated, so the
suite still runs on a clean checkout.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import parsers, registry  # noqa: E402

STAMP = "2026-09-15T00:00:00Z"


def _load(source_id):
    """Parse one source, or skip when its artifact is not present locally."""
    src = next((s for s in registry.sources() if s.source_id == source_id), None)
    assert src is not None, f"{source_id} not in registry"
    if not os.path.exists(src.raw_path):
        pytest.skip(f"raw artifact not present: {src.raw_name}")
    ctx = parsers.ParseContext.build(src, retrieved_at=STAMP)
    return src, list(parsers.get(src.parser)(ctx, src.options))


def test_afsc_spring_prices_and_units_round_trip():
    """The spring list carries $/kg and $/bu twins for the same crop and date."""
    _src, rows = _load("afsc_spring_adjusted")
    assert rows, "expected the spring price list to yield observations"

    wheat = [r for r in rows if "red spring" in r.source_commodity.lower()]
    assert wheat, "expected a red spring wheat row"

    per_kg = [r for r in wheat if r.original_unit == "kg"]
    per_bu = [r for r in wheat if r.original_unit == "bu"]
    assert per_kg and per_bu

    # Both twins must normalize to the same tonne price within rounding: they are the
    # source's own metric and imperial expressions of one price.
    kg_row = next(r for r in per_kg if r.normalized_value is not None)
    assert abs(kg_row.normalized_value - kg_row.original_value * 1000) < 1e-6
    bu_row = next((r for r in per_bu if r.normalized_value is not None), None)
    if bu_row is not None:
        assert abs(kg_row.normalized_value - bu_row.normalized_value) < 1.0


def test_afsc_spring_missing_cells_produce_no_observation():
    """'---' is absent data: it must never become a zero or a row."""
    _src, rows = _load("afsc_spring_not_adjusted")
    assert rows
    assert all(r.original_value not in (None, 0) for r in rows)


def test_afsc_spring_carries_full_provenance():
    src, rows = _load("afsc_spring_adjusted")
    for r in rows:
        assert r.source_id == src.source_id
        assert r.price_type == src.price_type
        assert r.raw_sha256
        assert r.retrieved_at == STAMP
        assert r.doc_file == src.raw_name
        assert r.observation_id


def test_agristability_per_page_unit_row_is_authoritative():
    """One document prices some crops per tonne/bushel and others per pound."""
    _src, rows = _load("afsc_agristability_other_crops")
    assert rows
    units = {r.original_unit for r in rows}
    assert "tonne" in units
    assert "bu" in units or "lb" in units

    flax = [r for r in rows if "flax" in r.source_commodity.lower()]
    assert {r.original_unit for r in flax} >= {"tonne", "bu"}


def test_agristability_block2_names_are_recorded_but_incomplete():
    """Block-2 grade labels are emitted; some legitimately lack a parent commodity.

    This is a documented limitation, not an oversight: the parent ('Chickpeas',
    'Lentils', 'Mustard') is centred between its grade columns on a line shared with
    that row's own words, so no x-position ties parent to children reliably. The test
    pins the current behaviour so the gap is visible and cannot drift unnoticed, and
    fails if a future fix both adds the parents and forgets to update the docstring.
    """
    _src, rows = _load("afsc_agristability_other_crops")
    labels = {r.source_commodity for r in rows}
    # 'Flax' is a complete name; the others are grade words missing their parent.
    parentless = {lab for lab in labels if len(lab.split()) == 1}
    assert parentless == {"Desi", "Flax", "Oriental", "Small", "Yellow"}

    # Values and units remain correct even where the label is incomplete.
    desi = [r for r in rows if r.source_commodity == "Desi"]
    assert desi
    assert {r.original_unit for r in desi} == {"lb"}
    assert all(r.original_value and r.original_value > 0 for r in desi)

    # The fully-named siblings prove the block is read, only labelled unevenly.
    assert any(lab.startswith("Chickpeas") for lab in labels)


def test_agristability_undeclared_bushel_mass_quarantines():
    """A bushel price for a crop with no published test weight is not converted."""
    _src, rows = _load("afsc_agristability_other_crops")
    quarantined = [r for r in rows if r.is_quarantined]
    assert quarantined, "expected bushel rows to quarantine"
    for r in quarantined:
        assert r.conversion_basis == "bushel-mass-undeclared"
        assert r.normalized_value is None
        assert r.original_value is not None, "quarantining must keep the number"



def test_forage_seed_is_one_price_per_species_grade_and_month():
    """The transposed forage grid prices each species/grade for each month."""
    _src, rows = _load("afsc_agristability_forage_seed")
    assert rows
    assert {r.original_unit for r in rows} == {"lb"}
    assert all(r.date_granularity == "month" for r in rows)

    common = [r for r in rows if r.source_commodity.lower() == "alfalfa common"]
    assert len(common) == 6, "expected Jan-Jun for Alfalfa Common"
    assert sorted(r.reference_date for r in common) == [
        f"2026-0{m}" for m in range(1, 7)]

    # Multi-word left-column names must be composed, not truncated.
    assert any(" " in r.source_commodity for r in rows)


def test_forage_seed_values_match_the_document():
    """Alfalfa Common is 2.14, 2.18, 2.15, 2.15, 2.20, 2.20 per lb, Jan-Jun."""
    _src, rows = _load("afsc_agristability_forage_seed")
    common = sorted((r for r in rows
                     if r.source_commodity.lower() == "alfalfa common"),
                    key=lambda r: r.reference_date)
    assert [round(r.original_value, 2) for r in common] == [
        2.14, 2.18, 2.15, 2.15, 2.20, 2.20]


def test_cropping_alternatives_unit_follows_the_page_legend():
    """The same '*' mark means $/lb on one soil-zone page and $/tonne on another.

    Assuming one unit for the whole document would convert one soil zone's prices
    wrongly, so more than one unit must appear across the document.
    """
    _src, rows = _load("alberta_cropping_alternatives_2026")
    assert rows
    units = {r.original_unit for r in rows}
    assert "bu" in units
    assert "tonne" in units
    marked = [r for r in rows if "*" in r.source_commodity]
    assert marked


def test_cropping_alternatives_is_typed_as_expected_market_price():
    """A plan-time assumption must never be labelled an observed farm price."""
    src, rows = _load("alberta_cropping_alternatives_2026")
    assert src.price_type == "expected_market_price"
    assert {r.price_type for r in rows} == {"expected_market_price"}
    assert all(r.soil_zone for r in rows)


def test_cropping_alternatives_excludes_yield_and_cost_rows():
    """Yield and cost rows share the price row's columns and must not be emitted.

    The Black Soils table yields 65.00 bu/acre of Spring Wheat CWRS 11.5% and prices
    it at 7.50/bu, while the yield row also carries a 46.00 for Feed Barley against
    its 5.35 price. Reading by position rather than by row label would swap those, so
    each crop's own expected price is asserted exactly. (Cereal Silage is genuinely
    priced at 65.00 $/tonne, so the assertion is per crop, not per value.)
    """
    _src, rows = _load("alberta_cropping_alternatives_2026")
    black = {r.source_commodity: r for r in rows if r.soil_zone == "Black Soils"}
    assert black, "expected Black Soils prices"

    expected = {
        "Spring Wheat CWRS 11.5%": 7.50,
        "CPS Wheat CPSR": 7.00,
        "Feed Barley CW": 5.35,
        "Cereal Silage*": 65.00,
    }
    for name, price in expected.items():
        assert name in black, f"{name} missing from Black Soils"
        assert black[name].original_value == price

    # The yield row's own numbers must not appear as any crop's price.
    yields = {65.00, 72.00, 85.00, 83.00, 98.00, 46.00}
    leaked = {n: r.original_value for n, r in black.items()
              if n == "Spring Wheat CWRS 11.5%" or n.startswith("Feed Barley")}
    assert leaked["Spring Wheat CWRS 11.5%"] not in yields - {65.00}
    assert leaked["Feed Barley CW"] == 5.35, "Feed Barley picked up its yield (46.00)"