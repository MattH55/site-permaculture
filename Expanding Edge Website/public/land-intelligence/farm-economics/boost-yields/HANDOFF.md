# Handoff: Full Specialty Crop Price Database build

Status as of 2026-09-17. Price live-key retrieval is in; yield-element discovery
(`yield-improvement-element-discovery-spec.md`) has a first honest pass.

Picks up `full-specialty-crop-price-database-spec.md`. **Do not invent prices
or yield percentages. API keys are environment-only; never committed.**

## What's built and verified

All of it uses real retrieved sources, not fabricated data — every number/name traces
to a cached file under `data/raw/`.

- **`data/raw/usda_master_list/USDASpecialtyCropDefinition.pdf`** — the actual
  11-page USDA AMS PDF (retrieved this session from
  `https://www.ams.usda.gov/sites/default/files/media/USDASpecialtyCropDefinition.pdf`),
  plus the companion HTML page (`ams_specialty_crop_page.html`, not separately parsed —
  it repeats the same appendices as body text) and a raw text dump
  (`pdf_text_dump.txt`) for reference.
- **`price_pipeline/usda_master_list.py`** — parses that PDF into the
  `usda_master_crop_list` table (spec 1.1). Handles the two real structural wrinkles
  found by inspection: (1) Appendix B's compound entries (Bean → Snap or
  Green/Lima/Dry Edible; Pea → Garden/English or Edible Pod/Dry Edible) are kept as
  parent+variant rows, never merged or silently split; (2) Appendix E and F are each
  divided into named subsections that look identical to crop names in plain-text
  extraction, so the subsection header lists are hard-coded from the same retrieved
  document (`FLORICULTURE_SUBSECTIONS`, `INELIGIBLE_SUBSECTIONS` constants) rather than
  guessed from formatting. Output: `output/usda_master_crop_list.csv`, **375 rows**
  across all 6 appendices (A=47, B=55, C=71, D=38, E=127, F=37).
- **`data/raw/napcs/napcs_agricultural_goods_variant.csv`** — the actual NAPCS Canada
  2022 v1.0 Agricultural Goods extension variant CSV (899 rows, retrieved from
  `https://www.statcan.gc.ca/en/media/5274`).
- **`price_pipeline/napcs_ca.py`** — loads it into `napcs_agricultural_codes` (spec
  1.2). The spec asks you to *empirically check* granularity before assuming it — this
  session did: NAPCS itemizes pulses/oilseeds/mushrooms down to variety (mustard by
  colour, lentils by type, chickpeas Desi/Kabuli, Shiitake/Oyster named individually)
  but does **not** itemize culinary herbs — basil, oregano, dill, cilantro, etc. all
  fold into one leaf, code `114221382` "Other fresh fine herbs". That finding is
  recorded per-row via `maps_to_multiple_crops`, not silently forced into a fake
  one-crop-per-code mapping. Output: `output/napcs_agricultural_codes.csv`.
- **`price_pipeline/crop_registry_full.py`** — merges the two into `crop_registry`
  (spec 1.3) and runs the Section 2 identity audit. NAPCS matching is deliberately
  conservative: a USDA crop name only gets a `napcs_code_match` when its keyword hits
  exactly one NAPCS leaf; ambiguous or absent matches stay null (18/375 = 5% matched —
  a real, unpadded number, not a target to inflate). crop_id collisions from crops
  that repeat across floriculture subsections (e.g. "Rose" appears in Cut Flowers,
  Deciduous Shrubs, *and* Potted Flowering Plants; "Azalea" in two subsections) are
  resolved by suffixing the subsection name, verified unique across all 375 rows.
  Output: `output/crop_registry.csv`, `output/crop_identity_audit.csv`.
- **Identity audit findings**: original spec traps (mustard greens vs seed; flax vs
  flaxseed; hemp excluded-but-priced) plus confirmed splits: Capsicum pepper vs
  Piper spice pepper; citrus fruit vs citrus trees; asparagus vs asparagus fern;
  passion fruit vs passion flower; bean and pea parent+variant compounds; cotton
  lint vs cottonseed. All 26 scanner candidates have been read (0 "NOT YET REVIEWED").
- **`price_pipeline/full_coverage_cli.py`** — spec Section 6:
  `ingest-master-list --source usda|napcs-ca`, `audit-identity`,
  `discover --category` / `discover --crop`, `dashboard`, `review-queue`.
