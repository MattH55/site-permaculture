import { QUESTIONS, DIMENSIONS, score } from '/questions.js';

const stage = document.getElementById('stage');
const core = document.getElementById('core');
const SCORED = QUESTIONS.filter(q => q.type !== 'profile');
const DIM_KEYS = Object.keys(DIMENSIONS).sort((a, b) => DIMENSIONS[a].order - DIMENSIONS[b].order);

const state = { i: -1, answers: {}, profile: {} };

// --- persistence, so abandoners can come back ---
const KEY = 'ee-resilience-v1';
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

// --- the core sample ---
function buildCore() {
  core.innerHTML = DIM_KEYS.map((k, n) => `
    <div class="horizon" data-dim="${k}" data-filled="0" style="--fill:var(--h${n + 1})">
      <span>${DIMENSIONS[k].name}</span><b></b>
    </div>`).join('');
}
function paintCore() {
  const s = score(state.answers);
  DIM_KEYS.forEach(k => {
    const el = core.querySelector(`[data-dim="${k}"]`);
    const done = SCORED.filter(q => q.dim === k).every(q => state.answers[q.id] !== undefined);
    el.dataset.filled = done ? '1' : '0';
    el.style.backgroundColor = done ? getComputedStyle(el).getPropertyValue('--fill') : '';
    el.querySelector('b').textContent = done ? s.dims[k].pct : '';
  });
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- screens ---
function intro() {
  stage.innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Expanding Edge Permaculture · Treaty 6 · North Saskatchewan watershed</span>
      <h1>The Resilience Quiz for Edmonton</h1>
      <p class="lede">Twenty-four questions about your water, your soil, your winter and your pantry.
      Three minutes. At the end you get a number, and — more useful — the one thing capping everything else.</p>
      <div class="actions">
        <button class="btn" id="go">Start the quiz</button>
        ${answered() ? '<button class="btn-quiet" id="resume">Resume where I left off</button>' : ''}
      </div>
    </div>`;
  document.getElementById('go').onclick = () => { state.i = 0; save(); render(); };
  const r = document.getElementById('resume');
  if (r) r.onclick = () => { state.i = firstUnanswered(); render(); };
}

const answered = () => Object.keys(state.answers).length + Object.keys(state.profile).length > 0;
const firstUnanswered = () => {
  const n = QUESTIONS.findIndex(q => q.type === 'profile' ? state.profile[q.id] === undefined : state.answers[q.id] === undefined);
  return n === -1 ? QUESTIONS.length : n;
};

function question(q, n) {
  const isProfile = q.type === 'profile';
  const current = isProfile ? state.profile[q.id] : state.answers[q.id];
  const multi = q.type === 'multi';
  const picked = multi ? (current || []) : [];

  stage.innerHTML = `
    <div class="panel fade">
      <span class="mono count">Question ${n + 1} of ${QUESTIONS.length}${q.dim ? ' · ' + DIMENSIONS[q.dim].name : ''}</span>
      <h2 class="question">${esc(q.text)}</h2>
      ${q.help ? `<p class="help">${esc(q.help)}</p>` : ''}
      <div class="opts" role="group">
        ${q.options.map((o, idx) => {
          const on = multi ? picked.includes(idx) : current === (isProfile ? idx : o.points);
          return `<button class="opt" data-idx="${idx}" aria-pressed="${on}"><i></i><span>${esc(o.label)}</span></button>`;
        }).join('')}
      </div>
      <div class="actions">
        ${multi ? '<button class="btn" id="next">Continue</button>' : ''}
        ${n > 0 ? '<button class="btn-quiet" id="back">Back</button>' : ''}
      </div>
    </div>`;

  stage.querySelectorAll('.opt').forEach(btn => {
    btn.onclick = () => {
      const idx = +btn.dataset.idx;
      if (multi) {
        const set = new Set(state.answers[q.id] || []);
        set.has(idx) ? set.delete(idx) : set.add(idx);
        state.answers[q.id] = [...set];
        btn.setAttribute('aria-pressed', set.has(idx));
        save(); paintCore();
        return;
      }
      if (isProfile) state.profile[q.id] = idx;
      else state.answers[q.id] = q.options[idx].points;
      state.i = n + 1; save(); render();
    };
  });

  const next = document.getElementById('next');
  if (next) next.onclick = () => { state.i = n + 1; save(); render(); };
  const back = document.getElementById('back');
  if (back) back.onclick = () => { state.i = n - 1; render(); };
  paintCore();
}

function results() {
  const s = score(state.answers);
  const alsoTxt = s.alsoLow ? ` It's closely followed by ${s.alsoLow.name.toLowerCase()}.` : '';

  stage.innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Your result</span>
      <div class="score-row">
        <span class="score">${s.total}</span><span class="score-of mono">out of 100</span>
      </div>
      <h2>${esc(s.archetype.name)}</h2>
      <p class="lede">${esc(s.archetype.line)}</p>

      <div class="callout">
        <span class="mono" style="color:var(--berry)">Your limiting factor</span>
        <h3>${esc(s.limiting.name)} — ${s.limiting.pct}/100</h3>
        <p>Your land is capped by its weakest input, not its average one. Every improvement you make
        elsewhere runs into this first.${esc(alsoTxt)}</p>
      </div>

      <div class="stat">
        <span class="mono">Days of autonomy, roughly</span><br>
        <strong>${s.daysLow}–${s.daysHigh} days</strong>
        <p class="fine">How long your site could feed and water your household with nothing coming in.</p>
      </div>

      <div class="gate">
        <h2>Get the full report</h2>
        <p>Your three biggest gaps, what each realistically costs to close, and the order to do them in —
        because doing them out of order is how people lose a decade.</p>
        <div class="field">
          <label for="name">First name</label>
          <input id="name" autocomplete="given-name">
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" type="email" autocomplete="email" inputmode="email">
        </div>
        <p class="err" id="err" hidden></p>
        <button class="btn" id="send">Send my report</button>
        <p class="fine" style="margin-top:.9rem">One report, occasional seasonal notes. Unsubscribe any time.</p>
      </div>
    </div>`;
  paintCore();

  document.getElementById('send').onclick = async e => {
    const email = document.getElementById('email').value.trim();
    const name = document.getElementById('name').value.trim();
    const err = document.getElementById('err');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      err.textContent = 'That email address looks incomplete — check it and try again.';
      err.hidden = false; return;
    }
    err.hidden = true;
    e.target.disabled = true; e.target.textContent = 'Sending…';
    try {
      const r = await fetch('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, answers: state.answers, profile: state.profile })
      });
      let data = {};
      try { data = await r.json(); } catch { /* non-JSON error body */ }
      if (!r.ok) {
        throw new Error(data.message || data.error || 'send failed');
      }
      thanks(name, email, s);
    } catch (ex) {
      e.target.disabled = false; e.target.textContent = 'Send my report';
      err.textContent = (ex && ex.message && ex.message.length < 160)
        ? ex.message
        : "That didn't go through. Try once more, or email info@expandingedge.ca and we'll send it manually.";
      err.hidden = false;
    }
  };
}

function thanks(name, email, s) {
  stage.innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Sent</span>
      <h1>On its way${name ? ', ' + esc(name) : ''}.</h1>
      <p class="lede">Your report is heading to ${esc(email)}. If it hasn't landed in ten minutes, check
      your promotions tab — that's where it usually hides.</p>
      <div class="callout">
        <h3>Start with ${esc(s.limiting.name.toLowerCase())}</h3>
        <p>It's the constraint on everything else you'd do this season. The report explains what that
        looks like on a site your size, and we're happy to walk it with you.</p>
      </div>
      <div class="actions">
        <a class="btn" href="https://www.expandingedge.ca/contact">Book a site walk</a>
      </div>
    </div>`;
  paintCore();
}

function render() {
  if (state.i < 0) return intro();
  if (state.i >= QUESTIONS.length) return results();
  question(QUESTIONS[state.i], state.i);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

buildCore();
paintCore();
render();
