# Handoff: Full Specialty Crop Price Database build

Status as of 2026-09-17. This picks up `full-specialty-crop-price-database-spec.md`,
which supersedes the two prior specs. **Section 1 (master crop list ingestion) is
built and tested. Section 2 (identity audit) has a working first pass. Sections 3-7
(the ~300-crop per-crop discovery workflow, dashboard refresh loop, and full CLI) are
NOT started** — that's intentionally where this session stopped, not an oversight.
The spec itself says the discovery phase is not a one-sitting job (Section 3.4's
priority ordering exists precisely because it's a multi-session rollout), so this
handoff draws the line at the ingestion layer, which *is* a complete, coherent unit of
work on its own.

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
- **Identity audit findings**: the 3 traps named in the spec (mustard: greens vs
  seed; flax: fiber vs oilseed, both distinct rows in the USDA PDF itself; hemp:
  excluded from the US specialty definition but hemp seed still has a real NAPCS
  oilseed code) are hard-coded with their reasoning in `KNOWN_IDENTITY_TRAPS`, plus an
  automated keyword-collision scanner that surfaced **26 more candidate pairs**
  needing a human read (e.g. "Bean" vs its own variant rows — mostly false positives
  from the scanner's crude first-word heuristic, but a couple worth checking, like
  `citrus` vs `citrus-trees`).
- **`price_pipeline/full_coverage_cli.py`** — implements exactly two of the spec's
  Section 6 commands (`ingest-master-list --source usda|napcs-ca`, `audit-identity`)
  plus a `dashboard` command that's honest about being empty (every category shows 0
  discovered, because discovery hasn't run — not a placeholder pretending otherwise).
- **`tests/test_full_coverage.py`** — 12 tests against the real cached files (not
  mocks), pinning: all 6 appendices parse, Bean/Pea variants link correctly,
  subsection headers never leak in as crop rows, mustard/flax identity traps are
  distinct rows, NAPCS herb-bucketing and pulse-itemization findings, crop_id
  uniqueness, and that NAPCS matching never forces a wrong guess (spot-checked on
  "Rose", which has no NAPCS agricultural-goods leaf and correctly gets `null`).
  Full suite: **174 passed** (162 pre-existing + 12 new), no regressions.

## What's explicitly NOT done — next agent starts here

1. **Section 3 discovery workflow** (the core of the spec) — nothing has been
   discovered yet for any of the 375 crops beyond what the prior two specs' pipeline
   already covers (the ~50-crop `wide_price_sources.yaml` registry). No
   `crop_discovery_record` table exists. Start with Section 3.4's priority order:
   Vegetables (55 crops) and Fruits/Tree Nuts (47 crops) first — highest expected
   Tier A/B density, validates the pipeline mechanics fastest.
2. **`ingest-master-list` re-fetch/diff** — the spec wants this to be periodic
   (Section 1.1: "the page is a living list, not a frozen one"). This session did one
   fetch; no changelog table or diff logic exists yet.
3. **`discover --category` / `discover --crop` CLI commands** — stubs don't exist.
   These need the per-crop/per-category source-checking logic from Section 3, which is
   a large, genuinely incremental build (the spec's own words: "scale by adding crop
   records, not by writing one universal scraper").
4. **`discovery_progress_dashboard` refresh loop** — the current `dashboard` command
   only reads `crop_registry`; once discovery records exist it needs to aggregate real
   tier counts per category instead of hard-coded zeros.
5. **`review-queue` command** — not started; depends on discovery records existing.
6. **The 26 unreviewed identity-audit candidates** in `output/crop_identity_audit.csv`
   need a human (or a follow-up agent) pass to confirm/dismiss each one before Section
   3 discovery starts, per the spec's explicit ordering ("run this before bulk
   discovery... doing it after risks silently merging incompatible price series").

## How to resume

```bash
cd farm-economics/boost-yields
python -m pytest tests/test_full_coverage.py -q          # confirm ingestion still passes
python -m price_pipeline.full_coverage_cli audit-identity  # regenerate crop_registry + audit
python -m price_pipeline.full_coverage_cli dashboard        # see current (all-zero) coverage
```

Then open `output/crop_identity_audit.csv`, work the 26 `candidate_ambiguous_shared_keyword`
rows down to confirmed/dismissed, and start Section 3 discovery on the Vegetables
category per the priority order above.

## Files touched this session (all untracked — nothing committed)

```
price_pipeline/usda_master_list.py       (new)
price_pipeline/napcs_ca.py               (new)
price_pipeline/crop_registry_full.py     (new)
price_pipeline/full_coverage_cli.py      (new)
tests/test_full_coverage.py              (new)
data/raw/usda_master_list/               (new — cached PDF + HTML + text dump)
data/raw/napcs/                          (new — cached NAPCS CSV)
output/usda_master_crop_list.csv         (generated)
output/napcs_agricultural_codes.csv      (generated)
output/crop_registry.csv                 (generated)
output/crop_identity_audit.csv           (generated)
HANDOFF.md                               (this file)
```

No existing tracked file (from commit `b196f23`) was modified. This is purely
additive — the prior wide-coverage (v1/v2/v3) pipeline is untouched and still works
(`python -m pytest -q` at the package root: 174/174 passing, including this work).
