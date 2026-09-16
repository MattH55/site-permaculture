"""Unit-normalization behaviour, including the deliberate quarantine cases."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import units as U  # noqa: E402


def test_mass_units_convert():
    assert U.normalize_unit("/tonne") == "tonne"
    assert U.normalize_unit("Dollars per metric tonne") == "tonne"
    assert U.normalize_unit("/bu.") == "bu"
    assert U.normalize_unit("$/kg") == "kg"
    assert U.normalize_unit("454 grams") == "454 grams"

    c = U.to_cad_per_tonne(238.24, unit="$ /tonne")
    assert c.ok and abs(c.cad_per_tonne - 238.24) < 1e-9

    c = U.to_cad_per_tonne(474.5, unit="$/tonne")
    assert c.ok and abs(c.cad_per_tonne - 474.5) < 1e-9

    c = U.to_cad_per_tonne(0.42, unit="$/lb")
    assert c.ok and abs(c.cad_per_tonne - 0.42 / 0.453592 * 1000) < 1e-6


def test_bushel_uses_published_test_weight_only_when_declared():
    # Corn: Alberta publishes 1 bu = 0.0254 t.
    c = U.to_cad_per_tonne(4.0317, unit="$/bu.", crop_key="corn for grain")
    assert c.ok and c.basis == "published-test-weight"
    assert abs(c.cad_per_tonne - 4.0317 / 0.0254) < 1e-6

    # Safflower has no published bushel mass: quarantine, never guess.
    c = U.to_cad_per_tonne(3.50, unit="$/bu", crop_key="safflower")
    assert not c.ok and c.basis == "bushel-mass-undeclared"


def test_afsc_test_weight_overrides_for_barley_and_oats():
    default = U.to_cad_per_tonne(6.40, unit="$/bu", crop_key="oats")
    afsc = U.to_cad_per_tonne(6.40, unit="$/bu", crop_key="oats", allow_afsc_test_weight=True)
    assert default.ok and afsc.ok
    # AFSC declares 41 lb/bu for oats vs Alberta's 0.015422 t/bu (~34 lb).
    assert afsc.cad_per_tonne < default.cad_per_tonne


def test_non_price_denominators_are_quarantined():
    assert U.to_cad_per_tonne(1.09, unit="$/dozen", crop_key="eggs").basis == "non-mass-denominator"
    assert U.to_cad_per_tonne(520.49, unit="$/kilolitre", crop_key="milk").basis == "volumetric-unit"


def test_fixed_mass_packages_convert():
    c = U.to_cad_per_tonne(3.99, unit="Dollars", crop_key="strawberries, 454 grams")
    assert not c.ok, "unit lives in the product name, not the UOM column"


def test_bad_values_are_rejected():
    assert U.to_cad_per_tonne(None, unit="$ /tonne").basis == "missing-value"
    assert U.to_cad_per_tonne(-5.0, unit="$ /tonne").basis == "negative-value"
    assert U.to_cad_per_tonne(5.0, unit=None).basis == "unit-unrecognized"
    assert U.to_cad_per_tonne(5.0, unit="$ /tonne", currency="USD").basis == "currency-not-cad"
