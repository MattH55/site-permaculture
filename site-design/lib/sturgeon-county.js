/**
 * Sturgeon County ArcGIS data extraction
 *
 * Queries the Sturgeon County Property Viewer FeatureServices
 * to retrieve parcel info, land use designation, and zoning for
 * any point within Sturgeon County.
 *
 * Source: https://sturgeoncounty.maps.arcgis.com/apps/instant/media/index.html?appid=5f73684b6e8c49508b6a153a679ae008
 * Webmap: 748b4f24f28345b1af0edee8c615d5b9
 */

const ARCGIS_BASE = 'https://services.arcgis.com/ix1ny7KGzblW5l6Y/arcgis/rest/services';

/** Parcel Information layer */
const PARCEL_URL = `${ARCGIS_BASE}/Sturgeon_PropertyInfo/FeatureServer/1`;

/** Land Use Bylaw 1385/17 layer */
const LUB_URL = `${ARCGIS_BASE}/LUB138517_view/FeatureServer/11`;

/** Neighbourhoods layer */
const NEIGHBOURHOOD_URL = `${ARCGIS_BASE}/Sturgeon_PropertyInfo/FeatureServer/2`;

/**
 * Query an ArcGIS FeatureServer layer at a point.
 * @param {string} serviceUrl - Full FeatureServer layer URL
 * @param {number} lat
 * @param {number} lng
 * @param {string[]} outFields
 * @param {number} [srOut=4326]
 * @returns {Promise<object[]>}
 */
async function queryAtPoint(serviceUrl, lat, lng, outFields = ['*'], srOut = 4326) {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: String(srOut),
    spatialRel: 'esriSpatialRelIntersects',
    outFields: outFields.join(','),
    returnGeometry: 'false',
    resultRecordCount: '10',
  });

  const url = `${serviceUrl}/query?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  return data.features || [];
}

/**
 * Query an ArcGIS FeatureServer layer by attribute.
 * @param {string} serviceUrl
 * @param {string} where - SQL where clause
 * @param {string[]} outFields
 * @returns {Promise<object[]>}
 */
async function queryByAttribute(serviceUrl, where, outFields = ['*']) {
  const params = new URLSearchParams({
    f: 'json',
    where,
    outFields: outFields.join(','),
    returnGeometry: 'false',
    resultRecordCount: '10',
  });

  const url = `${serviceUrl}/query?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  return data.features || [];
}

/**
 * Look up parcel information at a point.
 * Returns tax roll, address, legal description, ATS, property code, etc.
 */
async function lookupParcel(lat, lng) {
  const features = await queryAtPoint(PARCEL_URL, lat, lng, [
    'LINC', 'dROLLNMBR', 'FullAddress', 'Municipality', 'Neighbourhood',
    'LegalDescription', 'ATS', 'PropertyCode', 'PropertyDesc',
  ]);
  if (!features.length) return null;
  const a = features[0].attributes;
  return {
    linc: a.LINC || null,
    tax_roll: a.dROLLNMBR || null,
    full_address: a.FullAddress || null,
    municipality: a.Municipality || null,
    neighbourhood: a.Neighbourhood || null,
    legal_description: a.LegalDescription || null,
    ats: a.ATS || null,
    property_code: a.PropertyCode || null,
    property_description: a.PropertyDesc || null,
  };
}

/**
 * Look up land use bylaw designation at a point.
 * Returns district code, name, description, and direct control number.
 */
async function lookupLandUse(lat, lng) {
  const features = await queryAtPoint(LUB_URL, lat, lng, [
    'District_Code', 'DirectControlNo', 'District_Name', 'Description', 'TAXROLL',
  ]);
  if (!features.length) return null;
  const a = features[0].attributes;
  return {
    district_code: a.District_Code || null,
    district_name: a.District_Name || null,
    description: a.Description || null,
    direct_control_no: a.DirectControlNo || null,
    tax_roll: a.TAXROLL || null,
  };
}

