from price_pipeline import nass_quickstats as NASS


def test_mustard_maps_to_oilseed_not_greens():
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["MUSTARD"] == ["mustard-seed"]
    assert "mustard-and-other-greens" not in {
        cid for ids in NASS.NASS_COMMODITY_TO_CROP_IDS.values() for cid in ids
    }


def test_maple_syrup_and_honey_are_intentionally_unmapped():
    mapped = set(NASS.NASS_COMMODITY_TO_CROP_IDS)
    assert "MAPLE SYRUP" not in mapped
    assert "HONEY" not in mapped


def test_peppers_map_to_vegetable_not_spice():
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["PEPPERS"] == ["pepper"]
