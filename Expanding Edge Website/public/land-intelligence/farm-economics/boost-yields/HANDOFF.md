# Handoff: Full Specialty Crop Price Database build

Status as of 2026-09-17. This picks up `full-specialty-crop-price-database-spec.md`,
which supersedes the two prior specs. **Section 1 (master crop list ingestion) is
built and tested. Section 2 (identity audit) has a working first pass. Section 3
(discovery) has a working AUTOMATED first pass, run for 5 of the spec's priority
categories (248 of 375 crops). Sections 3's manual-review layer, the dashboard's
tier-count rollup, `discover --crop`, and `review-queue` are NOT started** — that's
intentionally where this session stopped, not an oversight. The spec itself says the
discovery phase is not a one-sitting job (Section 3.4's priority ordering exists
precisely because it's a multi-session rollout), so this handoff draws the line where
the automated-pass mechanism is proven and has run once, leaving the manual-review /
API-key-equipped retrieval layer for the next agent.

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

**Run so far** — 5 of the spec's priority-ordered categories, 248 of 375 crops:

| category | crops | real tier confirmed | leads for manual review | no lead |
|---|---:|---:|---:|---:|
| Vegetables | 55 | 1 (lentils) | 6 | 48 |
| Fruits and Tree Nuts | 47 | 0 | 0 | 47 |
| Culinary Herbs and Spices | 71 | 0 | 1 | 70 |
| Medicinal Herbs | 38 | 0 | 0 | 38 |
| Ineligible Crops (all 4 subsections) | 37 | 7 (canola, flaxseed, buckwheat, oats, rye, sugar-beet, hay) | 6 | 24 |

The low real-tier-confirmed count is an honest reflection of reality, not a bug to
chase: almost nothing in this repo has been actually retrieved from a live NASS/AMS/
provincial source yet — only the Alberta `price_pipeline`'s own prior work has. That
is exactly the gap the next agent's manual-review pass (or a NASS/AMS API key) needs
to close.

Not yet run: Floriculture and Nursery Crops (127 crops across 14 subsections) — per
the spec's own Section 3.4 priority order, this is deliberately last ("lowest
relevance to a 'price database' in the commodity sense... deprioritize unless
explicitly requested").

## What's explicitly NOT done — next agent starts here

1. **Manual review of the 13 leads** recorded by the automated pass (`output/crop_discovery_record.csv`,
   filter for non-empty `selected_source_us`/`reviewer_notes` containing "lead") —
   each needs a human (or API-equipped agent) to actually open the named report and
   confirm/reject before it becomes a real `selected_tier`.
2. **A NASS/AMS API key** (`NASS_API_KEY`, `AMS_API_KEY` env vars) would unlock real
   Tier A/B retrieval for the 340+ crops currently at "no lead found" — most of those
   are ordinary fruits/vegetables/herbs that very likely DO have NASS or AMS coverage;
   this pass simply has no way to query it without a key.
3. **Floriculture and Nursery Crops category (127 crops)** — not run, by design (lowest
   spec priority). Run with `discover --category "Floriculture and Nursery Crops"`
   when/if it becomes a priority.
4. **`ingest-master-list` re-fetch/diff** — the spec wants this to be periodic
   (Section 1.1: "the page is a living list, not a frozen one"). This session did one
   fetch; no changelog table or diff logic exists yet.
5. **`discover --crop` single-crop command** — not built; `--category` exists,
   `--crop` doesn't.
6. **`review-queue` command** — not started. Should list every discovery record with
   `confidence_ca`/`confidence_us == "low"` or an incomplete checklist (i.e. almost
   all of them right now) for the manual pass in item 1.
7. **`discovery_progress_dashboard` tier-count rollup** — `dashboard` currently only
   shows total-vs-discovered counts per category; it should also break down by tier
   (A/B/B2/C/D/E) per category once more real tiers exist, per spec Section 5.2's
   exact column layout.
8. **The 26 unreviewed identity-audit candidates** in `output/crop_identity_audit.csv`
   still need a human pass, same as before — this session did NOT work through them,
   only used the known 3 traps to guard the discovery pass above.

## How to resume

```bash
cd farm-economics/boost-yields
python -m pytest tests/test_full_coverage.py tests/test_discovery.py -q   # confirm this work still passes
python -m price_pipeline.full_coverage_cli audit-identity   # regenerate crop_registry + audit
python -m price_pipeline.full_coverage_cli discover --category "Vegetables"  # re-run/extend discovery
python -m price_pipeline.full_coverage_cli dashboard         # see current coverage
```

Then open `output/crop_discovery_record.csv`, work the leads down to confirmed/rejected
tiers (item 1 above), and/or wire up a NASS/AMS API key to unlock real retrieval for
the ~340 crops currently unmatched.

## Files touched this session (all untracked except as noted — see `git log` for the commit)

```
price_pipeline/usda_master_list.py       (new, committed)
price_pipeline/napcs_ca.py               (new, committed)
price_pipeline/crop_registry_full.py     (new, committed)
price_pipeline/discovery.py              (new)
price_pipeline/full_coverage_cli.py      (new, committed — updated after commit with `discover`)
tests/test_full_coverage.py              (new, committed)
tests/test_discovery.py                  (new)
data/raw/usda_master_list/               (new — cached PDF + HTML + text dump; gitignored)
data/raw/napcs/                          (new — cached NAPCS CSV; gitignored)
output/usda_master_crop_list.csv         (generated; gitignored)
output/napcs_agricultural_codes.csv      (generated; gitignored)
output/crop_registry.csv                 (generated; gitignored)
output/crop_identity_audit.csv           (generated; gitignored)
output/crop_discovery_record.csv         (generated; gitignored)
HANDOFF.md                               (this file, committed)
```

No existing tracked file (from commit `b196f23`) was modified. This is purely
additive — the prior wide-coverage (v1/v2/v3) pipeline is untouched and still works
(`python -m pytest -q` at the package root: 179/179 passing, including this work).
