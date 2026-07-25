/**
 * Expanding Edge embed UI — value-first recommendations for iframe /embed.
 */
const VALUE_LABELS = {
  water_storage: 'Water storage',
  water_harvest: 'Water harvest',
  erosion_control: 'Erosion control',
  wind_protection: 'Wind protection',
  snow_management: 'Snow management',
  microclimate: 'Microclimate',
  shade: 'Shade',
  food_production: 'Food',
  medicinal: 'Medicinal / herbal',
  soil_building: 'Soil building',
  nitrogen_fixing: 'Nitrogen fixing',
  biodiversity: 'Habitat / biodiversity',
  beauty_access: 'Beauty & access',
  compliance_safety: 'Compliance & risk',
};

const state = {
  data: null,
  valueFilter: 'all',
  plantFilter: 'all',
};

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

async function main() {
  // Prefill from query string
  const q = new URLSearchParams(location.search);
  if (q.get('preset')) $('preset_id').dataset.prefer = q.get('preset');
  if (q.get('ha')) $('footprint_ha').value = q.get('ha');
  if (q.get('slope')) $('slope_percent').value = q.get('slope');

  try {
    const tax = await fetch('/api/v1/taxonomy').then((r) => r.json());
    const sel = $('preset_id');
    sel.innerHTML = (tax.presets || [])
      .map(
        (p) =>
          `<option value="${esc(p.id)}">${esc(p.label)}${
            p.plant_hardiness_zone ? ` · z${esc(p.plant_hardiness_zone)}` : ''
          }</option>`
      )
      .join('');
    const prefer = sel.dataset.prefer || q.get('preset') || 'sturgeon';
    if ([...sel.options].some((o) => o.value === prefer)) sel.value = prefer;
  } catch (e) {
    showStatus('Could not load region presets.', true);
  }

  $('ee-form').addEventListener('submit', onSubmit);

  // Auto-run once if ?autorun=1
  if (q.get('autorun') === '1') {
    onSubmit(new Event('submit'));
  }
}

async function onSubmit(ev) {
  ev.preventDefault();
  const btn = $('ee-run');
  btn.disabled = true;
  showStatus('Building recommendations…');
  $('ee-results').hidden = true;

  const body = {
    preset_id: $('preset_id').value,
    footprint_ha: Number($('footprint_ha').value) || 1,
    terrain: { slope_percent: Number($('slope_percent').value) || 5 },
    existing_vegetation: {
      successional_stage: $('successional_stage').value,
      cover_type: 'tame_pasture',
    },
    include_plants: $('include_plants').checked,
    plant_limit: 8,
  };

  try {
    const res = await fetch('/api/v1/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    state.data = data;
    state.valueFilter = 'all';
    state.plantFilter = 'all';
    renderResults(data);
    showStatus('');
    // Notify parent page (expandingedge.ca widget)
    try {
      parent.postMessage(
        { type: 'ee-recommendations', summary: data.summary_sentence, count: data.design_elements?.length },
        '*'
      );
    } catch { /* ignore */ }
  } catch (e) {
    showStatus(e.message || 'Request failed', true);
  } finally {
    btn.disabled = false;
  }
}

function showStatus(msg, isError) {
  const el = $('ee-status');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle('is-error', !!isError);
}

function renderResults(data) {
  const host = $('ee-results');
  host.hidden = false;
  if (data.full_tool_url) {
    $('ee-full-tool').href = data.full_tool_url;
  }

  const els = data.design_elements || [];
  const counts = data.recommendations?.value_counts || [];
  const services = data.recommendations?.related_services || [];
  const plants = data.planting?.recommended || [];
  const plantCounts = data.planting?.value_counts || [];

  host.innerHTML = `
    <p class="ee-summary">${esc(data.summary_sentence || '')}</p>
    <div class="ee-section-title">Site design · filter by value</div>
    ${filterBar(counts, els.length, 'design')}
    <div class="ee-cards" id="ee-design-cards">
      ${renderDesignCards(els, state.valueFilter)}
    </div>
    ${
      plants.length
        ? `
      <div class="ee-section-title">Plants · same value tags</div>
      ${filterBar(plantCounts, plants.length, 'plant')}
      <div class="ee-cards" id="ee-plant-cards">
        ${renderPlantCards(plants, state.plantFilter)}
      </div>`
        : ''
    }
    ${
      services.length
        ? `
      <div class="ee-section-title">Expanding Edge services</div>
      <div class="ee-services">
        ${services
          .slice(0, 3)
          .map(
            (s) => `
          <div class="ee-svc">
            <strong>${esc(s.label)}</strong>
            ${s.blurb ? `<span style="font-size:0.82rem;color:var(--ink-soft)">${esc(s.blurb)}</span>` : ''}
            <a href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.cta || 'Learn more')} →</a>
          </div>`
          )
          .join('')}
      </div>`
        : ''
    }
  `;

  host.querySelectorAll('[data-filter-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-filter-kind');
      const id = btn.getAttribute('data-filter') || 'all';
      if (kind === 'design') {
        state.valueFilter = id;
        host.querySelectorAll('[data-filter-kind="design"]').forEach((b) => {
          b.classList.toggle('is-active', b.getAttribute('data-filter') === id);
        });
        const box = $('ee-design-cards');
        if (box) box.innerHTML = renderDesignCards(els, id);
      } else {
        state.plantFilter = id;
        host.querySelectorAll('[data-filter-kind="plant"]').forEach((b) => {
          b.classList.toggle('is-active', b.getAttribute('data-filter') === id);
        });
        const box = $('ee-plant-cards');
        if (box) box.innerHTML = renderPlantCards(plants, id);
      }
    });
  });
}

