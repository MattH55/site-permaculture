// Platform-agnostic: no Express, no Node-only APIs beyond fetch.
// Imported by server.js (Render/Fly/Railway) and api/submit.js (Vercel/Netlify).

import { score, QUESTIONS } from '../public/questions.js';

const label = (qid, val) => {
  const q = QUESTIONS.find(x => x.id === qid);
  return q && q.options[val] ? q.options[val].label : '—';
};

export function buildLead({ email, name = '', answers = {}, profile = {} }) {
  const s = score(answers);
  const tenure = label('tenure', profile.tenure);
  return {
    lead: {
      at: new Date().toISOString(),
      email, name,
      region: label('region', profile.region),
      size: label('size', profile.size),
      tenure,
      total: s.total,
      archetype: s.archetype.name,
      limiting: s.limiting.name,
      hot: tenure.startsWith('Just bought')
    },
    s
  };
}

export function reportHtml(lead, s, { forInbox = false } = {}) {
  const gaps = s.gaps.map((g, i) => `
    <tr><td style="padding:14px 0;border-top:1px solid #d8dcd2;vertical-align:top">
      <div style="font:600 12px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:#5b3a73">Gap ${i + 1} · ${g.pct}/100</div>
      <div style="font:700 19px/1.3 Georgia,serif;margin:6px 0 4px">${g.name}</div>
      <div style="font:400 15px/1.55 Georgia,serif;color:#46584c">${g.fix}</div>
    </td></tr>`).join('');

  const leadBlock = forInbox ? `
    <div style="background:#fff;border:1px solid #d8dcd2;border-radius:3px;padding:14px 16px;margin:0 0 20px;font-size:14px;line-height:1.5">
      <div style="font:600 11px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:#5b3a73;margin-bottom:8px">Quiz lead</div>
      <div><b>Name:</b> ${lead.name || '—'}</div>
      <div><b>Email:</b> <a href="mailto:${lead.email}">${lead.email}</a></div>
      <div><b>Region:</b> ${lead.region || '—'}</div>
      <div><b>Size:</b> ${lead.size || '—'}</div>
      <div><b>Tenure:</b> ${lead.tenure || '—'}</div>
      <div><b>Hot lead:</b> ${lead.hot ? 'Yes — just bought / about to' : 'No'}</div>
    </div>` : '';

  return `
  <div style="max-width:560px;margin:0 auto;padding:28px;background:#f7f8f3;color:#16211b;font-family:Georgia,serif">
    <div style="font:600 11px/1 monospace;letter-spacing:.16em;text-transform:uppercase;color:#5b3a73">Land resilience assessment</div>
    ${leadBlock}
    <h1 style="font:700 30px/1.1 Georgia,serif;margin:14px 0 4px">${lead.name ? lead.name + "'s" : 'Your'} resilience report</h1>
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
      and most expensive mistake we see on Edmonton-area acreages — the trees go in, and three years later the driveway or the
      dugout has to go through them.</p>
    </div>

    <p style="margin:28px 0"><a href="/contact"
      style="background:#5b3a73;color:#fff;text-decoration:none;padding:13px 22px;border-radius:3px;font:700 15px Georgia,serif;display:inline-block">Contact us</a></p>

    <p style="font-size:13px;color:#46584c;line-height:1.5">Land resilience assessment · Stony Plain, Alberta · Contact via the inquiry form<br>
    Working in the North Saskatchewan watershed, on Treaty 6 lands.</p>
  </div>`;
}

export async function sendReport(lead, s, env = process.env) {
  if (!env.RESEND_API_KEY) {
    throw new Error('no RESEND_API_KEY — cannot send report to ' + lead.email);
  }
  if (!lead.email) {
    throw new Error('missing lead email');
  }

  // User-entered email is the primary recipient (their resilience report).
  // Optional MAIL_BCC gets a team copy when the From domain is verified (not resend.dev testing).
  // Default Resend testing sender — works without domain verification.
  const from = env.MAIL_FROM || 'Land resilience assessment <onboarding@resend.dev>';
  const teamBcc = (env.MAIL_BCC || '').trim();

  const payload = {
    from,
    to: [lead.email],
    reply_to: env.MAIL_REPLY_TO || undefined,
    subject: `Your resilience score: ${s.total}/100 — start with ${s.limiting.name.toLowerCase()}`,
    html: reportHtml(lead, s, { forInbox: false })
  };

  // BCC team only when From is a verified domain (not onboarding@resend.dev).
  const testingFrom = from.includes('onboarding@resend.dev') || /@resend\.dev>?$/i.test(from);
  if (teamBcc && !testingFrom && teamBcc.toLowerCase() !== lead.email.toLowerCase()) {
    payload.bcc = [teamBcc];
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Resend ${r.status}: ${body}`);
  }
}