- Tests pin the above against cached source files. Full suite: **190 passed**.

## Section 3 discovery: what was built and what it found

`price_pipeline/discovery.py` + `full_coverage_cli.py discover --category X`. This is
explicitly an AUTOMATED FIRST PASS (`checked_by: "automated"` on every record), not the
finished per-crop discovery the spec wants — there is no NASS/AMS API key in this
environment (`usda_price_sources.yaml`'s `nass_quickstats_api`/`ams_market_news_api`
are both `enabled: false` for exactly this reason), so it cannot itself query a live
report. What it honestly *can* do, and does:

1. Cross-references every crop against `data/price-observations/observations.json`,
   the Alberta `price_pipeline` runner's **already-retrieved, real** data. A match only
   counts if the underlying price type is `usable_for_farm_economics: true` per
   `sources.json` — this matters: field vegetables (carrots, cucumbers, onions,
   cabbage, cauliflower, broccoli, pumpkins) only have an `insurance_reference_price`
   observation in that dataset, which is explicitly NOT a market price (AFSC claims
   parameter only), so discovery correctly does NOT count those as priced, even though
   a naive lookup would find a row. Verified by `test_insurance_only_crops_are_not_treated_as_priced`.
2. Checks the NASS special-survey checklist and CA source catalog (`data/*.yaml`) and
   the prior spec's `wide_price_sources.yaml` for a name-keyword match, and records
   what it found as a **lead requiring manual_review** — never as a confirmed tier.
3. Flags any crop_id that's one of the known identity traps (mustard-and-other-greens,
   flax/flaxseed, hemp) with an explicit CAUTION note, because the crude
   first-word-keyword matcher used above genuinely did walk into one of these on its
   first run (it matched "mustard-and-other-greens" against the Alberta Weekly Crop
   Market Review catalog entry, whose real coverage is mustard *seed*, a different
   commodity) — this is now caught and flagged rather than silently trusted.

**Run so far** — all 375 crop_registry rows have a discovery record.

### extend-coverage.md Section 1 (done)

1.1 `checked_ca_statcan` is **true on all 375** after an actual lookup against
    retrieved `raw/18100245.zip` (110 grocery products). 26 crops are present in
    that table as fresh/packaged items; retail_price is `usable_for_farm_economics:
    false`, so those hits are **not** selected as `selected_tier_ca`. The other 349
    are `ca_tier not_applicable`. Mapping is explicit (Capsicum `pepper` gets
    "Peppers, per kilogram"; Piper culinary pepper does not; lemons do not attach
    to lemon-balm).
1.2 Mustard spot-check: Alberta `mustard` average_farm_price is attached to
    **mustard-seed** (oilseed), not mustard-and-other-greens. Both reviewer_notes
    contain `SPOT-CHECK 1.2`.
1.3 Named special surveys (retrieved where a crop_id exists):
    - mushrooms — US Tier A, 2026 $1.45/lb national PRICE RECEIVED
    - hops — US Tier A, 2025 $5.38/lb
    - honey — new `crop_id=honey` (not Honey Locust); US Tier A 2025 $3.05/lb
    - maple-syrup — new `crop_id=maple-syrup` (not Maple the tree); US Tier A
      2025 $35.60/gallon
    - census_horticultural_specialties (lavender) — value only, not retrieved

### live-key-retrieval.md (this session)

Health checks: NASS CORN 2025 $4.10/bu; AMS `/reports` 1051 items.

`output/crop_nass_series_map.csv` from retrieved PRICE RECEIVED (63 crop_ids).
Raw files get `.meta.json` sidecars (`sha256`, `retrieved_at`; no key in URL).

AMS Report Details extracts (commodity+price counts, not 100k-row dumps):
- NY vegetables `2315`: 132 commodities, 131 priced
- NY fruit `2314`: 78 / 77
- Boston ornamentals `BH_FV201`: 142 / 141
- 41 crop_ids mapped; 8 with no NASS unit price are US Tier B
  (okra, eggplant, banana, blackberry, pineapple, cranberry, fig, ginger)

AMS coverage gap: 13 Wholesale Market Misc Herbs FV055 slugs are discontinued
in MARS. Culinary herbs: `checked_us_ams=true`,
`ams_api_coverage=not_yet_migrated`. Traditional mnreports PDF remains a valid
Tier B fallback and was not re-parsed.

