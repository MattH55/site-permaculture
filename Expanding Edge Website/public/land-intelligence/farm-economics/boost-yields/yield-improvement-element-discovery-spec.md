# Yield-Improvement Element Discovery — Build Spec

## Objective

For every crop in `crop_registry`, systematically identify **elements
with documented evidence of improving yield** — inputs (nutrients,
biostimulants, amendments), practices (irrigation regime, spacing,
pruning, pollination management), and genetics (cultivar/variety
selection) — and attach each one to its crop with the actual evidence
behind it, not a general agronomic assumption.

This runs on the same discipline as the price pipeline: **evidence
tier first, claim second.** A yield-improvement claim without a
traceable source is not data, however agronomically plausible it
sounds. The failure mode to guard against here is different from
price fabrication but just as real — agronomic advice is saturated
with commercial marketing (biostimulant and input companies
publishing "trial" results to sell product) and repeated folk wisdom
that sounds authoritative without ever having been tested on the
specific crop in question. This pipeline must not launder either
into what looks like a vetted recommendation.

---

# 1. What counts as a "yield-improvement element"

Define a controlled taxonomy — don't let free-text element names
proliferate uncontrolled the way price-source crop names could:

```
element_type:
  soil_fertility        -- N/P/K, secondary macros, micronutrients (B, Zn, Mo, etc.), pH amendment
  irrigation_practice    -- timing, method, deficit irrigation, mulching for moisture retention
  cultivar_selection      -- variety/cultivar with documented yield advantage over a named baseline
  plant_density           -- spacing/population studies
  pollination_management  -- managed pollinators, hand pollination, pollinizer variety pairing
  pest_disease_management -- documented yield-loss prevention from a specific pest/disease control
  biostimulant_inoculant   -- mycorrhizae, PGPR, seaweed extract, humic acid, etc.
  pruning_training         -- canopy/training system effects (mostly perennials, tree fruit, vine crops)
  cover_crop_rotation       -- prior-crop or cover-crop effects on the target crop's yield
  harvest_technique         -- timing/method effects on total or subsequent-season yield
```

Each discovered element becomes a row in `yield_elements`:

```
yield_elements
  element_id
  crop_id                    -- FK to crop_registry
  element_type                -- from taxonomy above
  element_name                 -- specific: "foliar boron application," not "micronutrients"
  claimed_effect                -- e.g. "+12% marketable yield" — store as reported, don't round/soften
  effect_direction              -- increase | decrease | no_significant_effect | mixed
  baseline_comparison            -- what it was compared against (untreated control, standard practice, another cultivar)
  study_context                  -- region, soil type, climate zone, growing system (field/greenhouse/high tunnel)
  source_tier                    -- A | B | C | D | E, see Section 2
  source_type                    -- peer_reviewed | extension_trial | extension_guidance | industry_trial | anecdotal
  source_url
  source_citation
  publication_year
  study_design                    -- replicated_field_trial | on_farm_trial | greenhouse_trial | meta_analysis | observational | none
  sample_size_or_reps              -- as reported; null if not disclosed
  conflict_of_interest_flag         -- true if funded/published by a party selling the element
  confidence                         -- high | medium | low
  retrieval_timestamp
  raw_source_path
```

Never merge two elements into one row because they sound similar
("foliar boron" and "soil-applied boron" are different practices with
potentially different evidence and different effect sizes — keep them
separate, same principle as the price pipeline's package-size
non-collapsing rule).

---

# 2. Source hierarchy

```
Tier A — Peer-reviewed replicated field trials and meta-analyses
         (agronomy/horticulture journals, USDA-ARS technical reports,
         land-grant university refereed publications). Must report an
         actual quantified yield effect with study design and, ideally,
         statistical significance — not just a stated conclusion.

Tier B — Land-grant university extension trial reports
         (Cooperative Extension yield-trial bulletins, county/state
         extension replicated variety or fertility trials). Often not
         peer-reviewed in the journal sense, but methodologically
         disclosed and institutionally accountable. This is the
         closest agronomic analogue to the price pipeline's Tier B2 —
         official, recurring, methodologically transparent, but not
         the top evidentiary tier.

Tier C — General extension guidance without a specific quantified
         trial behind it (standard fertility/spacing recommendation
         sheets, best-practice guides). Useful as practice-level
         guidance but must be labeled as guidance, not as a measured
         yield effect — do not backfill a percentage into
         `claimed_effect` when the source only gives a qualitative
         recommendation.

Tier D — Industry-published trial data (seed, fertilizer, or
         biostimulant company trial results, even when methodologically
         detailed). Store with `conflict_of_interest_flag = true`
         always. Do not silently treat these the same as Tier A/B —
         a company's own trial of its own product is evidence worth
         recording, not evidence worth recommending on its own.

Tier E — No credible evidence source found, or the only available
         claims are anecdotal grower testimony, uncited blog/marketing
         copy, or SEO content with no disclosed methodology. Record
         the audit the same way the price pipeline records Tier E —
         what was checked, not just "nothing found."
```

**Never let Tier D or Tier E content be presented as if it were Tier
A/B** in any downstream report or recommendation surface. If a
crop's only available yield-improvement information is a fertilizer
company's own trial, that's the honest ceiling for that crop right
now — the same "no source" discipline from the price pipeline applies
here: don't upgrade the tier because the claim sounds reasonable or
because no better source turned up after a reasonable search.

