# Coding Agent Instructions: Integrate Satellite Vegetation Indices + Regional SOC Context into Fecundity Pipeline

Copied from `INtegrate_sat_markdown.txt` for durable project reference.

## Goal

Extend the existing Expanding Edge fecundity assessment (`fecundity_report.js` / related modules) to:

1. Pull free, property-scale vegetation indices from Sentinel-2 (and optionally Landsat / Sentinel-1).
2. Treat global/regional Soil Organic Carbon (SOC) layers as low-to-moderate confidence context only.
3. Populate real values for fields that are currently placeholders (e.g. `ndviCoverPct`, vegetative structure inferences).
4. Enforce the CLAIMS confidence framework: never present satellite-derived SOC as a client-facing precise number; always flag lab or calibrated drone data as higher confidence.
5. Keep the two-tier philosophy: satellite = screening / regional context; site walk + lab / drone = property-scale claims.

## Implementation status (site-design)

| Piece | Location |
|-------|----------|
| Fetch + indices | `site-design/lib/satellite-indices.js` |
| CLAIMS helpers | `site-design/lib/satellite-confidence.js` |
| Fecundity merge | `site-design/lib/fecundity-report.js` + `fecundity-assessment.js` |
| Pipeline step | `site-design/lib/pipeline.js` |
| UI | `site-design/public/app.js` (`fecunditySection`) |
| CLI | `npm run satellite` / `scripts/satellite-indices.mjs` |
| Docs | `site-design/data/satellite/README.md` |

See original full acceptance criteria and principles in `INtegrate_sat_markdown.txt`.
