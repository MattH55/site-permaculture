import { taxonIdFromName, canonicalName } from './taxonomy.js';

/** Merge plants that share a canonical scientific name. Never overwrite source names. */
export function mergePlants(lists) {
  const byId = new Map();
  const unresolved = [];
  for (const plant of lists.flat()) {
    const sci = plant.taxon?.scientific_name || plant.taxon?.canonical_name;
    const id = plant.taxon?.id || taxonIdFromName(sci || plant.taxon?.common_names?.[0] || '');
    if (!id) {
      unresolved.push({ original_name: plant.taxon?.scientific_name_source, reason: 'no_id' });
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, structuredClone(plant));
      byId.get(id).taxon.id = id;
      continue;
    }
    byId.set(id, deepMergePlant(byId.get(id), plant));
  }
  return { plants: [...byId.values()], unresolved };
}

function deepMergePlant(a, b) {
  const out = {
    taxon: { ...a.taxon, ...pickDefined(b.taxon) },
    climate: mergeObj(a.climate, b.climate),
    solar: mergeObj(a.solar, b.solar),
    soil: mergeObj(a.soil, b.soil),
    water: mergeObj(a.water, b.water),
    morphology: mergeObj(a.morphology, b.morphology),
    ecology: mergeEcology(a.ecology, b.ecology),
    uses: mergeUses(a.uses, b.uses),
    provenance: [...(a.provenance || []), ...(b.provenance || [])],
    sources: [...new Set([...(a.sources || []), ...(b.sources || [])])],
    source_record_id: a.source_record_id,
    gbif: a.gbif || b.gbif || null,
    occurrences: [...(a.occurrences || []), ...(b.occurrences || [])],
  };
  if (b.taxon?.scientific_name_source && b.taxon.scientific_name_source !== a.taxon?.scientific_name_source) {
    out.taxon.scientific_name_source = a.taxon.scientific_name_source;
    out.taxon.other_source_names = [
      ...(a.taxon.other_source_names || []),
      b.taxon.scientific_name_source,
    ];
  }
  if (b.taxon?.common_names?.length) {
    out.taxon.common_names = [...new Set([...(a.taxon.common_names || []), ...b.taxon.common_names])];
  }
  if (canonicalName(b.taxon?.accepted_name) && a.taxon?.taxonomic_status !== 'accepted') {
    out.taxon.accepted_name = b.taxon.accepted_name;
  }
  return out;
}

function mergeObj(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (out[k] == null || out[k] === '') out[k] = v;
    else if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = [...new Set([...out[k], ...v])];
  }
  return out;
}

function mergeEcology(a = {}, b = {}) {
  const o = mergeObj(a, b);
  o.native_regions = [...new Set([...(a.native_regions || []), ...(b.native_regions || [])])];
  return o;
}

function mergeUses(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v === true) out[k] = true;
    else if (out[k] == null) out[k] = v;
  }
  return out;
}

function pickDefined(obj = {}) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== '') o[k] = v;
  }
  return o;
}
