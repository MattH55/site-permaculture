"""The wide-coverage (v2) specialty-crop price layer.

These tests pin the *failure modes* that a wide pipeline introduces on top of v1's. v1
already refuses to invent a price for one crop; v2's new risks are about *breadth* and
*two countries*: a group default silently merging with a crop override, a seed
``known_tier_hint`` leaking into a classification, a Tier B2 farmers-market line being
relabeled as a federal Tier B survey, a Canadian proxy standing in for a missing U.S.
number, or a "100% Tier A" group being celebrated instead of spot-checked. Each test below
names one of those, so a future change that reintroduces it breaks a named test rather
than quietly altering a published coverage report.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import usda_report as R  # noqa: E402
from price_pipeline import wide_catalogs as WC  # noqa: E402
from price_pipeline import wide_cli as WCLI  # noqa: E402
from price_pipeline import wide_registry as WR  # noqa: E402
from price_pipeline import wide_report as WREP  # noqa: E402
from price_pipeline.wide_seed import CROP_GROUPS, read_seed_list  # noqa: E402

LAST_CHECKED = "2026-09-15"


@pytest.fixture(scope="module")
def seed():
    return read_seed_list()


@pytest.fixture(scope="module")
def doc():
    return WR.load_wide_registry()


@pytest.fixture(scope="module")
def classes(seed, doc):
    return WREP.classify_seed_list(seed, doc, last_checked=LAST_CHECKED)


# --------------------------------------------------------------------- seed list

def test_seed_list_reads_all_crops(seed):
    # 43 distinct crops: lavender is cross-listed once (medicinal + ornamental), and the
    # microgreen/mushroom splits are individual rows.
    assert len(seed.crops) == 43


def test_seed_groups_within_closed_taxonomy(seed):
    for crop in seed.crops:
        assert crop.crop_group in CROP_GROUPS


def test_seed_countries_are_us_or_ca(seed):
    for crop in seed.crops:
        assert crop.target_countries, crop.crop
        for country in crop.target_countries:
            assert country in ("US", "CA")


def test_tier_hint_is_never_named_tier(seed):
    # The hint field must not be addressable as plain `tier`, or it would leak into
    # classification. SeedCrop exposes it only under its explicit, non-authoritative name.
    for crop in seed.crops:
        assert not hasattr(crop, "tier")
        assert hasattr(crop, "known_tier_hint")


def test_seed_rejects_unknown_group(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text(
        "crop,crop_group,target_countries,notes\n"
        "mystery,not_a_group,US,x\n",
        encoding="utf-8",
    )
    with pytest.raises(Exception):
        read_seed_list(str(bad))


def test_seed_rejects_duplicate_crop(tmp_path):
    bad = tmp_path / "dup.csv"
    bad.write_text(
        "crop,crop_group,target_countries,notes\n"
        "basil,culinary_herb,US,x\n"
        "basil,culinary_herb,US,y\n",
        encoding="utf-8",
    )
    with pytest.raises(Exception):
        read_seed_list(str(bad))


# --------------------------------------------------------------------- registry / config

def test_b2_sits_between_b_and_c():
    assert WR.TIER_ORDER.index("B2") == WR.TIER_ORDER.index("B") + 1
    assert WR.TIER_ORDER.index("B2") < WR.TIER_ORDER.index("C")


def test_crop_override_replaces_group_default(doc):
    # saffron's group is botanical_ornamental (default [census, trade]); its override is
    # [trade]. Override-not-merge means census must NOT appear in the resolved list.
    pref = WR.preferred_for(doc, "saffron", "botanical_ornamental")
    assert pref.source == "crop_override"
    assert pref.preferred == ("trade",)
    assert "census" not in pref.preferred


def test_group_default_applies_when_no_override(doc):
    # basil has no crop-specific entry, so it inherits the culinary_herb default.
    pref = WR.preferred_for(doc, "basil", "culinary_herb")
    assert pref.source == "group_default"
    assert pref.preferred == ("nass", "ams")


def test_no_merge_of_group_and_crop_lists(doc):
    # microgreens_mixed overrides the microgreen_leafy default; both happen to be the same
    # families here, so a buggy merge would produce duplicates. There must be none.
    pref = WR.preferred_for(doc, "microgreens_mixed", "microgreen_leafy")
    assert len(pref.preferred) == len(set(pref.preferred))


def test_every_preferred_family_is_registered(doc, seed):
    problems = WR.validate(doc, seed_groups=set(seed.groups()))
    assert problems == [], f"registry problems: {problems}"


# --------------------------------------------------------------------- classification honesty

def test_every_targeted_country_yields_a_row(classes, seed):
    # A crop targeting US+CA must produce two rows; they are different markets, not one.
    pairs = {(c.crop, c.source_country) for c in classes}
    for crop in seed.crops:
        for country in crop.target_countries:
            assert (crop.crop, country) in pairs


def test_currency_follows_country(classes):
    for c in classes:
        assert c.currency == WREP.COUNTRY_CURRENCY[c.source_country]


def test_no_retrieval_means_no_selected_tier(classes):
    # Nothing is enabled in this build, so every row must be check-only with no tier.
    for c in classes:
        assert c.classification_status == WREP.STATUS_CHECK_ONLY
        assert c.selected_tier is None
        assert c.price_available is False


def test_hint_never_promoted_to_tier(classes):
    # Several seed rows carry known_tier_hint='A' or 'B'; none may surface as selected_tier.
    for c in classes:
        assert c.selected_tier != c.known_tier_hint or c.known_tier_hint is None


def test_tier_hint_is_provenance_only(classes):
    hints = {c.known_tier_hint for c in classes}
    assert "A" in hints or "B" in hints  # sanity: hints really are present in the seed


def test_no_fabricated_provenance(classes):
    # With no retrieval there must be no selected source / market_level / price.
    for c in classes:
        assert c.market_level is None
        assert c.economic_value_available is False


def test_audit_records_search_even_when_empty(classes):
    # A Tier-E-leaning crop still shows what was checked (v1 §23 / v2 Part 5).
    wasabi = [c for c in classes if c.crop == "wasabi" and c.source_country == "US"]
    assert wasabi and wasabi[0].searches_performed, "wasabi US audit has no searches"


def test_asymmetric_canadian_coverage_is_honest(classes):
    # basil targets US only; it must NOT have a CA row (no invented Canadian number).
    ca_basil = [c for c in classes if c.crop == "basil" and c.source_country == "CA"]
    assert ca_basil == []



# --------------------------------------------------------------------- coverage rollups

def test_by_group_covers_every_group(classes, seed):
    rows = WREP.coverage_by_group(classes)
    assert {r["crop_group"] for r in rows} == set(seed.groups())


def test_by_group_has_tier_histogram(classes):
    rows = WREP.coverage_by_group(classes)
    for row in rows:
        for tier in WR.TIER_ORDER:
            assert f"tier_{tier}" in row
        assert "unclassified" in row


def test_by_country_rollup_present(classes):
    rows = WREP.coverage_by_country(classes)
    countries = {r["source_country"] for r in rows}
    assert countries <= {"US", "CA"}
    for row in rows:
        assert "tier_c_or_better" in row


def test_unclassified_count_matches(classes):
    rows = WREP.coverage_by_group(classes)
    assert sum(r["unclassified"] for r in rows) == len(classes)


def test_full_tier_a_flag_logic():
    # §20: a group at 100% Tier A is a spot-check signal, not a celebration.
    fake = [
        WREP.WideClassification(
            crop="x", crop_group="g", source_country="US", currency="USD",
            classification_status=WREP.STATUS_TIER_SELECTED, selected_tier="A",
            market_level="producer", price_available=True,
            economic_value_available=False, confidence="high", reason="r",
            last_checked=LAST_CHECKED, preferred=("nass",), known_tier_hint=None,
            nass_special_survey=None, seed_notes="",
        )
    ]
    row = WREP.coverage_by_group(fake)[0]
    assert row["flag_full_tier_a"] is True


# --------------------------------------------------------------------- catalogs

def test_ca_catalog_loads_and_is_subfederal_aware():
    sources = WC.load_ca_catalog()
    assert sources, "ca_source_catalog is empty"
    tiers = {s.ca_tier for s in sources}
    assert tiers <= {"A", "B", "B2", "C", "D"}
    # Alberta provincial sources must be CA Tier B (v2 §1.4), not B2.
    ab = [s for s in sources if s.jurisdiction == "provincial"]
    assert ab and all(s.ca_tier == "B" for s in ab)


def test_special_survey_checklist_enumerated():
    surveys = WC.load_special_surveys()
    keys = {s.key for s in surveys}
    for expected in ("mushrooms", "floriculture_crops",
                     "census_horticultural_specialties", "hops",
                     "maple_syrup", "honey"):
        assert expected in keys


def test_special_survey_existence_does_not_imply_price():
    # §1.5: floriculture and census-hort are volume/value-only -> has_price_field False.
    surveys = {s.key: s for s in WC.load_special_surveys()}
    assert surveys["floriculture_crops"].has_price_field is False
    assert surveys["census_horticultural_specialties"].has_price_field is False
    assert surveys["mushrooms"].has_price_field is True



# --------------------------------------------------------------------- CLI behaviour

def test_cli_status_is_clean(capsys):
    rc = WCLI.main(["status"])
    assert rc == 0
    assert "validation: clean" in capsys.readouterr().out


def test_cli_fetch_refusal_for_unretrieved_crop(capsys):
    rc = WCLI.main(["fetch", "--crop", "wasabi"])
    out = capsys.readouterr().out
    assert rc == WCLI.EXIT_NO_SOURCE
    assert R.NO_SOURCE_MESSAGE in out


def test_cli_fetch_exact_refusal_string(capsys):
    # §35: the words must be exact, and shared with the v1 layer.
    rc = WCLI.main(["fetch", "--crop", "stevia", "--json"])
    out = capsys.readouterr().out
    assert rc == WCLI.EXIT_NO_SOURCE
    assert "No defensible recurring price source identified" in out


def test_cli_unknown_crop_exit_code(capsys):
    rc = WCLI.main(["fetch", "--crop", "not_a_real_crop_xyz"])
    assert rc == WCLI.EXIT_UNKNOWN_CROP
    capsys.readouterr()


def test_cli_ambiguous_query_refuses_to_pick(capsys):
    # "agaricus" matches white_button, cremini and portobello; must not silently pick one.
    rc = WCLI.main(["fetch", "--crop", "agaricus"])
    err = capsys.readouterr().err
    assert rc == WCLI.EXIT_UNKNOWN_CROP
    assert "matches" in err


def test_cli_country_not_targeted_is_no_source(capsys):
    # basil targets US only; asking for CA must not invent a Canadian record.
    rc = WCLI.main(["fetch", "--crop", "basil", "--country", "CA"])
    assert rc == WCLI.EXIT_NO_SOURCE
    capsys.readouterr()


def test_cli_fetch_by_group_runs(capsys):
    rc = WCLI.main(["fetch", "--group", "mushroom"])
    # No source enabled -> every mushroom record refuses -> EXIT_NO_SOURCE.
    assert rc == WCLI.EXIT_NO_SOURCE
    out = capsys.readouterr().out
    assert "shiitake" in out


def test_cli_fetch_unknown_group(capsys):
    rc = WCLI.main(["fetch", "--group", "not_a_group"])
    assert rc == WCLI.EXIT_UNKNOWN_CROP
    capsys.readouterr()


def test_cli_report_writes_four_deliverables(tmp_path, capsys):
    out_dir = str(tmp_path / "out")
    rc = WCLI.main(["report", "--out", out_dir])
    assert rc == 0
    capsys.readouterr()
    for name in ("crop_source_status.csv", "source_audit.csv",
                 "coverage_by_group.csv", "coverage_by_country.csv"):
        assert os.path.exists(os.path.join(out_dir, name)), name


def test_cli_report_status_csv_has_country_and_currency(tmp_path, capsys):
    import csv as _csv
    out_dir = str(tmp_path / "out2")
    WCLI.main(["report", "--out", out_dir])
    capsys.readouterr()
    with open(os.path.join(out_dir, "crop_source_status.csv"),
              newline="", encoding="utf-8") as fh:
        rows = list(_csv.DictReader(fh))
    assert rows, "status csv is empty"
    for row in rows:
        assert row["source_country"] in ("US", "CA")
        assert row["currency"] in ("USD", "CAD")
        # v2 Part 5: a row with a price must have country+currency; here none has a price.
        if row["price_available"] == "True":
            assert row["source_country"] and row["currency"]

