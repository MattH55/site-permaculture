import crypto from 'node:crypto';

export const SOURCES = {
  ecocrop: {
    id: 'ecocrop',
    source_name: 'FAO EcoCrop',
    source_version: 'GAEZ/OpenCLIM EcoCrop_DB',
    source_url: 'https://www.fao.org/gaez/',
    license: 'FAO / public research use of EcoCrop parameters',
    citation: 'FAO EcoCrop crop environmental requirements database',
  },
  usda_plants: {
    id: 'usda_plants',
    source_name: 'USDA PLANTS',
    source_version: 'plantsservices.sc.egov.usda.gov',
    source_url: 'https://plants.usda.gov',
    license: 'Public domain',
    citation: 'USDA NRCS PLANTS Database',
  },
  gbif: {
    id: 'gbif',
    source_name: 'GBIF',
    source_version: 'api.gbif.org v1',
    source_url: 'https://www.gbif.org/',
    license: 'Varies by dataset (typically CC0 / CC BY)',
    citation: 'GBIF.org occurrence and taxonomic backbone',
  },
  catalog: {
    id: 'catalog',
    source_name: 'Land Intelligence curated catalog',
    source_version: 'alberta-catalog / alberta-natives / farmfit',
    source_url: null,
    license: 'Internal curated',
    citation: 'Land Intelligence Alberta plant catalog',
  },
  pfaf: {
    id: 'pfaf',
    source_name: 'PFAF',
    source_version: 'community SQLite mirror',
    source_url: 'https://pfaf.org',
    license: 'PFAF copyright — attribute; no commercial redistrib of raw DB',
    citation: 'Plants For A Future',
  },
};

export function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export function provenanceRow({ taxon_id, table_name, field_name, value, unit, source_id, source_record_id, confidence }) {
  if (value == null || value === '') return null;
  return {
    taxon_id,
    table_name,
    field_name,
    value,
    unit: unit || null,
    source_id,
    source_record_id: source_record_id || null,
    confidence: confidence ?? 0.85,
    retrieved_at: new Date().toISOString(),
  };
}

export function addProv(list, row) {
  const r = provenanceRow(row);
  if (r) list.push(r);
}
