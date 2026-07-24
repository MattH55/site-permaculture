import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSiteRecord } from './lib/rules.js';
import { ALBERTA_PRESETS } from './lib/alberta-presets.js';
import { generateSiteReport } from './lib/pipeline.js';

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

app.use(express.json({ limit: '512kb' }));
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
      name: 'Expanding Edge Permaculture',
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

app.get('/healthz', (_req, res) => res.send('ok'));

const port = Number(process.env.PORT) || 3040;
// Bind 0.0.0.0 so Render (and other hosts) can reach the process
app.listen(port, '0.0.0.0', () => {
  console.log(`Expanding Edge site design (Alberta map→report) on :${port}`);
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.log('Note: set GOOGLE_MAPS_API_KEY for Google Maps. Fallback map UI works without it.');
  }
});
