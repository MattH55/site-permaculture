"""Crop identity: canonical crop_id per commodity, with original text retained.

The five publishers name the same crop five ways ("Wheat - Red Spring", "Wheat,
spring", "Spring Wheat CWRS 13.5%", "Durum Wheat", "Wheat - Amber Durum"). We map
to a canonical id while keeping ``source_commodity`` verbatim, so the mapping can
be revised later without re-downloading anything.

Precedence is an ORDERED list, not a dict, on purpose: "Corn Heat Units (Silage
Corn)" must resolve to silage rather than grain, and with a dict that outcome
hinges on insertion order nobody can see at a glance. An unmatched string yields
``crop_id = None`` and is surfaced by the validator; it is never rounded to the
nearest-looking crop.
"""

from __future__ import annotations

import re

# (crop_id, patterns) evaluated strictly top-to-bottom. First match wins.
CROP_RULES: list[tuple[str, list[str]]] = [
    # --- composites: distinct economic quantities, never fold into a class ---
    # "Wheat, all" is an across-class average; labelling it "other wheat" would
    # contaminate that bucket. "Mixed grains" is its own commodity. Board/payment
    # series embed subsidy payments, so they are not farm-gate prices at all.
    ("wheat-all", [r"\bwheat,\s*all\b", r"\ball\s+wheat\b"]),
    ("mixed-grain", [r"\bmixed\s+grain(s)?\b"]),
    # --- forage: hay is its own crop; corn silage beats generic silage ------
    ("hay", [r"\bhay\b", r"\btame\s+hay\b", r"\bmixed\s+hay\b"]),
    ("corn-silage", [r"\bcorn\b.*\bsilage\b", r"\bsilage\b.*\bcorn\b",
                     r"\bfodder\s+corn\b"]),
    ("cereal-silage", [r"silage\s*/?\s*greenfeed", r"greenfeed", r"\bsilage\b"]),
    # --- corn: silage before grain -----------------------------------------
    ("corn-grain", [r"\bcorn\b"]),
    # --- wheat classes, most specific first --------------------------------
    ("durum-wheat", [r"\bdurum\b", r"\bcwad\b"]),
    ("winter-wheat", [r"\bwinter\s+wheat\b", r"\bcwrw\b", r"\bwheat\b.*\bwinter\b"]),
    ("spring-wheat", [r"\bspring\s+wheat\b", r"\bcwrs\b", r"\bcpsr\b",
                      r"\bwheat\b.*\bspring\b", r"\bred\s+spring\b"]),
    ("other-wheat", [r"\bcwsws\b", r"\bcnhr\b", r"\bcwes\b", r"\bcwsp\b",
                     r"soft\s+white", r"extra\s+strong", r"prairie\s+spring",
                     r"special\s+purpose", r"\bwheat\b"]),
    # --- other cereals ------------------------------------------------------
    ("barley", [r"\bbarley\b", r"\bmalting\b"]),
    ("oats", [r"\boats?\b"]),
    ("rye", [r"\brye\b"]),
    ("triticale", [r"\btriticale\b"]),
    ("buckwheat", [r"\bbuckwheat\b"]),
    # --- oilseeds -----------------------------------------------------------
    ("canola", [r"\bcanola\b", r"\brapeseed\b"]),
    ("flaxseed", [r"\bflax\s*-?\s*seed\b", r"\bflaxseed\b", r"\bflax\b"]),
    ("mustard", [r"\bmustard\b"]),
    ("coriander", [r"\bcoriander\b"]),
    ("safflower", [r"\bsafflower\b"]),
    ("sunflower", [r"\bsunflower\b"]),
    ("canary-seed", [r"\bcanary\s*seeds?\b"]),
    ("hemp", [r"\bhemp\b"]),
    # --- pulses -------------------------------------------------------------
    ("chickpeas", [r"\bchickpeas?\b", r"\bkabuli\b", r"\bdesi\b"]),
    ("lentils", [r"\blentils?\b"]),
    ("dry-beans", [r"\bdry\s+beans\b", r"\bbeans,\s*(all\s+)?dry\b", r"\bpinto\b",
                   r"\bgreat\s+northern\b", r"\bnavy\s+beans\b",
                   r"\bblack\s*/?\s*others\b", r"\bsmall\s+red\b"]),
    ("fababeans", [r"\bfaba\s*beans?\b", r"\bbroad\s+beans?\b"]),
    ("dry-peas", [r"\bdry\s+peas\b", r"\bpeas,\s+dry\b", r"\bfield\s+peas\b",
                  r"\byellow\s+peas\b", r"\bgreen\s+peas\b", r"\bpeas\b"]),
    ("fresh-beans", [r"\bfresh\s+beans\b", r"\bgreen\s+beans\b", r"\bbeans\b"]),
    # --- roots / special ----------------------------------------------------
    ("sugar-beets", [r"\bsugar\s*beets?\b", r"\bbeets\b"]),
    ("sweet-potatoes", [r"\bsweet\s+potatoes\b"]),
    ("potatoes", [r"\bpotatoes\b"]),
    ("onions", [r"\bonions?\b"]),
    # --- forage seed (AFSC) --------------------------------------------------
    ("alfalfa-seed", [r"\balfalfa\b"]),
    ("timothy-seed", [r"\btimothy\b"]),
    ("fescue-seed", [r"\bfescue\b"]),
    ("brome-seed", [r"\bbrome\b"]),
    ("clover-seed", [r"\bclover\b", r"\balsike\b"]),
    ("forage-seed", [r"\bforage\s+seed\b"]),
    # --- horticulture (retail layer) ----------------------------------------
    ("tomatoes", [r"\btomatoes?\b"]),
    ("cucumbers", [r"\bcucumbers?\b"]),
    ("peppers", [r"\bpeppers?\b"]),
    ("lettuce", [r"\blettuce\b"]),
    ("salad-greens", [r"\bsalad\s+greens\b"]),
    ("mushrooms", [r"\bmushrooms\b"]),
    ("strawberries", [r"\bstrawberries\b"]),
    ("carrots", [r"\bcarrots?\b"]),
    ("apples", [r"\bapples?\b"]),
    ("cabbage", [r"\bcabbage\b"]),
    ("broccoli", [r"\bbroccoli\b"]),
    ("cauliflower", [r"\bcauliflower\b"]),
    ("pumpkins", [r"\bpumpkins?\b"]),
    ("winter-squash", [r"\bsquash\b"]),
]

