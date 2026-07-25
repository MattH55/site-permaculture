# Land value data (phase 1)

Informational panel only — **does not** feed placement or planting scoring.

## Sources

| Layer | File / API | Notes |
|-------|------------|--------|
| Calgary assessments | Socrata `data.calgary.ca` / `4bsw-nn7w` | Live query; `land_size_ac` + multipolygon. Farmland (`FL`) can separate land value; residential is total assessed. |
| Edmonton assessments | `dkk9-cj3x` (property/lot) + `q7d6-ambg` (assessed value) | Live join by account number. No land/improvement split for most parcels. |
| Rural CLI aggregates | `cli-municipality-2015.json` | From Alberta Agriculture Table 20 (open.alberta.ca). Transfer averages by municipality × CLI class. |
| FCC trend | `fcc-alberta-trends.json` | Provincial cultivated farmland annual % change; adjusts base year → current without overwriting raw. |
| Place → county | `place-to-municipality.json` | Maps settlements to CLI municipality rows. |

## Phase decision

**Phase 1:** CLI-aggregate-only for rural + live Calgary/Edmonton assessments.

**Phase 2 (current):**
- File-based spatial tile cache under `data/spatial-cache/` (PostGIS-free)
- Bulk ingest: `npm run ingest:land-value`
- Live NRCan hardiness, Alberta FHIP flood, municipal zoning portal links
- County parcel assessment rolls still deferred (fragmented / often not bulk-open)

## Not available free/bulk

Individual Alberta Land Titles sale transactions (eservices.alberta.ca) — pay-per-lookup only.
