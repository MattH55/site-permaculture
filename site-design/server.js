import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSiteRecord } from './lib/rules.js';
import { ALBERTA_PRESETS } from './lib/alberta-presets.js';
import { generateSiteReport } from './lib/pipeline.js';
import {
  buildEmbedRecommendations,
  getTaxonomyPayload,
} from './lib/embed-api.js';
import { planPlantings, getPlantGoalsPayload } from './lib/planting.js';
import {
  plantingPlanInterventionValue,
  plantingReportTable,
  enrichDesignElementsWithPlants,
} from './lib/plant-interventions.js';
import { groupRecommendationsByValue } from './lib/recommendation-values.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from app root (GOOGLE_MAPS_API_KEY, PORT, …) without a dependency
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
} catch {
  /* ignore */
}

const app = express();

/** Origins allowed to call the embed recommendation API (phase 3). */
const EMBED_ORIGINS = new Set(
  [
    'https://www.expandingedge.ca',
    'https://expandingedge.ca',
    'http://localhost:3040',
    'http://127.0.0.1:3040',
    process.env.PUBLIC_BASE_URL,
    process.env.EMBED_ORIGIN,
    ...(process.env.EMBED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ].filter(Boolean)
);

function corsForEmbed(req, res, next) {
  const origin = req.headers.origin;
  if (origin && (EMBED_ORIGINS.has(origin) || process.env.EMBED_CORS_OPEN === '1')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
}

app.use(express.json({ limit: '512kb' }));
app.use(corsForEmbed);
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/schema', express.static(path.join(__dirname, 'schema'), { maxAge: '1d' }));

// Config for the browser (Maps key is public-restricted by HTTP referrer)
app.get('/api/config', (_req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    defaultCenter: { lat: 53.55, lng: -113.5 },
    defaultZoom: 10,
    region: 'Alberta',
    brand: {
      name: 'Land Intelligence',
      url: 'https://www.expandingedge.ca/',
      tagline: 'Earth · People · Future',
    },
  });
});

app.get('/api/presets', (_req, res) => {
  res.json({ region: 'Alberta', presets: ALBERTA_PRESETS });
});

/** Manual form path (still available) */
app.post('/api/design', (req, res) => {
  try {
    res.json(buildSiteRecord(req.body || {}));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'design failed' });
  }
});

/**
 * Map path: draw polygon → live geospatial layers → rules → report
 * Body: { polygon: { paths: [[lng,lat],...] } | GeoJSON, site_name?: string, force?: boolean }
 */
app.post('/api/report', async (req, res) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    if (!body.polygon) {
      return res.status(400).json({ error: 'polygon required — draw your parcel on the map' });
    }
    const report = await generateSiteReport({
      polygon: body.polygon,
      site_name: body.site_name,
      force: !!body.force,
      plant_goals: body.plant_goals || body.goals,
    });
    report._meta = {
      ...report._meta,
      duration_ms: Date.now() - started,
    };
    res.json(report);
  } catch (e) {
    console.error('report failed', e);
    res.status(400).json({ error: e.message || 'report failed' });
  }
});

/**
 * Re-run Plant Recommendation + Economics Engine with new goals/scenario.
 * Body: {
 *   site?: object,           // climate/soil/hydrology/terrain/vegetation/footprint
 *   goals?: string[],        // max_food | max_nitrogen | lowest_cost | …
 *   scenario?: string,       // market_garden | home_use | fodder
 *   fecundity?, hardiness?, soil_survey?, satellite?, wetlands?, wind_rose?, tree_cover?,
 *   profile?: object,        // optional prior site_condition_profile
 *   limit?: number
 * }
 */
