/**
 * CLAIMS / confidence helpers for satellite-derived fecundity fields.
 *
 * Rules (from INtegrate_sat_markdown.txt):
 * - Sentinel-2 vegetation indices → medium-high when multi-date / cloud-masked
 * - Regional SOC (SoilGrids etc.) → low / low-moderate context only
 * - Never emit a client-facing numeric SOC claim from satellite alone
 * - Carbon / credit language stays low-confidence-unless-lab-tested
 */

export const CONFIDENCE = {
  none: 'none',
  low: 'low',
  low_moderate: 'low-moderate',
  moderate: 'moderate',
  medium_high: 'medium-high',
  high: 'high',
  lab_required: 'low-confidence-unless-lab-tested',
};

/**
 * Build the carbon claim envelope. Satellite SOC may only appear under
 * regional_context — never as the primary numeric value.
 *
 * @param {{ regional_soc?: object|null, lab_soc_g_kg?: number|null, lab_om_pct?: number|null }} opts
 */
export function buildSocClaim(opts = {}) {
  const lab =
    opts.lab_soc_g_kg != null
      ? { value_g_kg: opts.lab_soc_g_kg, source: 'laboratory', confidence: CONFIDENCE.high }
      : opts.lab_om_pct != null
        ? {
            value_organic_matter_pct: opts.lab_om_pct,
            source: 'laboratory',
            confidence: CONFIDENCE.high,
          }
        : null;

  const regional = opts.regional_soc
    ? {
        ...opts.regional_soc,
        confidence: opts.regional_soc.confidence || CONFIDENCE.low_moderate,
        note:
          opts.regional_soc.note ||
          'Regional context only — not property-scale. Do not use for credits, certifications, or precise SOC claims.',
      }
    : null;

  return {
    field: 'soil_organic_carbon',
    value: lab ? lab.value_g_kg ?? lab.value_organic_matter_pct ?? null : null,
    unit: lab?.value_g_kg != null ? 'g/kg' : lab?.value_organic_matter_pct != null ? '%' : null,
    source: lab ? lab.source : 'none',
    confidence: lab ? lab.confidence : CONFIDENCE.none,
    allowed_claim: lab
      ? 'Numeric SOC / organic matter may be stated from laboratory (or calibrated drone + lab) results only.'
      : 'No numeric SOC claim without lab or calibrated drone data',
    regional_context: regional,
  };
}

/**
 * Tag a vegetation index field for the claims array.
 */
export function buildIndexClaim(field, indexObj) {
  if (!indexObj || indexObj.median == null) {
    return {
      field,
      value: null,
      source: 'none',
      confidence: CONFIDENCE.none,
      allowed_claim: 'No vegetation-index claim without satellite or field observation',
    };
  }
  return {
    field,
    value: indexObj.median,
    source: indexObj.source || 'Sentinel-2',
    confidence: indexObj.confidence || CONFIDENCE.medium_high,
    resolution_m: indexObj.resolution_m ?? 10,
    date: indexObj.date || null,
    allowed_claim:
      'Canopy vigor / cover statements at medium-high confidence when backed by cloud-masked Sentinel-2 (prefer multi-date).',
  };
}

/**
 * Carbon-related narrative helper — always injects disclaimer when no lab value.
 * @param {object} socClaim from buildSocClaim
 * @param {string} body free text mentioning carbon/OM
 */
export function carbonSafeText(socClaim, body) {
  if (!socClaim || socClaim.confidence === CONFIDENCE.high) return body;
  const disclaimer =
    ' Soil organic carbon remains low-confidence without laboratory verification; regional satellite/model layers are context only.';
  if (/carbon|organic matter|SOC|soil C/i.test(body) && !/laboratory verification|lab test/i.test(body)) {
    return body.trim() + disclaimer;
  }
  return body;
}

/**
 * Attribution string for maps and reports.
 */
export function satelliteAttribution() {
  return (
    'Sentinel-2 data via Copernicus / ESA (Microsoft Planetary Computer); ' +
    'Landsat via USGS; regional SOC from SoilGrids (ISRIC). ' +
    'Vegetation indices are property-scale indicators; soil organic carbon remains ' +
    'low-confidence without laboratory verification.'
  );
}
