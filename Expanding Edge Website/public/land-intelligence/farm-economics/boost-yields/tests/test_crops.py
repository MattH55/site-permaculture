"""Crop-resolution behaviour, asserted against real labels from all five sources.

These expectations were derived by reading the probed layouts, not by running the
code, so the test is an independent check on the rule table rather than a
transcript of it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import crops as C  # noqa: E402

MOJI = "Wheat \u00e2\u20ac\u201c Red Spring"   # cp1252 mojibake, as pymupdf decodes it

# (source label, expected crop_id) - verbatim from the probed documents.
CASES = [
    # --- AFSC spring insurance grid -----------------------------------------
    (MOJI, "spring-wheat"),
    ("Wheat \u00e2\u20ac\u201c Red Spring (High Protein)", "spring-wheat"),
    ("Wheat \u00e2\u20ac\u201c Red Winter", "winter-wheat"),
    ("Wheat \u00e2\u20ac\u201c Soft White Spring", "spring-wheat"),
    ("Wheat \u00e2\u20ac\u201c Canada Prairie Spring (Red)", "spring-wheat"),
    ("Wheat \u00e2\u20ac\u201c Extra Strong", "other-wheat"),
    ("Wheat \u00e2\u20ac\u201c Northern Hard Red", "other-wheat"),
    ("Wheat \u00e2\u20ac\u201c Special Purpose", "other-wheat"),
    ("Wheat \u00e2\u20ac\u201c Amber Durum", "durum-wheat"),
    ("Barley", "barley"),
    ("Barley (Malting)", "barley"),
    ("Oats", "oats"),
    ("Mixed Grain", "mixed-grain"),
    ("Rye \u00e2\u20ac\u201c Spring/Fall", "rye"),
    ("Triticale \u00e2\u20ac\u201c Spring/Winter", "triticale"),
    ("Canary Seed Sound & Dry", "canary-seed"),
    ("Corn (Grain)", "corn-grain"),
    ("Canola \u00e2\u20ac\u201c Argentine/Polish", "canola"),
    ("Canola \u00e2\u20ac\u201c Argentine (Specialty Oil)", "canola"),
    ("Flaxseed", "flaxseed"),
    ("Mustard \u00e2\u20ac\u201c Brown/Oriental", "mustard"),
    ("Mustard \u00e2\u20ac\u201c Yellow", "mustard"),
    ("Field Peas \u00e2\u20ac\u201c Green/Other", "dry-peas"),
    ("Field Peas \u00e2\u20ac\u201c Yellow", "dry-peas"),
    ("Fababeans", "fababeans"),
    ("Lentils \u00e2\u20ac\u201c Green", "lentils"),
    ("Lentils \u00e2\u20ac\u201c Red", "lentils"),
    ("Beans, Dry \u00e2\u20ac\u201c Great Northern", "dry-beans"),
    ("Beans, Dry \u00e2\u20ac\u201c Pinto", "dry-beans"),
    ("Chickpeas \u00e2\u20ac\u201c Desi", "chickpeas"),
    ("Chickpeas \u00e2\u20ac\u201c Kabuli", "chickpeas"),
    ("Safflower", "safflower"),
    ("Sunflower \u00e2\u20ac\u201c Confectionary", "sunflower"),
    ("Sunflower \u00e2\u20ac\u201c Oilseed", "sunflower"),
    ("Silage/Greenfeed (Barley Proxy)", "cereal-silage"),
    ("Silage/Greenfeed (LOM)", "cereal-silage"),
    ("Corn Heat Units (Grain Corn)", "corn-grain"),
    ("Corn Heat Units (Silage Corn)", "corn-silage"),
    # --- AFSC non-adjusted list ---------------------------------------------
    ("Honey Commercial", None),
    ("Sugar Beets Commercial", "sugar-beets"),
    ("Alfalfa Pedigreed Certified #2", "alfalfa-seed"),
    ("Creeping Red Fescue Seed/Pedigreed Common #2", "fescue-seed"),
    ("Timothy Pedigreed Certified #2", "timothy-seed"),
    ("Camelina Commercial", None),
    ("Hemp Grain Comm/Pedigreed", "hemp"),
    ("Soybeans Comm/Pedigreed", None),
    ("Hybrid Canola Hybrid A Certified #1", "canola"),
    ("Potatoes Chip", "potatoes"),
    ("Potatoes Seed Tier A Certified Class", "potatoes"),
    ("Beans Fresh 1-Canada", "fresh-beans"),
    ("Broccoli Fresh", "broccoli"),
    ("Corn (Fresh)", "corn-grain"),
    ("Cucumbers Pickling", "cucumbers"),
    ("Winter Squash Fresh", "winter-squash"),
    ("Carrots Processing", "carrots"),
    ("Peas Processing", "dry-peas"),
    # --- AFSC forage seed list ----------------------------------------------
    ("Alfalfa Common", "alfalfa-seed"),
    ("Alsike Certified", "clover-seed"),
    ("Smooth Brome Common", "brome-seed"),
    ("Meadow Brome Certified", "brome-seed"),
    ("Sweet Clover Common", "clover-seed"),
    ("Fescue Common", "fescue-seed"),
    ("Red Clover Common", "clover-seed"),
    ("Timothy Certified", "timothy-seed"),
    # --- StatCan 32100359 ---------------------------------------------------
    ("Wheat, spring", "spring-wheat"),
    ("Wheat, durum", "durum-wheat"),
    ("Wheat, winter remaining", "winter-wheat"),
    ("Wheat, all", "wheat-all"),
    ("Canola (rapeseed)", "canola"),
    ("Peas, dry", "dry-peas"),
    ("Beans, all dry (white and coloured)", "dry-beans"),
    ("Mustard seed", "mustard"),
    ("Sunflower seed", "sunflower"),
    ("Corn for grain", "corn-grain"),
    ("Corn for silage", "corn-silage"),
    ("Tame hay", "hay"),
    ("Mixed grains", "mixed-grain"),
    ("Sugar beets", "sugar-beets"),
    ("Buckwheat", "buckwheat"),
    # --- StatCan 32100077 ---------------------------------------------------
    ("Canadian Wheat Board, wheat including payments", None),
    ("Dry peas [114314]", "dry-peas"),
    ("Lentils [114312]", "lentils"),
    ("Durum wheat [112111211]", "durum-wheat"),
    ("Flaxseed [115122111]", "flaxseed"),
    ("Canary seeds [11511555]", "canary-seed"),
    ("Fresh potatoes for processing [114211211]", "potatoes"),
    ("Unprocessed milk from bovine [11612111]", None),
    ("Eggs in shell [116111]", None),
    ("Hogs [111121]", None),
    ("Canola (including rapeseed) [113111]", "canola"),
    ("Barley for malt and other human consumption [11511412]", "barley"),
    # --- Alberta Table 90 section headers ------------------------------------
    ("Corn for Grain", "corn-grain"),
    ("Dry Peas", "dry-peas"),
    ("Dry Beans", "dry-beans"),
    ("Lentils", "lentils"),
    ("Mustard Seed", "mustard"),
    ("Triticale", "triticale"),
    ("Potatoes", "potatoes"),
    ("Fodder Corn", "corn-silage"),
    # --- Cropping Alternatives reconstructed headers -------------------------
    ("Spring Wheat CWRS 13.5%", "spring-wheat"),
    ("CPS Wheat 1 CPSR", "spring-wheat"),
    ("Durum Wheat 1 CWAD", "durum-wheat"),
    ("Soft Wheat 13% 1 CWSWS", "other-wheat"),
    ("Feed Barley 1 CW", "barley"),
    ("Malt Barley Select CW 2R", "barley"),
    ("Milling Oats 2 CW", "oats"),
    ("Argentine HT Canola 1 CAN", "canola"),
    ("Yellow Peas 2 CAN", "dry-peas"),
    ("Red Lentil*", "lentils"),
    ("Kabuli Chickpea* 8mm", "chickpeas"),
    ("Yellow Mustard* 1 CAN", "mustard"),
    ("Mixed Hay**", "hay"),
    ("Alfalfa Hay**", "hay"),
    ("Cereal Silage**", "cereal-silage"),
    ("Dry Beans* 1 CAN", "dry-beans"),
    # --- Alberta Table 93 column headers -------------------------------------
    ("Wheat", "other-wheat"),
    ("Oats", "oats"),
    ("Barley", "barley"),
    # --- StatCan 18100245 retail ---------------------------------------------
    ("Tomatoes, per kilogram", "tomatoes"),
    ("Cucumber, unit", "cucumbers"),
    ("Peppers, per kilogram", "peppers"),
    ("Iceberg lettuce, unit", "lettuce"),
    ("Romaine lettuce, unit", "lettuce"),
    ("Salad greens, 142 grams", "salad-greens"),
    ("Mushrooms, 227 grams", "mushrooms"),
    ("Strawberries, 454 grams", "strawberries"),
    ("Canned tomatoes, 796 millilitres", None),
    ("Frozen green beans, 750 grams", None),
    ("Beef rib cuts, per kilogram", None),
    ("Potatoes, per kilogram", "potatoes"),
    ("Shampoo, 400 millilitres", None),
]


def test_crop_resolution_matches_sources():
    bad = []
    for label, expected in CASES:
        got = C.crop_for(label)
        if got != expected:
            bad.append(f"  {label!r}: expected {expected!r} got {got!r}")
    assert not bad, "crop resolution mismatches:\n" + "\n".join(bad)


def test_variant_capture():
    assert C.variant_for("Wheat \u2013 Amber Durum (High Protein)") == "High Protein"
    assert C.variant_for("Chickpeas \u2013 Kabuli") == "Kabuli"
    assert C.variant_for("Malt Barley Select CW 2R") == "Select CW"
    assert C.variant_for("Mustard \u2013 Brown/Oriental") == "Brown/Oriental"
    assert C.variant_for("Alfalfa Pedigreed Certified #2") == "Pedigreed"
    assert C.variant_for("Spring Wheat CWRS 13.5%") == "CWRS"


def test_clean_label_handles_mojibake():
    assert C.clean_label(MOJI) == "Wheat - Red Spring"
    assert C.clean_label("Wheat \u2013 Red Spring") == "Wheat - Red Spring"


def test_excludes_are_respected():
    assert C.crop_for("Hogs [111121]") is None
    assert C.crop_for("Unprocessed milk from bovine") is None
    assert C.crop_for("Canned corn, 341 millilitres") is None
