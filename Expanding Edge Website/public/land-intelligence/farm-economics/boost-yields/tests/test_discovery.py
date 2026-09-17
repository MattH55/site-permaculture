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
