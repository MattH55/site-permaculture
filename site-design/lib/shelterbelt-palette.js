/**
 * Alberta prairie shelterbelt palette — functional groups for multi-row belts.
 *
 * Standard windward-to-leeward pattern:
 *   shrub row (caragana / lilac / edible hedge)
 *   → deciduous backbone (poplar / ash / maple / elm mix)
 *   → conifer row (spruce / pine) for year-round density & snow trapping
 *
 * Attributes (hardiness, pH, moisture) support site-aware mix selection.
 */

/** @typedef {'outer_fast'|'conifer'|'deciduous_backbone'|'shrub_hedge'} ShelterbeltRole */

/**
 * @typedef {object} PaletteSpecies
 * @property {string} id
 * @property {string} common_name
 * @property {string} [scientific_name]
 * @property {ShelterbeltRole} role
 * @property {string} hardiness_min  e.g. "2a"
 * @property {number} [ph_min]
 * @property {number} [ph_max]
 * @property {'dry'|'mesic'|'wet'|'any'} moisture
 * @property {string} notes
 * @property {boolean} [farm_only]  not for tidy yard settings
 * @property {string[]} [cultivars]
 */

/** @type {PaletteSpecies[]} */
export const ALBERTA_SHELTERBELT_PALETTE = [
  // ── Fast-growing outer row ──
  {
    id: 'okanese-poplar',
    common_name: 'Okanese hybrid poplar',
    scientific_name: 'Populus × hybrid (Okanese)',
    role: 'outer_fast',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 8,
    moisture: 'mesic',
    cultivars: ['Okanese', 'Walker', 'Griffin', 'Tristis', 'Hill'],
    notes:
      'Hardy prairie hybrid — height and density fast; shorter-lived (60–80 yr); opens in winter after leaf drop.',
  },
  {
    id: 'balsam-poplar',
    common_name: 'Balsam poplar',
    scientific_name: 'Populus balsamifera',
    role: 'outer_fast',
    hardiness_min: '1a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Native, fast, less suckering than many poplars; cotton/sticky buds — avoid tidy paved edges.',
  },
  {
    id: 'golden-willow',
    common_name: 'Golden willow',
    scientific_name: 'Salix alba var. vitellina',
    role: 'outer_fast',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'wet',
    notes: 'Fast windbreak; wildlife value; struggles in high-pH soils.',
  },

  // ── Conifers (year-round density, snow trapping) ──
  {
    id: 'colorado-spruce',
    common_name: 'Colorado spruce',
    scientific_name: 'Picea pungens',
    role: 'conifer',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Workhorse evergreen for Alberta shelterbelts — dense wind and noise barrier.',
  },
  {
    id: 'white-spruce',
    common_name: 'White spruce',
    scientific_name: 'Picea glauca',
    role: 'conifer',
    hardiness_min: '1a',
    ph_min: 5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Reliable cold-hardy conifer; slower than Colorado spruce.',
  },
  {
    id: 'lodgepole-pine',
    common_name: 'Lodgepole pine',
    scientific_name: 'Pinus contorta var. latifolia',
    role: 'conifer',
    hardiness_min: '2a',
    ph_min: 5,
    ph_max: 7,
    moisture: 'dry',
    notes: 'Long-lived (150–200 yr); self-prunes lower branches — pair with understory at the base.',
  },

  // ── Deciduous backbone (diversity / disease resistance) ──
  {
    id: 'green-ash',
    common_name: 'Green ash',
    scientific_name: 'Fraxinus pennsylvanica',
    role: 'deciduous_backbone',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 8,
    moisture: 'mesic',
    notes: 'Shelterbelt staple; emerald ash borer watch — do not plant as monoculture.',
  },
  {
    id: 'manitoba-maple',
    common_name: 'Manitoba maple',
    scientific_name: 'Acer negundo',
    role: 'deciduous_backbone',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Fast pioneer backbone; diversifies growth rates across the belt.',
  },
  {
    id: 'hackberry',
    common_name: 'Hackberry',
    scientific_name: 'Celtis occidentalis',
    role: 'deciduous_backbone',
    hardiness_min: '3a',
    ph_min: 6,
    ph_max: 8,
    moisture: 'dry',
    notes: 'Tough deciduous for disease-resistant mix; prefer zone 3+ parkland/prairie sites.',
  },
  {
    id: 'american-elm',
    common_name: 'American elm (resistant hybrid)',
    scientific_name: 'Ulmus americana (Discovery / Knight Rider)',
    role: 'deciduous_backbone',
    hardiness_min: '3a',
    ph_min: 5.5,
    ph_max: 8,
    moisture: 'mesic',
    cultivars: ['Discovery', 'Knight Rider'],
    notes: 'Use Dutch-elm-resistant hybrids only.',
  },
  {
    id: 'siberian-elm',
    common_name: 'Siberian elm',
    scientific_name: 'Ulmus pumila',
    role: 'deciduous_backbone',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 8.5,
    moisture: 'dry',
    farm_only: true,
    notes:
      'Very fast, drought/soil tolerant, late leaf hold; heavy seed — farm shelterbelts only, not tidy yards.',
  },

  // ── Shrub / hedge inner row ──
  {
    id: 'caragana',
    common_name: 'Common caragana',
    scientific_name: 'Caragana arborescens',
    role: 'shrub_hedge',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 8.5,
    moisture: 'dry',
    notes: 'Classic prairie hedge shrub — extremely hardy and drought-tolerant N-fixer.',
  },
  {
    id: 'lilac',
    common_name: 'Common / Villosa lilac',
    scientific_name: 'Syringa vulgaris / S. villosa',
    role: 'shrub_hedge',
    hardiness_min: '2a',
    ph_min: 6,
    ph_max: 8,
    moisture: 'mesic',
    cultivars: ['Common Purple', 'Villosa'],
    notes: 'Privacy and wind edge; alternate varieties to extend bloom.',
  },
  {
    id: 'saskatoon',
    common_name: 'Saskatoon',
    scientific_name: 'Amelanchier alnifolia',
    role: 'shrub_hedge',
    hardiness_min: '1a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Edible multi-function hedge for permaculture belts.',
  },
  {
    id: 'chokecherry',
    common_name: 'Chokecherry',
    scientific_name: 'Prunus virginiana',
    role: 'shrub_hedge',
    hardiness_min: '2a',
    ph_min: 5.5,
    ph_max: 7.5,
    moisture: 'mesic',
    notes: 'Farmstead windbreak shrub; dark fruit for jams/jellies.',
  },
];