app.post('/api/planting', (req, res) => {
  try {
    const body = req.body || {};
    const site = body.site || body.site_input || {};
    if (!site.climate && !site.footprint_ha && !body.profile) {
      return res.status(400).json({
        error: 'site (climate/soil/hydrology/footprint) or profile required',
      });
    }
    const plan = planPlantings(site, {
      limit: body.limit ?? 18,
      goals: body.goals || body.plant_goals,
      scenario: body.scenario || 'market_garden',
      fecundity: body.fecundity,
      hardiness: body.hardiness,
      soil_survey: body.soil_survey,
      satellite: body.satellite,
      wetlands: body.wetlands,
      wind_rose: body.wind_rose,
      tree_cover: body.tree_cover,
      profile: body.profile,
      windExposureHint: body.windExposureHint,
      frostPoolingHint: body.frostPoolingHint,
      horizon_years: body.horizon_years || 10,
    });

    // Live economics + lever intervention overlay for the selected goals
    const baselineScores = Object.fromEntries(
      (body.fecundity?.categories || []).map((c) => [c.category, c.score])
    );
    const plantingIntervention = plantingPlanInterventionValue(plan, baselineScores, {
      scenario: 'mid',
      timeHorizonYears: body.horizon_years || 10,
      footprintHa: site.footprint_ha,
    });
    const recommended_plantings = plantingReportTable(plan, plantingIntervention);

    let design_elements = body.design_elements || null;
    let recommendations = null;
    if (Array.isArray(design_elements) && design_elements.length) {
      design_elements = enrichDesignElementsWithPlants(
        design_elements,
        plan,
        plan.site_condition_profile
      );
      recommendations = groupRecommendationsByValue(design_elements);
    }

    res.json({
      planting_plan: plan,
      planting_intervention_value: plantingIntervention,
      recommended_plantings,
      design_elements,
      recommendations,
      available_goals: getPlantGoalsPayload(),
    });
  } catch (e) {
    console.error('planting replan failed', e);
    res.status(400).json({ error: e.message || 'planting failed' });
  }
});

app.get('/api/planting/goals', (_req, res) => {
  try {
    res.json(getPlantGoalsPayload());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Capture email for full-report download unlock (lead).
 * Body: { email, name?, site_name?, source? }
 */
app.post('/api/lead', async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const lead = {
      type: 'report_download',
      email,
      name: body.name ? String(body.name).slice(0, 120) : null,
      site_name: body.site_name ? String(body.site_name).slice(0, 200) : null,
      source: body.source || 'site-design',
      at: new Date().toISOString(),
    };
    appendLead(lead);

    // Unlock immediately — don't make the user wait on Resend
    res.json({ ok: true, unlocked: true, email, emailed: 'pending' });

    // Notify team in the background (best-effort)
    const to = inquiryDeliveryAddress();
    const publicTo = inquiryPublicAddress();
    const subject = `Full report download — ${lead.site_name || 'Alberta parcel'}`;
    const text = [
      'Someone unlocked the full site-design report.',
      publicTo && publicTo !== to ? `Public contact (forward if needed): ${publicTo}` : null,
      '',
      `Email: ${email}`,
      lead.name ? `Name: ${lead.name}` : null,
      `Site: ${lead.site_name || '—'}`,
      `Source: ${lead.source}`,
      `At: ${lead.at}`,
    ]
      .filter(Boolean)
      .join('\n');
    sendViaResend({ to, replyTo: email, subject, text }).catch((e) => {
      console.warn('lead notify email failed', e.message);
    });
  } catch (e) {
    console.error('lead failed', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || 'lead failed' });
    }
  }
});

/**
 * Inquiry: selected interventions + report summary → info@expandingedge.ca
 * Body: {
 *   email, name?, phone?, message?,
 *   selected_items: [{ id, label, price_cad? }],
 *   estimate_subtotal_cad?,
 *   site_name?, location?, area_ha?,
 *   report_summary?: object|string
 * }
 */