---

# 3. Per-crop discovery workflow

Same individualized-but-grouped approach as the price pipeline.

## 3.1 Discovery record

```
yield_discovery_record
  crop_id
  checked_peer_reviewed_search     -- bool (e.g. Google Scholar, USDA ARS PubAg, CrossRef)
  checked_extension_trials          -- bool (land-grant extension yield-trial archives)
  checked_extension_guidance         -- bool
  checked_industry_trials             -- bool, only if no A/B/C found — see priority note below
  elements_found_count
  highest_tier_found
  reviewer_notes
  checked_at
```

A crop is not done until every applicable box is checked — same
discipline as the price pipeline's `crop_discovery_record`. Checking
industry trial data is explicitly **lower priority** than exhausting
peer-reviewed and extension sources first — don't reach for Tier D
before Tiers A–C have been searched, even though industry content is
often easier to find via a plain web search.

## 3.2 Grouping strategy

Group by `element_type` across crops in the same category, not just
by crop:

* Run a **fertility/micronutrient literature pass** across an entire
  crop category at once (e.g. all Culinary Herbs) — many
  micronutrient deficiency-response studies cover several related
  species in one paper.
* Run a **pollination management pass** specifically for crops with
  known pollination dependency (tree fruit, cucurbits, many
  vegetables) as its own grouped pass, since this is a well-studied,
  well-organized literature (e.g. managed bee pollination trial
  data) that likely resolves many crops at once.
* Run a **cultivar-trial pass** per crop individually — this is the
  one category where results are inherently crop- and even
  region-specific and won't generalize across a group.

Record which pass produced each `yield_elements` row in
`reviewer_notes`, same as the price pipeline's grouping-provenance
rule.

## 3.3 Priority order

1. **Crops already at price Tier A/B** first — these are the
   commodity-scale crops most likely to have a deep, searchable
   agronomic literature (corn, vegetables, tree fruit). High
   discovery yield per unit of search effort.
2. **Crops with strong economic interest but currently no yield
   data** — mushrooms, hops, honey, maple syrup all have dedicated
   NASS surveys, implying enough industry scale to also have
   dedicated agronomic research (mushroom substrate composition
   trials, hop trellising/fertility trials, etc.).
3. **Medicinal herbs and specialty botanicals** — expect thinner,
   more scattered literature; likely to surface more Tier C/D/E
   results. Confirm rather than assume.
4. **Floriculture/ornamentals** — lowest priority, consistent with
   the price pipeline's treatment of this category; yield in the
   commercial-crop sense is often not even the right framing for
   cut-flower/nursery stock (quality/uniformity may matter more than
   raw yield), so this category may need element_type additions
   (e.g. `quality_grade_improvement`) rather than forcing everything
   into a yield frame.

---

# 4. Anti-fabrication safeguards (extends the price pipeline's Section 32 equivalent)

Never:

* State a percentage yield improvement that wasn't explicitly reported
  by the source — no interpolating, averaging across studies without
  a formal meta-analysis method, or rounding a range into a single
  number.
* Apply a yield-improvement finding from one crop to a related crop
  without a source that specifically studied the target crop (e.g. a
  boron-deficiency response study on canola does not license a boron
  recommendation for a related brassica like mustard greens without
  its own evidence).
* Treat a Tier D industry trial as equivalent to Tier A/B in any
  ranking, report, or recommendation — always keep the
  `conflict_of_interest_flag` visible downstream, not just stored.
* Present a Tier C general-guidance recommendation as if it were a
  measured yield effect.
* Silently drop studies that report `no_significant_effect` or a
  negative effect — these are exactly as evidentially important as
  positive results and must be stored, not filtered out because they
  don't make a compelling "improvement" story.
* Let element-name variants multiply uncontrolled — normalize against
  a controlled vocabulary before insert, and log any new element name
  as a review item rather than auto-creating it silently.

---

# 5. Schema summary

```
yield_elements                 -- Section 1
yield_discovery_record          -- Section 3.1
element_taxonomy                 -- controlled vocabulary, versioned, changes logged
element_crop_cross_reference       -- flags when a finding from crop X is being considered
                                       for crop Y's review queue, pending its own evidence
                                       (never auto-applied — see Section 4)
```

---

# 6. CLI

```bash
python -m src.cli yield-discover --category "Culinary Herbs and Spices" --element-type soil_fertility
python -m src.cli yield-discover --crop shiitake --element-type biostimulant_inoculant
python -m src.cli yield-review-queue --tier D    # surfaces all industry-trial-only findings for manual review
python -m src.cli yield-dashboard                 # coverage by crop_group x element_type x tier
```

---

# 7. Definition of success

Success is a `yield_elements` table where every row traces to a real,
named, checkable source, every industry-funded finding is visibly
flagged as such rather than blended in, every crop's discovery record
shows a completed checklist even where the result is "nothing found
above Tier D," and no element's effect size has been embellished,
rounded up, or borrowed from a different crop's literature. A sparse,
honestly-tiered table for a niche crop is a correct result — the same
standard the price pipeline already holds itself to.
