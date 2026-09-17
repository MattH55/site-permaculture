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

`output/yield_elements.csv`: **142 rows** — 78 imported from `data/yield-factors`
(URL required) plus **64 transcribed from papers actually opened**
(`data/yield-elements/curated_from_papers.json`). Peas→`pea-dry-edible`,
pepper→Capsicum, tomato→`tomato-including-tomatillo`. Livestock/ornamental
buckets skipped. Taxonomy: `protected_environment` (v1.1), `colony_nutrition` (v1.2).
Loader now allows empty `claimed_effect` on `source_type=extension_guidance` (Tier C; no backfilled %).

Quantified rows (effects stored as the paper reported them, not averaged or
converted to a single % unless the authors stated one):

Prior pass:
- hops N 250 vs 0 kg ha−1: cone DM **386.7 vs 245.8 kg ha−1** (Lagos et al. 2023 Ceres)
- hops in-row 300×114 vs 300×100 cm: **2.80 vs 2.58 t ha−1**; authors: **+10%** (Kořen 2008 PSE)
- A. bisporus 1 in vs 5 in cocopeat casing: **638 vs 355 g/bag**
- A. bisporus 2% vs 1% spawn: **45.67 vs 20.79 kg m−2** (Shibli 2025)
- honey Diet 1 vs Megabee: **14 ± 2 vs 8 ± 1 kg/colony** (Kim et al. 2024 Insects; n=3)
- maple vacuum vs unpumped: **43.7 vs 16.4 qt/taphole** Area I (USDA FS NE-91)
- maple high-yield retubing: authors **70.6%** (0.58 vs 0.34 gal/tap, UVM 20 yr)

First-tier vegetables/fruit (price A/B) paper-read pass:
- potato NPK vs none (China meta, 180 studies): authors **+33.64%** overall; NPK together **+49.18%** (Li et al. 2025 PSE)
- onion 82 kg N ha−1 vs 0: marketable **26.77 vs 19.09 t ha−1** (Yeshiwas et al. 2024 PLOS ONE). Do not use 57.84/21.74 — those are not in the paper.
- onion Russet/Jambar vs Bombay Red: marketable **26.50 / 24.57 vs 19.86 t ha−1** (same trial, cultivar main effect)
- onion BARI Piaz-4 150 kg N vs 0: **22.15 vs 10.05 t ha−1** (Khan et al. 2024 BARI; Tier B)
- dry bean Rhizobium vs CK: authors **+32.96%** seed yield; mineral N **+46.69%** (dos Santos Sousa et al. 2022; 68 studies)
- broccoli 0/120/240 kg N: relative head yield **100 / 232 / 295**; authors more than doubled / almost tripled (Vågen 2007)
- broccoli OSU 1992: **1.6 t/ac at 0 N vs 6.8 at 180 lb N/ac** (NWREC; Tier B)
- carrot 29 vs 67 vs 135 kg N (MI processing): 2019 total **78.7 / 91.3 / 92.8 Mg ha−1**; did not plateau (Metiva 2023)
- strawberry silver-on-black + Ir100 vs no mulch + Ir100: **71.9 vs 51.5 t ha−1** (Sarıdaş et al. 2021). Skipped an unverified 28.4 vs 12.3 agriculturaljournals.com PDF.
- apple insects vs exclusion: fruit set **+71%**, seed set **+62%**; open vs hand: fruit set **−41%** (Olhnuud et al. 2022)
- almond Independence bees vs isolation: fruit set **~60%** higher; kernel **5.53 vs 4.49 kg/tree** (~20%); Beeflow-funded, COI flag true (Sáez et al. 2020)
- blueberry insect pollination: authors report **R² 64.8 / 75.9 / 75.2%** for fruit set / berry weight / seed set — not percent yield. USDA-ARS blurb that restated R² as “increased by 64.8%” was not stored (Eeraerts et al. 2023)

