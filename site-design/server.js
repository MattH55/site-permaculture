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
