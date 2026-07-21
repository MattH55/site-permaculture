import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLead, sendReport } from './lib/report.js';

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

app.post('/api/submit', async (req, res) => {
  const { email } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'bad email' });
  if (limited(req.ip)) return res.status(429).json({ error: 'slow down' });

  // Rescore on the server — never trust a number the browser sends you.
  const { lead, s } = buildLead(req.body);

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
