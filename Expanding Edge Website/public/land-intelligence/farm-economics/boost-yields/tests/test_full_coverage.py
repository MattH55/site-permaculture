"""Tests for the full-coverage master-list ingestion (usda_master_list, napcs_ca,
crop_registry_full). These exercise the real cached source files under
data/raw/usda_master_list/ and data/raw/napcs/ -- if those files are missing, the
retrieval step (see HANDOFF.md) needs to be re-run rather than the test skipped
silently, so a missing file fails loudly.
"""
from __future__ import annotations

import os

import pytest

from price_pipeline import crop_registry_full as REG
from price_pipeline import full_coverage_cli as CLI
from price_pipeline import napcs_ca as NAPCS
from price_pipeline import usda_master_list as USDA


class TestCliSurface:
    def test_parser_exposes_crop_and_review_queue(self):
        parser = CLI.build_parser()
        disc = parser.parse_args(["discover", "--crop", "saffron"])
        assert disc.crop == "saffron"
        queue = parser.parse_args(["review-queue", "--json"])
        assert queue.command == "review-queue"
        dash = parser.parse_args(["dashboard", "--json"])
        assert dash.command == "dashboard"


def _require(path: str) -> str:
    if not os.path.exists(path):
        pytest.fail(f"missing cached source file: {path} -- re-run the retrieval step "
                    f"documented in HANDOFF.md before running these tests")
    return path


class TestUsdaMasterList:
    def test_parses_all_six_appendices(self):
        raw = USDA._extract_pdf_text(_require(USDA.PDF_PATH))
        rows = USDA.parse_master_list(raw)
        appendices = {r.appendix for r in rows}
        assert appendices == {"A", "B", "C", "D", "E", "F"}

    def test_bean_and_pea_variants_are_parent_linked_not_merged(self):
        raw = USDA._extract_pdf_text(_require(USDA.PDF_PATH))
        rows = USDA.parse_master_list(raw)
        bean_variants = [r.crop_name for r in rows if r.parent_crop == "Bean"]
        pea_variants = [r.crop_name for r in rows if r.parent_crop == "Pea"]
        assert bean_variants == ["Snap or Green", "Lima", "Dry, Edible"]
        assert pea_variants == ["Garden", "English or Edible Pod", "Dry, Edible"]

    def test_floriculture_subsections_are_not_emitted_as_crop_rows(self):
        raw = USDA._extract_pdf_text(_require(USDA.PDF_PATH))
        rows = USDA.parse_master_list(raw)
        names = {r.crop_name for r in rows}
        assert "Christmas Trees" not in names
        assert "Oil Seed Crops (including oil and non-oil cultivars)" not in names

    def test_mustard_greens_and_mustard_seed_are_distinct_rows(self):
        raw = USDA._extract_pdf_text(_require(USDA.PDF_PATH))
        rows = USDA.parse_master_list(raw)
        by_name = {r.crop_name: r for r in rows}
        assert by_name["Mustard and Other Greens"].is_eligible_specialty is True
        assert by_name["Mustard seed"].is_eligible_specialty is False

    def test_flax_and_flaxseed_are_distinct_ineligible_rows(self):
        raw = USDA._extract_pdf_text(_require(USDA.PDF_PATH))
        rows = USDA.parse_master_list(raw)
        by_name = {r.crop_name: r for r in rows}
        assert by_name["Flax"].subsection == "Fiber Crops"
        assert by_name["Flaxseed"].subsection == "Oil Seed Crops (including oil and non-oil cultivars)"

    def test_changelog_records_additions(self, tmp_path):
        previous = [{
            "crop_name": "Apple", "category": "Fruits and Tree Nuts", "parent_crop": "",
        }]
        current = [
            USDA.MasterListRow(
                crop_name="Apple", category="Fruits and Tree Nuts",
                appendix="A", subsection=None, parent_crop=None,
                is_eligible_specialty=True, source_url="x", retrieved_at="2026-01-01",
            ),
            USDA.MasterListRow(
                crop_name="Kiwi", category="Fruits and Tree Nuts",
                appendix="A", subsection=None, parent_crop=None,
                is_eligible_specialty=True, source_url="x", retrieved_at="2026-01-01",
            ),
        ]
        out = tmp_path / "changelog.csv"
        events = USDA.write_master_list_changelog(
            previous, current, str(out),
            pdf_sha256="abc", retrieved_at="2026-01-01",
        )
        assert [e["change_type"] for e in events] == ["added"]
        assert events[0]["crop_name"] == "Kiwi"


