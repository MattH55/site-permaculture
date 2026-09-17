# Next Session — Keys Are Wired, Resume Tier A/B Retrieval

Both `NASS_API_KEY` and `AMS_API_KEY` have been provided. This
session's job is to actually pull data with them, not just confirm
they're set. Follow this order — don't jump to re-running the full
248/375 crop list before Sections 1–2 confirm the integration itself
is sound.

---

## 0. Before touching any crop data

* Confirm both keys are read from environment variables, not
  hard-coded or committed anywhere in the repo. Check `.gitignore`
  covers whatever env file holds them (e.g. `.env`). If either key
  shows up in a diff at any point this session, stop and remove it
  before committing.
* Confirm which key is which — NASS and AMS are separate systems with
  separate auth schemes (NASS uses a query-string key; AMS/MARS uses
  HTTP Basic Auth with the key as username, no password). Don't
  assume one client library handles both.
* Do a single trivial call against each API before running anything
  crop-specific — e.g. NASS: query a well-known commodity like CORN
  for a recent year; AMS: hit `marsapi.ams.usda.gov/services/v1.2/reports`
  and confirm a 200 with real report metadata back. This isolates
  "the key doesn't work" from "the key works but this specific crop
  query is wrong," which matters for debugging everything after this.

---

## 1. Retrieve the two confirmed-but-blocked special-survey leads first

Mushrooms and hops were already confirmed in a prior session to have
a live NASS price series — this session's job is to actually pull
the values now that the key exists.

1. Fetch both via NASS.
2. Store the raw API response per the raw-retention rule (checksum,
   `retrieval_timestamp`, save the raw JSON) before parsing.
3. Update `crop_discovery_record` for mushrooms and hops:
   `selected_tier_us = A`, `confidence_us` set based on how directly
   the series matched (see `crop_nass_series_map` — don't skip
   populating this table just because the crop was already
   "confirmed"; the confirmed status was a discovery finding, not a
   retrieval record).
4. Run `dashboard` and confirm these two crops now show Tier A. This
   is the smallest possible test of the whole pipeline working
   end-to-end with a live key — treat it as a checkpoint before
   moving to a full category.

---

## 2. Re-run Vegetables and Fruits/Tree Nuts categories via NASS + AMS

Per the priority order in the consolidated spec, these were the first
two categories discovered, but discovery in the prior 248-crop pass
happened **without** a live key — meaning `selected_tier` for crops
in these categories may currently reflect "a series/report was found
to exist" rather than "a value was actually retrieved."

1. For every crop in these two categories with an existing
   `crop_nass_series_map` or `crop_ams_report_map` entry, run the
   actual fetch now and confirm a real value comes back matching the
   series/report that was mapped.
2. If a mapped series turns out not to actually return a price value
   (e.g. it was a production/acreage series mistakenly matched as a
   price series), downgrade that crop's tier and note why in
   `reviewer_notes` — don't leave a false Tier A/B standing because
   the mapping was made before the key existed to verify it.
3. For crops in these categories with **no** existing source map yet,
   run full discovery now that live queries are possible, per the
   normal discovery workflow.

---

## 3. AMS-specific caveat — check coverage before assuming a bug

AMS's own documentation states their data migration to the current
API is ongoing "one commodity at a time" over a multi-year window —
not everything in the traditional AMS reports is necessarily
available via the API yet. Before concluding a parser is broken
because an expected herb/vegetable report doesn't appear:

1. Check `marsapi.ams.usda.gov/services/v1.2/reports` for whether a
   report matching that commodity exists in the API at all.
2. If it doesn't, that's a **coverage gap in AMS's own migration**,
   not a pipeline bug. Record it as `checked_us_ams: true,
   ams_api_coverage: not_yet_migrated` rather than leaving it
   ambiguous or retrying repeatedly.
3. Where AMS API coverage is missing but the traditional PDF/TXT
   report (`ams.usda.gov/mnreports/...`) still exists, that PDF
   remains a valid Tier B source per the original spec — don't
   downgrade a crop to "no AMS data" just because the API path isn't
   populated yet; fall back to the report itself.

---

## 4. Continue down the priority order

After Vegetables/Fruits are confirmed against live data:

1. **Culinary Herbs and Spices** — re-verify basil (already tier-hinted
   from earlier research) and run the rest of the category as a
   group against AMS herb reports, per the grouping strategy.
2. **Horticulture** (honey, maple syrup, hops, tea, turfgrass) — hops
   is done (Section 1); confirm honey's NASS special survey the same
   way; note maple syrup and honey previously had a name-mismatch
   against the USDA master list (the list entries were "Maple (shade
   tree)" / "Honey Locust," not the commodities) — don't let a fresh
   NASS pull for the real commodities get mis-attached to those two
   list rows. Attach to a new `crop_registry` row if the real
   commodities aren't already represented there.
3. **Medicinal Herbs** — expected mostly Tier C/D/E; use live NASS/AMS
   queries to confirm that expectation rather than assume it still
   holds now that real API access exists.
4. **Floriculture** (127 crops) — the prior group pass found
   `has_price_field=false` on the NASS Floriculture Crops survey.
   Now that AMS access exists, check whether AMS carries any
   nursery/cut-flower wholesale reports for this category before
   concluding the whole category stays Tier C/E — this was flagged
   as needing an AMS key specifically in the last handoff.

---

## 5. Before ending the session

* Run `dashboard`. Expect a real jump in Tier A/B counts, but still
  an uneven distribution across categories — a sudden jump to
  near-100% Tier A anywhere is a signal to spot-check the retrieval
  logic (e.g. confirm it isn't defaulting to Tier A on any successful
  API response regardless of whether a real price field came back),
  not a sign of success on its own.
* Run `review-queue` and confirm the count has dropped for real
  reasons — completed checklists — not because incomplete records
  got marked done by mistake during the retrieval push.
* Re-run the mustard-seed and other identity-flagged crops' fetch
  results specifically, and confirm the live-retrieved values landed
  on the correct `crop_id` (oilseed vs. greens, etc.) — the
  identity-audit discipline applies to freshly retrieved data exactly
  as much as it did to the aliased Alberta data.
* Update `HANDOFF.md`: which categories are now backed by live
  API data vs. still discovery-only, any AMS coverage gaps found in
  Section 3, and the new dashboard tier counts.
* Commit. As before, incompleteness is fine and expected — don't
  hold the commit for full coverage.
