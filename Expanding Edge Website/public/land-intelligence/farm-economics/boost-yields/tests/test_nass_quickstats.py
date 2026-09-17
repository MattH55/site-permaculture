from price_pipeline import nass_quickstats as NASS


def test_mustard_maps_to_oilseed_not_greens():
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["MUSTARD"] == ["mustard-seed"]
    assert "mustard-and-other-greens" not in {
        cid for ids in NASS.NASS_COMMODITY_TO_CROP_IDS.values() for cid in ids
    }


def test_maple_syrup_and_honey_map_to_product_rows_not_trees():
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["MAPLE SYRUP"] == ["maple-syrup"]
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["HONEY"] == ["honey"]
    assert "maple" not in NASS.NASS_COMMODITY_TO_CROP_IDS["MAPLE SYRUP"]
    assert "honey-locust" not in NASS.NASS_COMMODITY_TO_CROP_IDS["HONEY"]


def test_peppers_map_to_vegetable_not_spice():
    assert NASS.NASS_COMMODITY_TO_CROP_IDS["PEPPERS"] == ["pepper"]
