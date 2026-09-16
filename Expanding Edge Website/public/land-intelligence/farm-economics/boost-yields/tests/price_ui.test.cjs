/* Integration test for prices.js against the real generated data.
 *
 * Run: node tests/price_ui.test.js
 *
 * Loads index.html in jsdom, serves data/price-observations/*.json from disk over a
 * stubbed fetch, executes prices.js, and asserts the rendered DOM. This is what
 * catches a wrong field name or a bad data path, which a syntax check cannot.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const DATA = path.join(root, 'data', 'price-observations');

let failures = 0;
function ok(label, cond, extra) {
  if (cond) {
    console.log('  PASS  ' + label);
  } else {
    failures++;
    console.log('  FAIL  ' + label + (extra ? '  → ' + extra : ''));
  }
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { failures++; console.log('  FAIL  jsdom error: ' + e.message); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  virtualConsole: vc,
  url: 'http://localhost/farm-economics/boost-yields/'
});
const { window } = dom;
const doc = window.document;

// Serve the price-observations files from disk, like the static server would.
const fetched = [];
window.fetch = function (url) {
  const rel = String(url).replace(/^.*price-observations\//, '');
  fetched.push(rel);
  const file = path.join(DATA, rel);
  return new Promise((resolve) => {
    if (!fs.existsSync(file)) {
      resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      return;
    }
    resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8')))
    });
  });
};

// Execute the module under test after the DOM and fetch stub exist.
const code = fs.readFileSync(path.join(root, 'prices.js'), 'utf8');
window.eval(code);

// Report anything the module logs or throws, so a silent failure is visible.
vc.on('error', (m) => console.log('  [console.error] ' + m));
window.addEventListener('error', (e) => console.log('  [window error] ' + e.message));

// Poll until the table has rows instead of guessing a fixed delay, then assert.
const deadline = Date.now() + 60000;
(function waitForRows() {
  const n = doc.getElementById('price-body').querySelectorAll('tr').length;
  const settled = doc.getElementById('price-status').textContent;
  if (n > 0 || /fail/i.test(settled) || Date.now() > deadline) {
    finish(n);
  } else {
    setTimeout(waitForRows, 200);
  }
})();

function finish(rowCount) {
  console.log('\n== price layer wiring ==');
  console.log('  (rows at assertion time: ' + rowCount + ', fetched: ' + fetched.join(', ') + ')');

  ok('section exists in index.html', !!doc.getElementById('prices'));
  ok('prices.js is referenced by index.html', /prices\.js/.test(html));
  ok('nav links to #prices', /href="#prices"/.test(html));
  ok('manifest was fetched', fetched.includes('sources.json'), fetched.join(', '));

  // --- summary tiles (locale-formatted, not raw integers) ---
  const tiles = doc.getElementById('price-tiles').textContent;
  ok('tiles show 16,615 observations', /16,615/.test(tiles), tiles);
  ok('tiles show 13,549 quarantined', /13,549/.test(tiles), tiles);

  // --- tabs: one per usable price type, citation-only types excluded ---
  const tabs = [...doc.querySelectorAll('.price-tab')];
  const names = tabs.map((t) => t.dataset.type);
  ok('tabs rendered', tabs.length > 0, String(tabs.length));
  ok('one tab per values_included price type', names.length === 8, names.join(', '));
  ok('commercial_bid_reference_link excluded', !names.includes('commercial_bid_reference_link'));
  ok('average_farm_price present', names.includes('average_farm_price'));
  ok('a tab is selected by default', tabs.some((t) => t.getAttribute('aria-selected') === 'true'));

  // Empty price types must be labelled, not silently blank.
  const emptyTabs = tabs.filter((t) => t.dataset.empty === 'true');
  ok('empty price types are marked', emptyTabs.length === 4, String(emptyTabs.length));
  ok('empty tabs say so', /none in this release/.test(doc.getElementById('price-tabs').textContent));
  ok('populated tabs carry counts', /16,032/.test(doc.getElementById('price-tabs').textContent),
     doc.getElementById('price-tabs').textContent.slice(0, 200));

  // --- legend reflects the registry definition of the selected type ---
  const legend = doc.getElementById('price-legend').textContent;
  ok('legend shows a definition', legend.length > 40, legend.slice(0, 80));

  // --- observations table ---
  const body = doc.getElementById('price-body');
  const rows = body.querySelectorAll('tr');
  ok('observation rows rendered', rows.length > 0, String(rows.length));
  ok('table capped at 300 rows', rows.length <= 300, String(rows.length));

  const count = doc.getElementById('price-count').textContent;
  ok('row count is reported', /observation/.test(count), count);

  // The default tab must be one that actually has rows, never an empty type.
  const selected = (tabs.find((t) => t.getAttribute('aria-selected') === 'true') || {}).dataset;
  ok('default tab has data', selected && selected.empty !== 'true', JSON.stringify(selected));
  ok('default tab is average_farm_price', selected && selected.type === 'average_farm_price',
     selected && selected.type);

  const firstRow = rows[0] && rows[0].textContent;
  ok('a row has commodity and date text', !!(firstRow && firstRow.trim().length > 10), firstRow);

  // --- quarantine table: reasons are surfaced, not hidden ---
  const quar = doc.getElementById('quarantine-body').textContent;
  ok('quarantine rows rendered', quar.length > 20, quar.slice(0, 80));
  ok('quarantine count reported', /13,549/.test(doc.getElementById('quarantine-count').textContent),
     doc.getElementById('quarantine-count').textContent);
  ok('a quarantine reason is named', /bushel|unit|mass|basis/i.test(quar), quar.slice(0, 120));

  // --- sources table with hashes ---
  const srcs = doc.getElementById('price-sources').querySelectorAll('tr');
  ok('source rows rendered', srcs.length === 10, String(srcs.length));
  ok('sources show a truncated sha256', /[0-9a-f]{12}…/.test(doc.getElementById('price-sources').textContent));
  ok('all sources report parsed', /parsed/.test(doc.getElementById('price-sources').textContent));

  console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'all assertions passed'));
  // jsdom keeps timers alive; exit explicitly so the run terminates.
  dom.window.close();
  process.exit(failures ? 1 : 0);
}
