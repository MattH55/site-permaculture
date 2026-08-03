# Expanding Edge Permaculture — Marketing Site

SEO-optimized marketing website for [expandingedge.ca](https://www.expandingedge.ca)

## Overview

A responsive, performant marketing site showcasing Expanding Edge Permaculture's services:
- **Site Design Tool** — Interactive map-based property analysis
- **Permaculture Consulting** — Professional site design and implementation support
- **Regenerative Systems Design** — Water, infrastructure, and planting guidance

## Pages

| Page | Purpose |
|---|---|
| `/` | Home page with services overview, calls-to-action |
| `/about/` | About the company, mission, approach, credentials |
| `/contact/` | Contact form and direct contact information |
| `/design/` | Site design tool landing page and documentation |

## Tech Stack

- **Express.js** — Static hosting + contact form API
- **HTML5 + CSS3** — No build step, no JavaScript frameworks
- **Responsive Design** — Works on all devices
- **Semantic HTML** — Built for SEO

## Brand & Design

Uses the Expanding Edge brand palette:
- **Ink:** `#16211b` (dark green-brown)
- **Berry:** `#5b3a73` (saskatoon accent)
- **Gold:** `#a8801f`
- **Earth tones:** Natural soil-based palette
- **Fonts:** Bricolage Grotesque (headings), Source Serif 4 (body)

All colors and styling are defined in `public/styles.css` using CSS variables for easy customization.

## SEO Features

- Semantic HTML structure
- Structured data (JSON-LD)
- Meta descriptions and keywords
- Canonical URLs
- Open Graph tags
- Mobile-optimized
- Fast static delivery
- Accessibility-focused

## Local Development

```bash
npm install
npm start
# Visit http://localhost:3000
```

## Deployment

### Vercel
1. Push to GitHub
2. Connect repo to Vercel
3. Vercel auto-detects and deploys

### Render
1. Create new Web Service
2. Connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables if needed

### Environment Variables (Optional)

- `DATABASE_URL` — PostgreSQL connection for contact storage
- `ADMIN_KEY` — Secret key to access `/api/contacts.csv` export

Without these, contacts are saved to local `contacts.jsonl` file.

## Contact Form

The contact form at `/contact/` submits to `/api/submit` endpoint, which:
1. Validates email format
2. Rate-limits by IP (max 12 per hour)
3. Stores contact information
4. Returns success/error response

Contacts are stored either in:
- **PostgreSQL** (if `DATABASE_URL` is set)
- **Local JSONL file** (`contacts.jsonl`) for development

## Design Principles

- **Minimal JavaScript** — Progressive enhancement, works without JS
- **Performance First** — Static assets, fast delivery
- **Accessibility** — WCAG compliant, semantic markup
- **Mobile-First** — Responsive design works on all screens
- **Long-form Content** — SEO-optimized copy that educates and converts

## Content Strategy

Pages are written to:
- Rank for high-intent keywords (site design, permaculture, Alberta)
- Educate visitors about regenerative design
- Build trust and credibility
- Guide visitors toward contacting or using the design tool
- Support topical authority around permaculture consulting

## File Structure

```
public/
  ├── index.html          # Home page
  ├── about.html          # About page
  ├── contact.html        # Contact page + form
  ├── design.html         # Site design tool landing
  └── styles.css          # All styles (shared)

server.js               # Express app
package.json            # Dependencies
README.md               # This file
```

## Next Steps

1. Deploy to production domain (expandingedge.ca)
2. Set up email notifications for new contacts (Resend or similar)
3. Configure analytics (Google Analytics 4)
4. Submit sitemap to search engines
5. Monitor rankings for target keywords
6. Gather user feedback and iterate

## Support

Contact: (780) 236-3630 | info@expandingedge.ca
