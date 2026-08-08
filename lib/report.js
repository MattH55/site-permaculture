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

export function reportHtml(lead, s) {
  const gaps = s.gaps.map((g, i) => `
    <tr><td style="padding:14px 0;border-top:1px solid #d8dcd2;vertical-align:top">
      <div style="font:600 12px/1 monospace;letter-spacing:.12em;text-transform:uppercase;color:#5b3a73">Gap ${i + 1} · ${g.pct}/100</div>
      <div style="font:700 19px/1.3 Georgia,serif;margin:6px 0 4px">${g.name}</div>
      <div style="font:400 15px/1.55 Georgia,serif;color:#46584c">${g.fix}</div>
    </td></tr>`).join('');

  return `
  <div style="max-width:560px;margin:0 auto;padding:28px;background:#f7f8f3;color:#16211b;font-family:Georgia,serif">
    <div style="font:600 11px/1 monospace;letter-spacing:.16em;text-transform:uppercase;color:#5b3a73">Expanding Edge Permaculture</div>
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

    <p style="margin:28px 0"><a href="https://www.expandingedge.ca/contact"
      style="background:#5b3a73;color:#fff;text-decoration:none;padding:13px 22px;border-radius:3px;font:700 15px Georgia,serif;display:inline-block">Book a site walk</a></p>

    <p style="font-size:13px;color:#46584c;line-height:1.5">Expanding Edge Permaculture · Stony Plain, Alberta · info@expandingedge.ca<br>
    Working in the North Saskatchewan watershed, on Treaty 6 lands.</p>
  </div>`;
}

export async function sendReport(lead, s, env = process.env) {
  if (!env.RESEND_API_KEY) {
    throw new Error('no RESEND_API_KEY — cannot send report to ' + lead.email);
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'Expanding Edge <onboarding@resend.dev>',
      to: [lead.email],
      bcc: env.MAIL_BCC ? [env.MAIL_BCC] : undefined,
      reply_to: 'info@expandingedge.ca',
      subject: `Your resilience score: ${s.total}/100 — start with ${s.limiting.name.toLowerCase()}`,
      html: reportHtml(lead, s)
    })
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Resend ${r.status}: ${body}`);
  }
}
