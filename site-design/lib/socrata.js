/**
 * Generic Socrata SODA adapter for Alberta municipal open-data portals.
 * Config-driven so new municipalities can be added without new query code.
 */

const DEFAULT_TIMEOUT_MS = 22_000;

/**
 * @typedef {object} SocrataDatasetConfig
 * @property {string} id — dataset 4x4 id
 * @property {string} domain — e.g. data.calgary.ca
 * @property {string} [app_token]
 */

/**
 * GET JSON rows from a Socrata resource.
 * @param {SocrataDatasetConfig} cfg
 * @param {Record<string, string|number>} [params] SoQL params ($where, $limit, …)
 */
export async function socrataGet(cfg, params = {}) {
  if (!cfg?.domain || !cfg?.id) throw new Error('Socrata config needs domain + id');
  const url = new URL(`https://${cfg.domain}/resource/${cfg.id}.json`);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  const headers = { Accept: 'application/json' };
  if (cfg.app_token) headers['X-App-Token'] = cfg.app_token;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeout_ms || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Socrata ${cfg.domain}/${cfg.id} HTTP ${res.status}: ${body.slice(0, 180)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Paginate $limit/$offset until empty or maxRows.
 * @param {SocrataDatasetConfig} cfg
 * @param {Record<string, string|number>} params
 * @param {{ pageSize?: number, maxRows?: number }} [opts]
 */
export async function socrataPaginate(cfg, params = {}, opts = {}) {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 5000;
  const all = [];
  let offset = 0;
  while (all.length < maxRows) {
    const batch = await socrataGet(cfg, {
      ...params,
      $limit: Math.min(pageSize, maxRows - all.length),
      $offset: offset,
    });
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }
  return all;
}