function filterBar(counts, total, kind) {
  const active = kind === 'design' ? state.valueFilter : state.plantFilter;
  const chips = [
    `<button type="button" class="ee-filter${
      active === 'all' ? ' is-active' : ''
    }" data-filter-kind="${kind}" data-filter="all">All ${total}</button>`,
    ...(counts || []).map(
      (c) =>
        `<button type="button" class="ee-filter${
          active === c.id ? ' is-active' : ''
        }" data-filter-kind="${kind}" data-filter="${esc(c.id)}">${esc(
          c.label
        )} ${c.count}</button>`
    ),
  ];
  return `<div class="ee-filters">${chips.join('')}</div>`;
}

function matchValue(item, filter) {
  if (!filter || filter === 'all') return true;
  return (
    item.primary_value === filter ||
    (item.secondary_values || []).includes(filter)
  );
}

function renderDesignCards(els, filter) {
  const list = els.filter((e) => matchValue(e, filter));
  if (!list.length) {
    return '<p style="font-size:0.88rem;color:var(--ink-soft)">No design items in this filter.</p>';
  }
  return list
    .map((e) => {
      const plab = VALUE_LABELS[e.primary_value] || e.primary_value;
      const sec = (e.secondary_values || [])
        .map((v) => VALUE_LABELS[v] || v)
        .slice(0, 2);
      return `
      <article class="ee-card" data-value="${esc(e.primary_value || '')}">
        <div class="ee-chips">
          <span class="ee-chip primary">${esc(plab)}</span>
          ${sec.map((s) => `<span class="ee-chip">${esc(s)}</span>`).join('')}
        </div>
        <h3>${esc(e.value_headline || e.technique_label)}</h3>
        <p class="how"><strong>${esc(e.technique_label || e.element_type)}</strong>
          ${e.zone != null ? ` · Zone ${esc(e.zone)}` : ''}
          ${e.effort ? ` · ${esc(e.effort)} effort` : ''}</p>
      </article>`;
    })
    .join('');
}

function renderPlantCards(plants, filter) {
  const list = plants.filter((p) => matchValue(p, filter));
  if (!list.length) {
    return '<p style="font-size:0.88rem;color:var(--ink-soft)">No plants in this filter.</p>';
  }
  return list
    .map((p) => {
      const plab = VALUE_LABELS[p.primary_value] || p.primary_value;
      return `
      <article class="ee-card" data-value="${esc(p.primary_value || '')}">
        <div class="ee-chips">
          <span class="ee-chip primary">${esc(plab)}</span>
          <span class="ee-chip">${esc(p.suitability)} · ${esc(p.score)}</span>
        </div>
        <h3>${esc(p.common_name)}</h3>
        <p class="how">${esc(p.value_headline || p.scientific_name || '')}</p>
      </article>`;
    })
    .join('');
}

main();