class TestNapcsCa:
    def test_loads_six_level_hierarchy(self):
        rows = NAPCS.load_napcs_agricultural_codes(_require(NAPCS.RAW_PATH))
        levels = {r["level"] for r in rows}
        assert levels == {"1", "2", "3", "4", "5", "6"}

    def test_culinary_herbs_are_bucketed_not_itemized(self):
        rows = NAPCS.load_napcs_agricultural_codes(_require(NAPCS.RAW_PATH))
        basil_hits = NAPCS.find_by_keyword(rows, "basil")
        assert basil_hits == []
        herb_bucket = [r for r in rows if r["code"] == "114221382"]
        assert herb_bucket and "fine herbs" in herb_bucket[0]["description"].lower()

    def test_pulses_are_itemized_by_variety(self):
        rows = NAPCS.load_napcs_agricultural_codes(_require(NAPCS.RAW_PATH))
        lentil_hits = NAPCS.find_by_keyword(rows, "lentil")
        names = {r["description"] for r in lentil_hits}
        assert "Red lentils" in names


class TestCropRegistry:
    @pytest.fixture(scope="class")
    @staticmethod
    def registry_and_findings():
        usda_rows = [r.to_dict() for r in USDA.ingest()]
        napcs_rows = NAPCS.ingest()
        registry = REG.build_crop_registry(usda_rows, napcs_rows, retrieved_at="2026-01-01T00:00:00Z")
        findings = REG.audit_identity(registry)
        return registry, findings

    def test_crop_ids_are_unique(self, registry_and_findings):
        registry, _ = registry_and_findings
        ids = [r.crop_id for r in registry]
        assert len(ids) == len(set(ids))

    def test_duplicate_names_across_subsections_get_distinct_ids(self, registry_and_findings):
        registry, _ = registry_and_findings
        rose_ids = [r.crop_id for r in registry if "rose" in r.crop_id]
        assert len(rose_ids) >= 3
        assert len(set(rose_ids)) == len(rose_ids)

    def test_known_identity_traps_are_present(self, registry_and_findings):
        _, findings = registry_and_findings
        flag_types = {f["flag_type"] for f in findings}
        assert "multi_commodity_same_name" in flag_types
        assert "excluded_from_us_specialty_definition" in flag_types

    def test_napcs_match_is_never_forced(self, registry_and_findings):
        registry, _ = registry_and_findings
        # a crop with no plausible NAPCS leaf must be null, not a wrong guess
        rose = next(r for r in registry if r.crop_id == "rose")
        # Rose is a florist/nursery crop; NAPCS's agricultural-goods variant has no
        # matching leaf for it, so this must stay null rather than mis-matching
        # against an unrelated leaf.
        assert rose.napcs_code_match is None

    def test_honey_and_maple_syrup_are_extra_rows_not_trees(self, registry_and_findings):
        registry, findings = registry_and_findings
        by_id = {r.crop_id: r for r in registry}
        assert by_id["honey"].usda_master_list_match is False
        assert by_id["maple-syrup"].usda_master_list_match is False
        assert by_id["honey-locust"].usda_master_list_match is True
        assert by_id["maple"].usda_master_list_match is True
        traps = {frozenset(f["crop_ids"]) for f in findings
                 if f["flag_type"] == "multi_commodity_same_name"}
        assert frozenset(["honey", "honey-locust"]) in traps
        assert frozenset(["maple-syrup", "maple"]) in traps

    def test_identity_candidates_are_reviewed(self, registry_and_findings):
        _, findings = registry_and_findings
        unreviewed = [
            f for f in findings
            if f["flag_type"] == "candidate_ambiguous_shared_keyword"
            or "NOT YET REVIEWED" in f["resolution"]
        ]
        assert unreviewed == []
        flag_types = {f["flag_type"] for f in findings}
        assert "scanner_false_positive" in flag_types
        assert "same_plant_multiple_nursery_forms" in flag_types
        pepper = next(
            f for f in findings
            if set(f["crop_ids"]) == {"pepper", "culinary-herbs-and-spices-pepper"}
        )
        assert pepper["flag_type"] == "multi_commodity_same_name"
