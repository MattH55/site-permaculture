from price_pipeline import yield_elements as YE
from price_pipeline import yield_schema as YS
from price_pipeline.full_coverage_cli import build_parser


def test_taxonomy_is_closed_and_logged():
    assert "soil_fertility" in YS.ELEMENT_TYPES
    assert "protected_environment" in YS.ELEMENT_TYPES
    assert YS.TAXONOMY_CHANGELOG[0]["change"] == "added protected_environment"


def test_import_requires_source_url_and_known_crop():
    rows = YE.import_existing_yield_factors(retrieved_at="2026-01-01T00:00:00Z")
    assert rows
    assert all(r.source_url for r in rows)
    assert all(r.crop_id in YS.YIELD_FACTOR_CROP_MAP.values() for r in rows)
    assert all(r.element_type in YS.ELEMENT_TYPES for r in rows)
    assert all(r.source_tier in YS.SOURCE_TIERS for r in rows)


def test_peas_map_to_dry_edible_not_chickpeas():
    rows = YE.import_existing_yield_factors(retrieved_at="2026-01-01T00:00:00Z")
    pea = [r for r in rows if r.crop_id == "pea-dry-edible"]
    assert pea
    assert all(r.crop_id != "chickpeas-large-and-small" for r in rows)


def test_pepper_maps_to_vegetable_not_spice():
    rows = YE.import_existing_yield_factors(retrieved_at="2026-01-01T00:00:00Z")
    pep = [r for r in rows if "pepper" in r.crop_id]
    assert pep
    assert all(r.crop_id == "pepper" for r in pep)


def test_livestock_and_ornamental_buckets_are_skipped():
    rows = YE.import_existing_yield_factors(retrieved_at="2026-01-01T00:00:00Z")
    ids = {r.crop_id for r in rows}
    assert "beef" not in ids
    assert "dairy" not in ids
    assert "ornamentals" not in ids


def test_claimed_effect_empty_when_no_size():
    assert YE._claimed_effect({"effect_size": None, "effect_unit": "%", "direction": "positive"}) == ""


def test_cli_exposes_yield_commands():
    parser = build_parser()
    args = parser.parse_args(["yield-discover", "--category", "Vegetables", "--element-type", "soil_fertility"])
    assert args.element_type == "soil_fertility"
    q = parser.parse_args(["yield-review-queue", "--tier", "D"])
    assert q.tier == "D"
