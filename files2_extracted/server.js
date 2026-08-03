import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { score, QUESTIONS } from './public/questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Crude per-IP rate limit. Enough to stop a bored bot; not a security product.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 3600e3) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  return rec.n > 12;
}

const label = (qid, val) => {
  const q = QUESTIONS.find(x => x.id === qid);
  return q && q.options[val] ? q.options[val].label : '—';
};

app.post('/api/submit', async (req, res) => {
  const { email, name = '', answers = {}, profile = {} } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'bad email' });
  if (limited(req.ip)) return res.status(429).json({ error: 'slow down' });

  // Rescore on the server — never trust a number the browser sends you.
  const s = score(answers);

  const lead = {
    at: new Date().toISOString(),
    email, name,
    region: label('region', profile.region),
    size: label('size', profile.size),
    tenure: label('tenure', profile.tenure),
    total: s.total,
    archetype: s.archetype.name,
    limiting: s.limiting.name,
    hot: label('tenure', profile.tenure).startsWith('Just bought')
  };

  await store(lead);
  try { await sendReport(lead, s); } catch (e) { console.error('email failed', e.message); }

  res.json({ ok: true });
});

// --- storage: Postgres if DATABASE_URL is set, otherwise a local JSONL file ---
let pool = null;
async function store(lead) {
  if (process.env.DATABASE_URL) {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pool.query(`CREATE TABLE IF NOT EXISTS leads (
        id serial primary key, at timestamptz, email text, name text,
        region text, size text, tenure text, total int,
        archetype text, limiting_factor text, hot boolean)`);
    }
    await pool.query(
      `INSERT INTO leads (at,email,name,region,size,tenure,total,archetype,limiting_factor,hot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [lead.at, lead.email, lead.name, lead.region, lead.size, lead.tenure,
       lead.total, lead.archetype, lead.limiting, lead.hot]);
  } else {
    fs.appendFileSync(path.join(__dirname, 'leads.jsonl'), JSON.stringify(lead) + '\n');
  }
}

// --- email: Resend ---
async function sendReport(lead, s) {
  if (!process.env.RESEND_API_KEY) { console.log('no RESEND_API_KEY — skipping send', lead.email); return; }

  const gaps = s.gaps.map((g, i) => `
    <tr><td style="padding:14px 0;border-top:1px solid #d8dcd2;vertical-align:top">
      <div style="font:600 12px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:#5b3a73">Gap ${i + 1} · ${g.pct}/100</div>
      <div style="font:700 19px/1.3 Georgia,serif;margin:6px 0 4px">${g.name}</div>
      <div style="font:400 15px/1.55 Georgia,serif;color:#46584c">${g.fix}</div>
    </td></tr>`).join('');

  const html = `
  <div style="max-width:560px;margin:0 auto;padding:28px;background:#f7f8f3;color:#16211b;font-family:Georgia,serif">
    <div style="font:600 11px/1 monospace;letter-spacing:.16em;text-transform:uppercase;color:#5b3a73">Expanding Edge Permaculture</div>
    <h1 style="font:700 30px/1.1 Georgia,serif;margin:14px 0 4px">${lead.name || 'Your'} resilience report</h1>
    <p style="font-size:16px;line-height:1.55;color:#46584c">You scored <b style="color:#a8801f;font-size:22px">${s.total}</b> out of 100 — ${lead.archetype}.
    Your land could feed and water your household for roughly ${s.daysLow} to ${s.daysHigh} days with nothing coming in.</p>

    <div style="border-left:3px solid #5b3a73;padding:4px 0 4px 16px;margin:24px 0">
      <div style="font:700 18px/1.3 Georgia,serif">Your limiting factor: ${s.limiting.name}</div>
      <p style="font-size:15px;line-height:1.55;margin:6px 0 0">Your site is capped by its weakest input, not its average one. Improvements elsewhere run into this one first.</p>
    </div>

    <h2 style="font:700 20px/1.2 Georgia,serif;margin:28px 0 0">The three to work on</h2>
    <table style="width:100%;border-collapse:collapse">${gaps}</table>

    <div style="border-top:1px solid #d8dcd2;margin-top:24px;padding-top:20px">
      <h2 style="font:700 20px/1.2 Georgia,serif;margin:0 0 8px">The order matters</h2>
      <p style="font-size:15px;line-height:1.55">Water, then access, then structures, then plants. Planting first is the most common
      and most expensive mistake we see on Edmonton-area acreages — trees go in, then the driveway or the dugout has to go
      through them three years later.</p>
    </div>

    <p style="margin:28px 0"><a href="https://www.expandingedge.ca/contact"
      style="background:#5b3a73;color:#fff;text-decoration:none;padding:13px 22px;border-radius:3px;font:700 15px Georgia,serif;display:inline-block">Book a site walk</a></p>

    <p style="font-size:13px;color:#46584c;line-height:1.5">Expanding Edge Permaculture · Stony Plain, Alberta · info@expandingedge.ca<br>
    Working in the North Saskatchewan watershed, on Treaty 6 lands.</p>
  </div>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Expanding Edge <info@expandingedge.ca>',
      to: [lead.email],
      bcc: process.env.MAIL_BCC ? [process.env.MAIL_BCC] : undefined,
      reply_to: 'info@expandingedge.ca',
      subject: `Your resilience score: ${s.total}/100 — start with ${s.limiting.name.toLowerCase()}`,
      html
    })
  });
  if (!r.ok) throw new Error(await r.text());
}

// Simple CSV export of leads, protected by a shared secret.
app.get('/api/leads.csv', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return res.sendStatus(404);
  let rows = [];
  if (process.env.DATABASE_URL && pool) rows = (await pool.query('SELECT * FROM leads ORDER BY at DESC')).rows;
  else if (fs.existsSync('leads.jsonl'))
    rows = fs.readFileSync('leads.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  const cols = ['at', 'email', 'name', 'region', 'size', 'tenure', 'total', 'archetype', 'limiting', 'hot'];
  res.type('text/csv').send([cols.join(','),
    ...rows.map(r => cols.map(c => `"${String(r[c] ?? r.limiting_factor ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n'));
});

app.get('/healthz', (_, res) => res.send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`resilience quiz on :${port}`));