app.post('/api/inquiry', async (req, res) => {
  try {
    const body = req.body || {};
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required so we can reply' });
    }
    const selected = Array.isArray(body.selected_items) ? body.selected_items : [];
    if (!selected.length) {
      return res.status(400).json({ error: 'Select at least one intervention before inquiring' });
    }

    const to = inquiryDeliveryAddress();
    const publicTo = inquiryPublicAddress();
    const siteName = body.site_name || 'Alberta parcel';
    const subject = `Site design inquiry — ${siteName}`;
    const lines = [
      `New inquiry from site-design tool`,
      publicTo && publicTo.toLowerCase() !== String(to).toLowerCase()
        ? `Forward / EE public inbox: ${publicTo}`
        : null,
      ``,
      `From: ${body.name || '—'} <${email}>`,
      body.phone ? `Phone: ${body.phone}` : null,
      `Site: ${siteName}`,
      body.location ? `Location: ${body.location}` : null,
      body.area_ha != null ? `Area: ${body.area_ha} ha` : null,
      body.estimate_subtotal_cad != null
        ? `Planning estimate (selected): $${Number(body.estimate_subtotal_cad).toLocaleString('en-CA')} CAD`
        : null,
      ``,
      `Selected interventions:`,
      ...selected.map((it, i) => {
        const price =
          it.price_cad != null ? ` — ~$${Number(it.price_cad).toLocaleString('en-CA')} CAD` : '';
        return `  ${i + 1}. ${it.label || it.id}${price}`;
      }),
      ``,
      body.message ? `Message:\n${String(body.message).slice(0, 2000)}` : null,
      ``,
      `Report snapshot:`,
      typeof body.report_summary === 'string'
        ? body.report_summary.slice(0, 4000)
        : JSON.stringify(body.report_summary || {}, null, 2).slice(0, 4000),
    ].filter((x) => x != null);

    const text = lines.join('\n');
    const lead = {
      type: 'inquiry',
      email,
      name: body.name || null,
      phone: body.phone || null,
      to,
      subject,
      selected,
      estimate_subtotal_cad: body.estimate_subtotal_cad ?? null,
      site_name: siteName,
      at: new Date().toISOString(),
    };
    appendLead(lead);

    let sent = false;
    let sendError = null;
    try {
      sent = await sendViaResend({ to, replyTo: email, subject, text });
    } catch (e) {
      sendError = e.message || String(e);
      console.error('inquiry email failed', sendError);
    }

    // Fallback mailto only if Resend did not send
    const mailto =
      `mailto:${encodeURIComponent(to)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(text.slice(0, 1800))}`;

    res.json({
      ok: true,
      to,
      mailto: sent ? null : mailto,
      emailed: !!sent,
      message: sent
        ? 'Inquiry sent to Expanding Edge. We will reply at your email.'
        : sendError
          ? `Could not email automatically (${sendError}). A draft will open so you can still send.`
          : 'Inquiry saved. Open the email draft to send to Expanding Edge, or we will follow up from your details.',
    });
  } catch (e) {
    console.error('inquiry failed', e);
    res.status(500).json({ error: e.message || 'inquiry failed' });
  }
});

function appendLead(lead) {
  try {
    const dir = path.join(__dirname, 'data', 'leads');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(
      path.join(dir, `leads-${day}.jsonl`),
      JSON.stringify(lead) + '\n',
      'utf8'
    );
  } catch (e) {
    console.warn('lead log write failed', e.message);
  }
}

/** Where Resend delivers (Gmail / forwarding inbox until domain is verified). */
function inquiryDeliveryAddress() {
  return (
    process.env.INQUIRY_TO ||
    process.env.RESEND_FALLBACK_TO ||
    'matt.halma@gmail.com'
  );
}

/** Public EE address shown in the body for human forwarding (optional). */
function inquiryPublicAddress() {
  return process.env.INQUIRY_PUBLIC_TO || 'info@expandingedge.ca';
}

/**
 * Send email via Resend (https://resend.com).
 * Requires RESEND_API_KEY. Prefer a verified domain From address:
 *   INQUIRY_FROM="Expanding Edge <noreply@expandingedge.ca>"
 *
 * Until a domain is verified, Resend only allows `onboarding@resend.dev`
 * and only delivers to the account owner email. We fall back to
 * RESEND_FALLBACK_TO (or the owner inbox) so inquiries still go out live.
 */