# Livestock, eggs and dairy are out of scope for a crop price store.
EXCLUDE = re.compile(
    r"\b(cattle|hogs?|sheep|lambs?|poultry|turkeys?|chickens?|eggs|milk|beef|pork"
    r"|veal|steers?|heifers?|calves?|cows?|bulls?|boars?|sows?)\b", re.I)

# Canadian Wheat Board pool prices are a marketing-channel average that explicitly
# includes (or excludes) single-desk payments. They are not a farm-gate price for a
# crop, so folding them into average_farm_price would be wrong even though the crop
# is identifiable.
MARKET_CHANNEL = re.compile(r"\b(canadian wheat board|single[- ]desk|including payments|excluding payments)\b", re.I)

# Processed food, not an agricultural commodity price.
PROCESSED = re.compile(
    r"\b(canned|frozen|juice|dressing|shampoo|detergent|butter|margarine|flour"
    r"|bread|salad\s+dressing|soup|yogurt|cheese)\b", re.I)

# (crop_id, [compiled patterns]) preserving CROP_RULES order; first match wins.
_COMPILED: list[tuple[str, list[re.Pattern[str]]]] = [
    (crop_id, [re.compile(p, re.I) for p in pats]) for crop_id, pats in CROP_RULES
]


def clean_label(text: str | None) -> str:
    """Normalize dashes/whitespace so en-dash and hyphen variants compare equal.

    AFSC's PDFs decode an en-dash as the cp1252 mojibake sequence "â€“" when the
    font's ToUnicode map is incomplete. Collapsing any run of non-ASCII
    dash-looking junk to a plain hyphen keeps "Wheat â€“ Red Spring" and
    "Wheat - Red Spring" identical for matching purposes.
    """
    if not text:
        return ""
    t = str(text).replace("\u2013", "-").replace("\u2014", "-")
    t = re.sub(r"[\u00c2\u00e2\u20ac\u201c\u201d\u2020\u00a0]+", "-", t)
    t = re.sub(r"-{2,}", "-", t)
    t = re.sub(r"\s+", " ", t).strip(" -")
    return t


def crop_for(source_label: str | None) -> str | None:
    """Canonical crop_id for a source commodity string, or None if unrecognized."""
    lab = clean_label(source_label)
    if not lab or EXCLUDE.search(lab) or PROCESSED.search(lab) or MARKET_CHANNEL.search(lab):
        return None
    for crop_id, pats in _COMPILED:
        if any(p.search(lab) for p in pats):
            return crop_id
    return None


# Variant hints, most specific first, so "CW Select" is not reported as "CW" and
# "Argentine/Polish" survives as one token.
_VARIANT_PATTERNS = [
    r"\bCW Select\b", r"\bSelect\s+CW\b", r"\bCWRS\b", r"\bCWSWS\b", r"\bCWAD\b", r"\bCWRW\b",
    r"\bCNHR\b", r"\bCWES\b", r"\bCWSP\b", r"\bCPSR\b", r"\bCPS\b",
    r"\bCAN\b", r"\bCW\b", r"\b2R\b", r"\bHigh Protein\b", r"\bIndustrial\b",
    r"\bMalting\b", r"\bMilling\b", r"\b9mm\b", r"\b8mm\b", r"\b7mm\b",
    r"\bKabuli\b", r"\bDesi\b", r"\bBrown\s*/\s*Oriental\b", r"\bArgentine\s*/\s*Polish\b",
    r"\bSpecialty Oil\b", r"\bArgentine\b", r"\bPolish\b", r"\bYellow\b",
    r"\bGreen\b", r"\bBrown\b", r"\bOriental\b", r"\bHybrid\b",
    r"\bComm(?:ercial)?/Pedigreed\b", r"\bPedigreed\b", r"\bCommercial\b",
    r"\bCertified\s+#?\d\b", r"\bSound\s*&\s*Dry\b", r"\bGrain\b", r"\bSilage\b",
    r"\bChip\b", r"\bFry\b", r"\bTable Creamer\b", r"\bRusset\b", r"\bTable\b",
    r"\bSeed\b", r"\bFresh\b", r"\bProcessing\b", r"\bOrganic\b",
    r"\bHeat Units\b", r"\bLOM\b", r"\bBarley Proxy\b", r"\b\d+(?:\.\d+)?%\b",
    r"\b1-Canada\b", r"\b2-Canada\b", r"\bCommon\b",
]
_VARIANT_RE = [re.compile(p, re.I) for p in _VARIANT_PATTERNS]


def variant_for(source_label: str | None) -> str | None:
    """Class/grade/style hint (CWRS, 8mm, Kabuli, Pedigreed, ...), if present.

    Kept as free text rather than a taxonomy: it is display/provenance detail, and
    collapsing it into crop_id would lose the distinction between, say, feed and
    malting barley, which are priced separately by every source here.
    """
    lab = clean_label(source_label)
    if not lab:
        return None
    for rx in _VARIANT_RE:
        m = rx.search(lab)
        if m:
            return re.sub(r"\s+", " ", m.group(0)).strip()
    return None