Floriculture: AMS ornamentals are live, but strings are botanical cut-flower
names that do not 1:1 to Appendix E crop_ids. Catalog-checked; 0 floriculture
unit-price tiers.

Medicinal herbs: 0 A/B after live NASS/AMS — matches C/D/E expectation.

Mustard NASS MUSTARD $31/cwt 2025 is on **mustard-seed**, not greens.
Honey/maple live series are on the new product rows, not the shade trees.

### Current dashboard (uneven)

377 registry rows (375 USDA + honey + maple-syrup). **61 US A, 8 US B, 11 CA B.**
0 discovery_complete. review-queue still 377 (farmers-market, census, trade, CA
census/trade still open).

| bucket | n | US A | US B |
|---|---:|---:|---:|
| Vegetables | 55 | 25 | 2 |
| Fruits and Tree Nuts | 47 | 21 | 5 |
| Culinary Herbs and Spices | 71 | 1 (hops) | 1 |
| Medicinal Herbs | 38 | 0 | 0 |
| Horticulture / Honey | 1 | 1 | 0 |
| Horticulture / Maple Syrup | 1 | 1 | 0 |
| Floriculture | 127 | 0 | 0 |
| Ineligible | 37 | NASS grains/oilseeds A | |

### yield-improvement-element-discovery-spec.md (first pass)

CLI: `yield-discover`, `yield-review-queue --tier D`, `yield-dashboard`.

`output/yield_elements.csv`: **85 rows** — 78 imported from `data/yield-factors`
(URL required) plus **7 transcribed from papers actually opened**
(`data/yield-elements/curated_from_papers.json`). Peas→`pea-dry-edible`,
pepper→Capsicum, tomato→`tomato-including-tomatillo`. Livestock/ornamental
buckets skipped. Taxonomy: `protected_environment` (v1.1), `colony_nutrition` (v1.2).

Quantified rows added this pass (effects stored as the paper reported them, not
averaged or converted to a single % unless the authors stated one):

- hops N 250 vs 0 kg ha−1: cone DM **386.7 vs 245.8 kg ha−1** (Lagos et al. 2023 Ceres)
- hops in-row 300×114 vs 300×100 cm: **2.80 vs 2.58 t ha−1**; authors: **+10%** (Kořen 2008 PSE)
- A. bisporus 1 in vs 5 in cocopeat casing: **638 vs 355 g/bag**
- A. bisporus 2% vs 1% spawn: **45.67 vs 20.79 kg m−2** (Shibli 2025)
- honey Diet 1 vs Megabee: **14 ± 2 vs 8 ± 1 kg/colony** (Kim et al. 2024 Insects; n=3)
- maple vacuum vs unpumped: **43.7 vs 16.4 qt/taphole** Area I (USDA FS NE-91)
- maple high-yield retubing: authors **70.6%** (0.58 vs 0.34 gal/tap, UVM 20 yr)

Retracted PLOS ONE Ahmad 2021 honey-feeding paper was **not** used. CrossRef
title-only files remain in `raw/yield-literature/` and still do not contribute
effect sizes. 16 crops now have elements.

`yield-review-queue --tier D` is empty. Discovery checklists are incomplete except
peer-reviewed-search on the 12 imported crops plus those four CrossRef crops.

## What's explicitly NOT done — next agent starts here

0. **Yield elements:** extension-trial/guidance searches; fertility pass across a
   whole category with actual paper reads (not titles); hops/mushroom substrate
   trials once a PDF/HTML with a quantified yield effect is retrieved; do not
   copy canola boron findings onto mustard greens.
1. **Floriculture botanical-name map** from BH_FV201 onto Appendix E crop_ids
   (snapdragon, rose, lily). Do not dump 142 names onto one row.
2. **AMS herbs PDF fallback** (`ams.usda.gov/mnreports/...`) now that FV055 is
   not_yet_migrated in the API.
3. Remaining `checked_*`: farmers-market, census (non-lavender), US trade,
   CA census, CA trade.
4. Date-filtered AMS details to shrink payloads.

Never commit API keys.

## How to resume

```bash
cd farm-economics/boost-yields
python -m pytest tests/test_full_coverage.py tests/test_discovery.py tests/test_nass_quickstats.py -q
python -m price_pipeline.full_coverage_cli dashboard
```