export const SHELTERBELT_ROW_ORDER = [
  { role: 'shrub_hedge', label: 'Shrub / hedge row (inner or leeward edge)' },
  { role: 'deciduous_backbone', label: 'Deciduous backbone row' },
  { role: 'outer_fast', label: 'Fast outer / pioneer row' },
  { role: 'conifer', label: 'Conifer row (windward year-round density)' },
];

export const SHELTERBELT_DESIGN_NOTE =
  'Standard prairie multi-row pattern (windward → leeward): conifer (spruce/pine) → deciduous mix (poplar/ash/maple/elm) → shrub hedge (caragana/lilac/saskatoon/chokecherry). Multiple rows cut wind more effectively and build wildlife habitat vs a single row.';

const ZONE_ORDER = [
  '0a',
  '0b',
  '1a',
  '1b',
  '2a',
  '2b',
  '3a',
  '3b',
  '4a',
  '4b',
  '5a',
  '5b',
  '6a',
  '6b',
  '7a',
  '7b',
  '8a',
  '8b',
];

function zoneIdx(z) {
  if (z == null || z === '') return null;
  const s = String(z).toLowerCase().replace(/\s/g, '');
  const i = ZONE_ORDER.indexOf(s);
  if (i >= 0) return i;
  const m = s.match(/^(\d)/);
  if (!m) return null;
  const approx = ZONE_ORDER.indexOf(`${m[1]}a`);
  return approx >= 0 ? approx : null;
}

/**
 * Soft site filters: hardiness zone, soil pH, moisture preference.
 * @param {object} [site]
 * @param {object} [opts]
 * @returns {PaletteSpecies[]}
 */
export function filterPaletteForSite(site = {}, opts = {}) {
  const zone = site.climate?.plant_hardiness_zone || site.hardiness?.effective_zone || opts.zone;
  const zIdx = zoneIdx(zone);
  const ph =
    num(site.soil?.ph) ??
    num(site.soil_survey?.ph) ??
    num(opts.ph) ??
    null;
  const moisture =
    opts.moisture ||
    inferMoisture(site) ||
    'any';
  const tidyYard = opts.tidy_yard === true;

  return ALBERTA_SHELTERBELT_PALETTE.filter((sp) => {
    if (tidyYard && sp.farm_only) return false;
    if (zIdx != null) {
      const minIdx = zoneIdx(sp.hardiness_min);
      if (minIdx != null && zIdx < minIdx) return false;
    }
    if (ph != null && sp.ph_min != null && sp.ph_max != null) {
      if (ph < sp.ph_min - 0.3 || ph > sp.ph_max + 0.3) return false;
    }
    if (moisture === 'dry' && sp.moisture === 'wet') return false;
    if (moisture === 'wet' && sp.moisture === 'dry' && sp.role === 'outer_fast') {
      // prefer mesic/wet outer on wet sites — still allow dry-tolerant shrubs
    }
    if (moisture === 'wet' && sp.id === 'golden-willow') return true;
    if (ph != null && ph >= 7.8 && sp.id === 'golden-willow') return false;
    return true;
  });
}