Second remaining-veg/fruit pass:
- asparagus drip N fertigation vs broadcast N no irrigation: **8.79 vs 5.69 t ha−1** green spears, authors **+54%** (Rolbiecki et al. 2022; water and N placement confounded)
- cabbage 0 N vs 180 N vs 240 N+S: marketable **30.3 / 62.7 / 75.8 t ha−1** (Kacjan Maršić et al. 2021 Table 1)
- sweet potato N vs none (China meta, 45 papers): authors **+1.7%** fresh tuber yield overall (Ji et al. 2024) — small effect stored as written
- eggplant 100 kg N vs 0: **3713 vs 2615 g/plant**; 150 kg below the 100 kg peak (Aminifard et al. 2010)
- garlic 50 vs 0 lb N/acre: authors **+20%** in year 2; **no yield difference** among 50/100/150 lb (Cornell CCE 2018; Tier B)
- grape 60% vs 100% CWR: authors **−17.11%** yield/vine; 80% CWR **−3.70% ns** (El-Salhy et al. 2026)
- cherry cv. Regina bagged vs open vs hand: fruit set **2% / 28% / 39%** (Osterman et al. 2023)
- raspberry pollinator exclusion: authors **68.2%** reduction in marketable fruit set, D = 0.68 (Ryan et al. 2023)

Third veg/fruit pass + first medicinal-herb pass:
- cauliflower 0/75/150/225 kg N: Table VI curd **8.81 / 29.1 / 31.0 / 33.9 Mg ha−1** (Bozkurt et al. 2011)
- spinach 0–300 kg N: authors **yield similar among fertilizing treatments**; mean **37.8 t ha−1** fresh (Canali et al. 2014). Honest null. *Spinacia*, not *Tetragonia*.
- watermelon (maps to `melon-all-types`) 0 vs 270 kg N, 2018: **32581 vs 55454 kg ha−1** at 0 B (Gülüt 2021 Table 3)
- ginseng N1 20 g m−2: **816.56 g m−2**; authors **+29.90% vs N0** and **+38.05% vs N2** (unimodal; Li et al. 2025). *Panax ginseng*, not notoginseng.
- stevia control vs urea 100: plant **13770 vs 24370 kg ha−1**; leaf **7630 vs 14900** (Śniegowska et al. 2024 Table 3)
- coneflower 0 vs 150 kg N: dry herb **3817 vs 8746 kg ha−1** (Soltanbeigi & Maral 2022; DOI 10.29393/chjaa38-16ayah20016)
- St. John’s wort 250 N+100 P vs control: herb **1053.9 vs 745.8 g m−2**; fertiliser also raised herb Cd (Azizi & Omidbaigi 2002)
- fenugreek 90 vs 0 kg N: seed **15.29 vs 11.67 q ha−1**; 120 kg N below the 90 kg peak (Jagdale & Dalve 2011; stored on `medicinal-herbs-fenugreek`)
- lavender/lavandin Super A 0 vs 100 kg N, 2010 dry flower **217.9 vs 3849 kg ha−1**; 150 kg N below 100 kg peak (Kucukyumuk et al. 2015; stored on `medicinal-herbs-lavender`). Extreme 0-N jump stored as published.

