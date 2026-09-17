from price_pipeline import yield_elements as YE
from price_pipeline import yield_schema as YS
from price_pipeline.full_coverage_cli import build_parser


def test_taxonomy_is_closed_and_logged():
    assert "soil_fertility" in YS.ELEMENT_TYPES
    assert "protected_environment" in YS.ELEMENT_TYPES
    assert "colony_nutrition" in YS.ELEMENT_TYPES
    assert any(c["change"] == "added protected_environment" for c in YS.TAXONOMY_CHANGELOG)


def test_import_requires_source_url_and_known_crop():
    rows = YE.import_existing_yield_factors(retrieved_at="2026-01-01T00:00:00Z")
    assert rows
    assert all(r.source_url for r in rows)
    mapped = set(YS.YIELD_FACTOR_CROP_MAP.values()) | {
        "hops", "mushroom-cultivated", "honey", "maple-syrup",
        "potato", "onion", "bean-dry-edible", "broccoli-including-broccoli-raab",
        "carrot", "strawberry", "apple", "almond", "blueberry",
        "asparagus", "cabbage-including-chinese", "sweet-potato", "eggplant",
        "garlic", "grape-including-raisin", "cherry", "raspberry",
        "cauliflower", "spinach", "melon-all-types",
        "ginseng", "stevia", "coneflower", "st-john-s-wort",
        "medicinal-herbs-fenugreek", "medicinal-herbs-lavender",
        "artichoke", "okra", "beet-table", "sugar-beet", "pumpkin",
        "squash-summer-and-winter", "sweet-corn", "fig", "blackberry",
        "pistachio", "avocado", "walnut", "apricot", "kiwi", "macadamia",
        "pineapple", "papaya", "citrus", "date", "peach", "olive",
    }
    assert all(r.crop_id in mapped for r in rows)
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


def test_curated_papers_have_quantified_effects_and_urls():
    rows = YE.load_curated_from_papers(retrieved_at="2026-01-01T00:00:00Z")
    assert len(rows) >= 6
    by_crop = {r.crop_id for r in rows}
    assert {"hops", "mushroom-cultivated", "honey", "maple-syrup"} <= by_crop
    assert all(r.source_url.startswith("http") for r in rows)
    assert all(
        r.claimed_effect.strip() or r.source_type == "extension_guidance"
        for r in rows
    )
    hops_n = next(r for r in rows if r.element_id.startswith("hops-n-rate"))
    assert "386.7" in hops_n.claimed_effect and "245.8" in hops_n.claimed_effect
    assert "10.1371/journal.pone.0258430" not in " ".join(r.source_url for r in rows)
    onion_n = next(r for r in rows if r.element_id == "onion-n-rate-82kg-vs-0-yeshiwas-2024")
    assert "26.77" in onion_n.claimed_effect and "19.09" in onion_n.claimed_effect
    assert "57.84" not in onion_n.claimed_effect
    blueberry = next(r for r in rows if r.crop_id == "blueberry")
    assert "R²" in blueberry.claimed_effect or "R2" in blueberry.claimed_effect
    almond = next(r for r in rows if r.crop_id == "almond")
    assert almond.conflict_of_interest_flag is True
    cabbage = next(r for r in rows if r.crop_id == "cabbage-including-chinese")
    assert "30.3" in cabbage.claimed_effect and "75.8" in cabbage.claimed_effect
    grape = next(r for r in rows if r.crop_id == "grape-including-raisin")
    assert "17.11" in grape.claimed_effect
    sweet_potato = next(r for r in rows if r.crop_id == "sweet-potato")
    assert "1.7" in sweet_potato.claimed_effect
    spinach = next(r for r in rows if r.crop_id == "spinach")
    assert spinach.effect_direction == "no_significant_effect"
    assert "37.8" in spinach.claimed_effect
    ginseng = next(r for r in rows if r.crop_id == "ginseng")
    assert "816.56" in ginseng.claimed_effect
    assert ginseng.effect_direction == "mixed"
    fenugreek = next(r for r in rows if r.crop_id == "medicinal-herbs-fenugreek")
    assert "15.29" in fenugreek.claimed_effect
    assert fenugreek.source_url.startswith("http")
    pistachio = next(r for r in rows if r.crop_id == "pistachio")
    assert pistachio.effect_direction == "no_significant_effect"
    citrus = next(r for r in rows if r.crop_id == "citrus")
    assert any(r.effect_direction == "no_significant_effect" for r in rows if r.crop_id == "citrus")
    pineapple = next(r for r in rows if r.element_id.startswith("pineapple-density"))
    assert "25 and 33" in pineapple.claimed_effect
    beet_table = [r for r in rows if r.crop_id == "beet-table"]
    sugar = [r for r in rows if r.crop_id == "sugar-beet" and r.raw_source_path.endswith("curated_from_papers.json")]
    assert beet_table and sugar
    assert all(r.crop_id != "sugar-beet" for r in beet_table)
    kiwi = next(r for r in rows if r.crop_id == "kiwi")
    assert "regulatory_flag=true" in kiwi.reviewer_notes
    assert "11,858,869" not in " ".join(r.source_url for r in rows)


def test_cli_exposes_yield_commands():
    parser = build_parser()
    args = parser.parse_args(["yield-discover", "--category", "Vegetables", "--element-type", "soil_fertility"])
    assert args.element_type == "soil_fertility"
    q = parser.parse_args(["yield-review-queue", "--tier", "D"])
    assert q.tier == "D"
