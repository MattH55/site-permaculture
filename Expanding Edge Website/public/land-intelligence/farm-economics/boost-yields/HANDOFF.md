# Handoff: Full Specialty Crop Price Database build

Status as of 2026-09-17 (second session). This picks up
`full-specialty-crop-price-database-spec.md`, which supersedes the two prior specs.

**Section 1 (master crop list ingestion) is built, tested, and now writes a
changelog on re-fetch. Section 2 identity audit: the original 3 traps plus 5 more
confirmed commodity splits; all 26 scanner candidates have been human-read (0
unreviewed). Section 3 automated discovery still covers 248/375 crops (floriculture
not run, by spec 3.4). CLI now has `discover --crop`, `review-queue`, and a Section
5.2 dashboard with tier columns. The 13 automated-pass leads have been reviewed:
false keyword hits rejected, two NASS special-survey leads confirmed but not
retrieved (no API key), Alberta aliases applied for mustard seed and dry beans/peas.**

The remaining blocker for real Tier A/B US coverage is still a NASS/AMS API key.
Do not invent prices.

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

**Run so far** — 5 of the spec's priority-ordered categories, 248 of 375 crops.
Keyword matching now uses word boundaries, stopwords, and qualifier-preferring
terms. Alberta aliases: `mustard-seed`→`mustard`, `bean-dry-edible`→`dry-beans`,
`pea-dry-edible`→`dry-peas`.

| category | crops | real CA Tier B | confirmed unretrieved NASS lead | rejected false leads |
|---|---:|---:|---:|---:|
| Vegetables | 55 | 3 (lentils, dry beans, dry peas) | 1 (cultivated mushrooms) | 4 (mustard greens, parent Bean, snap, lima) |
| Fruits and Tree Nuts | 47 | 0 | 0 | 0 |
| Culinary Herbs and Spices | 71 | 0 | 1 (hops) | 0 |
| Medicinal Herbs | 38 | 0 | 0 | 0 |
| Ineligible Crops (all 4 subsections) | 37 | 8 (canola, flaxseed, mustard seed, buckwheat, oats, rye, sugar-beet, hay) | 0 | 3 (fiber flax, grain sorghum, rice) |

Open catalog leads remaining: **0**. `review-queue` still lists all 248 because the
checklist is incomplete (only `checked_ca_provincial` is true) and confidence stays
low until a NASS/AMS retrieval happens. That is correct, not a bug.

Not yet run: Floriculture and Nursery Crops (127 crops across 14 subsections) — per
spec Section 3.4, last on purpose.

## Follow-up session additions

- `discover --crop <id-or-name>`
- `review-queue` / `review-queue --json`
- `dashboard` Section 5.2 columns: total, discovery_complete, A/B/B2/C/D/E, avg_confidence
- USDA master-list changelog (`output/usda_master_crop_list_changelog.csv`) on re-ingest
- Manual lead reviews in `discovery.MANUAL_LEAD_REVIEWS` so they survive re-runs

## What's explicitly NOT done — next agent starts here

1. **A NASS/AMS API key** (`NASS_API_KEY`, `AMS_API_KEY`) to retrieve real US Tier A/B
   series. Confirmed-but-unretrieved: cultivated mushrooms and hops (NASS special
   surveys with `has_price_field: true`). Most fruit/vegetable/herb rows are "no lead"
   only because this environment cannot query QuickStats/Market News. Do not invent
   prices.
2. **Complete the `checked_*` checklist** (spec 3.1). Today only `checked_ca_provincial`
   is true. Do not mark discovery-complete, and do not assign Tier E, until every
   applicable tier has been opened or explicitly marked not-applicable with a source.
3. **Floriculture and Nursery Crops (127 crops)** — not run, by design. Use
   `discover --category "Floriculture and Nursery Crops"` if requested.
4. **Live re-fetch of the USDA PDF / NAPCS CSV.** Changelog/diff logic exists; this
   tree still uses the first cached fetch.
5. **Do not treat `review-queue`'s 248 rows as unfinished lead review.** The catalog
   leads are done. The queue is the incomplete-checklist working list.

## How to resume

```bash
cd farm-economics/boost-yields
python -m pytest tests/test_full_coverage.py tests/test_discovery.py -q
python -m price_pipeline.full_coverage_cli audit-identity
python -m price_pipeline.full_coverage_cli discover --crop saffron
python -m price_pipeline.full_coverage_cli review-queue
python -m price_pipeline.full_coverage_cli dashboard
```

Wire a NASS/AMS key, retrieve (do not guess) the two confirmed special-survey leads
first, then work `review-queue` crop by crop.

Full suite: `python -m pytest -q` → 190 passed. Prior wide-coverage pipeline untouched.
