# The Resilience Quiz for Edmonton

Lead-generation quiz for Expanding Edge Permaculture. One Node service does everything:
serves the quiz, rescores submissions server-side, stores the lead, emails the report.

## Files

| File | What it is |
|---|---|
| `questions.js` | **The only file you edit to change the quiz.** Questions, weights, archetypes, remedy copy, scoring. Imported by both the browser and the server, so the two can't drift apart. |
| `app.js` | Quiz UI — one question per screen, saves progress to localStorage |
| `styles.css` | Design system |
| `index.html` | Single-page shell — loads the quiz and the core sample sidebar |
| `server.js` | Express: static hosting, `/api/submit`, `/api/leads.csv` |
| `render.yaml` | Render blueprint — web service plus Postgres |

## Deploy to Render

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo. It reads `render.yaml` and
   creates the web service and a Postgres instance.
3. Fill in the environment variables it asks for:
   - `RESEND_API_KEY` — from resend.com, free up to 3,000 emails a month
   - `MAIL_BCC` — your own address, so you see every lead as it lands
   - `ADMIN_KEY` is generated for you; copy it out of the dashboard
4. Deploy. First boot creates the `leads` table on its own.

Without `DATABASE_URL` it falls back to a local `leads.jsonl` file. Fine for testing,
but Render's disk is ephemeral — don't run production that way or you'll lose leads on
every redeploy.

Without `RESEND_API_KEY` it still records leads and logs the skipped send, which is
useful while you're testing the flow.

## Email deliverability

Verify `expandingedge.ca` in Resend and add the DKIM and SPF records to your DNS before
going live. Sending from an unverified domain lands you in spam, which quietly destroys
the entire funnel — you'd see submissions and no replies, with no obvious cause.

## Local development

```bash
npm install
npm start          # http://localhost:3000
```

## Getting your leads

```
https://your-app.onrender.com/api/leads.csv?key=YOUR_ADMIN_KEY
```

The `hot` column flags anyone who answered "just bought it, or about to". Those get a
personal email within 48 hours, not the drip sequence.

## Putting it on the Squarespace site

Best: point a subdomain — `quiz.expandingedge.ca` — at the Render service with a CNAME.
Full-page experience, clean URL, and it keeps its own title and meta description, which
is what makes "resilience quiz Edmonton" rank.

Acceptable: embed it in a Squarespace code block with an iframe. It works, but you lose
the SEO, and iframes on mobile are awkward about scroll position.

## Changing the quiz

Everything lives in `questions.js`. To add a question, add an object with a `dim`
and four options in ascending order of capability — the option's position is its point
value. Weights are at the top of the file, archetype bands and the remedy copy near the
bottom. Nothing else needs touching.

To clone it for another city, copy the repo and change three things: the `region`
options in `questions.js`, the climate figures in the `help` text, and the chinook line
in the heat dimension.
