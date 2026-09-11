/**
 * AVI species-code → tree-asset lookup.
 *
 * Alberta Vegetation Inventory (AVI) Crown types species as 1–2 letter
 * codes (SW white spruce, PB paper birch, …). Poly Haven's CC0 tree
 * library does not map 1:1 onto those species, so this table picks the
 * closest available photoreal asset class: `conifer` (pine/fir/spruce
 * foliage maps) or `deciduous` (broadleaf maps). Unknown codes fall
 * back to a height/crown-shape heuristic, then a regional prior.
 *
 * AVI polygon inventory is not live-queried per parcel (see
 * vegetation-indices.js); the table is still the right join for when a
 * code is present on a tree instance or a stand summary.
 */

export const AVI_SPECIES_TO_ASSET = {
  SW: { asset: 'conifer', name: 'white spruce' },
  SB: { asset: 'conifer', name: 'black spruce' },
  Se: { asset: 'conifer', name: 'Engelmann spruce' },
  PL: { asset: 'conifer', name: 'lodgepole pine' },
  PJ: { asset: 'conifer', name: 'jack pine' },
  PF: { asset: 'conifer', name: 'limber pine' },
  PA: { asset: 'conifer', name: 'whitebark pine' },
  FB: { asset: 'conifer', name: 'balsam fir' },
  FD: { asset: 'conifer', name: 'Douglas-fir' },
  LT: { asset: 'conifer', name: 'tamarack' },
  LA: { asset: 'conifer', name: 'alpine larch' },
  AW: { asset: 'deciduous', name: 'trembling aspen' },
  PB: { asset: 'deciduous', name: 'paper birch' },
  BW: { asset: 'deciduous', name: 'white birch' },
  A: { asset: 'deciduous', name: 'aspen' },
  PO: { asset: 'deciduous', name: 'poplar' },
  BP: { asset: 'deciduous', name: 'balsam poplar' },
};

const CODE_ALIASES = {
  SE: 'Se',
  P: 'PL',
  S: 'SW',
};

/**
 * @param {{avi_species?:string, species_code?:string, form?:string, height_m?:number, crown_radius_m?:number}} tree
 * @param {{prior?: 'conifer'|'deciduous'|null}} [opts]
 * @returns {'conifer'|'deciduous'}
 */
export function resolveTreeAsset(tree = {}, opts = {}) {
  const raw = String(tree.avi_species || tree.species_code || '').trim();
  const code = CODE_ALIASES[raw.toUpperCase()] || raw;
  const keyed = AVI_SPECIES_TO_ASSET[code] || AVI_SPECIES_TO_ASSET[code.toUpperCase()];
  if (keyed) return keyed.asset;
  if (tree.form === 'conifer' || tree.form === 'deciduous') return tree.form;
  const h = Number(tree.height_m) || 0;
  const r = Number(tree.crown_radius_m) || 0;
  if (h > 0 && r > 0 && h / r >= 5) return 'conifer';
  if (opts.prior === 'conifer' || opts.prior === 'deciduous') return opts.prior;
  return h >= 14 ? 'conifer' : 'deciduous';
}

/** Regional prior from Alberta Natural Subregions (AVI-adjacent provenance). */
export function priorFromSubregion(name) {
  if (!name) return null;
  if (/boreal|foothills|montane|subalpine|mixedwood|shield/i.test(String(name))) return 'conifer';
  if (/parkland|grassland|prairie/i.test(String(name))) return 'deciduous';
  return null;
}

/** Crown-shape form used when no AVI code is on the instance. */
export function formFromDimensions(heightM, crownRadiusM) {
  const h = Number(heightM) || 0;
  const r = Number(crownRadiusM) || 0;
  if (h > 0 && r > 0 && h / r >= 5) return 'conifer';
  return 'deciduous';
}
