"""Unit interpretation and CAD/tonne normalization.

The rule this module enforces: a price is convertible to CAD/tonne only when its
denominator is a unit of *mass*, or when the source itself declares the mass of a
volumetric unit (a published test weight, or an explicit metric twin series).

A bushel is a volume. Its mass depends on the commodity and, for barley and oats,
on the test weight the payer chooses. There is no generic `bushel -> kg`. Guessing
one is how a price series quietly becomes fiction, so unresolvable rows are
returned unconverted with a machine-readable reason instead.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

KG_PER_TONNE = 1000.0

# Mass units, in kilograms. Imperial values use the Alberta "Symbols" sheet
# conversion (1 pound = 0.453592 kg) so we reproduce the publisher's own arithmetic
# rather than introducing a third-decimal drift against published tables.
MASS_UNITS_KG: dict[str, float] = {
    "kg": 1.0,
    "kilogram": 1.0,
    "tonne": 1000.0,
    "lb": 0.453592,
    "lbs": 0.453592,
    "pound": 0.453592,
    "pounds": 0.453592,
    "cwt": 45.3592,           # hundredweight = 100 lb
    "hundredweight": 45.3592,
    "short ton": 907.184872,  # 2000 lb
    "ton": 907.184872,        # Canadian "ton" in farm statistics = short ton
}

# Volumetric units that require a commodity-specific mass before they can convert.
VOLUMETRIC_UNITS = {"bu", "bushel", "bushels", "gallon", "litre", "liter",
                    "kilolitre", "hl", "hectolitre"}

# Non-price denominators: a dollar amount per these is not a commodity price.
UNUSABLE_DENOMINATORS = {"dozen", "head", "each", "unit", "package", "quart", "quarts"}

# Alberta "Symbols" sheet — Weight Equivalents of Selected Commodities:
# 1 bushel expressed in tonnes, as published by the province alongside Table 90.
PUBLISHED_BUSHEL_TONNE: dict[str, float] = {
    "wheat": 0.027216,
    "durum": 0.027216,
    "mixed grain": 0.020412,
    "oats": 0.015422,
    "rye": 0.0254,
    "corn": 0.0254,
    "flaxseed": 0.0254,
    "barley": 0.021773,
    "canola": 0.02268,
}

# AFSC prints these test weights directly on its price pages. They differ from the
# Alberta table (note the lower barley/oat values) and must win for AFSC rows.
AFSC_TEST_WEIGHT_LB_PER_BU: dict[str, float] = {
    "barley": 50.0,
    "oats": 41.0,
}

# Residual spellings the structural strip cannot reach. Kept deliberately small:
# anything expressible as "$/x" or "Dollars per x" is handled by normalize_unit().
_SYNONYMS = {
    "mt": "tonne",
    "tonnes": "tonne",
    # "ton" alone means short ton in Canadian farm statistics, so the metric
    # spellings must canonicalize explicitly rather than fall through.
    "metric ton": "tonne",
    "metric tonne": "tonne",
    "kilograms": "kilogram",
    "pound": "lb",
    "lbs": "lb",
    "lb": "lb",
    "bushel": "bu",
    "bushels": "bu",
    "hundredweight": "cwt",
    "cwt.": "cwt",
    "short tons": "short ton",
    "tons": "ton",
    "kilolitres": "kilolitre",
    "hectolitre": "hl",
    "gallons": "gallon",
    "quarts": "quart",
}


@dataclass(frozen=True)
class Conversion:
    """Outcome of an attempted normalization. Never partial."""

    cad_per_tonne: float | None
    original_unit: str
    basis: str          # 'mass' | 'published-test-weight' | ... | quarantine reason
    factor: float | None
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.cad_per_tonne is not None


def normalize_unit(raw: str | None) -> str:
    """Reduce a source's unit text to a bare denominator.

    Sources write the same idea four ways: ``$/kg``, ``$ /tonne``, ``/bu.`` and
    ``Dollars per metric tonne``. Stripping the currency token and reading a slash
    as "per" collapses all of them, so the alias table stays a short synonym list
    instead of having to enumerate every spelling.
    """
    if not raw:
        return ""
    key = re.sub(r"\s+", " ", str(raw).strip().lower()).rstrip(".")
    key = re.sub(r"^(?:us\s*\$|cad|\$|usd|dollars?|cents?)\s*", "", key)
    if key.startswith("/"):
        key = key[1:]
    key = re.sub(r"^(?:per|in)\s+", "", key).strip()
    if key in _SYNONYMS:
        return _SYNONYMS[key]
    if key in MASS_UNITS_KG or key in VOLUMETRIC_UNITS or key in UNUSABLE_DENOMINATORS:
        return key
    return key


def bushel_mass_kg(
    crop_key: str | None,
    *,
    allow_afsc_test_weight: bool = False,
    extra: dict[str, float] | None = None,
) -> float | None:
    """kg per bushel for a crop, or None when no source declares one.

    Matching is substring-based against the published commodity keys on purpose: a
    narrow match that misses is far safer than a broad match that invents a mass.
    """
    lookup = {k: t * KG_PER_TONNE for k, t in PUBLISHED_BUSHEL_TONNE.items()}
    if allow_afsc_test_weight:
        for k, lb in AFSC_TEST_WEIGHT_LB_PER_BU.items():
            lookup[k] = lb * MASS_UNITS_KG["lb"]
    for k, kg in (extra or {}).items():
        lookup[k] = kg
    if not crop_key:
        return None
    ck = crop_key.strip().lower()
    for key, kg in lookup.items():
        if ck == key or key in ck:
            return kg
    return None


def to_cad_per_tonne(
    value: float | None,
    *,
    unit: str | None,
    currency: str = "CAD",
    crop_key: str | None = None,
    allow_afsc_test_weight: bool = False,
    bushel_mass_kg_override: float | None = None,
) -> Conversion:
    """Convert a price to CAD/tonne, or state precisely why it cannot be done."""
    raw_unit = unit or ""
    u = normalize_unit(unit)
    if value is None:
        return Conversion(None, raw_unit, "missing-value", None, "source row has no numeric value")
    if not isinstance(value, (int, float)):
        return Conversion(None, raw_unit, "value-not-numeric", None, f"non-numeric value {value!r}")
    if currency and currency.upper() not in {"CAD", "C$"}:
        # No FX source is registered, so converting here would invent a rate.
        return Conversion(None, raw_unit, "currency-not-cad", None, f"source currency {currency!r}")
    if value < 0:
        return Conversion(None, raw_unit, "negative-value", None, f"negative price {value}")
    if not u:
        return Conversion(None, raw_unit, "unit-unrecognized", None, "source printed no unit")

    if u in MASS_UNITS_KG:
        factor = KG_PER_TONNE / MASS_UNITS_KG[u]
        return Conversion(value * factor, raw_unit, "mass", factor)

    if u in {"bu", "bushel", "bushels"}:
        kg, basis = bushel_mass_kg_override, "declared-bushel-mass"
        if kg is None:
            kg, basis = bushel_mass_kg(crop_key, allow_afsc_test_weight=allow_afsc_test_weight), "published-test-weight"
        if kg is None:
            return Conversion(None, raw_unit, "bushel-mass-undeclared", None,
                              f"no commodity-specific bushel mass declared for {crop_key!r}")
        factor = KG_PER_TONNE / kg
        return Conversion(value * factor, raw_unit, basis, factor, f"{kg:.6f} kg/bu")

    if u in VOLUMETRIC_UNITS:
        return Conversion(None, raw_unit, "volumetric-unit", None,
                          f"{u} is a volume with no declared mass for this product")
    if u in UNUSABLE_DENOMINATORS:
        return Conversion(None, raw_unit, "non-mass-denominator", None,
                          f"price is per {u}; no tonne equivalence exists")

    # Fixed-mass packages, e.g. "454 grams", "1.36 kilograms" (retail scanner data).
    pkg = re.fullmatch(
        r"(\d+(?:\.\d+)?)\s*(grams?|kilograms?|millilitres?|litres?|ounces?)", u)
    if pkg:
        qty = float(pkg.group(1))
        word = pkg.group(2)
        if word.startswith(("millilitre", "litre")):
            return Conversion(None, raw_unit, "package-volume-not-mass", None,
                              f"package expressed as {qty:g} {word}")
        kg_each = qty * (0.001 if word.startswith("gram")
                         else 1000.0 if word.startswith("kilogram")
                         else 0.0283495)
        factor = KG_PER_TONNE / kg_each
        return Conversion(value * factor, raw_unit, "package-mass", factor, f"package = {kg_each:g} kg")

    return Conversion(None, raw_unit, "unit-unrecognized", None, f"cannot interpret unit {raw_unit!r}")


# ---------------------------------------------------------------------------
# U.S. specialty-crop package units (§14)
#
# The Canadian grain path above answers "what is this worth per tonne?" — a mass question.
# U.S. specialty crops sell by *package*, and the packages are not mass: a bunch of basil,
# a flat of microgreens, a dozen ears. Section 14 requires that such a price never be
# silently re-expressed as a per-pound price, because a bunch is whatever the grower
# bunched and varies by market, week and buyer. The only honest conversions are:
#
#   * same unit -> same unit (a no-op the caller can rely on);
#   * within one family with a *declared* factor supplied by the caller;
#   * anything else -> refused, quoting the missing factor.
#
# Nothing here guesses a factor to make a number appear.
# ---------------------------------------------------------------------------

def _strip_currency(raw: str | None) -> str:
    """Reduce any price-unit spelling to a bare denominator, lower-cased.

    ``$/bunch``, ``$ /bunch``, ``USD per bunch`` and ``Dollars per Bunch`` must all reach
    ``bunch``. Kept private and separate from ``normalize_unit`` because that function goes
    on to apply the grain synonym table, which would rewrite ``lb``-family tokens in ways
    the package space does not want.
    """
    key = re.sub(r"\s+", " ", str(raw or "").strip().lower()).rstrip(".")
    key = re.sub(r"^(?:us\s*\$|cad|usd|\$|dollars?|cents?)\s*", "", key)
    if key.startswith("/"):
        key = key[1:]
    key = re.sub(r"^(?:per|in)\s+", "", key).strip()
    return key


# Package units grouped into families. ``bunch`` is deliberately sibling to ``lb`` rather
# than inside the mass family: a bunch has no fixed mass.
PACKAGE_FAMILIES: dict[str, str] = {
    "bunch": "bunch", "bunches": "bunch",
    "lb": "mass", "lbs": "mass", "pound": "mass", "pounds": "mass",
    "oz": "mass", "ounce": "mass", "ounces": "mass",
    "kg": "mass", "kilogram": "mass", "gram": "mass", "grams": "mass",
    "pint": "volume", "pints": "volume", "quart": "volume", "quarts": "volume",
    "gallon": "volume", "gallons": "volume",
    "flat": "flat", "flats": "flat",
    "clamshell": "clamshell", "clamshells": "clamshell",
    "head": "each", "heads": "each", "each": "each",
    "dozen": "each", "ear": "each", "ears": "each",
    "bottle": "bottle", "bottles": "bottle",
    "jar": "jar", "jars": "jar",
    "bag": "bag", "bags": "bag",
    "case": "case", "cases": "case",
}

# Mass within the package space, expressed in pounds. Exact by definition (16 oz = 1 lb),
# unlike a bunch, which is not exact at all.
_MASS_LB: dict[str, float] = {
    "lb": 1.0,
    "oz": 1.0 / 16.0,
    "kg": 2.2046226218,
    "gram": 2.2046226218 / 1000.0,
    "grams": 2.2046226218 / 1000.0,
}


def package_family(unit: str | None) -> str | None:
    """Classify a package unit into its family, or ``None`` if unrecognized.

    Exposed separately so a caller can decide *before* attempting a conversion whether two
    units are even comparable. That check is cheaper than constructing a Conversion and is
    what lets the CLI refuse early with a specific message.

    Sources print prices as ``$/bunch``, ``$ /lb`` or ``Dollars per flat``. The currency
    prefix is stripped using the same rule ``normalize_unit`` applies, so the same unit
    spelled three ways reaches one family instead of two recognizable and one not.
    """
    u = _strip_currency(unit)
    if not u:
        return None
    return PACKAGE_FAMILIES.get(u)


def convert_package_price(
    value: float | None,
    *,
    from_unit: str | None,
    to_unit: str | None,
    unit_mass_lb: float | None = None,
    crop: str | None = None,
) -> Conversion:
    """Convert a package price, refusing whenever a physical factor is undeclared.

    ``unit_mass_lb`` is the caller's *declared* mass of one ``from_unit`` package — for
    example, a grower stating their bunches run 4 oz. Supplying it is an explicit act with a
    name attached; omitting it is the normal case and produces a refusal, not a default.

    Refusal reasons are machine-readable strings in ``basis`` so a caller can distinguish
    "this is impossible" (``package-family-mismatch``) from "this needs a number you have not
    supplied" (``package-mass-undeclared``). Those lead to different operator actions, and
    collapsing them would hide the one the operator can actually fix.
    """
    raw = from_unit or ""
    src = _strip_currency(from_unit)
    dst = _strip_currency(to_unit)

    if value is None:
        return Conversion(None, raw, "missing-value", None, "no numeric value supplied")
    if not isinstance(value, (int, float)):
        return Conversion(None, raw, "value-not-numeric", None, f"non-numeric value {value!r}")
    if value < 0:
        return Conversion(None, raw, "negative-value", None, f"negative price {value}")
    if not src or not dst:
        return Conversion(None, raw, "unit-unrecognized", None,
                          f"need both units, got {from_unit!r} -> {to_unit!r}")

    fam_src, fam_dst = package_family(src), package_family(dst)
    if fam_src is None or fam_dst is None:
        unknown = src if fam_src is None else dst
        return Conversion(None, raw, "unit-unrecognized", None,
                          f"cannot interpret unit {unknown!r}")

    # Same unit is always safe and needs no factor at all.
    if src == dst:
        return Conversion(value, raw, "identity", 1.0, f"already in {dst}")

    # Within the mass family the relation is a definition, not an estimate.
    if fam_src == "mass" and fam_dst == "mass":
        factor = _MASS_LB[src] / _MASS_LB[dst]
        return Conversion(value * factor, raw, "mass-definition", factor,
                          f"1 {src} = {factor:.6g} {dst} by definition")

    if fam_src != fam_dst:
        # The core §14 refusal: a bunch is not a pound, and saying so is the correct output.
        return Conversion(
            None, raw, "package-family-mismatch", None,
            f"{src} is a {fam_src} unit and {dst} is a {fam_dst} unit; "
            "no conversion exists without a commodity-specific study",
        )

    # Same non-mass family: convertible only with a declared factor.
    if unit_mass_lb is None:
        return Conversion(
            None, raw, "package-mass-undeclared", None,
            f"converting {src} -> {dst} requires the declared mass of one {src}"
            + (f" for {crop}" if crop else "")
            + "; none was supplied, so no price may be asserted",
        )
    if unit_mass_lb <= 0:
        return Conversion(None, raw, "package-mass-invalid", None,
                          f"declared package mass {unit_mass_lb} lb is not positive")
    if fam_dst != "mass":
        return Conversion(
            None, raw, "package-factor-insufficient", None,
            f"a mass for one {src} does not determine a count of {dst}",
        )
    factor = unit_mass_lb / _MASS_LB[dst]
    return Conversion(value * factor, raw, "declared-package-mass", factor,
                      f"1 {src} = {unit_mass_lb:g} lb = {factor:.6g} {dst}")


def to_cad_per_tonne(
    value: float | None,
    *,
    unit: str | None,
    currency: str = "CAD",
    crop_key: str | None = None,
    allow_afsc_test_weight: bool = False,
    bushel_mass_kg_override: float | None = None,
) -> Conversion:
    """Convert a price to CAD/tonne, or state precisely why it cannot be done."""
    raw_unit = unit or ""
    u = normalize_unit(unit)
    if value is None:
        return Conversion(None, raw_unit, "missing-value", None, "source row has no numeric value")
    if not isinstance(value, (int, float)):
        return Conversion(None, raw_unit, "value-not-numeric", None, f"non-numeric value {value!r}")
    if currency and currency.upper() not in {"CAD", "C$"}:
        # No FX source is registered, so converting here would invent a rate.
        return Conversion(None, raw_unit, "currency-not-cad", None, f"source currency {currency!r}")
    if value < 0:
        return Conversion(None, raw_unit, "negative-value", None, f"negative price {value}")
    if not u:
        return Conversion(None, raw_unit, "unit-unrecognized", None, "source printed no unit")

    if u in MASS_UNITS_KG:
        factor = KG_PER_TONNE / MASS_UNITS_KG[u]
        return Conversion(value * factor, raw_unit, "mass", factor)

    if u in {"bu", "bushel", "bushels"}:
        kg, basis = bushel_mass_kg_override, "declared-bushel-mass"
        if kg is None:
            kg, basis = bushel_mass_kg(crop_key, allow_afsc_test_weight=allow_afsc_test_weight), "published-test-weight"
        if kg is None:
            return Conversion(None, raw_unit, "bushel-mass-undeclared", None,
                              f"no commodity-specific bushel mass declared for {crop_key!r}")
        factor = KG_PER_TONNE / kg
        return Conversion(value * factor, raw_unit, basis, factor, f"{kg:.6f} kg/bu")

    if u in VOLUMETRIC_UNITS:
        return Conversion(None, raw_unit, "volumetric-unit", None,
                          f"{u} is a volume with no declared mass for this product")
    if u in UNUSABLE_DENOMINATORS:
        return Conversion(None, raw_unit, "non-mass-denominator", None,
                          f"price is per {u}; no tonne equivalence exists")

    # Fixed-mass packages, e.g. "454 grams", "1.36 kilograms" (retail scanner data).
    pkg = re.fullmatch(
        r"(\d+(?:\.\d+)?)\s*(grams?|kilograms?|millilitres?|litres?|ounces?)", u)
    if pkg:
        qty = float(pkg.group(1))
        word = pkg.group(2)
        if word.startswith(("millilitre", "litre")):
            return Conversion(None, raw_unit, "package-volume-not-mass", None,
                              f"package expressed as {qty:g} {word}")
        kg_each = qty * (0.001 if word.startswith("gram")
                         else 1000.0 if word.startswith("kilogram")
                         else 0.0283495)
        factor = KG_PER_TONNE / kg_each
        return Conversion(value * factor, raw_unit, "package-mass", factor, f"package = {kg_each:g} kg")

    return Conversion(None, raw_unit, "unit-unrecognized", None, f"cannot interpret unit {raw_unit!r}")