/**
 * Look up neighbourhood at a point.
 */
async function lookupNeighbourhood(lat, lng) {
  const features = await queryAtPoint(NEIGHBOURHOOD_URL, lat, lng, [
    'Neighbourhood',
  ]);
  if (!features.length) return null;
  return features[0].attributes.Neighbourhood || null;
}

/**
 * Full Sturgeon County property lookup at a point.
 * Combines parcel, land use, and neighbourhood data.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{available: boolean, parcel?: object, land_use?: object, neighbourhood?: string, error?: string}>}
 */
async function querySturgeonCounty(lat, lng) {
  try {
    const [parcel, landUse, neighbourhood] = await Promise.all([
      lookupParcel(lat, lng).catch(() => null),
      lookupLandUse(lat, lng).catch(() => null),
      lookupNeighbourhood(lat, lng).catch(() => null),
    ]);

    if (!parcel && !landUse) {
      return {
        available: false,
        error: 'Point is outside Sturgeon County or no data available at this location.',
      };
    }

    return {
      available: true,
      parcel: parcel || undefined,
      land_use: landUse || undefined,
      neighbourhood: neighbourhood || undefined,
      source: 'Sturgeon County Property Viewer',
      source_url: 'https://sturgeoncounty.maps.arcgis.com/apps/instant/media/index.html?appid=5f73684b6e8c49508b6a153a679ae008',
    };
  } catch (err) {
    return {
      available: false,
      error: err.message,
    };
  }
}

/**
 * Interpret land use district code into permaculture-relevant categories.
 * Based on Sturgeon County Land Use Bylaw 1385/17.
 */
function interpretLandUse(landUse) {
  if (!landUse?.district_code) return null;
  const code = landUse.district_code.toUpperCase();
  const desc = (landUse.description || '').toLowerCase();

  const categories = {
    agricultural: false,
    residential: false,
    commercial: false,
    industrial: false,
    rural: false,
    direct_control: false,
    special: false,
  };

  // Sturgeon County district code prefixes
  if (code.startsWith('AG') || code.startsWith('A-') || desc.includes('agricultur')) {
    categories.agricultural = true;
    categories.rural = true;
  }
  if (code.startsWith('R') || code.startsWith('RES') || desc.includes('residenti')) {
    categories.residential = true;
  }
  if (code.startsWith('C') || code.startsWith('COM') || desc.includes('commerci')) {
    categories.commercial = true;
  }
  if (code.startsWith('I') || code.startsWith('IND') || desc.includes('industri')) {
    categories.industrial = true;
  }
  if (code.includes('DC') || landUse.direct_control_no) {
    categories.direct_control = true;
  }
  if (desc.includes('country') || desc.includes('estate') || desc.includes('rural')) {
    categories.rural = true;
  }

  // Permaculture implications
  const implications = [];
  if (categories.agricultural) {
    implications.push('Agricultural district — generally permits farming, horticulture, livestock, and accessory structures.');
  }
  if (categories.residential) {
    implications.push('Residential district — home-based agriculture likely permitted as accessory use; check bylaw for lot coverage and setback rules.');
  }
  if (categories.direct_control) {
    implications.push('Direct Control district — uses defined by specific DC agreement; review the DC document for permitted and discretionary uses.');
  }
  if (categories.rural && !categories.agricultural) {
    implications.push('Rural district — small-scale agriculture and animal husbandry typically permitted as accessory use.');
  }
  if (!categories.agricultural && !categories.rural) {
    implications.push('Non-rural district — intensive agriculture may require a development permit or discretionary use approval.');
  }

  return {
    ...categories,
    implications,
    bylaw_url: 'https://www.sturgeoncounty.ca/building-development/documents-studies/land-use-bylaw/',
  };
}

export {
  querySturgeonCounty,
  lookupParcel,
  lookupLandUse,
  lookupNeighbourhood,
  interpretLandUse,
  PARCEL_URL,
  LUB_URL,
  NEIGHBOURHOOD_URL,
};
