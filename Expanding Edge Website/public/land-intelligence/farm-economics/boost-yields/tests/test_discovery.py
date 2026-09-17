"""Tests for the Section 3 automated discovery pass (price_pipeline/discovery.py)."""
from __future__ import annotations

from price_pipeline import discovery as DISC


class FakeRow:
    def __init__(self, crop_id, crop_name, category):
        self.crop_id = crop_id
        self.crop_name = crop_name
        self.category = category


def test_real_alberta_match_is_high_confidence():
    rec = DISC.discover_crop(
        "lentils", "Lentils", "Vegetables",
        alberta_usable=DISC._load_alberta_usable_crops(),
        surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.selected_tier_ca == "B"
    assert rec.confidence_ca == "high"
    assert "ab_price_pipeline" in rec.selected_source_ca


def test_insurance_only_crops_are_not_treated_as_priced():
    """Carrots only have an insurance_reference_price observation in the Alberta
    dataset, which the sources.json metadata explicitly marks NOT usable for farm
    economics -- discovery must not launder that into a confirmed price tier."""
    alberta = DISC._load_alberta_usable_crops()
    assert "carrots" not in alberta
    rec = DISC.discover_crop(
        "carrots", "Carrot", "Vegetables",
        alberta_usable=alberta, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.selected_tier_ca is None


def test_unmatched_crop_gets_no_lead_note():
    rec = DISC.discover_crop(
        "cacao", "Cacao", "Fruits and Tree Nuts",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.selected_tier_ca is None
    assert rec.selected_tier_us is None
    assert "no matching crop_id" in rec.reviewer_notes


def test_known_identity_trap_crop_gets_caution_note():
    rec = DISC.discover_crop(
        "mustard-and-other-greens", "Mustard and Other Greens", "Vegetables",
        alberta_usable={}, surveys=[], ca_sources=DISC.WC.load_ca_catalog(),
        wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert "CAUTION" in rec.reviewer_notes
    assert "identity trap" in rec.reviewer_notes


def test_run_discovery_respects_category_filter():
    registry = [
        FakeRow("apple", "Apple", "Fruits and Tree Nuts"),
        FakeRow("carrot", "Carrot", "Vegetables"),
    ]
    records = DISC.run_discovery(registry, category_filter="Vegetables")
    assert [r.crop_id for r in records] == ["carrot"]


def test_run_discovery_respects_crop_filter():
    registry = [
        FakeRow("apple", "Apple", "Fruits and Tree Nuts"),
        FakeRow("saffron", "Saffron", "Culinary Herbs and Spices"),
    ]
    records = DISC.run_discovery(registry, crop_filter="saffron")
    assert [r.crop_id for r in records] == ["saffron"]


def test_rice_does_not_match_price_substring_in_mushroom_survey():
    rec = DISC.discover_crop(
        "rice-including-wild", "Rice (including wild)", "Ineligible Crops",
        alberta_usable={}, surveys=DISC.WC.load_special_surveys(),
        ca_sources=[], wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert rec.checked_us_nass_special_survey is True
    assert "none apply to this crop_id" in rec.reviewer_notes
    assert "NASS special survey 'mushrooms' applies" not in rec.reviewer_notes


def test_table_beet_does_not_match_statcan_table_title():
    rec = DISC.discover_crop(
        "beet-table", "Beet, Table", "Vegetables",
        alberta_usable={}, surveys=[], ca_sources=DISC.WC.load_ca_catalog(),
        wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert "ca_statcan_1810024501" not in rec.reviewer_notes
    assert rec.selected_tier_ca is None


def test_grain_sorghum_does_not_match_generic_grains_coverage():
    rec = DISC.discover_crop(
        "grain-sorghum", "Grain sorghum", "Ineligible Crops",
        alberta_usable={}, surveys=[], ca_sources=DISC.WC.load_ca_catalog(),
        wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert "ca_ab_cropping_alternatives" not in rec.reviewer_notes
    assert "REJECTED:" in rec.reviewer_notes


def test_mustard_seed_aliases_to_alberta_mustard():
    rec = DISC.discover_crop(
        "mustard-seed", "Mustard seed", "Ineligible Crops",
        alberta_usable=DISC._load_alberta_usable_crops(),
        surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.selected_tier_ca == "B"
    assert rec.confidence_ca == "high"
    assert "mustard" in (rec.selected_source_ca or "")


def test_bean_dry_edible_aliases_to_alberta_dry_beans():
    rec = DISC.discover_crop(
        "bean-dry-edible", "Bean, Dry, Edible", "Vegetables",
        alberta_usable=DISC._load_alberta_usable_crops(),
        surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.selected_tier_ca == "B"
    assert "dry-beans" in rec.reviewer_notes


def test_mushroom_special_survey_is_a_confirmed_unretrieved_lead():
    rec = DISC.discover_crop(
        "mushroom-cultivated", "Mushroom (Cultivated)", "Vegetables",
        alberta_usable={}, surveys=DISC.WC.load_special_surveys(),
        ca_sources=[], wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert rec.checked_us_nass_special_survey is True
    assert rec.selected_tier_us is None
    assert rec.checked_by == "manual_review"
    assert "has_price_field=True" in rec.reviewer_notes


def test_nass_index_assigns_tier_a_for_retrieved_mushrooms():
    nass_index = {
        "by_crop_id": {
            "mushroom-cultivated": [{
                "short_desc": "MUSHROOMS - PRICE RECEIVED, MEASURED IN $ / LB",
                "year": "2026",
                "value": 1.37,
                "unit_desc": "$ / LB",
                "raw_file": "raw/nass/price_received_MUSHROOMS.json",
            }],
        },
    }
    rec = DISC.discover_crop(
        "mushroom-cultivated", "Mushroom (Cultivated)", "Vegetables",
        alberta_usable={}, surveys=DISC.WC.load_special_surveys(),
        ca_sources=[], wide_crop_keys=set(), checked_at="2026-01-01",
        nass_index=nass_index,
    )
    assert rec.checked_us_nass is True
    assert rec.selected_tier_us == "A"
    assert rec.confidence_us == "high"
    assert "RETRIEVED NASS" in rec.reviewer_notes


def test_nass_mustard_oilseed_does_not_attach_to_greens():
    nass_index = {
        "by_crop_id": {
            "mustard-seed": [{
                "short_desc": "MUSTARD - PRICE RECEIVED, MEASURED IN $ / CWT",
                "year": "2025", "value": 40.0, "unit_desc": "$ / CWT",
                "raw_file": "raw/nass/x.json",
            }],
        },
    }
    greens = DISC.discover_crop(
        "mustard-and-other-greens", "Mustard and Other Greens", "Vegetables",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01", nass_index=nass_index,
    )
    seed = DISC.discover_crop(
        "mustard-seed", "Mustard seed", "Ineligible Crops",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01", nass_index=nass_index,
    )
    assert greens.selected_tier_us is None
    assert seed.selected_tier_us == "A"


def test_statcan_lookup_is_always_recorded():
    rec = DISC.discover_crop(
        "cacao", "Cacao", "Fruits and Tree Nuts",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.checked_ca_statcan is True
    assert "ca_tier not_applicable" in rec.reviewer_notes


def test_statcan_tomato_is_present_but_not_selected_as_farm_gate_tier():
    rec = DISC.discover_crop(
        "tomato-including-tomatillo", "Tomato (including Tomatillo)", "Vegetables",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.checked_ca_statcan is True
    assert "Tomatoes, per kilogram" in rec.reviewer_notes
    assert rec.selected_tier_ca is None


def test_statcan_peppers_do_not_attach_to_spice_pepper():
    rec = DISC.discover_crop(
        "culinary-herbs-and-spices-pepper", "Pepper", "Culinary Herbs and Spices",
        alberta_usable={}, surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert rec.checked_ca_statcan is True
    assert "Peppers, per kilogram" not in rec.reviewer_notes
    assert "ca_tier not_applicable" in rec.reviewer_notes


def test_mustard_seed_spot_check_is_oilseed_not_greens():
    seed = DISC.discover_crop(
        "mustard-seed", "Mustard seed", "Ineligible Crops",
        alberta_usable=DISC._load_alberta_usable_crops(),
        surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    greens = DISC.discover_crop(
        "mustard-and-other-greens", "Mustard and Other Greens", "Vegetables",
        alberta_usable=DISC._load_alberta_usable_crops(),
        surveys=[], ca_sources=[], wide_crop_keys=set(),
        checked_at="2026-01-01",
    )
    assert seed.selected_tier_ca == "B"
    assert "OILSEED" in seed.reviewer_notes
    assert greens.selected_tier_ca is None
    assert "SPOT-CHECK 1.2" in greens.reviewer_notes
    assert "mustard" not in (greens.selected_source_ca or "")


def test_lavender_census_survey_has_no_price_field():
    rec = DISC.discover_crop(
        "lavender", "Lavender", "Culinary Herbs and Spices",
        alberta_usable={}, surveys=DISC.WC.load_special_surveys(),
        ca_sources=[], wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert rec.checked_us_nass_special_survey is True
    assert rec.checked_us_census_specialty is True
    assert rec.selected_tier_us is None
    assert "has_price_field=False" in rec.reviewer_notes


def test_maple_shade_tree_is_not_maple_syrup():
    rec = DISC.discover_crop(
        "maple", "Maple", "Floriculture and Nursery Crops / Deciduous Shade Trees",
        alberta_usable={}, surveys=DISC.WC.load_special_surveys(),
        ca_sources=[], wide_crop_keys=set(), checked_at="2026-01-01",
    )
    assert "maple_syrup" not in rec.reviewer_notes or "does NOT apply" in rec.reviewer_notes
    assert rec.selected_tier_us is None
    assert "deciduous shade tree" in rec.reviewer_notes


def test_review_queue_flags_incomplete_checklist():
    rec = DISC.CropDiscoveryRecord(
        crop_id="cacao", crop_name="Cacao", checked_ca_provincial=True,
        confidence_us="high", confidence_ca="high",
    )
    assert DISC.checklist_incomplete(rec)
    assert DISC.in_review_queue(rec)


def test_dashboard_rows_count_confirmed_tiers():
    registry = [
        FakeRow("lentils", "Lentils", "Vegetables"),
        FakeRow("apple", "Apple", "Fruits and Tree Nuts"),
    ]
    records = [
        DISC.CropDiscoveryRecord(
            crop_id="lentils", crop_name="Lentils",
            selected_tier_ca="B", confidence_ca="high", confidence_us="low",
            checked_ca_provincial=True,
        ),
    ]
    rows = {r["category"]: r for r in DISC.dashboard_rows(registry, records)}
    assert rows["Vegetables"]["total_crops"] == 1
    assert rows["Vegetables"]["tier_b"] == 1
    assert rows["Vegetables"]["discovery_complete"] == 0
    assert rows["Fruits and Tree Nuts"]["discovered"] == 0
