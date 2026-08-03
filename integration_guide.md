# Expanding Edge — Site Report → Quote → Booking → Payment
### Integration guide for `rate_engine.js`

This covers three things: how the topography file feeds a swale
recommendation, how pond tiers are presented, and how a finished
list of recommended services turns into a quote, a deposit, a
Calendly booking, and a PayPal payment.

---

## 1. Topography file → swale meterage

`recommendSwaleMeters(topoData)` expects the site's topography file
already reduced to this shape (this is the reduction step your
photogrammetry/LiDAR pipeline should perform before calling the
rate engine — the engine itself does no GIS processing):

```js
{
  avgSlopePercent: 8.5,          // required — mean slope across the candidate zone
  siteAreaHectares: 4.2,         // optional, for logging/context
  contourLines: [                // required — from the DEM/contour export
    { elevationM: 412.0, lengthM: 186.4 },
    { elevationM: 412.5, lengthM: 191.0 },
    { elevationM: 413.0, lengthM: 179.8 },
    // ...
  ],
  coverageFraction: 0.6          // optional, default 0.6 — % of contour
                                  // length that's actually buildable after
                                  // excluding structures, roads, waterways
}
```

**Decision logic** (already implemented in the engine):

| Condition | Result |
|---|---|
| `avgSlopePercent` missing | not recommended — insufficient data |
| `avgSlopePercent < 2` | not recommended — too flat to matter |
| `avgSlopePercent > 20` | not recommended — landslide/blowout risk; suggest check dams instead |
| `2–20%` with contour data | recommended — meterage computed from contour lines at slope-appropriate vertical spacing (2m spacing under 5% slope, 1.5m under 10%, 1m above) |

The function returns `{ recommended, meters, reasoning, ... }`.
**Only call `estimate('swale', meters, ...)` and add it to the quote
if `recommended` is true.** This is the hook where "the app can
choose not to recommend it" lives — the recommendation is a plain
boolean your site-report step checks before including swale pricing
at all.

This is a first-pass heuristic, not a stamped design — treat the
output meterage as a planning number that a designer still
sanity-checks against the real contour map before excavation.

---

## 2. Pond price tiers

`pondTierQuotes(opts)` returns all three tiers with pricing
attached, ready to render as a comparison card in the site report:

```js
const tiers = RateEngine.pondTierQuotes({ km: 35, overnight: false });
// → [{ id: 'small', label, cubicMetres: 150, description, estimate: {...} },
//    { id: 'medium', ... }, { id: 'large', ... }]
```

Each tier's `description` is written for a non-technical reader —
use it directly in the report UI rather than the raw cubic-metre
number. If the AI site-report step wants to recommend only one tier
based on the property's acreage or irrigation need, it can filter
this array down to a single entry before it reaches the quote step.

---

## 3. Quote → deposit → Calendly booking → PayPal payment

### Step A — Build the quote
Once the site-report step has decided which services to recommend
(including the swale meters/recommend check and a chosen pond tier,
if any), pass the final list to `buildQuote`:

```js
const quote = RateEngine.buildQuote([
  { serviceId: 'swale', size: 320, opts: { km: 28 } },
  { serviceId: 'pond', size: 600, opts: { km: 28 } },      // e.g. the "medium" tier
  { serviceId: 'foodforest', size: 6, opts: { km: 28, overnight: true } },
], {
  depositPct: 0.15,
  clientName: 'Jane Doe',
  propertyLabel: '4.2 ha parcel, NE of Stony Plain'
});
```

`quote` includes `subtotal`, `rangeLow`/`rangeHigh`, `depositAmount`,
and `balanceDueOnCompletion` — everything needed to render a client-facing
quote page and to size the deposit charge in Step B.

### Step B — Take the deposit via PayPal
Use PayPal's **Orders API v2** (or PayPal Checkout / Smart Buttons on
the frontend, which wraps the same API) to charge `quote.depositAmount`:

