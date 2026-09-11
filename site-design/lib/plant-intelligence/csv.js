/** Quoted-CSV parser (EcoCrop and similar FAO dumps). */

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  const pushCell = () => {
    row.push(cur);
    cur = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && !q) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') pushCell();
    else if (ch === '\n') {
      if (cur.endsWith('\r')) cur = cur.slice(0, -1);
      pushCell();
      pushRow();
    } else cur += ch;
  }
  if (cur.length || row.length) {
    pushCell();
    pushRow();
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cells[i] ?? '';
    return obj;
  });
}

export function numOrNull(v) {
  if (v == null || v === '' || /^na$/i.test(String(v).trim())) return null;
  const n = Number(String(v).replace(/[^0-9eE.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
