# Next Session — Extend Specialty Crop Coverage

Picked up from the 248/375 checkpoint. Read this alongside
`full-specialty-crop-price-database-spec.md` — this document is a
task list against that spec, not a replacement for it.

Do these in order. Don't skip ahead to Section 3 (new categories)
before Sections 1–2 (closing gaps in what's already been discovered)
are done — a wider pass on top of unverified prior results compounds
any existing mistake across more crops.

---

## 1. Close the three review gaps before doing anything else

### 1.1 Confirm `checked_ca_statcan` is being set explicitly

For all 248 existing `crop_discovery_record` rows, check whether
`checked_ca_statcan` is `true`/`false` or simply absent/null. If it's
null for any of them, StatCan retail-scanner data (Table
18-10-0245-01) was never actually checked — it was skipped, not
ruled out. Since that table only covers ~110 mainstream grocery
items, most specialty crops will correctly resolve to
`checked_ca_statcan: true, ca_tier: not_applicable` — but that
determination has to actually happen and be recorded, not be implied
by its absence. Backfill this field across all 248 records before
moving on; this is a single lookup against one already-known table,
not new discovery work.

### 1.2 Spot-check the mustard-seed identity split

The Alberta mustard-seed alias was attached in the same session the
mustard-greens/mustard-seed-oil split was confirmed. Before
committing anything further:

1. Pull the `crop_id` the newly aliased Alberta mustard-seed price
   is attached to.
2. Confirm it matches the **oilseed** `crop_id`, not the
   **leafy-greens** `crop_id`, per the two rows created in the
   identity audit.
3. If it landed on the wrong one, this is a one-row fix now — do it
   before more data accumulates under the wrong crop_id and makes
   the error harder to spot later.
4. Write the result of this check into
   `crop_discovery_record.reviewer_notes` for both mustard `crop_id`s
   either way, so future review doesn't have to redo this spot-check.

### 1.3 Complete the special-survey checklist status

The handoff names mushrooms and hops as "confirmed lead, not yet
retrieved." The full checklist from spec Section 3.2 also includes
maple syrup, honey, and the Census of Horticultural Specialties
survey (which covers lavender). Determine and record the status of
all five, not just the two that happened to come up:

```
mushrooms        -- confirmed lead, blocked on NASS_API_KEY
hops              -- confirmed lead, blocked on NASS_API_KEY
maple_syrup       -- status?
honey             -- status?
census_horticultural_specialties (lavender)  -- status?
```

If any of these three are genuinely unchecked, check them now — this
is discovery work against a known, named survey, not open-ended
searching, so it shouldn't need the API key to at least confirm
whether the survey has a price field (Section 9 of the original spec:
confirm a price field exists before assigning Tier A, separately from
actually pulling the value).

---

## 2. Once NASS_API_KEY / AMS_API_KEY are available

Do not wait for both keys before starting — NASS and AMS are
independent systems and can be wired one at a time.

1. **Retrieve the two confirmed-but-blocked special-survey leads
   first** (mushrooms, hops) — these are known-good targets, so
   they're the fastest way to confirm the API integration itself
   works before running it across a whole category.
2. **Re-run `checked_us_nass` / `checked_us_nass_special_survey` /
   `checked_us_ams` for the Vegetables and Fruits/Tree Nuts
   categories**, per the spec's Section 3.4 priority order — these
   two categories were presumably discovered in the prior 248-crop
   pass using keyword/metadata search only (no live API pull), so
   their `selected_tier` may currently reflect "a series was found to
   exist" rather than "a value was actually retrieved and stored."
   Confirm which state each of these crops is actually in before
   assuming this step is redundant.
3. **Run `dashboard` after each category** to confirm the tier
   distribution shifts the way expected (more A/B, not a flat jump to
   100% A — a suspiciously uniform result is still a signal to
   spot-check per the spec's Definition of Success, Section 7.3, even
   after keys are wired).

---

## 3. Continue the remaining 127 crops (Floriculture)

Per the spec's priority order, this is last for a reason — most of
this category's real pricing structure (landscape/wholesale nursery
trade) is expected to look different from commodity crop pricing.
Before running full discovery on all 127:

1. Run the NASS Floriculture Crops special survey check across the
   category as a group first (per spec Section 3.3's grouping
   strategy) — this single survey likely resolves a meaningful chunk
   of the category in one pass rather than needing 127 individual
   discovery runs.
2. Only fall back to individualized per-crop discovery for whatever
   the group pass doesn't resolve.
3. Expect a real possibility that a large fraction of this category
   ends up Tier C or E — ornamental/nursery wholesale pricing is a
   different market structure than the commodity and terminal-market
   infrastructure the rest of this database is built on. A low hit
   rate here is not a sign the discovery process is broken.

---

## 4. Before ending the session

* Run `dashboard` and confirm the category-by-tier breakdown looks
  like a plausible, uneven distribution, not a uniform one.
* Run `review-queue` and confirm its count has dropped for reasons
  that make sense (checklists actually completed), not because rows
  were marked complete without every applicable tier being checked.
* Update `HANDOFF.md` with: which of Sections 1–3 above got done,
  exact crop counts remaining per category, and which of the two
  API keys (if either) are now wired.
* Commit. Don't leave a session's work uncommitted purely because
  it's incomplete — incompleteness is expected and tracked via the
  dashboard, not a reason to withhold a commit.
