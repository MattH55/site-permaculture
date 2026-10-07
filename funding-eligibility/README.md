# Government Funding Eligibility Tool

Standalone lead tool for **landowners / homeowners / farmers / ranchers** (not Expanding Edge as a contractor).  
Sits alongside:

| Tool | Location / URL |
|------|----------------|
| Resilience Quiz | `../` (Permaculture root app) → https://resilience-quiz-edmonton.vercel.app |
| Land Intelligence | External → https://landintelligence.online |
| **This tool** | `../funding-eligibility/` → deploy as its own Vercel project (TBD) |
| Expanding Edge marketing site | `../Expanding Edge/Expanding Edge Website/expandingedge-live/` → links from `/tools` |

## Where to put files

```
funding-eligibility/                 ← YOU ARE HERE — put the whole app in this folder
├── README.md                        ← this file
├── package.json                     ← Node app manifest (when you add the app)
├── vercel.json                      ← optional Vercel config
├── .env.example                     ← env var names only (never commit secrets)
├── .gitignore
├── public/                          ← static UI (HTML/CSS/JS) if static-first
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/                             ← app logic if you use a framework (optional)
│   ├── questions.js                 ← eligibility questions / decision tree
│   ├── programs.js                  ← program catalog rules
│   └── scoring.js                   ← match logic
├── data/                            ← structured program data (preferred over hardcoding)
│   ├── programs.json                ← CEIP, EcoGifts, ecosystem services, etc.
│   ├── municipalities.json          ← CEIP / municipal solar notes (optional)
│   └── sources.md                   ← official URLs + last-checked dates
├── api/                             ← serverless (optional lead capture / email)
│   └── submit.js
└── docs/                            ← research notes, legal disclaimer drafts
    └── disclaimer.md
```

### What goes where (quick rules)

| You have… | Put it in… |
|-----------|------------|
| Quiz UI / screens | `public/` (or `src/` if React/etc.) |
| Program list & eligibility rules | `data/programs.json` + `src/programs.js` |
| Official government links / research | `data/sources.md` and `docs/` |
| PDF grant guides (reference only) | `docs/reference/` (do not publish raw legal PDFs as “official advice”) |
| Secrets (API keys) | Vercel env / local `.env` — **not** git |
| Marketing link from EE site | Update `expandingedge-live` Tools page + nav via `restore-live-site.py` — **do not** put this app inside `expandingedge-live/` |

## Absolute path on this machine

```
C:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\funding-eligibility\
```

## Deploy model (recommended)

1. Build the app entirely inside **`funding-eligibility/`**.
2. Deploy as a **separate Vercel project** (same pattern as resilience-quiz).
3. Point EE site Tools dropdown + `/tools` to the production URL when ready.
4. Keep program text customer-facing with a strong **not tax/legal advice** disclaimer.

## Do not put this tool in

- `expandingedge-live/` — marketing site export only  
- `Expanding Edge Website/public/` — old static rebuild (not the live Squarespace deploy path)  
- Permaculture root `public/` — that belongs to the Resilience Quiz app  
- `site-design/` — separate product (map/design tool)

## Suggested first files to drop in

1. Any prototype HTML/JS for the eligibility flow → `public/`  
2. Spreadsheet or notes of programs → convert to `data/programs.json`  
3. Disclaimers / lawyer-reviewed language → `docs/disclaimer.md`  

When the app has a live URL, say the word and we can wire it into Tools nav + the SEO tools page (alongside Resilience Quiz “Coming Soon” and Land Intelligence).
