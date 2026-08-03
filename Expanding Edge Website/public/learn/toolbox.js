// Design Toolbox — Interactive JavaScript for Learning Pages
// Loads toolbox-data.json and renders content based on data-page attribute

(function() {
  'use strict';

  let DATA = null;

  // ---------- Helpers ----------

  function getPageType() {
    const main = document.querySelector('main');
    return main ? main.getAttribute('data-page') : '';
  }

  function slugFromPath() {
    const path = window.location.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    // e.g. /learn/principles/observe-and-interact → path = ['learn', 'principles', 'observe-and-interact']
    return path;
  }

  function lookupPrinciple(id) {
    return (DATA && DATA.principles) ? DATA.principles.find(p => p.id === id) : null;
  }

  function lookupDriver(id) {
    return (DATA && DATA.drivers) ? DATA.drivers.find(d => d.id === id) : null;
  }

  function lookupTool(id) {
    return (DATA && DATA.tools) ? DATA.tools.find(t => t.id === id) : null;
  }

  function findSubtopic(driver, slug) {
    if (!driver || !driver.children) return null;
    for (const child of driver.children) {
      if (child.children) {
        for (const sub of child.children) {
          if (sub.slug === slug) return sub;
        }
      }
    }
    return null;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- Breadcrumbs ----------

  function renderBreadcrumbs(items) {
    const container = document.getElementById('breadcrumbs');
    if (!container) return;
    const ol = document.createElement('ol');
    ol.className = 'breadcrumbs';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      if (item.url && i < items.length - 1) {
        const a = document.createElement('a');
        a.href = item.url;
        a.textContent = item.label;
        li.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.className = 'current';
        span.textContent = item.label;
        li.appendChild(span);
      }
      if (i < items.length - 1) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '/';
        sep.setAttribute('aria-hidden', 'true');
        li.appendChild(sep);
      }
      ol.appendChild(li);
    });
    container.appendChild(ol);
  }

  // ---------- Sidebar ----------

  function renderSidebar(currentUrl) {
    const sidebar = document.getElementById('toolbox-sidebar');
    if (!sidebar) return;

    const sections = [
      { label: 'Design Toolbox', items: [
        { label: 'Start Here', url: '/learn/' },
        { label: 'Ethics', url: '/learn/ethics/' },
        { label: '12 Principles', url: '/learn/principles/' },
        { label: 'Major Drivers', url: '/learn/drivers/' },
        { label: 'Tools', url: '/learn/tools/' }
      ]},
      { label: 'Major Drivers', items: (DATA && DATA.drivers) ? DATA.drivers.map(d => ({
        label: d.icon + ' ' + d.name,
        url: '/learn/drivers/' + d.id + '/'
      })) : []}
    ];

    sections.forEach(sec => {
      const h3 = document.createElement('h3');
      h3.textContent = sec.label;
      sidebar.appendChild(h3);

      const ul = document.createElement('ul');
      sec.items.forEach(item => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = item.url;
        a.innerHTML = item.label;
        if (item.url === currentUrl || currentUrl.startsWith(item.url) && item.url !== '/learn/') {
          a.classList.add('active');
        }
        li.appendChild(a);
        ul.appendChild(li);
      });
      sidebar.appendChild(ul);
    });

    // CTA
    const cta = document.createElement('div');
    cta.style.cssText = 'margin-top:2rem;padding:1rem;background:var(--ground);border-radius:6px;';
    cta.innerHTML = '<p style="font-size:0.85rem;margin:0 0 0.75rem;color:var(--ink-soft);">Ready to apply these principles to your land?</p>';
    const btn = document.createElement('a');
    btn.href = '/design/';
    btn.className = 'btn btn-primary';
    btn.style.cssText = 'display:block;font-size:0.85rem;';
    btn.textContent = 'Start Site Design →';
    cta.appendChild(btn);
    sidebar.appendChild(cta);
  }

  // ---------- CTA Block ----------

  function renderCTABlock(container) {
    if (!container) return;
    container.innerHTML = `
      <h2>Ready to Apply This to Your Land?</h2>
      <p>From theory to practice — our team brings permaculture principles to life on Alberta acreages, farms, and homesteads.</p>
      <div class="cta-group">
        <a href="/design/" class="btn btn-primary">Start Your Site Design</a>
        <a href="/contact/" class="btn btn-secondary">Book a Consultation</a>
      </div>
    `;
  }

  // ---------- Page: Landing ----------

  function renderLanding() {
    const main = document.querySelector('main');
    if (!main) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn' }
    ]);
    renderSidebar('/learn/');

    main.innerHTML += `
      <section class="toolbox-hero">
        <h1>Permaculture Design Toolbox — Start Here</h1>
        <p class="lead">A free, learner-friendly guide to permaculture ethics, principles, and design drivers. Whether you're new to permaculture or deepening your practice, start at the beginning or jump to any section that sparks your curiosity.</p>
      </section>
      <div class="toolbox-entry-grid">
        <a href="/learn/ethics/" class="toolbox-entry-card">
          <span class="entry-icon">🌍🤝⚖️</span>
          <h3>Ethics</h3>
          <p>The three core ethics — Earth Care, People Care, and Fair Share — that guide all permaculture design.</p>
        </a>
        <a href="/learn/principles/" class="toolbox-entry-card">
          <span class="entry-icon">👁️🔋🌾</span>
          <h3>12 Design Principles</h3>
          <p>David Holmgren's twelve principles — the thinking tools that turn ethics into action on the ground.</p>
        </a>
        <a href="/learn/drivers/" class="toolbox-entry-card">
          <span class="entry-icon">💧⛰️☀️</span>
          <h3>Major Drivers of Site Design</h3>
          <p>The big-picture factors — water, landform, climate, access — that determine where everything goes.</p>
        </a>
        <a href="/learn/tools/" class="toolbox-entry-card">
          <span class="entry-icon">🧭📐🔑</span>
          <h3>Design Tools</h3>
          <p>Practical tools and frameworks for observation, analysis, and design — from A-frames to zone mapping.</p>
        </a>
        <a href="/design/" class="toolbox-entry-card">
          <span class="entry-icon">🗺️</span>
          <h3>See It In Action</h3>
          <p>Explore how these principles translate to real designs — try our interactive site design tool.</p>
        </a>
        <a href="/contact/" class="toolbox-entry-card">
          <span class="entry-icon">📋</span>
          <h3>Book a Site Assessment</h3>
          <p>Work with us one-on-one to apply permaculture design to your Alberta property.</p>
        </a>
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Ethics ----------

  function renderEthics() {
    const main = document.querySelector('main');
    if (!main || !DATA || !DATA.ethics) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Ethics' }
    ]);
    renderSidebar('/learn/ethics/');

    let html = `
      <section class="toolbox-page-header">
        <h1>Permaculture Ethics</h1>
        <p class="lead">The three core ethics that guide every permaculture design — a compass for regenerative living.</p>
      </section>
      <div class="ethics-grid">
    `;

    DATA.ethics.forEach(ethic => {
      html += `
        <article class="ethic-card" id="${ethic.id}">
          <span class="ethic-icon">${ethic.icon}</span>
          <h2>${escapeHTML(ethic.name)}</h2>
          <p class="ethic-short">${escapeHTML(ethic.short)}</p>
          <p class="ethic-description">${escapeHTML(ethic.description)}</p>
          <div class="ethic-why">
            <strong>Why It Matters</strong>
            <p>${escapeHTML(ethic.why)}</p>
          </div>
          <div class="ethic-example">
            <strong>Alberta Example</strong>
            <p>${escapeHTML(ethic.example)}</p>
          </div>
          <div class="related-panel">
            <h3>Related Principles</h3>
            <ul>
              ${ethic.relatedPrinciples.map(id => {
                const p = lookupPrinciple(id);
                return p ? `<li><a href="/learn/principles/${id}/">${escapeHTML(p.name)}</a></li>` : '';
              }).join('')}
            </ul>
          </div>
        </article>
      `;
    });

    html += `
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Principles Grid ----------

  function renderPrinciplesGrid() {
    const main = document.querySelector('main');
    if (!main || !DATA || !DATA.principles) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Principles' }
    ]);
    renderSidebar('/learn/principles/');

    let html = `
      <section class="toolbox-page-header">
        <h1>12 Permaculture Design Principles</h1>
        <p class="lead">David Holmgren's twelve design principles — the thinking tools that translate ethics into regenerative action. Click any card to explore the full detail.</p>
      </section>
      <div class="principles-grid">
    `;

    DATA.principles.forEach((p, i) => {
      html += `
        <a href="/learn/principles/${p.id}/" class="principle-card">
          <span class="principle-number">${i + 1}/12</span>
          <span class="principle-icon">${p.icon}</span>
          <h3>${escapeHTML(p.name)}</h3>
          <p>${escapeHTML(p.short)}</p>
        </a>
      `;
    });

    html += `
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Principle Detail ----------

  function renderPrincipleDetail() {
    const main = document.querySelector('main');
    if (!main || !DATA) return;

    const slug = slugFromPath().pop();
    const principle = lookupPrinciple(slug);
    if (!principle) {
      main.innerHTML += '<div class="principle-detail-page"><h1>Principle not found</h1><p><a href="/learn/principles/">← Back to principles</a></p></div>';
      return;
    }

    const idx = DATA.principles.indexOf(principle) + 1;
    const prev = idx > 1 ? DATA.principles[idx - 2] : null;
    const next = idx < 12 ? DATA.principles[idx] : null;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Principles', url: '/learn/principles/' },
      { label: principle.name }
    ]);
    renderSidebar('/learn/principles/');

    let html = `
      <section class="toolbox-page-header">
        <h1><span style="font-size:2.5rem;display:block;margin-bottom:0.5rem;">${principle.icon}</span>${escapeHTML(principle.name)}</h1>
        <p class="lead">${escapeHTML(principle.short)}</p>
      </section>
      <div class="principle-detail-page">
        <div class="principle-meta">
          <span>Principle ${idx} of 12</span>
          ${prev ? `<a href="/learn/principles/${prev.id}/" style="color:var(--berry);text-decoration:none;">← ${escapeHTML(prev.name)}</a>` : ''}
          ${next ? `<a href="/learn/principles/${next.id}/" style="color:var(--berry);text-decoration:none;margin-left:auto;">${escapeHTML(next.name)} →</a>` : ''}
        </div>

        <div class="detail-why">
          <h2>Why It Matters</h2>
          <p>${escapeHTML(principle.why)}</p>
        </div>

        <div class="detail-how">
          <h2>How It Shapes Design</h2>
          <p>${escapeHTML(principle.howItShapesDesign)}</p>
        </div>

        <div class="detail-example">
          <h2>Real-World Example</h2>
          <p>${escapeHTML(principle.example)}</p>
        </div>
    `;

    // Related tools
    if (principle.relatedTools && principle.relatedTools.length) {
      html += `<div class="related-panel">
        <h3>Design Tools</h3>
        <ul>`;
      principle.relatedTools.forEach(tid => {
        const tool = lookupTool(tid);
        html += tool ? `<li><a href="/learn/tools/#${tid}">${escapeHTML(tool.name)}</a></li>` : '';
      });
      html += `</ul></div>`;
    }

    // Related drivers
    if (principle.relatedDrivers && principle.relatedDrivers.length) {
      html += `<div class="related-panel">
        <h3>Related Design Drivers</h3>
        <ul>`;
      principle.relatedDrivers.forEach(did => {
        const driver = lookupDriver(did);
        html += driver ? `<li><a href="/learn/drivers/${did}/">${escapeHTML(driver.icon)} ${escapeHTML(driver.name)}</a></li>` : '';
      });
      html += `</ul></div>`;
    }

    html += `
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Drivers Overview ----------

  function renderDriversOverview() {
    const main = document.querySelector('main');
    if (!main || !DATA || !DATA.drivers) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Drivers' }
    ]);
    renderSidebar('/learn/drivers/');

    let html = `
      <section class="toolbox-page-header">
        <h1>Major Drivers of Site Design</h1>
        <p class="lead">The big-picture factors — organized by the Scale of Permanence — that determine where everything goes on your property. Start with the hardest-to-change elements and work toward the easier ones.</p>
      </section>
      <div class="drivers-grid">
    `;

    DATA.drivers.forEach(driver => {
      html += `
        <a href="/learn/drivers/${driver.id}/" class="driver-card">
          <span class="driver-icon">${driver.icon}</span>
          <h3>${escapeHTML(driver.name)}</h3>
          <p>${escapeHTML(driver.short)}</p>
        </a>
      `;
    });

    html += `
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Driver Detail ----------

  function renderDriverDetail() {
    const main = document.querySelector('main');
    if (!main || !DATA) return;

    const slugs = slugFromPath();
    // e.g. /learn/drivers/water-management → ['learn', 'drivers', 'water-management']
    const driverId = slugs.length >= 3 ? slugs[2] : null;
    const subtopicSlug = slugs.length >= 4 ? slugs[3] : null;

    const driver = lookupDriver(driverId);
    if (!driver) {
      main.innerHTML += '<div class="driver-detail-page"><h1>Driver not found</h1><p><a href="/learn/drivers/">← Back to drivers</a></p></div>';
      return;
    }

    // If we have a subtopic slug, render subtopic detail
    if (subtopicSlug) {
      const subtopic = findSubtopic(driver, subtopicSlug);
      if (!subtopic) {
        main.innerHTML += `<div class="subtopic-detail"><h1>Topic not found</h1><p><a href="/learn/drivers/${driverId}/">← Back to ${escapeHTML(driver.name)}</a></p></div>`;
        return;
      }
      return renderSubtopicDetail(driver, subtopic);
    }

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Drivers', url: '/learn/drivers/' },
      { label: driver.name }
    ]);
    renderSidebar('/learn/drivers/');

    let html = `
      <section class="toolbox-page-header">
        <h1><span style="font-size:2.5rem;display:block;margin-bottom:0.5rem;">${driver.icon}</span>${escapeHTML(driver.name)}</h1>
      </section>
      <div class="driver-detail-page">
        <p class="driver-description">${escapeHTML(driver.description)}</p>
        <div class="driver-why">
          <h3 style="margin-top:0;">Why It Matters in Alberta</h3>
          <p>${escapeHTML(driver.whyItMatters || driver.whyItMatters || '')}</p>
        </div>
    `;

    // Related principles
    if (driver.relatedPrinciples && driver.relatedPrinciples.length) {
      html += `<div class="related-panel">
        <h3>Related Principles</h3>
        <ul>`;
      driver.relatedPrinciples.forEach(pid => {
        const p = lookupPrinciple(pid);
        html += p ? `<li><a href="/learn/principles/${pid}/">${escapeHTML(p.name)}</a></li>` : '';
      });
      html += `</ul></div>`;
    }

    // Hierarchy accordion
    if (driver.children && driver.children.length) {
      html += `<div class="hierarchy-tree">`;
      html += `<h2>Topics</h2>`;
      driver.children.forEach((child, i) => {
        const hasSubChildren = child.children && child.children.length > 0;
        html += `<div class="hierarchy-level">
          <button class="hierarchy-toggle" aria-expanded="false" data-level="${i}">
            <span class="toggle-icon">${i === 0 ? '💧' : i === 1 ? '🪣' : '🚿'}</span>
            ${escapeHTML(child.name)}
            <span class="toggle-arrow">▼</span>
          </button>
          <ul class="hierarchy-children" id="hc-${i}">`;

        if (hasSubChildren) {
          child.children.forEach(sub => {
            if (sub.slug) {
              html += `<li class="hierarchy-child">
                <a href="/learn/drivers/${driver.id}/${sub.slug}/">${escapeHTML(sub.name)}</a>
              </li>`;
            } else {
              html += `<li class="hierarchy-child">
                <span>${escapeHTML(sub.name)}</span>
              </li>`;
            }
          });
        } else {
          html += `<li class="hierarchy-child">
            <span style="color:var(--ink-soft);font-style:italic;">Coming soon</span>
          </li>`;
        }

        html += `</ul></div>`;
      });
      html += `</div>`;
    }

    html += `
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;

    // Attach accordion behavior
    main.querySelectorAll('.hierarchy-toggle').forEach(btn => {
      btn.addEventListener('click', function() {
        const expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        const targetId = 'hc-' + this.getAttribute('data-level');
        const children = document.getElementById(targetId);
        if (children) {
          children.classList.toggle('open');
        }
      });
    });

    // Open first level by default
    const firstToggle = main.querySelector('.hierarchy-toggle');
    if (firstToggle) {
      firstToggle.setAttribute('aria-expanded', 'true');
      const firstChildren = document.getElementById('hc-0');
      if (firstChildren) firstChildren.classList.add('open');
    }

    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Subtopic Detail ----------

  function renderSubtopicDetail(driver, subtopic) {
    const main = document.querySelector('main');
    if (!main) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Drivers', url: '/learn/drivers/' },
      { label: driver.name, url: '/learn/drivers/' + driver.id + '/' },
      { label: subtopic.name }
    ]);
    renderSidebar('/learn/drivers/');

    let html = `
      <section class="toolbox-page-header">
        <h1>${escapeHTML(subtopic.name)}</h1>
      </section>
      <div class="subtopic-detail">
        <p class="subtopic-description">${escapeHTML(subtopic.description)}</p>
        ${subtopic.whyItMattersHere ? `<div class="subtopic-why">
          <h3 style="margin-top:0;">Why It Matters in Alberta</h3>
          <p>${escapeHTML(subtopic.whyItMattersHere)}</p>
        </div>` : ''}
    `;

    if (subtopic.relatedPrinciples && subtopic.relatedPrinciples.length) {
      html += `<div class="related-panel">
        <h3>Related Principles</h3>
        <ul>`;
      subtopic.relatedPrinciples.forEach(pid => {
        const p = lookupPrinciple(pid);
        html += p ? `<li><a href="/learn/principles/${pid}/">${escapeHTML(p.name)}</a></li>` : '';
      });
      html += `</ul></div>`;
    }

    if (subtopic.tools && subtopic.tools.length) {
      html += `<div class="related-panel">
        <h3>Tools We Use</h3>
        <ul>`;
      subtopic.tools.forEach(tid => {
        const tool = lookupTool(tid);
        html += tool ? `<li><a href="/learn/tools/#${tid}">${escapeHTML(tool.icon)} ${escapeHTML(tool.name)}</a></li>` : `<li>${escapeHTML(tid)}</li>`;
      });
      html += `</ul></div>`;
    }

    html += `
      <p style="margin-top:2rem;"><a href="/learn/drivers/${driver.id}/">← Back to ${escapeHTML(driver.name)}</a></p>
      </div>
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;
    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Page: Tools ----------

  function renderTools() {
    const main = document.querySelector('main');
    if (!main || !DATA || !DATA.tools) return;

    renderBreadcrumbs([
      { label: 'Home', url: '/' },
      { label: 'Learn', url: '/learn/' },
      { label: 'Tools' }
    ]);
    renderSidebar('/learn/tools/');

    // Group tools by category
    const categories = {};
    DATA.tools.forEach(t => {
      const cat = t.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(t);
    });

    const categoryLabels = {
      'observation': 'Observation & Analysis',
      'planning': 'Planning & Design Frameworks',
      'measurement': 'Measurement & Layout',
      'assessment': 'Assessment & Testing',
      'design-thinking': 'Design Thinking',
      'planting': 'Planting & Guild Design',
      'earthworks': 'Earthworks & Water Shaping',
      'other': 'General Tools'
    };

    let html = `
      <section class="toolbox-page-header">
        <h1>Design Tools</h1>
        <p class="lead">Practical tools and frameworks that permaculture designers use to observe, analyze, plan, and implement regenerative systems.</p>
      </section>
    `;

    Object.keys(categories).forEach(cat => {
      const tools = categories[cat];
      html += `
        <div style="max-width:var(--max);margin:0 auto;padding:2rem var(--step) 0;">
          <h2 style="color:var(--h3);border-bottom:2px solid var(--line);padding-bottom:0.5rem;">${categoryLabels[cat] || cat}</h2>
        </div>
        <div class="tools-grid" style="padding-top:1.5rem;">
      `;

      tools.forEach(tool => {
        const relatedDriversHTML = tool.relatedDrivers ? tool.relatedDrivers.map(did => {
          const d = lookupDriver(did);
          return d ? `<a href="/learn/drivers/${did}/">${escapeHTML(d.name)}</a>` : '';
        }).filter(Boolean).join(', ') : '';

        html += `
          <div class="tool-card" id="${tool.id}">
            <span class="tool-icon">${tool.icon}</span>
            <span class="tool-category">${cat}</span>
            <h3>${escapeHTML(tool.name)}</h3>
            <p>${escapeHTML(tool.short)}</p>
            ${relatedDriversHTML ? `<p class="tool-related">Used in: ${relatedDriversHTML}</p>` : ''}
            <p style="font-size:0.85rem;color:var(--ink-soft);">${escapeHTML(tool.description)}</p>
            ${tool.relatedPrinciples ? `<p class="tool-related">Principles: ${tool.relatedPrinciples.map(pid => {
              const p = lookupPrinciple(pid);
              return p ? `<a href="/learn/principles/${pid}/">${escapeHTML(p.name)}</a>` : '';
            }).filter(Boolean).join(', ')}</p>` : ''}
        `;

        // Render howToAnalyze if present
        if (tool.howToAnalyze && tool.howToAnalyze.steps) {
          html += `<div class="analysis-expander">
            <button class="analysis-toggle" aria-expanded="false">
              <span>${escapeHTML(tool.howToAnalyze.title)}</span>
              <span class="toggle-arrow">▼</span>
            </button>
            <div class="analysis-content" style="display:none;">
              <p class="analysis-summary">${escapeHTML(tool.howToAnalyze.summary || '')}</p>
              <ol class="analysis-steps">`;
          tool.howToAnalyze.steps.forEach(s => {
            html += `<li>
              <strong>${escapeHTML(s.name)}</strong>
              <p>${escapeHTML(s.detail)}</p>`;
            // Render nested principles if present (e.g. Step 9 flow-rate principles)
            if (s.principles && s.principles.length) {
              html += `<ul class="analysis-sub-principles">`;
              s.principles.forEach(sp => {
                html += `<li>
                  <strong>${escapeHTML(sp.name)}</strong>
                  <p>${escapeHTML(sp.detail)}</p>
                </li>`;
              });
              html += `</ul>`;
            }
            html += `</li>`;
          });
          html += `</ol></div></div>`;
        }

        // Render exercise link if present
        if (tool.exerciseUrl) {
          html += `<div style="margin-top:1rem;border-top:1px solid var(--line);padding-top:0.75rem;">
            <a href="${tool.exerciseUrl}" class="btn btn-secondary" style="display:block;font-size:0.85rem;text-align:center;">🎓 Try the Hands-On Exercise →</a>
          </div>`;
        }

        html += `</div>`;
      });

      html += `</div>`;
    });

    html += `
      <div class="cta-block" id="cta-block"></div>
    `;

    main.innerHTML += html;

    // Attach analysis toggle behavior
    main.querySelectorAll('.analysis-toggle').forEach(btn => {
      btn.addEventListener('click', function() {
        const expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        const content = this.nextElementSibling;
        if (content) {
          content.style.display = expanded ? 'none' : 'block';
        }
      });
    });

    renderCTABlock(document.getElementById('cta-block'));
  }

  // ---------- Router ----------

  function init() {
    const pageType = getPageType();

    // Fetch data first
    fetch('/data/toolbox-data.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load data');
        return res.json();
      })
      .then(data => {
        DATA = data;
        route(pageType);
      })
      .catch(err => {
        console.error('Toolbox data load error:', err);
        const main = document.querySelector('main');
        if (main && main.getAttribute('data-page')) {
          main.innerHTML += '<p style="text-align:center;padding:3rem;">Unable to load toolbox content. Please try refreshing the page.</p>';
        }
      });
  }

  function route(pageType) {
    switch (pageType) {
      case 'landing':
        renderLanding();
        break;
      case 'ethics':
        renderEthics();
        break;
      case 'principles-grid':
        renderPrinciplesGrid();
        break;
      case 'principle-detail':
        renderPrincipleDetail();
        break;
      case 'drivers-overview':
        renderDriversOverview();
        break;
      case 'driver-detail':
      case 'subtopic-detail':
        renderDriverDetail();
        break;
      case 'tools':
        renderTools();
        break;
      default:
        break;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();