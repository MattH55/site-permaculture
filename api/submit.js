// Vercel serverless function. Same logic as server.js, different wrapper.
// Vercel ignores server.js entirely — it serves /public statically and runs this.
//
// Storage note: serverless has no disk. If DATABASE_URL is set (Neon, Supabase,
// or any Postgres) the lead is written there. If it isn't, the lead still reaches
// you via MAIL_BCC — which for low volume is a perfectly reasonable CRM.

import { buildLead, sendReport } from '../lib/report.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'bad email' });

  // Require Resend so the UI never claims "sent" when nothing will arrive.
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing — cannot send report');
    return res.status(503).json({
      error: 'email_not_configured',
      message: 'Report email is temporarily unavailable. Email info@expandingedge.ca and we will send your score manually.'
    });
  }

  const { lead, s } = buildLead(req.body);

  try { await store(lead); } catch (e) { console.error('store failed', e.message); }

  try {
    await sendReport(lead, s);
  } catch (e) {
    console.error('email failed', e.message);
    return res.status(502).json({
      error: 'email_failed',
      message: "We couldn't send the report just now. Try again, or email info@expandingedge.ca."
    });
  }

  res.status(200).json({ ok: true });
}

async function store(lead) {
  if (!process.env.DATABASE_URL) return;               // BCC is the fallback
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  await sql`CREATE TABLE IF NOT EXISTS leads (
    id serial primary key, at timestamptz, email text, name text,
    region text, size text, tenure text, total int,
    archetype text, limiting_factor text, hot boolean)`;
  await sql`INSERT INTO leads (at,email,name,region,size,tenure,total,archetype,limiting_factor,hot)
    VALUES (${lead.at},${lead.email},${lead.name},${lead.region},${lead.size},
            ${lead.tenure},${lead.total},${lead.archetype},${lead.limiting},${lead.hot})`;
}
