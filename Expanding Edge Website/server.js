import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Rate limiting - crude but effective
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 3600e3) { rec.n = 0; rec.t = now; }
  rec.n++; hits.set(ip, rec);
  return rec.n > 12;
}

// Contact form submission
app.post('/api/submit', async (req, res) => {
  const { email } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) {
    return res.status(400).json({ error: 'bad email' });
  }
  if (limited(req.ip)) {
    return res.status(429).json({ error: 'slow down' });
  }

  const lead = {
    at: new Date().toISOString(),
    ...req.body,
  };

  await store(lead);

  try {
    // Optional: send email notification
    // await sendNotification(lead);
  } catch (e) {
    console.error('notification failed', e.message);
  }

  res.json({ ok: true });
});

// Storage: Postgres if DATABASE_URL is set, otherwise local JSONL
let pool = null;

async function store(lead) {
  if (process.env.DATABASE_URL) {
    if (!pool) {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
        id serial primary key,
        at timestamptz,
        name text,
        email text,
        phone text,
        property_type text,
        interest text,
        message text
      )`);
    }
    await pool.query(
      `INSERT INTO contacts (at, name, email, phone, property_type, interest, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lead.at, lead.name, lead.email, lead.phone, lead.property_type, lead.interest, lead.message]
    );
  } else {
    fs.appendFileSync(
      path.join(__dirname, 'contacts.jsonl'),
      JSON.stringify(lead) + '\n'
    );
  }
}

// Export contacts as CSV
app.get('/api/contacts.csv', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.sendStatus(404);
  }

  let rows = [];
  if (process.env.DATABASE_URL && pool) {
    const result = await pool.query('SELECT * FROM contacts ORDER BY at DESC');
    rows = result.rows;
  } else if (fs.existsSync(path.join(__dirname, 'contacts.jsonl'))) {
    rows = fs.readFileSync(path.join(__dirname, 'contacts.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
  }

  const cols = ['at', 'name', 'email', 'phone', 'property_type', 'interest', 'message'];
  const csv = [
    cols.join(','),
    ...rows.map(r =>
      cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(',')
    )
  ].join('\n');

  res.type('text/csv').send(csv);
});

// Health check
app.get('/healthz', (_, res) => res.send('ok'));

// SPA routing: serve index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Expanding Edge Marketing Site on :${port}`);
});
