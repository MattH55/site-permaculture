"""Crop identity expansion and programmatic search-alias generation (v3 §5, §6, §50-53).

Every seed crop gets an identity record: canonical name, common names, scientific name,
commodity synonyms and economically-distinct forms. The record exists so that discovery can
search on *every* name a source might file the crop under — and so that normalization never
treats unlike forms (dried saffron vs fresh; stevia leaf vs extract) as interchangeable
(§36).

Identities are *search metadata*, not findings: a scientific name widens the search net but
never promotes a match by itself (§32 lists it as one confidence factor among several).

Hand-curated overrides exist only where the naive derivation (underscore-split + s-plural)
is wrong or materially incomplete — the four §50-53 worked examples and their neighbours.
Everything else is derived programmatically so the list cannot silently drift out of date.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# §6: the price-concept suffixes combined with every name alias to form search queries.
PRICE_QUERY_SUFFIXES = (
    "price",
    "producer price",
    "farm gate",
    "wholesale price",
    "market price",
    "terminal market",
    "shipping point",
    "auction",
    "retail price",
    "import unit value",
    "export unit value",
)

# Economically distinct forms (§36). A crop's identity lists only the forms a market could
# plausibly quote; the normalizer refuses to merge across them.
FORMS = (
    "fresh", "dried", "frozen", "processed", "powder", "oil", "extract",
    "seed", "root", "leaf", "flower", "whole", "ground",
)


@dataclass(frozen=True)
class CropIdentity:
    """§5 identity record for one crop."""

    crop_id: str
    canonical_name: str
    common_names: tuple[str, ...] = ()
    scientific_name: str | None = None
    genus: str | None = None
    species: str | None = None
    commodity_synonyms: tuple[str, ...] = ()
    forms: tuple[str, ...] = ()
    associated_countries: tuple[str, ...] = ()   # §7 producing-region expansion
    # Guard against the §50 failure mode: names that must NOT be treated as this crop
    # (e.g. the generic "specialty mushrooms" bucket is not shiitake).
    non_equivalents: tuple[str, ...] = ()

    def name_aliases(self) -> list[str]:
        """Every name a source might file this crop under, deduplicated, order-stable."""
        seen: list[str] = []
        for name in (self.canonical_name, self.scientific_name,
                     *self.common_names, *self.commodity_synonyms):
            if not name:
                continue
            base = name.strip()
            variants = {base}
            # §6 plural/singular forms, naive but programmatic and symmetric.
            if base.endswith("s"):
                variants.add(base[:-1])
            else:
                variants.add(base + "s")
            for v in sorted(variants):
                if v and v not in seen:
                    seen.append(v)
        return seen

    def search_queries(self) -> list[str]:
        """§6: alias x price-concept cross product, generated programmatically."""
        queries: list[str] = []
        for alias in self.name_aliases():
            for suffix in PRICE_QUERY_SUFFIXES:
                queries.append(f"{alias} {suffix}")
        return queries


# --------------------------------------------------------------------- §50-53 overrides

_IDENTITY_OVERRIDES: dict[str, dict] = {
    # §51 — saffron: producer/auction/wholesale/retail/import/export are all distinct
    # search targets; dried threads must never merge with a fresh observation.
    "saffron": dict(
        common_names=("saffron threads", "saffron spice"),
        scientific_name="Crocus sativus", genus="Crocus", species="sativus",
        commodity_synonyms=("dried saffron", "saffron stigma"),
        forms=("dried", "whole", "powder"),
        associated_countries=("ES", "IN", "IT"),
    ),
    # §52 — wasabi: fresh root/rhizome vs powder/paste are different products.
    "wasabi": dict(
        common_names=("fresh wasabi", "wasabi root", "wasabi rhizome", "Japanese horseradish"),
        scientific_name="Eutrema japonicum", genus="Eutrema", species="japonicum",
        commodity_synonyms=("Wasabia japonica", "wasabi powder", "wasabi paste"),
        forms=("fresh", "root", "powder", "processed"),
        associated_countries=("JP",),
    ),
    # §53 — stevia: leaf / extract / sweetener are different products.
    "stevia": dict(
        common_names=("stevia leaf", "dried stevia leaf", "stevia leaves"),
        scientific_name="Stevia rebaudiana", genus="Stevia", species="rebaudiana",
        commodity_synonyms=("stevia extract", "stevia sweetener", "steviol glycosides"),
        forms=("fresh", "dried", "leaf", "extract", "powder"),
        associated_countries=("CN", "IN", "BR"),
    ),
    # §50 — shiitake: must resolve to specialty-mushroom series, never to the generic
    # Agaricus-dominated "mushrooms" bucket.
    "shiitake": dict(
        common_names=("shiitake mushroom", "black forest mushroom"),
        scientific_name="Lentinula edodes", genus="Lentinula", species="edodes",
        commodity_synonyms=("dried shiitake", "fresh shiitake"),
        forms=("fresh", "dried"),
        associated_countries=("JP", "CN", "KR"),
        non_equivalents=("specialty mushrooms", "mushrooms", "agaricus"),
    ),
    # §50 — the remaining specialty mushrooms: each keeps the source's own categories.
    "oyster_mushroom": dict(
        common_names=("oyster mushroom",),
        scientific_name="Pleurotus ostreatus", genus="Pleurotus", species="ostreatus",
        forms=("fresh", "dried"), associated_countries=("CN", "JP", "KR"),
        non_equivalents=("specialty mushrooms", "mushrooms"),
    ),
    "lions_mane": dict(
        common_names=("lion's mane mushroom",),
        scientific_name="Hericium erinaceus", genus="Hericium", species="erinaceus",
        forms=("fresh", "dried", "powder"),
        non_equivalents=("specialty mushrooms", "mushrooms"),
    ),
    "maitake": dict(
        common_names=("maitake mushroom", "hen of the woods"),
        scientific_name="Grifola frondosa", genus="Grifola", species="frondosa",
        forms=("fresh", "dried"), associated_countries=("JP", "CN"),
        non_equivalents=("specialty mushrooms", "mushrooms"),
    ),
    "agaricus_white_button": dict(
        common_names=("white button mushroom", "champignon"),
        scientific_name="Agaricus bisporus", genus="Agaricus", species="bisporus",
        forms=("fresh", "processed"),
        non_equivalents=("specialty mushrooms",),
    ),
    "agaricus_cremini": dict(
        common_names=("cremini mushroom", "baby bella"),
        scientific_name="Agaricus bisporus", genus="Agaricus", species="bisporus",
        forms=("fresh",), non_equivalents=("specialty mushrooms",),
    ),
    "agaricus_portobello": dict(
        common_names=("portobello mushroom", "portabella"),
        scientific_name="Agaricus bisporus", genus="Agaricus", species="bisporus",
        forms=("fresh",), non_equivalents=("specialty mushrooms",),
    ),
    # Medicinal/botanical herbs where the scientific name materially widens the search.
    "echinacea": dict(scientific_name="Echinacea purpurea", genus="Echinacea",
                      species="purpurea", forms=("dried", "extract", "root", "flower")),
    "chamomile": dict(scientific_name="Matricaria chamomilla", genus="Matricaria",
                      species="chamomilla", forms=("dried", "flower", "oil")),
    "valerian": dict(common_names=("valerian root",),
                     scientific_name="Valeriana officinalis", genus="Valeriana",
                     species="officinalis", forms=("dried", "root", "extract")),
    "st_johns_wort": dict(common_names=("St. John's wort",),
                          scientific_name="Hypericum perforatum", genus="Hypericum",
                          species="perforatum", forms=("dried", "extract", "flower")),
    "lavender": dict(scientific_name="Lavandula angustifolia", genus="Lavandula",
                     species="angustifolia", forms=("dried", "flower", "oil", "fresh"),
                     associated_countries=("FR", "ES", "BG", "GB")),
    "turmeric": dict(scientific_name="Curcuma longa", genus="Curcuma", species="longa",
                     forms=("dried", "powder", "fresh", "root"),
                     associated_countries=("IN",)),
    "ginger": dict(scientific_name="Zingiber officinale", genus="Zingiber",
                   species="officinale", forms=("fresh", "dried", "powder", "root"),
                   associated_countries=("IN", "CN")),
    "maple_syrup": dict(common_names=("maple syrup", "pure maple syrup"),
                        scientific_name="Acer saccharum", genus="Acer", species="saccharum",
                        forms=("processed",), associated_countries=("CA",)),
}


def _default_forms(crop_group: str) -> tuple[str, ...]:
    if crop_group == "mushroom":
        return ("fresh", "dried")
    if crop_group in {"pulse_specialty", "oilseed_specialty"}:
        return ("whole", "seed")
    if crop_group in {"culinary_herb", "medicinal_herb"}:
        return ("fresh", "dried")
    return ("fresh",)


def identity_for(crop: str, crop_group: str = "") -> CropIdentity:
    """Build the §5 identity record for a seed crop.

    The base record is derived programmatically (canonical name from the seed key,
    group-default forms); curated overrides layer on top. There is no code path that
    fabricates a scientific name — crops without an override simply have
    ``scientific_name = None`` and a narrower (honest) alias set.
    """
    crop_id = crop.strip().lower()
    canonical = crop_id.replace("_", " ")
    ov = _IDENTITY_OVERRIDES.get(crop_id, {})
    return CropIdentity(
        crop_id=crop_id,
        canonical_name=canonical,
        common_names=tuple(ov.get("common_names", ())),
        scientific_name=ov.get("scientific_name"),
        genus=ov.get("genus"),
        species=ov.get("species"),
        commodity_synonyms=tuple(ov.get("commodity_synonyms", ())),
        forms=tuple(ov.get("forms", _default_forms(crop_group))),
        associated_countries=tuple(ov.get("associated_countries", ())),
        non_equivalents=tuple(ov.get("non_equivalents", ())),
    )


def identities_for_seed(seed) -> dict[str, CropIdentity]:
    """Identity records for every crop in a v2 SeedList, keyed by crop id."""
    return {c.crop: identity_for(c.crop, c.crop_group) for c in seed.crops}


def target_countries_for(identity: CropIdentity, seed_countries: tuple[str, ...]) -> list[str]:
    """§7: seed target countries plus any producing-region associations, order-stable."""
    out: list[str] = []
    for code in (*seed_countries, *identity.associated_countries):
        if code not in out:
            out.append(code)
    return out