async function sendViaResend({ to, replyTo, subject, text, html }) {
  // Optional webhook first (Zapier / Make / Formspree)
  const webhook = process.env.INQUIRY_WEBHOOK_URL;
  if (webhook) {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, replyTo, subject, text, source: 'site-design' }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`webhook ${r.status}: ${body.slice(0, 200)}`);
    }
    return true;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('RESEND_API_KEY not set — inquiry emails will not send automatically');
    return false;
  }

  const from =
    process.env.INQUIRY_FROM ||
    'Expanding Edge Site Design <onboarding@resend.dev>';
  const intended = (Array.isArray(to) ? to : [to]).filter(Boolean);
  const fallback =
    process.env.RESEND_FALLBACK_TO ||
    process.env.RESEND_OWNER_EMAIL ||
    null;

  const result = await resendSendOnce({
    resendKey,
    from,
    to: intended,
    replyTo,
    subject,
    text,
    html,
  });
  if (result.ok) {
    console.log('Resend email sent', {
      id: result.id,
      to: intended,
      subject: subject.slice(0, 80),
    });
    return true;
  }

  // Domain not verified yet — Resend only allows account-owner recipient
  const needsFallback =
    /only send testing emails|verify a domain|not authorized/i.test(result.error || '');
  if (needsFallback && fallback && !intended.map((e) => e.toLowerCase()).includes(fallback.toLowerCase())) {
    const note =
      `\n\n---\nIntended recipient: ${intended.join(', ')}\n` +
      `(Resend domain not verified yet — delivered to fallback inbox ${fallback}. ` +
      `Verify expandingedge.ca at resend.com/domains and set INQUIRY_FROM to that domain.)\n`;
    const fb = await resendSendOnce({
      resendKey,
      from,
      to: [fallback],
      replyTo,
      subject: `[for ${intended.join(', ')}] ${subject}`,
      text: text + note,
      html,
    });
    if (fb.ok) {
      console.log('Resend email sent via fallback', {
        id: fb.id,
        to: fallback,
        intended,
      });
      return true;
    }
    throw new Error(fb.error || result.error || 'Resend send failed');
  }

  throw new Error(result.error || 'Resend send failed');
}

async function resendSendOnce({ resendKey, from, to, replyTo, subject, text, html }) {
  const payload = {
    from,
    to,
    subject,
    text,
  };
  if (replyTo) payload.reply_to = replyTo;
  if (html) payload.html = html;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.message || body?.error || JSON.stringify(body).slice(0, 200);
    return { ok: false, error: `Resend ${r.status}: ${msg}` };
  }
  return { ok: true, id: body.id };
}

app.get('/healthz', (_req, res) => res.send('ok'));

/**
 * Phase 3 — embed / partner API
 * Value taxonomy + EE services + Alberta presets (no site run).
 */
app.get('/api/v1/taxonomy', (_req, res) => {
  res.json(getTaxonomyPayload());
});

/**
 * Slim value-first recommendations from preset or site fields.
 * Body: { preset_id?, footprint_ha?, terrain?, climate?, soil?, include_plants?, plant_limit? }
 * Full map+layers report remains POST /api/report.
 */
app.post('/api/v1/recommendations', (req, res) => {
  try {
    const out = buildEmbedRecommendations(req.body || {});
    res.json(out);
  } catch (e) {
    console.error('embed recommendations failed', e);
    res.status(400).json({ error: e.message || 'recommendations failed' });
  }
});

/** Pretty path for iframe embed page */
app.get('/embed', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

const port = Number(process.env.PORT) || 3040;
// Bind 0.0.0.0 so Render (and other hosts) can reach the process
app.listen(port, '0.0.0.0', () => {
  console.log(`Expanding Edge site design (Alberta map→report) on :${port}`);
  console.log(`Embed: /embed · API: /api/v1/taxonomy · POST /api/v1/recommendations`);
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.log('Note: set GOOGLE_MAPS_API_KEY for Google Maps. Fallback map UI works without it.');
  }
});
