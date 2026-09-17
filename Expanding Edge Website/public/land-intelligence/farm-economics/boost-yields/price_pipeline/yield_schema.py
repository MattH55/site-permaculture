"""Controlled vocabulary for yield-improvement elements.

Taxonomy changes are versioned here. Adding a type is a logged decision, not a
silent one-off string in a CSV row.
"""
from __future__ import annotations

ELEMENT_TYPES = (
    "soil_fertility",
    "irrigation_practice",
    "cultivar_selection",
    "plant_density",
    "pollination_management",
    "pest_disease_management",
    "biostimulant_inoculant",
    "pruning_training",
    "cover_crop_rotation",
    "harvest_technique",
    # Logged 2026-09-17: greenhouse lighting / CO2 / temperature evidence already
    # exists in data/yield-factors and does not fit irrigation_practice.
    "protected_environment",
)

TAXONOMY_CHANGELOG = [
    {
        "version": "1.1",
        "date": "2026-09-17",
        "change": "added protected_environment",
        "reason": "Existing tomato/cucumber/pepper/lettuce evidence is greenhouse "
                  "LED/CO2/temperature; the original 10 types had no slot without "
                  "mislabeling it as irrigation or soil fertility.",
    },
    {
        "version": "1.0",
        "date": "2026-09-17",
        "change": "initial 10 types from yield-improvement-element-discovery-spec.md",
        "reason": "spec Section 1",
    },
]

# Existing yield-factors factor_category -> element_type. Unmapped categories
# must not be guessed into a nearby type.
FACTOR_CATEGORY_TO_ELEMENT_TYPE = {
    "nutrients": "soil_fertility",
    "soil": "soil_fertility",
    "soil fertility": "soil_fertility",
    "water": "irrigation_practice",
    "irrigation": "irrigation_practice",
    "genetics": "cultivar_selection",
    "cultivar": "cultivar_selection",
    "crop establishment": "plant_density",
    "plant density": "plant_density",
    "crop management": "plant_density",
    "pollination": "pollination_management",
    "pest management": "pest_disease_management",
    "disease management": "pest_disease_management",
    "weed management": "pest_disease_management",
    "biological inputs": "biostimulant_inoculant",
    "biostimulants": "biostimulant_inoculant",
    "harvest management": "harvest_technique",
    "light": "protected_environment",
    "co2 / carbon availability": "protected_environment",
    "co2": "protected_environment",
    "climate": "protected_environment",
    "temperature": "protected_environment",
    "stress": "protected_environment",
}

DIRECTION_MAP = {
    "positive": "increase",
    "negative": "decrease",
    "mixed": "mixed",
    "nonlinear": "mixed",
    "context_dependent": "mixed",
    "null": "no_significant_effect",
    "increase": "increase",
    "decrease": "decrease",
    "no_significant_effect": "no_significant_effect",
}

EFFECT_DIRECTIONS = ("increase", "decrease", "no_significant_effect", "mixed")
SOURCE_TIERS = ("A", "B", "C", "D", "E")
SOURCE_TYPES = (
    "peer_reviewed", "extension_trial", "extension_guidance",
    "industry_trial", "anecdotal",
)
STUDY_DESIGNS = (
    "replicated_field_trial", "on_farm_trial", "greenhouse_trial",
    "meta_analysis", "observational", "none",
)

# yield-factors crop_id -> crop_registry crop_id. Livestock and undifferentiated
# buckets are omitted (not in crop_registry).
YIELD_FACTOR_CROP_MAP = {
    "barley": "barley-including-malting-barley",
    "canola": "canola",
    "cucumber": "cucumber",
    "hemp": "hemp",
    "lentils": "lentils",
    "lettuce": "lettuce",
    "oats": "oats",
    "peas": "pea-dry-edible",
    "pepper": "pepper",  # Capsicum vegetable, not Piper spice
    "sugar-beet": "sugar-beet",
    "tomato": "tomato-including-tomatillo",
    "wheat": "wheat",
}


def element_type_for_category(factor_category: str) -> str | None:
    if not factor_category:
        return None
    return FACTOR_CATEGORY_TO_ELEMENT_TYPE.get(factor_category.strip().lower())


def direction_for(raw: str) -> str:
    return DIRECTION_MAP.get((raw or "").strip().lower(), "mixed")