25-crop ingest (`ingest-25-crop-yield-findings.md`; cauliflower/cranberry excluded as already resolved / out of report):
- artichoke Schrader 1992: **highest numerical yield at 200 lb/ac N** (Table 2 cells not in accessible text; medium). Shinohara 2011: authors **20% to 35%** yield reduction at 50% ETc; N-rate **null**.
- okra Manipur 2024: **11.42 vs 17.14 t ha−1** at 0 vs 150 kg N (geographic_scope=non_US).
- beet-table: OSU FG13 **Tier C guidance**, empty claimed_effect. sugar-beet UNL AONR **166 kg ha−1 sugar / 179 root** — separate `crop_id`, not copied onto table beet.
- pumpkin Illinois 2018 + squash NC State 2020 / MSU 2022: cultivar trials (discovery-spec Tier B).
- sweet corn Paranhos 2025: N treatment **ns**; site-years **17,380 / 15,951 / 14,470 kg ha−1** (AL22 / GA20 / AL21) not averaged.
- watermelon UGA 2019: **52,959–99,924 lb/acre** across cultivars (`melon-all-types`).
- fig Gordon Acta Hort 1310: LSU/Italian 376/Aklo Lalo highest yield; **LSU not commercially viable** (small fruit).
- blackberry Reynoso: 10 and 10-split **2.5 kg** highest vs other N treatments. Clark 2005 Prime-Jan/Jim **AR vs OR not averaged**.
- pistachio Lovatt FREP 09-0584: **null** on split-nut yield. Funding public (FREP+UCR); Paramount orchard cooperator, COI false.
- avocado Duke 7 **103.5** vs G755B **19.5 kg/tree** (Phytophthora-free). walnut SDI Chandler **6.7/6.4/12.2 vs 13.9 kg/tree**.
- apricot Rab 2012: **0.794 vs 0.408 kg/branch** at 0 vs 40% thinning. peach Horticulturae: size up, **yield down in one year**.
- kiwi Cruz-Castillo 2014: authors **about 12% (+12.6 g fruit−1)**; `regulatory_flag=true` (CPPU).
- macadamia Stephenson 2000: authors **17% lower** yield at high N; NIS **33.8/29.6/28.8 kg/tree**. Hawaii Res-039 is Tier C only.
- pineapple Djido 2021: authors **25 and 33%** density increase (not computed here from 54.9–69.1 to 90.1).
- citrus Kadyampakeni 2024: **no yield differences** among N/P rates (null kept). SL253 is Tier C.
- date Khadrawi: 30% strand thinning **lowest yield/palm** vs control. olive Curtright 2025: **same yield at 25–50% less N**.
- papaya: UH-CTAHR F&N-3 **Tier C only** (US rate-trial gap).

Excluded (logged in `data/yield-elements/source_exclusions.json`): US Patent 11,858,869 macadamia; Haifa banana schedule; tdev.umb.edu-style success-story pages.

Retracted PLOS ONE Ahmad 2021 honey-feeding paper was **not** used. CrossRef
title-only files remain in `raw/yield-literature/` and still do not contribute
effect sizes. **62 crops** now have elements (Vegetables 26, Fruits 21,
Medicinal Herbs 6, plus prior hops/honey/maple and imported grains).
`yield-review-queue --tier D` is empty.

Price-A/B veg/fruit still without a paper-read yield row (honest zeros, do not
borrow): celery; banana, nectarine, pear, pecan, cranberry.

Price-data **manual_sourcing_required** notes on `crop_discovery_record`:
macadamia (NASS Hawaii ended 2018–19), banana, pineapple, okra, artichoke,
date, fig, kiwi.

Medicinal herbs still without a paper-read yield row (do not borrow):
artemissia, mullein, arum, passion-flower, astragalus, patchouli, boldo,
pennyroyal, cananga, pokeweed, medicinal-herbs-comfrey, senna, skullcap,
feverfew, sonchus, foxglove, sorrel, ginko-biloba, tansy, goat-s-rue, urtica,
goldenseal, witch-hazel, gypsywort, wood-betony, medicinal-herbs-horehound,
wormwood, horsetail, yarrow, yerba-buena, liquorice, marshmallow.

`yield-review-queue --tier D` is empty. Discovery checklists are incomplete except
peer-reviewed-search on crops that now have elements.

## What's explicitly NOT done — next agent starts here

0. **Yield elements:** remaining veg/fruit zeros (celery; banana, nectarine,
   pear, pecan, cranberry). Remaining medicinal herbs. Papaya/beet-table have
   Tier C guidance only. Fenugreek/lavender dual listings stay on medicinal
   `crop_id`. No cross-crop borrowing. Do not promote patent/Haifa exclusions.
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