function inferMoisture(site) {
  const drain = String(site.soil?.drainage_class || site.soil_survey?.drainage || '').toLowerCase();
  const regime = String(site.water?.regime || site.hydrology?.moisture_regime || '').toLowerCase();
  if (/poor|very.?poor|imperfect/.test(drain) || /wet|hydric/.test(regime)) return 'wet';
  if (/rapid|excess/.test(drain) || /arid|xeric|dry/.test(regime)) return 'dry';
  return 'mesic';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick a balanced multi-row mix: ~1–2 shrub, 1–2 deciduous, 1 outer, 1–2 conifer.
 * Prefer catalog matches when ranked plants are provided.
 *
 * @param {object} [site]
 * @param {object[]} [rankedPlants]  from planting plan
 * @param {object} [opts]
 * @returns {{ members: object[], by_role: Record<string, object[]>, design_note: string, species_names: string[] }}
 */
export function selectShelterbeltMix(site = {}, rankedPlants = [], opts = {}) {
  const palette = filterPaletteForSite(site, opts);
  const rankedById = new Map((rankedPlants || []).map((p) => [p.id, p]));
  const rankedNames = new Map(
    (rankedPlants || []).map((p) => [String(p.common_name || '').toLowerCase(), p])
  );

  const pickFromRole = (role, n) => {
    const pool = palette.filter((sp) => sp.role === role);
    // Prefer species also in ranked catalog results
    const scored = pool.map((sp) => {
      const hit =
        rankedById.get(sp.id) ||
        rankedNames.get(sp.common_name.toLowerCase()) ||
        null;
      let score = hit?.score ?? 0;
      // Prefer workhorses
      if (sp.id === 'colorado-spruce' || sp.id === 'caragana' || sp.id === 'okanese-poplar') {
        score += 4;
      }
      if (sp.id === 'white-spruce' || sp.id === 'saskatoon' || sp.id === 'chokecherry') score += 2;
      if (sp.farm_only) score -= 1;
      return { sp, hit, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n);
  };

  const selected = [
    ...pickFromRole('shrub_hedge', 2),
    ...pickFromRole('deciduous_backbone', 2),
    ...pickFromRole('outer_fast', 1),
    ...pickFromRole('conifer', 2),
  ];

  // Dedupe by id
  const seen = new Set();
  const unique = [];
  for (const row of selected) {
    if (seen.has(row.sp.id)) continue;
    seen.add(row.sp.id);
    unique.push(row);
  }

  const by_role = {
    shrub_hedge: [],
    deciduous_backbone: [],
    outer_fast: [],
    conifer: [],
  };

  const members = unique.map(({ sp, hit }) => {
    const m = {
      id: sp.id,
      common_name: hit?.common_name || sp.common_name,
      scientific_name: sp.scientific_name,
      score: hit?.score ?? null,
      guild_layer:
        sp.role === 'shrub_hedge' ? 'shrub' : sp.role === 'conifer' ? 'canopy' : 'canopy',
      primary_value: 'wind_protection',
      shelterbelt_role: sp.role,
      notes: sp.notes,
      suggested_quantity: hit?.economics?.suggested_quantity ?? null,
    };
    by_role[sp.role]?.push(m);
    return m;
  });

  const species_names = members.map((m) => m.common_name).filter(Boolean);

  return {
    members,
    by_role,
    design_note: SHELTERBELT_DESIGN_NOTE,
    species_names,
    palette_source: 'Alberta prairie multi-row shelterbelt palette',
  };
}

/** Short headline / card line for recommendations. */
export function shelterbeltValueHeadline(site = {}) {
  const dir = site.climate?.prevailing_wind_direction;
  const chinook = site.climate?.chinook_exposure;
  const mix = selectShelterbeltMix(site);
  const sample = mix.species_names.slice(0, 4).join(', ');
  const windBit = dir ? ` against ${dir} winds` : '';
  const chinookBit = chinook ? ' Include dense conifer rows for chinook and snow control.' : '';
  return `Multi-row prairie shelterbelt${windBit} using ${sample || 'caragana, hybrid poplar, and spruce'}.${chinookBit}`;
}

/** Placement paragraph with row pattern + named species. */
export function shelterbeltPlacementNotes(site = {}, rankedPlants = []) {
  const mix = selectShelterbeltMix(site, rankedPlants);
  const dir = site.climate?.prevailing_wind_direction || 'prevailing';
  const list = mix.species_names.slice(0, 6).join(', ');
  const chinook = site.climate?.chinook_exposure
    ? ' Chinook corridor: prioritise dense conifer rows and avoid early-flowering woody species.'
    : '';
  return (
    `Orient a multi-row belt perpendicular to ${dir} winds (windward conifer → deciduous backbone → shrub hedge). ` +
    `Alberta prairie mix: ${list}. ${mix.design_note}${chinook}`
  );
}

/** Regex / id set for scoring plants that belong on the palette. */
export function isShelterbeltPalettePlant(plant = {}) {
  const id = String(plant.id || '').toLowerCase();
  const name = String(plant.common_name || plant.scientific_name || '').toLowerCase();
  if (ALBERTA_SHELTERBELT_PALETTE.some((sp) => sp.id === id)) return true;
  return /caragana|lilac|saskatoon|chokecherry|poplar|aspen|willow|spruce|pine|green.?ash|manitoba.?maple|boxelder|hackberry|elm|okanese|walker|tristis|lodgepole/i.test(
    `${id} ${name}`
  );
}
