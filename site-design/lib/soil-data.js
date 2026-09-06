/** AGRASID result normalizer with a sampled SoilGrids global fallback. */
const TTL = 7 * 864e5;
const cache = new Map();
const SOILGRIDS = 'https://rest.isric.org/soilgrids/v2.0/properties/query';

export async function getSoilData(bbox, agrasid = {}, opts = {}) {
  const key = [bbox.west, bbox.south, bbox.east, bbox.north].map(x => Number(x).toFixed(4)).join(',');
  const hit = cache.get(key);
  if (!opts.skipCache && hit && Date.now() - hit.at < TTL) return { ...hit.value, _meta: { cache: 'hit' } };
  let value;
  if (agrasid?.soil_group || agrasid?.texture_raw) {
    value = {
      soil_data_source: 'AGRASID', confidence: 'high',
      soil_units: [{ area_pct_of_parcel: 100, soil_series: agrasid.soil_group || null, texture_class: agrasid.texture || null, drainage_class: null, parent_material: null, ph: null, organic_carbon_pct: null, depth_to_bedrock_cm: null }],
      note: 'AGRASID / Alberta agricultural soil-survey result. Mixed-unit weighting becomes available when polygon geometry is exposed by the source service.',
    };
  } else {
    value = await fetchSoilGrids({ latitude: (bbox.south + bbox.north) / 2, longitude: (bbox.west + bbox.east) / 2 }, opts);
  }
  if (!opts.skipCache) cache.set(key, { at: Date.now(), value });
  return value;
}

async function fetchSoilGrids(point, opts) {
  const fetcher = opts.fetch || fetch;
  const p = new URLSearchParams({ lon: point.longitude, lat: point.latitude, property: 'phh2o,ocd,clay,sand,silt,bdod,cec,bedrock', depth: '0-5cm,5-15cm', value: 'mean' });
  try {
    const r = await fetcher(`${SOILGRIDS}?${p}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`SoilGrids ${r.status}`);
    const d = await r.json();
    const props = Object.fromEntries((d.properties?.layers || []).map(x => [x.name, x.depths?.[0]?.values?.mean]));
    const sand = scaled(props.sand), silt = scaled(props.silt), clay = scaled(props.clay);
    return { soil_data_source: 'SOILGRIDS_FALLBACK', confidence: 'moderate_low', soil_units: [{ area_pct_of_parcel: 100, soil_series: null, texture_class: usdaTexture(sand, silt, clay), drainage_class: null, parent_material: null, ph: scaled(props.phh2o), organic_carbon_pct: scaled(props.ocd), depth_to_bedrock_cm: scaled(props.bedrock) }], source_url: 'https://www.isric.org/explore/soilgrids', note: 'SoilGrids is a 250 m modelled global product, not a field survey; drainage is intentionally not inferred.' };
  } catch (e) {
    return { soil_data_source: 'SOILGRIDS_FALLBACK', confidence: 'unavailable', soil_units: [], error: e.message, source_url: 'https://www.isric.org/explore/soilgrids' };
  }
}
function scaled(x) { const n = Number(x); return Number.isFinite(n) ? n / 10 : null; }
function usdaTexture(sand, silt, clay) {
  if (![sand,silt,clay].every(Number.isFinite)) return null;
  if (clay >= 40) return sand >= 45 ? 'sandy_clay' : silt >= 40 ? 'silty_clay' : 'clay';
  if (clay >= 27) return sand >= 45 ? 'sandy_clay_loam' : silt >= 40 ? 'silty_clay_loam' : 'clay_loam';
  if (sand >= 85 && clay < 10) return 'sand';
  if (sand >= 70 && clay < 15) return 'loamy_sand';
  if (silt >= 80 && clay < 12) return 'silt';
  if (silt >= 50 && clay < 27) return 'silt_loam';
  if (sand >= 43 && clay < 20) return 'sandy_loam';
  return 'loam';
}
