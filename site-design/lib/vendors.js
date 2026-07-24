/**
 * Resolve seed / sapling / fertilizer vendor links for a crop.
 * Uses data/crops/vendors.json registry + crop search terms.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let registry = null;

export function loadVendorRegistry() {
  if (registry) return registry;
  const p = path.join(__dirname, '..', 'data', 'crops', 'vendors.json');
  try {
    registry = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn('vendors.json load failed', e.message);
    registry = { vendors: {}, defaults: {}, crop_overrides: {}, fertilizer_queries: {} };
  }
  return registry;
}

/**
 * @param {object} crop — normalized crop with id, common_name, scientific_name, category, alberta_native
 * @returns {{ seeds: object[], saplings: object[], fertilizer: object[], disclaimer: string }}
 */
export function resolveSuppliers(crop) {
  const reg = loadVendorRegistry();
  const vendors = reg.vendors || {};
  const defaults = reg.defaults || {};
  const overrides = reg.crop_overrides?.[crop.id] || {};
  const fertQ = reg.fertilizer_queries || {};

  const seedQuery =
    overrides.search?.seeds ||
    crop.search_terms?.seeds ||
    `${crop.scientific_name || crop.common_name} seed`;
  const sapQuery =
    overrides.search?.saplings ||
    crop.search_terms?.saplings ||
    `${crop.scientific_name || crop.common_name} plant seedling nursery`;
  const fertQuery =
    overrides.search?.fertilizer ||
    crop.search_terms?.fertilizer ||
    pickFertQuery(crop, fertQ);

  const seedVendorIds =
    overrides.seeds ||
    pickDefaultVendorIds(crop, defaults, 'seeds');
  const sapVendorIds =
    overrides.saplings ||
    pickDefaultVendorIds(crop, defaults, 'saplings');
  const fertVendorIds =
    overrides.fertilizer ||
    defaults.fertilizer ||
    ['gaia_green', 'greenland', 'amazon_ca'];

  // Woody vs herbaceous: seeds vs saplings emphasis
  const woody = isWoody(crop);

  const seeds = buildLinks(seedVendorIds, vendors, 'seeds', seedQuery).slice(0, 4);
  const saplings = woody
    ? buildLinks(sapVendorIds, vendors, 'saplings', sapQuery).slice(0, 4)
    : buildLinks(sapVendorIds, vendors, 'saplings', sapQuery).slice(0, 2);
  const fertilizer = buildLinks(fertVendorIds, vendors, 'fertilizer', fertQuery).slice(0, 3);

  // If annual / cover, de-emphasize empty saplings noise
  const suppliers = {
    seeds,
    saplings: crop.category === 'annual' || crop.category === 'cover_crop' ? saplings.slice(0, 1) : saplings,
    fertilizer,
  };

  // Prefer curated product-level suppliers from crop.suppliers if present
  if (crop.suppliers) {
    for (const kind of ['seeds', 'saplings', 'fertilizer']) {
      if (Array.isArray(crop.suppliers[kind]) && crop.suppliers[kind].length) {
        suppliers[kind] = [
          ...crop.suppliers[kind].map((s) => ({
            name: s.name,
            url: s.url,
            kind: s.kind || kind,
            region: s.region || null,
            product_hint: s.product_hint || null,
            notes: s.notes || null,
            vendor_id: s.vendor_id || null,
          })),
          ...suppliers[kind],
        ].slice(0, 5);
      }
    }
  }

  return {
    ...suppliers,
    disclaimer:
      reg.disclaimer ||
      'Vendor links are search starting points — verify hardiness, stock, and shipping.',
    search_terms: {
      seeds: seedQuery,
      saplings: sapQuery,
      fertilizer: fertQuery,
    },
  };
}

function pickDefaultVendorIds(crop, defaults, kind) {
  if (crop.alberta_native) {
    if (kind === 'seeds' && defaults.native_seeds) return defaults.native_seeds;
    if (kind === 'saplings' && defaults.native_saplings) return defaults.native_saplings;
  }
  if (crop.category === 'medicinal' && kind === 'seeds' && defaults.medicinal_seeds) {
    return defaults.medicinal_seeds;
  }
  if (
    (crop.category === 'medicinal' || /herb|mint|basil|rosemar|oregano|thyme/i.test(crop.common_name || '')) &&
    defaults.herbs &&
    kind === 'seeds'
  ) {
    return defaults.herbs;
  }
  return defaults[kind] || ['google_shopping'];
}

function pickFertQuery(crop, fertQ) {
  const name = `${crop.common_name || ''} ${crop.scientific_name || ''}`.toLowerCase();
  if (crop.category === 'cover_crop' || /clover|pea|vetch|inoculant/.test(name)) {
    return fertQ.nitrogen_fixer || fertQ.cover_crop || fertQ.default;
  }
  if (crop.alberta_native) return fertQ.native || fertQ.default;
  if (/berry|fruit|cherry|apple|plum|saskatoon|haskap|currant|raspberry/.test(name)) {
    return fertQ.fruit || fertQ.default;
  }
  if (/lingon|blueberry|labrador|bearberry|rhododendron|vaccinium/.test(name)) {
    return fertQ.acid || fertQ.default;
  }
  if (crop.category === 'annual' || /potato|carrot|kale|garlic|bean|squash/.test(name)) {
    return fertQ.vegetable || fertQ.default;
  }
  return fertQ.default || 'organic fertilizer Canada';
}

function isWoody(crop) {
  return (
    crop.category === 'tree' ||
    crop.category === 'shrub' ||
    ['canopy', 'understory', 'shrub'].includes(crop.guild_layer)
  );
}

function buildLinks(vendorIds, vendors, kind, query) {
  const q = encodeURIComponent(query);
  const out = [];
  for (const id of vendorIds || []) {
    const v = vendors[id];
    if (!v) continue;
    const url = (v.search_url || v.home_url || '')
      .replace(/\{query\}/g, q)
      .replace(/\{QUERY\}/g, q);
    if (!url) continue;
    out.push({
      name: v.name,
      url,
      kind,
      vendor_id: id,
      region: v.region || null,
      product_hint: query,
      notes: v.notes || null,
      affiliate: false,
    });
  }
  return out;
}
