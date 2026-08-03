/**
 * Generates resource tool/dashboard/course/lab HTML pages for Expanding Edge.
 * Run: node scripts/build-resources.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'public');

function nav() {
  return `<nav class="nav-main" aria-label="Primary">
        <a href="/#services">Services</a>
        <a href="/resources/">Resources</a>
        <a href="/courses/">Courses</a>
        <a href="/design/">Site Design</a>
        <a href="/case-studies/">Case Studies</a>
        <a href="/service-areas/">Areas</a>
        <a href="/contact/">Contact</a>
      </nav>`;
}

function footer() {
  return `<footer class="site-footer">
    <div class="inner">
      <div class="footer-content">
        <div class="footer-section">
          <strong>Expanding Edge Permaculture</strong>
          <p>Tools that plan. Systems that get built. Alberta &amp; Western Canada.</p>
        </div>
        <div class="footer-section">
          <strong>Resources</strong>
          <ul>
            <li><a href="/resources/">All resources</a></li>
            <li><a href="/courses/">Courses</a></li>
            <li><a href="/labs/">Labs</a></li>
            <li><a href="/design/">Site design</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <strong>Contact</strong>
          <p><a href="tel:7802363630">(780) 236-3630</a></p>
          <p><a href="mailto:info@expandingedge.ca">info@expandingedge.ca</a></p>
        </div>
      </div>
      <div class="footer-bottom"><p>&copy; 2026 Expanding Edge. Design guidance only — not a substitute for licensed engineering or survey.</p></div>
    </div>
  </footer>`;
}

function page({ title, description, canonical, eyebrow, h1, lead, crumbs, body, extraScript = '' }) {
  return `<!doctype html>
<html lang="en-CA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${title.replace(/ \| Expanding Edge.*$/, '')}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://makealbertagreatagain.live${canonical}">
  <meta property="og:image" content="https://makealbertagreatagain.live/images/og-image.jpg">
  <meta property="og:locale" content="en_CA">
  <link rel="canonical" href="https://makealbertagreatagain.live${canonical}">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#16211b">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="site-header">
    <div class="inner">
      <a href="/" class="brand">
        <img src="/images/logo.png" alt="Expanding Edge Permaculture" class="brand-logo" width="160" height="52">
      </a>
      ${nav()}
    </div>
  </header>
  <main>
    <section class="page-header">
      <div class="inner">
        <p class="section-eyebrow mono">${eyebrow}</p>
        <h1>${h1}</h1>
        <p class="lead">${lead}</p>
      </div>
    </section>
    <section class="container">
      <div class="content-section content-section--wide">
        <nav class="breadcrumb-inline" aria-label="Breadcrumb">${crumbs}</nav>
        ${body}
        <div class="cta-highlight no-print">
          <h2 style="margin-top:0;">Ready to implement on your land?</h2>
          <p>These tools guide planning. Expanding Edge designs and builds regenerative systems across Alberta and Western Canada.</p>
          <div class="cta-group" style="justify-content:center;">
            <a href="/contact/" class="btn btn-primary">Book Consultation</a>
            <a href="/design/" class="btn btn-secondary">Full Site Design Tool</a>
            <a href="/resources/" class="btn btn-secondary">All Resources</a>
          </div>
        </div>
      </div>
    </section>
  </main>
  ${footer()}
  <script src="/app.js"></script>
  ${extraScript}
</body>
</html>`;
}

function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('✓', rel);
}

// ——— Frost dashboard ———
write('resources/tools/frost-dashboard/index.html', page({
  title: 'Alberta Frost & Season Dashboard | Expanding Edge',
  description: 'Frost dates, frost-free days, growing degree days and design notes for Edmonton, Calgary, Red Deer, Lethbridge, Peace Country and more.',
  canonical: '/resources/tools/frost-dashboard/',
  eyebrow: 'Dashboard · Climate',
  h1: 'Alberta Frost &amp; Season Dashboard',
  lead: 'Pick your region for approximate frost windows, heat units, and cold-climate design notes — then plan plantings and earthworks with eyes open.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Frost dashboard`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Region</h2>
        <form class="tool-form" id="frost-form">
          <label for="station">Climate region (Alberta)</label>
          <select id="station" name="station"></select>
          <button type="submit" class="btn btn-primary">Update dashboard</button>
        </form>
        <p class="tool-disclaimer">Generalized planning values from regional normals — verify with local station data for critical decisions.</p>
      </div>
      <div class="tool-results" id="frost-out" aria-live="polite">
        <h2>Select a region</h2>
        <p class="lead" style="font-size:1rem;margin:0;">Results appear here.</p>
      </div>
    </div>
    <p><a href="/resources/tools/plant-finder/" class="link-arrow">Next: filter plants for this climate →</a></p>
  `,
  extraScript: `<script>
  async function load() {
    const res = await fetch('/data/climate-ab.json');
    const data = await res.json();
    const sel = document.getElementById('station');
    data.stations.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.name;
      sel.appendChild(o);
    });
    function render() {
      const s = data.stations.find(x => x.id === sel.value);
      if (!s) return;
      document.getElementById('frost-out').innerHTML = \`
        <h2>\${s.name}</h2>
        <div class="result-highlight"><strong>Ecoregion cue:</strong> \${s.region} · \${s.notes}</div>
        <div class="result-metric"><span>Approx. last spring frost</span><strong>\${s.lastFrost}</strong></div>
        <div class="result-metric"><span>Approx. first fall frost</span><strong>\${s.firstFrost}</strong></div>
        <div class="result-metric"><span>Frost-free days</span><strong>\${s.frostFreeDays}</strong></div>
        <div class="result-metric"><span>Growing degree days (base 10°C, approx.)</span><strong>\${s.gddBase10}</strong></div>
        <div class="result-metric"><span>Jan / Jul avg (°C)</span><strong>\${s.janAvgC} / \${s.julAvgC}</strong></div>
        <div class="result-metric"><span>Annual precip (mm, approx.)</span><strong>\${s.annualPrecipMm}</strong></div>
        <p class="tool-disclaimer">\${data.disclaimer}</p>
        <div class="cta-group no-print" style="margin-top:1rem;">
          <a class="btn btn-secondary" href="/resources/tools/plant-finder/?region=\${s.region}">Open plant finder</a>
          <a class="btn btn-secondary" href="/resources/dashboards/seasonal-calendar/">Seasonal calendar</a>
        </div>\`;
    }
    document.getElementById('frost-form').addEventListener('submit', e => { e.preventDefault(); render(); });
    sel.addEventListener('change', render);
    render();
  }
  load();
  </script>`
}));

// ——— Plant finder ———
write('resources/tools/plant-finder/index.html', page({
  title: 'Cold-Climate Plant Finder Alberta | Expanding Edge',
  description: 'Filter Alberta-proven permaculture plants by hardiness zone, function, moisture and ecoregion — food forest, windbreak, N-fixers and more.',
  canonical: '/resources/tools/plant-finder/',
  eyebrow: 'Tool · Plant database',
  h1: 'Cold-Climate Plant Finder',
  lead: 'Search a curated set of species used in Alberta and Prairie regenerative designs. Start shortlists before you order nursery stock.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Plant finder`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Filters</h2>
        <form class="tool-form" id="plant-form">
          <label for="q">Search name</label>
          <input type="search" id="q" placeholder="e.g. saskatoon, spruce">
          <label for="zone">Max hardiness zone (USDA-style)</label>
          <select id="zone">
            <option value="5">Zone 5 or hardier</option>
            <option value="4">Zone 4 or hardier</option>
            <option value="3" selected>Zone 3 or hardier</option>
            <option value="2">Zone 2 or hardier</option>
            <option value="1">Zone 1 only</option>
          </select>
          <label for="fn">Function</label>
          <select id="fn">
            <option value="">Any</option>
            <option value="edible">Edible</option>
            <option value="nitrogen-fixer">Nitrogen fixer</option>
            <option value="windbreak">Windbreak</option>
            <option value="wildlife">Wildlife</option>
            <option value="wetland">Wetland / wet edge</option>
            <option value="forage">Forage</option>
            <option value="groundcover">Groundcover</option>
            <option value="pioneer">Pioneer</option>
            <option value="medicinal">Medicinal</option>
            <option value="evergreen">Evergreen</option>
          </select>
          <label for="moisture">Moisture</label>
          <select id="moisture">
            <option value="">Any</option>
            <option value="dry">Dry</option>
            <option value="medium">Medium</option>
            <option value="wet">Wet</option>
          </select>
          <label for="eco">Ecoregion</label>
          <select id="eco">
            <option value="">Any Alberta</option>
            <option value="parkland">Parkland</option>
            <option value="prairie">Prairie / dry south</option>
            <option value="foothills">Foothills</option>
            <option value="peace">Peace Country</option>
            <option value="boreal">Boreal transition</option>
          </select>
          <button type="submit" class="btn btn-primary">Filter plants</button>
        </form>
      </div>
      <div class="tool-results">
        <h2>Results <span id="plant-count" class="mono" style="font-size:0.75rem;color:var(--ink-soft);"></span></h2>
        <div class="plant-grid" id="plant-grid"></div>
        <p class="tool-disclaimer">Not exhaustive. Cultivar choice, microclimate, and soil still decide success. Confirm nursery stock hardiness for your exact site.</p>
      </div>
    </div>
  `,
  extraScript: `<script>
  let plants = [];
  const params = new URLSearchParams(location.search);
  if (params.get('region')) document.addEventListener('DOMContentLoaded', () => {
    const eco = document.getElementById('eco');
    if (eco) eco.value = params.get('region');
  });
  async function init() {
    plants = await (await fetch('/data/plants-ab.json')).json();
    if (params.get('region')) document.getElementById('eco').value = params.get('region');
    filter();
    document.getElementById('plant-form').addEventListener('submit', e => { e.preventDefault(); filter(); });
    ['q','zone','fn','moisture','eco'].forEach(id => document.getElementById(id).addEventListener('change', filter));
    document.getElementById('q').addEventListener('input', filter);
  }
  function filter() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const zone = +document.getElementById('zone').value;
    const fn = document.getElementById('fn').value;
    const moisture = document.getElementById('moisture').value;
    const eco = document.getElementById('eco').value;
    const list = plants.filter(p => {
      if (p.zone > zone) return false;
      if (fn && !(p.functions||[]).includes(fn)) return false;
      if (moisture && p.moisture !== moisture) return false;
      if (eco && !(p.ecoregions||[]).includes(eco)) return false;
      if (q && !(\`\${p.name} \${p.latin}\`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a,b) => a.name.localeCompare(b.name));
    document.getElementById('plant-count').textContent = list.length + ' species';
    document.getElementById('plant-grid').innerHTML = list.length ? list.map(p => \`
      <div class="plant-item">
        <h4>\${p.name}</h4>
        <p class="plant-latin">\${p.latin} · Zone \${p.zone} · ~\${p.height_m}m</p>
        <p style="margin:0 0 0.5rem;font-size:0.88rem;color:var(--ink-soft);">\${p.notes||''}</p>
        <div class="plant-tags">\${(p.functions||[]).map(f=>\`<span>\${f}</span>\`).join('')}
          <span>\${p.moisture}</span>
          \${(p.ecoregions||[]).slice(0,3).map(e=>\`<span>\${e}</span>\`).join('')}
        </div>
      </div>\`).join('') : '<p>No matches — widen filters.</p>';
  }
  init();
  </script>`
}));

// ——— Swale calculator ———
write('resources/tools/swale-calculator/index.html', page({
  title: 'Swale & Contour Spacing Calculator Alberta | Expanding Edge',
  description: 'Estimate permaculture swale spacing and storage class from slope, soil infiltration class, and design storm depth for Alberta sites.',
  canonical: '/resources/tools/swale-calculator/',
  eyebrow: 'Tool · Water · Earthworks',
  h1: 'Swale &amp; Contour Spacing Calculator',
  lead: 'A planning calculator for on-contour water harvesting. Use results to brief staking — then verify on site before machines roll.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Swale calculator`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Site inputs</h2>
        <form class="tool-form" id="swale-form">
          <label for="slope">Average slope (%)</label>
          <input type="number" id="slope" min="0.2" max="40" step="0.1" value="4">
          <label for="soil">Soil infiltration class</label>
          <select id="soil">
            <option value="1.2">Sandy / fast</option>
            <option value="1" selected>Loam / moderate</option>
            <option value="0.75">Clay-loam</option>
            <option value="0.55">Heavy clay / slow</option>
          </select>
          <label for="storm">Design storm depth (mm)</label>
          <input type="number" id="storm" min="10" max="100" value="25">
          <label for="run">Slope run length to manage (m)</label>
          <input type="number" id="run" min="10" max="2000" value="100">
          <label for="depth">Target swale depth (m)</label>
          <input type="number" id="depth" min="0.2" max="1.5" step="0.05" value="0.4">
          <button type="submit" class="btn btn-primary">Calculate</button>
        </form>
      </div>
      <div class="tool-results" id="swale-out"></div>
    </div>
    <p><a href="/courses/water-on-contour/" class="link-arrow">Course: Water on Contour →</a> · <a href="/learn/drivers/water-management/swales/" class="link-arrow">Learn: swales →</a></p>
  `,
  extraScript: `<script>
  function calc(e) {
    e && e.preventDefault();
    const slope = +document.getElementById('slope').value;
    const soil = +document.getElementById('soil').value;
    const storm = +document.getElementById('storm').value / 1000; // m
    const run = +document.getElementById('run').value;
    const depth = +document.getElementById('depth').value;
    // Rule-of-thumb spacing: tighter on steep + slow soils; wider on gentle + fast
    const base = 100 / Math.max(slope, 0.5);
    let spacing = base * soil * (0.025 / Math.max(storm, 0.01));
    spacing = Math.min(80, Math.max(4, spacing));
    const n = Math.max(1, Math.ceil(run / spacing));
    // crude trench storage per m length: depth * width(assume 1.2m) * 0.5 triangle-ish
    const width = Math.max(1, depth * 3);
    const storagePerM = depth * width * 0.45; // m3 per m
    const storageClass = storagePerM * (run / n);
    let risk = 'Moderate — stake overflow paths.';
    if (slope > 12) risk = 'Steep — consider tighter spacing, check dams, or terraces; professional design advised.';
    if (slope < 1.5) risk = 'Very gentle — verify level with laser/transit; small grade errors dominate.';
    document.getElementById('swale-out').innerHTML = \`
      <h2>Planning results</h2>
      <div class="result-highlight">\${risk}</div>
      <div class="result-metric"><span>Suggested spacing (centre to centre)</span><strong>\${spacing.toFixed(1)} m</strong></div>
      <div class="result-metric"><span>Approx. swales along \${run} m run</span><strong>\${n}</strong></div>
      <div class="result-metric"><span>Assumed berm/channel width</span><strong>\${width.toFixed(1)} m</strong></div>
      <div class="result-metric"><span>Storage class per swale (order of magnitude)</span><strong>\${storageClass.toFixed(1)} m³ / swale segment</strong></div>
      <div class="result-metric"><span>Storm depth used</span><strong>\${(storm*1000).toFixed(0)} mm</strong></div>
      <p class="tool-disclaimer">Educational estimate only. Real design needs survey, soils, overflow, and safety setbacks. Not an engineering stamp.</p>
      <div class="cta-group no-print"><a class="btn btn-primary" href="/contact/?interest=implementation">Request earthworks consult</a></div>\`;
  }
  document.getElementById('swale-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Rainwater ———
write('resources/tools/rainwater-calculator/index.html', page({
  title: 'Rainwater Catchment Calculator Alberta | Expanding Edge',
  description: 'Estimate cistern sizing from roof area and Alberta regional precipitation for garden and homestead irrigation planning.',
  canonical: '/resources/tools/rainwater-calculator/',
  eyebrow: 'Tool · Water',
  h1: 'Rainwater Catchment Calculator',
  lead: 'Turn roof footprint and regional rainfall into annual catchment volume and cistern size bands for Alberta homesteads.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Rainwater calculator`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Inputs</h2>
        <form class="tool-form" id="rain-form">
          <label for="roof">Roof catchment area (m²)</label>
          <input type="number" id="roof" min="5" value="150">
          <label for="eff">Collection efficiency</label>
          <select id="eff">
            <option value="0.75">0.75 — typical with first-flush</option>
            <option value="0.85" selected>0.85 — good gutters &amp; screen</option>
            <option value="0.6">0.6 — leaky / complex roof</option>
          </select>
          <label for="precip">Annual precip (mm)</label>
          <input type="number" id="precip" min="200" max="900" value="450">
          <label for="preset">Or use regional preset</label>
          <select id="preset">
            <option value="">Custom</option>
            <option value="450">Edmonton ~450</option>
            <option value="420">Calgary ~420</option>
            <option value="380">Lethbridge ~380</option>
            <option value="320">Medicine Hat ~320</option>
            <option value="450">Grande Prairie ~450</option>
            <option value="550">Rocky MH ~550</option>
          </select>
          <label for="demand">Summer garden demand (L/week, optional)</label>
          <input type="number" id="demand" min="0" value="400">
          <button type="submit" class="btn btn-primary">Calculate</button>
        </form>
      </div>
      <div class="tool-results" id="rain-out"></div>
    </div>
  `,
  extraScript: `<script>
  document.getElementById('preset').addEventListener('change', function() {
    if (this.value) document.getElementById('precip').value = this.value;
  });
  function calc(e) {
    e && e.preventDefault();
    const roof = +document.getElementById('roof').value;
    const eff = +document.getElementById('eff').value;
    const precip = +document.getElementById('precip').value;
    const demand = +document.getElementById('demand').value;
    // 1 mm on 1 m2 = 1 litre
    const annualL = roof * precip * eff;
    const annualM3 = annualL / 1000;
    const cisternLow = annualM3 * 0.15;
    const cisternHigh = annualM3 * 0.35;
    const weeks = demand > 0 ? annualL / demand : null;
    document.getElementById('rain-out').innerHTML = \`
      <h2>Catchment results</h2>
      <div class="result-metric"><span>Est. annual collection</span><strong>\${Math.round(annualL).toLocaleString('en-CA')} L (\${annualM3.toFixed(1)} m³)</strong></div>
      <div class="result-metric"><span>Cistern band (store 15–35% of annual)</span><strong>\${cisternLow.toFixed(1)} – \${cisternHigh.toFixed(1)} m³</strong></div>
      <div class="result-metric"><span>In gallons (US, approx.)</span><strong>\${Math.round(annualL * 0.264).toLocaleString('en-CA')} gal/yr</strong></div>
      \${weeks ? \`<div class="result-metric"><span>Weeks of garden supply @ demand</span><strong>\${weeks.toFixed(0)} weeks</strong></div>\` : ''}
      <div class="result-highlight">Pair cisterns with soil storage (mulch, swales, organic matter) — tanks alone rarely carry a full Prairie drought.</div>
      <p class="tool-disclaimer">Excludes snow management, ice, and first-flush waste. Check local codes for potable vs non-potable use.</p>\`;
  }
  document.getElementById('rain-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Food forest builder ———
write('resources/tools/food-forest-builder/index.html', page({
  title: 'Food Forest Density Builder Alberta | Expanding Edge',
  description: 'Estimate canopy trees, shrubs and understory counts for a cold-climate food forest from area and target canopy cover.',
  canonical: '/resources/tools/food-forest-builder/',
  eyebrow: 'Tool · Food forest',
  h1: 'Food Forest Density &amp; Starter Builder',
  lead: 'Size a multi-layer planting for Alberta conditions — then refine species in the Plant Finder.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Food forest builder`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Planting area</h2>
        <form class="tool-form" id="ff-form">
          <label for="area">Area (m²)</label>
          <input type="number" id="area" min="20" value="1000">
          <label for="orAcres">Or acres</label>
          <input type="number" id="orAcres" min="0" step="0.1" placeholder="optional">
          <label for="canopy">Target canopy cover (%)</label>
          <input type="number" id="canopy" min="20" max="90" value="50">
          <label for="spacing">Average canopy tree spacing (m)</label>
          <input type="number" id="spacing" min="3" max="12" step="0.5" value="6">
          <label for="years">Establishment years</label>
          <select id="years">
            <option value="3">3-year push</option>
            <option value="5" selected>5-year stagger</option>
            <option value="8">8-year patient</option>
          </select>
          <button type="submit" class="btn btn-primary">Build plan</button>
        </form>
      </div>
      <div class="tool-results" id="ff-out"></div>
    </div>
  `,
  extraScript: `<script>
  document.getElementById('orAcres').addEventListener('change', function() {
    if (this.value) document.getElementById('area').value = Math.round(+this.value * 4046.86);
  });
  function calc(e) {
    e && e.preventDefault();
    const area = +document.getElementById('area').value;
    const canopyPct = +document.getElementById('canopy').value / 100;
    const spacing = +document.getElementById('spacing').value;
    const years = +document.getElementById('years').value;
    const cell = spacing * spacing;
    const canopyTrees = Math.max(1, Math.round((area * canopyPct) / cell));
    const shrubs = Math.round(canopyTrees * 3.5);
    const herbs = Math.round(canopyTrees * 8);
    const nFix = Math.max(2, Math.round(canopyTrees * 0.4));
    const perYear = Math.ceil(canopyTrees / years);
    document.getElementById('ff-out').innerHTML = \`
      <h2>Starter schedule</h2>
      <div class="result-metric"><span>Canopy / small trees</span><strong>\${canopyTrees}</strong></div>
      <div class="result-metric"><span>Shrubs (berries, N-fixers, hedges)</span><strong>\${shrubs}</strong></div>
      <div class="result-metric"><span>Herbaceous / ground layer plugs (order-of-mag.)</span><strong>\${herbs}</strong></div>
      <div class="result-metric"><span>Nitrogen-fixers (subset)</span><strong>~\${nFix}+</strong></div>
      <div class="result-metric"><span>Canopy trees per year (\${years}-yr stagger)</span><strong>~\${perYear}</strong></div>
      <div class="result-highlight">Year 1: water works + wind protection + N-fixers. Year 2–3: main fruit. Later: densify guilds. Sequence beats bulk orders.</div>
      <p class="tool-disclaimer">Spacing ignores roads, septic, and utility setbacks — overlay on a real site plan.</p>
      <div class="cta-group no-print">
        <a class="btn btn-secondary" href="/resources/tools/plant-finder/?fn=edible">Plant finder</a>
        <a class="btn btn-secondary" href="/resources/tools/guild-recipes/">Guild recipes</a>
      </div>\`;
  }
  document.getElementById('ff-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Shelterbelt ———
write('resources/tools/shelterbelt-designer/index.html', page({
  title: 'Shelterbelt & Windbreak Designer Alberta | Expanding Edge',
  description: 'Design multi-row windbreaks for Alberta acreages: row counts, species roles, and setback guidance for prairie and parkland sites.',
  canonical: '/resources/tools/shelterbelt-designer/',
  eyebrow: 'Tool · Wind · Prairie',
  h1: 'Shelterbelt / Windbreak Designer',
  lead: 'Wind is free energy that can destroy orchards — or shape microclimates. Size a living windbreak for your field width and goal.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Shelterbelt designer`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="sb-form">
          <label for="width">Protected field width (m) perpendicular to wind</label>
          <input type="number" id="width" min="10" value="120">
          <label for="goal">Primary goal</label>
          <select id="goal">
            <option value="snow">Snow distribution / drift control</option>
            <option value="crop" selected>Crop / orchard protection</option>
            <option value="privacy">Privacy + moderate wind</option>
            <option value="full">Full stop / farmstead calm</option>
          </select>
          <label for="wind">Winter wind exposure</label>
          <select id="wind">
            <option value="1">Sheltered / aspen parkland</option>
            <option value="1.2" selected>Open prairie / ridge</option>
            <option value="1.4">Severe (foothills / bare quarter)</option>
          </select>
          <label for="evergreen">Include evergreen rows?</label>
          <select id="evergreen">
            <option value="yes" selected>Yes — denser winter protection</option>
            <option value="no">Deciduous only</option>
          </select>
          <button type="submit" class="btn btn-primary">Design rows</button>
        </form>
      </div>
      <div class="tool-results" id="sb-out"></div>
    </div>
  `,
  extraScript: `<script>
  function calc(e) {
    e && e.preventDefault();
    const width = +document.getElementById('width').value;
    const goal = document.getElementById('goal').value;
    const wind = +document.getElementById('wind').value;
    const ever = document.getElementById('evergreen').value === 'yes';
    const rowsByGoal = { snow: 2, crop: 3, privacy: 2, full: 5 };
    let rows = Math.ceil(rowsByGoal[goal] * wind);
    if (!ever && goal !== 'snow') rows += 1;
    rows = Math.min(7, Math.max(2, rows));
    // protection distance often ~10-15x mature height; assume 12m trees
    const protect = 12 * 12;
    const ok = width <= protect * 1.2;
    const roles = [];
    if (ever) roles.push('Windward: shrub dense (caragana, buffaloberry, lilac)');
    roles.push(ever ? 'Middle: evergreen (spruce/pine) for winter porosity control' : 'Middle: hybrid poplar / ash for height (temporary OK)');
    roles.push('Leeward: tall deciduous + wildlife shrubs');
    if (goal === 'full') roles.push('Interior: optional fruit alley on leeward calm side');
    document.getElementById('sb-out').innerHTML = \`
      <h2>Windbreak sketch</h2>
      <div class="result-metric"><span>Suggested rows</span><strong>\${rows}</strong></div>
      <div class="result-metric"><span>Typical in-row spacing (trees)</span><strong>2–3 m shrubs · 3–5 m trees</strong></div>
      <div class="result-metric"><span>Between-row spacing</span><strong>3–5 m (equipment access)</strong></div>
      <div class="result-metric"><span>Approx. calm zone (order of mag.)</span><strong>~\${protect} m downwind of mature height</strong></div>
      <div class="result-highlight">\${ok ? 'Field width is within a single belt’s typical influence — good.' : 'Field wider than one belt’s influence — consider intermediate belts or accept partial protection.'}</div>
      <p><strong>Row roles</strong></p>
      <ul>\${roles.map(r => '<li>'+r+'</li>').join('')}</ul>
      <p class="tool-disclaimer">Stay clear of road sightlines and utilities. Check municipal shelterbelt programs and setbacks.</p>
      <a class="btn btn-secondary no-print" href="/resources/tools/plant-finder/?fn=windbreak">Windbreak plants</a>\`;
  }
  document.getElementById('sb-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Zone planner ———
write('resources/tools/zone-planner/index.html', page({
  title: 'Homestead Zone Planner Lite | Expanding Edge Permaculture',
  description: 'Sketch permaculture zones 0–5 on a simple canvas for Alberta acreages, then continue in the full site design tool.',
  canonical: '/resources/tools/zone-planner/',
  eyebrow: 'Tool · Layout',
  h1: 'Homestead Zone Planner (Lite)',
  lead: 'Click to place home, garden, animals, and wild edge. This is a teaching sketch — use the full design tool for real topography.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Zone planner`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <h2>Place elements</h2>
        <form class="tool-form" id="zone-form">
          <label for="tool">Active tool</label>
          <select id="tool">
            <option value="home">Home (Zone 0/1)</option>
            <option value="garden">Garden / greenhouse</option>
            <option value="animals">Animals / barn</option>
            <option value="orchard">Orchard / food forest</option>
            <option value="pond">Pond / water</option>
            <option value="wild">Wild / Zone 5</option>
          </select>
          <button type="button" class="btn btn-secondary" id="zone-clear">Clear sketch</button>
          <a class="btn btn-primary" href="/design/" style="display:block;text-align:center;margin-top:0.75rem;">Open full site design tool</a>
        </form>
        <ul style="font-size:0.9rem;color:var(--ink-soft);">
          <li>Zone 1: daily visits next to home</li>
          <li>Zone 2: orchards, compost, small stock</li>
          <li>Zone 3: main crop / pasture</li>
          <li>Zone 4–5: managed woodland → wild</li>
        </ul>
      </div>
      <div>
        <div class="zone-canvas-wrap">
          <canvas id="zone-canvas" width="640" height="480" aria-label="Zone sketch canvas"></canvas>
        </div>
        <div class="tool-results" id="zone-list" style="margin-top:1rem;"></div>
      </div>
    </div>
  `,
  extraScript: `<script>
  const canvas = document.getElementById('zone-canvas');
  const ctx = canvas.getContext('2d');
  const colors = { home:'#5b3a73', garden:'#2f5d3a', animals:'#8c5a1d', orchard:'#4a3524', pond:'#3d6f8c', wild:'#46584c' };
  const labels = { home:'Home', garden:'Garden', animals:'Animals', orchard:'Orchard', pond:'Water', wild:'Wild' };
  let items = JSON.parse(localStorage.getItem('ee-zones') || '[]');
  function draw() {
    ctx.fillStyle = '#dfe6d8';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = '#c8cec1';
    for (let x=0;x<canvas.width;x+=40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let y=0;y<canvas.height;y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    items.forEach(it => {
      ctx.fillStyle = colors[it.t] || '#16211b';
      ctx.beginPath(); ctx.arc(it.x, it.y, 14, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#16211b';
      ctx.font = '12px sans-serif';
      ctx.fillText(labels[it.t]||it.t, it.x+16, it.y+4);
    });
    document.getElementById('zone-list').innerHTML = '<h2>Placed</h2>' + (items.length ? '<ul>'+items.map(i=>'<li>'+labels[i.t]+'</li>').join('')+'</ul>' : '<p>Click the canvas to place the active tool.</p>');
  }
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width);
    const y = (e.clientY - r.top) * (canvas.height / r.height);
    items.push({ t: document.getElementById('tool').value, x, y });
    localStorage.setItem('ee-zones', JSON.stringify(items));
    draw();
  });
  document.getElementById('zone-clear').onclick = () => { items = []; localStorage.removeItem('ee-zones'); draw(); };
  draw();
  </script>`
}));

// ——— Budget builder ———
write('resources/tools/budget-builder/index.html', page({
  title: 'Earthworks Phase & Budget Builder | Expanding Edge',
  description: 'Phase regenerative earthworks and plantings for Alberta properties with rough cost bands and recommended sequence.',
  canonical: '/resources/tools/budget-builder/',
  eyebrow: 'Tool · Implementation',
  h1: 'Earthworks Phase &amp; Budget Builder',
  lead: 'Honest sequencing beats fantasy budgets. Estimate phase order and cost bands for Western Canada design-build projects.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Budget builder`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="bud-form">
          <label for="acres">Property scale (acres treated)</label>
          <input type="number" id="acres" min="0.25" step="0.25" value="5">
          <label for="complexity">Site difficulty</label>
          <select id="complexity">
            <option value="0.85">Simple / open / easy access</option>
            <option value="1" selected>Typical acreage</option>
            <option value="1.35">Complex / steep / remote / heavy clay</option>
          </select>
          <label>Goals (check all that apply)</label>
          <label><input type="checkbox" name="g" value="access" checked> Access / lanes</label>
          <label><input type="checkbox" name="g" value="swales" checked> Swales / contour water</label>
          <label><input type="checkbox" name="g" value="pond"> Pond / dugout</label>
          <label><input type="checkbox" name="g" value="shelter" checked> Shelterbelts</label>
          <label><input type="checkbox" name="g" value="foodforest" checked> Food forest / orchard</label>
          <label><input type="checkbox" name="g" value="fence"> Livestock fence / water points</label>
          <button type="submit" class="btn btn-primary">Build phases</button>
        </form>
      </div>
      <div class="tool-results" id="bud-out"></div>
    </div>
  `,
  extraScript: `<script>
  const base = {
    access: { name:'Access &amp; drainage lanes', unit:1200, phase:1 },
    swales: { name:'Swales / keyline-style earthworks', unit:1800, phase:1 },
    pond: { name:'Pond / dugout (excludes liner extremes)', unit:4500, phase:2 },
    shelter: { name:'Shelterbelt plantings', unit:900, phase:2 },
    foodforest: { name:'Food forest / orchard establishment', unit:1600, phase:3 },
    fence: { name:'Fence &amp; stock water integration', unit:1100, phase:3 }
  };
  function calc(e) {
    e && e.preventDefault();
    const acres = +document.getElementById('acres').value;
    const cx = +document.getElementById('complexity').value;
    const goals = [...document.querySelectorAll('input[name=g]:checked')].map(x => x.value);
    if (!goals.length) { document.getElementById('bud-out').innerHTML = '<p>Select at least one goal.</p>'; return; }
    let low=0, high=0;
    const phases = {1:[],2:[],3:[]};
    goals.forEach(g => {
      const b = base[g];
      const mid = b.unit * Math.sqrt(acres) * cx;
      low += mid * 0.7; high += mid * 1.5;
      phases[b.phase].push({ name: b.name, mid });
    });
    const fmt = n => '$' + Math.round(n).toLocaleString('en-CA');
    document.getElementById('bud-out').innerHTML = \`
      <h2>Phased plan (CAD, rough)</h2>
      <div class="result-highlight">Band for selected scope: <strong>\${fmt(low)} – \${fmt(high)}</strong> (very approximate contractor ranges; not a quote)</div>
      <h3>Phase 1 — Water &amp; access first</h3>
      <ul>\${(phases[1].length?phases[1]:[{name:'(none selected)'}]).map(p=>'<li>'+p.name+(p.mid?' — ~'+fmt(p.mid):'')+'</li>').join('')}</ul>
      <h3>Phase 2 — Structure &amp; storage</h3>
      <ul>\${(phases[2].length?phases[2]:[{name:'(none selected)'}]).map(p=>'<li>'+p.name+(p.mid?' — ~'+fmt(p.mid):'')+'</li>').join('')}</ul>
      <h3>Phase 3 — Productive plantings &amp; stock</h3>
      <ul>\${(phases[3].length?phases[3]:[{name:'(none selected)'}]).map(p=>'<li>'+p.name+(p.mid?' — ~'+fmt(p.mid):'')+'</li>').join('')}</ul>
      <p class="tool-disclaimer">Costs vary wildly by equipment, haul distance, rock, and season. Use this to prioritize — then request a site-specific Expanding Edge quote.</p>
      <a class="btn btn-primary no-print" href="/contact/?interest=implementation">Request implementation quote</a>\`;
  }
  document.getElementById('bud-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Pond ———
write('resources/tools/pond-estimator/index.html', page({
  title: 'Pond & Dugout Volume Estimator | Expanding Edge Alberta',
  description: 'Estimate pond or dugout volume, livestock-days of water, and evaporation caution for Alberta farm and homestead designs.',
  canonical: '/resources/tools/pond-estimator/',
  eyebrow: 'Tool · Water',
  h1: 'Pond / Dugout Volume Estimator',
  lead: 'Rough geometry for planning — not a construction stamp. Pair with soils, spillway, and safety design.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Pond estimator`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="pond-form">
          <div class="field-row">
            <div><label for="len">Length (m)</label><input type="number" id="len" value="30"></div>
            <div><label for="wid">Width (m)</label><input type="number" id="wid" value="15"></div>
          </div>
          <label for="dep">Average depth (m)</label>
          <input type="number" id="dep" step="0.1" value="2.5">
          <label for="shape">Shape factor</label>
          <select id="shape">
            <option value="0.7">Irregular / naturalized</option>
            <option value="0.85" selected>Rounded rectangle</option>
            <option value="1">Boxy (overestimate)</option>
          </select>
          <label for="au">Beef cow-calf pairs watering (optional)</label>
          <input type="number" id="au" min="0" value="0">
          <label for="arid">Climate caution</label>
          <select id="arid">
            <option value="no">Parkland / higher precip</option>
            <option value="yes">Southern AB semi-arid</option>
          </select>
          <button type="submit" class="btn btn-primary">Estimate</button>
        </form>
      </div>
      <div class="tool-results" id="pond-out"></div>
    </div>
  `,
  extraScript: `<script>
  function calc(e) {
    e && e.preventDefault();
    const L=+document.getElementById('len').value, W=+document.getElementById('wid').value, D=+document.getElementById('dep').value;
    const shape=+document.getElementById('shape').value;
    const au=+document.getElementById('au').value;
    const arid=document.getElementById('arid').value==='yes';
    const m3 = L*W*D*shape;
    const Lvol = m3*1000;
    const gal = Lvol*0.264172;
    // ~50 L/day pair rough
    const days = au>0 ? (Lvol*0.6)/(au*50) : null; // 60% usable
    document.getElementById('pond-out').innerHTML = \`
      <h2>Volume estimate</h2>
      <div class="result-metric"><span>Storage volume</span><strong>\${m3.toFixed(0)} m³</strong></div>
      <div class="result-metric"><span>Litres</span><strong>\${Math.round(Lvol).toLocaleString('en-CA')} L</strong></div>
      <div class="result-metric"><span>US gallons</span><strong>\${Math.round(gal).toLocaleString('en-CA')} gal</strong></div>
      \${days!=null?\`<div class="result-metric"><span>Rough livestock-days (60% usable, 50 L/pair/day)</span><strong>\${days.toFixed(0)} days</strong></div>\`:''}
      <div class="result-highlight">\${arid?'Semi-arid: expect high evaporation and seepage risk without clay/liner design. Oversize catchment and shade edges.':'Ensure freeboard, emergency spillway, and fencing for safety.'}</div>
      <p class="tool-disclaimer">Does not calculate embankment stability, inlet design, or fish culture. Hire qualified earthworks for construction.</p>\`;
  }
  document.getElementById('pond-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Grazing ———
write('resources/tools/grazing-planner/index.html', page({
  title: 'Grazing & Small-Stock Rotation Planner | Expanding Edge',
  description: 'Sketch rotational grazing calendars for small Alberta acreages from paddock count, rest days, and animal units.',
  canonical: '/resources/tools/grazing-planner/',
  eyebrow: 'Tool · Livestock',
  h1: 'Grazing &amp; Small-Stock Rotation Sketch',
  lead: 'A lightweight rotation calendar for integrating animals into permaculture zones — not a full ranch model.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Grazing planner`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="gr-form">
          <label for="paddocks">Number of paddocks</label>
          <input type="number" id="paddocks" min="2" max="40" value="8">
          <label for="graze">Days graze per paddock</label>
          <input type="number" id="graze" min="1" max="21" value="3">
          <label for="rest">Target rest days</label>
          <input type="number" id="rest" min="14" max="120" value="35">
          <label for="au">Animal units (rough)</label>
          <input type="number" id="au" min="0.1" step="0.1" value="2">
          <label for="acres">Acres available</label>
          <input type="number" id="acres" min="1" value="10">
          <button type="submit" class="btn btn-primary">Build rotation</button>
        </form>
      </div>
      <div class="tool-results" id="gr-out"></div>
    </div>
  `,
  extraScript: `<script>
  function calc(e) {
    e && e.preventDefault();
    const p=+document.getElementById('paddocks').value;
    const g=+document.getElementById('graze').value;
    const rest=+document.getElementById('rest').value;
    const au=+document.getElementById('au').value;
    const acres=+document.getElementById('acres').value;
    const cycle = g * p;
    const actualRest = g * (p-1);
    const ok = actualRest >= rest;
    const density = au / Math.max(acres/p, 0.1);
    document.getElementById('gr-out').innerHTML = \`
      <h2>Rotation sketch</h2>
      <div class="result-metric"><span>Full cycle length</span><strong>\${cycle} days</strong></div>
      <div class="result-metric"><span>Rest days before return</span><strong>\${actualRest} days</strong></div>
      <div class="result-metric"><span>Stock density while grazing one paddock</span><strong>\${density.toFixed(2)} AU / paddock-acre</strong></div>
      <div class="result-highlight">\${ok?'Rest target met with this paddock count.':'Rest below target — add paddocks or shorten graze periods.'}</div>
      <p>Water and shade must move with animals. Integrate lanes so stock do not wreck swales.</p>
      <p class="tool-disclaimer">Forage growth in Alberta is seasonal — slow rotations in spring/fall, faster in peak growth, plan winter feed separately.</p>\`;
  }
  document.getElementById('gr-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

// ——— Guild recipes ———
write('resources/tools/guild-recipes/index.html', page({
  title: 'Guild & Enterprise Recipe Configurator | Expanding Edge',
  description: 'Choose Alberta-ready permaculture enterprise recipes — egg systems, berry alleys, shelterbelt pasture — and generate a one-page plan.',
  canonical: '/resources/tools/guild-recipes/',
  eyebrow: 'Tool · Enterprises',
  h1: 'Guild &amp; Enterprise Recipe Configurator',
  lead: 'Pick a proven pattern for cold-climate Western Canada. Stack functions, then adapt with the plant finder and design tool.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Guild recipes`,
  body: `
    <div class="recipe-grid" id="recipes"></div>
    <div class="tool-results" id="recipe-out" style="margin-top:1.5rem;">
      <h2>Select a recipe</h2>
      <p>Click a card to generate your one-page plan.</p>
    </div>
    <button type="button" class="btn btn-secondary no-print" id="print-recipe" style="margin-top:1rem;">Print / save plan</button>
  `,
  extraScript: `<script>
  const recipes = [
    { id:'eggs-willow', name:'Eggs + willow swale edge', labour:'Medium', yield:'Eggs, biomass, water', risk:'Predator pressure', inputs:'Mobile coop, willows, simple swale', spacing:'Coop moves weekly; willows 0.5–1 m on wet edge', years:'Yields in months; edge matures 2–4 yrs', steps:['Secure night housing','Establish wet-edge willows after water works','Rotate chickens on orchard alleys only after trees are guarded'] },
    { id:'berry-alley', name:'Market berry alley crop', labour:'High early', yield:'Haskap, saskatoon, currant', risk:'Birds, weed pressure', inputs:'Irrigation year 1–3, mulch, bird strategy', spacing:'Rows 3–4 m; in-row 1–1.5 m', years:'Pick years 2–4', steps:['Shelterbelt first if windy','Plant mixed berry rows with N-fixers every 5th','Understory clover + paths'] },
    { id:'shelter-pasture', name:'Shelterbelt + pasture', labour:'Medium', yield:'Forage, calm stock, snow control', risk:'Overgrazing young trees', inputs:'Tree guards, temporary fence', spacing:'Multi-row belt; pasture leeward', years:'Grazing benefits 3–7 yrs', steps:['Fence trees out until established','Seed legumes in pasture','Add stock water away from trunks'] },
    { id:'zone1-kitchen', name:'Zone 1 perennial kitchen', labour:'Low–med', yield:'Rhubarb, herbs, asparagus, berries', risk:'Neglect if far from door', inputs:'Mulch, compost, path edges', spacing:'Steps from kitchen door', years:'Immediate herbs; asparagus year 3', steps:['Map door-to-garden steps','Plant highest-use crops closest','Add rain barrel + mulch'] },
    { id:'chinook-orchard', name:'Chinook-aware orchard pocket', labour:'Medium', yield:'Apples, crab, sour cherry', risk:'Winter desiccation, late frost', inputs:'Windward evergreen, frost drain', spacing:'Trees 5–7 m; open cold-air outlet', years:'Fruit 4–7 yrs', steps:['Never plant frost pocket bottoms','Build windward shelter first','Choose Prairie cultivars only'] },
    { id:'wetland-edge', name:'Wetland edge guild', labour:'Low', yield:'Wildlife, filtration, willows', risk:'Mosquitoes, soft soils', inputs:'Native wet shrubs, fencing livestock', spacing:'Bands by moisture', years:'Cover in 2–3 yrs', steps:['Map spring high water','Plant dogwood/willow/highbush cranberry bands','Keep heavy equipment off wet soils'] }
  ];
  const box = document.getElementById('recipes');
  box.innerHTML = recipes.map(r => \`<div class="recipe-card" data-id="\${r.id}" tabindex="0"><h3>\${r.name}</h3><p style="margin:0;color:var(--ink-soft);font-size:0.9rem;">\${r.yield}</p></div>\`).join('');
  function show(id) {
    const r = recipes.find(x => x.id === id);
    document.querySelectorAll('.recipe-card').forEach(c => c.classList.toggle('selected', c.dataset.id===id));
    document.getElementById('recipe-out').innerHTML = \`
      <h2>\${r.name}</h2>
      <div class="result-metric"><span>Labour</span><strong>\${r.labour}</strong></div>
      <div class="result-metric"><span>Yields</span><strong>\${r.yield}</strong></div>
      <div class="result-metric"><span>Main risks</span><strong>\${r.risk}</strong></div>
      <div class="result-metric"><span>Key inputs</span><strong>\${r.inputs}</strong></div>
      <div class="result-metric"><span>Spacing cues</span><strong>\${r.spacing}</strong></div>
      <div class="result-metric"><span>Time to meaningful yield</span><strong>\${r.years}</strong></div>
      <h3>Implementation steps</h3>
      <ol>\${r.steps.map(s=>'<li>'+s+'</li>').join('')}</ol>
      <p class="tool-disclaimer">Recipe patterns are educational. Adapt to your survey, soils, and bylaws.</p>\`;
  }
  box.addEventListener('click', e => {
    const card = e.target.closest('.recipe-card');
    if (card) show(card.dataset.id);
  });
  document.getElementById('print-recipe').onclick = () => window.print();
  </script>`
}));

console.log('Tools done');

// ——— Dashboards ———
write('resources/dashboards/ecoregion-packs/index.html', page({
  title: 'Alberta Ecoregion Design Packs | Expanding Edge',
  description: 'Switchable design packs for Alberta parkland, prairie, foothills, Peace Country and boreal transition — constraints, plants, water strategies.',
  canonical: '/resources/dashboards/ecoregion-packs/',
  eyebrow: 'Dashboard · Regional',
  h1: 'Alberta Ecoregion Design Packs',
  lead: 'One province, many climates. Toggle packs for constraints, water moves, and plant directions.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Ecoregion packs`,
  body: `
    <div class="eco-tabs" id="eco-tabs"></div>
    <div class="tool-results" id="eco-out"></div>
  `,
  extraScript: `<script>
  const packs = {
    parkland: { name:'Aspen parkland', constraints:['Frost pockets in lows','Clay-loam compaction','Fragmented shelter'], water:['Swales on long slopes','Protect wetlands','Snow capture with belts'], plants:['Saskatoon, chokecherry, spruce, apple (hardy), haskap'], moves:['Shelter before orchard','Zone 1 near house for short season','Build OM on hayfields'] },
    prairie: { name:'Dry mixedgrass / prairie', constraints:['Low precip','Wind','Chinook swings'], water:['Every mm counts','Ponds need clay/liner honesty','Mulch obsessively'], plants:['Buffaloberry, caragana, sea buckthorn, native grasses, sand cherry'], moves:['Windbreak first','Drought guilds','Irrigation only as bridge'] },
    foothills: { name:'Foothills', constraints:['Wind','Cool nights','Variable aspect'], water:['Aspect-driven snow','Drainage on steep','Spring seeps'], plants:['Spruce, willow, saskatoon, hardy berries, aspen edges'], moves:['Design to aspect','Never block cold air drains','Use slopes for gravity'] },
    peace: { name:'Peace Country', constraints:['Short season','Long days','Late frost'], water:['Wet soils common','Spring access limits machines'], plants:['Haskap, currant, spruce, aspen, early apples'], moves:['Earliest cultivars only','Season extension structures','Earthworks in dry windows'] },
    boreal: { name:'Boreal transition', constraints:['Cold','Acid soils in places','Short heat'], water:['Organic soils','Wetland mosaics'], plants:['Spruce, birch, blueberry (acid), willow, fireweed edges'], moves:['Work with wet patterns','Low-input wildlife + wood','Microclimate pockets for food'] }
  };
  const tabs = document.getElementById('eco-tabs');
  Object.keys(packs).forEach((k,i) => {
    const b = document.createElement('button');
    b.textContent = packs[k].name;
    b.type = 'button';
    if (i===0) b.classList.add('active');
    b.onclick = () => { [...tabs.children].forEach(x=>x.classList.remove('active')); b.classList.add('active'); show(k); };
    tabs.appendChild(b);
  });
  function show(k) {
    const p = packs[k];
    document.getElementById('eco-out').innerHTML = \`
      <h2>\${p.name}</h2>
      <div class="callout-grid">
        <div class="callout"><strong>Constraints</strong><p>\${p.constraints.join(' · ')}</p></div>
        <div class="callout"><strong>Water strategies</strong><p>\${p.water.join(' · ')}</p></div>
        <div class="callout"><strong>Plant direction</strong><p>\${p.plants.join(' · ')}</p></div>
      </div>
      <h3>Top design moves</h3>
      <ol>\${p.moves.map(m=>'<li>'+m+'</li>').join('')}</ol>
      <div class="cta-group no-print">
        <a class="btn btn-secondary" href="/resources/tools/plant-finder/?region=\${k==='prairie'?'prairie':k}">Plant finder for region</a>
        <a class="btn btn-secondary" href="/resources/tools/frost-dashboard/">Frost dashboard</a>
      </div>\`;
  }
  show('parkland');
  </script>`
}));

write('resources/dashboards/seasonal-calendar/index.html', page({
  title: 'Alberta Seasonal Field Operations Calendar | Expanding Edge',
  description: 'Interactive month-by-month permaculture field calendar for Alberta: earthworks windows, planting, pruning, mulch, and monitoring.',
  canonical: '/resources/dashboards/seasonal-calendar/',
  eyebrow: 'Dashboard · Operations',
  h1: 'Seasonal Field Operations Calendar',
  lead: 'Check off Alberta-timed tasks. Progress saves in this browser only.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Seasonal calendar`,
  body: `<div class="calendar-grid" id="cal"></div>
    <button type="button" class="btn btn-secondary no-print" id="cal-reset">Reset checks</button>`,
  extraScript: `<script>
  const months = {
    January:['Review design notes & photos','Order bare-root shortlist','Service tools'],
    February:['Prune hardy fruit (mild days)','Map snowdrift patterns','Finalize nursery orders'],
    March:['Late prune if needed','Start seeds indoors','Plan earthworks frost-out'],
    April:['Frost seed perennial beds','Repair swale overflows from melt','Plant bare-root as soil allows'],
    May:['Main tree/shrub plant after frost risk','Mulch new plantings','Stake tomatoes only after local last frost'],
    June:['Weed & water establishment','Photo-monitor stations','Thin fruit if heavy set'],
    July:['Irrigate smart (deep/rare)','Hay/mulch collection','Grazing: peak growth rotations'],
    August:['Order fall bulbs/garlic','Assess failures; mark replacements','Earthworks if dry enough'],
    September:['Plant garlic','Fall bare-root windows open late','Seed cover crops'],
    October:['Mulch & protect trunks','Drain hoses/irrigation','Final photo set for year'],
    November:['Browse protection for trees','Review budget vs actuals','Sketch next year phases'],
    December:['Study course modules','Share surplus seed/knowledge','Rest']
  };
  const key = 'ee-cal-v1';
  let state = JSON.parse(localStorage.getItem(key) || '{}');
  const cal = document.getElementById('cal');
  Object.entries(months).forEach(([m, tasks]) => {
    const div = document.createElement('div');
    div.className = 'calendar-month';
    div.innerHTML = '<h3>'+m+'</h3>' + tasks.map((t,i) => {
      const id = m+'-'+i;
      const checked = state[id] ? 'checked' : '';
      return '<label><input type="checkbox" data-id="'+id+'" '+checked+'> '+t+'</label>';
    }).join('');
    cal.appendChild(div);
  });
  cal.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) {
      state[e.target.dataset.id] = e.target.checked;
      localStorage.setItem(key, JSON.stringify(state));
    }
  });
  document.getElementById('cal-reset').onclick = () => { localStorage.removeItem(key); location.reload(); };
  </script>`
}));

write('resources/dashboards/property-report-lite/index.html', page({
  title: 'Property Report Lite | Expanding Edge Site Design',
  description: 'Guided top design moves for Alberta properties plus launch into the full Expanding Edge map-based site design tool.',
  canonical: '/resources/dashboards/property-report-lite/',
  eyebrow: 'Dashboard · Site analysis',
  h1: 'Property Report Lite',
  lead: 'Answer a few prompts for top regenerative moves, then run the full interactive design tool on your parcel.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Property report lite`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="pr-form">
          <label for="size">Property size</label>
          <select id="size">
            <option value="small">Under 2 acres</option>
            <option value="mid" selected>2–20 acres</option>
            <option value="large">20+ acres</option>
          </select>
          <label for="goal">Primary goal</label>
          <select id="goal">
            <option value="food">Food production</option>
            <option value="water">Water security</option>
            <option value="stock">Livestock integration</option>
            <option value="restore">Restoration / wildlife</option>
          </select>
          <label for="wind">Wind exposure</label>
          <select id="wind">
            <option value="low">Sheltered</option>
            <option value="high" selected>Open / windy</option>
          </select>
          <label for="water">Water observation</label>
          <select id="water">
            <option value="runoff">Fast runoff / dry</option>
            <option value="wet">Wet spots / pooling</option>
            <option value="ok" selected>Mixed / unknown</option>
          </select>
          <button type="submit" class="btn btn-primary">Generate top 5 moves</button>
        </form>
      </div>
      <div class="tool-results" id="pr-out"></div>
    </div>
    <div class="cta-highlight">
      <h2 style="margin-top:0;">Full map analysis</h2>
      <p>Draw your parcel for elevation, placement, and a deeper report.</p>
      <a href="/design/" class="btn btn-primary">Launch Site Design Tool</a>
    </div>
  `,
  extraScript: `<script>
  function calc(e) {
    e && e.preventDefault();
    const size=document.getElementById('size').value;
    const goal=document.getElementById('goal').value;
    const wind=document.getElementById('wind').value;
    const water=document.getElementById('water').value;
    const moves=[];
    moves.push('Walk the land through a weather change; photo-document wet lines and wind flags.');
    if (wind==='high') moves.push('Design windward shelterbelts before high-value fruit.');
    else moves.push('Use existing shelter; densify edges rather than starting from zero.');
    if (water==='runoff') moves.push('Prioritize contour water harvesting and soil organic matter.');
    if (water==='wet') moves.push('Map high-water marks; plant wet guilds and keep fill/dig out of soft zones until designed.');
    if (water==='ok') moves.push('Verify flow with a simple A-frame or laser on long slopes before digging.');
    if (goal==='food') moves.push('Lock Zone 1 within 30 seconds of the kitchen door; expand food forest outward.');
    if (goal==='water') moves.push('Size roof catchment + soil storage before buying a large tank alone.');
    if (goal==='stock') moves.push('Place animals for fertility and forage without destroying young trees — fence first.');
    if (goal==='restore') moves.push('Favor native patches and corridors; measure success in birds and ground cover, not only calories.');
    if (size==='small') moves.push('Stack vertically and in time; avoid oversized earthworks.');
    if (size==='large') moves.push('Phase by watershed units — finish one slope system before starting the next quarter.');
    if (size==='mid') moves.push('Use a 5-year budget builder so year-1 cash goes to water and access.');
    document.getElementById('pr-out').innerHTML = '<h2>Your top moves</h2><ol>'+moves.slice(0,5).map(m=>'<li>'+m+'</li>').join('')+'</ol><p class="tool-disclaimer">Heuristic guidance. Validate with the full design tool and on-site assessment.</p>';
  }
  document.getElementById('pr-form').addEventListener('submit', calc);
  calc();
  </script>`
}));

write('resources/dashboards/wet-areas/index.html', page({
  title: 'Wet-Area & Drainage Awareness Guide | Expanding Edge',
  description: 'Interactive educational checklist for reading wet areas, drainage, and dig-risk zones on Alberta acreages before earthworks.',
  canonical: '/resources/dashboards/wet-areas/',
  eyebrow: 'Dashboard · Water risk',
  h1: 'Wet-Area &amp; Drainage Awareness',
  lead: 'Before you dig: learn to read wetness patterns. This is education — not a surveyor or engineer substitute.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Wet areas`,
  body: `
    <div class="tool-results">
      <h2>Field checklist</h2>
      <form id="wet-form" class="tool-form">
        <label><input type="checkbox" class="wet-c"> I walked the land during/after spring melt</label>
        <label><input type="checkbox" class="wet-c"> I noted where snow disappears first vs last</label>
        <label><input type="checkbox" class="wet-c"> I flagged soft spots that swallow boots</label>
        <label><input type="checkbox" class="wet-c"> I identified culverts, tiles, and neighbour drainage</label>
        <label><input type="checkbox" class="wet-c"> I know septic/well setbacks</label>
        <label><input type="checkbox" class="wet-c"> I have a plan for overflow (not just storage)</label>
        <label><input type="checkbox" class="wet-c"> I will keep heavy equipment off saturated soils</label>
      </form>
      <div id="wet-score" class="result-highlight" style="margin-top:1rem;"></div>
      <h3>Pattern cues</h3>
      <ul>
        <li><strong>Willows, sedges, horsetail:</strong> persistent moisture</li>
        <li><strong>Salt crusts / bare patches:</strong> may indicate discharge or compaction</li>
        <li><strong>Rills after storms:</strong> concentrated flow — candidate for check structures, not random berms</li>
      </ul>
      <p class="tool-disclaimer">Regulated wetlands and water bodies may require approvals. When in doubt, get qualified advice.</p>
      <a class="btn btn-secondary" href="/resources/tools/swale-calculator/">Swale calculator</a>
      <a class="btn btn-secondary" href="/learn/drivers/water-management/">Water management toolbox</a>
    </div>
  `,
  extraScript: `<script>
  function score() {
    const n = document.querySelectorAll('.wet-c:checked').length;
    const t = document.querySelectorAll('.wet-c').length;
    const el = document.getElementById('wet-score');
    if (n < 3) el.textContent = 'Readiness: early — keep observing through seasons before major digs.';
    else if (n < 6) el.textContent = 'Readiness: developing — good start; finish setbacks and overflow thinking.';
    else el.textContent = 'Readiness: strong observation base — ready to brief a designer or staking session.';
  }
  document.getElementById('wet-form').addEventListener('change', score);
  score();
  </script>`
}));

write('resources/dashboards/implementation-metrics/index.html', page({
  title: 'Implementation Metrics Dashboard | Expanding Edge',
  description: 'Public regenerative implementation metrics for Expanding Edge Permaculture — design-build capacity across Alberta and Western Canada.',
  canonical: '/resources/dashboards/implementation-metrics/',
  eyebrow: 'Dashboard · Proof',
  h1: 'Implementation Metrics',
  lead: 'We measure what gets built — not just what gets drawn. Figures are illustrative brand metrics; update as projects complete.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Metrics`,
  body: `
    <div class="metrics-big">
      <div class="metric-tile"><span class="num" data-count="20">0</span><span class="lbl">Resource tools live</span></div>
      <div class="metric-tile"><span class="num" data-count="4">0</span><span class="lbl">Provinces in service vision</span></div>
      <div class="metric-tile"><span class="num" data-count="12">0</span><span class="lbl">Design drivers in toolbox</span></div>
      <div class="metric-tile"><span class="num" data-count="90">0</span><span class="lbl">+ plants in AB finder</span></div>
    </div>
    <div class="callout-grid">
      <div class="callout"><strong>Design → dirt</strong><p>Every major tool routes to implementation consulting and earthworks capacity.</p></div>
      <div class="callout"><strong>Western Canada first</strong><p>Alberta home base; BC, SK, MB growth; remote design Canada-wide.</p></div>
      <div class="callout"><strong>Open resources</strong><p>Free calculators and labs lower the barrier; crews finish the work.</p></div>
    </div>
    <p><a href="/case-studies/" class="link-arrow">Case studies →</a> · <a href="/contact/" class="link-arrow">Partner on a project →</a></p>
  `,
  extraScript: `<script>
  // simple count-up using existing data-count pattern if app.js animateCounters runs; fallback:
  document.querySelectorAll('.metric-tile .num').forEach(el => {
    const t = +el.dataset.count;
    let c = 0;
    const step = Math.max(1, Math.floor(t/30));
    const iv = setInterval(() => { c+=step; if (c>=t){ el.textContent=t; clearInterval(iv);} else el.textContent=c; }, 30);
  });
  </script>`
}));

// ——— Templates ———
write('resources/templates/index.html', page({
  title: 'Field Templates Kit | Expanding Edge Permaculture',
  description: 'Printable and fillable permaculture field templates: observation log, client intake, staking checklist, planting day, year-1 establishment.',
  canonical: '/resources/templates/',
  eyebrow: 'Templates · Field systems',
  h1: 'Field Templates Kit',
  lead: 'Operational paperwork for regenerative projects. Fill on screen or print. Reuse every season.',
  crumbs: `<a href="/">Home</a> / <a href="/resources/">Resources</a> / Templates`,
  body: `
    <p class="no-print"><button type="button" class="btn btn-primary" onclick="window.print()">Print all templates</button></p>
    <div class="template-print" id="t-obs">
      <h3>1. Site observation log</h3>
      <p>Date: <span class="line" contenteditable="true"></span> Site: <span class="line" contenteditable="true"></span></p>
      <p>Weather / wind: <span class="line" contenteditable="true"></span></p>
      <p>Water observations: <span class="line" contenteditable="true"></span></p>
      <p>Wildlife / plants noted: <span class="line" contenteditable="true"></span></p>
      <p>Access / hazards: <span class="line" contenteditable="true"></span></p>
      <p>Photos taken (IDs): <span class="line" contenteditable="true"></span></p>
    </div>
    <div class="template-print" id="t-intake">
      <h3>2. Client / project intake</h3>
      <p>Name: <span class="line" contenteditable="true"></span> Phone: <span class="line" contenteditable="true"></span></p>
      <p>Legal land / address: <span class="line" contenteditable="true"></span></p>
      <p>Acres: <span class="line" contenteditable="true"></span> Goals: <span class="line" contenteditable="true"></span></p>
      <p>Budget phase 1: <span class="line" contenteditable="true"></span> Timeline: <span class="line" contenteditable="true"></span></p>
      <p>Livestock? Water infrastructure? <span class="line" contenteditable="true"></span></p>
    </div>
    <div class="template-print" id="t-stake">
      <h3>3. Staking checklist</h3>
      <label><input type="checkbox"> Survey / boundaries confirmed</label><br>
      <label><input type="checkbox"> Utilities located</label><br>
      <label><input type="checkbox"> Contour reference set</label><br>
      <label><input type="checkbox"> Overflow path marked</label><br>
      <label><input type="checkbox"> Access for machines marked</label><br>
      <label><input type="checkbox"> Client walkthrough complete</label>
    </div>
    <div class="template-print" id="t-plant">
      <h3>4. Planting day run-of-show</h3>
      <p>Crew size: <span class="line" contenteditable="true"></span> Water source: <span class="line" contenteditable="true"></span></p>
      <p>Species list attached? Y/N · Mulch staged? Y/N · Guards staged? Y/N</p>
      <p>AM tasks: <span class="line" contenteditable="true"></span></p>
      <p>PM tasks: <span class="line" contenteditable="true"></span></p>
    </div>
    <div class="template-print" id="t-y1">
      <h3>5. Year-1 establishment checklist</h3>
      <label><input type="checkbox"> Month 1: water deeply at plantings</label><br>
      <label><input type="checkbox"> Month 2–3: weed competition control</label><br>
      <label><input type="checkbox"> Mid-season: photo monitor</label><br>
      <label><input type="checkbox"> Fall: mulch + protect trunks</label><br>
      <label><input type="checkbox"> Winter: browse protection check</label><br>
      <label><input type="checkbox"> Year anniversary: replace failures</label>
    </div>
  `
}));

// ——— Courses ———
write('courses/index.html', page({
  title: 'Permaculture Courses Alberta | Expanding Edge',
  description: 'Cold-climate permaculture courses for Alberta and Western Canada — foundations and water-on-contour paths linked to free tools and labs.',
  canonical: '/courses/',
  eyebrow: 'Courses',
  h1: 'Courses for Cold-Climate Regenerative Design',
  lead: 'Structured paths that end in tools and field skills — not passive video piles. Built for Alberta and Western Canada.',
  crumbs: `<a href="/">Home</a> / Courses`,
  body: `
    <div class="resource-cards">
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live outline</span>
        <h3><a href="/courses/cold-climate-foundations/">Cold-Climate Foundations (Alberta Edition)</a></h3>
        <p>Eight modules from ethics to implementation phasing, each paired with a live tool or lab.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live outline</span>
        <h3><a href="/courses/water-on-contour/">Water on Contour — Map to Machine</a></h3>
        <p>Contours, staking, swales, ponds, overflow, and planting the water system.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/learn/">Design Toolbox (self-paced)</a></h3>
        <p>Ethics, 12 principles, and 10 design drivers — free evergreen curriculum.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/labs/">Labs</a></h3>
        <p>Hands-on exercises: contour analysis, sector mapping, microclimates.</p>
      </article>
    </div>
  `
}));

write('courses/cold-climate-foundations/index.html', page({
  title: 'Cold-Climate Permaculture Foundations Course | Expanding Edge',
  description: 'Alberta edition permaculture foundations course: eight modules with tools for frost, plants, water, zones, soil and implementation.',
  canonical: '/courses/cold-climate-foundations/',
  eyebrow: 'Course · Alberta edition',
  h1: 'Cold-Climate Permaculture Foundations',
  lead: 'A practical path for Western Canada landowners. Complete modules in order — each ends in a resource, not a dead-end quiz.',
  crumbs: `<a href="/">Home</a> / <a href="/courses/">Courses</a> / Foundations`,
  body: `
    <ol class="course-modules">
      <li><h3>Ethics &amp; cold-climate reality</h3><p>Earth Care, People Care, Fair Share in Prairie context. <a href="/learn/ethics/">Toolbox: ethics</a></p></li>
      <li><h3>Observe your seasons</h3><p>Frost, wind, snow, melt. <a href="/resources/tools/frost-dashboard/">Frost dashboard</a> · <a href="/resources/dashboards/seasonal-calendar/">Calendar</a></p></li>
      <li><h3>Water first</h3><p>Catch, store, infiltrate. <a href="/resources/tools/swale-calculator/">Swale calculator</a> · <a href="/courses/water-on-contour/">Water course</a></p></li>
      <li><h3>Soil as infrastructure</h3><p>Organic matter, clay, compaction. <a href="/learn/drivers/soil-fertility/">Soil driver</a></p></li>
      <li><h3>Zones &amp; access</h3><p>Energy-efficient layout. <a href="/resources/tools/zone-planner/">Zone planner</a> · <a href="/design/">Full design tool</a></p></li>
      <li><h3>Plants that survive</h3><p>Hardiness and function. <a href="/resources/tools/plant-finder/">Plant finder</a></p></li>
      <li><h3>Guilds &amp; enterprises</h3><p>Stack yields. <a href="/resources/tools/guild-recipes/">Recipe configurator</a> · <a href="/resources/tools/food-forest-builder/">Food forest builder</a></p></li>
      <li><h3>Phase &amp; implement</h3><p>Budgets and crews. <a href="/resources/tools/budget-builder/">Budget builder</a> · <a href="/contact/">Book implementation</a></p></li>
    </ol>
    <div class="result-highlight">Certificate path (optional future): complete labs + submit a property sketch for Expanding Edge review.</div>
  `
}));

write('courses/water-on-contour/index.html', page({
  title: 'Water on Contour Course | Expanding Edge Alberta',
  description: 'Course: from contour reading to swale staking, ponds, overflow and planting water systems for Alberta and Prairie land.',
  canonical: '/courses/water-on-contour/',
  eyebrow: 'Course · Earthworks',
  h1: 'Water on Contour — Map to Machine',
  lead: 'The implementation course for water harvesting. Map → stake → dig → plant.',
  crumbs: `<a href="/">Home</a> / <a href="/courses/">Courses</a> / Water on contour`,
  body: `
    <ol class="course-modules">
      <li><h3>Read water on the land</h3><p><a href="/resources/dashboards/wet-areas/">Wet-area awareness</a> · <a href="/learn/drivers/water-management/">Water driver</a></p></li>
      <li><h3>Contours &amp; fall</h3><p><a href="/learn/exercises/contour-analysis/">Contour analysis lab</a></p></li>
      <li><h3>Swale spacing &amp; sizing</h3><p><a href="/resources/tools/swale-calculator/">Swale calculator</a> · <a href="/learn/drivers/water-management/swales/">Swales guide</a></p></li>
      <li><h3>Ponds &amp; dugouts</h3><p><a href="/resources/tools/pond-estimator/">Pond estimator</a> · <a href="/learn/drivers/water-management/ponds/">Ponds</a></p></li>
      <li><h3>Roof water &amp; tanks</h3><p><a href="/resources/tools/rainwater-calculator/">Rainwater calculator</a></p></li>
      <li><h3>Overflow, safety, approvals</h3><p>Always design the failure path. When regulated, hire qualified pros.</p></li>
      <li><h3>Plant the water system</h3><p><a href="/resources/tools/plant-finder/?fn=wetland">Wet-edge plants</a> · <a href="/resources/tools/guild-recipes/">Wetland edge recipe</a></p></li>
      <li><h3>Machine day &amp; aftercare</h3><p><a href="/resources/templates/">Staking &amp; year-1 templates</a> · <a href="/contact/">Crew booking</a></p></li>
    </ol>
  `
}));

// ——— Labs ———
write('labs/index.html', page({
  title: 'Permaculture Labs — Read Your Land | Expanding Edge',
  description: 'Interactive permaculture labs for Alberta: contour analysis, sector mapping, microclimate walks and photo monitoring.',
  canonical: '/labs/',
  eyebrow: 'Labs · Hands-on',
  h1: 'Read Your Land — Lab Series',
  lead: 'Short exercises that train observation. Complete them on your acreage or a public natural area.',
  crumbs: `<a href="/">Home</a> / Labs`,
  body: `
    <div class="resource-cards">
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/learn/exercises/contour-analysis/">Contour Map Analysis</a></h3>
        <p>Hands-on contour reading exercise — foundation for water design.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/labs/sector-mapping/">Sector Mapping Lab</a></h3>
        <p>Map sun, wind, fire, dust, noise, and view sectors on a simple diagram.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/labs/microclimate-walk/">Microclimate Walk Lab</a></h3>
        <p>Guided walk prompts to find frost pockets, heat traps, and wind shadows.</p>
      </article>
      <article class="resource-card">
        <span class="resource-status resource-status--live">Live</span>
        <h3><a href="/labs/photo-monitoring/">Photo Monitoring Lab</a></h3>
        <p>Set permanent photo points so your land teaches you over years.</p>
      </article>
    </div>
  `
}));

write('labs/sector-mapping/index.html', page({
  title: 'Sector Mapping Lab | Expanding Edge',
  description: 'Interactive permaculture sector mapping lab: record sun, wind, winter wind, wildfire, dust and view sectors for your property.',
  canonical: '/labs/sector-mapping/',
  eyebrow: 'Lab',
  h1: 'Sector Mapping Lab',
  lead: 'Sectors are wild energies that cross your site. Map them before you place homes, orchards, and animal yards.',
  crumbs: `<a href="/">Home</a> / <a href="/labs/">Labs</a> / Sector mapping`,
  body: `
    <div class="tool-layout">
      <div class="tool-panel">
        <form class="tool-form" id="sec-form">
          <label for="winterWind">Winter wind direction (from)</label>
          <select id="winterWind"><option>NW</option><option>W</option><option>SW</option><option>N</option><option>Other</option></select>
          <label for="summerWind">Summer breeze (from)</label>
          <select id="summerWind"><option>S</option><option>SE</option><option>SW</option><option>W</option><option>Variable</option></select>
          <label for="noise">Noise / road sector?</label>
          <select id="noise"><option value="no">No major</option><option value="yes">Yes</option></select>
          <label for="fire">Wildfire concern?</label>
          <select id="fire"><option value="low">Low</option><option value="mod">Moderate</option><option value="high">High</option></select>
          <label for="view">Views to protect / block</label>
          <input id="view" placeholder="e.g. protect west sunset; block neighbour yard">
          <button class="btn btn-primary" type="submit">Generate sector notes</button>
        </form>
      </div>
      <div class="tool-results" id="sec-out"></div>
    </div>
  `,
  extraScript: `<script>
  document.getElementById('sec-form').onsubmit = e => {
    e.preventDefault();
    const ww=document.getElementById('winterWind').value;
    const sw=document.getElementById('summerWind').value;
    const noise=document.getElementById('noise').value;
    const fire=document.getElementById('fire').value;
    const view=document.getElementById('view').value;
    document.getElementById('sec-out').innerHTML = \`
      <h2>Sector design notes</h2>
      <ul>
        <li><strong>Winter wind from \${ww}:</strong> place dense shelter on that edge; open leeward for sun if possible.</li>
        <li><strong>Summer air from \${sw}:</strong> allow cooling breezes to living areas; avoid blocking with solid walls on that side.</li>
        <li><strong>Noise:</strong> \${noise==='yes'?'Use landform + evergreen belts + distance.':'No major noise sector noted.'}</li>
        <li><strong>Fire:</strong> \${fire} — maintain defensible space, avoid resinous species against structures if high risk.</li>
        <li><strong>Views:</strong> \${view||'Not specified — walk and mark on paper map.'}</li>
      </ul>
      <p><a href="/resources/tools/shelterbelt-designer/">Continue in shelterbelt designer →</a></p>\`;
  };
  </script>`
}));

write('labs/microclimate-walk/index.html', page({
  title: 'Microclimate Walk Lab | Expanding Edge',
  description: 'Guided microclimate observation lab for Alberta properties: frost pockets, heat traps, wind shadows and sun pockets.',
  canonical: '/labs/microclimate-walk/',
  eyebrow: 'Lab',
  h1: 'Microclimate Walk Lab',
  lead: 'Print or take your phone. Walk slowly. Check boxes when observed. Your best plantings follow these notes.',
  crumbs: `<a href="/">Home</a> / <a href="/labs/">Labs</a> / Microclimate walk`,
  body: `
    <div class="tool-results">
      <form class="tool-form" id="mc-form">
        <label><input type="checkbox"> South-facing wall or fence that is warm on clear days</label>
        <label><input type="checkbox"> Low spot where frost lingers after sunrise</label>
        <label><input type="checkbox"> Wind shadow behind buildings or trees</label>
        <label><input type="checkbox"> Exposed ridge that is always windier</label>
        <label><input type="checkbox"> Dark mulch / rock that stores heat</label>
        <label><input type="checkbox"> Cold air drainage path toward a low boundary</label>
        <label><input type="checkbox"> Reflective snow area that intensifies winter sun</label>
      </form>
      <div id="mc-out" class="result-highlight" style="margin-top:1rem;"></div>
      <p class="tool-disclaimer">Ideal orchard sites: good air drainage (not frost pocket), wind protection, full sun, accessible water.</p>
    </div>
  `,
  extraScript: `<script>
  function up() {
    const n = document.querySelectorAll('#mc-form input:checked').length;
    document.getElementById('mc-out').textContent = n + ' microclimate features logged. Sketch them on your base map, then place Zone 1 crops in the kindest pockets.';
  }
  document.getElementById('mc-form').onchange = up; up();
  </script>`
}));

write('labs/photo-monitoring/index.html', page({
  title: 'Photo Monitoring Lab | Expanding Edge',
  description: 'Set up permanent photo monitoring points for regenerative land projects — a simple lab for multi-year feedback.',
  canonical: '/labs/photo-monitoring/',
  eyebrow: 'Lab',
  h1: 'Photo Monitoring Lab',
  lead: 'Land speaks slowly. Fixed photo points turn years into feedback you can trust.',
  crumbs: `<a href="/">Home</a> / <a href="/labs/">Labs</a> / Photo monitoring`,
  body: `
    <div class="tool-results">
      <h2>Protocol</h2>
      <ol>
        <li>Choose 4–8 points: entrance, main water line, orchard, wetland edge, shelterbelt, failure risk zone.</li>
        <li>Mark each with a durable stake and GPS pin or measured distance from a fixed object.</li>
        <li>Photo facing the same compass bearing each time (note it).</li>
        <li>Shoot spring melt, mid-summer, and after leaf fall at minimum.</li>
        <li>Store in a folder: <code>YYYY-MM-DD_point-ID.jpg</code></li>
      </ol>
      <form class="tool-form">
        <label for="points">Your point list (saved locally)</label>
        <textarea id="points" rows="5" placeholder="P1 entrance facing west&#10;P2 swale mid-slope facing north"></textarea>
        <button type="button" class="btn btn-primary" id="save-pts">Save list in browser</button>
      </form>
      <p class="tool-disclaimer">Local save only — export by copy-paste if you change devices.</p>
    </div>
  `,
  extraScript: `<script>
  const ta = document.getElementById('points');
  ta.value = localStorage.getItem('ee-photo-pts') || '';
  document.getElementById('save-pts').onclick = () => {
    localStorage.setItem('ee-photo-pts', ta.value);
    alert('Saved in this browser.');
  };
  </script>`
}));

console.log('All resource pages generated.');
