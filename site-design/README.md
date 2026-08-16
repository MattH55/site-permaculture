# Alberta Site Design — Map → Report

**Land Intelligence** · [LandIntelligence.ca](https://www.LandIntelligence.ca/)

Draw your parcel on a topographic map. The server queries live Alberta / national
geospatial sources, derives slope and aspect, runs the if→then placement ruleset,
and returns a schema-shaped site design report.

## Local development

```bash
cd site-design
npm install

# Optional — Google Maps terrain (without it, OSM fallback map is used)
# PowerShell:  $env:GOOGLE_MAPS_API_KEY = "your_key"
# Or copy .env.example → .env

npm start          # http://localhost:3040
npm test
```

## Recommendation engine (value-first)

Placement and plants share one outcome taxonomy (water harvest, wind protection,
food, soil building, N-fix, etc.). If→then rules still gate *eligibility*;
values reframe and rank the product for Land Intelligence.

| Surface | URL |
|---------|-----|
| Full map → report | `/` |
| Embed UI (iframe) | `/embed` |
| Drop-in widget | `/widget.js` |
| Taxonomy API | `GET /api/v1/taxonomy` |
| Slim recommendations | `POST /api/v1/recommendations` |
| Full geospatial report | `POST /api/report` |

### Embed on LandIntelligence.ca

**Iframe**

```html
<iframe
  src="https://site-permaculture.onrender.com/embed?preset=sturgeon&autorun=1"
  title="Land Intelligence recommendations"
  style="width:100%;max-width:560px;height:720px;border:1px solid #d9cfc4;border-radius:10px"
></iframe>
```

**Script widget**

```html
<div id="ee-rec-widget"></div>
<script
  src="https://site-permaculture.onrender.com/widget.js"
  data-ee-widget
  data-target="#ee-rec-widget"
  data-preset="sturgeon"
  data-height="720"
  async></script>
```

Or mark any container:

```html
<div data-ee-recommendations data-preset="calgary" data-height="680"></div>
<script src="https://site-permaculture.onrender.com/widget.js" async></script>
```

**API** (CORS allowed for `LandIntelligence.ca`; add more via `EMBED_ORIGINS` or `EMBED_CORS_OPEN=1`)

```bash
curl -s -X POST https://site-permaculture.onrender.com/api/v1/recommendations \
  -H "Content-Type: application/json" \
  -d '{"preset_id":"sturgeon","footprint_ha":1,"include_plants":true}'
```

## Deploy on Render

Repo root is **Land Intelligence** (the folder that contains `site-design/`).

### Option A — Dashboard (simplest)

1. Push this repo to GitHub/GitLab/Bitbucket (if it isn’t already).
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**.
3. Connect the **Land Intelligence** repo.
4. Settings:
   - **Name:** `ee-site-design` (or whatever you like)
   - **Root Directory:** `site-design`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free (demo) or **Starter** (always-on; better for real users)
5. **Environment** → add:
   - `GOOGLE_MAPS_API_KEY` = your Maps JavaScript API key
   - `NODE_VERSION` = `20` (optional but recommended)
6. Deploy. When live, open `https://<service>.onrender.com` and hit `/healthz` → `ok`.

### Option B — Blueprint (`render.yaml`)

1. Render → **New** → **Blueprint**.
2. Select the Land Intelligence repo.
3. If asked for blueprint path, use `site-design/render.yaml`.
4. Fill in `GOOGLE_MAPS_API_KEY` when prompted (`sync: false`).
5. Apply.

> **Note:** `rootDir: site-design` is set in the blueprint so Render runs from this folder even when the yaml is discovered from the monorepo root. If Root Directory is already set to `site-design` in the UI, that’s fine too.

### After deploy

1. **Google Cloud Console** → your Maps API key → **Application restrictions** → HTTP referrers:
   - `https://ee-site-design.onrender.com/*` (use your real service hostname)
   - `http://localhost:3040/*` (local dev)
   - later: `https://design.LandIntelligence.ca/*`
2. Enable **Maps JavaScript API** on the project (billing must be enabled).
3. Optional custom domain: Render → service → **Settings** → **Custom Domains** →  
   `design.LandIntelligence.ca` → CNAME to the host Render shows you.

### Free tier constraints (reminder)

| Constraint | Effect |
|---|---|
| Spins down after 15 min idle | First visit after idle ~1 min cold start |
| 750 free instance hours / month | Spun-down time doesn’t count |
| Ephemeral disk | In-memory report cache is lost on restart |
| Health check | `/healthz` must respond in ~5s (we do) |

Upgrade the service to **Starter** to remove spin-down for production.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | Recommended | Terrain map + parcel drawing |
| `PORT` | Set by Render | HTTP port (do not hardcode) |
| `NODE_VERSION` | Optional | `20` |
| `NODE_ENV` | Optional | `production` |

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Render health check |
| `GET` | `/api/config` | Public Maps key + defaults |
| `POST` | `/api/report` | Polygon → live layers → design report |
| `POST` | `/api/design` | Manual attributes (no map) |
| `GET` | `/api/presets` | Alberta climate presets |

## Pipeline

```
polygon → bbox
  ├─ Elevation (Open-Meteo → OpenTopoData fallback) → slope / aspect
  ├─ NRCan HRDEM STAC coverage
  ├─ Alberta ArcGIS (AMWI, watersheds, soils atlas, wet areas)
  └─ Climate (Open-Meteo + EE presets)
        ↓
  site-design schema + if→then rules
```

## Files

| Path | Role |
|---|---|
| `public/` | Map-first UI |
| `lib/pipeline.js` | Box → layers → schema → rules |
| `lib/sources.js` | Live DEM + ArcGIS + climate |
| `lib/terrain.js` | Slope / aspect from elevation grid |
| `lib/rules.js` | Placement ruleset |
| `render.yaml` | Render Blueprint |
| `schema/` | JSON Schema + rules docs |

## Branding

Land Intelligence: parkland soil palette, saskatoon-berry accent, Earth · People · Future.
Contact: contact via the inquiry form · info@LandIntelligence.ca
