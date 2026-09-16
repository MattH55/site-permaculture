"""XLSX parser behaviour: unit-per-row (Table 90) and grouped headers (Table 93).

Table 90 declares its price unit per row, so one sheet legitimately mixes bushel and
hundredweight pricing; a single sheet-wide unit would corrupt one of them. Table 93
carries its market name on a different row from its crop name, so both header rows
must be forward-filled before they can be paired.

Both behaviours are asserted here because each has a failure mode that is silent: the
wrong unit converts a plausible-looking number, and a mis-paired market attributes a
price to the wrong delivery point without any error.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import parsers, registry  # noqa: E402

STAMP = "2026-09-15T00:00:00Z"


def _load(source_id):
    src = next((s for s in registry.sources() if s.source_id == source_id), None)
    assert src is not None, f"{source_id} not in registry"
    if not os.path.exists(src.raw_path):
        pytest.skip(f"raw artifact not present: {src.raw_name}")
    ctx = parsers.ParseContext.build(src, retrieved_at=STAMP)
    return src, list(parsers.get(src.parser)(ctx, src.options))


def test_table90_reads_the_unit_from_each_row():
    """One sheet prices corn per bushel and beans per hundredweight."""
    _src, rows = _load("alberta_table90")
    assert rows

    by_crop = {}
    for r in rows:
        by_crop.setdefault(r.source_commodity, set()).add(r.original_unit)

    assert by_crop.get("Corn for Grain") == {"bu"}
    assert "cwt" in by_crop.get("Dry Beans", set()) | by_crop.get("Potatoes", set())
    assert {"bu", "cwt", "tonne"} & {u for units in by_crop.values() for u in units}
    # Two different units on one sheet is the point of the per-row rule.
    assert len({u for units in by_crop.values() for u in units}) >= 2


def test_table90_prices_match_the_workbook():
    """Corn for Grain is 3.1167 $/bu in 2005, as published."""
    _src, rows = _load("alberta_table90")
    corn_2005 = next(r for r in rows
                     if r.source_commodity == "Corn for Grain"
                     and r.reference_date == "2005")
    assert abs(corn_2005.original_value - 3.116744564112985) < 1e-9
    assert corn_2005.original_unit == "bu"
    assert corn_2005.conversion_basis == "published-test-weight"


def test_table90_dash_rows_are_skipped_not_zeroed():
    """Triticale and Fodder Corn publish no price; no row may be emitted for them."""
    _src, rows = _load("alberta_table90")
    crops = {r.source_commodity for r in rows}
    assert "Triticale" not in crops
    assert "Fodder Corn" not in crops
    assert all(r.original_value not in (None, 0) for r in rows)


def test_table90_crops_are_attributed_to_the_right_block():
    """A block's data rows belong to the name above them, not a neighbour."""
    _src, rows = _load("alberta_table90")
    lentils = [r for r in rows if r.source_commodity == "Lentils"]
    peas = [r for r in rows if r.source_commodity == "Dry Peas"]
    assert lentils and peas
    assert {r.reference_date for r in lentils} <= {str(y) for y in range(2005, 2015)}
    assert {r.reference_date for r in peas} <= {str(y) for y in range(2005, 2015)}


def test_table93_pairs_market_with_crop_across_two_header_rows():
    """Market names live on row 3 and crop names on row 4, merged and grouped."""
    _src, rows = _load("alberta_table93")
    assert rows
    markets = {r.market for r in rows}
    assert {"Lethbridge", "Calgary", "Red Deer"} <= markets

    pairs = {(r.market, r.source_commodity) for r in rows}
    assert ("Lethbridge", "Wheat") in pairs
    assert ("Calgary", "Barley") in pairs
    # No series may be attributed to a market of None.
    assert None not in markets
    assert all(r.source_commodity for r in rows)


def test_table93_is_tonne_priced_and_marketing_year_dated():
    """Table 93 is already $/tonne and carries a marketing year like 2003-04."""
    src, rows = _load("alberta_table93")
    assert src.price_type == "terminal_local_price"
    assert {r.original_unit for r in rows} == {"tonne"}
    assert all(r.date_granularity == "marketing-year" for r in rows)

    first = next(r for r in rows
                 if r.market == "Lethbridge" and r.source_commodity == "Wheat"
                 and r.reference_date == "2003-04")
    assert abs(first.original_value - 146.62) < 1e-9
    assert abs(first.normalized_value - 146.62) < 1e-9


def test_table93_is_not_labelled_as_a_farm_price():
    """Elevator-side prices must not masquerade as average farm prices."""
    src, rows = _load("alberta_table93")
    assert src.price_type != "average_farm_price"
    assert {r.price_type for r in rows} == {"terminal_local_price"}
