# Spatial tile cache (phase 2)

PostGIS-free neighbourhood index. Each tile is a JSON file of point features
for one ~0.02° cell under `data/spatial-cache/<layer>/`.

## Layers

| Layer | Content | Warm via |
|-------|---------|----------|
| `calgary_assessment` | Calgary Socrata parcel samples | `npm run ingest:land-value:calgary` |
| `edmonton_assessment` | Edmonton assessment + lot size | `npm run ingest:land-value:edmonton` |

## Behaviour

1. Land-value pipeline **prefers** tiles less than 14 days old.
2. If cache is cold / sparse, **live Socrata** runs and **warms** tiles from the response.
3. Tiles are local-only by default — do not commit large city dumps unless intentional.

## Re-pull cadence

- Calgary: weekly during assessment cycle
- Edmonton: after annual roll refresh (or weekly if using current-year feed)

Full city: `npm run ingest:land-value -- --max-tiles 200` (long-running; rate-limited).