1. On quote acceptance, your backend creates a PayPal order:
   `POST /v2/checkout/orders` with `amount.value = quote.depositAmount`,
   `amount.currency_code = quote.currency`, and `quote.quoteId` stored
   in `purchase_units[0].custom_id` so the payment can be reconciled
   back to the quote later.
2. Render PayPal's Smart Button on the quote page using the returned
   order ID; PayPal handles the actual card/PayPal-balance UI.
3. On approval, call `POST /v2/checkout/orders/{id}/capture` server-side
   to finalize the charge. **Always capture server-side** — never trust
   a client-side "success" callback alone, since it can be spoofed.
4. Store the capture result (transaction ID, amount, status) against
   `quote.quoteId` in your own database before moving to Step C.

### Step C — Unlock the Calendly booking
Only after the capture in Step B succeeds, reveal the Calendly
scheduling step:

- **Simplest approach**: embed a standard Calendly inline widget or
  redirect to a Calendly scheduling link, passing the quote/client
  info as prefill query params so the booking is pre-tagged:
  `https://calendly.com/expandingedge/site-visit?name=Jane+Doe&email=jane@example.com&a1=<quoteId>`
  (Calendly supports custom question/answer prefill via `a1`, `a2`, etc.,
  or UTM-style params depending on how the event type's questions are set up.)
- **More robust approach**: use the **Calendly API v2** to create the
  scheduling link server-side (`POST /scheduling_links`) right after
  the PayPal capture succeeds, so a booking link is never shown to
  someone who hasn't paid the deposit — rather than just hiding the
  widget client-side, which a determined user could bypass by
  guessing the URL.
- Set up a **Calendly webhook** (`invitee.created`) so your backend
  gets notified when the site visit is actually booked, and can mark
  `quote.quoteId` as "visit scheduled" in your own system.

### Step D — Confirmation
Once both the PayPal capture and the Calendly `invitee.created`
webhook have fired for the same `quoteId`, send the client a single
confirmation (email or in-app) summarizing: quote total, deposit
paid, balance due on completion, and the booked visit time. This is
also the natural point to notify whoever runs field ops that a paid
site visit is on the calendar.

---

## 4. Value-prop copy (confidence-rated marketing claims)

Every `estimate()` result now includes a `valueProps` array pulled
from an internal `CLAIMS` reference — the same confidence tiers
(high/moderate/low) used to keep sales and site-report language
defensible:

```js
{
  confidence: 'moderate',
  headline: 'Substantially reduces runoff and increases infiltration during normal rainfall events.',
  caveat: 'Effectiveness drops sharply in extreme storms... never quote a single pinned percentage without a site-specific study.'
}
```

**Render `headline` directly in the site report or quote** — it's
already worded to match the confidence tier (no unsupported
percentages baked in). If a `caveat` is present, surface it too,
even in a compact report; it's there because the underlying evidence
doesn't support a stronger claim, not because it's optional detail.

The full `CLAIMS` table also includes entries for services not
currently active (`well`, `solarBattery`, `cameras`, `fencing`,
`combinedSecurity`, `keylineSubsoiling`, `hugelkultur`, `checkDams`)
so they're ready to attach via a service's `claimRefs` array if
those offerings come back — no new claims research needed, just add
the `claimRefs: ['cameras']`-style key to the service definition.

**Never bypass this system to write ad hoc marketing copy** for a
site report or quote — if a new claim is needed, add it to `CLAIMS`
with an honest confidence rating first, following the same
high/moderate/low framework, rather than writing a one-off line
directly into report-generation code.

---

## 6. Fecundity assessment (`fecundity_assessment.js`)

A separate, decoupled module that scores a property 0-100 across
seven productivity levers — water, soil structure, soil biology,
nutrient cycling, vegetative layering, fauna integration, and
microclimate — from whatever site data was actually collected
(soil tests, topography, wildlife pull, field observations).

```js
const result = FecundityAssessment.assessFecundity(siteData);
// → { categoryScores, overallScore, weakestCategories, suggestedServices, dataCompleteness }
```

Every indicator is optional — a missing measurement just drops out
of its category average rather than penalizing the score, so an
incomplete site visit never looks artificially unproductive.
`weakestCategories` (bottom 3 with real data) drives
`suggestedServices`, a deduplicated list of `SERVICES` keys from
`rate_engine.js` worth recommending. This module only suggests
*which* services address the weakest levers — it doesn't size or
price anything; hand `suggestedServices` off to the same
recommend/size/quote chain already described above (e.g. still run
`recommendSwaleMeters()` to decide swale sizing and the recommend
gate, even if `assessFecundity` also flagged water as weak).

`dataCompleteness` (% of indicators that had data) is worth
surfacing in the report itself — a score built on 30% data
completeness should read very differently to a client than one
built on 90%.

---

## 7. Fecundity report generator (`fecundity_report.js`)

Sits on top of `fecundity_assessment.js`. Where that module scores
whatever data you hand it, this one first **infers reasonable
estimates for missing indicators** from the broader data sources
already in this pipeline — topography, regional soil survey, canopy
cover imagery, land-cover class, and the wildlife-data pull — then
produces a client-facing narrative report.

```js
const rawData = {
  measured: { percolationMinPerInch: 22, compactionKpa: 2600 }, // direct site test results
  topoData: { avgSlopePercent: 9 },                              // from the LiDAR/photogrammetry step
  regionalSoilTexture: 'clay-loam',                              // from a soil-survey lookup for the area
  ndviCoverPct: 55,                                              // from multispectral imagery
  landCoverClass: 'grassland',                                   // from a land-cover layer
  wildlifeObservations: ['white-tailed deer', 'red fox'],        // from the wildlife-data step
  windExposureHint: 'open'                                       // from tree-cover density
};
const report = FecundityReport.generateFecundityReport(rawData, { propertyLabel: '...' });
const markdown = FecundityReport.renderReportMarkdown(report);   // client-ready text
```

**Every value carries a provenance tag** — `measured`, or
`inferred (<confidence level> — <basis>)` — and the rendered report
surfaces this under each lever as a "Basis" line, so a client (or a
skeptical competitor) can see exactly what's a real test result
versus a regional estimate. This mirrors the same discipline as the
`CLAIMS` system in section 4 — don't let a report imply more
certainty than the underlying data supports.

A lever with genuinely zero data (measured or inferable) is reported
as "insufficient data" rather than silently scored — the module
never fabricates a number to fill a gap.

**Where the inference inputs currently come from in this pipeline**,
and what would need to be wired up to make each one live rather than
manually passed in:
- `topoData` → already produced by the LiDAR/photogrammetry survey step
- `ndviCoverPct` → the multispectral drone payload discussed earlier
- `regionalSoilTexture` → would need an Alberta soil-survey (e.g. AGRASID) lookup by location — not yet built
- `landCoverClass` → would need an ABMI or similar land-cover layer lookup by location — not yet built
- `wildlifeObservations` → the wildlife-data pull step (ABMI/iNaturalist/GBIF) discussed earlier

---

## 8. Sequence summary

```
AI site report
   → recommendSwaleMeters(topoData)  [engine decides swale in/out]
   → pondTierQuotes(opts)            [if pond is relevant]
   → buildQuote(recommendations)     [final consolidated quote]
   → client accepts quote
   → PayPal Orders API: create + capture deposit  (server-side)
   → on capture success: reveal/create Calendly booking link
   → Calendly webhook confirms booking
   → send confirmation to client + field ops
```

Each arrow is a gate — a step later in the chain should not be
reachable without the one before it succeeding server-side. That
keeps someone from booking a site visit without paying the deposit,
or claiming a payment succeeded without PayPal actually confirming it.
