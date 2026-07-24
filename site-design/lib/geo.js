/**
 * Geometry helpers for parcel → bbox → sampling grids.
 */

export function normalizePolygon(input) {
  // Accept { paths: [[lng,lat],...] } | { coordinates: [[lng,lat],...] } | GeoJSON Polygon
  let ring;
  if (input?.type === 'Polygon' && Array.isArray(input.coordinates?.[0])) {
    ring = input.coordinates[0].map(([lng, lat]) => [Number(lng), Number(lat)]);
  } else if (Array.isArray(input?.paths)) {
    // Google Drawing style: paths: [ ring ]  OR  paths: ring
    const first = input.paths[0];
    const isNestedRing =
      Array.isArray(first) &&
      (Array.isArray(first[0]) ||
        (first[0] && typeof first[0] === 'object' && ('lat' in first[0] || 'lng' in first[0])));
    const raw = isNestedRing ? first : input.paths;
    ring = raw.map((p) =>
      Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lng), Number(p.lat)]
    );
  } else if (Array.isArray(input?.coordinates)) {
    ring = input.coordinates.map((p) =>
      Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lng), Number(p.lat)]
    );
  } else if (Array.isArray(input) && input.length >= 3) {
    ring = input.map((p) =>
      Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lng), Number(p.lat)]
    );
  } else {
    throw new Error('Need a polygon with at least 3 vertices (lng/lat)');
  }

  // Drop closing duplicate if present
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) ring = ring.slice(0, -1);
  }
  if (ring.length < 3) throw new Error('Polygon needs at least 3 vertices');

  // Close ring for GeoJSON
  const closed = [...ring, ring[0]];
  return closed;
}

export function bboxFromRing(ring) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error('Invalid coordinates in polygon');
  }
  // Pad tiny parcels so DEM sampling has room
  const padLng = Math.max((east - west) * 0.05, 0.0003);
  const padLat = Math.max((north - south) * 0.05, 0.0002);
  return {
    west: west - padLng,
    south: south - padLat,
    east: east + padLng,
    north: north + padLat,
  };
}

export function bboxAreaHa(bbox) {
  // Approximate planar area of bbox
  const midLat = (bbox.south + bbox.north) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const w = (bbox.east - bbox.west) * mPerDegLng;
  const h = (bbox.north - bbox.south) * mPerDegLat;
  return (w * h) / 10_000;
}

/** Shoelace formula for polygon area (ha), WGS84 approx. */
export function polygonAreaHa(ring) {
  const closed =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];
  const midLat =
    closed.reduce((s, [, lat]) => s + lat, 0) / closed.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const [x1, y1] = closed[i];
    const [x2, y2] = closed[i + 1];
    sum += x1 * mPerDegLng * (y2 * mPerDegLat) - x2 * mPerDegLng * (y1 * mPerDegLat);
  }
  return Math.abs(sum) / 2 / 10_000;
}

export function centroid(ring) {
  let x = 0;
  let y = 0;
  const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? 1
    : 0);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return { longitude: x / n, latitude: y / n };
}

/** Build a lat/lng sampling grid inside bbox. */
export function sampleGrid(bbox, maxPoints = 64) {
  const aspect =
    Math.max(bbox.east - bbox.west, 1e-9) /
    Math.max(bbox.north - bbox.south, 1e-9);
  let cols = Math.max(3, Math.round(Math.sqrt(maxPoints * aspect)));
  let rows = Math.max(3, Math.round(maxPoints / cols));
  while (cols * rows > maxPoints) {
    if (cols >= rows) cols--;
    else rows--;
  }
  cols = Math.max(3, cols);
  rows = Math.max(3, rows);

  const lats = [];
  const lngs = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat =
        bbox.south + ((r + 0.5) / rows) * (bbox.north - bbox.south);
      const lng =
        bbox.west + ((c + 0.5) / cols) * (bbox.east - bbox.west);
      lats.push(lat);
      lngs.push(lng);
    }
  }
  return { lats, lngs, rows, cols };
}

/** Geohash-ish cache key from rounded bbox. */
export function cacheKey(bbox, precision = 4) {
  const f = (n) => n.toFixed(precision);
  return `bbox:${f(bbox.west)},${f(bbox.south)},${f(bbox.east)},${f(bbox.north)}`;
}

export function isInAlberta(lat, lng) {
  // Loose provincial envelope
  return lat >= 48.9 && lat <= 60.1 && lng >= -120.1 && lng <= -109.9;
}

export function esriEnvelope(bbox) {
  return JSON.stringify({
    xmin: bbox.west,
    ymin: bbox.south,
    xmax: bbox.east,
    ymax: bbox.north,
    spatialReference: { wkid: 4326 },
  });
}
