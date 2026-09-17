# Handoff: Full Specialty Crop Price Database build

Status as of 2026-09-17 (third session — `next-session-extend-coverage.md`).

Picks up `full-specialty-crop-price-database-spec.md`. **Do not invent prices.**

**NASS QuickStats and AMS Market News keys are wired via environment variables
only (never committed). Section 2 live retrieval is done for NASS PRICE RECEIVED
(mushrooms, hops, then Vegetables and Fruits/Tree Nuts against the 129-commodity
universe). AMS catalog is retrieved (1,051 reports; 10 active US terminal
fruit/veg/nut reports each). Per-crop AMS Report Details unit prices were not
bulk-loaded (100k-row payloads); checked_us_ams is a catalog check for those
categories, not a Tier B assignment.**

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
1.3 Named special surveys:
    - mushrooms — confirmed, `has_price_field=true`, blocked on NASS_API_KEY
    - hops — confirmed, `has_price_field=true`, blocked on NASS_API_KEY
    - maple_syrup — survey exists with a price field, but the USDA master list
      has **Maple the shade tree**, not maple syrup. Not attached.
    - honey — survey exists with a price field, but the master list has
      **Honey Locust**, not honey. Not attached.
    - census_horticultural_specialties (lavender) — applies to both lavender
      rows; `has_price_field=false`; Tier C at best; not retrieved.

### extend-coverage.md Section 2 (NASS done; AMS catalog only)

- `python -m price_pipeline.full_coverage_cli retrieve-us` uses `NASS_API_KEY` /
  `AMS_API_KEY` from the environment. Raw JSON lands in gitignored `raw/nass/`
  and `raw/ams/`.
- Mushrooms retrieved: `MUSHROOMS - PRICE RECEIVED, MEASURED IN $ / LB` 2026
  1.45 USD/lb (national). Hops: `HOPS - PRICE RECEIVED` 2025 5.38 USD/lb.
- NASS PRICE RECEIVED universe: 129 commodities. 61 mapped crop_ids have a
  retrieved unit price. MUSTARD maps only to mustard-seed; maple syrup and
  honey stay unmapped (no matching specialty crop_id).
- Vegetables after live re-run: 25/55 US Tier A. Fruits and Tree Nuts: 21/47
  US Tier A. Distribution is uneven, as required.
- AMS: HTTP Basic (key as username, empty password). Catalog 1,051 reports.
  `checked_us_ams` is true for the 102 vegetable + fruit/tree-nut rows because
  active US terminal FV reports exist. No per-crop AMS Tier B yet.

### extend-coverage.md Section 3 (group pass done)

Floriculture (127 crops) ran as a group against NASS Floriculture Crops:
`has_price_field=false` (wholesale value). No Tier A assigned. Individualized
nursery/terminal prices need AMS_API_KEY; not invented.

### Current tier picture (plausibly uneven)

59 US Tier A (NASS PRICE RECEIVED, retrieved). 11 CA Tier B (Alberta farm-gate).
Dashboard counts a crop once at its best tier, so vegetables show 25 A (including
crops that also have CA B). 0 discovery_complete: farmers-market, census, trade,
CA census/trade still open. `review-queue` remains large for that reason.

| bucket | crops | CA Tier B | notes |
|---|---:|---:|---|
| Vegetables | 55 | 3 | mushrooms NASS lead unretrieved |
| Fruits and Tree Nuts | 47 | 0 | |
| Culinary Herbs and Spices | 71 | 0 | hops NASS lead; lavender census value-only |
| Medicinal Herbs | 38 | 0 | medicinal lavender census value-only |
| Ineligible Crops | 37 | 8 | |
| Floriculture and Nursery Crops | 127 | 0 | group-checked, value-only survey |

## What's explicitly NOT done — next agent starts here

1. **AMS Report Details per commodity** — catalog is in `raw/ams/`. Pull
   `/reports/{slug_id}/Report Details` with a date filter (unfiltered NY veg
   is 100k rows) and attach Tier B only when the `commodity` field names this
   crop. Do not promote from report-title keywords (Orangeburg ≠ oranges).
2. **Remaining `checked_*`:** `checked_us_ams_farmers_market`,
   `checked_us_census_specialty` (except lavender), `checked_us_trade`,
   `checked_ca_census`, `checked_ca_trade`.
3. **Floriculture individualized AMS/nursery prices** — NASS floriculture
   survey is still value-only. AMS ornamentals reports exist (e.g. BH_FV201).
4. Live re-fetch of the USDA PDF / NAPCS CSV.

Never commit API keys. `retrieve-us` reads them from the environment only.

## How to resume

```bash
cd farm-economics/boost-yields
python -m pytest tests/test_full_coverage.py tests/test_discovery.py -q
python -m price_pipeline.full_coverage_cli retrieve-us --nass --ams   # needs env keys
python -m price_pipeline.full_coverage_cli discover --category "Vegetables"
python -m price_pipeline.full_coverage_cli dashboard
```
