/** Name normalization and GBIF taxonomic matching. Never overwrite source names. */

export function canonicalName(scientific) {
  if (!scientific) return '';
  let s = String(scientific)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/\s+\([^)]*\)/g, '');
  s = s.replace(/\s+x\s+/i, ' × ');
  const words = s.split(' ');
  const keep = [];
  for (const w of words) {
    if (keep.length >= 2 && /^[A-Z]/.test(w) && w !== '×') break;
    keep.push(w);
  }
  return keep.join(' ').replace(/[.,;]+$/, '').trim();
}

export function taxonIdFromName(scientific) {
  const c = canonicalName(scientific).toLowerCase();
  return c
    .replace(/[^a-z0-9×]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function splitBinomial(scientific) {
  const c = canonicalName(scientific);
  const parts = c.split(/\s+/);
  return {
    genus: parts[0] || null,
    species: parts[1] && !parts[1].startsWith('×') ? parts[1] : null,
    canonical_name: c,
  };
}

export async function matchGbifName(scientific, fetchImpl = fetch) {
  const name = canonicalName(scientific);
  if (!name) return { match_method: 'empty', match_confidence: 0, original_name: scientific };
  const url = `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LandIntelligence/1.0 plant-intelligence' },
    });
    if (!res.ok) throw new Error(`GBIF ${res.status}`);
    const data = await res.json();
    const matched = data.matchType && data.matchType !== 'NONE';
    return {
      match_method: data.matchType || 'NONE',
      match_confidence: matched ? Math.min(1, (data.confidence || 80) / 100) : 0,
      original_name: scientific,
      accepted_name: data.canonicalName || data.scientificName || name,
      gbif_taxon_key: data.usageKey || data.speciesKey || null,
      rank: data.rank || null,
      kingdom: data.kingdom || null,
      phylum: data.phylum || null,
      class: data.class || null,
      order: data.order || null,
      family: data.family || null,
      genus: data.genus || null,
      species: data.species || null,
      taxonomic_status: data.status || (matched ? 'accepted' : 'unresolved'),
      raw: data,
    };
  } catch (e) {
    return {
      match_method: 'error',
      match_confidence: 0,
      original_name: scientific,
      accepted_name: name,
      error: e.message,
      taxonomic_status: 'unresolved',
    };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchGbifOccurrences(taxonKey, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const limit = opts.limit ?? 20;
  const bbox = opts.bbox || { west: -120, south: 49, east: -110, north: 60 }; // Alberta-first
  const url =
    `https://api.gbif.org/v1/occurrence/search?taxonKey=${encodeURIComponent(taxonKey)}` +
    `&decimalLatitude=${bbox.south},${bbox.north}&decimalLongitude=${bbox.west},${bbox.east}` +
    `&hasCoordinate=true&limit=${limit}&kingdomKey=6`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LandIntelligence/1.0 plant-intelligence' },
    });
    if (!res.ok) throw new Error(`GBIF occ ${res.status}`);
    const data = await res.json();
    return (data.results || []).map((r) => ({
      taxon_id: opts.taxon_id || null,
      latitude: r.decimalLatitude,
      longitude: r.decimalLongitude,
      elevation_m: r.elevation ?? null,
      country: r.country || r.countryCode || null,
      admin1: r.stateProvince || null,
      year: r.year || null,
      basis_of_record: r.basisOfRecord || null,
      dataset: r.datasetName || r.datasetKey || null,
      institution: r.institutionCode || null,
      source_record_id: String(r.key),
      source: 'GBIF',
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}
