# Alberta Site Design — Map → Report

**Expanding Edge Permaculture** · [expandingedge.ca](https://www.expandingedge.ca/)

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

## Deploy on Render

Repo root is **Expanding Edge** (the folder that contains `site-design/`).

### Option A — Dashboard (simplest)

1. Push this repo to GitHub/GitLab/Bitbucket (if it isn’t already).
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**.
3. Connect the **Expanding Edge** repo.
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
2. Select the Expanding Edge repo.
3. If asked for blueprint path, use `site-design/render.yaml`.
4. Fill in `GOOGLE_MAPS_API_KEY` when prompted (`sync: false`).
5. Apply.

> **Note:** `rootDir: site-design` is set in the blueprint so Render runs from this folder even when the yaml is discovered from the monorepo root. If Root Directory is already set to `site-design` in the UI, that’s fine too.

### After deploy

1. **Google Cloud Console** → your Maps API key → **Application restrictions** → HTTP referrers:
   - `https://ee-site-design.onrender.com/*` (use your real service hostname)
   - `http://localhost:3040/*` (local dev)
   - later: `https://design.expandingedge.ca/*`
2. Enable **Maps JavaScript API** on the project (billing must be enabled).
3. Optional custom domain: Render → service → **Settings** → **Custom Domains** →  
   `design.expandingedge.ca` → CNAME to the host Render shows you.

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

Expanding Edge: parkland soil palette, saskatoon-berry accent, Earth · People · Future.  
Contact: (780) 236-3630 · info@expandingedge.ca
