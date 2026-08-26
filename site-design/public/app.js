/**
 * Land Intelligence — map-first Alberta site design
 * Draw parcel on topo map → POST /api/report → design report
 */

const ELEMENT_LABELS = {
  swale: 'Contour swale',
  terrace: 'Terrace',
  keyline_cultivation: 'Keyline cultivation',
  pond: 'Pond / dam',
  water_harvesting_earthwork: 'Water-harvesting earthwork',
  hugelkultur_mound: 'Hügelkultur / raised bed',
  windbreak: 'Windbreak / shelterbelt',
  shelterbelt_zone: 'Shelterbelt zone',
  food_forest_guild: 'Food forest guild',
  herb_spiral: 'Herb spiral',
  keyhole_bed: 'Keyhole bed',
  groundwater_well: 'Groundwater well',
};

/** Client-facing value labels (mirrors lib/recommendation-values.js taxonomy). */
const VALUE_LABELS = {
  water_storage: 'Water storage',
  water_harvest: 'Water harvest',
  erosion_control: 'Erosion control',
  wind_protection: 'Wind protection',
  snow_management: 'Snow management',
  microclimate: 'Microclimate',
  shade: 'Shade',
  food_production: 'Food',
  medicinal: 'Medicinal / herbal',
  soil_building: 'Soil building',
  nitrogen_fixing: 'Nitrogen fixing',
  biodiversity: 'Habitat / biodiversity',
  beauty_access: 'Beauty & access',
  compliance_safety: 'Compliance & risk',
};

/** Report flow: site → packages (Food/Water/Energy/Shelter) → evidence */
/**
 * Simplified IA (value → plan):
 *  1. Overview — simple map + headline facts + full findings (one scroll)
 *  2. Your plan — select / email / estimate / inquire
 * Planting planner stays a side beta offering.
 * (Full report HTML still built for PDF export only.)
 */
const CORE_LABELS = [
  { id: 'overview', label: 'Your site', color: 'var(--h1)' },
  { id: 'services', label: 'Your plan', color: 'var(--h7)' },
];
/** Side-rail add-ons — not part of the core site design package */
const SIDE_OFFERINGS = [
  {
    id: 'plant',
    label: 'Planting planner',
    badge: 'Beta',
    color: 'var(--h8)',
    blurb: 'Crop list, economics, and vendors — separate beta preview',
  },
];
const HORIZONS = CORE_LABELS.map((c) => c.color);
const SECTION_IDS = [
  ...CORE_LABELS.map((c) => c.id),
  ...SIDE_OFFERINGS.map((s) => s.id),
];

/** EE service labels for card CTAs (mirrors lib/recommendation-values.js). */
const EE_SERVICE_META = {
  water_earthworks_consult: {
    label: 'Water & earthworks consult',
    cta: 'Talk earthworks',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  well_drilling: {
    label: 'Groundwater well',
    cta: 'Plan a well',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  shelterbelt_design: {
    label: 'Shelterbelt design',
    cta: 'Design a shelterbelt',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  food_forest_design: {
    label: 'Food forest design',
    cta: 'Plan a food forest',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  soil_carbon_building: {
    label: 'Soil carbon building',
    cta: 'Build soil carbon',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  kitchen_garden_design: {
    label: 'Kitchen garden design',
    cta: 'Design Zone 1',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  solar_energy_package: {
    label: 'Solar + generator',
    cta: 'View energy packages',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  off_grid_garage: {
    label: 'Off-grid garage',
    cta: 'Reserve garage package',
    href: 'mailto:mhalma@opensourcemed.info',
  },
  full_site_design: {
    label: 'Full site design',
    cta: 'Book full design',
    href: 'mailto:mhalma@opensourcemed.info',
  },
};

const PILLAR_ORDER = ['water', 'food', 'energy', 'shelter'];
const COUNTY_ASSESSMENT_LINKS = [
  {
    name: 'Sturgeon County',
    url: 'https://data-sturgeoncounty.opendata.arcgis.com/maps/748b4f24f28345b1af0edee8c615d5b9/explore',
    detail: 'Property Viewer / Sturgeon County Atlas: search by address or roll number for assessed value, address, and property information.',
  },
  {
    name: 'Parkland County',
    url: 'https://www.parklandcounty.com/home-property-utilities/maps/',
    detail: 'Discover Parkland: property information, aerial imagery, and map tools. Assessment is updated annually using mass appraisal.',
  },
  {
    name: 'Leduc County',
    url: 'https://maps.leduc.ca/assessment/',
    detail: 'Property Assessment Viewer: search a parcel by address, roll number, or legal description.',
  },
];
const PILLAR_META = {
  water: { label: 'Water', client: 'Wells, swales, ponds' },
  food: { label: 'Food', client: 'Food forest & soil carbon building' },
  energy: { label: 'Energy', client: 'Solar power + generators' },
  shelter: { label: 'Shelter', client: 'Off-grid garage & wind belts' },
};

const state = {
  config: null,
  map: null,
  shape: null, // google.maps.Polygon | Rectangle
  preview: null, // polyline while drawing
  vertexMarkers: [],
  paths: null, // [[lng, lat], ...]
  report: null,
  mode: 'google', // or 'fallback'
  /** Phase 2: filter placement cards by primary/secondary value id, or 'all' */
  valueFilter: 'all',
  /** Phase 4: plant list value filter */
  plantValueFilter: 'all',
  /** Planting planner goals (max food, max nitrogen, lowest cost, …) */
  plantGoals: ['balanced'],
  plantScenario: 'market_garden',
  plantReplanning: false,
  /** Build-your-plan: selected intervention ids */
  selectedInterventions: null,
  /** Email captured for full report download */
  reportEmail: null,
  reportUnlocked: false,
  draw: {
    active: false,
    kind: null, // 'polygon' | 'rectangle'
    points: [], // google.maps.LatLng
    rectStart: null,
    rectShape: null,
    listeners: [],
  },
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const $ = (id) => document.getElementById(id);

/* ---------- bootstrap ---------- */

async function main() {
  const cfg = await fetch('/api/config').then((r) => r.json());
  state.config = cfg;

  // Always use Leaflet + Esri World Imagery (free, no API key)
  initLeafletMap(cfg);

  $('btn-draw-poly').onclick = () => startDraw('polygon');
  $('btn-draw-rect').onclick = () => startDraw('rectangle');
  $('btn-clear').onclick = clearShape;
  $('btn-report').onclick = generateReport;

  // 2D / 3D view toggle
  const btn2d = $('btn-2d-view');
  const btn3d = $('btn-3d-view');
  if (btn2d && btn3d) {
    btn2d.onclick = () => {
      switchTo2DView();
      btn2d.classList.add('is-active');
      btn2d.setAttribute('aria-pressed', 'true');
      btn3d.classList.remove('is-active');
      btn3d.setAttribute('aria-pressed', 'false');
    };
    btn3d.onclick = () => {
      switchTo3DView();
      btn3d.classList.add('is-active');
      btn3d.setAttribute('aria-pressed', 'true');
      btn2d.classList.remove('is-active');
      btn2d.setAttribute('aria-pressed', 'false');
    };
  }

  // Address search via Nominatim (free OSM geocoder)
  initPlaceSearch();

  // Coordinate input
  $('btn-go-coords')?.addEventListener('click', goToCoordinates);
  mainPostInit();
}

function initLeafletMap(cfg) {
  state.mode = 'leaflet';
  const el = $('map');
  el.innerHTML = '';
  el.classList.remove('fallback-map');

  const center = cfg.defaultCenter || { lat: 53.55, lng: -113.5 };
  const zoom = cfg.defaultZoom || 10;

  const map = L.map(el, {
    center: [center.lat, center.lng],
    zoom: zoom,
    zoomControl: true,
    attributionControl: true,
  });

  // Esri World Imagery (satellite) — free, no key required
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA FSA, USGS, Aerogrid, IGN, IGP, and the GIS User Community',
    maxZoom: 20,
  }).addTo(map);

  // Also add a labels overlay (World Transportation)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri',
    maxZoom: 20,
    opacity: 0.5,
  }).addTo(map);

  state.map = map;
  state._leafletMap = map;
  // In-progress drawing (vertices, rubber-band) vs finished parcel outline
  state._drawLayer = L.layerGroup().addTo(map);
  state._shapeLayer = L.layerGroup().addTo(map);
  state._previewRect = null;
  state._previewPoly = null;

  // Keep tiles sharp after orientation / layout changes (mobile critical)
  const resizeMap = () => {
    try { map.invalidateSize({ animate: false }); } catch { /* ignore */ }
  };
  window.addEventListener('resize', resizeMap, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(resizeMap, 200), { passive: true });
  setTimeout(resizeMap, 100);

  // Double-click to finish polygon drawing
  map.on('dblclick', (e) => {
    if (state.draw.active && state.draw.kind === 'polygon') {
      L.DomEvent.stop(e);
      finishPolygonDraw();
    }
  });

  // Live rubber-band while drawing (mousemove)
  map.on('mousemove', (e) => leafletDrawMouseMove(e));

  $('draw-hint').textContent = 'Satellite map ready. Drag to pan · scroll to zoom · Draw parcel to outline land.';
  setDrawButtons(null);
}

function initPlaceSearch() {
  const input = $('search-box');
  if (!input || typeof google === 'undefined' || !google.maps?.places) return;
  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: 'ca' },
    fields: ['geometry', 'name', 'formatted_address'],
    types: ['geocode', 'establishment'],
  });
  autocomplete.bindTo('bounds', state.map);
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry?.location) return;
    state.map.setCenter(place.geometry.location);
    state.map.setZoom(15);
    $('search-box').value = place.name || place.formatted_address || '';
  });
}

function goToCoordinates() {
  if (!state.map) return;
  const latStr = $('coord-lat')?.value?.trim();
  const lngStr = $('coord-lng')?.value?.trim();
  if (!latStr || !lngStr) return;
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (isNaN(lat) || isNaN(lng)) {
    setError('Invalid coordinates. Use decimal degrees (e.g. 53.55, -113.5).');
    return;
  }
  state.map.setCenter({ lat, lng });
  state.map.setZoom(16);
  setError('');
}

function mainPostInit() {
  $('btn-back-map').onclick = showMap;
  $('btn-back-map-top')?.addEventListener('click', showMap);
  $('btn-open-plant')?.addEventListener('click', () => switchReportPane('plant'));
  $('tab-site')?.addEventListener('click', () => switchReportPane('overview'));
  $('tab-plant')?.addEventListener('click', () => switchReportPane('plant'));
  $('btn-pdf-all')?.addEventListener('click', downloadFullPdf);

  // Global nav helpers (onclick-safe; survives re-renders)
  window.__eeNav = (pane) => {
    try {
      switchReportPane(pane);
    } catch (e) {
      console.warn('nav failed', e);
    }
  };
  window.__eeScrollFindings = () => {
    switchReportPane('overview');
    requestAnimationFrame(() => {
      const el =
        document.getElementById('site-findings') ||
        document.getElementById('findings-water');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Delegated nav for data-* attributes
  $('report-stage')?.addEventListener('click', (ev) => {
    const findings = ev.target.closest(
      '[data-open-findings], [data-open-findings-link], [data-scroll-findings]'
    );
    if (findings) {
      ev.preventDefault();
      window.__eeScrollFindings();
      return;
    }
    const plan = ev.target.closest(
      '[data-open-your-plan], [data-open-your-plan-findings], [data-open-your-plan-rules]'
    );
    if (plan) {
      ev.preventDefault();
      switchReportPane('services');
      return;
    }
    const plant = ev.target.closest('[data-open-plant-beta]');
    if (plant) {
      ev.preventDefault();
      switchReportPane('plant');
    }
  });

  $('btn-cancel-load')?.addEventListener('click', () => {
    state._reportAbort?.abort();
    clearInterval(state._loadTimer);
    showLoading(false);
    setError('Cancelled.');
  });
}

function switchReportPane(which) {
  // Legacy / alias pane ids → current IA
  const aliases = {
    findings: 'overview', // findings live on overview as one scroll
    water: 'overview',
    energy: 'overview',
    food: 'overview',
    shelter: 'overview',
    topo: 'overview',
    fecundity: 'overview',
    rules: 'overview',
    site: 'overview',
    plan: 'services',
  };
  which = aliases[which] || which;

  const paneId = which === 'plant' ? 'pane-plant' : `pane-${which}`;
  let target = document.getElementById(paneId);
  // Fallbacks if deploy HTML is out of date
  if (!target && which === 'overview') {
    target = document.getElementById('pane-overview') || document.getElementById('report-overview')?.closest('.report-pane');
  }
  if (!target && which === 'services') {
    target = document.getElementById('pane-services');
  }
  if (!target) {
    console.warn('switchReportPane: missing pane', paneId);
    return;
  }

  document.querySelectorAll('.report-pane').forEach((p) => {
    if (p.id === 'pane-site' || p.id === 'pane-findings') {
      // PDF host + retired findings pane stay hidden
      p.hidden = true;
      p.classList.remove('is-active');
      p.style.display = 'none';
      return;
    }
    p.classList.remove('is-active');
    p.hidden = true;
    p.style.display = 'none';
  });

  target.classList.add('is-active');
  target.hidden = false;
  target.removeAttribute('hidden');
  target.style.display = 'block';

  document.querySelectorAll('#report-core .step-row, #report-side-offerings [data-pane]').forEach((sr) => {
    const on = sr.dataset.pane === which;
    sr.classList.toggle('is-active-pane', on);
    if (on && isMobileLayout()) {
      sr.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  const tabSite = $('tab-site');
  const tabPlant = $('tab-plant');
  const isPlant = which === 'plant';
  tabSite?.classList.toggle('is-active', !isPlant);
  tabPlant?.classList.toggle('is-active', isPlant);
  tabSite?.setAttribute('aria-selected', String(!isPlant));
  tabPlant?.setAttribute('aria-selected', String(isPlant));
  document.body.classList.toggle('is-plant-pane', isPlant);

  setTimeout(() => {
    target.querySelectorAll('.minimap-embed, .report-map').forEach((el) => {
      const map = el._eeLeafletMap;
      if (map && typeof map.invalidateSize === 'function') {
        try {
          map.invalidateSize({ animate: false });
        } catch { /* ignore */ }
      }
    });
  }, 120);

  if (which !== 'overview') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    // Drawing library was removed from Maps JS (mid-2026). We draw with
    // native map click listeners + Polygon/Rectangle instead.
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=geometry,places&v=weekly&loading=async`;
    s.async = true;
    s.onload = () => {
      // geometry may load slightly after script.onload on some builds
      const wait = () => {
        if (window.google?.maps?.Map) resolve();
        else setTimeout(wait, 30);
      };
      wait();
    };
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
}

/* ---------- Google Maps (custom draw — no deprecated DrawingManager) ---------- */

function styleOpts(extra = {}) {
  return {
    fillColor: '#5b3a73',
    fillOpacity: 0.28,
    strokeColor: '#5b3a73',
    strokeWeight: 2.5,
    clickable: true,
    editable: false,
    draggable: false,
    zIndex: 2,
    ...extra,
  };
}

function mapGestureOpts(drawing = false) {
  return {
    // Always allow pan/zoom; drawing only changes the cursor hint
    draggable: true,
    gestureHandling: 'greedy',
    scrollwheel: true,
    disableDoubleClickZoom: drawing,
    draggableCursor: drawing ? 'crosshair' : null,
    draggingCursor: 'move',
    clickableIcons: false,
    keyboardShortcuts: true,
  };
}

function initGoogleMap(cfg) {
  state.mode = 'google';
  const el = $('map');
  const map = new google.maps.Map(el, {
    center: cfg.defaultCenter || { lat: 53.55, lng: -113.5 },
    zoom: cfg.defaultZoom || 10,
    mapTypeId: 'satellite',
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      mapTypeIds: ['satellite', 'hybrid', 'roadmap', 'terrain'],
    },
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    ...mapGestureOpts(false),
  });
  state.map = map;

  // Finish polygon on double-click (prevent zoom only while drawing)
  map.addListener('dblclick', (e) => {
    if (state.draw.active && state.draw.kind === 'polygon') {
      e.stop?.();
      finishPolygonDraw();
    }
  });

  // If the map container was resized (mobile chrome, fonts), force a relayout
  google.maps.event.addListenerOnce(map, 'idle', () => {
    google.maps.event.trigger(map, 'resize');
  });

  $('draw-hint').textContent =
    'Topographic map ready. Drag to pan · scroll to zoom · Draw parcel to outline land.';
  setDrawButtons(null);
}

function setDrawButtons(activeKind) {
  const poly = $('btn-draw-poly');
  const rect = $('btn-draw-rect');
  if (poly) {
    poly.setAttribute('aria-pressed', activeKind === 'polygon' ? 'true' : 'false');
    poly.classList.toggle('is-active', activeKind === 'polygon');
  }
  if (rect) {
    rect.setAttribute('aria-pressed', activeKind === 'rectangle' ? 'true' : 'false');
    rect.classList.toggle('is-active', activeKind === 'rectangle');
  }
  const mapDiv = $('map');
  if (mapDiv) {
    // Override Leaflet's .leaflet-grab cursor with !important
    if (activeKind) {
      mapDiv.style.setProperty('cursor', 'crosshair', 'important');
      mapDiv.classList.add('is-drawing');
    } else {
      mapDiv.style.setProperty('cursor', '', 'important');
      mapDiv.classList.remove('is-drawing');
    }
  }
}

function detachDrawListeners() {
  state._leafletMap?.off('click', state._drawClickHandler);
  state._drawClickHandler = null;
}

function clearDrawPreview() {
  state._drawLayer?.clearLayers();
  state._previewRect = null;
  state._previewPoly = null;
  state.preview = null;
}

function stopDrawingMode({ clearInProgress = true } = {}) {
  detachDrawListeners();
  state.draw.active = false;
  state.draw.kind = null;
  state.draw.points = [];
  state.draw.rectStart = null;
  if (clearInProgress) clearDrawPreview();
  setDrawButtons(null);
}

function startDraw(kind) {
  setError('');
  clearShape(false);
  stopDrawingMode();

  state.draw.active = true;
  state.draw.kind = kind;
  state.draw.points = [];
  state.draw.rectStart = null;
  setDrawButtons(kind);

  if (kind === 'polygon') {
    $('draw-hint').textContent = 'Click the map to place corners. Double-click (or press Finish) to close the parcel.';
    ensureFinishButton(true);
    state._drawClickHandler = (e) => leafletPolygonClick(e);
    state._leafletMap.on('click', state._drawClickHandler);
  } else {
    ensureFinishButton(false);
    $('draw-hint').textContent = 'Click one corner of the parcel, then click the opposite corner. Move the mouse to preview the rectangle.';
    state._drawClickHandler = (e) => leafletRectClick(e);
    state._leafletMap.on('click', state._drawClickHandler);
  }
}

/** Live rubber-band: polygon closing edge / rectangle from first corner. */
function leafletDrawMouseMove(e) {
  if (!state.draw.active || !state._drawLayer || !e?.latlng) return;
  const ll = e.latlng;

  if (state.draw.kind === 'rectangle' && state.draw.rectStart) {
    const a = state.draw.rectStart;
    const path = [
      [a.lat, a.lng],
      [ll.lat, a.lng],
      [ll.lat, ll.lng],
      [a.lat, ll.lng],
    ];
    redrawInProgress({
      markers: [[a.lat, a.lng]],
      polygon: path,
      dashed: true,
    });
    return;
  }

  if (state.draw.kind === 'polygon' && state.draw.points.length >= 1) {
    const pts = state.draw.points.map((p) => [p.lat, p.lng]);
    const cursor = [ll.lat, ll.lng];
    const line = [...pts, cursor];
    // Preview fill when ≥2 corners (triangle with cursor)
    const poly = state.draw.points.length >= 2 ? [...pts, cursor] : null;
    redrawInProgress({
      markers: pts,
      polyline: line,
      polygon: poly,
      dashed: true,
    });
  }
}

/**
 * Redraw in-progress drawing graphics (keeps finished shape on _shapeLayer).
 * @param {{ markers?: number[][], polyline?: number[][], polygon?: number[][], dashed?: boolean }} opts
 */
function redrawInProgress(opts = {}) {
  if (!state._drawLayer) return;
  state._drawLayer.clearLayers();
  const color = '#5b3a73';
  const gold = '#a8801f';

  if (opts.polygon?.length >= 3) {
    L.polygon(opts.polygon, {
      color: gold,
      fillColor: gold,
      fillOpacity: opts.dashed ? 0.12 : 0.22,
      weight: 2.5,
      dashArray: opts.dashed ? '6 4' : null,
      interactive: false,
    }).addTo(state._drawLayer);
  } else if (opts.polyline?.length >= 2) {
    L.polyline(opts.polyline, {
      color: gold,
      weight: 2.5,
      opacity: 0.95,
      dashArray: opts.dashed ? '6 4' : null,
      interactive: false,
    }).addTo(state._drawLayer);
  }

  (opts.markers || []).forEach((m) => {
    L.circleMarker(m, {
      radius: 5,
      fillColor: color,
      fillOpacity: 1,
      color: '#f7f8f3',
      weight: 2,
      interactive: false,
    }).addTo(state._drawLayer);
  });
}

function setFinishedParcelShape(latlngs) {
  if (!state._shapeLayer || !state._leafletMap) return;
  state._shapeLayer.clearLayers();
  if (!latlngs?.length) return;
  const poly = L.polygon(latlngs, {
    color: '#a8801f',
    fillColor: '#a8801f',
    fillOpacity: 0.22,
    weight: 3,
  }).addTo(state._shapeLayer);
  try {
    state._leafletMap.fitBounds(poly.getBounds(), { padding: [36, 36], maxZoom: 18 });
  } catch { /* ignore */ }
}

function ensureFinishButton(show) {
  let btn = $('btn-finish-poly');
  if (!show) {
    if (btn) btn.hidden = true;
    return;
  }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-finish-poly';
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Finish parcel';
    btn.onclick = () => finishPolygonDraw();
    $('btn-draw-rect')?.parentElement?.appendChild(btn);
  }
  btn.hidden = false;
  btn.disabled = true;
}

function leafletPolygonClick(e) {
  if (!state.draw.active || state.draw.kind !== 'polygon') return;
  L.DomEvent.stopPropagation(e);
  const ll = e.latlng;
  state.draw.points.push(ll);

  const pts = state.draw.points.map((p) => [p.lat, p.lng]);
  redrawInProgress({
    markers: pts,
    polyline: pts.length >= 2 ? pts : null,
    polygon: pts.length >= 3 ? pts : null,
    dashed: false,
  });

  const finishBtn = $('btn-finish-poly');
  if (finishBtn) finishBtn.disabled = state.draw.points.length < 3;

  $('draw-hint').textContent = state.draw.points.length < 3
    ? `Corner ${state.draw.points.length} placed — need at least 3. Move mouse to preview the edge.`
    : `${state.draw.points.length} corners — move mouse to preview · double-click or Finish to close.`;
}

function finishPolygonDraw() {
  if (!state.draw.active || state.draw.kind !== 'polygon') return;
  if (state.draw.points.length < 3) {
    setError('Need at least 3 corners to make a parcel.');
    return;
  }
  const latlngs = state.draw.points.map((ll) => [ll.lat, ll.lng]);
  state.paths = latlngs.map(([lat, lng]) => [lng, lat]);
  state.shape = { leaflet: true };
  clearDrawPreview();
  setFinishedParcelShape(latlngs);
  stopDrawingMode({ clearInProgress: true });
  ensureFinishButton(false);
  updateParcelMeta();
  $('draw-hint').textContent = 'Parcel set. Generate site report.';
  setError('');
}

function leafletRectClick(e) {
  if (!state.draw.active || state.draw.kind !== 'rectangle') return;
  L.DomEvent.stopPropagation(e);
  const ll = e.latlng;
  if (!state.draw.rectStart) {
    state.draw.rectStart = ll;
    redrawInProgress({ markers: [[ll.lat, ll.lng]] });
    $('draw-hint').textContent = 'Move the mouse to stretch the rectangle, then click the opposite corner.';
    return;
  }
  const a = state.draw.rectStart;
  const b = ll;
  const path = [[a.lat, a.lng], [b.lat, a.lng], [b.lat, b.lng], [a.lat, b.lng]];
  state.paths = path.map(([lat, lng]) => [lng, lat]);
  state.shape = { leaflet: true };
  clearDrawPreview();
  setFinishedParcelShape(path);
  stopDrawingMode({ clearInProgress: true });
  updateParcelMeta();
  $('draw-hint').textContent = 'Parcel set. Generate site report.';
}

function pathFromPolygon(poly) {
  const path = poly.getPath();
  const out = [];
  for (let i = 0; i < path.getLength(); i++) {
    const ll = path.getAt(i);
    out.push([ll.lng(), ll.lat()]);
  }
  return out;
}

function pathFromRect(rect) {
  const b = rect.getBounds();
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  return [
    [sw.lng(), sw.lat()],
    [ne.lng(), sw.lat()],
    [ne.lng(), ne.lat()],
    [sw.lng(), ne.lat()],
  ];
}

function clearShape(resetHint = true) {
  stopDrawingMode({ clearInProgress: true });
  ensureFinishButton(false);

  if (state.shape) {
    if (state.mode === 'google' && state.shape.setMap) state.shape.setMap(null);
    state.shape = null;
  }
  state._shapeLayer?.clearLayers();
  clearDrawPreview();
  if (state.mode === 'fallback') fallbackClear();
  state.paths = null;
  $('btn-report').disabled = true;
  $('parcel-meta').hidden = true;
  if (resetHint) {
    $('draw-hint').textContent =
      'Click Draw parcel, then click the map to place corners (double-click to finish). Use Rectangle for a box — drag-preview shows as you move.';
  }
  setError('');
}

/* ---------- Fallback map (no API key): Leaflet-free canvas + OpenStreetMap tiles via img not possible easily without lib
   Use simple pan/zoom OSM tiles with click-to-draw polygon ---------- */

function initFallbackMap(cfg) {
  state.mode = 'fallback';
  const el = $('map');
  el.classList.add('fallback-map');
  el.innerHTML = '';

  // Lightweight canvas + OSM tiles
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.cursor = 'crosshair';
  el.appendChild(canvas);

  const fb = {
    canvas,
    ctx: null,
    center: { ...cfg.defaultCenter },
    zoom: 11,
    points: [],
    drawing: false,
    rectMode: false,
    rectStart: null,
    drag: null,
    tiles: new Map(),
  };
  state.fallback = fb;

  const resize = () => {
    const r = el.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    fb.ctx = canvas.getContext('2d');
    fb.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawFallback();
  };
  window.addEventListener('resize', resize);
  resize();

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const ll = screenToLatLng(e, fb, el);
    // Left-drag pans when not placing corners; while drawing, small moves still pan if drag > threshold
    fb.pointer = {
      x: e.clientX,
      y: e.clientY,
      c: { ...fb.center },
      ll,
      moved: false,
      isDrawClick: !!(fb.drawing || fb.rectMode),
    };
  });

  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (fb.drawing && fb.points.length >= 3) {
      fb.drawing = false;
      commitFallbackPolygon();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!fb.pointer) {
      if (fb.rectMode && fb.rectStart) {
        const ll = screenToLatLng(e, fb, el);
        const a = fb.rectStart;
        fb.points = [
          { lng: a.lng, lat: a.lat },
          { lng: ll.lng, lat: a.lat },
          { lng: ll.lng, lat: ll.lat },
          { lng: a.lng, lat: ll.lat },
        ];
        drawFallback();
      }
      return;
    }
    const dx = e.clientX - fb.pointer.x;
    const dy = e.clientY - fb.pointer.y;
    if (Math.hypot(dx, dy) > 4) fb.pointer.moved = true;
    // Pan whenever the pointer has moved (works with or without draw mode)
    if (fb.pointer.moved) {
      const world = 256 * Math.pow(2, fb.zoom);
      fb.center.lng = fb.pointer.c.lng - (dx / world) * 360;
      const cos = Math.cos((fb.pointer.c.lat * Math.PI) / 180) || 0.2;
      fb.center.lat = fb.pointer.c.lat + (dy / world) * (360 * cos);
      fb.center.lat = Math.max(-85, Math.min(85, fb.center.lat));
      drawFallback();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    const p = fb.pointer;
    fb.pointer = null;
    if (!p || p.moved) return; // was a pan, not a click
    const ll = p.ll || screenToLatLng(e, fb, el);
    if (fb.rectMode) {
      if (!fb.rectStart) {
        fb.rectStart = ll;
        fb.points = [ll];
      } else {
        const a = fb.rectStart;
        const b = ll;
        fb.points = [
          { lng: a.lng, lat: a.lat },
          { lng: b.lng, lat: a.lat },
          { lng: b.lng, lat: b.lat },
          { lng: a.lng, lat: b.lat },
        ];
        fb.rectStart = null;
        fb.drawing = false;
        fb.rectMode = false;
        commitFallbackPolygon();
      }
      drawFallback();
      return;
    }
    if (!fb.drawing) return;
    fb.points.push(ll);
    drawFallback();
  });

  canvas.addEventListener('mouseleave', () => {
    fb.pointer = null;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    fb.zoom = Math.min(16, Math.max(5, fb.zoom + (e.deltaY > 0 ? -1 : 1)));
    drawFallback();
  }, { passive: false });

  $('draw-hint').textContent =
    'No Google Maps key — OpenStreetMap fallback. Drag to pan, scroll to zoom, Draw parcel for corners.';
  drawFallback();
}

function fallbackStartDraw(kind) {
  const fb = state.fallback;
  fb.points = [];
  fb.rectStart = null;
  state.paths = null;
  $('btn-report').disabled = true;
  if (kind === 'rectangle') {
    fb.rectMode = true;
    fb.drawing = false;
    $('draw-hint').textContent = 'Click two corners of the rectangle.';
  } else {
    fb.rectMode = false;
    fb.drawing = true;
    $('draw-hint').textContent = 'Click vertices. Double-click to close the parcel.';
  }
  drawFallback();
}

function fallbackClear() {
  if (!state.fallback) return;
  state.fallback.points = [];
  state.fallback.drawing = false;
  state.fallback.rectMode = false;
  state.fallback.rectStart = null;
  drawFallback();
}

function commitFallbackPolygon() {
  const fb = state.fallback;
  if (fb.points.length < 3) return;
  state.paths = fb.points.map((p) => [p.lng, p.lat]);
  state.shape = { fallback: true };
  updateParcelMeta();
  $('draw-hint').textContent = 'Parcel set. Generate the site report when ready.';
}

function screenToLatLng(e, fb, el) {
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const world = 256 * Math.pow(2, fb.zoom);
  const cx = ((fb.center.lng + 180) / 360) * world;
  const siny = Math.sin((fb.center.lat * Math.PI) / 180);
  const cy =
    (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * world;
  const wx = cx + (x - r.width / 2);
  const wy = cy + (y - r.height / 2);
  const lng = (wx / world) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * wy) / world;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function latLngToScreen(ll, fb, el) {
  const r = el.getBoundingClientRect();
  const world = 256 * Math.pow(2, fb.zoom);
  const cx = ((fb.center.lng + 180) / 360) * world;
  const siny = Math.sin((fb.center.lat * Math.PI) / 180);
  const cy =
    (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * world;
  const wx = ((ll.lng + 180) / 360) * world;
  const s = Math.sin((ll.lat * Math.PI) / 180);
  const wy =
    (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world;
  return {
    x: r.width / 2 + (wx - cx),
    y: r.height / 2 + (wy - cy),
  };
}

function drawFallback() {
  const fb = state.fallback;
  if (!fb?.ctx) return;
  const el = $('map');
  const r = el.getBoundingClientRect();
  const ctx = fb.ctx;
  ctx.clearRect(0, 0, r.width, r.height);

  // OSM tiles
  const z = Math.floor(fb.zoom);
  const world = 256 * Math.pow(2, z);
  const cx = ((fb.center.lng + 180) / 360) * world;
  const siny = Math.sin((fb.center.lat * Math.PI) / 180);
  const cy =
    (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * world;
  const topLeftX = cx - r.width / 2;
  const topLeftY = cy - r.height / 2;
  const t0x = Math.floor(topLeftX / 256);
  const t0y = Math.floor(topLeftY / 256);
  const t1x = Math.floor((topLeftX + r.width) / 256);
  const t1y = Math.floor((topLeftY + r.height) / 256);
  const nTiles = Math.pow(2, z);

  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      if (ty < 0 || ty >= nTiles) continue;
      const txx = ((tx % nTiles) + nTiles) % nTiles;
      const key = `${z}/${txx}/${ty}`;
      let img = fb.tiles.get(key);
      if (!img) {
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => drawFallback();
        img.src = `https://tile.openstreetmap.org/${z}/${txx}/${ty}.png`;
        fb.tiles.set(key, img);
      }
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, tx * 256 - topLeftX, ty * 256 - topLeftY, 256, 256);
      } else {
        ctx.fillStyle = '#c5c9bc';
        ctx.fillRect(tx * 256 - topLeftX, ty * 256 - topLeftY, 256, 256);
      }
    }
  }

  // subtle topo wash
  ctx.fillStyle = 'rgba(91, 58, 115, 0.04)';
  ctx.fillRect(0, 0, r.width, r.height);

  // polygon
  if (fb.points.length) {
    ctx.beginPath();
    fb.points.forEach((p, i) => {
      const s = latLngToScreen(p, fb, el);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    if (!fb.drawing && !fb.rectMode) ctx.closePath();
    ctx.fillStyle = 'rgba(91, 58, 115, 0.22)';
    if (!fb.drawing && fb.points.length >= 3) ctx.fill();
    ctx.strokeStyle = '#5b3a73';
    ctx.lineWidth = 2;
    ctx.stroke();
    fb.points.forEach((p) => {
      const s = latLngToScreen(p, fb, el);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#5b3a73';
      ctx.fill();
    });
  }

  // attribution
  ctx.fillStyle = 'rgba(247,248,243,0.85)';
  ctx.fillRect(8, r.height - 22, 210, 16);
  ctx.fillStyle = '#46584c';
  ctx.font = '11px sans-serif';
        ctx.fillText('© OpenStreetMap · Land Intelligence fallback map', 12, r.height - 10);
}

/* ---------- parcel meta ---------- */

function updateParcelMeta() {
  if (!state.paths || state.paths.length < 3) {
    $('btn-report').disabled = true;
    $('parcel-meta').hidden = true;
    return;
  }
  const area = approxAreaHa(state.paths);
  const bb = bbox(state.paths);
  $('parcel-meta').hidden = false;
  $('parcel-meta').textContent =
    `${state.paths.length} vertices · ~${area.toFixed(2)} ha · ` +
    `${bb.south.toFixed(4)}–${bb.north.toFixed(4)} N · ` +
    `${bb.west.toFixed(4)}–${bb.east.toFixed(4)} W`;
  $('btn-report').disabled = false;
}

function bbox(paths) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of paths) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function approxAreaHa(paths) {
  const ring = [...paths];
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  const mid = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((mid * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum +=
      ring[i][0] * mLng * (ring[i + 1][1] * mLat) -
      ring[i + 1][0] * mLng * (ring[i][1] * mLat);
  }
  return Math.abs(sum) / 2 / 10000;
}

/* ---------- report generation ---------- */

async function generateReport() {
  if (!state.paths || state.paths.length < 3) return;
  setError('');
  showLoading(true);
  pulseLoading();

  const ctrl = new AbortController();
  state._reportAbort = ctrl;
  // Free-tier hosts + satellite layers can exceed 90s on cold start; soft pipeline
  // timeouts still return a report, but keep a long client ceiling as safety net.
  const timeoutMs = 180_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        site_name: $('site_name').value.trim(),
        // paths: closed ring of [lng, lat] — same shape pipeline expects
        polygon: { paths: state.paths },
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Server returned a non-JSON response');
    }
    if (!res.ok) throw new Error(data.error || `Report failed (${res.status})`);
    state.report = data;
    finishLoading();
    try {
      renderReport(data);
      showReport();
      // Maps after the pane is visible — avoids Leaflet parentNode errors on hidden containers
      setTimeout(() => {
        try {
          initReportMapEmbed(state.report);
        } catch (mapErr) {
          console.warn('Map embed failed (report still shown)', mapErr);
        }
      }, 80);
    } catch (renderErr) {
      console.error(renderErr);
      showLoading(false);
      setError('Report ready but display failed: ' + (renderErr.message || renderErr));
    }
  } catch (e) {
    showLoading(false);
    const msg =
      e.name === 'AbortError'
        ? 'Timed out waiting for land data after 3 minutes. The first request after idle can be slow — try Generate again (often cached). A smaller parcel also helps.'
        : e.message || 'Could not generate report';
    setError(msg);
  } finally {
    clearTimeout(timer);
    clearInterval(state._loadTimer);
  }
}

function showLoading(on) {
  const el = $('loading');
  if (!el) return;
  el.hidden = !on;
  // Belt-and-suspenders in case CSS fights [hidden]
  el.style.display = on ? 'grid' : 'none';
  if (on) {
    document.querySelectorAll('#loading-steps li').forEach((li) => {
      li.dataset.on = '0';
      li.dataset.done = '0';
    });
    const sub = el.querySelector('h2');
    if (sub) sub.textContent = 'Reading the land…';
  }
}

function pulseLoading() {
  clearInterval(state._loadTimer);
  const steps = [...document.querySelectorAll('#loading-steps li')];
  let i = 0;
  const started = Date.now();
  state._loadTimer = setInterval(() => {
    steps.forEach((li, n) => {
      if (n < i) {
        li.dataset.done = '1';
        li.dataset.on = '0';
      } else if (n === i) {
        li.dataset.on = '1';
        li.dataset.done = '0';
      } else {
        li.dataset.on = '0';
        li.dataset.done = '0';
      }
    });
    i = Math.min(i + 1, steps.length - 1);
    const sub = document.querySelector('#loading h2');
    if (sub) {
      const sec = Math.round((Date.now() - started) / 1000);
      if (sec < 10) sub.textContent = 'Reading the land…';
      else if (sec < 35)
        sub.textContent = `Reading the land… (${sec}s of ~60s — elevation & contours)`;
      else if (sec < 55)
        sub.textContent = `Still working… (${sec}s of ~60s — wetlands, soils, climate)`;
      else if (sec < 75)
        sub.textContent = `Almost there… (${sec}s — finishing report)`;
      else
        sub.textContent = `Finishing… (${sec}s — slow layers will skip rather than hang)`;
    }
  }, 700);
}

function finishLoading() {
  clearInterval(state._loadTimer);
  document.querySelectorAll('#loading-steps li').forEach((li) => {
    li.dataset.done = '1';
    li.dataset.on = '0';
  });
  showLoading(false);
}

function setError(msg) {
  const el = $('map-error');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function isMobileLayout() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 820px)').matches
    : window.innerWidth <= 820;
}

function showReport() {
  $('map-stage').hidden = true;
  $('report-stage').hidden = false;
  // Reveal the 3D view toggle now that a report exists
  const vt = $('view-toggle');
  if (vt) vt.hidden = false;
  // Value first: land on overview (insights), not sales. Plan is at the end.
  switchReportPane('overview');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Scroll active rail chip into view on small screens
  requestAnimationFrame(() => {
    const active = document.querySelector('#report-core .step-row.is-active-pane');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

function showMap() {
  $('report-stage').hidden = true;
  $('map-stage').hidden = false;
  requestAnimationFrame(() => {
    if (state._leafletMap) {
      try { state._leafletMap.invalidateSize({ animate: false }); } catch { /* ignore */ }
    }
  });
}

/* ---------- report UI ---------- */

function renderReport(r) {
  // Fresh plan selections for each new report
  state.selectedInterventions = null;
  // Keep email unlock across re-draws of the same session if already unlocked
  paintCore(true);
  // Reset value filter only when a new report arrives
  if (state.report !== r) {
    state.valueFilter = 'all';
  }
  state.report = r;

  const flags = r._meta?.flags || [];
  const a = r.analysis || {};
  const topo = r.topology || {};
  const px = r.proximity_context || a.proximity || {};
  const water = px.nearest_water_source;
  const city = px.nearest_city;
  const settlement = px.nearest_settlement;
  const crime = px.crime_risk;
  const nearestCrimes = px.nearest_crimes || a.nearest_crimes || r.nearest_crimes;
  const centre = r.location?.latitude != null && r.location?.longitude != null
    ? { latitude: r.location.latitude, longitude: r.location.longitude }
    : null;
  const solar = r.solar || a.solar;
  const landValue = r.land_value || a.land_value;
  const hardiness = r.hardiness || a.hardiness;
  const flood = r.flood || a.flood;
  const zoning = r.zoning || a.zoning;
  const siteDrivers = r.site_drivers || r._meta?.site_drivers;
  const recommendations =
    r.recommendations || r._meta?.recommendations || null;
  // Prefer priority order for display; fall back to design_elements
  const allEls =
    recommendations?.priority_ordered?.length
      ? recommendations.priority_ordered
      : r.design_elements || [];
  const els = filterRecsByValue(allEls, state.valueFilter);
  const valueCounts =
    recommendations?.value_counts || computeValueCounts(allEls);
  const services =
    recommendations?.related_services || collectServicesClient(allEls);

  // Slim export for JSON — never let stringify crash the UI
  let exportObj = r;
  try {
    exportObj = JSON.parse(JSON.stringify(r));
    delete exportObj._meta;
  } catch (e) {
    console.warn('exportObj clone failed', e);
    exportObj = { site_name: r.site_name, error: 'export clone failed' };
  }

  const ctx = {
    topo, a, px, water, city, settlement, crime, nearestCrimes, centre, solar,
    landValue, hardiness, flood, zoning, siteDrivers, allEls, els, valueCounts,
    services, recommendations, exportObj, flags,
  };

  // Hidden linear document for PDF export (not shown in nav)
  try {
    const reportEl = $('report');
    if (reportEl) {
      reportEl.innerHTML = `
    <div class="panel">
      <h1>${esc(r.site_name || 'Your parcel')}</h1>
      <p class="lede">
        ${esc(r.location?.nearest_town || r.location?.municipality || 'Alberta')}
        ${r.geometry?.area_ha != null ? ` · ${esc(r.geometry.area_ha)} ha` : ''}
        ${r.climate?.plant_hardiness_zone ? ` · zone ${esc(r.climate.plant_hardiness_zone)}` : ''}
      </p>
      ${buildFindingsHtml(r, ctx, { forPdf: true })}
      <p class="fine" style="margin-top:1rem">
        Planning guidance for Land Intelligence — not engineered drawings.
        mhalma@opensourcemed.info
      </p>
    </div>`;
    }
  } catch (e) {
    console.warn('PDF shell render failed', e);
  }

  renderSectionPanes(r, ctx);
  try {
    renderPlantingPane(r.planting_plan);
  } catch (e) {
    console.warn('planting pane render failed', e);
  }
  setTimeout(() => {
    try {
      injectSectionPdfButtons();
    } catch (e) {
      console.warn('pdf buttons failed', e);
    }
  }, 200);
}

/** Tear down a Leaflet map on a container without throwing parentNode errors. */
function destroyLeafletOn(el) {
  if (!el) return;
  try {
    if (el._eeLeafletMap) {
      el._eeLeafletMap.off();
      el._eeLeafletMap.remove();
    }
  } catch (e) {
    console.warn('leaflet remove', e);
  }
  el._eeLeafletMap = null;
  // Leaflet stamps _leaflet_id on the container; clear so L.map can re-init
  try {
    if (el._leaflet_id) {
      // eslint-disable-next-line no-underscore-dangle
      delete el._leaflet_id;
    }
  } catch {
    /* ignore */
  }
  try {
    el.innerHTML = '';
  } catch {
    /* ignore */
  }
  el.dataset.leafletReady = '0';
}

/**
 * Overview property map: parcel + Alberta provincial contours (Altalis map id=118
 * product family via open Titan) + HRDEM hillshade where NRCan coverage exists.
 * @param {string} [idSuffix]
 */
function mapEmbedSection(idSuffix = 'main') {
  const id = `report-map-${idSuffix}`;
  const legendId = `report-map-legend-${idSuffix}`;
  const statusId = `report-map-status-${idSuffix}`;
  return `
    <section class="report-block report-map-block">
      <h2>Your parcel</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Satellite basemap with the boundary you drew,
        <strong>Alberta 1:20&nbsp;000 provincial contours</strong>
        (same product family as
        <a href="https://www.altalis.com/map;id=118" target="_blank" rel="noopener">Altalis map id=118</a>,
        served openly via Alberta Titan), and
        <strong>HRDEM hillshade</strong> where NRCan coverage exists
        (<a href="https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b" target="_blank" rel="noopener">HRDEM Mosaic</a>).
      </p>
      <div id="${id}" class="report-map minimap-embed report-map-unified" role="img" aria-label="Parcel map with provincial contours and HRDEM"></div>
      <div id="${legendId}" class="unified-map-legend minimap-legend" style="margin-top:0.45rem"></div>
      <p id="${statusId}" class="fine unified-map-status" style="margin-top:0.35rem"></p>
    </section>`;
}

/**
 * Init Leaflet unified property map(s) from drawn parcel + site_map payload.
 * Safe for hidden panes: unique containers + delayed invalidateSize.
 */
function initReportMapEmbed(r, preferredId) {
  if (typeof L === 'undefined') return;
  const latlngs = getParcelLatLngsFromReport(r);
  if (!latlngs) return;

  const candidates = preferredId
    ? [document.getElementById(preferredId)].filter(Boolean)
    : [
        document.getElementById('report-map-overview'),
        document.getElementById('report-map-full'),
        document.getElementById('report-map-main'),
        document.getElementById('report-map'),
      ].filter(Boolean);

  const els = [
    ...candidates.filter((el) => el.offsetParent !== null || el.offsetWidth > 0),
    ...candidates,
  ];
  const seen = new Set();
  for (const el of els) {
    if (!el || seen.has(el)) continue;
    seen.add(el);
    mountUnifiedPropertyMap(el, latlngs, r);
  }
}

/** Parcel ring as Leaflet [lat,lng][] from report geometry or live draw state. */
function getParcelLatLngsFromReport(r) {
  const ring =
    r?.geometry?.coordinates?.[0] ||
    r?.site_map?.parcel?.coordinates?.[0] ||
    (Array.isArray(state.paths) && state.paths.length >= 3 ? state.paths : null);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const latlngs = ring
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (latlngs.length < 3) return null;
  const a = latlngs[0];
  const b = latlngs[latlngs.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) latlngs.push([...a]);
  return latlngs;
}

/**
 * Overview map: satellite + parcel + Alberta provincial contours (Altalis id=118
 * product family via open Titan) + HRDEM hillshade WMS when coverage exists.
 */
function mountUnifiedPropertyMap(el, latlngs, report) {
  if (!el || typeof L === 'undefined' || !latlngs?.length) return;
  try {
    destroyLeafletOn(el);
    el.classList.add('report-map', 'report-map-unified');
    if (!el.style.height) el.style.minHeight = '380px';

    let map;
    try {
      map = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
      });
    } catch (err) {
      console.warn('Parcel map init failed', err);
      el.innerHTML = '<p class="fine">Map could not load — try reopening this section.</p>';
      return;
    }
    el._eeLeafletMap = map;
    el.dataset.leafletReady = '1';

    const imagery = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Esri · Alberta contours (Titan / Altalis map 118 family) · HRDEM (NRCan)',
        maxZoom: 20,
      }
    ).addTo(map);

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { opacity: 0.5, maxZoom: 20 }
    ).addTo(map);

    const overlays = {};
    try {
      const hrdemLayer = addHrdemWmsToMap(map, report);
      if (hrdemLayer) overlays['HRDEM hillshade'] = hrdemLayer;
    } catch (e) {
      console.warn('HRDEM overlay skipped', e);
    }

    const parcelLayer = L.polygon(latlngs, {
      color: '#a8801f',
      fillColor: '#a8801f',
      fillOpacity: 0.12,
      weight: 3,
    }).addTo(map);
    parcelLayer.bindPopup('<strong>Your parcel</strong><br/>Boundary you drew');
    overlays['Your parcel'] = parcelLayer;

    const legendEl = document.getElementById(
      el.id.replace('report-map-', 'report-map-legend-')
    );
    const statusEl = document.getElementById(
      el.id.replace('report-map-', 'report-map-status-')
    );
    const hrdem = getHrdemOverlay(report);

    const updateLegendStatus = (contourCount) => {
      if (legendEl) {
        legendEl.innerHTML = `
      <span class="fine"><span class="legend-swatch" style="background:rgba(168,128,31,0.25);border-color:#a8801f"></span>Your parcel</span>
      <span class="fine"><span class="legend-swatch" style="background:transparent;border-color:#e8d5ff;border-width:2px"></span>Provincial contour</span>
      ${
        hrdem?.available
          ? '<span class="fine"><span class="legend-swatch" style="background:rgba(80,80,80,0.45);border-color:#444"></span>HRDEM hillshade</span>'
          : ''
      }
    `;
      }
      if (statusEl) {
        const bits = [];
        if (contourCount) bits.push(`${contourCount} provincial contour lines`);
        else bits.push('loading contours…');
        if (hrdem?.available) bits.push('HRDEM hillshade on');
        else bits.push('HRDEM not available here');
        statusEl.textContent = bits.join(' · ');
      }
    };

    // Contours: use report data, or fetch live from Alberta Titan if missing
    let contourLayer = null;
    let contourCount = 0;
    try {
      contourLayer = addProvincialContoursToMap(map, report);
      if (contourLayer) {
        overlays['Provincial contours'] = contourLayer;
        contourCount = getProvincialContoursFc(report)?.features?.length || 0;
      }
    } catch (e) {
      console.warn('Contours overlay skipped', e);
    }
    updateLegendStatus(contourCount);

    if (!contourCount) {
      // Async fallback so the satellite map still gets contour lines
      ensureProvincialContoursOnMap(map, report, latlngs, overlays, parcelLayer)
        .then((n) => {
          updateLegendStatus(n || 0);
          try {
            parcelLayer.bringToFront();
          } catch { /* ignore */ }
        })
        .catch((e) => console.warn('contour fetch failed', e));
    }

    // --- Add zone overlays (catchment, pond, swale) from DEM classification ---
    try {
      const elevPayload = elevPayloadFromTopology(report, latlngs);
      if (elevPayload && elevPayload.elevations_m?.length) {
        const { rows, cols, elevations_m, bbox: ebbox, min_m, max_m } = elevPayload;
        const zMin = min_m ?? Math.min(...elevations_m.filter(Number.isFinite));
        const zMax = max_m ?? Math.max(...elevations_m.filter(Number.isFinite));
        const zMean = elevations_m.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / elevations_m.length;
        const { zones } = classifyTerrainZones(elevations_m, rows, cols, zMin, zMax, zMean);

        const zoneColors = {
          catchment: '#2a6f97',
          pond: '#1a9bb5',
          swale: '#c4a035',
        };
        const zoneGroups = { catchment: [], pond: [], swale: [] };

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const z = zones[i];
            if (!zoneColors[z]) continue;
            // Convert grid cell to lat/lng
            const lng = ebbox.west + (c / (cols - 1)) * (ebbox.east - ebbox.west);
            const lat = ebbox.north - (r / (rows - 1)) * (ebbox.north - ebbox.south);
            zoneGroups[z].push([lat, lng]);
          }
        }

        for (const [zoneName, pts] of Object.entries(zoneGroups)) {
          if (pts.length < 10) continue;
          // Sample points to avoid too many markers
          const step = Math.max(1, Math.floor(pts.length / 200));
          const sampled = pts.filter((_, i) => i % step === 0);
          const layer = L.layerGroup(
            sampled.map(([lat, lng]) =>
              L.circleMarker([lat, lng], {
                radius: 4,
                color: zoneColors[zoneName],
                fillColor: zoneColors[zoneName],
                fillOpacity: 0.6,
                weight: 1,
              })
            )
          ).addTo(map);
          overlays[`${zoneName.charAt(0).toUpperCase() + zoneName.slice(1)} zones`] = layer;
        }
      }
    } catch (e) {
      console.warn('Zone overlays skipped', e);
    }

    // --- Add trees from report data ---
    try {
      const treeFeatures = [];
      // From semantic_terrain.features
      const semFeats = report?.semantic_terrain?.features || [];
      for (const f of semFeats) {
        const layer = f?.layer || f?.properties?.layer;
        if (layer === 'trees' || layer === 'vegetation') {
          treeFeatures.push(f);
        }
      }
      // From design_elements
      const desEls = report?.design_elements || [];
      for (const el of desEls) {
        const kind = (el?.kind || el?.type || '').toLowerCase();
        if (['tree', 'food_forest', 'windbreak', 'planting'].some(k => kind.includes(k))) {
          if (el?.geometry?.coordinates || el?.coordinates) {
            treeFeatures.push(el);
          }
        }
      }

      if (treeFeatures.length > 0) {
        const treeMarkers = [];
        for (const f of treeFeatures) {
          const coords = f?.geometry?.coordinates || f?.coordinates;
          if (!coords || coords.length < 2) continue;
          const [lng, lat] = coords;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          treeMarkers.push(
            L.circleMarker([lat, lng], {
              radius: 5,
              color: '#2d5a27',
              fillColor: '#4a8c3f',
              fillOpacity: 0.8,
              weight: 2,
            }).bindPopup(`<strong>Tree</strong><br/>${f?.properties?.species || f?.species || 'Tree'}`)
          );
        }
        if (treeMarkers.length > 0) {
          const treeLayer = L.layerGroup(treeMarkers).addTo(map);
          overlays['Trees'] = treeLayer;
        }
      }
    } catch (e) {
      console.warn('Tree overlay skipped', e);
    }

    try {
      parcelLayer.bringToFront();
    } catch { /* ignore */ }

    try {
      if (Object.keys(overlays).length > 1) {
        L.control.layers({ Imagery: imagery }, overlays, { collapsed: true }).addTo(map);
      }
    } catch (e) {
      console.warn('layer control skipped', e);
    }

    const fit = () => {
      try {
        map.invalidateSize({ animate: false });
        map.fitBounds(parcelLayer.getBounds(), { padding: [32, 32], maxZoom: 18 });
        parcelLayer.bringToFront();
      } catch { /* ignore */ }
    };
    requestAnimationFrame(() => {
      fit();
      setTimeout(fit, 80);
      setTimeout(fit, 320);
    });
  } catch (err) {
    console.warn('mountUnifiedPropertyMap failed', err);
    try {
      el.innerHTML =
        '<p class="fine">Map could not load. Scroll down for findings and use Your plan.</p>';
    } catch { /* ignore */ }
  }
}

/** Build elevation overlay payload from topology when site_map is absent. */
function elevPayloadFromTopology(report, latlngs) {
  const topo = report?.topology;
  const g = topo?.grid;
  if (!g?.elevations_m?.length || !g.rows || !g.cols) return null;
  let bbox = null;
  if (report?.geometry?.bbox?.length === 4) {
    const [west, south, east, north] = report.geometry.bbox;
    bbox = { west, south, east, north };
  } else if (latlngs?.length) {
    const b = L.latLngBounds(latlngs);
    bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  }
  if (!bbox) return null;
  return {
    rows: g.rows,
    cols: g.cols,
    elevations_m: g.elevations_m,
    values: g.values,
    min_m: topo.elevation_min_m,
    max_m: topo.elevation_max_m,
    mean_m: topo.elevation_m,
    bbox,
  };
}

/** Fallback water FC when site_map missing (older cached reports). */
function packageWaterFromReport(report) {
  const features = [];
  for (const f of report?.wetlands?.wetland_polygons?.features || []) {
    features.push({
      ...f,
      properties: { ...(f.properties || {}), layer: 'wetlands', class: 'wetland_inventory' },
    });
  }
  for (const f of report?.small_water?.feature_collection?.features || []) {
    features.push({
      ...f,
      properties: { ...(f.properties || {}), layer: 'small_water' },
    });
  }
  return features.length ? { type: 'FeatureCollection', features } : null;
}

/**
 * Elevation heatmap as Leaflet imageOverlay from topology / site_map grid.
 */
function buildElevationImageOverlay(elev) {
  if (!elev || !elev.elevations_m?.length || !elev.rows || !elev.cols) return null;
  const bbox = elev.bbox;
  if (!bbox || bbox.west == null) return null;
  const { rows, cols, elevations_m: z } = elev;
  const min = elev.min_m ?? Math.min(...z.filter((v) => v != null && Number.isFinite(v)));
  const max = elev.max_m ?? Math.max(...z.filter((v) => v != null && Number.isFinite(v)));
  const span = max - min || 1;

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = z[r * cols + c];
      const i = (r * cols + c) * 4;
      if (v == null || !Number.isFinite(v)) {
        img.data[i + 3] = 0;
        continue;
      }
      const t = (v - min) / span;
      // Parkland soil palette: dark low → gold high
      const h = 32;
      const s = 35 + t * 30;
      const l = 28 + t * 42;
      const [rr, gg, bb] = hslToRgb(h / 360, s / 100, l / 100);
      img.data[i] = rr;
      img.data[i + 1] = gg;
      img.data[i + 2] = bb;
      img.data[i + 3] = 150;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  const bounds = [
    [bbox.south, bbox.west],
    [bbox.north, bbox.east],
  ];
  return L.imageOverlay(url, bounds, { opacity: 0.55, interactive: false });
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** @deprecated use mountUnifiedPropertyMap — kept as thin alias */
function mountParcelSatelliteMap(el, latlngs, report) {
  mountUnifiedPropertyMap(el, latlngs, report || state.report);
}

/**
 * Lightweight client-side re-placement after planting goal replan.
 * Server placement (site-map-features) is authoritative on full report generate.
 */
function clientPlacePlantings(plan, latlngs) {
  const plants = plan?.recommended || [];
  if (!plants.length || !latlngs?.length) {
    return { type: 'FeatureCollection', features: [], note: 'No plantings' };
  }
  const b = L.latLngBounds(latlngs);
  const features = plants.slice(0, 16).map((p, i) => {
    const role = /shelter|wind|caragana|poplar|spruce/i.test(
      `${p.common_name || ''} ${p.guild_layer || ''} ${p.primary_value || ''}`
    )
      ? 'windbreak'
      : /wet|riparian|sedge|willow/i.test(`${p.common_name || ''} ${p.primary_value || ''}`)
        ? 'riparian'
        : p.guild_layer === 'canopy' || p.guild_layer === 'tree'
          ? 'canopy'
          : p.guild_layer === 'shrub'
            ? 'shrub'
            : 'herbaceous';
    const t = (i + 1) / (Math.min(plants.length, 16) + 1);
    const u = 0.25 + (i % 4) * 0.15;
    let lat = b.getSouth() + t * (b.getNorth() - b.getSouth());
    let lng = b.getWest() + u * (b.getEast() - b.getWest());
    if (role === 'windbreak') {
      lat = b.getNorth() - 0.15 * (b.getNorth() - b.getSouth());
      lng = b.getWest() + t * (b.getEast() - b.getWest());
    } else if (role === 'riparian') {
      lat = b.getSouth() + 0.2 * (b.getNorth() - b.getSouth());
      lng = b.getWest() + t * (b.getEast() - b.getWest());
    }
    const e = p.economics || {};
    return {
      type: 'Feature',
      properties: {
        id: p.id || p.common_name || `plant-${i}`,
        common_name: p.common_name || 'Plant',
        scientific_name: p.scientific_name || null,
        role,
        guild_layer: p.guild_layer || null,
        score: p.score ?? null,
        quantity: e.suggested_quantity ?? null,
        product_yield_mid_kg: e.yield_on_parcel_kg?.mid_kg ?? null,
        cash_yield_mid_cad: e.gross_revenue_cad?.mid ?? null,
        placement_rule: role,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    };
  });
  return {
    type: 'FeatureCollection',
    features,
    note: 'Indicative placement after goal replan — regenerate full report for wind/water-aware layout.',
  };
}

function topologySection(topo, a) {
  if (!topo || topo.elevation_m == null) {
    return `<section class="report-block"><h2>Topology</h2><p class="fine">Elevation samples unavailable for this parcel.</p></section>`;
  }
  // Stats + interactive 3D terrain (HRDEM DTM when sampled, else design DEM grid)
  const terrain3dId = 'terrain-3d-' + Math.random().toString(36).slice(2, 8);
  const report = state.report || {};
  const hostId = `${terrain3dId}-mesh`;
  // Controls in terrain3dBlock() are keyed by `terrain3dId`, while the 3D host
  // element gets `${terrain3dId}-mesh` — so the viewer queries controls with
  // the (shorter) `terrain3dId`, not the host id.
  // This section is built as a string before the report HTML is inserted into
  // the DOM, so a fixed delay can fire before the host element exists. Poll
  // until the host is present, then mount the Three.js viewer.
  const tryMount = (attempt) => {
    if (document.getElementById(hostId)) {
      try {
        mountTerrain3dViewer(hostId, report, topo, a, terrain3dId);
      } catch (e) {
        console.warn('terrain 3D mount failed', e);
      }
      return;
    }
    if (attempt < 60) setTimeout(() => tryMount(attempt + 1), 100);
  };
  setTimeout(() => tryMount(0), 50);

  return `
    <section class="report-block">
      <h2>Topology</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Summary from DEM samples${a.elevation?.source ? ` (${esc(a.elevation.source)})` : ''}.
        Contour lines are shown on the satellite maps (Alberta provincial elevation).
        Relief ${fmt(topo.relief_m, 'm')} ·
        ${topo.keypoint_present ? 'keypoint candidate present' : 'no clear keypoint'} ·
        erosion ${esc(topo.erosion_risk || '—')}
      </p>
      <div class="summary-grid" style="margin-top:0.65rem">
        <div class="stat"><span class="k">Min elev</span><strong>${fmt(topo.elevation_min_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Mean elev</span><strong>${fmt(topo.elevation_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Max elev</span><strong>${fmt(topo.elevation_max_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Slope p90</span><strong>${fmt(topo.slope_stats?.p90, '%')}</strong></div>
      </div>
      ${terrain3dBlock(terrain3dId, report)}
    </section>`;
}

/**
 * 3D terrain panel — prefers NRCan HRDEM DTM sample grid, falls back to design DEM.
 * Overlays: contour lines, catchment, pond candidates, swale hillsides.
 */
function terrain3dBlock(id, report) {
  const ht = report?.hrdem_terrain;
  const hrdem = report?.hrdem || report?.elevation_overlays?.hrdem;
  const hasHrdemGrid = !!(ht?.available && ht.elevations_m?.length);
  const sourceLabel = hasHrdemGrid
    ? `NRCan HRDEM ${ht.resolution_m || 2} m DTM`
    : 'Design DEM grid (Open-Meteo / regional)';
  const els = report?.design_elements || report?.recommendations?.priority_ordered || [];
  const hasSwaleRec = els.some((e) => e.element_type === 'swale' || e.element_type === 'terrace');
  const hasPondRec = els.some(
    (e) => e.element_type === 'pond' || e.element_type === 'water_harvesting_earthwork'
  );
  const wetlandBlock = els.some(
    (e) => e.element_type === 'swale' && (e.wetland_block || /wetland/i.test(e.condition_basis || ''))
  );
  const semantic = report?.semantic_terrain;
  const semanticCounts = semantic?.features?.reduce((m, f) => {
    const key = f.layer || f.priority_group || f.feature_type;
    m[key] = (m[key] || 0) + 1;
    return m;
  }, {}) || {};
  const semanticControls = Object.keys(semanticCounts).length
    ? Object.entries(semanticCounts).map(([type, count]) => `
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-semantic-toggle="${esc(id)}" data-semantic-layer="${esc(type)}" />
          ${esc(semantic?.layer_labels?.[type] || type.replace(/_/g, ' '))} (${count})
        </label>`).join('')
    : '<span class="fine">No mapped semantic features returned for this AOI.</span>';
  return `
    <div class="terrain-3d-panel" style="margin-top:1rem">
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0.5rem">
        <span class="mono topo-label">3D terrain · water placement</span>
        <span class="fine">${esc(sourceLabel)}${
          hrdem?.available && !hasHrdemGrid
            ? ' · HRDEM coverage noted; high-res sample pending'
            : ''
        }</span>
      </div>
      <div id="${id}-mesh" class="terrain-3d-host"
        style="height:min(420px,58vh);margin-top:0.4rem;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0a0f14;position:relative"
        role="img" aria-label="3D terrain model with contours, catchment, pond and swale zones">
        <p class="fine" style="padding:1rem;color:#c8cec1">Loading 3D terrain…</p>
      </div>
      <div class="terrain-3d-controls" style="display:flex;flex-wrap:wrap;gap:0.65rem 1rem;align-items:center;margin-top:0.5rem">
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-terrain-toggle="${esc(id)}" data-layer="contours" />
          <span style="display:inline-block;width:14px;height:2px;background:#e8e0ff;vertical-align:middle"></span>
          Contours
        </label>
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-terrain-toggle="${esc(id)}" data-layer="catchment" />
          <span style="display:inline-block;width:10px;height:10px;background:#2a6f97;border-radius:2px;vertical-align:middle"></span>
          Catchment
        </label>
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-terrain-toggle="${esc(id)}" data-layer="pond" />
          <span style="display:inline-block;width:10px;height:10px;background:#1a9bb5;border-radius:2px;vertical-align:middle"></span>
          Pond sites
        </label>
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-terrain-toggle="${esc(id)}" data-layer="swale" />
          <span style="display:inline-block;width:10px;height:10px;background:#c4a035;border-radius:2px;vertical-align:middle"></span>
          Swale hills
        </label>
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <input type="checkbox" checked data-terrain-toggle="${esc(id)}" data-layer="trees" />
          <span style="display:inline-block;width:12px;height:14px;background:#2d7a3a;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;vertical-align:middle"></span>
          Trees
        </label>
        <label class="fine" style="display:flex;align-items:center;gap:0.35rem">
          <span>Exag</span>
          <input type="range" min="0.5" max="6" step="0.1" value="1" data-terrain-exag="${esc(id)}" style="width:90px;vertical-align:middle" />
          <span data-terrain-exag-val="${esc(id)}" style="min-width:2.2rem;font-variant-numeric:tabular-nums">1.0×</span>
        </label>
        <button type="button" class="btn-quiet" data-terrain-reset="${esc(id)}" style="font-size:0.8rem">Reset view</button>
      </div>
      <div class="terrain-semantic-controls" style="display:flex;flex-wrap:wrap;gap:0.45rem 0.9rem;align-items:center;margin-top:0.65rem;padding-top:0.55rem;border-top:1px solid var(--line)">
        <span class="mono" style="font-size:0.72rem">Mapped features</span>${semanticControls}
      </div>
      <p class="fine" style="margin-top:0.4rem">
        <strong>Blue / teal</strong> = low catchment & pond candidates ·
        <strong>Gold</strong> = mid-slope hillsides suited to contour swales ·
        <strong>Light lines</strong> = elevation contours.
        Drag to orbit · scroll to zoom. Zones are DEM-derived planning hints
        ${hasPondRec ? ' · report recommends pond / water storage' : ''}
        ${hasSwaleRec ? ' · report recommends swale / terrace' : ''}
        ${hasHrdemGrid
          ? `Source: <a href="${esc(ht.dataset_url || 'https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b') }" target="_blank" rel="noopener">NRCan HRDEM</a>.`
          : 'Built from design elevation samples.'}
        ${semantic?.available ? ` Mapped features: ${esc(semantic.feature_count)} · ${esc(semantic.source)}.` : ''}
      </p>
    </div>`;
}

/**
 * Ray-casting point-in-polygon test.
 * @param {number} px - X coordinate of test point
 * @param {number} py - Y coordinate of test point  
 * @param {Array<[number,number]>} polygon - Array of [x,y] pairs forming closed ring
 * @returns {boolean} true if point is inside polygon
 */
function pointInPolygon2D(px, py, polygon) {
  if (!polygon || polygon.length < 3) return true; // no clip if no polygon
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Classify DEM cells into catchment / pond / swale / ridge / neutral for 3D colouring.
 * Pond = low + flat; catchment = broader low basin; swale = mid-slope hillsides.
 */
function classifyTerrainZones(elevations, rows, cols, zMin, zMax, zMean) {
  const relief = Math.max(zMax - zMin, 0.5);
  const n = rows * cols;
  const zones = new Array(n).fill('neutral'); // pond | catchment | swale | ridge | neutral
  const slopes = new Array(n).fill(0);
  const elevAt = (r, c) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    const z = elevations[r * cols + c];
    return z != null && Number.isFinite(z) ? z : null;
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const z = elevAt(r, c);
      if (z == null) continue;
      const zl = elevAt(r, c - 1) ?? z;
      const zr = elevAt(r, c + 1) ?? z;
      const zu = elevAt(r - 1, c) ?? z;
      const zd = elevAt(r + 1, c) ?? z;
      // Unit-grid slope proxy (relative)
      const g = Math.hypot(zr - zl, zd - zu) / 2;
      const slopePct = (g / relief) * 100; // rough relative slope
      slopes[i] = slopePct;
      const t = (z - zMin) / relief;
      // Concavity: positive when cell lower than neighbours (sink)
      const neigh = [zl, zr, zu, zd].filter((v) => v != null);
      const curv = neigh.length
        ? neigh.reduce((a, b) => a + b, 0) / neigh.length - z
        : 0;
      const concave = curv > relief * 0.02;

      if (t <= 0.14 && slopePct < 8) zones[i] = 'pond';
      else if (t <= 0.28 || (t <= 0.38 && concave)) zones[i] = 'catchment';
      else if (t >= 0.32 && t <= 0.78 && slopePct >= 1.5 && slopePct <= 22)
        zones[i] = 'swale';
      else if (t >= 0.82) zones[i] = 'ridge';
      else zones[i] = 'neutral';
    }
  }

  // Soften pond: keep only connected low patches near mean of lowest 15%
  const pondThresh = zMin + relief * 0.16;
  for (let i = 0; i < n; i++) {
    const z = elevations[i];
    if (z == null) continue;
    if (zones[i] === 'pond' && z > pondThresh && slopes[i] > 6) zones[i] = 'catchment';
  }

  return { zones, slopes };
}

/**
 * Marching-squares contour polylines in grid (row,col) space for 3D lift.
 */
function extractContourPolylines(elevations, rows, cols, levels) {
  const elevAt = (r, c) => {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    const z = elevations[r * cols + c];
    return z != null && Number.isFinite(z) ? z : null;
  };
  const lines = []; // { level, points: [[r,c],...] } as segments

  for (const level of levels) {
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = elevAt(r, c);
        const tr = elevAt(r, c + 1);
        const bl = elevAt(r + 1, c);
        const br = elevAt(r + 1, c + 1);
        if ([tl, tr, bl, br].some((v) => v == null)) continue;
        let code = 0;
        if (tl >= level) code |= 1;
        if (tr >= level) code |= 2;
        if (br >= level) code |= 4;
        if (bl >= level) code |= 8;
        if (code === 0 || code === 15) continue;

        const lerp = (a, b, va, vb) => {
          if (Math.abs(vb - va) < 1e-9) return 0.5;
          return (level - va) / (vb - va);
        };
        // Edge midpoints in (row, col) continuous space
        const top = [r, c + lerp(0, 1, tl, tr)];
        const bottom = [r + 1, c + lerp(0, 1, bl, br)];
        const left = [r + lerp(0, 1, tl, bl), c];
        const right = [r + lerp(0, 1, tr, br), c + 1];

        const segs = {
          1: [left, top],
          2: [top, right],
          3: [left, right],
          4: [right, bottom],
          5: [left, top, right, bottom], // saddle — two segs
          6: [top, bottom],
          7: [left, bottom],
          8: [left, bottom],
          9: [top, bottom],
          10: [top, right, left, bottom],
          11: [right, bottom],
          12: [left, right],
          13: [top, right],
          14: [left, top],
        };
        const pts = segs[code];
        if (!pts) continue;
        for (let k = 0; k + 1 < pts.length; k += 2) {
          lines.push({ level, a: pts[k], b: pts[k + 1] });
        }
      }
    }
  }
  return lines;
}

/**
 * Mount 3D terrain viewer using Three.js — simple terrain mesh with contour lines.
 * Uses OrbitControls for mouse/touch interaction.
 */
function mountTerrain3dViewer(hostId, report, topo, analysis, ctrlId) {
  const el = document.getElementById(hostId);
  // Control data-* attributes are keyed by the section id (ctrlId); fall
  // back to the host id for backwards compatibility with older callers.
  if (!ctrlId) ctrlId = hostId;
  if (!el) return;

  // --- Extract elevation data ---
  const ht = report?.hrdem_terrain;
  let rows, cols, elevations;
  let source = 'dem';
  if (ht?.available && ht.elevations_m?.length && ht.rows && ht.cols) {
    rows = ht.rows; cols = ht.cols; elevations = ht.elevations_m;
    source = 'hrdem';
  } else {
    const g = topo?.grid || {};
    rows = g.rows; cols = g.cols; elevations = g.elevations_m || null;
    if ((!elevations || !elevations.length) && analysis?.elevation?.elevations) {
      elevations = analysis.elevation.elevations;
      rows = analysis.elevation.rows; cols = analysis.elevation.cols;
    }
  }
  if (!rows || !cols || !elevations?.length) {
    const flatZ = Number(analysis?.elevation?.mean_m) || Number(report?.location?.elevation_m) || 0;
    rows = 2; cols = 2; elevations = [flatZ, flatZ, flatZ, flatZ];
  }

  // Cleanup previous viewer
  if (el._eeTerrain) {
    try { el._eeTerrain.dispose(); } catch { /* ignore */ }
    el._eeTerrain = null;
  }
  el.innerHTML = '';

  const valid = elevations.filter((z) => z != null && Number.isFinite(z));
  if (valid.length < 4) {
    el.innerHTML = '<p class="fine" style="padding:1rem">Not enough elevation samples.</p>';
    return;
  }

  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < valid.length; i++) {
    const z = valid[i];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const zMean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const relief = Math.max(zMax - zMin, 0.5);

  // --- Bounding box ---
  let rawBbox = report?.geometry?.bbox;
  let west, east, south, north;
  if (Array.isArray(rawBbox) && rawBbox.length === 4) {
    [west, south, east, north] = rawBbox.map(Number);
  } else if (rawBbox && typeof rawBbox === 'object') {
    west = Number(rawBbox.west ?? rawBbox.W);
    south = Number(rawBbox.south ?? rawBbox.S);
    east = Number(rawBbox.east ?? rawBbox.E);
    north = Number(rawBbox.north ?? rawBbox.N);
  }
  if (west == null || east == null || south == null || north == null || !isFinite(west)) {
    const parcelCoords = report?.geometry?.coordinates?.[0] || report?.geometry?.coordinates;
    if (parcelCoords && parcelCoords.length >= 3) {
      west = Infinity; south = Infinity; east = -Infinity; north = -Infinity;
      for (const [lng, lat] of parcelCoords) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    }
  }
  if (west == null || east == null || south == null || north == null || !isFinite(west)) {
    el.innerHTML = '<p class="fine" style="padding:1rem">No bounding box available for terrain view.</p>';
    return;
  }

  // --- Scene dimensions ---
  // Map parcel bbox to a local scene centered at origin.
  // Use ground-distance aspect (km per degree) so the terrain is not
  // distorted at high latitudes (1° lng ≈ cos(lat) × 1° lat).
  const meshSize = 10;
  const lngRange = east - west || 0.001;
  const latRange = north - south || 0.001;
  const latMid = (north + south) / 2;
  const kmPerDegLng = 111.32 * Math.cos(latMid * Math.PI / 180);
  const kmPerDegLat = 111.32;
  const aspect = (lngRange * kmPerDegLng) / (latRange * kmPerDegLat);
  const meshW = meshSize * Math.min(aspect, 1);
  const meshD = meshSize / Math.max(aspect, 1);

  // Height scaling: normalize elevation to scene units
  // True scale (exaggerate=1): max height difference = relief * 0.05 scene units
  const heightScale = 0.05;
  let exaggerate = 1.0;

  // Build heightmap array
  const heightValues = new Float32Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    const z = elevations[i];
    heightValues[i] = (z != null && Number.isFinite(z)) ? z : zMean;
  }

  // Elevation to local Y coordinate
  const elevToLocalY = (z, exag) => (z - zMin) * heightScale * exag;

  // Grid-to-local converters
  const gridToLocalX = (c) => (c / (cols - 1) - 0.5) * meshW;
  const gridToLocalZ = (r) => (r / (rows - 1) - 0.5) * meshD;

  // Bilinear elevation sampler
  const elevAtRC = (rr, cc) => {
    const r0 = Math.max(0, Math.min(rows - 2, Math.floor(rr)));
    const c0 = Math.max(0, Math.min(cols - 2, Math.floor(cc)));
    const fr = Math.max(0, Math.min(1, rr - r0));
    const fc = Math.max(0, Math.min(1, cc - c0));
    const e00 = heightValues[r0 * cols + c0] ?? zMean;
    const e10 = heightValues[r0 * cols + c0 + 1] ?? e00;
    const e01 = heightValues[(r0 + 1) * cols + c0] ?? e00;
    const e11 = heightValues[(r0 + 1) * cols + c0 + 1] ?? e00;
    return e00 * (1 - fr) * (1 - fc) + e10 * (1 - fr) * fc + e01 * fr * (1 - fc) + e11 * fr * fc;
  };

  // --- Three.js setup ---
  let scene, camera, renderer, controls, terrainMesh, contourLinesGroup;
  let animationId = null;
  let geometry; // stored for relief updates

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.01, meshSize * 50);
    // Position camera at an angle looking down at the terrain
    camera.position.set(meshW * 0.6, relief * heightScale * exaggerate * 3 + 3, meshD * 0.8);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);

    // OrbitControls for mouse/touch interaction
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, relief * heightScale * exaggerate * 0.3, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = meshSize * 0.2;
    controls.maxDistance = meshSize * 10;
    controls.maxPolarAngle = Math.PI * 0.48; // Don't go below ground
    controls.update();

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(meshSize * 0.5, meshSize * 2, meshSize * 0.3);
    scene.add(dirLight);

    // --- Terrain mesh ---
    geometry = new THREE.PlaneGeometry(meshW, meshD, cols - 1, rows - 1);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position.array;
    const colors = new Float32Array(positions.length);

    for (let i = 0; i < cols * rows; i++) {
      const z = heightValues[i] ?? zMean;
      positions[i * 3 + 1] = elevToLocalY(z, exaggerate);

      // Height-based coloring (used as fallback or when satellite disabled)
      const t = (z - zMin) / relief; // 0 to 1
      const r = 0.2 + t * 0.15;
      const g = 0.45 + t * 0.25;
      const b = 0.15 + t * 0.1;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Satellite imagery texture from Esri World Imagery tiles
    let satelliteTexture = null;
    const materialWithSat = new THREE.MeshLambertMaterial({ 
      vertexColors: true, 
      side: THREE.DoubleSide,
      color: 0xffffff
    });
    const materialNoSat = new THREE.MeshLambertMaterial({ 
      vertexColors: true, 
      side: THREE.DoubleSide 
    });
    
    // Load satellite imagery for the parcel bbox
    const loadSatelliteTexture = () => {
      try {
        // Use the same parcel source as getParcelLatLngsFromReport for consistency
        // Priority: report.geometry > report.site_map.parcel > state.paths (user-drawn)
        let parcelRing = report?.geometry?.coordinates?.[0] || report?.site_map?.parcel?.coordinates?.[0];
        if (!parcelRing && Array.isArray(state.paths) && state.paths.length >= 3) {
          parcelRing = state.paths;
        }
        
        // Calculate bbox from actual parcel ring (not report bbox which may differ)
        let texWest = Infinity, texEast = -Infinity, texSouth = Infinity, texNorth = -Infinity;
        if (parcelRing && parcelRing.length >= 3) {
          for (const coord of parcelRing) {
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            if (lng < texWest) texWest = lng;
            if (lng > texEast) texEast = lng;
            if (lat < texSouth) texSouth = lat;
            if (lat > texNorth) texNorth = lat;
          }
        }
        // Fall back to report bbox if parcel ring didn't yield valid bounds
        if (!isFinite(texWest) || !isFinite(texEast) || !isFinite(texSouth) || !isFinite(texNorth)) {
          texWest = west; texEast = east; texSouth = south; texNorth = north;
        }
        
        // Add small margin (2%) around parcel for texture coverage
        const marginLng = (texEast - texWest) * 0.02;
        const marginLat = (texNorth - texSouth) * 0.02;
        texWest -= marginLng; texEast += marginLng;
        texSouth -= marginLat; texNorth += marginLat;
        
        const parcelLatRange = texNorth - texSouth;
        const parcelLngRange = texEast - texWest;
        
        // Choose zoom level based on parcel size (smaller parcels need higher zoom)
        const maxDim = Math.max(parcelLatRange, parcelLngRange);
        let zoom = 14;
        if (maxDim < 0.005) zoom = 16;
        else if (maxDim < 0.01) zoom = 15;
        else if (maxDim < 0.03) zoom = 14;
        else if (maxDim < 0.08) zoom = 13;
        else zoom = 12;
        
        // Convert lat/lng to tile coordinates (exact float, not floored)
        const lat2tileExact = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
        const lng2tileExact = (lng, z) => (lng + 180) / 360 * Math.pow(2, z);
        const lat2tile = (lat, z) => Math.floor(lat2tileExact(lat, z));
        const lng2tile = (lng, z) => Math.floor(lng2tileExact(lng, z));
        
        // Get tile range that covers the entire parcel bbox
        const tileXMin = lng2tile(texWest, zoom);
        const tileXMax = lng2tile(texEast, zoom);
        const tileYMin = lat2tile(texNorth, zoom); // north has smaller tile Y
        const tileYMax = lat2tile(texSouth, zoom); // south has larger tile Y
        
        // Add 1 tile padding on each side
        const startX = tileXMin - 1;
        const endX = tileXMax + 1;
        const startY = tileYMin - 1;
        const endY = tileYMax + 1;
        
        const tilesWide = endX - startX + 1;
        const tilesHigh = endY - startY + 1;
        
        // Create a canvas to stitch tiles together
        const tileSize = 256;
        const canvas = document.createElement('canvas');
        canvas.width = tileSize * tilesWide;
        canvas.height = tileSize * tilesHigh;
        const ctx = canvas.getContext('2d');
        
        let loadedCount = 0;
        const totalTiles = tilesWide * tilesHigh;
        
        for (let ty = startY; ty <= endY; ty++) {
          for (let tx = startX; tx <= endX; tx++) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              // Draw tile at correct position in canvas
              const cx = (tx - startX) * tileSize;
              const cy = (ty - startY) * tileSize;
              ctx.drawImage(img, cx, cy, tileSize, tileSize);
              loadedCount++;
              if (loadedCount === totalTiles) {
                // Create texture from stitched canvas
                satelliteTexture = new THREE.CanvasTexture(canvas);
                satelliteTexture.colorSpace = THREE.SRGBColorSpace;
                satelliteTexture.minFilter = THREE.LinearFilter;
                satelliteTexture.magFilter = THREE.LinearFilter;
                
                // Calculate exact tile bounds in lat/lng
                const tile2lng = (x, z) => x / Math.pow(2, z) * 360 - 180;
                const tile2lat = (y, z) => {
                  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
                  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
                };
                
                // Bounds of the entire stitched tile area
                const tileWest = tile2lng(startX, zoom);
                const tileEast = tile2lng(endX + 1, zoom);
                const tileNorth = tile2lat(startY, zoom);
                const tileSouth = tile2lat(endY + 1, zoom);
                
                const tileLngRange = tileEast - tileWest;
                const tileLatRange = tileNorth - tileSouth;
                
                // UV coordinates for the MESH bbox within the tile area
                // The mesh spans from (west,south) to (east,north) in geo coords
                // Map mesh corners to texture UVs so imagery aligns with terrain grid
                const uMin = (west - tileWest) / tileLngRange;
                const uMax = (east - tileWest) / tileLngRange;
                // For V: texture top (v=1) is north, texture bottom (v=0) is south.
                // The mesh's north edge (origV=1 in PlaneGeometry after rotateX)
                // must map to the texture's north (high V); south edge (origV=0) → low V.
                const vNorth = 1 - (tileNorth - north) / tileLatRange; // mesh north → high V
                const vSouth = 1 - (tileNorth - south) / tileLatRange; // mesh south → low V
                
                // Update UVs on geometry to map mesh area to texture
                const uvs = geometry.attributes.uv;
                if (uvs) {
                  const uvArray = uvs.array;
                  for (let i = 0; i < cols * rows; i++) {
                    // PlaneGeometry default UVs go 0-1 across the plane
                    // We remap them to the mesh's portion of the texture
                    const origU = uvArray[i * 2];
                    const origV = uvArray[i * 2 + 1];
                    uvArray[i * 2] = uMin + origU * (uMax - uMin);
                    // origV=0 is the mesh's south edge → vSouth; origV=1 is north → vNorth
                    uvArray[i * 2 + 1] = vSouth + origV * (vNorth - vSouth);
                  }
                  uvs.needsUpdate = true;
                }
                
                materialWithSat.map = satelliteTexture;
                materialWithSat.vertexColors = false; // Use texture instead of vertex colors
                materialWithSat.needsUpdate = true;
                terrainMesh.material = materialWithSat;
              }
            };
            img.onerror = () => {
              loadedCount++;
              // Continue even if some tiles fail
              if (loadedCount === totalTiles && !satelliteTexture) {
                console.warn('Some satellite tiles failed to load');
              }
            };
            img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
          }
        }
      } catch (e) {
        console.warn('Satellite texture load failed:', e);
      }
    };
    loadSatelliteTexture();
    
    terrainMesh = new THREE.Mesh(geometry, materialNoSat);
    scene.add(terrainMesh);

    // --- Parcel boundary on 3D terrain ---
    const groupParcel = new THREE.Group(); groupParcel.name = 'parcel';
    scene.add(groupParcel);

    const buildParcelBoundary = () => {
      while (groupParcel.children.length) {
        const c = groupParcel.children[0];
        groupParcel.remove(c);
        c.geometry?.dispose();
        c.material?.dispose();
      }

      // Get parcel ring - use same source as getParcelLatLngsFromReport for consistency
      // Priority: report.geometry > report.site_map.parcel > state.paths (user-drawn)
      let parcelRing = report?.geometry?.coordinates?.[0] || report?.site_map?.parcel?.coordinates?.[0];
      if (!parcelRing && Array.isArray(state.paths) && state.paths.length >= 3) {
        // state.paths is [lng, lat] format from user drawing
        parcelRing = state.paths;
      }
      if (!parcelRing || parcelRing.length < 3) return;

      // Convert parcel coords to local 3D coordinates, draping onto terrain
      const parcelPts3D = [];
      for (const coord of parcelRing) {
        const lng = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        
        // Convert to grid coordinates
        const gc = ((lng - west) / (east - west)) * (cols - 1);
        const gr = ((north - lat) / (north - south)) * (rows - 1);
        
        // Clamp to grid bounds
        const gcClamped = Math.max(0, Math.min(cols - 1, gc));
        const grClamped = Math.max(0, Math.min(rows - 1, gr));
        
        const x = gridToLocalX(gcClamped);
        const z = gridToLocalZ(grClamped);
        const y = elevToLocalY(elevAtRC(grClamped, gcClamped), exaggerate) + 0.01; // slight offset above terrain
        
        parcelPts3D.push(new THREE.Vector3(x, y, z));
      }

      if (parcelPts3D.length < 3) return;

      // Close the ring if not already closed
      const first = parcelPts3D[0];
      const last = parcelPts3D[parcelPts3D.length - 1];
      if (first.distanceTo(last) > 0.001) {
        parcelPts3D.push(first.clone());
      }

      // Parcel boundary line
      const lineGeo = new THREE.BufferGeometry().setFromPoints(parcelPts3D);
      const lineMat = new THREE.LineBasicMaterial({ 
        color: 0xffd700, // gold
        linewidth: 2,
        transparent: true,
        opacity: 0.9
      });
      const parcelLine = new THREE.Line(lineGeo, lineMat);
      groupParcel.add(parcelLine);

      // Semi-transparent parcel fill (using triangle fan from centroid)
      if (parcelPts3D.length >= 4) {
        // Calculate centroid
        const centroid = new THREE.Vector3();
        for (let i = 0; i < parcelPts3D.length - 1; i++) {
          centroid.add(parcelPts3D[i]);
        }
        centroid.divideScalar(parcelPts3D.length - 1);
        centroid.y = elevToLocalY(elevAtRC(
          ((north - (south + north) / 2) / (north - south)) * (rows - 1),
          (((west + east) / 2 - west) / (east - west)) * (cols - 1)
        ), exaggerate) + 0.005;

        // Build triangles from centroid to each edge
        const fillVerts = [];
        for (let i = 0; i < parcelPts3D.length - 1; i++) {
          fillVerts.push(centroid.x, centroid.y, centroid.z);
          fillVerts.push(parcelPts3D[i].x, parcelPts3D[i].y, parcelPts3D[i].z);
          fillVerts.push(parcelPts3D[i + 1].x, parcelPts3D[i + 1].y, parcelPts3D[i + 1].z);
        }
        
        const fillGeo = new THREE.BufferGeometry();
        fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(fillVerts, 3));
        fillGeo.computeVertexNormals();
        const fillMat = new THREE.MeshBasicMaterial({
          color: 0xffd700,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const fillMesh = new THREE.Mesh(fillGeo, fillMat);
        groupParcel.add(fillMesh);
      }
    };
    buildParcelBoundary();

    // --- Zone overlay groups (catchment, pond, swale) ---
    const groupCatchment = new THREE.Group(); groupCatchment.name = 'catchment';
    const groupPond = new THREE.Group(); groupPond.name = 'pond';
    const groupSwale = new THREE.Group(); groupSwale.name = 'swale';
    const groupTrees = new THREE.Group(); groupTrees.name = 'trees';
    scene.add(groupCatchment, groupPond, groupSwale, groupTrees);

    // Build zone overlays from DEM classification
    const buildZoneOverlays = () => {
      // Clear existing
      [groupCatchment, groupPond, groupSwale].forEach(g => {
        while (g.children.length) {
          const c = g.children[0];
          g.remove(c);
          c.geometry?.dispose();
          c.material?.dispose();
        }
      });

      const { zones } = classifyTerrainZones(elevations, rows, cols, zMin, zMax, zMean);
      
      // Create colored point clouds for each zone type
      const zoneColors = {
        catchment: { color: 0x2a6f97, group: groupCatchment },
        pond: { color: 0x1a9bb5, group: groupPond },
        swale: { color: 0xc4a035, group: groupSwale },
      };
      
      const zonePoints = { catchment: [], pond: [], swale: [] };
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const zone = zones[i];
          if (zonePoints[zone]) {
            const x = gridToLocalX(c);
            const z = gridToLocalZ(r);
            const y = elevToLocalY(heightValues[i] ?? zMean, exaggerate) + 0.02;
            zonePoints[zone].push(x, y, z);
          }
        }
      }
      
      for (const [zoneName, pts] of Object.entries(zonePoints)) {
        if (pts.length === 0) continue;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const mat = new THREE.PointsMaterial({ 
          color: zoneColors[zoneName].color, 
          size: 0.08,
          transparent: true,
          opacity: 0.7,
          sizeAttenuation: true
        });
        zoneColors[zoneName].group.add(new THREE.Points(geom, mat));
      }
    };
    buildZoneOverlays();

    // --- Trees from report data ---
    const buildTrees = () => {
      while (groupTrees.children.length) {
        const c = groupTrees.children[0];
        groupTrees.remove(c);
        c.geometry?.dispose();
        c.material?.dispose();
      }

      // Get tree locations from report - only use actual coordinate-bearing data
      const treeFeatures = [];
      
      // Check semantic_terrain features for trees/vegetation
      const semFeatures = report?.semantic_terrain?.features || [];
      for (const f of semFeatures) {
        const layer = f.layer || f.priority_group || '';
        const ftype = f.feature_type || '';
        if (layer === 'trees' || layer === 'vegetation' || ftype === 'tree' || ftype === 'vegetation') {
          if (f.geometry?.coordinates) {
            treeFeatures.push(f);
          }
        }
      }
      
      // Check design_elements for tree plantings with coordinates
      const designEls = report?.design_elements || report?.recommendations?.priority_ordered || [];
      for (const el of designEls) {
        if ((el.element_type === 'tree' || el.element_type === 'food_forest' || el.element_type === 'windbreak') && el.coordinates) {
          treeFeatures.push({ geometry: { type: 'Point', coordinates: el.coordinates }, element_type: el.element_type });
        }
      }

      if (treeFeatures.length === 0) return;

      // Simple tree representation: green cones
      const trunkGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.15, 6);
      const canopyGeo = new THREE.ConeGeometry(0.12, 0.3, 8);
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
      const canopyMat = new THREE.MeshLambertMaterial({ color: 0x2d7a3a });

      for (const f of treeFeatures) {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;
        
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        
        // Convert to local coordinates
        if (lng < west || lng > east || lat < south || lat > north) continue;
        
        const gc = ((lng - west) / (east - west)) * (cols - 1);
        const gr = ((north - lat) / (north - south)) * (rows - 1);
        const x = gridToLocalX(gc);
        const z = gridToLocalZ(gr);
        const y = elevToLocalY(elevAtRC(gr, gc), exaggerate);

        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(x, y + 0.075, z);
        
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.set(x, y + 0.25, z);
        
        groupTrees.add(trunk, canopy);
      }
    };
    buildTrees();

    // --- Contour lines ---
    contourLinesGroup = new THREE.Group();
    contourLinesGroup.name = 'contours';
    scene.add(contourLinesGroup);

    const buildContours = () => {
      // Clear existing contour geometry
      while (contourLinesGroup.children.length) {
        const c = contourLinesGroup.children[0];
        contourLinesGroup.remove(c);
        c.geometry?.dispose();
        c.material?.dispose();
      }

      // Generate contour levels
      const nLevels = Math.min(12, Math.max(4, Math.round(relief / 2)));
      const step = relief / nLevels;
      const levels = [];
      for (let k = 1; k < nLevels; k++) levels.push(zMin + k * step);

      const segs = extractContourPolylines(elevations, rows, cols, levels);
      if (!segs.length) return;

      const pts = [];
      for (const s of segs) {
        // Use the contour level itself as the elevation — this ensures contours
        // sit exactly on the terrain surface at their designated height
        const yContour = elevToLocalY(s.level, exaggerate);
        const xA = gridToLocalX(s.a[1]);
        const zA = gridToLocalZ(s.a[0]);
        const xB = gridToLocalX(s.b[1]);
        const zB = gridToLocalZ(s.b[0]);
        // Small offset to prevent z-fighting with terrain mesh
        const offset = 0.002 * exaggerate;
        pts.push(new THREE.Vector3(xA, yContour + offset, zA));
        pts.push(new THREE.Vector3(xB, yContour + offset, zB));
      }

      const cGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const cMat = new THREE.LineBasicMaterial({ color: 0xe8e0ff, linewidth: 2, transparent: true, opacity: 0.9 });
      contourLinesGroup.add(new THREE.LineSegments(cGeom, cMat));
    };
    buildContours();

    // Animation loop
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      if (renderer && camera) {
        renderer.setSize(el.clientWidth, el.clientHeight);
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', onResize);

    // Semantic feature objects (mapped features overlay)
    let semanticObjects = null;

    // Disposal
    el._eeTerrain = {
      dispose() {
        if (animationId) cancelAnimationFrame(animationId);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        semanticObjects?.dispose();
        scene.traverse((obj) => {
          obj.geometry?.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
        renderer.dispose();
        el._eeTerrain = null;
      },
      source,
    };

    // --- Exaggerate slider ---
    const exagInput = document.querySelector(`[data-terrain-exag="${ctrlId}"]`);
    const exagVal = document.querySelector(`[data-terrain-exag-val="${ctrlId}"]`);
    if (exagInput) {
      exagInput.addEventListener('input', () => {
        exaggerate = Number(exagInput.value) || 2.0;
        if (exagVal) exagVal.textContent = `${exaggerate.toFixed(1)}×`;
        if (terrainMesh && geometry) {
          const pos = geometry.attributes.position.array;
          for (let i = 0; i < cols * rows; i++) {
            pos[i * 3 + 1] = elevToLocalY(heightValues[i] ?? zMean, exaggerate);
          }
          geometry.attributes.position.needsUpdate = true;
          geometry.computeVertexNormals();
        }
        // Rebuild all draping overlays so they follow the new terrain height
        buildContours();
        buildParcelBoundary();
        buildZoneOverlays();
        buildTrees();
      });
    }

    // --- Layer toggles (contours, catchment, pond, swale, trees) ---
    document.querySelectorAll(`[data-terrain-toggle="${ctrlId}"]`).forEach((cb) => {
      cb.addEventListener('change', () => {
        const layer = cb.getAttribute('data-layer');
        if (layer === 'contours' && contourLinesGroup) {
          contourLinesGroup.visible = !!cb.checked;
        } else if (layer === 'catchment') {
          groupCatchment.visible = !!cb.checked;
        } else if (layer === 'pond') {
          groupPond.visible = !!cb.checked;
        } else if (layer === 'swale') {
          groupSwale.visible = !!cb.checked;
        } else if (layer === 'trees') {
          groupTrees.visible = !!cb.checked;
        }
      });
    });

    // --- Semantic feature toggles (mapped features from semantic terrain) ---
    const semanticPayload = report?.semantic_terrain;
    if (semanticPayload?.features?.length) {
      semanticObjects = mountSemanticTerrainObjects(scene, semanticPayload, {
        bbox: [west, south, east, north],
        meshW, meshD, cols, rows, elevations, zMean, relief, zMin, heightScale,
        exaggerate: () => exaggerate,
      });
      document.querySelectorAll(`[data-semantic-toggle="${ctrlId}"]`).forEach((cb) => {
        cb.addEventListener('change', () => {
          const layer = cb.getAttribute('data-semantic-layer');
          if (semanticObjects) semanticObjects.setVisible(layer, !!cb.checked);
        });
      });
    }

    // --- Reset view ---
    const resetBtn = document.querySelector(`[data-terrain-reset="${ctrlId}"]`);
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        camera.position.set(meshW * 0.6, relief * heightScale * exaggerate * 3 + 3, meshD * 0.8);
        controls.target.set(0, relief * heightScale * exaggerate * 0.3, 0);
        controls.update();
      });
    }

    // --- Info badge ---
    const badge = document.createElement('div');
    badge.className = 'fine';
    badge.style.cssText = 'position:absolute;left:0.5rem;bottom:0.5rem;padding:0.2rem 0.45rem;background:rgba(0,0,0,0.55);color:#e8efe6;border-radius:4px;font-size:0.7rem;pointer-events:none;z-index:1000;max-width:90%';
    badge.textContent = `${cols}×${rows} · relief ${relief.toFixed(1)}m · ${source}`;
    el.style.position = 'relative';
    el.appendChild(badge);

  } catch (err) {
    console.error('3D terrain viewer failed:', err);
    el.innerHTML = `<p class="fine" style="padding:1rem">3D terrain viewer unavailable: ${esc(err.message)}. Use the 2D map for this parcel.</p>`;
    return;
  }
}

/**
 * Create a Cesium terrain provider from a local heightmap array.
 * Uses Cesium.EllipsoidTerrainProvider as base and overlays height values.
 */
function createLocalTerrainProvider(heights, rows, cols, bbox, zMin, zMax, zMean) {
  // Cesium doesn't support direct heightmap terrain in the browser without a server.
  // Instead, we use EllipsoidTerrainProvider (flat earth) and place entities at elevated heights.
  // This is the most practical approach for a client-side-only app.
  return new Cesium.EllipsoidTerrainProvider({
    // No token required — flat ellipsoid
  });
}

// updateCameraPosition and createLocalTerrainProvider are now handled inside mountTerrain3dViewer

function mountSemanticTerrainObjects(scene, payload, opts) {
  const features = payload?.features || [];
  const groups = new Map();
  const colors = { water: 0x2a9dc9, wetland: 0x38a68b, building: 0xd88c45, road: 0x777777, railway: 0xb4b4b4, forest: 0x2f8f4e, shrubland: 0x77a84e, cropland: 0xb1a447, grassland: 0x88b858, pipeline: 0xe36b35, power: 0xf0c64b, protected_area: 0x9b75c7 };
  const bbox = opts.bbox || (payload?.bbox
    ? [payload.bbox.west, payload.bbox.south, payload.bbox.east, payload.bbox.north]
    : null);
  if (!bbox || bbox.length !== 4 || !features.length) return { setVisible() {}, dispose() {} };
  const material = (type) => new THREE.MeshBasicMaterial({ color: colors[type] || 0xaaaaaa, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
  const point = ([lng, lat], lift = 0.6) => {
    const x = ((lng - bbox[0]) / Math.max(bbox[2] - bbox[0], 1e-9) - 0.5) * opts.meshW;
    // Terrain mesh (PlaneGeometry rotated -90° about X) places north at z=-meshD/2
    // and south at z=+meshD/2 — mirror latitude so features align with the parcel.
    const z = (0.5 - (lat - bbox[1]) / Math.max(bbox[3] - bbox[1], 1e-9)) * opts.meshD;
    const col = Math.max(0, Math.min(opts.cols - 1, Math.round((lng - bbox[0]) / Math.max(bbox[2] - bbox[0], 1e-9) * (opts.cols - 1))));
    const row = Math.max(0, Math.min(opts.rows - 1, Math.round((1 - (lat - bbox[1]) / Math.max(bbox[3] - bbox[1], 1e-9)) * (opts.rows - 1))));
    const elev = Number(opts.elevations[row * opts.cols + col]);
    // Match the terrain mesh elevation scale: (z - zMin) * heightScale * exag
    const y = Number.isFinite(elev) ? (elev - opts.zMin) * opts.heightScale * opts.exaggerate() + lift : lift;
    return new THREE.Vector3(x, y, z);
  };
  const polygonMesh = (ring, type) => {
    const base = ring.map((c) => point(c, 0.35));
    const height = type === 'building' ? 4 : 0.35;
    const top = ring.map((c) => point(c, 0.35 + height));
    const vertices = [];
    const pushTri = (a, b, c) => vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 1; i < base.length - 2; i++) pushTri(top[0], top[i], top[i + 1]);
    for (let i = 0; i < base.length - 1; i++) {
      pushTri(base[i], base[i + 1], top[i + 1]);
      pushTri(base[i], top[i + 1], top[i]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, material(type));
  };
  for (const feature of features) {
    const type = feature.feature_type;
    const layer = feature.layer || feature.priority_group || type;
    const geom = feature.geometry;
    let object = null;
    if (geom.type === 'Point') {
      object = new THREE.Mesh(new THREE.BoxGeometry(1.5, type === 'building' ? 3 : 1.2, 1.5), material(type));
      object.position.copy(point(geom.coordinates, type === 'building' ? 1.5 : 0.8));
    } else if (geom.type === 'LineString') {
      object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(geom.coordinates.map((c) => point(c, 0.8))), new THREE.LineBasicMaterial({ color: colors[type] || 0xaaaaaa }));
    } else if (geom.type === 'Polygon') {
      const ring = geom.coordinates?.[0] || [];
      if (ring.length < 3) continue;
      object = polygonMesh(ring, type);
    }
    if (!object) continue;
    object.userData.semanticFeature = feature;
    if (!groups.has(layer)) groups.set(layer, new THREE.Group());
    groups.get(layer).add(object);
  }
  for (const group of groups.values()) scene.add(group);
  return {
    setVisible(type, visible) { groups.get(type)?.traverse((o) => { o.visible = visible; }); },
    dispose() { for (const group of groups.values()) { group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); scene.remove(group); } },
  };
}

function topoHeatHtml(topo) {
  const g = topo.grid || {};
  const { rows, cols, values } = g;
  if (!rows || !cols || !values?.length) return '<p class="fine">No grid.</p>';
  const cells = values
    .map((v) => {
      if (v == null) return '<i class="topo-cell empty"></i>';
      const t = Math.round(30 + v * 55);
      // parkland soil horizon palette: dark low → gold high
      const bg = `hsl(32, ${35 + v * 25}%, ${t}%)`;
      return `<i class="topo-cell" style="background:${bg}"></i>`;
    })
    .join('');
  return `<div class="topo-heat" style="--cols:${cols}">${cells}</div>`;
}

function topoProfileSvg(profile) {
  if (!profile.length) return '<p class="fine">No profile.</p>';
  const w = 320;
  const h = 100;
  const min = Math.min(...profile);
  const max = Math.max(...profile);
  const span = max - min || 1;
  const pts = profile
    .map((z, i) => {
      const x = (i / Math.max(profile.length - 1, 1)) * (w - 16) + 8;
      const y = h - 12 - ((z - min) / span) * (h - 28);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `
    <svg class="topo-profile" viewBox="0 0 ${w} ${h}" role="img" aria-label="Elevation cross section">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#f7f8f3" stroke="#c8cec1"/>
      <polyline fill="none" stroke="#5b3a73" stroke-width="2" points="${pts}"/>
      <text x="8" y="14" class="svg-label">${max.toFixed(0)} m</text>
      <text x="8" y="${h - 6}" class="svg-label">${min.toFixed(0)} m</text>
    </svg>`;
}

/**
 * Render a topographical contour map from the elevation grid using
 * marching-squares on the sampled DEM. Returns an inline SVG suitable
 * for the report topology panel.
 */
function topoContourSvg(topo) {
  const g = topo.grid || {};
  const { rows, cols, values, elevations_m } = g;
  if (!rows || !cols || !elevations_m?.length) return '<p class="fine">No contour data.</p>';

  const valid = elevations_m.filter((z) => z != null && Number.isFinite(z));
  if (valid.length < 4) return '<p class="fine">Not enough elevation samples for contours.</p>';

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min;
  if (range < 0.5) return '<p class="fine">Elevation range too small for meaningful contours.</p>';

  // Auto-select an interval that gives ~8–14 contour levels
  const niceIntervals = [0.5, 1, 2, 5, 10, 20, 50];
  const targetLevels = 10;
  const rawInterval = range / targetLevels;
  let interval = niceIntervals[0];
  for (let i = niceIntervals.length - 1; i >= 0; i--) {
    if (niceIntervals[i] <= rawInterval * 1.6) {
      interval = niceIntervals[i];
      break;
    }
  }
  if (range / interval > 18) interval = niceIntervals.find((v) => v > interval) || interval;

  const levels = [];
  const start = Math.ceil(min / interval) * interval;
  for (let z = start; z < max; z += interval) levels.push(z);

  // Pad for marching squares: add 1 cell border so we can trace edges into the pad
  const pRows = rows + 2;
  const pCols = cols + 2;
  const pad = new Array(pRows * pCols).fill(NaN);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = elevations_m[r * cols + c];
      pad[(r + 1) * pCols + (c + 1)] = (v != null && Number.isFinite(v)) ? v : NaN;
    }
  }

  // Fill pad edges by nearest-neighbour replication so contours can reach boundary
  for (let r = 0; r < rows; r++) {
    pad[(r + 1) * pCols] = elevations_m[r * cols];
    pad[(r + 1) * pCols + (cols + 1)] = elevations_m[r * cols + (cols - 1)];
  }
  for (let c = 0; c < cols; c++) {
    pad[c + 1] = elevations_m[c];
    pad[(rows + 1) * pCols + (c + 1)] = elevations_m[(rows - 1) * cols + c];
  }
  pad[0] = elevations_m[0];
  pad[cols + 1] = elevations_m[cols - 1];
  pad[(rows + 1) * pCols] = elevations_m[(rows - 1) * cols];
  pad[(rows + 1) * pCols + (cols + 1)] = elevations_m[(rows - 1) * cols + (cols - 1)];

  const W = 320;
  const H = 220;
  const padX = 28;
  const padY = 24;
  const usableW = W - padX * 2;
  const usableH = H - padY * 2;

  const toX = (c) => padX + ((c - 1) / (cols - 1)) * usableW;
  const toY = (r) => padY + ((r - 1) / (rows - 1)) * usableH;

  // Marching squares per contour level
  const pathsByLevel = [];
  const isIndex = (z) => (Math.abs(z % (interval * 5)) < 0.001 || Math.abs(z % (interval * 5)) > (interval * 5) - 0.001);

  for (const level of levels) {
    const segments = [];

    // March through the interior (not pad)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const pr = r + 1;
        const pc = c + 1;
        const tl = pad[pr * pCols + pc];
        const tr = pad[pr * pCols + (pc + 1)];
        const bl = pad[(pr + 1) * pCols + pc];
        const br = pad[(pr + 1) * pCols + (pc + 1)];
        if ([tl, tr, bl, br].some((v) => !Number.isFinite(v))) continue;
        if (level <= Math.min(tl, tr, bl, br) || level >= Math.max(tl, tr, bl, br)) continue;

        const idx =
          (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);

        const cellW = toX(pc + 1) - toX(pc);
        const cellH = toY(pr + 1) - toY(pr);
        const cx = toX(pc);
        const cy = toY(pr);

        const pN = () => [cx + ((level - tl) / (tr - tl)) * cellW, cy];
        const pS = () => [cx + ((level - bl) / (br - bl)) * cellW, cy + cellH];
        const pW = () => [cx, cy + ((level - tl) / (bl - tl)) * cellH];
        const pE = () => [cx + cellW, cy + ((level - tr) / (br - tr)) * cellH];

        const addSeg = (a, b) => {
          const ax = Number(a[0].toFixed(1));
          const ay = Number(a[1].toFixed(1));
          const bx = Number(b[0].toFixed(1));
          const by = Number(b[1].toFixed(1));
          segments.push([ax, ay, bx, by]);
        };

        switch (idx) {
          case 0: case 15: break;
          case 1: case 14: addSeg(pW(), pS()); break;
          case 2: case 13: addSeg(pS(), pE()); break;
          case 3: case 12: addSeg(pW(), pE()); break;
          case 4: case 11: addSeg(pN(), pE()); break;
          case 6: case 9: addSeg(pN(), pS()); break;
          case 7: case 8: addSeg(pN(), pW()); break;
          case 5: addSeg(pN(), pW()); addSeg(pS(), pE()); break;
          case 10: addSeg(pN(), pE()); addSeg(pW(), pS()); break;
        }
      }
    }

    if (!segments.length) continue;

    // Chain segments into polylines
    const used = new Set();
    const lines = [];
    for (let i = 0; i < segments.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      let [ax, ay, bx, by] = segments[i];
      let headX = bx, headY = by;
      const pts = [[ax, ay], [bx, by]];

      // Extend forward
      let extended = true;
      while (extended) {
        extended = false;
        for (let j = 0; j < segments.length; j++) {
          if (used.has(j)) continue;
          const [sx, sy, ex, ey] = segments[j];
          if (Math.abs(sx - headX) < 0.6 && Math.abs(sy - headY) < 0.6) {
            used.add(j);
            headX = ex;
            headY = ey;
            pts.push([ex, ey]);
            extended = true;
            break;
          }
          if (Math.abs(ex - headX) < 0.6 && Math.abs(ey - headY) < 0.6) {
            used.add(j);
            headX = sx;
            headY = sy;
            pts.push([sx, sy]);
            extended = true;
            break;
          }
        }
      }

      // Generate smooth SVG path using cubic Bézier control points (Catmull-Rom → Bézier)
      const d = smoothSvgPath(pts);
      lines.push({ points: pts.map(p => p.join(',')).join(' '), d, level, isIndexContour: isIndex(level) });
    }

    pathsByLevel.push(...lines);
  }

  if (!pathsByLevel.length) return '<p class="fine">No contour lines generated for this grid resolution.</p>';

  const indexPaths = pathsByLevel.filter((l) => l.isIndexContour);
  const intermediatePaths = pathsByLevel.filter((l) => !l.isIndexContour);

  const indexD = indexPaths.map(
    (l) => `<path class="contour-index" d="${l.d || 'M' + l.points}"/>`
  ).join('');

  const interD = intermediatePaths.map(
    (l) => `<path class="contour-inter" d="${l.d || 'M' + l.points}"/>`
  ).join('');

  // Labels along index contours (place at midpoints of long segments)
  const labels = indexPaths.map((l) => {
    const coords = l.points.split(' ').map((p) => p.split(',').map(Number));
    if (coords.length < 3) return '';
    const mid = Math.floor(coords.length / 2);
    const [lx, ly] = coords[mid];
    // Only label if the point falls within the visible frame
    if (lx < padX + 4 || lx > W - padX - 4 || ly < padY + 4 || ly > H - padY - 4) return '';
    return `<text x="${lx.toFixed(1)}" y="${(ly - 3).toFixed(1)}" class="contour-label">${l.level.toFixed(l.level % 1 === 0 ? 0 : 1)} m</text>`;
  }).filter(Boolean).join('');

  // Scale bar
  let scaleDistM = 50;
  const cellMApprox = (range < 5 ? 10 : range < 20 ? 25 : range < 50 ? 50 : 100);
  while (scaleDistM / ((usableW / (cols - 1)) * 25) > usableW * 0.4) scaleDistM *= 2;
  const scalePx = (scaleDistM / 25) * (usableW / (cols - 1));
  const scaleLabelDist = scaleDistM < 1000 ? `${scaleDistM} m` : `${(scaleDistM / 1000).toFixed(1)} km`;

  const scaleBar = scalePx > 12 && scalePx < usableW * 0.8
    ? `<line x1="${(W - scalePx).toFixed(1)}" y1="${(H - 8).toFixed(1)}" x2="${W.toFixed(1)}" y2="${(H - 8).toFixed(1)}" stroke="var(--ink, #16211b)" stroke-width="3" stroke-linecap="round"/>
       <line x1="${W.toFixed(1)}" y1="${(H - 12).toFixed(1)}" x2="${W.toFixed(1)}" y2="${(H - 4).toFixed(1)}" stroke="var(--ink, #16211b)" stroke-width="1.5"/>
       <line x1="${(W - scalePx).toFixed(1)}" y1="${(H - 12).toFixed(1)}" x2="${(W - scalePx).toFixed(1)}" y2="${(H - 4).toFixed(1)}" stroke="var(--ink, #16211b)" stroke-width="1.5"/>
       <text x="${(W - scalePx / 2).toFixed(1)}" y="${(H - 2).toFixed(1)}" class="contour-scale-label" text-anchor="middle">${scaleLabelDist}</text>`
    : '';

  // Legend
  const legendItems = [
    { cls: 'contour-index', label: `Index (${(interval * 5)} m)` },
    { cls: 'contour-inter', label: `Intermediate (${interval} m)` },
  ];

  const legendHtml = legendItems.map((li, i) => {
    const yOff = 14 + i * 16;
    return `
      <line x1="${padX}" y1="${yOff}" x2="${padX + 20}" y2="${yOff}" class="${li.cls}" stroke-width="${li.cls === 'contour-index' ? 1.8 : 1}"/>
      <text x="${padX + 24}" y="${yOff + 3}" class="svg-label">${li.label}</text>`;
  }).join('');

  return `
    <svg class="topo-contour" viewBox="0 0 ${W} ${H}" role="img" aria-label="Topographical contour map">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#f7f8f3" stroke="#c8cec1"/>
      <!-- Grid shading: light wash from the normalized heat values -->
      ${gridShading(values, cols, rows, padX, padY, usableW, usableH)}
      ${interD}
      ${indexD}
      ${labels}
      ${legendHtml}
      ${scaleBar}
    </svg>`;
}

/**
 * Convert an array of [x,y] points into a smooth SVG path using
 * Catmull-Rom → cubic Bézier conversion for natural-looking contour curves.
 */
function smoothSvgPath(pts, tension = 0.3) {
  if (pts.length < 2) return 'M' + pts.map(p => p.join(',')).join(' L');
  if (pts.length === 2) return `M${pts[0].join(',')} L${pts[1].join(',')}`;
  const segs = [`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
    segs.push(`C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`);
  }
  return segs.join(' ');
}

function gridShading(normValues, cols, rows, padX, padY, usableW, usableH) {
  if (!normValues?.length || !cols || !rows) return '';
  // Draw faint rects to give elevation context behind the contour lines
  const cellW = usableW / (cols - 1);
  const cellH = usableH / (rows - 1);
  // Use a handful of representative quads — full per-cell rects would be heavy SVG
  const step = Math.max(2, Math.ceil(Math.max(cols, rows) / 12));
  let rects = '';
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const v = normValues[r * cols + c];
      if (v == null || !Number.isFinite(v)) continue;
      const t = Math.round(85 + v * 18);
      const fill = `hsl(32, ${15 + v * 12}%, ${t}%)`;
      const x = (padX + (c / (cols - 1)) * usableW - cellW * step * 0.45).toFixed(1);
      const y = (padY + (r / (rows - 1)) * usableH - cellH * step * 0.45).toFixed(1);
      const w = (cellW * step * 0.9).toFixed(1);
      const h = (cellH * step * 0.9).toFixed(1);
      rects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="0.35" rx="1"/>`;
    }
  }
  return rects;
}

function proximitySection(px, water, city, settlement, crime, nearestCrimes, centre) {
  return `
    <section class="report-block">
      <h2>Proximity &amp; context</h2>
      <div class="prox-grid">
        <article class="prox-card">
          <span class="mono">Nearest water</span>
          ${
            water
              ? `<strong>${fmtDistance(water.distance_m)}</strong>
                 <p>${esc(water.feature_type || 'water')}${
                   water.feature_name ? ` · ${esc(water.feature_name)}` : ''
                 }</p>`
              : `<strong>—</strong><p class="fine">No surface water found within search radius.</p>`
          }
        </article>
        <article class="prox-card">
          <span class="mono">Nearest city centre</span>
          ${
            city
              ? `<strong>${esc(city.name)}</strong>
                 <p>${fmt(city.distance_km, 'km')}${
                   city.population != null
                     ? ` · pop. ~${Number(city.population).toLocaleString('en-CA')}`
                     : ''
                 }</p>`
              : `<strong>—</strong><p class="fine">No city match.</p>`
          }
        </article>
        <article class="prox-card">
          <span class="mono">Nearest settlement</span>
          ${
            settlement
              ? `<strong>${esc(settlement.name)}</strong>
                 <p>${fmt(settlement.distance_km, 'km')} · ${esc(
                   (settlement.settlement_type || '').replace(/_/g, ' ')
                 )}</p>`
              : `<strong>—</strong><p class="fine">—</p>`
          }
        </article>
      </div>

      <div class="crime-card">
        <span class="mono">Crime awareness — RCMP / Rural Crime Watch</span>
        <p class="fine" style="margin:0.4rem 0 0.65rem">
          Primary map:
          <a href="${esc(rcmpCrimeMapEmbedUrl(centre))}" target="_blank" rel="noopener">RCMP Area Crime Map</a>
          (Alberta Rural Crime Watch). Full interactive map is in <strong>Findings → Security</strong>.
        </p>
        ${
          crime
            ? `
          <div class="summary-grid" style="margin:0.6rem 0">
            <div class="stat"><span class="k">Classification</span><strong>${esc(
              crime.rural_or_urban_classification
            )}</strong></div>
            <div class="stat"><span class="k">Crime Severity Index</span><strong>${
              crime.crime_severity_index != null ? esc(crime.crime_severity_index) : '—'
            }</strong></div>
            <div class="stat"><span class="k">Data year</span><strong>${esc(
              crime.data_year || '—'
            )}</strong></div>
          </div>
          <p class="fine"><strong>Reporting area:</strong> ${esc(
            crime.reporting_jurisdiction || '—'
          )}</p>
          <div class="flag" data-severity="caution" style="margin-top:0.75rem">
            <strong>Important caveat</strong>
            <p>${esc(
              crime.disclaimer ||
                'Canadian crime statistics are published by police service, not by address. This is jurisdiction-level context only — not a safety score for your parcel.'
            )}</p>
          </div>`
            : `<p class="fine">Open the RCMP map for current rural incident locations. Jurisdiction CSI is optional context when available.</p>`
        }
      </div>
    </section>`;
}

/** Alberta RCMP / Rural Crime Watch public crime map (province-wide). */
const RCMP_CRIME_MAP_PAGE =
  'https://www.ruralcrimewatch.ab.ca/resources/RCMP-area-crime-map';
const RCMP_CRIME_MAP_VIEWER =
  'https://rcmp-k-div.maps.arcgis.com/apps/webappviewer/index.html?id=f648d78dbfb143d0b3bdf47d8eb2bbee';

function rcmpCrimeMapEmbedUrl(centre) {
  if (centre && Number.isFinite(centre.latitude) && Number.isFinite(centre.longitude)) {
    return `${RCMP_CRIME_MAP_VIEWER}&center=${centre.longitude},${centre.latitude}&level=10`;
  }
  return RCMP_CRIME_MAP_VIEWER;
}

/**
 * Primary crime map for Alberta parcels — RCMP Area Crime Map via Rural Crime Watch.
 */
function rcmpCrimeMapSection(centre) {
  const mapUrl = rcmpCrimeMapEmbedUrl(centre);
  return `
    <section class="report-block">
      <h2>RCMP area crime map</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Live Alberta RCMP crime awareness map from
        <a href="${esc(RCMP_CRIME_MAP_PAGE)}" target="_blank" rel="noopener">Alberta Rural Crime Watch</a>.
        Approximate recent incidents for community awareness — not a parcel risk score.
      </p>
      <div class="rcmp-crime-map-wrap" style="margin-top:0.65rem;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0f1410">
        <iframe
          title="Alberta RCMP Area Crime Map"
          src="${esc(mapUrl)}"
          style="width:100%;height:min(520px,70vh);border:0;display:block"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen
        ></iframe>
      </div>
      <p class="fine" style="margin-top:0.55rem">
        <a class="rec-service-link" href="${esc(mapUrl)}" target="_blank" rel="noopener">Open map fullscreen →</a>
        ·
        <a href="${esc(RCMP_CRIME_MAP_PAGE)}" target="_blank" rel="noopener">Rural Crime Watch resource page</a>
        · Report suspicious activity: <a href="#">local authorities</a>
        · For emergencies, contact emergency services
      </p>
      <div class="flag" data-severity="caution" style="margin-top:0.65rem">
        <strong>Important caveat</strong>
        <p>
          RCMP publishes approximate incident locations for public awareness; data may be delayed or incomplete.
          This is situational awareness only — not a safety rating, insurance product, or police clearance for your property.
        </p>
      </div>
    </section>`;
}

function nearestCrimesSection(nc, centre) {
  // EPS city layer is optional context inside Edmonton only
  if (!nc?.available || !nc?.nearest?.length) {
    if (nc && nc.in_eps_coverage === false) {
      return `
        <div class="crime-nearest" style="margin-top:0.75rem">
          <p class="fine" style="margin:0">
            Edmonton EPS nearest-occurrence list applies only inside / near the city.
            Use the <strong>RCMP area crime map</strong> above for Alberta rural / provincial context.
          </p>
        </div>`;
    }
    return '';
  }
  const rows = (nc.nearest || [])
    .map(
      (c, i) => `
    <tr>
      <td class="mono">${i + 1}</td>
      <td>${fmtDistance(c.distance_m)}</td>
      <td><strong>${esc(c.occurrence_type || '—')}</strong>
        <div class="fine">${esc(c.occurrence_group || '')}${
          c.occurrence_category ? ` · ${esc(c.occurrence_category)}` : ''
        }</div>
      </td>
      <td>${esc(c.intersection || '—')}</td>
      <td class="mono">${esc(c.date_reported || '—')}</td>
    </tr>`
    )
    .join('');

  const chips = Object.entries(nc.summary?.by_occurrence_type || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(
      ([t, n]) =>
        `<span class="plant-chip"><strong>${esc(n)}</strong>${esc(t)}</span>`
    )
    .join('');

  return `
    <div class="crime-nearest" style="margin-top:1.1rem">
      <span class="mono">Supplemental — Edmonton EPS nearest occurrences</span>
      <p class="fine" style="margin:0.35rem 0 0.6rem">${esc(nc.note || '')}
        City of Edmonton Community Safety Map only (not RCMP rural map).
      </p>
      ${crimeMinimap(nc, centre)}
      ${chips ? `<div class="plant-chips">${chips}</div>` : ''}
      <div class="econ-table-wrap crime-table-wrap">
        <table class="econ-table crime-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Distance</th>
              <th>Type of crime / occurrence</th>
              <th>Intersection</th>
              <th>Reported</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5">No occurrences in search radius.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="fine" style="margin-top:0.6rem">${esc(nc.disclaimer || '')}
        ${
          nc.source_url
            ? ` · <a href="${esc(nc.source_url)}" target="_blank" rel="noopener">EPS Community Safety Map</a>`
            : ''
        }
      </p>
    </div>`;
}

function solarSection(solar) {
  if (!solar) {
    return `<section class="report-block"><h2>Solar incidence &amp; viability</h2><p class="fine">Solar assessment unavailable.</p></section>`;
  }
  if (!solar.available) {
    return `
      <section class="report-block">
        <h2>Solar incidence &amp; viability</h2>
        <p class="fine">${esc(solar.error || 'No NRCan municipality match.')}</p>
      </section>`;
  }
  const m = solar.mean_daily_global_insolation_kwh_m2 || {};
  const y = solar.estimated_pv_yield || {};
  const solarPlan = solar.planning_scenario || {};
  const v = solar.viability || {};
  const monthly = solar.monthly_latitude_tilt || [];
  const bars = monthlySolarBars(monthly);

  return `
    <section class="report-block">
      <h2>Solar incidence &amp; viability</h2>
      <p class="fine" style="margin-top:-0.35rem">
        NRCan municipality averages for <strong>${esc(solar.municipality)}</strong>
        ${
          solar.distance_to_station_municipality_km != null
            ? ` (~${esc(solar.distance_to_station_municipality_km)} km from parcel)`
            : ''
        }
        · band <strong class="solar-band solar-band-${esc(v.band || 'unknown')}">${esc(
          v.band || '—'
        )}</strong>
      </p>
      <div class="summary-grid">
        <div class="stat"><span class="k">Lat. tilt (annual mean)</span><strong>${
          m.south_latitude_tilt != null ? `${esc(m.south_latitude_tilt)} kWh/m²·d` : '—'
        }</strong></div>
        <div class="stat"><span class="k">Horizontal</span><strong>${
          m.horizontal_0 != null ? `${esc(m.horizontal_0)} kWh/m²·d` : '—'
        }</strong></div>
        <div class="stat"><span class="k">2-axis tracking</span><strong>${
          m.tracking_2axis != null ? `${esc(m.tracking_2axis)} kWh/m²·d` : '—'
        }</strong></div>
        <div class="stat"><span class="k">Est. fixed PV yield</span><strong>${
          y.fixed_south_latitude_tilt_kwh_per_kwp_year != null
            ? `${esc(y.fixed_south_latitude_tilt_kwh_per_kwp_year)} kWh/kWp·yr`
            : '—'
        }</strong></div>
        ${solarPlan.annual_generation_kwh != null ? `<div class="stat"><span class="k">Illustrative 5 kWp generation</span><strong>${esc(solarPlan.annual_generation_kwh)} kWh/yr</strong></div>` : ''}
        ${solarPlan.annual_grid_savings_cad != null ? `<div class="stat"><span class="k">Illustrative annual grid savings</span><strong>$${esc(solarPlan.annual_grid_savings_cad)} CAD/yr</strong></div>` : ''}
      </div>
      <p class="fine" style="margin:0.75rem 0 0.5rem">${esc(v.summary || '')}</p>
      ${
        solarPlan.note
          ? `<p class="fine" style="margin-top:0.5rem"><strong>Illustrative planning scenario:</strong> ${esc(solarPlan.note)}</p>`
          : ''
      }
      ${
        solar.aspect_guidance
          ? `<p class="fine"><strong>Site aspect:</strong> ${esc(solar.aspect_guidance)}</p>`
          : ''
      }
      ${bars}
      ${solar?.monthly_latitude_tilt?.length ? dailySolarProfile(solar.monthly_latitude_tilt) : ''}
      <div class="flag" data-severity="info" style="margin-top:0.85rem">
        <strong>Methodology note</strong>
        <p>${esc(solar.methodology_note || '')} ${esc(solar.disclaimer || '')}</p>
      </div>
    </section>`;
}

function dailySolarProfile(monthly) {
  // For each month, show a bell-shaped irradiance profile across 24 hours
  // Peak at solar noon, zero before dawn/after dusk
  const hours = 24;
  const w = 380;
  const h = 200;
  const padX = 36;
  const padY = 20;
  const usableW = w - padX * 2;
  const usableH = h - padY - 10;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Approximate daylight hours per month at 53°N latitude (Alberta)
  const daylightHours = [8, 9.5, 12, 14, 15.5, 17, 16.5, 15, 13, 11, 8.5, 7.5];
  // Sun hours for each month index (matching monthly data: Jan=0..Dec=11)
  const sunHours = monthly.map((m, i) => {
    const mi = monthNames.indexOf((m.month || '').slice(0, 3));
    return mi >= 0 ? daylightHours[mi] : 12;
  });
  const peaks = monthly.map((m) => Number(m.latitude_tilt_kwh_m2_day) || 0);

  const hScale = 12; // noon = hour 12, range 5am to 8pm = 15 points

  const profiles = monthly.map((m, i) => {
    const peak = peaks[i] || 0;
    const dh = sunHours[i];
    const riseHr = 12 - dh / 2;
    const setHr = 12 + dh / 2;
    const pts = [];
    for (let hr = 5; hr <= 21; hr++) {
      const t = (hr - riseHr) / (setHr - riseHr);
      const val = t > 0 && t < 1 ? peak * Math.sin(t * Math.PI) : 0;
      pts.push(Math.max(0, Math.round(val * 1000) / 1000));
    }
    return pts;
  });

  const maxPeak = Math.max(...peaks, 0.01);
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const colors = ['#5b3a73','#2a6f97','#3d9dc9','#5bc0be','#2196f3','#1565c0','#1b4f72','#2e86c1','#3498db','#5dade2','#7fb3d8','#a5c8e1'];

  // Single summary chart for July (highest) as the main profile
  const julIdx = 6;
  const julPeak = peaks[julIdx];
  const julDH = sunHours[julIdx];
  const julRise = 12 - julDH / 2;
  const julSet = 12 + julDH / 2;

  const profilePts = [];
  for (let hr = 5; hr <= 21; hr++) {
    const t = (hr - julRise) / (julSet - julRise);
    const val = t > 0 && t < 1 ? julPeak * Math.sin(t * Math.PI) : 0;
    profilePts.push({ hr, val: Math.max(0, Math.round(val * 1000) / 1000) });
  }

  const barH = profilePts.map((p) => {
    const x = padX + (p.hr - 5) / (21 - 5) * usableW;
    const bH = (p.val / (julPeak || 0.01)) * usableH;
    const y = padY + usableH - bH;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(usableW / 16 - 2).toFixed(1)}" height="${bH.toFixed(1)}" fill="#a8801f" opacity="0.7" rx="1">
      <title>${p.hr}:00 — ${p.val} kWh/m²·d</title>
    </rect>
    <text x="${(x + usableW / 32).toFixed(1)}" y="${(y - 3).toFixed(1)}" class="temp-val-label">${p.val}</text>`;
  }).join('');

  const hourLabels = [5,8,11,14,17,20].map((hr) => {
    const x = padX + (hr - 5) / (21 - 5) * usableW;
    return `<text x="${x.toFixed(1)}" y="${(padY + usableH + 12).toFixed(1)}" class="temp-month-label" text-anchor="middle">${hr}:00</text>`;
  }).join('');

  return `
    <div class="temp-month-wrap" style="margin-top:0.85rem">
      <span class="mono topo-label">Average daily irradiance profile (southern latitude tilt) — summer peak month</span>
      <svg class="temp-month-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily solar irradiance profile">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#f7f8f3" stroke="#c8cec1"/>
        <line x1="${padX}" y1="${(padY + usableH).toFixed(1)}" x2="${(padX + usableW).toFixed(1)}" y2="${(padY + usableH).toFixed(1)}" stroke="#c8cec1" stroke-width="1"/>
        <text x="4" y="${(padY + 8).toFixed(1)}" class="svg-label">${julPeak.toFixed(2)}</text>
        <text x="4" y="${(padY + usableH).toFixed(1)}" class="svg-label">0</text>
        ${barH}
        ${hourLabels}
      </svg>
      <p class="fine" style="margin-top:0.3rem">
        Bell-curve approximation for the highest-solar month (${labels[julIdx] || 'July'}).
        Daylight window: ${sunHours[julIdx].toFixed(1)} hours. Peak: ${julPeak} kWh/m²·d at solar noon.
      </p>
    </div>`;
}

function monthlySolarBars(monthly) {
  if (!monthly?.length) return '';
  const max = Math.max(
    ...monthly.map((m) => Number(m.latitude_tilt_kwh_m2_day) || 0),
    0.01
  );
  const cells = monthly
    .map((m) => {
      const v = Number(m.latitude_tilt_kwh_m2_day) || 0;
      const h = Math.round((v / max) * 100);
      const label = (m.month || '').slice(0, 3);
      return `<div class="solar-bar" title="${esc(m.month)}: ${esc(v)} kWh/m²·d">
        <i style="height:${h}%"></i>
        <span>${esc(label)}</span>
        <em>${esc(v)}</em>
      </div>`;
    })
    .join('');
  return `
    <div class="solar-month-wrap">
      <span class="mono topo-label">Monthly mean daily insolation — south latitude tilt (kWh/m²·d)</span>
      <div class="solar-bars">${cells}</div>
    </div>`;
}

function temperatureSection(tp) {
  if (!tp || !tp.available) return '';
  const a = tp.annual || {};
  const s = tp.seasonal || {};
  const months = tp.monthly || [];

  const barSvg = months.length ? monthlyTempBars(months) : '';

  return `
    <section class="report-block">
      <h2>Temperature profile</h2>
      <p class="fine" style="margin-top:-0.35rem">
        ${esc(tp.source_name || 'Open-Meteo daily archive')}.
        Period: ${esc(tp.period?.start || '—')} – ${esc(tp.period?.end || '—')} (${esc(tp.period?.days || '—')} days).
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Annual mean</span><strong>${fmt(a.mean_c, '°C')}</strong></div>
        <div class="stat"><span class="k">Annual high</span><strong>${fmt(a.high_c, '°C')}</strong></div>
        <div class="stat"><span class="k">Annual low</span><strong>${fmt(a.low_c, '°C')}</strong></div>
        <div class="stat"><span class="k">Coldest month low</span><strong>${fmt(s.coldest_month_avg_low_c, '°C')}</strong></div>
        <div class="stat"><span class="k">Warmest month high</span><strong>${fmt(s.warmest_month_avg_high_c, '°C')}</strong></div>
        <div class="stat"><span class="k">Frost days / yr</span><strong>${esc(s.frost_days_per_year != null ? s.frost_days_per_year : '—')}</strong></div>
        <div class="stat"><span class="k">>30°C days / yr</span><strong>${esc(s.extreme_heat_days_per_year != null ? s.extreme_heat_days_per_year : '—')}</strong></div>
        <div class="stat"><span class="k">GDD base 5°C</span><strong>${esc(tp.growing_degree_days_base5 != null ? tp.growing_degree_days_base5 : '—')}</strong></div>
      </div>

      ${barSvg}

      <p class="fine" style="margin-top:0.5rem">${esc(tp.methodology_note || '')}</p>
    </section>`;
}

function monthlyTempBars(months) {
  if (!months.length) return '';
  const maxHigh = Math.max(...months.map((m) => m.avg_max || -50), 0.1);
  const minLow = Math.min(...months.map((m) => m.avg_min || 50), 50);

  const h = 160;
  const w = 380;
  const padX = 32;
  const padY = 32;
  const usableW = w - padX * 2;
  const usableH = h - padY * 2;
  const range = maxHigh - minLow || 1;

  const bars = months.map((m, i) => {
    const x = padX + (i / (months.length - 1)) * usableW;
    // High bar (warm)
    const highY = padY + ((maxHigh - (m.avg_max || 0)) / range) * usableH;
    const highH = padY + ((maxHigh - minLow) / range) * usableH - highY;
    // Low bar (cold)
    const lowTop = padY + ((maxHigh - (m.avg_min || 0)) / range) * usableH;
    const lowH = padY + usableH - lowTop;
    return `<g>
      <rect x="${(x - 6).toFixed(1)}" y="${highY.toFixed(1)}" width="12" height="${Math.max(2, highH).toFixed(1)}" fill="#c23e2e" opacity="0.7" rx="2"/>
      <rect x="${(x - 6).toFixed(1)}" y="${lowTop.toFixed(1)}" width="12" height="${Math.max(2, lowH).toFixed(1)}" fill="#2a6f97" opacity="0.7" rx="2"/>
      <text x="${x.toFixed(1)}" y="${(h - 8).toFixed(1)}" class="temp-month-label" text-anchor="middle">${esc(m.month || '')}</text>
      <text x="${x.toFixed(1)}" y="${(highY - 3).toFixed(1)}" class="temp-val-label" text-anchor="middle">${(m.avg_max || 0).toFixed(0)}</text>
      <text x="${x.toFixed(1)}" y="${(lowTop + lowH + 9).toFixed(1)}" class="temp-val-label" text-anchor="middle">${(m.avg_min || 0).toFixed(0)}</text>
    </g>`;
  }).join('');

  return `
    <div class="temp-month-wrap" style="margin-top:0.9rem">
      <span class="mono topo-label">Monthly avg. high (red) / low (blue) — °C</span>
      <svg class="temp-month-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly temperature chart">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#f7f8f3" stroke="#c8cec1"/>
        <line x1="${padX}" y1="${(padY + usableH).toFixed(1)}" x2="${(padX + usableW).toFixed(1)}" y2="${(padY + usableH).toFixed(1)}" stroke="#c8cec1" stroke-width="1"/>
        <text x="4" y="${(padY + 8).toFixed(1)}" class="svg-label">${maxHigh.toFixed(0)}°</text>
        <text x="4" y="${(padY + usableH).toFixed(1)}" class="svg-label">${minLow.toFixed(0)}°</text>
        ${bars}
      </svg>
    </div>`;
}

function wildlifeSection(wl) {
  if (!wl || !wl.available) return '';
  const deer = wl.white_tailed_deer;
  if (!deer) return '';

  const recList = (deer.recommendations || []).map((r) => `<li>${esc(r)}</li>`).join('');
  const sightings = wl.recent_sightings && typeof wl.recent_sightings === 'object' && !Array.isArray(wl.recent_sightings) ? wl.recent_sightings : null;

  return `
    <section class="report-block">
      <h2>Wildlife — White-tailed Deer</h2>
      <p class="fine" style="margin-top:-0.35rem">
        iNaturalist research-grade observations (last 5 years) + Alberta county-level deer habitat heuristic.
        Presence should be assumed for any rural Alberta property regardless of score.
      </p>

      <div class="well-range-card" style="border-left-color:var(--caution)">
        <span class="mono">Deer pressure assessment</span>
        <div class="well-range-value" style="font-size:clamp(1.3rem, 3vw, 1.8rem);color:var(--caution)">
          ${esc(deer.pressure_label)}
          <span style="font-size:0.8rem;color:var(--ink-soft);margin-left:0.5rem">(score ${deer.pressure_score})</span>
        </div>
        <p class="fine">
          ${sightings
            ? `${sightings.count} research-grade iNaturalist sightings in the search area${sightings.last_seen ? ` · last: ${esc(sightings.last_seen)}` : ''}`
            : 'No recent iNaturalist sightings in search area'}
          ${deer.by_taxon && Object.keys(deer.by_taxon).length
            ? ` · species: ${Object.entries(deer.by_taxon).map(([k, v]) => `${esc(k)} (${v})`).join(', ')}`
            : ''}
        </p>
        ${recList ? `<ul class="wildlife-recs" style="margin:0.6rem 0 0;padding-left:1.2rem;font-size:0.92rem;color:var(--ink-soft);line-height:1.6">${recList}</ul>` : ''}
      </div>

      <p class="fine" style="margin-top:0.6rem">${esc(wl.methodology_note || '')}</p>
    </section>`;
}

function nearestRoadCardHtml(road = {}) {
  if (road.available && (road.name || road.type || road.distance_m != null)) {
    const dist =
      road.distance_m != null
        ? road.distance_m >= 1000
          ? `${(road.distance_m / 1000).toFixed(2)} km`
          : `${Math.round(road.distance_m)} m`
        : null;
    const typeBits = [road.type, road.surface, road.tracktype].filter(Boolean).join(' · ');
    const unnamedNote =
      road.named === false
        ? '<p class="fine">No street name in OSM — often a range road, township road, or farm access track.</p>'
        : '';
    const distNote =
      dist != null
        ? ` · ${esc(dist)} to centreline`
        : '';
    return `
      <strong>${esc(road.name || `Unnamed ${road.type || 'road'}`)}</strong>
      <p>${esc(typeBits || 'driving network')}${distNote}</p>
      ${unnamedNote}
      ${road.source ? `<p class="fine">${esc(road.source)}</p>` : ''}
      ${road.note && road.distance_m == null ? `<p class="fine">${esc(road.note)}</p>` : ''}`;
  }
  if (road.error) {
    return `
      <strong>—</strong>
      <p class="fine">Road lookup failed (${esc(road.error)}). ${esc(
        road.note || 'Try regenerating the report.'
      )}</p>`;
  }
  if (road.available === false) {
    return `
      <strong>—</strong>
      <p class="fine">${esc(
        road.note ||
          'No driveable road found nearby in OpenStreetMap. Property may sit on an unmapped range road or trail.'
      )}</p>`;
  }
  return `<strong>—</strong><p class="fine">No road data available.</p>`;
}

function accessSection(acc, cityName, cityDistKm) {
  if (!acc) return '';
  // Still show section while access is loading / failed partially
  const road = acc.nearest_road || {};
  const trips = acc.trip_costs_to_city || acc.trip_costs_to_supermarket || [];
  const distLabel = acc.nearest_city_distance_km || cityDistKm;

  const tripRows = trips.map((t) => `
    <tr>
      <td><strong>${esc(t.vehicle)}</strong></td>
      <td>${esc(t.travelTimeOneWayFormatted)}</td>
      <td class="mono">${t.roundTripCostCad != null ? `$${t.roundTripCostCad.toFixed(2)}` : '—'}</td>
      <td class="fine">${t.fuelConsumedL ? `${t.fuelConsumedL}L` : t.electricityCostCad ? `$${t.electricityCostCad.toFixed(2)} elec` : '—'}</td>
    </tr>
  `).join('');

  return `
    <section class="report-block">
      <h2>Access & mobility</h2>
      <p class="fine" style="margin-top:-0.35rem">
        ${esc(acc.methodology || '')}. Gas: $${acc.gas_price_cad_l}/L.
      </p>

      <div class="prox-grid">
        <article class="prox-card">
          <span class="mono">Nearest road</span>
          ${nearestRoadCardHtml(road)}
        </article>
        <article class="prox-card">
          <span class="mono">Driving to city centre</span>
          ${cityName
            ? `<strong>${esc(cityName)}</strong>
               <p>${fmt(distLabel, 'km')} one-way</p>`
            : `<strong>—</strong><p class="fine">No nearby city identified.</p>`}
        </article>
      </div>

      ${tripRows ? `
        <div class="econ-table-wrap" style="margin-top:0.5rem">
          <table class="econ-table">
            <thead>
              <tr><th>Vehicle</th><th>Time (one-way)</th><th>Round trip cost</th><th>Fuel / energy</th></tr>
            </thead>
            <tbody>${tripRows}</tbody>
          </table>
        </div>
        <p class="fine" style="margin-top:0.35rem">
          Round-trip cost to ${esc(cityName || 'nearest city')} (${fmt(distLabel, 'km')} each way).
        </p>
      ` : ''}
    </section>`;
}

function atsSection(ats, pa) {
  if (!ats) return '';
  const centroid = pa?.centroid;
  return `
    <section class="report-block">
      <h2>Legal land description & address</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Alberta Township System (ATS) quarter-section from parcel centroid${centroid ? ` (${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)})` : ''}.
      </p>

      <div class="well-range-card" style="border-left-color:var(--berry)">
        <span class="mono">Prospective address</span>
        <div class="well-range-value" style="font-size:clamp(1.1rem, 2.5vw, 1.5rem)">
          ${esc(`Near ${ats.description}`)}
        </div>
        <p class="fine">
          Quarter: ${esc(ats.quarter)} · Section: ${ats.section} · Township: ${ats.township} · Range: ${ats.range} · Meridian: ${esc(ats.meridian)}
          ${pa?.locality ? ` · near ${esc(pa.locality)}` : ''}
        </p>
      </div>

      <div class="summary-grid">
        <div class="stat"><span class="k">Quarter</span><strong>${esc(ats.quarter)}</strong></div>
        <div class="stat"><span class="k">Section</span><strong>${ats.section}</strong></div>
        <div class="stat"><span class="k">Township</span><strong>${ats.township}</strong></div>
        <div class="stat"><span class="k">Range</span><strong>${ats.range} ${esc(ats.meridian)}</strong></div>
      </div>
    </section>`;
}

function demographicsSection(demo) {
  if (!demo || !demo.available) return '';
  const d = demo.demographics || {};

  const rows = [
    ['total_population', 'Population (2021)'],
    ['pop_density_per_km2', 'Density (/km²)'],
    ['median_age', 'Median age'],
    ['median_after_tax_income', 'Median after-tax income'],
    ['avg_household_size', 'Avg household size'],
    ['pct_owner_households', 'Owner households'],
    ['pct_bachelor_or_higher', 'Bachelor+ degree'],
    ['pct_labour_force_participation', 'Labour force participation'],
    ['pct_car_truck_van_commute', 'Commute by car/truck'],
    ['pct_ag_forestry_fishing_industry', 'Ag/forestry/fishing employment'],
  ].filter(([key]) => d[key]).map(([key, label]) => {
    const v = d[key];
    return `<div class="stat"><span class="k">${esc(label)}</span><strong>${esc(v.value != null ? v.value.toLocaleString('en-CA') : '—')}${v.unit ? ' ' + esc(v.unit) : ''}</strong></div>`;
  }).join('');

  return `
    <section class="report-block">
      <h2>Regional demographics</h2>
      <p class="fine" style="margin-top:-0.35rem">
        ${esc(demo.geography_name || 'Census area')} · ${esc(demo.census_year || '2021')} Census · ${esc(demo.methodology || '')}
      </p>
      <div class="summary-grid">${rows}</div>
      <p class="fine"><a href="${esc(demo.source_url || 'https://www12.statcan.gc.ca/')}" target="_blank" rel="noopener">Source: Statistics Canada</a></p>
    </section>`;
}

function treeCoverSection(tc) {
  if (!tc || !tc.available) return '';
  const recList = (tc.recommendations || []).map((r) => `<li>${esc(r)}</li>`).join('');

  return `
    <section class="report-block">
      <h2>Tree canopy cover</h2>
      <p class="fine" style="margin-top:-0.35rem">
        ${esc(tc.methodology_note || '')}
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Tree cover</span><strong>${esc(tc.tree_cover_pct || '—')}%</strong></div>
        <div class="stat"><span class="k">Method</span><strong>${esc(tc.method || 'heuristic')}</strong></div>
      </div>

      ${recList ? `<ul class="wildlife-recs" style="margin:0.6rem 0 0;padding-left:1.2rem;font-size:0.92rem;color:var(--ink-soft);line-height:1.6">${recList}</ul>` : ''}

      <p class="fine" style="margin-top:0.6rem">${esc(tc.treed_acres_estimate || '')}</p>
    </section>`;
}

function hardinessFloodZoningSection(hardiness, flood, zoning, r) {
  const zone = hardiness?.hardiness_zone || r.climate?.plant_hardiness_zone;
  const ffd =
    hardiness?.frost_free_days_estimate ?? r.climate?.frost_free_days;
  const floodClass = flood?.flood_hazard_class || 'unknown';
  const floodSeverity =
    floodClass === 'floodway' || floodClass === 'high_hazard_fringe'
      ? 'block'
      : floodClass === 'flood_fringe'
        ? 'caution'
        : floodClass === 'no_data' || floodClass === 'unknown'
          ? 'caution'
          : 'info';

  const floodBody = floodFloodCardBody(flood, floodClass);

  return `
    <section class="report-block">
      <h2>Climate hardiness · flood · zoning</h2>
      <div class="prox-grid phase2-grid">
        <article class="prox-card">
          <span class="mono">Plant hardiness (NRCan 4th ed.)</span>
          <strong>Zone ${esc(zone || '—')}</strong>
          <p>
            ${ffd != null ? `~${esc(ffd)} frost-free days` : '—'}
            ${
              hardiness?.last_spring_frost_approx
                ? `<br>Last spring frost ~${esc(hardiness.last_spring_frost_approx)}`
                : ''
            }
            ${
              hardiness?.first_fall_frost_approx
                ? `<br>First fall frost ~${esc(hardiness.first_fall_frost_approx)}`
                : ''
            }
          </p>
          <p class="fine">${esc(
            hardiness?.methodology_note ||
              'Live NRCan plant hardiness zone query.'
          )}</p>
        </article>
        <article class="prox-card flood-card" data-severity="${esc(floodSeverity)}">
          <span class="mono">Flood hazard (Alberta FHIP)</span>
          ${floodBody}
        </article>
        <article class="prox-card">
          <span class="mono">Zoning (portal link — not auto-classified)</span>
          <strong>${esc(zoning?.municipality || r.location?.municipality || '—')}</strong>
          <p class="fine">
            Designation: <em>not automated</em> (municipal bylaws / AltaLIS).
          </p>
          <p>
            ${
              zoning?.zoning_bylaw_url || zoning?.zoning_source_url
                ? `<a href="${esc(
                    zoning.zoning_bylaw_url || zoning.zoning_source_url
                  )}" target="_blank" rel="noopener">Land use / zoning bylaw</a>`
                : '—'
            }
            ${
              zoning?.zoning_gis_url
                ? `<br><a href="${esc(zoning.zoning_gis_url)}" target="_blank" rel="noopener">Municipal GIS map</a>`
                : ''
            }
          </p>
        </article>
      </div>
    </section>`;
}

function labelFlood(c) {
  return (
    {
      floodway: 'Floodway',
      high_hazard_fringe: 'High-hazard flood fringe',
      flood_fringe: 'Flood fringe',
      protected_fringe: 'Protected flood fringe',
      other: 'Flood hazard area',
      no_data: 'No mapped data',
      unknown: 'Unknown',
    }[c] || c || '—'
  );
}

/** Single coherent FHIP card body — avoid repeating note + caveat. */
function floodFloodCardBody(flood, floodClass) {
  const awareness =
    flood?.awareness_map || 'https://floods.alberta.ca';
  const sourceUrl =
    flood?.source_url ||
    'https://open.alberta.ca/opendata/gda-2ae32b0d-c6f9-4e1b-81ab-6fdecc728e28';

  if (floodClass === 'no_data' || (!flood?.in_mapped_study_area && floodClass !== 'unknown' && flood?.available !== false)) {
    const nearest = flood?.nearest_study;
    const nearbyLine = nearest
      ? `<p class="fine">Nearest published study within ~5 km: <strong>${esc(
          labelFlood(nearest.class)
        )}</strong>${nearest.river_name ? ` · ${esc(nearest.river_name)}` : ''}${
          nearest.study_name ? ` · ${esc(nearest.study_name)}` : ''
        }</p>`
      : '';
    return `
      <strong>${esc(flood?.headline || 'No mapped data')}</strong>
      <p class="flood-lead">
        ${esc(
          flood?.note ||
            'No FHIP flood polygon intersects this parcel. That means no published study coverage here — not a certified clean bill of health.'
        )}
      </p>
      ${nearbyLine}
      <p class="fine flood-caveat">
        <strong>No map ≠ no risk.</strong>
        ${esc(
          flood?.caveat ||
            'Many rural Alberta watercourses are unmapped. Confirm with local knowledge and the provincial awareness map before earthworks or low siting.'
        )}
      </p>
      <p class="fine">
        <a href="${esc(awareness)}" target="_blank" rel="noopener">floods.alberta.ca</a>
        · <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">FHIP open data</a>
      </p>`;
  }

  if (floodClass === 'unknown' || flood?.available === false) {
    return `
      <strong>${esc(flood?.headline || labelFlood(floodClass))}</strong>
      <p class="flood-lead">${esc(flood?.note || flood?.error || 'Flood status could not be determined.')}</p>
      <p class="fine flood-caveat">${esc(
        flood?.caveat || 'Verify at floods.alberta.ca before siting ponds or low plantings.'
      )}</p>
      <p class="fine">
        <a href="${esc(awareness)}" target="_blank" rel="noopener">floods.alberta.ca</a>
      </p>`;
  }

  // Mapped hazard present
  return `
    <strong>${esc(labelFlood(floodClass))}</strong>
    <p class="flood-lead">
      Mapped study${
        flood?.primary?.river_name ? ` · ${esc(flood.primary.river_name)}` : ''
      }${
        flood?.primary?.study_name ? `<br>${esc(flood.primary.study_name)}` : ''
      }
    </p>
    <p class="fine">${esc(flood?.note || '')}</p>
    <p class="fine">
      <a href="${esc(awareness)}" target="_blank" rel="noopener">floods.alberta.ca</a>
      · <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">FHIP open data</a>
    </p>`;
}

function countyAssessmentLinksHtml(ats = null) {
  const legalDescription = ats?.description ? `Near ${ats.description}` : null;
  return `
    <div class="flag" data-severity="info" style="margin:0.65rem 0 0.85rem">
      <strong>Find nearby assessed land</strong>
      <p>Use the county viewer for the parcel or a nearby comparable. Where a public parcel-value layer is available, nearby properties are mapped above; these tools provide assessment context, not an appraisal or sale price.</p>
      ${legalDescription ? `<p class="fine" style="margin:0.45rem 0 0"><strong>Generated search reference:</strong> ${esc(legalDescription)} · ${esc(ats.quarter)} quarter, Section ${esc(ats.section)}, Township ${esc(ats.township)}, Range ${esc(ats.range)}, ${esc(ats.meridian)}</p>` : ''}
      <div class="prox-grid" style="margin-top:0.55rem">
        ${COUNTY_ASSESSMENT_LINKS.map((item) => `
          <article class="prox-card">
            <span class="mono">${esc(item.name)}</span>
            <p class="fine" style="margin:0.3rem 0 0.55rem">${esc(item.detail)}</p>
            <a href="${esc(item.url)}" target="_blank" rel="noopener">Open ${esc(item.name)} viewer →</a>
            ${legalDescription ? `<p class="fine" style="margin:0.4rem 0 0">Search using the generated legal description above, or pan to the parcel and select a nearby property.</p>` : ''}
          </article>
        `).join('')}
      </div>
      <p class="fine" style="margin-bottom:0">Automated parcel-value mapping is shown when the report location falls inside a published assessment layer. Sturgeon’s queried parcel layer identifies roll/legal-description records but does not expose values; Parkland’s public pages do not expose a queryable parcel-value layer, so those locations remain viewer-only.</p>
    </div>`;
}

function landValueSection(lv) {
  if (!lv) {
    return `<section class="report-block"><h2>Land value</h2><p class="fine">Land value context unavailable.</p></section>`;
  }
  const src = lv.land_value_source || 'none';
  const rural = lv.rural_aggregate;
  const mun = lv.municipal_sample;
  const stats = mun?.stats;
  const target = lv.target_parcel;
  const metricLabel =
    stats?.metric === 'assessed_land_per_acre'
      ? 'Assessed land $/acre'
      : 'Assessed total $/acre (land + improvements)';

  const refRate =
    lv.land_value_per_acre ??
    target?.land_value_per_acre ??
    (stats?.median != null ? stats.median : null) ??
    target?.assessed_total_per_acre ??
    rural?.adjusted_cad_per_acre ??
    null;

  const violin = landValueViolinHtml(stats?.distribution || [], refRate, {
    radius_m: lv.nearby_land_value_search_radius_m ?? mun?.search_radius_m,
    n: lv.nearby_land_value_sample_n ?? mun?.sample_n ?? 0,
    metricLabel,
    dataYear: lv.land_value_data_year,
  });

  const samples = (mun?.samples || []).filter(
    (s) => s.latitude != null && s.longitude != null && Number.isFinite(Number(s.latitude))
  );
  const ats = state.report?.ats || null;
  const parcel = getParcelLatLngs();
  const centre = state.report?.location
    ? { lat: state.report.location.latitude, lng: state.report.location.longitude }
    : null;
  const mapId = 'land-value-map-' + Math.random().toString(36).slice(2, 8);
  if (samples.length || parcel || centre) {
    setTimeout(() => initLandValueMap(mapId, samples, parcel, centre, refRate), 140);
  }

  return `
    <section class="report-block land-value-block">
      <h2>Land value <span class="badge zone">Informational only</span></h2>
      <p class="fine" style="margin-top:-0.35rem">
        <strong>Assessed / transfer-aggregate estimates — not market sale prices.</strong>
        Alberta Land Titles sales are pay-per-lookup with no free bulk API.
        This panel does not affect swale, keyline, or planting recommendations.
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Source</span><strong>${esc(
          sourceLabel(src)
        )}</strong></div>
        <div class="stat"><span class="k">$/acre (context)</span><strong>${
          refRate != null ? fmtCad(refRate) : '—'
        }</strong></div>
        <div class="stat"><span class="k">Parcel land value</span><strong>${
          lv.assessed_land_value != null ? fmtCad(lv.assessed_land_value) : '—'
        }</strong></div>
        <div class="stat"><span class="k">Data year</span><strong>${esc(
          lv.land_value_data_year ?? '—'
        )}</strong></div>
        <div class="stat"><span class="k">Nearby sample n</span><strong>${esc(
          lv.nearby_land_value_sample_n ?? 0
        )}</strong></div>
        <div class="stat"><span class="k">Search radius used</span><strong>${
          lv.nearby_land_value_search_radius_m != null
            ? fmtDistance(lv.nearby_land_value_search_radius_m)
            : '—'
        }</strong></div>
      </div>

      ${
        mun?.available
          ? `<p class="fine" style="margin:0.75rem 0 0.35rem">
              Neighbourhood sample: <strong>${esc(mun.municipality)}</strong>
              · radius <strong>${fmtDistance(mun.search_radius_m)}</strong>
              ${mun.expanded ? ' (expanded to reach sample size)' : ''}
              · n=<strong>${esc(mun.sample_n)}</strong>
              ${stats?.median != null ? ` · median ${fmtCad(stats.median)}/acre` : ''}
            </p>
            <p class="fine"><span class="value-type-tag">${esc(metricLabel)}</span></p>
            ${violin}`
          : `<p class="fine" style="margin-top:0.75rem">${esc(
              mun?.note || 'No municipal assessment sample for this location.'
            )}</p>`
      }

      ${countyAssessmentLinksHtml(ats)}

      ${
        samples.length || parcel
          ? `<div style="margin-top:0.85rem">
              <span class="mono topo-label">Nearby assessments map</span>
              <p class="fine" style="margin:0.2rem 0 0.35rem">
                Gold outline = your parcel · Nearby parcel polygons/points are coloured by assessed $/acre.
              </p>
              <div id="${mapId}" class="report-map minimap-embed" style="height:300px"></div>
              <div class="minimap-legend" style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.65rem;align-items:center">
                <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(168,128,31,0.25);border:2px solid #a8801f;vertical-align:middle;margin-right:4px"></span>Your parcel</span>
                <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(42,111,151,0.55);border:1px solid #2a6f97;vertical-align:middle;margin-right:4px"></span>Lower $/acre</span>
                <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(233,196,106,0.65);border:1px solid #e9c46a;vertical-align:middle;margin-right:4px"></span>Mid</span>
                <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(196,92,38,0.65);border:1px solid #c45c26;vertical-align:middle;margin-right:4px"></span>Higher $/acre</span>
              </div>
            </div>`
          : ''
      }

      ${
        rural
          ? `<div class="rural-value-card">
              <span class="mono">${
                src === 'cli_municipality_aggregate'
                  ? 'Rural / agricultural aggregate (CLI × municipality) — primary'
                  : 'Agricultural transfer context (secondary — not primary for urban assessed parcels)'
              }</span>
              <div class="summary-grid" style="margin-top:0.5rem">
                <div class="stat"><span class="k">Municipality</span><strong>${esc(
                  rural.municipality
                )}</strong></div>
                <div class="stat"><span class="k">Raw (base year)</span><strong>${fmtCad(
                  rural.raw_cad_per_acre
                )}/ac · ${esc(rural.data_year_base)}</strong></div>
                <div class="stat"><span class="k">FCC-adjusted</span><strong>${fmtCad(
                  rural.adjusted_cad_per_acre
                )}/ac · →${esc(rural.data_year_adjusted_to)}</strong></div>
                <div class="stat"><span class="k">FCC cumulative</span><strong>+${esc(
                  rural.fcc_cumulative_pct
                )}%</strong></div>
              </div>
              <p class="fine" style="margin-top:0.5rem">${esc(rural.note || '')}
                Trend factor from FCC Alberta cultivated farmland annual % changes
                (raw base value always retained alongside adjusted estimate).
              </p>
            </div>`
          : ''
      }

      <div class="flag" data-severity="caution" style="margin-top:0.85rem">
        <strong>${esc(lv.value_basis?.label || 'Not a sale-price estimate')}</strong>
        <p>${esc(lv.disclaimer || lv.value_basis?.detail || '')}</p>
      </div>
    </section>`;
}

/**
 * Map: parcel + nearby municipal assessment samples coloured by $/acre.
 */
function initLandValueMap(elId, samples, parcelLatLngs, centre, refRate) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined') return;
  el.innerHTML = '';

  const map = L.map(el, { zoomControl: true, attributionControl: true });
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri · Municipal open assessment data', maxZoom: 18 }
  ).addTo(map);

  const rates = samples
    .map((s) => s.land_value_per_acre ?? s.assessed_total_per_acre)
    .filter((v) => v != null && v > 0);
  const rMin = rates.length ? Math.min(...rates) : 0;
  const rMax = rates.length ? Math.max(...rates) : 1;
  const colorFor = (rate) => {
    if (rate == null || !(rMax > rMin)) return '#2a6f97';
    const t = Math.max(0, Math.min(1, (rate - rMin) / (rMax - rMin)));
    // blue (low) → gold → orange (high)
    if (t < 0.5) {
      const u = t * 2;
      const r = Math.round(42 + (233 - 42) * u);
      const g = Math.round(111 + (196 - 111) * u);
      const b = Math.round(151 + (106 - 151) * u);
      return `rgb(${r},${g},${b})`;
    }
    const u = (t - 0.5) * 2;
    const r = Math.round(233 + (196 - 233) * u);
    const g = Math.round(196 + (92 - 196) * u);
    const b = Math.round(106 + (38 - 106) * u);
    return `rgb(${r},${g},${b})`;
  };

  const bounds = [];

  const parcel = parcelLatLngs || getParcelLatLngs();
  if (parcel?.length >= 3) {
    const poly = L.polygon(parcel, {
      color: '#a8801f',
      fillColor: '#a8801f',
      fillOpacity: 0.15,
      weight: 3,
    }).addTo(map);
    poly.bindPopup('<strong>Your parcel</strong><br/>Boundary you drew');
    bounds.push(poly.getBounds());
  }

  if (centre?.lat != null && centre?.lng != null) {
    L.circleMarker([centre.lat, centre.lng], {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#5b3a73',
      fillOpacity: 1,
    })
      .bindPopup(
        `<strong>Site centre</strong>${
          refRate != null ? `<br/>Context ${fmtCad(refRate)}/acre` : ''
        }`
      )
      .addTo(map);
    bounds.push(L.latLngBounds([[centre.lat, centre.lng]]));
  }

  const assessmentPopup = (s, rate) =>
    `<strong>${esc(s.address || s.id || 'Assessment sample')}</strong><br/>` +
    `Assessed total: ${s.assessed_total_cad != null ? fmtCad(s.assessed_total_cad) : '—'}<br/>` +
    `${rate != null ? fmtCad(rate) + '/acre' : '—'} · ${s.land_separable ? 'land residual' : 'total assessed'}<br/>` +
    `${s.acres != null ? esc(s.acres) + ' ac' : ''}` +
    `${s.distance_m != null ? ` · ${esc(s.distance_m)} m` : ''}` +
    `${s.property_type ? `<br/>Type: ${esc(s.property_type)}` : ''}<br/>` +
    `<span class="fine">Public assessment value — not sale price or appraisal</span>`;

  samples.forEach((s) => {
    const rate = s.land_value_per_acre ?? s.assessed_total_per_acre;
    const fill = colorFor(rate);
    const ring = s.geometry?.type === 'Polygon' ? s.geometry.coordinates?.[0] : null;
    if (ring?.length >= 3) {
      const latlngs = ring.map(([lng, lat]) => [lat, lng]);
      const polygon = L.polygon(latlngs, {
        color: fill,
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.48,
      }).addTo(map);
      polygon.bindPopup(assessmentPopup(s, rate));
      bounds.push(polygon.getBounds());
    } else if (s.latitude != null && s.longitude != null) {
      const marker = L.circleMarker([s.latitude, s.longitude], {
        radius: 7,
        color: '#fff',
        weight: 1.5,
        fillColor: fill,
        fillOpacity: 0.9,
      }).addTo(map);
      marker.bindPopup(assessmentPopup(s, rate));
      bounds.push(L.latLngBounds([[s.latitude, s.longitude]]));
    }
  });

  try {
    if (bounds.length) {
      const b = bounds.reduce((acc, x) => acc.extend(x), L.latLngBounds(bounds[0]));
      map.fitBounds(b, { padding: [28, 28], maxZoom: 16 });
    } else if (centre) {
      map.setView([centre.lat, centre.lng], 13);
    }
  } catch { /* ignore */ }

  requestAnimationFrame(() => {
    try { map.invalidateSize({ animate: false }); } catch { /* ignore */ }
  });
}

function sourceLabel(src) {
  if (src === 'municipal_assessment') return 'Municipal assessment';
  if (src === 'cli_municipality_aggregate') return 'CLI municipality aggregate';
  return 'None';
}

/** Format product yield (kg) mid at maturity. Accepts yield_on_parcel_kg or {mid_kg}. */
function fmtProductYieldMid(y, unit = 'kg') {
  if (!y) return '—';
  const mid = y.mid_kg ?? y.mid ?? null;
  if (mid == null) return '—';
  const u = unit || y.unit || 'kg';
  return `${fmtQty(mid)} ${esc(u)}/yr`;
}

/** Format product yield range low–high. */
function fmtProductYieldRange(y, unit = 'kg') {
  if (!y) return '—';
  const lo = y.low_kg ?? y.low ?? null;
  const hi = y.high_kg ?? y.high ?? null;
  const mid = y.mid_kg ?? y.mid ?? null;
  const u = unit || y.unit || 'kg';
  if (lo != null && hi != null) return `${fmtQty(lo)}–${fmtQty(hi)} ${u}`;
  if (mid != null) return `~${fmtQty(mid)} ${u}`;
  return '—';
}

/** Format cash yield (gross CAD) range. */
function fmtCashYieldRange(g) {
  if (!g) return '—';
  if (g.low != null && g.high != null) return `${fmtMoney(g.low)}–${fmtMoney(g.high)}/yr`;
  if (g.mid != null) return `~${fmtMoney(g.mid)}/yr`;
  return '—';
}

function fmtQty(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v >= 100) return Math.round(v).toLocaleString('en-CA');
  if (v >= 10) return (Math.round(v * 10) / 10).toLocaleString('en-CA');
  return (Math.round(v * 10) / 10).toString();
}

function fmtCad(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return (
    '$' +
    Number(n).toLocaleString('en-CA', {
      maximumFractionDigits: 0,
    })
  );
}

/** Lightweight violin/distribution chart (no Plotly dependency). */
function landValueViolinHtml(dist, refRate, meta = {}) {
  if (!dist?.length) {
    return '<p class="fine">No neighbourhood $/acre distribution to plot.</p>';
  }
  const sorted = [...dist].filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return '';

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = max - min || 1;
  const bins = 12;
  const counts = new Array(bins).fill(0);
  for (const v of sorted) {
    let i = Math.floor(((v - min) / span) * bins);
    if (i >= bins) i = bins - 1;
    counts[i]++;
  }
  const maxC = Math.max(...counts, 1);
  const w = 360;
  const h = 120;
  const midY = h / 2;
  const padX = 28;
  const usable = w - padX * 2;

  // Build symmetric density envelope (violin-ish)
  const ptsTop = [];
  const ptsBot = [];
  for (let i = 0; i < bins; i++) {
    const x = padX + ((i + 0.5) / bins) * usable;
    const half = (counts[i] / maxC) * (midY - 12);
    ptsTop.push(`${x.toFixed(1)},${(midY - half).toFixed(1)}`);
    ptsBot.push(`${x.toFixed(1)},${(midY + half).toFixed(1)}`);
  }
  const poly = [...ptsTop, ...ptsBot.reverse()].join(' ');

  let refLine = '';
  if (refRate != null && refRate >= min && refRate <= max) {
    const x = padX + ((refRate - min) / span) * usable;
    refLine = `
      <line x1="${x}" y1="8" x2="${x}" y2="${h - 8}" stroke="#8c5a1d" stroke-width="2" stroke-dasharray="4 3"/>
      <text x="${x}" y="12" text-anchor="middle" class="svg-label" fill="#8c5a1d">parcel</text>`;
  } else if (refRate != null) {
    refLine = `<text x="${w / 2}" y="14" text-anchor="middle" class="svg-label" fill="#8c5a1d">parcel ref ${fmtCad(refRate)}/ac (off-scale)</text>`;
  }

  return `
    <div class="lv-violin-wrap">
      <span class="mono topo-label">${esc(meta.metricLabel || 'Assessed $/acre')} distribution
        · n=${esc(meta.n)} · radius ${
          meta.radius_m != null ? esc(fmtDistance(meta.radius_m)) : '—'
        }${meta.dataYear != null ? ` · vintage ${esc(meta.dataYear)}` : ''}
      </span>
      <svg class="lv-violin" viewBox="0 0 ${w} ${h}" role="img" aria-label="Land value distribution">
        <rect x="0" y="0" width="${w}" height="${h}" fill="#f7f8f3" stroke="#c8cec1"/>
        <polygon points="${poly}" fill="rgba(91,58,115,0.28)" stroke="#5b3a73" stroke-width="1.2"/>
        <line x1="${padX}" y1="${midY}" x2="${w - padX}" y2="${midY}" stroke="#c8cec1" stroke-width="1"/>
        ${refLine}
        <text x="${padX}" y="${h - 4}" class="svg-label">${fmtCad(min)}</text>
        <text x="${w - padX}" y="${h - 4}" text-anchor="end" class="svg-label">${fmtCad(max)}</text>
      </svg>
      <p class="fine value-type-note">Chart shows <strong>assessed</strong> $/acre samples — not sale prices.</p>
    </div>`;
}

function siteDriversSection(drivers) {
  if (!drivers?.measured?.length) return '';
  const gates = drivers.gates || {};
  const gateChips = [
    ['swale', gates.swale_eligible],
    ['terrace', gates.terrace_eligible],
    ['pond', gates.pond_eligible],
    ['keyline', gates.keyline_eligible],
    ['windbreak', gates.windbreak_eligible],
    ['food forest', gates.food_forest_eligible],
    ['Zone 1 intensive', gates.intensive_zone1_eligible],
    ['earthworks OK', gates.earthworks_allowed],
  ]
    .map(
      ([label, on]) =>
        `<span class="plant-chip gate-chip ${on ? 'on' : 'off'}"><strong>${
          on ? 'yes' : 'no'
        }</strong>${esc(label)}</span>`
    )
    .join('');

  const rows = drivers.measured
    .map((d) => {
      let val = d.value;
      if (val == null) val = '—';
      else if (typeof val === 'object') val = JSON.stringify(val);
      else if (typeof val === 'boolean') val = val ? 'true' : 'false';
      else if (d.unit) val = `${val} ${d.unit}`;
      return `<tr>
        <td class="mono">${esc(d.field)}</td>
        <td><strong>${esc(val)}</strong></td>
        <td class="fine">${esc(d.drives || '')}</td>
      </tr>`;
    })
    .join('');

  // Compact drivers strip — not a second recommendations card
  return `
    <div class="site-drivers">
      <span class="mono site-drivers-label">Site conditions used</span>
      <div class="plant-chips" style="margin:0.45rem 0 0.55rem">${gateChips}</div>
      <details class="drivers-details">
        <summary class="fine">Show measured values</summary>
        <div class="econ-table-wrap" style="margin-top:0.5rem">
          <table class="econ-table drivers-table">
            <thead>
              <tr><th>Measured property</th><th>This parcel</th><th>What it controls</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>
    </div>`;
}

/** Client-side filter: primary or secondary value match. */
function filterRecsByValue(elements, valueId) {
  if (!valueId || valueId === 'all') return elements;
  return elements.filter(
    (el) =>
      el.primary_value === valueId ||
      (el.secondary_values || []).includes(valueId)
  );
}

function computeValueCounts(elements) {
  const map = new Map();
  for (const el of elements) {
    const id = el.primary_value || 'beauty_access';
    if (!map.has(id)) {
      map.set(id, {
        id,
        label: VALUE_LABELS[id] || id,
        count: 0,
        min_priority: el.priority ?? 99,
      });
    }
    const row = map.get(id);
    row.count += 1;
    const p = el.priority ?? 99;
    if (p < row.min_priority) row.min_priority = p;
  }
  return [...map.values()].sort(
    (a, b) => a.min_priority - b.min_priority || b.count - a.count
  );
}

function collectServicesClient(elements) {
  const hits = new Map();
  for (const el of elements) {
    const p = el.priority ?? 99;
    for (const sid of el.related_services || []) {
      if (!EE_SERVICE_META[sid]) continue;
      if (!hits.has(sid)) hits.set(sid, { count: 0, best: p });
      const h = hits.get(sid);
      h.count += 1;
      if (p < h.best) h.best = p;
    }
  }
  return [...hits.entries()]
    .map(([id, h]) => ({
      id,
      ...EE_SERVICE_META[id],
      blurb: '',
      hit_count: h.count,
      best_priority: h.best,
    }))
    .sort((a, b) => a.best_priority - b.best_priority || b.hit_count - a.hit_count);
}

function valueFilterBar(counts, active, total) {
  if (!counts?.length) return '';
  const chips = [
    `<button type="button" class="value-filter-chip${
      active === 'all' ? ' is-active' : ''
    }" data-value-filter="all" aria-pressed="${active === 'all'}">All <span class="vf-count">${total}</span></button>`,
    ...counts.map(
      (c) =>
        `<button type="button" class="value-filter-chip${
          active === c.id ? ' is-active' : ''
        }" data-value-filter="${esc(c.id)}" aria-pressed="${
          active === c.id
        }">${esc(c.label)} <span class="vf-count">${c.count}</span></button>`
    ),
  ].join('');
  return `
    <div class="value-filter-bar" role="toolbar" aria-label="Filter by outcome">
      <span class="mono value-filter-label">Filter by value</span>
      <div class="value-filter-chips">${chips}</div>
    </div>`;
}

function servicesCtaSection(services) {
  if (!services?.length) return '';
  // Cap at 4 CTAs; always prefer highest-priority services
  const top = services.slice(0, 4);
  return `
    <div class="ee-services-cta">
      <span class="mono eyebrow">Land Intelligence · next steps</span>
      <h3 class="ee-services-title">Services that match these recommendations</h3>
      <p class="fine">These CTAs follow the outcomes above — book a focused consult or a full site design.</p>
      <div class="ee-services-grid">
        ${top
          .map(
            (s) => `
          <article class="ee-service-card">
            <h4>${esc(s.label)}</h4>
            ${s.blurb ? `<p class="fine">${esc(s.blurb)}</p>` : ''}
            <a class="btn btn-secondary ee-service-link" href="${esc(
              s.href
            )}" target="_blank" rel="noopener">${esc(s.cta || 'Learn more')} →</a>
          </article>`
          )
          .join('')}
      </div>
      <p class="fine ee-services-foot">
        Email <a href="mailto:mhalma@opensourcemed.info">mhalma@opensourcemed.info</a>
      </p>
    </div>`;
}

function bindValueFilters(allEls) {
  const bar = document.querySelector('.value-filter-bar');
  if (!bar) return;
  bar.querySelectorAll('[data-value-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-value-filter') || 'all';
      state.valueFilter = id;
      // Update active state without full re-render (preserve scroll)
      bar.querySelectorAll('[data-value-filter]').forEach((b) => {
        const on = b.getAttribute('data-value-filter') === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const filtered = filterRecsByValue(allEls, id);
      const host = $('rec-elements');
      if (!host) return;
      host.innerHTML = filtered.length
        ? filtered.map((e) => recommendationCard(e)).join('')
        : '<p class="fine">No recommendations in this value filter — try All or another outcome.</p>';
    });
  });
}

/**
 * Value-first recommendation card: outcome headline → technique → site basis → how-to.
 */
function recommendationCard(e) {
  const valueLabel =
    VALUE_LABELS[e.primary_value] || e.primary_value || 'Site benefit';
  const technique =
    e.technique_label || ELEMENT_LABELS[e.element_type] || e.element_type;
  const offering = (e.related_services || [])
    .map((id) => EE_SERVICE_META[id])
    .find(Boolean);
  const secondary = (e.secondary_values || [])
    .map((v) => VALUE_LABELS[v] || v)
    .filter(Boolean);
  const chips = [
    `<span class="value-chip primary" data-value="${esc(e.primary_value || '')}">${esc(valueLabel)}</span>`,
    ...secondary.map(
      (lab) => `<span class="value-chip secondary">${esc(lab)}</span>`
    ),
  ].join('');

  const serviceLinks = (e.related_services || [])
    .map((id) => EE_SERVICE_META[id])
    .filter(Boolean)
    .slice(0, 2)
    .map(
      (s) =>
        `<a class="rec-service-link" href="${esc(s.href)}" target="_blank" rel="noopener">${esc(
          s.cta
        )}</a>`
    )
    .join('');

  return `
    <article class="el rec-card" data-value="${esc(e.primary_value || '')}" data-element="${esc(e.element_type || '')}">
      ${offering ? `<h3 class="rec-offering-heading">${esc(offering.label)}</h3>` : `<h3 class="rec-offering-heading">${esc(technique || 'Site recommendation')}</h3>`}
      <div class="value-chips">${chips}</div>
      <div class="el-head">
        <span class="badge zone">Zone ${esc(e.zone)}</span>
        ${confBadge(e.confidence)}
        ${e.effort ? `<span class="badge effort">${esc(e.effort)} effort</span>` : ''}
      </div>
      <div class="basis"><span class="basis-label">Why this property</span> ${esc(e.condition_basis || '')}</div>
      ${e.placement_notes ? `<p class="placement-how">${esc(e.placement_notes)}</p>` : ''}
      ${
        e.suggested_species?.length
          ? `<p class="fine plant-species-line"><strong>Species:</strong> ${e.suggested_species.map(esc).join(' · ')}</p>`
          : ''
      }
      ${
        e.improves_levers?.length
          ? `<p class="fine"><strong>Improves levers:</strong> ${e.improves_levers.map(esc).join(', ')}</p>`
          : ''
      }
      ${e.season_hint ? `<p class="season-hint"><span class="basis-label">Season</span> ${esc(e.season_hint)}</p>` : ''}
      ${serviceLinks ? `<div class="rec-service-links">${serviceLinks}</div>` : ''}
    </article>`;
}

/** Generate a solar package card for the tier grid. */
function solarPackageCard(systemKwp, batteryKwh, label, solar) {
  const gen = solar?.planning_scenario?.annual_generation_kwh;
  const rate = solar?.planning_scenario?.grid_rate_cad_per_kwh ?? 0.15;
  const annualGen = gen != null ? Math.round(gen * systemKwp / 5) : null;
  const annualSave = annualGen != null ? Math.round(annualGen * rate) : null;
  const battSave = batteryKwh != null ? Math.round(batteryKwh * 0.25) : null; // ~$0.25/kWh backup value
  return `
    <div class="stat" style="border:1px solid var(--line);border-radius:6px;padding:0.6rem">
      <strong>${esc(label)}</strong><br>
      <span class="fine">${systemKwp} kWp · ${batteryKwh} kWh battery</span>
      ${annualGen != null ? `<br><span class="mono" style="font-size:0.85rem">${esc(annualGen.toLocaleString())} kWh/yr</span>` : ''}
      ${annualSave != null ? `<br><span class="mono" style="font-size:0.85rem">$${esc(annualSave.toLocaleString())}/yr savings</span>` : ''}
      ${battSave != null ? `<br><span class="fine">backup ~$${esc(battSave)}/yr value</span>` : ''}
    </div>`;
}

function fmtDistance(m) {
  if (m == null || m === '') return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function renderPlantingPane(plan) {
  const el = $('planting-pane');
  if (!el) return;
  if (!plan?.recommended?.length) {
    el.innerHTML = `
      <div class="panel fade plant-planner-panel">
        <div class="beta-banner" role="status">
          <span class="badge beta">Beta</span>
          <p>
            <strong>Separate offering — not part of the core site design package.</strong>
            The planting planner is an early preview. Lists and prices may change; verify every species before you buy or plant.
          </p>
        </div>
        <span class="mono eyebrow">Planting planner</span>
        <h1>No suitable plantings yet</h1>
        <p class="fine">Nothing scored well for this site profile. Adjust parcel data or succession stage, or stay with the core site design report.</p>
        <button type="button" class="btn btn-secondary" id="btn-back-site">← Back to site design</button>
      </div>`;
    $('btn-back-site')?.addEventListener('click', () => switchReportPane('overview'));
    return;
  }

  // Keep plant value filter only when re-rendering same plan object
  if (state._plantPlan !== plan) {
    state.plantValueFilter = 'all';
    state._plantPlan = plan;
    if (plan.goals?.length) state.plantGoals = [...plan.goals];
  }

  const areaHa = plan.site_filters?.footprint_ha;
  const allPlants = plan.recommended;
  const filtered = filterRecsByValue(allPlants, state.plantValueFilter);
  const plantCounts =
    plan.value_counts || computeValueCounts(allPlants);
  const cash = plan.top_cash_crops || [];
  const cashBlock =
    cash.length > 0
      ? `
    <div class="econ-summary">
      <span class="mono">Top cash-oriented fits (gross CAD on ~${esc(
        areaHa != null ? Number(areaHa).toFixed(2) : '0.10'
      )} ha)</span>
      <div class="econ-table-wrap">
        <table class="econ-table">
          <thead>
            <tr>
              <th>Crop</th>
              <th>Value</th>
              <th>Suit.</th>
              <th>Wholesale $/kg</th>
              <th>Product yield</th>
              <th>Cash yield</th>
              <th>Channels</th>
            </tr>
          </thead>
          <tbody>
            ${cash
              .map((c) => {
                const e = c.economics || {};
                const w = e.price_wholesale_cad_per_kg;
                const yPatch = e.yield_on_parcel_kg;
                const g = e.gross_revenue_cad;
                const unit = e.unit || 'kg';
                const vl =
                  VALUE_LABELS[c.primary_value] || c.primary_value || '—';
                return `<tr>
                  <td><strong>${esc(c.common_name)}</strong></td>
                  <td class="fine">${esc(vl)}</td>
                  <td>${esc(c.suitability)} (${esc(c.score)})</td>
                  <td>${w ? `${fmtMoney(w.low)}–${fmtMoney(w.high)}` : '—'}</td>
                  <td class="econ-yield">${fmtProductYieldRange(yPatch, unit)}</td>
                  <td class="econ-rev">${fmtCashYieldRange(g)}</td>
                  <td class="fine">${esc((e.market_channels || []).slice(0, 3).join(', ') || '—')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="fine">Product yield = kg/yr on the polyculture patch · Cash yield = gross CAD/yr at maturity (before full labour). ${esc(plan.economics_disclaimer || '')}</p>
    </div>`
      : '';

  function plantSpecLine(p) {
    const bits = [];
    if (p.hardiness_min || p.hardiness_max) {
      bits.push(
        `Hardiness ${esc(p.hardiness_min || '?')}–${esc(p.hardiness_max || '?')}`
      );
    }
    if (p.frost_free_min_days != null) {
      bits.push(`≥${esc(p.frost_free_min_days)} frost-free days`);
    }
    if (p.precip_min_mm != null || p.precip_max_mm != null) {
      bits.push(
        `Precip ${esc(p.precip_min_mm ?? '—')}–${esc(p.precip_max_mm ?? '—')} mm`
      );
    }
    if (p.light_requirement) bits.push(esc(p.light_requirement));
    if (p.water_requirement) bits.push(`Water: ${esc(p.water_requirement)}`);
    if (p.spec_source) {
      bits.push(
        `<span class="spec-src" title="Grow-spec provenance">spec: ${esc(
          p.spec_source
        )}${p.spec_confidence ? ` · ${esc(p.spec_confidence)}` : ''}</span>`
      );
    }
    const links = [];
    if (p.plant_specs?.permapeople_url) {
      links.push(
        `<a href="${esc(p.plant_specs.permapeople_url)}" target="_blank" rel="noopener">Permapeople</a>`
      );
    }
    if (p.plant_specs?.pfaf_url) {
      links.push(
        `<a href="${esc(p.plant_specs.pfaf_url)}" target="_blank" rel="noopener">PFAF</a>`
      );
    }
    if (p.plant_specs?.usda_url) {
      links.push(
        `<a href="${esc(p.plant_specs.usda_url)}" target="_blank" rel="noopener">USDA PLANTS</a>`
      );
    }
    if (p.nitrogen_fixer || p.plant_specs?.nitrogen_fixer) {
      bits.push('N-fixer');
    }
    if (p.edibility_rating != null || p.plant_specs?.edibility_rating != null) {
      bits.push(
        `Edible ${esc(p.edibility_rating ?? p.plant_specs?.edibility_rating)}/5`
      );
    }
    if (!bits.length && !links.length) return '';
    return `<p class="plant-specs-line fine">${bits.join(' · ')}${
      links.length ? ` · ${links.join(' · ')}` : ''
    }</p>`;
  }

  function plantCard(p) {
    const e = p.economics;
    const valueAdd =
      e?.value_add?.gross_mid_cad
        ? `Value-add (${esc(e.value_add.product || 'processed')}): ~${fmtMoney(e.value_add.gross_mid_cad)} (conservative partial capture)`
        : '';
    const est = e?.establishment_cost_cad;
    const unit = e?.unit || 'kg';
    const y = e?.yield_on_parcel_kg;
    const g = e?.gross_revenue_cad;

    // Product yield (physical) + cash yield (CAD) as primary metrics
    const yieldBlock =
      y?.mid_kg != null || g?.mid != null
        ? `<div class="plant-yield-grid summary-grid" style="margin:0.5rem 0 0.35rem">
            <div class="stat">
              <span class="k">Product yield</span>
              <strong>${fmtProductYieldMid(y, unit)}</strong>
              <span class="fine">${y?.mid_kg != null ? `${fmtProductYieldRange(y, unit)} range · at maturity` : '—'}</span>
            </div>
            <div class="stat">
              <span class="k">Cash yield</span>
              <strong>${g?.mid != null ? fmtMoney(g.mid) + '/yr' : '—'}</strong>
              <span class="fine">${fmtCashYieldRange(g)}${g?.mid != null ? ' gross' : ''}</span>
            </div>
            ${
              e?.annual_opex_cad_est != null && g?.mid != null
                ? `<div class="stat">
                    <span class="k">Net (after opex est.)</span>
                    <strong>${fmtMoney(Math.max(0, g.mid - e.annual_opex_cad_est))}/yr</strong>
                    <span class="fine">opex ~${fmtMoney(e.annual_opex_cad_est)}</span>
                  </div>`
                : ''
            }
          </div>`
        : '';

    const econBits = [];
    if (est?.total != null) {
      econBits.push(`Est. <strong>${fmtMoney(est.total)}</strong> (~${esc(est.quantity)} plants)`);
    }
    if (e?.payback_years != null) econBits.push(`~${esc(e.payback_years)} yr payback`);
    else if (g?.mid) econBits.push('payback uncertain within horizon');
    if (e?.npv_cad?.mid != null) {
      econBits.push(`NPV ${fmtMoney(e.npv_cad.mid)} / ${esc(e.npv_cad.horizon_years)}y`);
    }
    const econLine =
      yieldBlock || econBits.length || e?.non_cash_value
        ? `${yieldBlock}
           ${
             econBits.length
               ? `<p class="plant-econ fine">${econBits.join(' · ')}</p>`
               : ''
           }
           <p class="fine" style="margin:0.15rem 0 0">
             Product yield = physical harvest on the polyculture patch (~${esc(Math.round((e?.polyculture_share || 0.05) * 100))}% of parcel).
             Cash yield = gross CAD at maturity (realization ${esc(e?.realization_factor ?? '—')}) — not full-field monoculture income.
             ${e?.establishment_years ? `· ~${esc(e.establishment_years)} yr to establish` : ''}
             ${e?.labour_intensity ? `· labour ${esc(e.labour_intensity)}` : ''}
           </p>
           ${e?.market_channels?.length ? `<p class="fine">Markets: ${esc(e.market_channels.join(', '))}</p>` : ''}
           ${valueAdd ? `<p class="fine">${valueAdd}</p>` : ''}
           ${
             !y && !g && e?.non_cash_value
               ? `<p class="plant-econ fine"><strong>Non-cash:</strong> ${esc(e.non_cash_value)}</p>`
               : ''
           }`
        : '';
    const leverLine = p.lever_benefits?.length
      ? `<p class="fine"><strong>Helps levers:</strong> ${p.lever_benefits.map(esc).join(', ')}</p>`
      : '';
    const fitLine = p.fit_summary
      ? `<p class="fine plant-fit">${esc(p.fit_summary)}</p>`
      : '';
    const vlab = VALUE_LABELS[p.primary_value] || p.primary_value;
    const sec = (p.secondary_values || [])
      .map((v) => VALUE_LABELS[v] || v)
      .filter(Boolean)
      .slice(0, 2);
    const chips = p.primary_value
      ? `<div class="value-chips">
          <span class="value-chip primary">${esc(vlab || 'Plant')}</span>
          ${sec.map((s) => `<span class="value-chip secondary">${esc(s)}</span>`).join('')}
        </div>`
      : '';
    // Compact metrics always visible in the collapsed summary
    const summaryMetrics = [
      y?.mid_kg != null ? `${fmtProductYieldMid(y, unit)}` : null,
      g?.mid != null ? `${fmtMoney(g.mid)}/yr` : null,
      est?.total != null ? `est. ${fmtMoney(est.total)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return `
      <article class="plant-card plant-card-collapsible" data-suit="${esc(p.suitability)}" data-value="${esc(
        p.primary_value || ''
      )}">
        <details class="plant-details">
          <summary class="plant-card-summary">
            <div class="plant-summary-main">
              ${chips}
              <div class="plant-head">
                <h3>${esc(p.common_name)}</h3>
                <span class="badge ${suitBadgeClass(p.suitability)}">${esc(p.suitability)} · ${esc(p.score)}</span>
              </div>
              <div class="basis plant-summary-meta">${esc(p.scientific_name || '')}${
                p.guild_layer ? ` · ${esc(String(p.guild_layer).replace(/_/g, ' '))}` : ''
              }${p.category ? ` · ${esc(p.category)}` : ''}${
                p.alberta_native ? ' · Alberta native' : ''
              }</div>
              ${
                summaryMetrics
                  ? `<p class="plant-summary-metrics fine">${summaryMetrics}</p>`
                  : ''
              }
            </div>
            <span class="plant-expand-hint" aria-hidden="true">Details</span>
          </summary>
          <div class="plant-card-body">
            ${
              p.value_headline
                ? `<p class="value-headline plant-value-headline">${esc(p.value_headline)}</p>`
                : ''
            }
            ${
              p.alberta_in_range
                ? `<div class="basis">USDA: Alberta in range</div>`
                : ''
            }
            ${fitLine}
            ${plantSpecLine(p)}
            ${leverLine}
            ${
              p.reasons?.length
                ? `<p class="plant-ok">${p.reasons.slice(0, 5).map(esc).join(' · ')}</p>`
                : ''
            }
            ${
              p.limits?.length
                ? `<p class="plant-limit">${p.limits.map(esc).join(' · ')}</p>`
                : ''
            }
            ${econLine}
            ${supplierBlock(p.suppliers)}
            ${p.notes ? `<p class="fine">${esc(p.notes)}</p>` : ''}
          </div>
        </details>
      </article>`;
  }

  const rows = filtered.map(plantCard).join('');

  const layers = plan.by_guild_layer
    ? Object.entries(plan.by_guild_layer)
        .map(
          ([layer, items]) =>
            `<span class="plant-chip"><strong>${esc(layer)}</strong> ${items.length}</span>`
        )
        .join('')
    : '';

  const scp = plan.site_condition_profile;
  const pe = plan.plan_economics;
  const availableGoals = plan.available_goals || plan.goals_catalog || DEFAULT_PLANT_GOALS;
  const activeGoals = state.plantGoals?.length ? state.plantGoals : plan.goals || ['balanced'];
  const goalChips = availableGoals
    .map((g) => {
      const on = activeGoals.includes(g.id);
      return `<button type="button" class="goal-chip${on ? ' is-active' : ''}" data-plant-goal="${esc(g.id)}" aria-pressed="${on ? 'true' : 'false'}" title="${esc(g.description || g.label)}">${esc(g.short || g.label)}</button>`;
    })
    .join('');
  const goalsBar = `
    <div class="plant-goals-bar" style="margin:0.85rem 0 0.5rem">
      <span class="mono topo-label">Goals — what should this planting prioritize?</span>
      <p class="fine" style="margin:0.25rem 0 0.45rem">
        Ecological goals can stack (max food + windbreak). Economic modes
        <strong>Lowest cost</strong>, <strong>Max revenue</strong>, and <strong>Fastest payback</strong> replace each other.
        Active: <strong>${esc(plan.goals_label || activeGoals.join(' · '))}</strong>
      </p>
      <div class="goal-chips" role="group" aria-label="Planting goals">${goalChips}</div>
      <div class="goal-scenario-row" style="display:flex;flex-wrap:wrap;gap:0.45rem;align-items:center;margin-top:0.55rem">
        <span class="mono" style="font-size:0.72rem">Economics scenario</span>
        <select id="plant-scenario" class="goal-scenario-select" aria-label="Economics scenario">
          <option value="market_garden" ${state.plantScenario === 'market_garden' ? 'selected' : ''}>Market garden (wholesale)</option>
          <option value="home_use" ${state.plantScenario === 'home_use' ? 'selected' : ''}>Home use (avoided retail)</option>
          <option value="fodder" ${state.plantScenario === 'fodder' ? 'selected' : ''}>Fodder / forage</option>
        </select>
        <button type="button" class="btn btn-secondary" id="btn-replan-plants" ${state.plantReplanning ? 'disabled' : ''}>
          ${state.plantReplanning ? 'Updating…' : 'Apply goals →'}
        </button>
      </div>
      <p class="fine" id="plant-goals-status" style="margin:0.4rem 0 0" hidden></p>
    </div>`;

  const profileBlock = scp
    ? `
    <div class="well-range-card" style="border-left-color:var(--berry);margin:0.85rem 0">
      <span class="mono">Site condition profile</span>
      <div class="summary-grid" style="margin-top:0.5rem">
        <div class="stat"><span class="k">Hardiness</span><strong>${esc(scp.hardiness?.zone || '—')}${scp.hardiness?.effective_zone && scp.hardiness.effective_zone !== scp.hardiness.zone ? ` → ${esc(scp.hardiness.effective_zone)}` : ''}</strong></div>
        <div class="stat"><span class="k">FFD</span><strong>${esc(scp.hardiness?.frost_free_days ?? '—')}</strong></div>
        <div class="stat"><span class="k">Texture / drain</span><strong>${esc(scp.soil?.texture || '—')} / ${esc(scp.soil?.drainage || '—')}</strong></div>
        <div class="stat"><span class="k">Water regime</span><strong>${esc(scp.water?.regime || '—')}</strong></div>
        <div class="stat"><span class="k">Wind</span><strong>${esc(scp.microclimate?.wind_exposure || '—')}</strong></div>
        <div class="stat"><span class="k">Succession</span><strong>${esc((scp.vegetation?.successional_stage || '—').replace(/_/g, ' '))}</strong></div>
      </div>
      ${scp.fecundity?.weakest?.length ? `
        <p class="fine" style="margin:0.45rem 0 0">
          <strong>Weak levers driving soft scores:</strong>
          ${scp.fecundity.weakest.slice(0, 4).map((w) => `${esc(w.label || w.category)} (${esc(w.score)})`).join(', ')}
        </p>` : ''}
      ${scp.goals?.length ? `<p class="fine" style="margin:0.25rem 0 0"><strong>Goals:</strong> ${scp.goals.map(esc).join(', ')}</p>` : ''}
    </div>`
    : '';

  const planEconBlock = pe
    ? `
    <div class="summary-grid" style="margin:0.75rem 0">
      <div class="stat"><span class="k">Plan establishment</span><strong>${pe.establishment_total_cad != null ? fmtMoney(pe.establishment_total_cad) : '—'}</strong></div>
      <div class="stat"><span class="k">Annual gross (maturity)</span><strong>${pe.annual_gross_mid_at_maturity_cad != null ? fmtMoney(pe.annual_gross_mid_at_maturity_cad) : '—'}</strong></div>
      <div class="stat"><span class="k">Plan NPV (${esc(pe.horizon_years)}y)</span><strong>${pe.npv_sum_cad != null ? fmtMoney(pe.npv_sum_cad) : '—'}</strong></div>
      <div class="stat"><span class="k">Cash models</span><strong>${esc(pe.n_with_cash_model)} / ${esc(pe.n_plants)}</strong></div>
    </div>
    <p class="fine">${esc(pe.disclaimer || '')}</p>
    ${pe.polyculture_competition_factor != null && pe.polyculture_competition_factor < 1
      ? `<p class="fine">Multi-crop competition factor ${esc(pe.polyculture_competition_factor)} applied so species do not each claim the whole farm.</p>`
      : ''}`
    : '';

  const guildBlock = (plan.suggested_guilds || []).length
    ? `
    <div style="margin:0.85rem 0 1rem">
      <span class="mono topo-label">Suggested guilds / polycultures</span>
      <div class="elements" style="margin-top:0.5rem;display:grid;gap:0.55rem">
        ${plan.suggested_guilds.map((g) => `
          <div class="el rec-card" style="padding:0.75rem 0.85rem;border-left-color:var(--ok)">
            <strong>${esc(g.label)}</strong>
            <p class="fine" style="margin:0.25rem 0">${esc(g.rationale)}</p>
            <div class="plant-chips">${(g.members || []).map((m) =>
              `<span class="plant-chip"><strong>${esc(m.common_name)}</strong> ${esc(m.score)}${m.suggested_quantity ? ` · ×${esc(m.suggested_quantity)}` : ''}</span>`
            ).join('')}</div>
          </div>`).join('')}
      </div>
    </div>`
    : '';

  el.innerHTML = `
    <div class="panel fade plant-planner-panel">
      <div class="beta-banner" role="status">
        <span class="badge beta">Beta</span>
        <p>
          <strong>Separate offering — not part of the core site design package.</strong>
          Plant Recommendation + Economics Engine: Site Condition Profile → hardiness hard filter → soft scores against weak fecundity levers → establishment cost, payback, and simple NPV.
          Treat every result as provisional; confirm hardiness, climate fit, and markets before ordering or planting.
        </p>
      </div>
      <span class="mono eyebrow">Planting planner · matching engine + economics</span>
      <h1>What to plant <span class="badge beta" style="vertical-align:middle;font-size:0.55em">Beta</span></h1>
      <p class="lede">
        Ranked plants and guilds for this parcel — fit score, lever benefits, establishment cost,
        gross return, payback, and NPV. Offered on the side while we refine the model.
      </p>
      <p class="fine">${esc(plan.phase_note || '')}</p>
      ${goalsBar}
      ${profileBlock}
      ${planEconBlock}
      ${plantingInterventionBlock(state.report?.planting_intervention_value)}
      ${guildBlock}
      <div class="plant-chips">${layers}</div>
      ${valueFilterBar(plantCounts, state.plantValueFilter, allPlants.length).replace(
        'Filter by value',
        'Filter plants by value'
      )}
      ${cashBlock}
      <div class="plant-list-toolbar" id="plant-list-toolbar">
        <span class="fine">${filtered.length} plants · collapsed by default</span>
        <div class="plant-list-toolbar-actions">
          <button type="button" class="btn-quiet" id="btn-expand-plants">Expand all</button>
          <button type="button" class="btn-quiet" id="btn-collapse-plants">Collapse all</button>
        </div>
      </div>
      <div class="plant-list" id="plant-list">${
        rows ||
        '<p class="fine">No plants in this value filter — try All.</p>'
      }</div>
      <p class="fine" style="margin-top:1rem">
        Profile: zone ${esc(plan.site_filters?.plant_hardiness_zone || '—')}
        ${plan.site_filters?.effective_hardiness_zone && plan.site_filters.effective_hardiness_zone !== plan.site_filters.plant_hardiness_zone
          ? ` (effective ${esc(plan.site_filters.effective_hardiness_zone)})` : ''},
        ${esc(plan.site_filters?.frost_free_days ?? '—')} FFD,
        ~${esc(plan.site_filters?.annual_precipitation_mm ?? '—')} mm,
        ${esc(plan.site_filters?.texture || '—')} /
        ${esc(plan.site_filters?.drainage_class || '—')},
        ${esc(plan.site_filters?.water_regime || '—')} regime,
        ${esc(areaHa != null ? Number(areaHa).toFixed(2) : '—')} ha,
        scenario ${esc(plan.site_filters?.scenario || 'market_garden')}.
        Schema:
        <a href="/schema/crop.schema.json" target="_blank" rel="noopener">crop.schema.json</a>.
        Vendor links are search starting points — verify stock and hardiness.
      </p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="btn-back-site">← Back to site design</button>
        <button type="button" class="btn-quiet" id="btn-plant-map">Map</button>
      </div>
    </div>`;

  $('btn-back-site')?.addEventListener('click', () => switchReportPane('overview'));
  $('btn-plant-map')?.addEventListener('click', showMap);

  // Goal chips — exclusive economic/balanced, stack ecological
  el.querySelectorAll('[data-plant-goal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-plant-goal');
      if (!id) return;
      state.plantGoals = togglePlantGoal(state.plantGoals || ['balanced'], id, availableGoals);
      // Refresh chip active state only (apply on button)
      el.querySelectorAll('[data-plant-goal]').forEach((b) => {
        const on = state.plantGoals.includes(b.getAttribute('data-plant-goal'));
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  });
  $('plant-scenario')?.addEventListener('change', (ev) => {
    state.plantScenario = ev.target.value || 'market_garden';
    // Live economics re-score when scenario changes
    replanPlantings();
  });
  $('btn-replan-plants')?.addEventListener('click', () => replanPlantings());

  const setAllPlantDetailsOpen = (open) => {
    el.querySelectorAll('#plant-list details.plant-details').forEach((d) => {
      d.open = open;
    });
  };
  $('btn-expand-plants')?.addEventListener('click', () => setAllPlantDetailsOpen(true));
  $('btn-collapse-plants')?.addEventListener('click', () => setAllPlantDetailsOpen(false));

  // Plant value filter (reuse chip UI; scope to planting pane)
  const plantBar = el.querySelector('.value-filter-bar');
  plantBar?.querySelectorAll('[data-value-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-value-filter') || 'all';
      state.plantValueFilter = id;
      plantBar.querySelectorAll('[data-value-filter]').forEach((b) => {
        const on = b.getAttribute('data-value-filter') === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const list = filterRecsByValue(allPlants, id);
      const host = el.querySelector('#plant-list');
      if (!host) return;
      host.innerHTML = list.length
        ? list.map(plantCard).join('')
        : '<p class="fine">No plants in this value filter — try All.</p>';
      // Filtered list stays collapsed by default
      const toolbar = el.querySelector('#plant-list-toolbar .fine');
      if (toolbar) toolbar.textContent = `${list.length} plants · collapsed by default`;
    });
  });
}

/** Compact lever-delta + cash summary inside the beta planting pane */
function plantingInterventionBlock(iv) {
  if (!iv?.financialSummary && !iv?.improves_levers?.length) return '';
  const fin = iv.financialSummary || {};
  const dOverall = iv.scoreComparison?.deltas?.overall;
  return `
    <div class="well-range-card" style="border-left-color:var(--ok);margin:0.75rem 0">
      <span class="mono">Value of this planting plan (intervention)</span>
      <div class="summary-grid" style="margin-top:0.45rem">
        <div class="stat"><span class="k">Upfront</span><strong>${fin.upfrontCost_cad != null ? fmtMoney(fin.upfrontCost_cad) : '—'}</strong></div>
        <div class="stat"><span class="k">Annual gross</span><strong>${fin.annualBenefit_cad != null ? fmtMoney(fin.annualBenefit_cad) : '—'}</strong></div>
        <div class="stat"><span class="k">NPV</span><strong>${fin.npv_cad != null ? fmtMoney(fin.npv_cad) : '—'}</strong></div>
        <div class="stat"><span class="k">Lever Δ</span><strong>${dOverall != null ? `${dOverall > 0 ? '+' : ''}${esc(dOverall)}` : '—'}</strong></div>
      </div>
      ${
        iv.improves_levers?.length
          ? `<p class="fine" style="margin:0.4rem 0 0"><strong>Improves:</strong> ${iv.improves_levers
              .slice(0, 5)
              .map((L) => `${esc(L.label)} (+${esc(L.delta)})`)
              .join(' · ')}</p>`
          : ''
      }
      <p class="fine" style="margin:0.3rem 0 0">Carries both fecundity lever deltas and cash-flow projections — feeds value-of-improvements.</p>
    </div>`;
}

/** Fallback goal list if plan payload omits available_goals */
const DEFAULT_PLANT_GOALS = [
  { id: 'balanced', label: 'Balanced', short: 'Balanced', kind: 'balanced', exclusive: true, description: 'Multi-function fit' },
  { id: 'max_food', label: 'Max food', short: 'Max food', kind: 'ecological', description: 'Prioritize edible crops' },
  { id: 'max_nitrogen', label: 'Max nitrogen', short: 'Max N', kind: 'ecological', description: 'Nitrogen-fixers' },
  { id: 'soil_building', label: 'Soil building', short: 'Soil', kind: 'ecological', description: 'Soil structure & cover' },
  { id: 'windbreak', label: 'Windbreak', short: 'Wind', kind: 'ecological', description: 'Shelterbelt species' },
  { id: 'wildlife', label: 'Wildlife', short: 'Wildlife', kind: 'ecological', description: 'Habitat & natives' },
  { id: 'pollinator', label: 'Pollinators', short: 'Pollinate', kind: 'ecological', description: 'Pollinator plants' },
  { id: 'medicinal', label: 'Medicinal / herbal', short: 'Herbal', kind: 'ecological', description: 'Medicinal herbs' },
  { id: 'wetland_buffer', label: 'Wetland buffer', short: 'Wetland', kind: 'ecological', description: 'Wetland-edge species' },
  { id: 'fodder', label: 'Fodder / forage', short: 'Fodder', kind: 'ecological', description: 'Livestock forage' },
  { id: 'lowest_cost', label: 'Lowest cost', short: 'Low cost', kind: 'economic', exclusive: true, description: 'Best fit per dollar' },
  { id: 'max_revenue', label: 'Max revenue', short: 'Max $', kind: 'economic', exclusive: true, description: 'Highest gross revenue' },
  { id: 'fastest_payback', label: 'Fastest payback', short: 'Payback', kind: 'economic', exclusive: true, description: 'Shortest payback years' },
];

function togglePlantGoal(current, id, catalog = DEFAULT_PLANT_GOALS) {
  const byId = Object.fromEntries(catalog.map((g) => [g.id, g]));
  const def = byId[id];
  if (!def) return current;

  // Exclusive balanced / economic: select alone
  if (def.exclusive || def.kind === 'economic' || def.kind === 'balanced') {
    return [id];
  }

  // Ecological: remove exclusive modes, toggle this id
  let next = current.filter((g) => {
    const d = byId[g];
    return d && d.kind === 'ecological';
  });
  if (next.includes(id)) next = next.filter((g) => g !== id);
  else next = [...next, id];
  if (!next.length) next = ['balanced'];
  return next;
}

/**
 * Re-run planting engine with selected goals using site context from last report.
 */
async function replanPlantings() {
  const r = state.report;
  if (!r) return;
  const status = $('plant-goals-status');
  const btn = $('btn-replan-plants');
  state.plantReplanning = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating…';
  }
  if (status) {
    status.hidden = false;
    status.textContent = 'Re-ranking plants for your goals…';
  }

  const site = {
    footprint_ha: r.geometry?.area_ha || r.footprint_ha || r.site_condition_profile?.footprint_ha,
    climate: r.climate || {
      plant_hardiness_zone: r.hardiness?.hardiness_zone || r.planting_plan?.site_filters?.plant_hardiness_zone,
      frost_free_days: r.hardiness?.frost_free_days_estimate || r.planting_plan?.site_filters?.frost_free_days,
      chinook_exposure: r.climate?.chinook_exposure,
      prevailing_wind_direction: r.climate?.prevailing_wind_direction || r.wind_rose?.primary_direction,
    },
    soil: r.soil || {
      texture: r.soil_survey?.characteristics?.texture_class || r.planting_plan?.site_filters?.texture,
      drainage_class: r.soil_survey?.characteristics?.drainage || r.planting_plan?.site_filters?.drainage_class,
      ph: r.soil_survey?.sample_summary?.mean_ph,
    },
    hydrology: r.hydrology || {
      annual_precipitation_mm: r.planting_plan?.site_filters?.annual_precipitation_mm,
      wetland_class: r.wetlands?.has_wetland_on_site ? 'wetland' : null,
    },
    terrain: r.terrain || {},
    existing_vegetation: r.existing_vegetation || {
      successional_stage: r.planting_plan?.site_filters?.successional_stage,
    },
  };

  try {
    const res = await fetch('/api/planting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site,
        goals: state.plantGoals || ['balanced'],
        scenario: state.plantScenario || 'market_garden',
        fecundity: r.fecundity,
        hardiness: r.hardiness,
        soil_survey: r.soil_survey,
        satellite: r.satellite,
        wetlands: r.wetlands,
        wind_rose: r.wind_rose,
        tree_cover: r.tree_cover,
        profile: r.site_condition_profile || r.planting_plan?.site_condition_profile,
        design_elements: r.design_elements,
        limit: 18,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Replan failed (${res.status})`);
    const plan = data.planting_plan;
    if (!plan) throw new Error('No planting plan returned');
    state.report = {
      ...r,
      planting_plan: plan,
      site_condition_profile: plan.site_condition_profile || r.site_condition_profile,
      planting_intervention_value: data.planting_intervention_value || r.planting_intervention_value,
      recommended_plantings: data.recommended_plantings || r.recommended_plantings,
      design_elements: data.design_elements || r.design_elements,
      recommendations: data.recommendations || r.recommendations,
    };
    // Refresh planting markers on unified property map (same drawn parcel)
    if (state.report.site_map) {
      state.report.site_map = {
        ...state.report.site_map,
        plantings: clientPlacePlantings(plan, getParcelLatLngs()),
        layers_available: {
          ...(state.report.site_map.layers_available || {}),
          plantings: !!(plan.recommended?.length),
        },
      };
    }
    if (state.report.fecundity && data.planting_intervention_value) {
      state.report.fecundity = {
        ...state.report.fecundity,
        plantingInterventionValue: data.planting_intervention_value,
      };
    }
    state.plantGoals = plan.goals || state.plantGoals;
    state._plantPlan = null;
    renderPlantingPane(plan);
    // Re-mount property maps so planting markers update
    setTimeout(() => initReportMapEmbed(state.report), 80);
    if (status) {
      status.hidden = false;
      const pe = plan.plan_economics;
      const iv = data.planting_intervention_value;
      status.textContent =
        `Live re-score: ${plan.goals_label || (plan.goals || []).join(' · ')}` +
        (pe?.establishment_total_cad != null
          ? ` · est. ${fmtMoney(pe.establishment_total_cad)} · NPV ${fmtMoney(pe.npv_sum_cad)}`
          : '') +
        (iv?.scoreComparison?.deltas?.overall != null
          ? ` · lever Δ ${iv.scoreComparison.deltas.overall > 0 ? '+' : ''}${iv.scoreComparison.deltas.overall}`
          : '');
    }
  } catch (e) {
    console.error(e);
    if (status) {
      status.hidden = false;
      status.textContent = e.message || 'Could not update planting goals';
    }
  } finally {
    state.plantReplanning = false;
  }
}

/**
 * Full-report / PDF section: Recommended Plantings table + lever links + value summary.
 * @param {object} table — recommended_plantings payload or planting_plan
 * @param {object} intervention — planting_intervention_value
 */
function recommendedPlantingsSection(table, intervention) {
  if (!table && !intervention) return '';
  const rows =
    table?.rows ||
    table?.recommended?.map((p) => {
      const e = p.economics || {};
      const y = e.yield_on_parcel_kg;
      const g = e.gross_revenue_cad;
      return {
        common_name: p.common_name,
        scientific_name: p.scientific_name,
        score: p.score,
        functions: p.primary_value ? [p.primary_value] : [],
        quantity: e.suggested_quantity,
        unit: e.unit || 'kg',
        product_yield_kg: y
          ? { low: y.low_kg, mid: y.mid_kg, high: y.high_kg, unit: e.unit || 'kg' }
          : null,
        cash_yield_cad: g
          ? { low: g.low, mid: g.mid, high: g.high }
          : null,
        product_yield_mid_kg: y?.mid_kg ?? null,
        establishment_cost_cad: e.establishment_cost_cad?.total,
        gross_revenue_mid_cad: g?.mid,
        payback_years: e.payback_years,
        improves_levers: p.lever_benefits || p.improves_levers || [],
      };
    }) ||
    intervention?.species ||
    [];
  if (!rows.length) return '';

  const fin = intervention?.financialSummary || table?.summary || table?.plan_economics;
  const improves = intervention?.improves_levers || table?.intervention?.improves || [];
  const guilds = table?.guilds || intervention?.guilds || [];
  const goalsLabel = table?.goals_label || intervention?.goals_label || '';
  const hardiness = table?.hardiness || table?.site_filters?.plant_hardiness_zone;
  const eff = table?.effective_zone || table?.site_filters?.effective_hardiness_zone;
  const foodRows = rows.filter((r) => /food|edible|fruit|nut|berry|food_production/i.test(
    `${r.functions || ''} ${r.common_name || ''}`
  ));
  const foodYield = foodRows.reduce((acc, r) => {
    const y = r.product_yield_kg || (r.product_yield_mid_kg != null ? { mid: r.product_yield_mid_kg } : null);
    if (!y || (r.unit && !/kg|kilogram/i.test(r.unit))) return acc;
    acc.low += Number(y.low ?? y.low_kg ?? y.mid ?? y.mid_kg ?? 0);
    acc.mid += Number(y.mid ?? y.mid_kg ?? 0);
    acc.high += Number(y.high ?? y.high_kg ?? y.mid ?? y.mid_kg ?? 0);
    return acc;
  }, { low: 0, mid: 0, high: 0 });
  const foodYieldBlock = foodRows.length && foodYield.mid > 0
    ? `<div class="well-range-card" style="border-left-color:var(--ok);margin-top:0.75rem">
        <span class="mono">Estimated food-forest yield at maturity</span>
        <div class="well-range-value" style="color:var(--ok)">${fmtQty(foodYield.mid)} kg/yr</div>
        <p class="fine">Planning range ${fmtQty(foodYield.low)}–${fmtQty(foodYield.high)} kg/yr from the edible rows shown below. Establishment takes time; species, harvest, weather, and market access drive actual yield.</p>
      </div>` : '';

  const body = rows
    .slice(0, 14)
    .map((r) => {
      const fn = Array.isArray(r.functions) ? r.functions.join(', ') : r.functions || '—';
      const levers = Array.isArray(r.improves_levers)
        ? r.improves_levers.join('; ')
        : r.improves_levers || '—';
      const unit = r.unit || r.product_yield_kg?.unit || 'kg';
      const py = r.product_yield_kg
        ? { low_kg: r.product_yield_kg.low, mid_kg: r.product_yield_kg.mid, high_kg: r.product_yield_kg.high }
        : r.product_yield_mid_kg != null
          ? { mid_kg: r.product_yield_mid_kg }
          : null;
      const cy = r.cash_yield_cad || (r.gross_revenue_mid_cad != null ? { mid: r.gross_revenue_mid_cad } : null);
      return `<tr>
        <td><strong>${esc(r.common_name || r.id || '—')}</strong>${
          r.scientific_name ? `<br><span class="fine mono">${esc(r.scientific_name)}</span>` : ''
        }${r.score != null ? `<br><span class="fine">Fit ${esc(r.score)}</span>` : ''}</td>
        <td class="fine">${esc(fn)}</td>
        <td>${r.quantity != null ? esc(r.quantity) : '—'}</td>
        <td>${r.establishment_cost_cad != null ? fmtMoney(r.establishment_cost_cad) : '—'}</td>
        <td class="econ-yield">${fmtProductYieldMid(py, unit)}<br><span class="fine">${fmtProductYieldRange(py, unit)}</span></td>
        <td class="econ-rev">${cy?.mid != null ? fmtMoney(cy.mid) : '—'}<br><span class="fine">${fmtCashYieldRange(cy)}</span></td>
        <td>${r.payback_years != null ? `~${esc(r.payback_years)} yr` : '—'}</td>
        <td class="fine">${esc(levers)}</td>
      </tr>`;
    })
    .join('');

  const leverCards = improves.length
    ? `<div class="summary-grid" style="margin-top:0.75rem">
        ${improves
          .slice(0, 6)
          .map(
            (L) => `
          <div class="stat">
            <span class="k">${esc(L.label || L.lever)}</span>
            <strong>+${esc(L.delta)}</strong>
            <span class="fine">${esc(L.plants_targeting || '')} plants</span>
          </div>`
          )
          .join('')}
      </div>`
    : '';

  const guildHtml = guilds.length
    ? `<div style="margin-top:0.85rem">
        <span class="mono topo-label">Suggested guilds</span>
        <ul class="wildlife-recs" style="margin:0.4rem 0 0;padding-left:1.2rem;font-size:0.9rem;color:var(--ink-soft)">
          ${guilds
            .map(
              (g) =>
                `<li><strong>${esc(g.label)}</strong> — ${esc(g.rationale || '')}
                ${(g.members || []).length ? ` <span class="fine">(${(g.members || []).map(esc).join(', ')})</span>` : ''}</li>`
            )
            .join('')}
        </ul>
      </div>`
    : '';

  const valueBlock =
    fin && (fin.upfrontCost_cad != null || fin.establishment_total_cad != null)
      ? `
    <div class="summary-grid" style="margin-top:0.75rem">
      <div class="stat"><span class="k">Establishment</span><strong>${fmtMoney(fin.upfrontCost_cad ?? fin.establishment_total_cad)}</strong></div>
      <div class="stat"><span class="k">Annual gross (maturity)</span><strong>${
        fin.annualBenefit_cad != null || fin.annual_gross_mid_at_maturity_cad != null
          ? fmtMoney(fin.annualBenefit_cad ?? fin.annual_gross_mid_at_maturity_cad)
          : '—'
      }</strong></div>
      <div class="stat"><span class="k">Plan NPV</span><strong>${
        fin.npv_cad != null || fin.npv_sum_cad != null
          ? fmtMoney(fin.npv_cad ?? fin.npv_sum_cad)
          : '—'
      }</strong></div>
      <div class="stat"><span class="k">Payback</span><strong>${
        fin.paybackYears != null ? `~${esc(fin.paybackYears)} yr` : '—'
      }</strong></div>
    </div>
    ${
      intervention?.scoreComparison?.deltas?.overall != null
        ? `<p class="fine" style="margin-top:0.45rem">Estimated overall fecundity lever change from this planting plan: <strong>${
            intervention.scoreComparison.deltas.overall > 0 ? '+' : ''
          }${esc(intervention.scoreComparison.deltas.overall)}</strong> points (planning-level).</p>`
        : ''
    }`
      : '';

  return `
    <section class="report-block recommended-plantings-section">
      <h2>Recommended plantings</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Species ranked by site fit${goalsLabel ? ` · goals: <strong>${esc(goalsLabel)}</strong>` : ''}
        ${hardiness ? ` · hardiness ${esc(hardiness)}${eff && eff !== hardiness ? ` (effective ${esc(eff)})` : ''}` : ''}.
        Confidence: hardiness <strong>high</strong> · soil/moisture <strong>medium–high</strong> · yield &amp; price <strong>medium</strong> (ranges).
        Indicative markers appear on the <strong>Property map</strong> (toggle “Proposed plantings”).
        <span class="badge beta" style="margin-left:0.35rem">Beta</span>
      </p>
      ${valueBlock}
      ${foodYieldBlock}
      ${leverCards ? `<span class="mono topo-label" style="display:block;margin-top:0.75rem">Levers this plan is expected to improve</span>${leverCards}` : ''}
      <div class="econ-table-wrap" style="margin-top:0.85rem">
        <table class="econ-table plantings-table">
          <colgroup>
            <col><col><col><col><col><col><col><col>
          </colgroup>
          <thead>
            <tr>
              <th>Species</th>
              <th>Function</th>
              <th>Qty</th>
              <th>Est. cost</th>
              <th>Product yield</th>
              <th>Cash yield</th>
              <th>Payback</th>
              <th>Improves</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="fine" style="margin-top:0.4rem">
        <strong>Product yield</strong> = physical harvest (kg/yr) on the polyculture patch at maturity.
        <strong>Cash yield</strong> = gross CAD/yr at maturity (before full labour). Patch-scale only — not full-field monoculture.
      </p>
      ${guildHtml}
      <p class="fine" style="margin-top:0.65rem">
        Planning ranges only — not a business plan. Verify stock, hardiness cultivars, and markets before ordering.
        Full interactive list (goals, live economics): <strong>Planting planner</strong> side offering.
      </p>
      ${(intervention?.disclaimers || []).length
        ? `<ul class="fine" style="margin:0.4rem 0 0;padding-left:1.1rem">${intervention.disclaimers
            .slice(0, 3)
            .map((d) => `<li>${esc(d)}</li>`)
            .join('')}</ul>`
        : ''}
    </section>`;
}

function supplierBlock(sup) {
  if (!sup) return '';
  const kinds = [
    ['seeds', 'Seeds'],
    ['saplings', 'Saplings / plants'],
    ['fertilizer', 'Fertilizer / amendments'],
  ];
  const parts = kinds
    .map(([key, label]) => {
      const links = sup[key] || [];
      if (!links.length) return '';
      return `
        <div class="supplier-kind">
          <span class="mono">${esc(label)}</span>
          <ul class="supplier-links">
            ${links
              .map(
                (l) => `
              <li>
                <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.name)}</a>
                ${l.region ? `<span class="fine"> · ${esc(l.region)}</span>` : ''}
                ${l.product_hint ? `<span class="fine"> — ${esc(l.product_hint)}</span>` : ''}
              </li>`
              )
              .join('')}
          </ul>
        </div>`;
    })
    .filter(Boolean)
    .join('');
  if (!parts) return '';
  return `
    <div class="supplier-block">
      <span class="mono supplier-title">Where to buy</span>
      ${parts}
      ${sup.disclaimer ? `<p class="fine" style="margin:0.4rem 0 0">${esc(sup.disclaimer)}</p>` : ''}
    </div>`;
}

function fmtMoney(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: x >= 100 ? 0 : 2,
  }).format(x);
}

function suitBadgeClass(s) {
  if (s === 'excellent' || s === 'good') return 'high';
  if (s === 'fair') return 'moderate';
  return 'visit';
}

/**
 * Small inline-SVG scatter minimap: site centre + nearby points, colour-coded
 * by a magnitude value on a single-hue sequential ramp (validated against the
 * paper background — see dataviz skill's ordinal-ramp check).
 *
 * @param {{ latitude:number, longitude:number }} centre
 * @param {Array<{ lat:number, lng:number, value:number, tooltip:string }>} points
 * @param {{ ramp:string[], legendLo:string, legendHi:string, unitLabel:string }} opts
 */
function pointsMinimap(centre, points, opts) {
  const { ramp, legendLo, legendHi } = opts;
  const clean = (points || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (!clean.length) return '';

  const W = 240;
  const H = 200;
  const PAD = 22;

  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((centre.latitude * Math.PI) / 180);
  const toXY = (lat, lng) => ({
    x: (lng - centre.longitude) * mPerDegLng,
    y: (centre.latitude - lat) * mPerDegLat, // north is up
  });

  const pts = clean.map((p) => ({ ...toXY(p.lat, p.lng), value: p.value, tooltip: p.tooltip }));
  const maxAbs = Math.max(
    10,
    ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))
  );
  const scale = (Math.min(W, H) / 2 - PAD) / maxAbs;
  const cx = W / 2;
  const cy = H / 2;

  const values = pts.map((p) => p.value).filter(Number.isFinite);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const steps = ramp.length;
  const bucketColor = (v) => {
    if (!Number.isFinite(v) || vMax === vMin) return ramp[0];
    const t = (v - vMin) / (vMax - vMin);
    const idx = Math.min(steps - 1, Math.floor(t * steps));
    return ramp[idx];
  };

  const dots = pts
    .map((p) => {
      const x = (cx + p.x * scale).toFixed(1);
      const y = (cy + p.y * scale).toFixed(1);
      const fill = bucketColor(p.value);
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="${fill}" stroke="var(--paper)" stroke-width="1.2"><title>${esc(p.tooltip)}</title></circle>`;
    })
    .join('');

  const spanKm = ((maxAbs * 2) / 1000).toFixed(1);

  return `
    <div class="minimap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Minimap of nearby points around the site">
        <rect x="0" y="0" width="${W}" height="${H}" fill="var(--paper)" stroke="var(--line)" />
        ${dots}
        <circle cx="${cx}" cy="${cy}" r="5.5" fill="var(--gold)" stroke="var(--ink)" stroke-width="1.2"><title>Site centre</title></circle>
      </svg>
      <div class="minimap-legend">
        <span class="minimap-legend-swatch" style="background:var(--gold)"></span>
        <span class="fine">Site</span>
        <span class="minimap-ramp">
          ${ramp.map((c) => `<span style="background:${c}"></span>`).join('')}
        </span>
        <span class="fine">${esc(legendLo)} → ${esc(legendHi)}</span>
        <span class="fine minimap-span">· ~${spanKm} km across</span>
      </div>
    </div>`;
}

const WELL_DEPTH_RAMP = ['#2e2118', '#4a3524', '#64492f', '#7d5e3d', '#96784f', '#ac9268'];
const CRIME_DISTANCE_RAMP = ['#5b3a73', '#7e5a96', '#9c7cb3', '#b09bc4']; // near→far (dark→light)

function wellsMapEmbed(w, centre) {
  const wells = w?.nearby_wells;
  if (!wells?.length || !centre) return '';

  // Return a div placeholder; init happens after DOM insertion
  const id = 'wells-minimap-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    initWellsMinimap(id, wells, centre);
  }, 100);
  return `<div id="${id}" class="report-map minimap-embed" style="height:240px"></div>`;
}

function initWellsMinimap(elId, wells, centre) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  const map = L.map(el, { zoomControl: true, attributionControl: false });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri', maxZoom: 20,
  }).addTo(map);

  const all = [[centre.latitude, centre.longitude]];
  L.circleMarker([centre.latitude, centre.longitude], {
    radius: 8, fillColor: '#a8801f', fillOpacity: 1,
    color: '#16211b', weight: 2,
  }).addTo(map).bindTooltip('Site centre');

  wells.forEach((w) => {
    all.push([w.lat, w.lng]);
    const depth = w.completion_depth_m || w.depth_m || 0;
    const t = Math.min(1, depth / 80);
    const fill = `hsl(24, ${40 + t * 30}%, ${60 - t * 35}%)`;
    const swlTip = w.static_water_level_m != null ? ` · SWL ${w.static_water_level_m}m` : '';
    L.circleMarker([w.lat, w.lng], {
      radius: 6, fillColor: fill, fillOpacity: 0.85,
      color: '#fff', weight: 1.5,
    }).addTo(map).bindTooltip(`completion ${depth}m${swlTip} · ${w.distance_km}km`);
  });

  map.fitBounds(all, { padding: [10, 10] });
}

function wellsMinimap(w, centre) {
  return wellsMapEmbed(w, centre);
}

function crimeMinimap(nearestCrimes, centre) {
  const list = nearestCrimes?.nearest;
  if (!list?.length || !centre) return '';

  const points = list.filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  if (!points.length) return '';

  const id = 'crime-minimap-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    initCrimeMinimap(id, points, centre);
  }, 100);
  return `<div id="${id}" class="report-map minimap-embed" style="height:240px"></div>`;
}

function initCrimeMinimap(elId, crimes, centre) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  const map = L.map(el, { zoomControl: true, attributionControl: false });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri', maxZoom: 20,
  }).addTo(map);

  const all = [[centre.latitude, centre.longitude]];
  L.circleMarker([centre.latitude, centre.longitude], { radius: 8, fillColor: '#a8801f', fillOpacity: 1, color: '#16211b', weight: 2 }).addTo(map).bindTooltip('Site centre');

  crimes.forEach((c) => {
    all.push([c.latitude, c.longitude]);
    L.circleMarker([c.latitude, c.longitude], { radius: 6, fillColor: '#8c2f1d', fillOpacity: 0.8, color: '#fff', weight: 1.5 }).addTo(map).bindTooltip(`${c.occurrence_type || 'Occurrence'} · ${Math.round(c.distance_m)}m`);
  });

  map.fitBounds(all, { padding: [10, 10] });
}

function wellDepthDistributionSvg(wells, predictedDepth, low, high) {
  if (!wells?.length) return '';
  // Prefer aquifer completion depths (hydrology) over total drilled
  const depths = wells
    .map((w) => w.completion_depth_m ?? w.depth_m)
    .filter((d) => d > 0);
  if (!depths.length) return '';

  const W = 320, H = 130, padX = 24, padY = 22;
  const usableW = W - padX * 2, usableH = H - padY * 2;
  const min = Math.min(...depths, low != null ? low : Infinity, predictedDepth != null ? predictedDepth : Infinity);
  const max = Math.max(...depths, high != null ? high : 0, predictedDepth != null ? predictedDepth : 0);
  const span = (max - min) || 1;

  const bins = 14;
  const binW = span / bins;
  const counts = new Array(bins).fill(0);
  for (const d of depths) {
    const i = Math.min(bins - 1, Math.floor((d - min) / binW));
    counts[i]++;
  }
  const maxC = Math.max(...counts, 1);

  const bars = counts.map((c, i) => {
    const x = padX + (i / bins) * usableW;
    const h = Math.max(2, (c / maxC) * usableH);
    const y = padY + usableH - h;
    const fill = i < bins / 3 ? 'var(--h2)' : i < bins * 2 / 3 ? 'var(--h4)' : 'var(--h6)';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(usableW / bins - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" opacity="0.7" rx="1"><title>${c} wells · ~${Math.round(min + i * binW)}–${Math.round(min + (i + 1) * binW)}m completion</title></rect>`;
  }).join('');

  let rangeOverlay = '';
  if (low != null && high != null) {
    const lx = padX + ((low - min) / span) * usableW;
    const hx = padX + ((high - min) / span) * usableW;
    rangeOverlay = `
      <rect x="${lx.toFixed(1)}" y="${padY}" width="${Math.max(3, (hx - lx)).toFixed(1)}" height="${usableH.toFixed(1)}" fill="rgba(145, 78, 44, 0.18)" stroke="#a8801f" stroke-width="1.5" stroke-dasharray="4 2" rx="2">
        <title>Hydrology confidence band: ${low}–${high}m</title>
      </rect>`;
  }
  let predLine = '';
  if (predictedDepth != null) {
    const px = padX + ((predictedDepth - min) / span) * usableW;
    predLine = `
      <line x1="${px.toFixed(1)}" y1="${padY}" x2="${px.toFixed(1)}" y2="${(padY + usableH).toFixed(1)}" stroke="#a8801f" stroke-width="2">
        <title>Recommended completion: ${predictedDepth}m</title>
      </line>
      <text x="${px.toFixed(1)}" y="${(padY - 4).toFixed(1)}" class="svg-label" text-anchor="middle" fill="#a8801f">${predictedDepth}m</text>`;
  }

  return `
    <div class="well-chart-wrap">
      <span class="mono topo-label">Aquifer completion depths (${depths.length} wells)</span>
      <svg class="well-dist-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Aquifer completion depth histogram">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#f7f8f3" stroke="#c8cec1"/>
        ${bars}
        ${rangeOverlay}
        ${predLine}
        <text x="${padX}" y="${(H - 4).toFixed(1)}" class="svg-label">${Math.round(min)}m</text>
        <text x="${(padX + usableW - 12).toFixed(1)}" y="${(H - 4).toFixed(1)}" class="svg-label">${Math.round(max)}m</text>
      </svg>
    </div>`;
}

function wellDistanceDepthSvg(wells, centre) {
  if (!wells?.length || !centre) return '';
  const points = wells.filter((w) => w.distance_km != null && (w.completion_depth_m > 0 || w.depth_m > 0));
  if (!points.length) return '';

  const W = 320, H = 150, padX = 30, padY = 22;
  const usableW = W - padX * 2, usableH = H - padY * 2;
  const maxDist = Math.max(...points.map((p) => p.distance_km), 1);
  const maxDepth = Math.max(...points.map((p) => p.completion_depth_m || p.depth_m), 50);

  const dots = points.map((p) => {
    const depth = p.completion_depth_m || p.depth_m;
    const x = padX + (p.distance_km / maxDist) * usableW;
    const y = padY + usableH - (depth / maxDepth) * usableH;
    const hasSwl = p.static_water_level_m != null;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${hasSwl ? '#2f6f4e' : '#5b3a73'}" opacity="0.75"><title>completion ${depth}m${hasSwl ? ` · SWL ${p.static_water_level_m}m` : ''} · ${p.distance_km}km</title></circle>`;
  }).join('');

  return `
    <div class="well-chart-wrap">
      <span class="mono topo-label">Distance vs completion (${points.length} wells)</span>
      <svg class="well-dist-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distance vs aquifer completion scatter">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#f7f8f3" stroke="#c8cec1"/>
        ${dots}
        <text x="${padX}" y="${(H - 4).toFixed(1)}" class="svg-label">0 km</text>
        <text x="${(padX + usableW - 8).toFixed(1)}" y="${(H - 4).toFixed(1)}" class="svg-label">${maxDist.toFixed(1)}km</text>
        <text x="4" y="${(padY + 8).toFixed(1)}" class="svg-label">${Math.round(maxDepth)}m</text>
      </svg>
    </div>`;
}

function wellDepthSection(w, centre) {
  if (!w) {
    return `
      <section class="report-block">
        <h2>Predicted well depth</h2>
        <p class="fine">No estimate available for this site.</p>
      </section>`;
  }

  const depth = w.estimated_depth_m;
  const low = w.estimated_depth_range_m?.low_m;
  const high = w.estimated_depth_range_m?.high_m;
  const swl = w.estimated_static_water_level_m;
  const aquiferTop = w.estimated_aquifer_top_m;
  const depthFt = depth != null ? Math.round(depth * 3.28084 * 10) / 10 : null;
  const confLabel = {
    well_control_dense: 'Dense nearby well control',
    well_control_sparse: 'Sparse nearby well control',
    no_nearby_wells_bedrock_model_only: 'No nearby wells — bedrock / WAM model only',
  }[w.confidence] || w.confidence;

  const basis = (w.hydrology_basis || w._meta?.hydro_signals)
    ? (w.hydrology_basis || []).slice(0, 4)
    : [];
  const basisLine = basis.length
    ? basis.map((b) => esc(b)).join(' · ')
    : 'Nearby pump tests, screen intervals, and water-bearing lithology (IDW)';

  const distChart = wellDepthDistributionSvg(w.nearby_wells, depth, low, high);
  const scatterChart = wellDistanceDepthSvg(w.nearby_wells, centre);

  const yieldSum = w.yield_summary;
  const pumpSum = w.pump_test_summary;
  const chemSum = w.chemistry_summary;
  const lithSum = w.lithology_summary;

  const enrichCards = [];
  if (swl != null || aquiferTop != null || depth != null) {
    enrichCards.push(`
      <article class="prox-card" style="border-left-color:#2a6f97">
        <span class="mono">Groundwater access</span>
        <strong>${swl != null ? `Water table ~${fmt(swl, 'm bgs')}` : 'Aquifer access screened'}</strong>
        <p class="fine">Planning completion ${fmt(depth, 'm bgs')}${aquiferTop != null ? ` · aquifer top ~${fmt(aquiferTop, 'm bgs')}` : ''}. This indicates potential access, not a guaranteed supply.</p>
      </article>`);
  }
  if (swl != null) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Static water level</span>
        <strong>${fmt(swl, 'm')} bgs</strong>
        <p class="fine">IDW from nearby pump tests${aquiferTop != null && aquiferTop !== swl ? ` · aquifer top ~${fmt(aquiferTop, 'm')}` : ''}</p>
      </article>`);
  }
  if (w.target_hydrostratigraphic_unit) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Target unit</span>
        <strong style="font-size:1rem">${esc(w.target_hydrostratigraphic_unit)}</strong>
        <p class="fine">${esc(confLabel)}</p>
      </article>`);
  }
  if (yieldSum?.count) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Well yield (${yieldSum.count} wells)</span>
        <strong>mean ${esc(yieldSum.mean)} gpm · max ${esc(yieldSum.max)} gpm</strong>
        <p class="fine">min ${esc(yieldSum.min)} gpm · reported nearby-well yield</p>
      </article>`);
  }
  if (pumpSum?.count) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Pump tests (${pumpSum.count} wells)</span>
        <strong>SWL ${fmt(pumpSum.swl_range_m?.low, 'm')}–${fmt(pumpSum.swl_range_m?.high, 'm')}</strong>
        <p class="fine">${pumpSum.yield_range ? `yield ${pumpSum.yield_range.low}–${pumpSum.yield_range.high} ${esc(pumpSum.yield_range.unit || 'gpm')}` : 'No pump-test flow rate reported'}</p>
      </article>`);
  }
  if (chemSum?.count) {
    const topElems = Object.entries(chemSum.elements || {}).slice(0, 5)
      .map(([k, v]) => `${esc(k)}: ${v.mean}`).join(' · ');
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Water chemistry (${chemSum.count} wells)</span>
        <p class="fine">${topElems || 'elements present'}</p>
      </article>`);
  }
  if (lithSum?.top_materials?.length) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Top lithology</span>
        <p class="fine">${esc(lithSum.top_materials.slice(0, 3).join(', '))}</p>
      </article>`);
  }
  if (w.screen_control_count) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Screen control</span>
        <strong>${w.screen_control_count} wells</strong>
        <p class="fine">Screen-bottom intervals used for completion depth</p>
      </article>`);
  }
  if (w.geophysics_available) {
    enrichCards.push(`
      <article class="prox-card">
        <span class="mono">Geophysical logs</span>
        <strong>${w.geophysics_available} wells</strong>
      </article>`);
  }

  return `
    <section class="report-block well-depth-block">
      <h2>Predicted well depth</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Based on <strong>subsurface hydrology</strong> — static water level, screen intervals, and water-bearing
        lithology from nearby AWWI records (with Wet Areas Mapping depth-to-water as a shallow covariate).
        Not the min–max of total drilled depths.
      </p>

      <div class="well-range-card">
        <span class="mono">Recommended aquifer completion</span>
        <div class="well-range-value">
          ${fmt(depth, 'm')}${depthFt != null ? ` <span class="fine" style="font-size:1rem;font-weight:500">(~${esc(depthFt)} ft)</span>` : ''}
        </div>
        <p class="fine">
          Confidence band ${fmt(low, 'm')}–${fmt(high, 'm')}
          ${swl != null ? ` · static water level ~${fmt(swl, 'm')} bgs` : ''}
          · ${esc(w.nearby_well_count ?? 0)} wells within ${fmt(w.nearby_well_search_radius_km, 'km')}
        </p>
        <p class="fine" style="margin-top:0.35rem">${basisLine}</p>
      </div>

      <div class="summary-grid">
        <div class="stat"><span class="k">Completion depth</span><strong>${fmt(depth, 'm')}</strong></div>
        <div class="stat"><span class="k">Depth (ft)</span><strong>${depthFt != null ? esc(depthFt) : '—'}</strong></div>
        <div class="stat"><span class="k">Static water level</span><strong>${fmt(swl, 'm')}</strong></div>
      </div>

      ${wellsMinimap(w, centre)}

      <div class="well-charts">
        ${distChart}
        ${scatterChart}
      </div>

      ${enrichCards.length ? `<div class="prox-grid" style="margin-top:0.85rem">${enrichCards.join('')}</div>` : ''}

      <div class="flag" data-severity="caution" style="margin-top:1rem">
        <strong>Required — consult a licensed driller</strong>
        <p>${esc(
          w.disclaimer ||
            'Hydrology-based estimate only — not a guaranteed drilled depth. Consult a local licensed water-well driller for a site-specific quote before any construction decision.'
        )}</p>
      </div>
    </section>`;
}

function provincialContoursMap(contours, centre) {
  if (!contours || !contours.features?.length) return '';
  const id = 'prov-contours-' + Math.random().toString(36).slice(2, 8);
  const parcel = getParcelLatLngs();
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri', maxZoom: 18,
    }).addTo(map);
    const boundsGroup = [];
    if (parcel?.length >= 3) {
      const poly = L.polygon(parcel, {
        color: '#a8801f',
        fillColor: '#a8801f',
        fillOpacity: 0.12,
        weight: 3,
      }).addTo(map);
      poly.bindPopup('<strong>Your parcel</strong>');
      boundsGroup.push(poly);
    }
    contours.features.forEach((f) => {
      if (f.geometry?.type === 'LineString') {
        const coords = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const isIndex = f.properties?.contour_type === 'index';
        const line = L.polyline(coords, {
          color: isIndex ? '#5b3a73' : 'rgba(91,58,115,0.35)',
          weight: isIndex ? 2 : 1,
          opacity: isIndex ? 0.9 : 0.6,
        }).addTo(map);
        boundsGroup.push(line);
      }
    });
    if (centre?.latitude != null) {
      L.circleMarker([centre.latitude, centre.longitude], {
        radius: 6,
        fillColor: '#a8801f',
        fillOpacity: 1,
        color: '#16211b',
        weight: 2,
      }).addTo(map);
    }
    try {
      if (boundsGroup.length) {
        map.fitBounds(L.featureGroup(boundsGroup).getBounds(), { padding: [15, 15] });
      } else if (centre?.latitude != null) {
        map.setView([centre.latitude, centre.longitude], 14);
      }
    } catch { /* ignore */ }
  }, 150);
  return `
    <section class="report-block">
      <h2>Provincial elevation contours</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Live ArcGIS contour polylines (Alberta Provincial Elevation MapServer).
        Bold lines are index contours (every 5th interval). Gold outline = your parcel.
        The same contours also appear on the unified <strong>Property map</strong>.
      </p>
      <div id="${id}" class="report-map minimap-embed" style="height:280px"></div>
    </section>`;
}

function windRoseSvg(windRose) {
  if (!windRose?.available || !windRose.series?.length) return '';

  const dirs16 = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const W = 340, H = 340, cx = W / 2, cy = H / 2, maxR = 140;

  // Stack the series: each series has data[0..15] for 16 directions
  const nDirs = windRose.series[0]?.data?.length || 16;
  const nSeries = windRose.series.length;

  // Build stacked totals per direction and per (dir, speed-bin)
  const stackedMax = new Array(nDirs).fill(0);
  for (let s = 0; s < nSeries; s++) {
    for (let d = 0; d < nDirs; d++) {
      stackedMax[d] += (windRose.series[s].data?.[d] || 0);
    }
  }
  const globalMax = Math.max(...stackedMax, 1);

  // Colors for speed bins (low→high: calm blue → strong red)
  const binColors = ['#4a90d9','#5ba3e6','#7ec8e3','#a8d8ea','#f6d55c','#f0a500','#e85d04','#c23e2e','#8c1d13'];

  // Draw stacked polar bars
  let barsHtml = '';
  for (let d = 0; d < nDirs; d++) {
    const angleDeg = (360 / nDirs) * d - 90; // N at top
    const angleRad = (angleDeg * Math.PI) / 180;
    const halfSlice = (360 / nDirs / 2) * (Math.PI / 180);

    let cumulative = 0;
    for (let s = nSeries - 1; s >= 0; s--) {
      const val = windRose.series[s].data?.[d] || 0;
      if (val <= 0) continue;
      const innerR = (cumulative / globalMax) * maxR;
      cumulative += val;
      const outerR = (cumulative / globalMax) * maxR;
      const color = binColors[s % binColors.length];

      // Arc segment as a polygon
      const steps = 3;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = angleRad - halfSlice + (2 * halfSlice * i) / steps;
        pts.push(`${(cx + innerR * Math.cos(a)).toFixed(1)},${(cy + innerR * Math.sin(a)).toFixed(1)}`);
      }
      for (let i = steps; i >= 0; i--) {
        const a = angleRad - halfSlice + (2 * halfSlice * i) / steps;
        pts.push(`${(cx + outerR * Math.cos(a)).toFixed(1)},${(cy + outerR * Math.sin(a)).toFixed(1)}`);
      }
      const label = windRose.series[s].name || '';
      barsHtml += `<polygon points="${pts.join(' ')}" fill="${color}" stroke="#fff" stroke-width="0.5" opacity="0.85"><title>${dirs16[d]}: ${val.toFixed(1)}% (${esc(label)})</title></polygon>`;
    }
  }

  // Compass labels + circles
  const rings = [0.25, 0.5, 0.75, 1.0];
  let ringsHtml = rings.map((f) =>
    `<circle cx="${cx}" cy="${cy}" r="${(f * maxR).toFixed(1)}" fill="none" stroke="var(--line)" stroke-width="0.4" stroke-dasharray="2 3"/>`
  ).join('');

  let labelsHtml = dirs16.map((d, i) => {
    const a = ((360 / nDirs) * i - 90) * Math.PI / 180;
    const tx = cx + Math.cos(a) * (maxR + 14);
    const ty = cy + Math.sin(a) * (maxR + 14);
    const isMain = ['N','E','S','W'].includes(d);
    const isPrimary = windRose.primary_direction === d;
    const isSecondary = windRose.secondary_direction === d;
    const fill = isPrimary ? 'var(--berry)' : isSecondary ? '#2a6f97' : 'var(--ink-soft)';
    const weight = isPrimary || isMain ? 'bold' : 'normal';
    return `<text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}" text-anchor="middle" class="svg-label" font-size="${isMain || isPrimary ? '10px' : '7px'}" font-weight="${weight}" fill="${fill}">${d}</text>`;
  }).join('');

  // Scale label
  const scaleLabel = `${globalMax.toFixed(0)}%`;

  // Legend
  const legendItems = windRose.series.map((s, i) => {
    const color = binColors[i % binColors.length];
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.72rem;margin-right:0.5rem"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color}"></span>${esc(s.name || `Bin ${i+1}`)}</span>`;
  }).join('');

  const locLabel = windRose.distance_km != null && windRose.distance_km > 0
    ? `${esc(windRose.station_name)} (${esc(windRose.distance_km)} km away)`
    : esc(windRose.station_name || 'NASA POWER');

  return `
    <div style="margin-top:0.85rem">
      <span class="mono topo-label">Wind rose — ${locLabel}</span>
      <svg class="wind-butterfly" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wind rose from NASA POWER">
        <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="var(--line)" rx="8"/>
        ${ringsHtml}
        ${barsHtml}
        ${labelsHtml}
        <circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink)"/>
        <text x="${(cx + maxR + 4).toFixed(1)}" y="${(cy - maxR + 4).toFixed(1)}" class="svg-label" font-size="8px">${scaleLabel}</text>
      </svg>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.2rem;margin-top:0.35rem">${legendItems}</div>
      <p class="fine" style="margin-top:0.35rem">
        Source: <a href="${esc(windRose.source_url || 'https://power.larc.nasa.gov/')}" target="_blank" rel="noopener">${esc(windRose.source || 'NASA POWER')}</a>
        · ${esc(windRose.start_date)} to ${esc(windRose.end_date)}
        ${windRose.n_obs ? ` · ${esc(windRose.n_obs.toLocaleString?.() || windRose.n_obs)} hourly obs` : ''}
        ${windRose.mean_speed_ms != null ? ` · mean ${esc(windRose.mean_speed_ms)} m/s` : ''}
      </p>
    </div>`;
}

/** Map 16-point compass label to nearest of 8 for simple compass diagram. */
function coarsenWindDir(dir) {
  if (!dir) return 'NW';
  const map = {
    N: 'N', NNE: 'NE', NE: 'NE', ENE: 'E', E: 'E', ESE: 'SE', SE: 'SE', SSE: 'S',
    S: 'S', SSW: 'SW', SW: 'SW', WSW: 'W', W: 'W', WNW: 'NW', NW: 'NW', NNW: 'N',
  };
  return map[String(dir).toUpperCase()] || 'NW';
}

function windSection(climate, r, windRose) {
  const primary =
    windRose?.primary_direction ||
    climate?.prevailing_wind_direction ||
    r?.climate?.prevailing_wind_direction ||
    'NW';
  const secondary = windRose?.secondary_direction || climate?.secondary_wind_direction || null;
  const windDir = coarsenWindDir(primary);
  const secDir = secondary ? coarsenWindDir(secondary) : null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dirIdx = dirs.indexOf(windDir);
  const idx = dirIdx >= 0 ? dirIdx : 7;
  const shelter = windRose?.shelterbelt || null;

  const w = 260, h = 260, cx = w / 2, cy = h / 2, cr = 110;
  const dirAngle = (idx / 8) * 360 - 90;
  const arrowLen = cr * 0.75;
  const arrowRad = (dirAngle * Math.PI) / 180;
  const ax = cx + Math.cos(arrowRad) * arrowLen;
  const ay = cy + Math.sin(arrowRad) * arrowLen;
  const sbAngle = dirAngle + 90;
  const sbRad = (sbAngle * Math.PI) / 180;
  const sbx1 = cx + Math.cos(sbRad) * cr * 0.6;
  const sby1 = cy + Math.sin(sbRad) * cr * 0.6;
  const sbx2 = cx - Math.cos(sbRad) * cr * 0.6;
  const sby2 = cy - Math.sin(sbRad) * cr * 0.6;

  let secArrow = '';
  if (secDir && dirs.includes(secDir)) {
    const sIdx = dirs.indexOf(secDir);
    const sAngle = (sIdx / 8) * 360 - 90;
    const sRad = (sAngle * Math.PI) / 180;
    const sx = cx + Math.cos(sRad) * arrowLen * 0.55;
    const sy = cy + Math.sin(sRad) * arrowLen * 0.55;
    secArrow = `<line x1="${cx}" y1="${cy}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#7ec8e3" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
      <text x="${(cx + Math.cos(sRad) * cr * 0.68).toFixed(1)}" y="${(cy + Math.sin(sRad) * cr * 0.68).toFixed(1)}" class="svg-label" fill="#2a6f97" font-size="7px">2°</text>`;
  }

  const compassSvg = `
    <svg class="wind-butterfly" viewBox="0 0 ${w} ${h}" role="img" aria-label="Wind direction and shelterbelt orientation">
      <rect x="0" y="0" width="${w}" height="${h}" fill="#fff" stroke="var(--line)" rx="8"/>
      <circle cx="${cx}" cy="${cy}" r="${cr}" fill="none" stroke="var(--line)" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="${cr * 0.5}" fill="none" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="2 3"/>
      ${dirs.map((d, i) => {
        const a = ((i / 8) * 360 - 90) * Math.PI / 180;
        const tx = cx + Math.cos(a) * (cr + 12);
        const ty = cy + Math.sin(a) * (cr + 12);
        const isP = d === windDir;
        const isS = d === secDir;
        return `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="central" class="svg-label" font-weight="${isP ? 'bold' : 'normal'}" fill="${isP ? 'var(--berry)' : isS ? '#2a6f97' : 'var(--ink-soft)'}">${esc(d)}</text>`;
      }).join('')}
      ${secArrow}
      <line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="#2a6f97" stroke-width="3" stroke-linecap="round"/>
      <polygon points="${(ax + Math.cos(arrowRad + 2.5) * 14).toFixed(1)} ${(ay + Math.sin(arrowRad + 2.5) * 14).toFixed(1)} ${(ax + Math.cos(arrowRad - 2.5) * 14).toFixed(1)} ${(ay + Math.sin(arrowRad - 2.5) * 14).toFixed(1)} ${ax.toFixed(1)} ${ay.toFixed(1)}" fill="#2a6f97"/>
      <line x1="${sbx1.toFixed(1)}" y1="${sby1.toFixed(1)}" x2="${sbx2.toFixed(1)}" y2="${sby2.toFixed(1)}" stroke="var(--ok)" stroke-width="3" stroke-dasharray="6 3" stroke-linecap="round"/>
      <text x="${(cx + Math.cos(sbRad) * cr * 0.72).toFixed(1)}" y="${(cy + Math.sin(sbRad) * cr * 0.72).toFixed(1)}" class="svg-label" fill="var(--ok)" font-size="8px">shelterbelt</text>
    </svg>`;

  const roseHtml = windRoseSvg(windRose);
  const primaryPct = windRose?.primary_frequency_pct != null ? ` (${windRose.primary_frequency_pct}%)` : '';
  const secondaryPct = windRose?.secondary_frequency_pct != null ? ` (${windRose.secondary_frequency_pct}%)` : '';
  const axisLabel = shelter?.primary_axis || `${dirs[(idx + 2) % 8]}–${dirs[(idx + 6) % 8]}`;

  return `
    <section class="report-block wind-section">
      <h2>Wind & shelterbelt</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Primary wind: <strong>${esc(primary)}</strong>${esc(primaryPct)}
        ${secondary ? ` · Secondary: <strong>${esc(secondary)}</strong>${esc(secondaryPct)}` : ''}.
        ${windRose?.available ? 'From <strong>NASA POWER</strong> hourly 10&nbsp;m wind.' : ''}
        Blue arrow = primary · light arrow = secondary · green dashed = main shelterbelt axis.
      </p>
      <div class="split-2col">
        <div>${compassSvg}</div>
        <div>
          <div class="well-range-card" style="border-left-color:#2a6f97;margin-bottom:0.5rem">
            <span class="mono">Shelterbelt envelope</span>
            <p class="fine" style="margin:0.3rem 0 0">
              ${shelter?.note
                ? esc(shelter.note)
                : `Orient the main belt along <strong>${esc(axisLabel)}</strong> (perpendicular to ${esc(primary)}).`}
            </p>
            ${shelter?.secondary_axis ? `
              <p class="fine" style="margin:0.35rem 0 0">
                Secondary axis: <strong>${esc(shelter.secondary_axis)}</strong>
                ${shelter.multi_directional ? ' · multi-directional site — consider L/U layout' : ''}
              </p>
            ` : ''}
          </div>
          <div class="summary-grid" style="margin-bottom:0.5rem">
            <div class="stat"><span class="k">Primary</span><strong>${esc(primary)}${primaryPct ? esc(primaryPct) : ''}</strong></div>
            <div class="stat"><span class="k">Secondary</span><strong>${secondary ? `${esc(secondary)}${secondaryPct ? esc(secondaryPct) : ''}` : '—'}</strong></div>
            <div class="stat"><span class="k">Mean speed</span><strong>${windRose?.mean_speed_ms != null ? `${esc(windRose.mean_speed_ms)} m/s` : '—'}</strong></div>
            <div class="stat"><span class="k">Belt axis</span><strong>${esc(axisLabel)}</strong></div>
          </div>
          <p class="fine">
            A shelterbelt reduces wind speed 50–80% for a downwind distance of 5–10× its height (H).
            For a 10&nbsp;m tall poplar belt, the protected zone extends 50–100&nbsp;m leeward.
            Alberta prairie multi-row pattern (windward → leeward):
            conifer (Colorado or white spruce, lodgepole pine) →
            deciduous backbone (hybrid/balsam poplar, green ash, Manitoba maple, resistant elm) →
            shrub hedge (caragana, lilac, saskatoon, chokecherry).
          </p>
          <p class="fine" style="margin-top:0.5rem">
            <strong>Recommendation:</strong> ${
              climate?.chinook_exposure
                ? 'Chinook-prone area — dense multi-row belt with spruce on the windward side for year-round snow and wind control.'
                : 'Use the Alberta prairie palette above; diversify deciduous rows so one pest (e.g. emerald ash borer) cannot clear the belt.'
            }
          </p>
          <p class="fine" style="margin-top:0.5rem">
            Expected functions: improved microclimate and wind protection; lower wind-driven soil loss and evapotranspiration; better moisture retention; seasonal shade; and added wildlife habitat. These are directional design benefits, not parcel-measured guarantees.
          </p>
        </div>
      </div>
      ${roseHtml}
      ${!windRose?.available && windRose?.error ? `
        <p class="fine" style="margin-top:0.5rem;color:var(--caution)">Wind rose unavailable: ${esc(windRose.error)}</p>
      ` : ''}
    </section>`;
}

function biodiversitySection(bio) {
  if (!bio) return '';
  const inner = bio.inner || {};
  const outer = bio.outer || {};
  const richness = bio.species_richness;
  const richnessLabels = { all_species: 'All species', birds: 'Birds', mammals: 'Mammals' };
  const richnessRows = Object.entries(richness?.layers || {})
    .map(([key, value]) => `
      <div class="stat"><span class="k">${esc(richnessLabels[key] || key)}</span><strong>${esc(value.value)}</strong></div>`)
    .join('');
  const richnessBlock = richnessRows
    ? `<div class="flag" data-severity="info" style="margin-top:0.85rem">
        <strong>Regional species-richness screening</strong>
        <p>Supplied Alberta richness surfaces intersecting this site. These are regional model values, not a property-specific species inventory or an iNaturalist observation count.</p>
        <div class="summary-grid">${richnessRows}</div>
        <p class="fine" style="margin-bottom:0">Source: supplied Alberta species-richness geodatabases · link ${esc(Object.values(richness.layers)[0]?.link_id || '—')}</p>
      </div>`
    : '';

  if (!bio.available) {
    return richnessRows ? `<section class="report-block"><h2>Biodiversity assessment</h2>${richnessBlock}</section>` : '';
  }
  
  const speciesList = (inner.top_species || []).map(s => `
    <div class="stat">
      <span class="k">${esc(s.common || s.name)}</span>
      <strong>${s.count} obs</strong>
    </div>
  `).join('');

  const discoveries = (bio.discoveries || []).map(s => `
    <div class="stat" style="border-top-color:var(--berry-lo)">
      <span class="k">${esc(s.common || s.name)}</span>
      <strong>Nearby fit</strong>
    </div>
  `).join('');

  return `
    <section class="report-block">
      <h2>Biodiversity — iNaturalist</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Analysis of observations within ${bio.metadata?.inner_radius_km}km (local) and ${bio.metadata?.outer_radius_km}km (landscape).
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Local richness</span><strong>${inner.unique_species_count} species</strong></div>
        <div class="stat"><span class="k">Landscape richness</span><strong>${outer.unique_species_count} species</strong></div>
        <div class="stat"><span class="k">Threatened (vicinity)</span><strong>${inner.threatened_count}</strong></div>
      </div>

      <span class="mono topo-label">Most observed locally</span>
      <div class="summary-grid" style="margin-top:0.5rem">${speciesList}</div>

      <span class="mono topo-label">Nearby potential (observed 3km, not yet local)</span>
      <div class="summary-grid" style="margin-top:0.5rem">${discoveries}</div>
      ${richnessBlock}
    </section>`;
}

function soilSurveySection(ss) {
  // Always show recommended lab tests; show inventory block when available
  const labHtml = recommendedSoilTestsSection(ss?.recommended_lab_tests);
  if (!ss || !ss.available) {
    if (ss?.error && !labHtml) {
      return `
        <section class="report-block">
          <h2>Soil survey &amp; tests</h2>
          <p class="fine">Soil inventory unavailable: ${esc(ss.error)}</p>
        </section>`;
    }
    return labHtml || '';
  }

  const ls = ss.land_system;
  const ag = ss.agrasid;
  const zoneInfo = ss.soil_zone_info;
  const orderInfo = ss.soil_order_info;
  const chars = ss.characteristics || {};
  const sum = ss.sample_summary || {};

  const zoneColor = {
    'Brown': '#c9a35b',
    'Dark Brown': '#8b6914',
    'Black': '#2d2d2d',
    'Dark Gray': '#5a5a5a',
    'Gray': '#888888',
  }[ls?.soil_zone] || '#7a6b5a';

  const qualityColor = {
    excellent: 'var(--ok)',
    good: 'var(--ok)',
    moderate: 'var(--gold)',
    poor: 'var(--danger)',
    variable: 'var(--caution)',
    unknown: 'var(--ink-soft)',
  }[orderInfo?.quality] || 'var(--ink-soft)';

  const charsRows = Object.entries(chars)
    .filter(([_, v]) => v != null)
    .map(([k, v]) => `<tr><td class="mono">${esc(k.replace(/_/g, ' '))}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join('');

  const zoneNotes = (zoneInfo?.permaculture_notes || [])
    .map(n => `<li>${esc(n)}</li>`)
    .join('');

  return `
    <section class="report-block">
      <h2>Soil survey &amp; sample tests</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Alberta Agriculture soil inventory plus mapped SoilGrids sample points (texture, pH, SOC screening).
        ${ls?.land_system_name ? `Land system: <strong>${esc(ls.land_system_name)}</strong>` : ''}
        ${ls?.soil_zone ? ` · Soil zone: <strong style="color:${zoneColor}">${esc(ls.soil_zone)}</strong>` : ''}
        ${ls?.ag_climate_zone ? ` · Ag climate: ${esc(ls.ag_climate_zone)}` : ''}
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Land system</span><strong>${esc(ls?.land_system_symbol || '—')}</strong></div>
        <div class="stat"><span class="k">Soil zone</span><strong style="color:${zoneColor}">${esc(ls?.soil_zone || '—')}</strong></div>
        <div class="stat"><span class="k">Soil order</span><strong style="color:${qualityColor}">${esc(ls?.soil_order_primary || '—')}</strong></div>
        <div class="stat"><span class="k">Texture (model)</span><strong>${esc(chars.texture_class || sum.texture_class || '—')}</strong></div>
        <div class="stat"><span class="k">pH (model)</span><strong>${chars.ph_h2o_mean != null ? esc(chars.ph_h2o_mean) : sum.mean_ph != null ? esc(sum.mean_ph) : '—'}</strong></div>
        <div class="stat"><span class="k">SOC model</span><strong>${chars.soc_g_kg_regional_mean != null ? `${esc(chars.soc_g_kg_regional_mean)} g/kg` : sum.mean_soc_g_kg != null ? `${esc(sum.mean_soc_g_kg)} g/kg` : '—'}</strong></div>
        <div class="stat"><span class="k">Surface forms</span><strong>${esc((ls?.surface_forms || []).join(', ') || '—')}</strong></div>
        <div class="stat"><span class="k">Major components</span><strong>${esc((ls?.major_components || []).join(', ') || '—')}</strong></div>
        <div class="stat"><span class="k">Sample points</span><strong>${esc(ss.soil_samples?.length || 0)}</strong></div>
      </div>

      ${ag ? `
        <div class="well-range-card" style="border-left-color:${zoneColor};margin-top:0.75rem">
          <span class="mono">AGRASID polygon</span>
          <div class="well-range-value" style="font-size:clamp(1rem, 2vw, 1.3rem)">
            ${esc(ag.municipality || '—')}
          </div>
          <p class="fine">
            SLC unit: ${esc(ag.slc_unit || '—')}
            ${ag.land_capability_code ? ` · Land capability: ${esc(ag.land_capability_code)}${ag.land_capability_modifier || ''}` : ''}
          </p>
        </div>
      ` : ''}

      ${orderInfo ? `
        <div class="flag" data-severity="${orderInfo.quality === 'excellent' || orderInfo.quality === 'good' ? 'info' : orderInfo.quality === 'poor' ? 'caution' : 'info'}" style="margin-top:0.75rem">
          <strong>Soil quality: ${esc(orderInfo.quality)}</strong>
          <p>${esc(orderInfo.note)}</p>
        </div>
      ` : ''}

      ${zoneInfo ? `
        <div style="margin-top:0.75rem">
          <span class="mono topo-label">Soil zone characteristics — ${esc(zoneInfo.name)}</span>
          <div class="summary-grid" style="margin-top:0.4rem">
            <div class="stat"><span class="k">Precipitation</span><strong>${esc(zoneInfo.precipitation_range_mm || '—')} mm</strong></div>
            <div class="stat"><span class="k">Typical texture</span><strong>${esc(zoneInfo.typical_texture || '—')}</strong></div>
            <div class="stat"><span class="k">Organic matter</span><strong>${esc(zoneInfo.organic_matter_level || '—')}</strong></div>
            <div class="stat"><span class="k">Growing season</span><strong>${esc(zoneInfo.growing_season || '—')}</strong></div>
          </div>
          ${zoneNotes ? `<ul class="wildlife-recs" style="margin:0.5rem 0 0;padding-left:1.2rem;font-size:0.92rem;color:var(--ink-soft);line-height:1.6">${zoneNotes}</ul>` : ''}
        </div>
      ` : ''}

      ${charsRows ? `
        <div class="econ-table-wrap" style="margin-top:0.75rem">
          <table class="econ-table">
            <thead><tr><th>Property</th><th>Mapped / inferred value</th></tr></thead>
            <tbody>${charsRows}</tbody>
          </table>
        </div>
      ` : ''}

      ${soilSamplesMapBlock(ss)}

      <p class="fine" style="margin-top:0.6rem">
        Source: <a href="${esc(ss.source_url)}" target="_blank" rel="noopener">${esc(ss.source || ss.source_url)}</a>
        · ${ss.soil_samples?.length ? `${esc(ss.soil_samples.length)} SoilGrids sample points · ` : ''}
        <strong>Not laboratory values</strong> — screening only. Open Government Licence — Alberta / ISRIC
      </p>
    </section>
    ${labHtml}`;
}

/**
 * Recommended laboratory / field soil tests (restored EE soil-testing toolbox).
 */
function recommendedSoilTestsSection(lab) {
  if (!lab?.available && !lab?.tests?.length) return '';
  const tests = lab.tests || [];
  const cards = tests
    .map(
      (t) => `
      <article class="prox-card" style="border-left:3px solid ${t.priority === 1 ? 'var(--ok)' : 'var(--line)'}">
        <span class="mono">${t.priority === 1 ? 'Priority' : 'Optional'} · ${esc(t.method || 'Lab / field')}</span>
        <strong>${esc(t.name)}</strong>
        <p class="fine" style="margin:0.35rem 0 0">${esc(t.why || '')}</p>
        ${
          t.measures?.length
            ? `<p class="fine" style="margin:0.3rem 0 0"><strong>Measures:</strong> ${t.measures.map(esc).join(' · ')}</p>`
            : ''
        }
      </article>`
    )
    .join('');

  return `
    <section class="report-block">
      <h2>${esc(lab.title || 'Recommended soil tests')}</h2>
      <p class="fine" style="margin-top:-0.35rem">
        ${esc(
          lab.intro ||
            'Laboratory and field tests that complete the remote soil map — high-confidence baseline for plantings, earthworks, and soil-carbon claims.'
        )}
      </p>
      ${
        lab.sample_protocol
          ? `<div class="flag" data-severity="info" style="margin:0.65rem 0">
        <strong>How to sample</strong>
        <p>${esc(lab.sample_protocol)}</p>
      </div>`
          : ''
      }
      <div class="prox-grid" style="margin-top:0.65rem">${cards}</div>
      ${
        lab.labs_note
          ? `<p class="fine" style="margin-top:0.65rem">${esc(lab.labs_note)}</p>`
          : ''
      }
    </section>`;
}

/**
 * Map soil sample points (SoilGrids) coloured by texture / SOC.
 */
function soilSamplesMapBlock(ss) {
  const samples = ss?.soil_samples || [];
  if (!samples.length) return '';
  const sum = ss.sample_summary || {};
  const id = 'soil-samples-' + Math.random().toString(36).slice(2, 8);

  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el || typeof L === 'undefined') return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri', maxZoom: 18,
    }).addTo(map);

    const socVals = samples.map((s) => s.soc_g_kg).filter((v) => v != null);
    const socMin = socVals.length ? Math.min(...socVals) : 0;
    const socMax = socVals.length ? Math.max(...socVals) : 1;
    const colorFor = (soc) => {
      if (soc == null) return '#888';
      const t = socMax > socMin ? (soc - socMin) / (socMax - socMin) : 0.5;
      // brown (low C) → dark green (higher C)
      const r = Math.round(139 + (34 - 139) * t);
      const g = Math.round(90 + (120 - 90) * t);
      const b = Math.round(43 + (40 - 43) * t);
      return `rgb(${r},${g},${b})`;
    };

    const bounds = [];
    samples.forEach((s) => {
      if (s.lat == null || s.lng == null) return;
      bounds.push([s.lat, s.lng]);
      const color = colorFor(s.soc_g_kg);
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 9,
        color: '#fff',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.9,
      }).addTo(map);
      m.bindPopup(
        `<strong>${esc(s.role || s.id || 'sample')}</strong><br>` +
        `Texture: ${esc(s.texture_class || '—')}<br>` +
        `Clay/Sand/Silt: ${fmt(s.clay_pct)} / ${fmt(s.sand_pct)} / ${fmt(s.silt_pct)} %<br>` +
        `pH: ${fmt(s.ph_h2o)} · SOC: ${fmt(s.soc_g_kg)} g/kg<br>` +
        `<span class="fine">SoilGrids ~250 m · screening only</span>`
      );
    });
    if (bounds.length) {
      try { map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 }); } catch { /* ignore */ }
    }
  }, 140);

  const sampleRows = samples.slice(0, 12).map((s) => `
    <tr>
      <td class="mono">${esc(s.role || s.id)}</td>
      <td>${esc(s.texture_class || '—')}</td>
      <td>${fmt(s.clay_pct)}</td>
      <td>${fmt(s.sand_pct)}</td>
      <td>${fmt(s.ph_h2o)}</td>
      <td>${fmt(s.soc_g_kg)}</td>
    </tr>`).join('');

  return `
    <div style="margin-top:1rem">
      <span class="mono topo-label">Mapped soil samples — characteristics grid</span>
      <p class="fine" style="margin:0.25rem 0 0.4rem">
        ${esc(sum.n_samples || samples.length)} SoilGrids points across the parcel
        ${sum.texture_class ? ` · modal texture <strong>${esc(sum.texture_class)}</strong>` : ''}
        ${sum.mean_soc_g_kg != null ? ` · mean SOC ~${esc(sum.mean_soc_g_kg)} g/kg` : ''}
        ${sum.mean_ph != null ? ` · mean pH ${esc(sum.mean_ph)}` : ''}.
        Markers coloured by relative SOC (brown → green). <strong>Not lab values</strong> — regional model (~250&nbsp;m).
      </p>
      <div id="${id}" class="report-map minimap-embed" style="height:280px;margin-top:0.35rem"></div>
      <div class="econ-table-wrap" style="margin-top:0.65rem">
        <table class="econ-table">
          <thead><tr><th>Point</th><th>Texture</th><th>Clay %</th><th>Sand %</th><th>pH</th><th>SOC g/kg</th></tr></thead>
          <tbody>${sampleRows}</tbody>
        </table>
      </div>
      ${ss.sample_note ? `<p class="fine" style="margin-top:0.4rem">${esc(ss.sample_note)}</p>` : ''}
    </div>`;
}

/**
 * Small water / seeps detection (S2 NDWI-MNDWI + S1 + TWI + inventory).
 * Strict confidence language — never regulatory wetlands.
 */
/**
 * Water Collection Budget — full water budget (roof + swale + pond).
 */
function waterCollectionSection(wc) {
  if (!wc || !wc.available) return '';
  const roofScenarios = wc.roof_scenarios || [];
  const swaleCapture = wc.swale_capture || {};
  const pondStorage = wc.pond_storage || {};
  const pondHydrology = wc.pond_hydrology || {};
  const monthlyBudget = wc.monthly_budget || {};
  const primaryRoof = roofScenarios.find(s => s.id === 'house_barn') || roofScenarios[0];
  const monthEntries = Object.entries(monthlyBudget);
  const maxL = monthEntries.reduce((m, [, v]) => {
    const n = Number(v?.total_litres);
    return Number.isFinite(n) && n > m ? n : m;
  }, 1);
  const monthBars = monthEntries.map(([m, v]) => {
    const pct = Math.round((v.total_litres / maxL) * 100);
    const roofPct = Math.round((v.roof_litres / maxL) * 100);
    const swalePct = Math.round((v.swale_litres / maxL) * 100);
    return `<div class="precip-month" title="${m}: ${v.total_litres.toLocaleString()} L total (${v.precip_mm} mm rain)">
      <span class="precip-bar" style="height:${Math.max(4, pct)}%;background:linear-gradient(to top, var(--ok) ${swalePct}%, #2a6f97 ${swalePct}%, #2a6f97 ${swalePct + roofPct}%)"></span>
      <span class="precip-label mono">${m}</span>
    </div>`;
  }).join('');
  const dryMonths = (wc.dry_months || []).join(', ');
  const wetMonths = (wc.wet_months || []).join(', ');
  const roofCards = roofScenarios.map(sc => `
    <div class="stat">
      <span class="k">${esc(sc.label)}</span>
      <strong>${(sc.annual_litres / 1000).toFixed(1)} m³</strong>
      <span class="fine">${sc.annual_litres.toLocaleString()} L · ${sc.annual_ibc_totes} IBC totes · tank ≥${(sc.recommended_tank_litres / 1000).toFixed(0)} m³</span>
    </div>`).join('');
  const pondPlacement = pondHydrology.placement || {};
  const pondMapId = pondPlacement.available ? `pond-placement-${Math.random().toString(36).slice(2, 8)}` : null;
  if (pondMapId) scheduleLeafletWhenVisible(pondMapId, () => initPondHydrologyMap(pondMapId, pondPlacement));
  const pondTierRows = (pondHydrology.tiers || []).map((tier) => `
    <tr>
      <td><strong>${esc(tier.label)}</strong><br><span class="fine">${esc(tier.capacity_m3)} m³ capacity · ~${esc(tier.surface_area_m2)} m² surface</span></td>
      <td>${esc((tier.annual_captured_litres / 1000).toFixed(1))} m³<br><span class="fine">${esc((tier.annual_gross_runoff_litres / 1000).toFixed(1))} m³ gross</span></td>
      <td>${esc((tier.monthly?.Jun?.captured_litres / 1000 || 0).toFixed(1))} m³<br><span class="fine">June example</span></td>
      <td>${esc((tier.per_rain_event?.Jun?.captured_litres || 0).toLocaleString())} L<br><span class="fine">per event</span></td>
    </tr>`).join('');
  const pondMonthlyRows = (pondHydrology.tiers?.[1]?.monthly ? Object.entries(pondHydrology.tiers[1].monthly) : []).map(([month, row]) => `
    <tr><td>${esc(month)}</td><td>${esc(row.precipitation_mm.toFixed(1))} mm</td><td>${esc(row.rain_events)}</td><td>${esc((row.gross_runoff_litres / 1000).toFixed(1))} m³</td><td>${esc((row.captured_litres / 1000).toFixed(1))} m³</td></tr>`).join('');
  const pondEventRows = (pondHydrology.tiers || []).map((tier) => `
    <tr><td>${esc(tier.label)}</td>${Object.values(tier.per_rain_event || {}).slice(0, 12).map((row) => `<td>${esc(row.captured_litres.toLocaleString())}</td>`).join('')}</tr>`).join('');
  const pondHydrologyBlock = pondHydrology.available ? `
    <div class="well-range-card" style="border-left-color:#1a9bb5;margin-top:0.85rem">
      <span class="mono">Pond hydrology model · optimal accumulation location</span>
      <div class="well-range-value" style="font-size:clamp(1.1rem,2.5vw,1.5rem);color:#1a788d">
        ${esc(pondPlacement.latitude)}, ${esc(pondPlacement.longitude)}
      </div>
      <p class="fine">DEM elevation ${esc(pondPlacement.elevation_m)} m · ${esc(pondPlacement.catchment_area_m2.toLocaleString())} m² screened catchment · ${esc(pondPlacement.confidence)} placement confidence</p>
      ${pondMapId ? `<div id="${pondMapId}" class="report-map" style="height:220px;margin-top:0.55rem" role="img" aria-label="Screened optimal pond placement"></div>` : ''}
      <p class="fine" style="margin-top:0.45rem">Placement uses the lowest/convergent interior DEM cell, not a surveyed drainage basin. Confirm the location against wetlands, soils, property setbacks, spillway grade, and flood regulations.</p>
    </div>
    <div style="margin-top:0.8rem">
      <span class="mono topo-label">Pond capture scenarios</span>
      <div class="econ-table-wrap" style="margin-top:0.4rem;overflow-x:auto">
        <table class="econ-table"><thead><tr><th>Size</th><th>Annual captured</th><th>Monthly captured</th><th>Per rain event</th></tr></thead><tbody>${pondTierRows}</tbody></table>
      </div>
      <p class="fine" style="margin-top:0.35rem">The monthly column shows June; the full month-by-month table is below. Three representative rain events per month are assumed.</p>
    </div>
    <details class="inner-details" style="margin-top:0.65rem">
      <summary>Monthly pond water balance · medium pond</summary>
      <div class="econ-table-wrap" style="margin-top:0.5rem;overflow-x:auto"><table class="econ-table"><thead><tr><th>Month</th><th>Rain</th><th>Events</th><th>Gross runoff</th><th>Captured</th></tr></thead><tbody>${pondMonthlyRows}</tbody></table></div>
    </details>
    <details class="inner-details" style="margin-top:0.5rem">
      <summary>Captured litres per rain event · all pond sizes</summary>
      <div class="econ-table-wrap" style="margin-top:0.5rem;overflow-x:auto"><table class="econ-table"><thead><tr><th>Size</th><th>Jan</th><th>Feb</th><th>Mar</th><th>Apr</th><th>May</th><th>Jun</th><th>Jul</th><th>Aug</th><th>Sep</th><th>Oct</th><th>Nov</th><th>Dec</th></tr></thead><tbody>${pondEventRows}</tbody></table></div>
    </details>
    <p class="fine" style="margin-top:0.55rem">${(pondHydrology.assumptions || []).map(esc).join(' ')}</p>
  ` : '';
  return `
    <section class="report-block water-collection-block">
      <h2>Water collection budget</h2>
      <p class="fine" style="margin-top:-0.3rem">
        Full water budget combining roof catchment, swale capture, and pond storage.
        Based on NASA POWER precipitation × parcel geometry × standard catchment coefficients.
      </p>
      <div class="well-range-card" style="border-left-color:#2a6f97;margin-top:0.65rem">
        <span class="mono">Total annual collection (house+barn + earthworks)</span>
        <div class="well-range-value" style="font-size:clamp(1.3rem,3vw,1.8rem);color:#2a6f97">
          ${(wc.total_annual_m3).toLocaleString()} m³
          <span style="font-size:0.8rem;color:var(--ink-soft);margin-left:0.5rem">(${wc.total_annual_litres.toLocaleString()} L · ${wc.total_annual_gallons.toLocaleString()} gal)</span>
        </div>
        <p class="fine">Annual precip: ${wc.annual_precipitation_mm} mm · Parcel: ${wc.parcel_area_m2.toLocaleString()} m² · Runoff coeff: ${wc.runoff_coefficient} · Tank: ${(wc.recommended_tank_litres / 1000).toFixed(0)} m³</p>
      </div>
      <div class="summary-grid" style="margin-top:0.65rem">
        <div class="stat"><span class="k">Roof catchment</span><strong>${primaryRoof ? (primaryRoof.annual_litres / 1000).toFixed(1) + ' m³' : '—'}</strong><span class="fine">${primaryRoof ? primaryRoof.label : ''} · 85% eff.</span></div>
        <div class="stat"><span class="k">Swale capture</span><strong>${swaleCapture.recommended ? (swaleCapture.annual_litres / 1000).toFixed(1) + ' m³' : 'N/A'}</strong><span class="fine">${swaleCapture.recommended ? swaleCapture.swale_meters + ' m swale' : swaleCapture.note || 'No swales'}</span></div>
        <div class="stat"><span class="k">Pond storage</span><strong>${pondStorage.recommended ? pondStorage.estimated_volume_m3 + ' m³' : 'N/A'}</strong><span class="fine">${pondStorage.recommended ? pondStorage.note : pondStorage.note || 'No ponds'}</span></div>
        <div class="stat"><span class="k">Driest months</span><strong>${dryMonths || '—'}</strong></div>
        <div class="stat"><span class="k">Wettest months</span><strong>${wetMonths || '—'}</strong></div>
      </div>
      ${swaleCapture.recommended ? `<p class="fine" style="margin-top:0.45rem"><strong>Swale water balance:</strong> ~${(swaleCapture.annual_litres / 1000).toFixed(1)} m³ intercepted, ~${(swaleCapture.annual_infiltration_m3 || 0).toFixed(1)} m³ estimated to infiltrate, and ~${(swaleCapture.annual_overflow_m3 || 0).toFixed(1)} m³ remaining as overflow/runoff. ${esc(swaleCapture.infiltration_basis || '')}</p>` : ''}
      <span class="mono topo-label" style="margin-top:0.85rem;display:block">Monthly collection (house+barn + swales)</span>
      <div class="precip-chart" style="margin-top:0.45rem" aria-label="Monthly water collection">${monthBars}</div>
      <p class="fine" style="margin-top:0.3rem"><span style="display:inline-block;width:10px;height:10px;background:var(--ok);vertical-align:middle;margin-right:3px"></span> Swale · <span style="display:inline-block;width:10px;height:10px;background:#2a6f97;vertical-align:middle;margin-right:3px"></span> Roof</p>
      ${pondHydrologyBlock}
      <details class="inner-details" style="margin-top:0.85rem">
        <summary>Roof catchment scenarios</summary>
        <div class="summary-grid" style="margin-top:0.5rem">${roofCards}</div>
        <p class="fine" style="margin-top:0.35rem">85% collection efficiency. Tank sized for 3-month dry-season buffer.</p>
      </details>
      <p class="fine" style="margin-top:0.65rem">${esc(wc.disclaimer || '')}</p>
    </section>`;
}

function initPondHydrologyMap(id, placement) {
  const el = document.getElementById(id);
  const report = state.report || {};
  if (!el || typeof L === 'undefined' || placement?.latitude == null || placement?.longitude == null) return;
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([placement.latitude, placement.longitude], 15);
  el._eeLeafletMap = map;
  el.dataset.leafletReady = '1';
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', maxZoom: 18 }).addTo(map);
  L.marker([placement.latitude, placement.longitude]).addTo(map).bindPopup('<strong>Screened pond location</strong><br>Lowest/convergent DEM candidate').openPopup();
  const ring = report.geometry?.coordinates?.[0];
  if (Array.isArray(ring) && ring.length > 3) {
    const parcel = L.polygon(ring.map(([lng, lat]) => [lat, lng]), { color: '#e8c547', weight: 2, fill: false }).addTo(map);
    map.fitBounds(parcel.getBounds(), { padding: [18, 18], maxZoom: 16 });
  }
}

function mineralsSection(m) {
  if (!m || !m.available) return '';
  const occ = m.all_occurrences || [];
  const topComm = m.top_commodities || [];
  const bedrock = m.bedrock_context || {};
  const metallic = m.metallic || [];
  const industrial = m.industrial || [];
  const prospective = m.prospective_areas || [];
  const centre = state.report?.location
    ? { latitude: state.report.location.latitude, longitude: state.report.location.longitude }
    : null;

  // Map placeholder — init after DOM insert
  const mapId = 'minerals-map-' + Math.random().toString(36).slice(2, 8);
  if (occ.length && centre) {
    setTimeout(() => initMineralsMap(mapId, occ, centre), 140);
  }

  const occRows = occ.slice(0, 10).map((o) => `
    <tr>
      <td>${esc(o.name || '—')}</td>
      <td class="fine">${esc(o.commodity || '—')}</td>
      <td class="fine">${esc(o.geo_age || '—')}</td>
      <td class="fine">${esc(o.geo_unit || '—')}</td>
      <td class="fine">${o.distance_m != null ? fmtDistance(o.distance_m) : '—'}</td>
    </tr>
  `).join('');

  const commChips = topComm.map((c) =>
    `<span class="chip">${esc(c.name)} <span class="chip-count">${c.count}</span></span>`
  ).join('');

  return `
    <section class="report-block minerals-block">
      <h2>Geology & minerals</h2>
      <p class="fine" style="margin-top:-0.3rem">
        Alberta Geological Survey mineral occurrence inventory and bedrock geology context for the surrounding area.
      </p>

      ${bedrock.dominant_age || bedrock.dominant_unit ? `
      <div class="metric-row" style="margin-bottom:0.6rem">
        ${bedrock.dominant_age ? `<span class="metric"><span class="metric-label">Dominant age</span><span class="metric-value">${esc(bedrock.dominant_age)}</span></span>` : ''}
        ${bedrock.dominant_unit ? `<span class="metric"><span class="metric-label">Dominant geology</span><span class="metric-value">${esc(bedrock.dominant_unit)}</span></span>` : ''}
        ${bedrock.dominant_region ? `<span class="metric"><span class="metric-label">Region</span><span class="metric-value">${esc(bedrock.dominant_region)}</span></span>` : ''}
      </div>
      ` : ''}

      ${topComm.length ? `
      <div style="margin-bottom:0.5rem">
        <span class="fine" style="margin-right:0.35rem">Commodities:</span>
        ${commChips}
      </div>
      ` : ''}

      ${occ.length ? `
      <details class="inner-details">
        <summary>Nearby mineral occurrences (${m.unique_count || occ.length})</summary>
        <div class="econ-table-wrap">
          <table class="econ-table">
            <thead>
              <tr><th>Name</th><th>Commodity</th><th>Age</th><th>Unit</th><th>Distance</th></tr>
            </thead>
            <tbody>${occRows}</tbody>
          </table>
        </div>
      </details>
      ` : ''}

      ${metallic.length ? `
      <details class="inner-details">
        <summary>Metallic mineral occurrences (${metallic.length})</summary>
        <div class="fine">
          <ul>${metallic.slice(0, 8).map((o) => `
            <li><strong>${esc(o.name || 'Unknown')}</strong> — ${esc(o.commodity || '—')}
            ${o.deposit_type ? ` · ${esc(o.deposit_type)}` : ''}
            ${o.ore_minerals ? ` · Ore: ${esc(o.ore_minerals)}` : ''}
            ${o.geo_age ? ` · ${esc(o.geo_age)}` : ''}</li>
          `).join('')}</ul>
        </div>
      </details>
      ` : ''}

      ${industrial.length ? `
      <details class="inner-details">
        <summary>Industrial minerals (${industrial.length})</summary>
        <div class="fine">
          <ul>${industrial.slice(0, 8).map((o) => `
            <li><strong>${esc(o.name || 'Unknown')}</strong> — ${esc(o.commodity || '—')}${o.geo_age ? ` · ${esc(o.geo_age)}` : ''}</li>
          `).join('')}</ul>
        </div>
      </details>
      ` : ''}

      ${prospective.length ? `
      <details class="inner-details">
        <summary>Prospective exploration areas (${prospective.length})</summary>
        <div class="fine">
          <ul>${prospective.map((p) => `
            <li><strong>${esc(p.name || 'Unknown')}</strong>${p.commodity ? ` — ${esc(p.commodity)}` : ''}${p.geo_age ? ` · ${esc(p.geo_age)}` : ''}</li>
          `).join('')}</ul>
        </div>
      </details>
      ` : ''}

      <p class="fine" style="margin-top:0.5rem">
        Source: ${esc(m.source || 'AER')} · ${m.search_radius_km || 15} km search radius.
        ${m.source_urls?.length ? ` · <a href="${esc(m.source_urls[0])}" target="_blank" rel="noopener">DIG 2025-0009</a>` : ''}
      </p>
      <p class="fine">${esc(m.disclaimer || '')}</p>
    </section>
  `;
}

function initMineralsMap(elId, occurrences, centre) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined' || !occurrences?.length) return;
  destroyLeafletOn(el);
  el.innerHTML = '';
  const map = L.map(el, { zoomControl: true, attributionControl: true });
  el._eeLeafletMap = map;
  el.dataset.leafletReady = '1';

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri · AER Mineral Occurrences',
    maxZoom: 18,
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    opacity: 0.5, maxZoom: 18,
  }).addTo(map);

  const boundsGroup = [];

  // Parcel outline
  const parcel = getParcelLatLngs();
  if (parcel?.length >= 3) {
    const poly = L.polygon(parcel, {
      color: '#a8801f', fillColor: '#a8801f', fillOpacity: 0.12, weight: 3,
    }).addTo(map);
    poly.bindPopup('<strong>Your parcel</strong>');
    boundsGroup.push(poly);
  }

  // Site centre
  L.circleMarker([centre.latitude, centre.longitude], {
    radius: 8, color: '#fff', weight: 2, fillColor: '#5b3a73', fillOpacity: 1,
  }).addTo(map).bindTooltip('Site centre');

  // Mineral occurrences
  const commColors = {};
  let colorIdx = 0;
  const palette = ['#e9c46a', '#2a6f97', '#c23e2e', '#2f6f4e', '#8c5a1d', '#5b3a73', '#c45c26', '#3d9dc9'];

  occurrences.forEach((o) => {
    if (o.latitude == null || o.longitude == null || !Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) return;
    const comm = o.commodity || 'Unknown';
    if (!commColors[comm]) {
      commColors[comm] = palette[colorIdx % palette.length];
      colorIdx++;
    }
    const fill = commColors[comm];
    const distLabel = o.distance_m != null ? fmtDistance(o.distance_m) : '—';

    L.circleMarker([o.latitude, o.longitude], {
      radius: 6, color: '#fff', weight: 1.5, fillColor: fill, fillOpacity: 0.85,
    }).addTo(map)
      .bindPopup(
        `<strong>${esc(o.name || 'Occurrence')}</strong><br/>` +
        `Commodity: ${esc(o.commodity || '—')}<br/>` +
        `Age: ${esc(o.geo_age || '—')}<br/>` +
        `Unit: ${esc(o.geo_unit || '—')}<br/>` +
        `Distance: ${esc(distLabel)}` +
        (o.deposit_type ? `<br/>Type: ${esc(o.deposit_type)}` : '') +
        (o.ore_minerals ? `<br/>Ore: ${esc(o.ore_minerals)}` : '') +
        `<br/><span class="fine">AER DIG 2025-0009</span>`
      );
    boundsGroup.push(L.latLngBounds([[o.latitude, o.longitude]]));
  });

  try {
    if (boundsGroup.length) {
      map.fitBounds(
        boundsGroup.reduce((acc, x) => acc.extend(x), L.latLngBounds(boundsGroup[0])),
        { padding: [28, 28], maxZoom: 16 }
      );
    } else {
      map.setView([centre.latitude, centre.longitude], 12);
    }
  } catch { /* ignore */ }

  requestAnimationFrame(() => {
    try { map.invalidateSize({ animate: false }); } catch { /* ignore */ }
  });
}

function smallWaterSection(sw) {
  if (!sw || (!sw.available && !sw.summary?.has_any_water && !sw.open_water_features?.length && !sw.possible_small_water_or_seeps?.length)) {
    return '';
  }
  const sum = sw.summary || {};
  const open = sw.open_water_features || [];
  const poss = sw.possible_small_water_or_seeps || [];
  const mapId = 'small-water-map-' + Math.random().toString(36).slice(2, 8);
  const fc = sw.feature_collection;
  const parcel = getParcelLatLngs();
  if (fc?.features?.length || parcel) {
    scheduleLeafletWhenVisible(mapId, () =>
      initSmallWaterMap(mapId, fc, sw.map_layers, parcel)
    );
  }

  const openRows = open
    .slice(0, 8)
    .map(
      (f) => `
    <tr>
      <td>${esc(f.type || 'open_water')}</td>
      <td>${f.area_m2 != null ? `${esc(f.area_m2)} m²` : '—'}</td>
      <td><strong>${esc(f.confidence || '—')}</strong></td>
      <td class="fine">${esc(f.source || '—')}</td>
    </tr>`
    )
    .join('');

  const possRows = poss
    .slice(0, 8)
    .map(
      (f) => `
    <tr>
      <td>${esc(f.type || 'possible')}</td>
      <td>${f.area_m2 != null ? `${esc(f.area_m2)} m²` : '—'}</td>
      <td><strong>${esc(f.confidence || 'low-medium')}</strong></td>
      <td class="fine">${esc(f.note || f.source || 'Verify on site walk')}</td>
    </tr>`
    )
    .join('');

  const dr = sw.metadata?.date_range;
  const dateLabel = dr?.start && dr?.end ? `${dr.start} → ${dr.end}` : '—';
  const confirmedBanner =
    open.length || sum.has_confirmed_water
      ? `<div class="flag" data-severity="info" style="margin-top:0.75rem">
          <strong>Confirmed water features detected</strong>
          <p>Inventory and/or multi-pixel optical open-water signatures on/near the parcel.
          Screening only — not a permanent-water guarantee or Alberta Wetland Policy delineation.</p>
        </div>`
      : '';
  const possibleBanner =
    poss.length || sum.has_possible_small_water
      ? `<div class="flag" data-severity="caution" style="margin-top:0.75rem">
          <strong>Possible small water sources or seeps detected (low-medium confidence)</strong>
          <p>Site walk recommended to verify. May be seasonal pools, seeps, or false positives.
          Never treat pixel detections as regulatory wetland boundaries.</p>
        </div>`
      : '';

  return `
    <section class="report-block small-water-block">
      <h2>Small water sources</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Multi-source stack: Alberta wetland inventory + Sentinel-2 NDWI/MNDWI + Sentinel-1 wetness + optional DEM wetness.
        Detects ponds, dugouts, wet depressions, and possible seeps beyond mapped wetlands.
        <strong>Screening only — not permanent water and not a regulatory wetland delineation.</strong>
      </p>
      <div class="summary-grid">
        <div class="stat"><span class="k">Any water signal</span><strong>${sum.has_any_water ? 'Yes' : 'No'}</strong></div>
        <div class="stat"><span class="k">Confirmed area</span><strong>${sum.total_confirmed_area_m2 != null ? `${esc(sum.total_confirmed_area_m2)} m²` : '—'}</strong></div>
        <div class="stat"><span class="k">Possible seeps</span><strong>${sum.total_possible_area_m2 != null ? `${esc(sum.total_possible_area_m2)} m²` : '—'}</strong></div>
        <div class="stat"><span class="k">Nearest</span><strong>${sum.nearest_water_distance_m != null ? (sum.nearest_water_distance_m === 0 ? 'on parcel' : `${esc(sum.nearest_water_distance_m)} m`) : '—'}</strong></div>
        <div class="stat"><span class="k">Density score</span><strong>${sum.water_density_score != null ? esc(sum.water_density_score) : '—'}</strong></div>
        <div class="stat"><span class="k">AOI MNDWI</span><strong>${sum.aoi_mndwi != null ? esc(sum.aoi_mndwi) : '—'}</strong></div>
      </div>
      ${confirmedBanner}
      ${possibleBanner}
      ${
        openRows
          ? `<div class="econ-table-wrap" style="margin-top:0.75rem">
              <span class="mono topo-label">Confirmed / high–medium open water</span>
              <table class="econ-table"><thead><tr><th>Type</th><th>Area</th><th>Confidence</th><th>Source</th></tr></thead>
              <tbody>${openRows}</tbody></table>
            </div>`
          : ''
      }
      ${
        possRows
          ? `<div class="econ-table-wrap" style="margin-top:0.65rem">
              <span class="mono topo-label">Possible small water or seeps</span>
              <table class="econ-table"><thead><tr><th>Type</th><th>Area</th><th>Confidence</th><th>Note</th></tr></thead>
              <tbody>${possRows}</tbody></table>
            </div>`
          : ''
      }
      ${fc?.features?.length || parcel ? `<div id="${mapId}" class="report-map minimap-embed" style="height:260px;margin-top:0.75rem"></div>
        <div class="minimap-legend" style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center">
          <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(168,128,31,0.25);border:2px solid #a8801f;vertical-align:middle;margin-right:4px"></span>Your parcel</span>
          <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:#2a9d8f;border:2px solid #0b6e4f;vertical-align:middle;margin-right:4px"></span>Confirmed / mapped</span>
          <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(233,196,106,0.5);border:2px dashed #c45c26;vertical-align:middle;margin-right:4px"></span>Possible seeps (verify)</span>
          <span class="fine">MNDWI heatmap optional (blue = wetter)</span>
        </div>` : ''}
      <p class="fine" style="margin-top:0.5rem">
        Sources: ${esc((sw.metadata?.sources || []).join(' · ') || '—')}
        · Date range: ${esc(dateLabel)}
        · Buffer ${esc(sw.metadata?.aoi_buffer_m ?? 100)} m
        · ${esc(sw.metadata?.resolution_m ?? 10)} m optical
        ${(sw.metadata?.fallbacks || []).length ? ` · Fallbacks: ${esc(sw.metadata.fallbacks.join('; '))}` : ''}
      </p>
      <p class="fine"><strong>Attribution:</strong> Copernicus Sentinel (ESA) via Microsoft Planetary Computer; Alberta Merged Wetland Inventory (Open Government Licence — Alberta).</p>
      ${sw.disclaimer ? `<p class="fine">${esc(sw.disclaimer)}</p>` : ''}
    </section>`;
}

function initSmallWaterMap(elId, featureCollection, mapLayers, parcelLatLngs) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined') return;
  destroyLeafletOn(el);
  let map;
  try {
    map = L.map(el, { zoomControl: true, attributionControl: true });
  } catch (e) {
    console.warn('small-water map failed', e);
    el.innerHTML = '<p class="fine">Water map could not load.</p>';
    return;
  }
  el._eeLeafletMap = map;
  el.dataset.leafletReady = '1';
  const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri · Copernicus · AMWI · Alberta provincial contours',
    maxZoom: 18,
  }).addTo(map);

  const overlays = {};
  const boundsGroup = [];

  addHrdemWmsToMap(map, state.report);
  addProvincialContoursToMap(map, state.report);

  // Parcel boundary (same drawn coords as property map)
  const parcelRing = parcelLatLngs || getParcelLatLngs();
  let parcelPoly = null;
  if (parcelRing?.length >= 3) {
    parcelPoly = L.polygon(parcelRing, {
      color: '#a8801f',
      fillColor: '#a8801f',
      fillOpacity: 0.12,
      weight: 3,
    }).addTo(map);
    parcelPoly.bindPopup('<strong>Your parcel</strong><br/>Boundary you drew');
    boundsGroup.push(parcelPoly);
    overlays['Your parcel'] = parcelPoly;
  }

  const mndwi = (mapLayers || []).find((l) => l.id === 'mndwi' && l.url);
  if (mndwi?.url) {
    fetch(mndwi.url)
      .then((r) => r.json())
      .then((tj) => {
        if (tj?.tiles?.[0]) {
          const heat = L.tileLayer(tj.tiles[0], {
            opacity: mndwi.opacity ?? 0.45,
            maxZoom: 18,
            attribution: mndwi.source || 'Sentinel-2 MNDWI',
          });
          heat.addTo(map);
          overlays['MNDWI wetness (screening)'] = heat;
          L.control.layers({ Imagery: base }, overlays, { collapsed: true }).addTo(map);
        }
      })
      .catch(() => {});
  }

  const confirmed = L.layerGroup();
  const possible = L.layerGroup();
  if (featureCollection?.features?.length) {
    L.geoJSON(featureCollection, {
      style: (f) => {
        const conf = f.properties?.confidence || '';
        const isPoss = f.properties?.class === 'possible' || /low/i.test(conf);
        // Solid teal = confirmed/mapped; dashed amber = possible seeps
        return {
          color: isPoss ? '#c45c26' : '#0b6e4f',
          weight: isPoss ? 2 : 2.5,
          fillColor: isPoss ? '#e9c46a' : '#2a9d8f',
          fillOpacity: isPoss ? 0.35 : 0.5,
          dashArray: isPoss ? '6 4' : null,
        };
      },
      onEachFeature: (f, lyr) => {
        const p = f.properties || {};
        const isPoss = p.class === 'possible' || /low/i.test(p.confidence || '');
        const verify = isPoss
          ? '<br/><em>Field verification recommended — not permanent water</em>'
          : '<br/><span class="fine">Screening only — not regulatory delineation</span>';
        lyr.bindPopup(
          `<strong>${esc(p.type || 'water')}</strong><br/>` +
            `Area: ${p.area_m2 != null ? esc(p.area_m2) + ' m²' : '—'}<br/>` +
            `Source: ${esc(p.source || '—')}<br/>` +
            `Confidence: <strong>${esc(p.confidence || '—')}</strong>` +
            verify
        );
        if (isPoss) lyr.addTo(possible);
        else lyr.addTo(confirmed);
      },
    });
  }
  confirmed.addTo(map);
  possible.addTo(map);
  overlays['Confirmed / mapped water'] = confirmed;
  overlays['Possible seeps (verify)'] = possible;
  if (confirmed.getLayers().length) boundsGroup.push(confirmed);
  if (possible.getLayers().length) boundsGroup.push(possible);

  if (!mndwi?.url) {
    L.control.layers({ Imagery: base }, overlays, { collapsed: true }).addTo(map);
  }

  if (parcelPoly) parcelPoly.bringToFront();

  try {
    if (boundsGroup.length) {
      const all = L.featureGroup(
        boundsGroup.flatMap((x) => (x.getLayers ? x.getLayers() : [x]))
      );
      const b = all.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [16, 16], maxZoom: 17 });
    }
  } catch { /* ignore */ }
}

/** Parcel ring as Leaflet [lat,lng][] from report or live draw state. */
function getParcelLatLngs() {
  // Prefer the coordinates captured when the user drew the parcel — reused for all maps
  const ring =
    state.report?.geometry?.coordinates?.[0] ||
    state.report?.site_map?.parcel?.coordinates?.[0] ||
    (Array.isArray(state.paths) && state.paths.length >= 3 ? state.paths : null);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const latlngs = ring
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map(([lng, lat]) => [Number(lat), Number(lng)])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (latlngs.length < 3) return null;
  const a = latlngs[0];
  const b = latlngs[latlngs.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) latlngs.push([...a]);
  return latlngs;
}

function wetlandsSection(w) {
  if (!w) return '';
  const onSite = !!w.has_wetland_on_site;
  const types = (w.wetland_types || []).join(', ') || '—';
  const area = w.wetland_area_ha != null ? `${w.wetland_area_ha} ha` : '—';
  const near =
    w.nearest_wetland_distance_m != null
      ? w.nearest_wetland_distance_m === 0
        ? 'on parcel'
        : `${w.nearest_wetland_distance_m} m`
      : '—';
  const conf = w.confidence || (onSite ? 'high' : '—');
  const mapId = 'wetlands-map-' + Math.random().toString(36).slice(2, 8);
  const fc = w.wetland_polygons;
  const parcel = getParcelLatLngs();
  const showMap = !!(fc?.features?.length || parcel);
  // Init when the accordion becomes visible (Leaflet needs non-zero size)
  if (showMap) {
    scheduleLeafletWhenVisible(mapId, () =>
      initWetlandsMap(mapId, fc, w.query_bbox, parcel)
    );
  }
  return `
    <section class="report-block wetlands-block">
      <h2>Wetlands (inventory)</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Alberta Merged Wetland Inventory polygons for screening water, microclimate, and fauna levers.
        Gold outline = <strong>your parcel</strong>. Teal fill = mapped wetlands. Purple lines = provincial contours.
        <strong>Not a formal Wetland Policy delineation</strong> — field assessment required before earthworks or Water Act decisions.
      </p>
      <div class="summary-grid">
        <div class="stat"><span class="k">On site</span><strong>${onSite ? 'Yes' : 'No'}</strong></div>
        <div class="stat"><span class="k">Area (mapped)</span><strong>${esc(area)}</strong></div>
        <div class="stat"><span class="k">Types</span><strong style="font-size:0.95rem">${esc(types)}</strong></div>
        <div class="stat"><span class="k">Nearest</span><strong>${esc(near)}</strong></div>
      </div>
      ${
        onSite
          ? `<div class="flag" data-severity="caution" style="margin-top:0.75rem">
              <strong>Protect / buffer existing wetland</strong>
              <p>Mapped wetland intersects this parcel. Prefer enhancement with native wetland species over earthworks. Confirm Alberta Water Act / Wetland Policy requirements before any fill, drain, or excavation.</p>
            </div>`
          : `<p class="fine" style="margin-top:0.65rem">No AMWI wetland polygon on the parcel. Pond candidates still depend on topography, soils, and catchment — not inventory absence alone.</p>`
      }
      ${
        showMap
          ? `<div id="${mapId}" class="report-map minimap-embed" style="height:280px;margin-top:0.75rem;min-height:280px"></div>
        <div class="minimap-legend" style="margin-top:0.4rem;display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center">
          <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:rgba(168,128,31,0.25);border:2px solid #a8801f;vertical-align:middle;margin-right:4px"></span>Your parcel</span>
          <span class="fine"><span style="display:inline-block;width:14px;height:10px;background:#2a9d8f;border:2px solid #0b6e4f;vertical-align:middle;margin-right:4px"></span>AMWI wetland</span>
          <span class="fine"><span style="display:inline-block;width:14px;height:2px;background:#5b3a73;vertical-align:middle;margin-right:4px"></span>Provincial contour</span>
        </div>`
          : ''
      }
      <p class="fine" style="margin-top:0.5rem">
        Confidence: <strong>${esc(conf)}</strong>
        · Source: ${esc(w.source || 'AMWI')}
        ${w.source_url ? ` · <a href="${esc(w.source_url)}" target="_blank" rel="noopener">layer</a>` : ''}
        · Features: ${esc(w.feature_count ?? 0)}
        ${w.error ? ` · Lookup note: ${esc(w.error)}` : ''}
      </p>
      ${w.disclaimer ? `<p class="fine">${esc(w.disclaimer)}</p>` : ''}
    </section>`;
}

/**
 * Leaflet containers inside collapsed <details> have 0 size — init only when visible.
 * Supports multiple maps per accordion (each registers its own init).
 */
function scheduleLeafletWhenVisible(elId, initFn) {
  const tryInit = () => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const details = el.closest('details');
    if (details && !details.open) return false;
    if (el.offsetWidth < 40 || el.offsetHeight < 40) return false;
    if (el.dataset.leafletReady === '1') {
      // Already built — just reflow
      try {
        el._eeLeafletMap?.invalidateSize?.({ animate: false });
      } catch { /* ignore */ }
      return true;
    }
    el.dataset.leafletReady = '1';
    try {
      initFn();
    } catch (e) {
      console.warn('map init failed', elId, e);
      el.dataset.leafletReady = '0';
      return false;
    }
    setTimeout(() => {
      try {
        el._eeLeafletMap?.invalidateSize?.({ animate: false });
      } catch { /* ignore */ }
    }, 200);
    return true;
  };

  if (tryInit()) return;

  const bindDetails = () => {
    const el = document.getElementById(elId);
    if (!el) return;
    const details = el.closest('details');
    if (!details) return;
    if (!details._eeMapInits) details._eeMapInits = [];
    details._eeMapInits.push(tryInit);
    if (!details._eeMapBound) {
      details._eeMapBound = true;
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        setTimeout(() => {
          (details._eeMapInits || []).forEach((fn) => {
            try {
              fn();
            } catch { /* ignore */ }
          });
        }, 60);
      });
    }
  };
  setTimeout(bindDetails, 0);
  setTimeout(tryInit, 250);
  setTimeout(tryInit, 1000);
}

/** Alberta provincial contours FeatureCollection from report. */
function getProvincialContoursFc(report) {
  const r = report || state.report;
  const p =
    r?.elevation_overlays?.contours ||
    r?.site_map?.contours?.provincial ||
    r?._provincial_contours ||
    null;
  if (p?.features?.length) return p;
  return null;
}

function getHrdemOverlay(report) {
  const r = report || state.report;
  return (
    r?.elevation_overlays?.hrdem ||
    r?.hrdem ||
    r?.analysis?.hrdem ||
    null
  );
}

/** Draw provincial contours on a Leaflet map; returns layer or null. */
function addProvincialContoursToMap(map, report, fcOverride) {
  const fc = fcOverride || getProvincialContoursFc(report);
  if (!fc?.features?.length || !map) return null;
  // High-contrast lines on satellite basemap (light purple / white edge feel)
  return L.geoJSON(fc, {
    style: (f) => {
      const isIndex =
        f.properties?.contour_type === 'index' ||
        /INDEX/i.test(String(f.properties?.feature_type || ''));
      return {
        color: isIndex ? '#f3e8ff' : '#c4b5fd',
        weight: isIndex ? 2.4 : 1.4,
        opacity: isIndex ? 0.95 : 0.8,
        fill: false,
      };
    },
    onEachFeature: (f, lyr) => {
      const z = f.properties?.elevation_m ?? f.properties?.ELEVATION;
      if (z != null) lyr.bindTooltip(`${z} m`, { sticky: true, className: 'contour-tip' });
    },
  }).addTo(map);
}

/**
 * If the report has no contour GeoJSON (timeout / miss), fetch Alberta Titan
 * contours client-side for the parcel bbox and add them to the map.
 */
async function ensureProvincialContoursOnMap(map, report, latlngs, overlays, parcelLayer) {
  if (!map || !latlngs?.length) return 0;
  if (getProvincialContoursFc(report)?.features?.length) {
    return getProvincialContoursFc(report).features.length;
  }
  const b = L.latLngBounds(latlngs);
  const bbox = {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  };
  // Pad slightly so edge contours appear
  const padLng = Math.max((bbox.east - bbox.west) * 0.08, 0.0004);
  const padLat = Math.max((bbox.north - bbox.south) * 0.08, 0.0003);
  bbox.west -= padLng;
  bbox.east += padLng;
  bbox.south -= padLat;
  bbox.north += padLat;

  const fc = await fetchProvincialContoursClient(bbox, 1500);
  if (!fc?.features?.length) return 0;

  // Cache on report so wetlands / other maps reuse
  if (report) {
    report._provincial_contours = fc;
    if (!report.elevation_overlays) report.elevation_overlays = {};
    report.elevation_overlays.contours = fc;
    if (state.report === report || !state.report) {
      state.report = report;
    } else {
      state.report._provincial_contours = fc;
      state.report.elevation_overlays = {
        ...(state.report.elevation_overlays || {}),
        contours: fc,
      };
    }
  }

  const layer = addProvincialContoursToMap(map, report, fc);
  if (layer && overlays) overlays['Provincial contours'] = layer;
  if (parcelLayer) {
    try {
      parcelLayer.bringToFront();
    } catch { /* ignore */ }
  }
  return fc.features.length;
}

/** Client-side query of Alberta provincial contours (Titan MapServer). */
async function fetchProvincialContoursClient(bbox, limit = 1200) {
  const base =
    'https://geospatial.alberta.ca/titan/rest/services/elevation/provincial_elevation/MapServer';
  const envelope = JSON.stringify({
    xmin: bbox.west,
    ymin: bbox.south,
    xmax: bbox.east,
    ymax: bbox.north,
    spatialReference: { wkid: 4326 },
  });
  const features = [];
  // 4 = index, 5 = intermediate (same as server)
  for (const layerId of [4, 5]) {
    if (features.length >= limit) break;
    const params = new URLSearchParams({
      geometry: envelope,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultRecordCount: String(limit - features.length),
      where: '1=1',
    });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`${base}/${layerId}/query?${params}`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.error || !data.features?.length) continue;
      for (const feat of data.features) {
        const paths = feat.geometry?.paths;
        if (!paths?.length) continue;
        const attrs = feat.attributes || {};
        const elevRaw = attrs.TEXT ?? attrs.ELEVATION ?? null;
        const elev =
          elevRaw != null && elevRaw !== '' && !Number.isNaN(Number(elevRaw))
            ? Number(elevRaw)
            : null;
        const isIndex =
          layerId === 4 || /INDEX/i.test(String(attrs.FEATURE_TYPE || ''));
        for (const path of paths) {
          if (!path || path.length < 2) continue;
          features.push({
            type: 'Feature',
            properties: {
              elevation_m: elev,
              contour_type: isIndex ? 'index' : 'intermediate',
              feature_type: attrs.FEATURE_TYPE || null,
              source: 'Alberta provincial elevation (client)',
            },
            geometry: { type: 'LineString', coordinates: path },
          });
          if (features.length >= limit) break;
        }
        if (features.length >= limit) break;
      }
    } catch (e) {
      console.warn('contour layer', layerId, e.message);
    }
  }
  return {
    type: 'FeatureCollection',
    features,
    source: 'Alberta Provincial Elevation MapServer (client fetch)',
    altalis_map_url: 'https://www.altalis.com/map;id=118',
  };
}

/**
 * HRDEM Mosaic WMS hillshade (NRCan) when STAC reports coverage for the AOI.
 * https://open.canada.ca/data/en/dataset/0fe65119-e96e-4a57-8bfe-9d9245fba06b
 */
function addHrdemWmsToMap(map, report) {
  const hrdem = getHrdemOverlay(report);
  if (!map || !hrdem?.available || !hrdem?.wms?.url) {
    // Coverage flag without full wms config — still try default WMS if available
    if (!hrdem?.available) return null;
  }
  if (typeof L === 'undefined' || !L.tileLayer?.wms) return null;

  const cfg = hrdem.wms || {
    url: 'https://datacube.services.geo.ca/ows/elevation',
    layers: 'dtm-hillshade',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    opacity: 0.55,
    attribution:
      'HRDEM Mosaic © His Majesty the King in Right of Canada (NRCan)',
  };

  try {
    const layer = L.tileLayer.wms(cfg.url, {
      layers: cfg.layers || 'dtm-hillshade',
      format: cfg.format || 'image/png',
      transparent: cfg.transparent !== false,
      version: cfg.version || '1.3.0',
      opacity: cfg.opacity ?? 0.55,
      attribution: cfg.attribution || 'HRDEM NRCan',
      // CRS handled by Leaflet default (EPSG:3857 tiles via WMS 1.3)
    });
    layer.addTo(map);
    return layer;
  } catch (e) {
    console.warn('HRDEM WMS failed', e);
    return null;
  }
}

function initWetlandsMap(elId, featureCollection, bbox, parcelLatLngs) {
  const el = document.getElementById(elId);
  if (!el || typeof L === 'undefined') return;
  destroyLeafletOn(el);
  let map;
  try {
    map = L.map(el, { zoomControl: true, attributionControl: true });
  } catch (e) {
    console.warn('wetlands map failed', e);
    el.innerHTML = '<p class="fine">Wetlands map could not load.</p>';
    return;
  }
  el._eeLeafletMap = map;
  el.dataset.leafletReady = '1';
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri · AMWI (OGL-A) · Alberta provincial contours',
    maxZoom: 18,
  }).addTo(map);

  const boundsGroup = [];

  addHrdemWmsToMap(map, state.report);
  addProvincialContoursToMap(map, state.report);

  let parcelPoly = null;
  const parcelRing = parcelLatLngs || getParcelLatLngs();
  if (parcelRing?.length >= 3) {
    parcelPoly = L.polygon(parcelRing, {
      color: '#a8801f',
      fillColor: '#a8801f',
      fillOpacity: 0.12,
      weight: 3,
    }).addTo(map);
    parcelPoly.bindPopup('<strong>Your parcel</strong><br/>Boundary you drew');
    boundsGroup.push(parcelPoly);
  }

  // Normalize GeoJSON — AMWI may store MultiRing as Polygon with multi outer rings
  let fc = null;
  if (featureCollection?.features?.length) {
    const fixed = featureCollection.features
      .map((f) => normalizeWetlandFeature(f))
      .filter(Boolean);
    if (fixed.length) fc = { type: 'FeatureCollection', features: fixed };
  }

  if (fc) {
    const layer = L.geoJSON(fc, {
      style: {
        color: '#0b6e4f',
        weight: 2,
        fillColor: '#2a9d8f',
        fillOpacity: 0.45,
      },
      onEachFeature: (f, lyr) => {
        const p = f.properties || {};
        lyr.bindPopup(
          `<strong>${esc(p.type || 'wetland')}</strong><br/>` +
            `${p.area_ha != null ? p.area_ha + ' ha<br/>' : ''}` +
            `CWCS: ${esc(p.cwcs_class || '—')}<br/>` +
            `${p.on_parcel ? '<em>Intersects parcel</em><br/>' : ''}` +
            `<span class="fine">AMWI inventory · screening only</span>`
        );
      },
    }).addTo(map);
    boundsGroup.push(layer);
  } else if (!parcelRing) {
    el.innerHTML =
      '<p class="fine" style="padding:0.75rem">No wetland polygons or parcel boundary to display.</p>';
    return;
  }

  if (parcelPoly) parcelPoly.bringToFront();

  try {
    if (boundsGroup.length) {
      const fg = L.featureGroup(
        boundsGroup.flatMap((x) => (x.getLayers ? x.getLayers() : [x]))
      );
      const b = fg.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [20, 20], maxZoom: 17 });
    } else if (bbox?.south != null) {
      map.fitBounds(
        [
          [bbox.south, bbox.west],
          [bbox.north, bbox.east],
        ],
        { padding: [16, 16] }
      );
    }
  } catch {
    /* ignore */
  }

  setTimeout(() => {
    try {
      map.invalidateSize({ animate: false });
    } catch { /* ignore */ }
  }, 100);
}

/** Ensure wetland GeoJSON rings are valid Leaflet polygons. */
function normalizeWetlandFeature(f) {
  if (!f?.geometry) return null;
  const g = f.geometry;
  let coords = g.coordinates;
  if (!coords) return null;
  // Polygon: [ ring ] or accidentally multi outer rings without MultiPolygon type
  if (g.type === 'Polygon') {
    if (!Array.isArray(coords[0])) return null;
    // If first element looks like a point [lng,lat], wrap
    if (typeof coords[0][0] === 'number') {
      coords = [coords];
    }
    // Drop rings that are too short
    coords = coords.filter((ring) => Array.isArray(ring) && ring.length >= 3);
    if (!coords.length) return null;
    return {
      type: 'Feature',
      properties: f.properties || {},
      geometry: { type: 'Polygon', coordinates: coords },
    };
  }
  if (g.type === 'MultiPolygon') {
    return f;
  }
  return f;
}

function landSalesMinimap(lv, centre) {
  const samples = lv?.municipal_sample?.samples || [];
  const points = samples.filter((s) => s.latitude != null && s.longitude != null);
  if (!points.length || !centre) return '';
  const id = 'land-sales-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri', maxZoom: 18,
    }).addTo(map);
    const all = [[centre.latitude, centre.longitude]];
    points.forEach((p) => {
      const vpa = p.assessed_total_per_acre || 1000;
      const t = Math.min(1, vpa / 20000); // normalize to ~20k/acre
      const fill = `hsl(${120 - t * 80}, ${50 + t * 30}%, ${55 - t * 25}%)`;
      all.push([p.latitude, p.longitude]);
      L.circleMarker([p.latitude, p.longitude], {
        radius: 5, fillColor: fill, fillOpacity: 0.75, color: '#fff', weight: 1,
      }).addTo(map).bindTooltip(`$${Math.round(vpa).toLocaleString()}/ac`);
    });
    L.circleMarker([centre.latitude, centre.longitude], { radius: 7, fillColor: '#a8801f', fillOpacity: 1, color: '#16211b', weight: 2 }).addTo(map).bindTooltip('Site');
    try { map.fitBounds(all, { padding: [10, 10] }); } catch {}
  }, 150);
  return `<div id="${id}" class="report-map minimap-embed" style="height:220px;margin-top:0.6rem"></div>`;
}

/**
 * Value-first conversion step: choose interventions → email for full report →
 * inquiry to mhalma@opensourcemed.info
 */
function nextStepsSection(r, idSuffix = 'main') {
  const menu = r?.action_menu;
  const items = menu?.items || buildClientActionMenuFallback(r);
  if (!items.length) return '';

  // Initialize selection from defaults once per report
  if (!Array.isArray(state.selectedInterventions)) {
    state.selectedInterventions = items.filter((i) => i.default_selected).map((i) => i.id);
  }
  const selected = new Set(state.selectedInterventions);
  const unlocked = !!state.reportUnlocked;
  const rootId = `next-steps-${idSuffix}`;

  const groupOrder = [
    { id: 'planting_shelter', label: 'Planting & shelterbelts' },
    { id: 'water', label: 'Water' },
    { id: 'optional', label: 'Optional extras' },
  ];
  const byGroup = {};
  for (const it of items) {
    const g = it.group || 'other';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(it);
  }

  const groupsHtml = groupOrder
    .map((g) => {
      const list = byGroup[g.id] || [];
      if (!list.length) return '';
      const cards = list
        .map((it) => {
          const on = selected.has(it.id);
          const plants =
            it.plant_highlights?.length
              ? `<p class="fine">Species fit: ${it.plant_highlights.map(esc).join(', ')}</p>`
              : '';
          return `
          <label class="intervention-card${on ? ' is-selected' : ''}${it.optional ? ' is-optional' : ''}" data-intervention-id="${esc(it.id)}">
            <input type="checkbox" class="intervention-check" data-intervention="${esc(it.id)}" ${on ? 'checked' : ''} />
            <div class="intervention-card-body">
              <div class="intervention-card-top">
                <span class="mono intervention-cat">${esc(it.category || g.id)}</span>
                ${it.optional ? '<span class="pkg-badge">Optional</span>' : ''}
              </div>
              <strong class="intervention-label">${esc(it.label)}</strong>
              <p class="fine">${esc(it.blurb || '')}</p>
              <p class="fine intervention-why"><strong>Why here:</strong> ${esc(it.reason || '')}</p>
              ${plants}
            </div>
          </label>`;
        })
        .join('');
      return `
        <div class="intervention-group">
          <h3 class="intervention-group-title">${esc(g.label)}</h3>
          <div class="intervention-list">${cards}</div>
        </div>`;
    })
    .join('');

  const flow = (r.service_packages?.flow || [
    { step: 1, label: 'Your site insights', description: 'Free analysis' },
    { step: 2, label: 'Choose interventions', description: 'Select what you want' },
    { step: 3, label: 'Full report', description: 'Download with email' },
    { step: 4, label: 'Inquire', description: 'Talk to Land Intelligence' },
  ])
    .map(
      (s, i) => `
    <div class="flow-step${i === 1 ? ' flow-step-active' : ''}">
      <span class="mono flow-step-n">${esc(s.step || i + 1)}</span>
      <strong>${esc(s.label)}</strong>
      <p class="fine">${esc(s.description || '')}</p>
    </div>`
    )
    .join('');

  const notes = [];
  if (menu?.well_on_site) notes.push('A well appears to be on or next to this parcel — well drilling is not offered by default.');
  if (menu?.water_on_site) notes.push('Surface water is present — pond and swale packages are omitted.');
  if (!menu?.well_on_site) notes.push('No well detected on the parcel — a groundwater well is offered.');
  if (!menu?.water_on_site) notes.push('No surface water on the parcel — swales and pond storage are offered.');
  notes.push('Outbuilding is available but off by default.');

  return `
    <section class="report-block next-steps-block" id="${rootId}" data-next-steps>
      <span class="mono eyebrow">Next step · receive more value</span>
      <h2>Build your plan</h2>
      <p class="fine" style="margin-top:-0.25rem">
        You’ve seen what the land can support. Now choose the interventions you want Land Intelligence to scope and discuss.
        Select or unselect freely — nothing is a commitment.
      </p>
      <div class="flow-steps">${flow}</div>
      ${menu?.summary ? `<p class="fine" style="margin:0.65rem 0">${esc(menu.summary)}</p>` : ''}
      ${notes.length ? `<ul class="fine next-steps-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}

      <div class="intervention-picker">
        ${groupsHtml}
      </div>

      <!-- Step: email for full report -->
      <div class="next-step-panel report-unlock-panel">
        <h3>Get your full report</h3>
        <p class="fine">
          Enter your email to download the complete site analysis (map, water, soils, plantings, and your selections).
          We’ll only use this to send your report and follow up if you inquire.
        </p>
        <div class="report-unlock-form">
          <label class="sr-only" for="report-email-input-${esc(idSuffix)}">Email</label>
          <input type="email" id="report-email-input-${esc(idSuffix)}" class="report-email-input" data-report-email placeholder="you@example.com" value="${esc(state.reportEmail || '')}" ${unlocked ? 'readonly' : ''} autocomplete="email" />
          <button type="button" class="btn" data-unlock-report ${unlocked ? 'disabled' : ''}>
            ${unlocked ? 'Report unlocked' : 'Unlock full report'}
          </button>
          <button type="button" class="btn btn-secondary" data-download-report ${unlocked ? '' : 'disabled'} title="${unlocked ? 'Download PDF' : 'Enter email first'}">
            Download PDF
          </button>
        </div>
        <p class="fine report-unlock-status" ${unlocked ? '' : 'hidden'}>
          ${unlocked ? `Unlocked for ${esc(state.reportEmail)}. Download anytime.` : ''}
        </p>
      </div>

      <!-- Step: inquiry -->
      <div class="next-step-panel inquiry-panel">
        <h3>Make an inquiry</h3>
        <p class="fine">
          Send your selected interventions and site report summary to
          <strong>mhalma@opensourcemed.info</strong>. We’ll follow up to schedule a site walk.
        </p>
        <div class="inquiry-form">
          <label>
            <span class="mono">Your name</span>
            <input type="text" class="report-email-input" data-inquiry-name placeholder="Name" autocomplete="name" />
          </label>
          <label>
            <span class="mono">Email</span>
            <input type="email" class="report-email-input" data-inquiry-email placeholder="you@example.com" value="${esc(state.reportEmail || '')}" autocomplete="email" />
          </label>
          <label class="inquiry-message-label">
            <span class="mono">Message (optional)</span>
            <textarea class="inquiry-message" data-inquiry-message rows="3" placeholder="Goals, timeline, access notes…"></textarea>
          </label>
          <button type="button" class="btn" data-send-inquiry>Send inquiry with my selections</button>
          <p class="fine inquiry-status" data-inquiry-status hidden></p>
        </div>
      </div>
    </section>`;
}

function buildClientActionMenuFallback(r) {
  // Older cached reports without action_menu — minimal list from packages
  const pkgs = r?.service_packages?.packages || [];
  return pkgs
    .filter((p) => p.id !== 'off_grid_garage' || true)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      category: p.category,
      label: p.label,
      blurb: p.blurb,
      reason: p.reason,
      price: p.price,
      default_selected: p.id !== 'off_grid_garage' && !!p.featured,
      group:
        p.category === 'water'
          ? 'water'
          : p.id === 'off_grid_garage' || p.category === 'energy'
            ? 'optional'
            : 'planting_shelter',
      optional: p.id === 'off_grid_garage' || p.category === 'energy',
    }));
}

function bindNextStepsInteractions(r) {
  const roots = document.querySelectorAll('[data-next-steps]');
  if (!roots.length) return;
  const menu = r?.action_menu;
  const items = menu?.items || buildClientActionMenuFallback(r);

  const refreshAllEstimates = () => {
    const selected = new Set(state.selectedInterventions || []);
    document.querySelectorAll('[data-next-steps]').forEach((root) => {
      root.querySelectorAll('.intervention-card').forEach((card) => {
        const id = card.getAttribute('data-intervention-id');
        card.classList.toggle('is-selected', selected.has(id));
        const cb = card.querySelector('input.intervention-check');
        if (cb) cb.checked = selected.has(id);
      });
    });
  };

  roots.forEach((root) => {
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    root.querySelectorAll('input.intervention-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.getAttribute('data-intervention');
        if (!id) return;
        const set = new Set(state.selectedInterventions || []);
        if (cb.checked) set.add(id);
        else set.delete(id);
        state.selectedInterventions = [...set];
        refreshAllEstimates();
      });
    });

    root.querySelectorAll('.intervention-card').forEach((card) => {
      card.addEventListener('click', (ev) => {
        if (ev.target.closest('input, a, button')) return;
        const cb = card.querySelector('input.intervention-check');
        if (!cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });

    const unlockBtn = root.querySelector('[data-unlock-report]');
    const downloadBtn = root.querySelector('[data-download-report]');
    const emailInput = root.querySelector('[data-report-email]');
    const unlockStatus = root.querySelector('.report-unlock-status');

    unlockBtn?.addEventListener('click', async () => {
      const email = String(emailInput?.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (unlockStatus) {
          unlockStatus.hidden = false;
          unlockStatus.textContent = 'Please enter a valid email address.';
        }
        return;
      }
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Unlocking…';

      const markUnlocked = () => {
        state.reportEmail = email;
        state.reportUnlocked = true;
        document.querySelectorAll('[data-next-steps]').forEach((el) => {
          el.querySelectorAll('[data-download-report]').forEach((b) => {
            b.disabled = false;
          });
          el.querySelectorAll('[data-report-email]').forEach((inp) => {
            inp.value = email;
            inp.readOnly = true;
          });
          el.querySelectorAll('[data-unlock-report]').forEach((b) => {
            b.disabled = true;
            b.textContent = 'Report unlocked';
          });
          el.querySelectorAll('.report-unlock-status').forEach((s) => {
            s.hidden = false;
            s.textContent = `Unlocked for ${email}. You can download the PDF now.`;
          });
          el.querySelectorAll('[data-inquiry-email]').forEach((inp) => {
            if (!inp.value) inp.value = email;
          });
        });
      };

      try {
        // Cap wait so a slow host never feels like a hung "sign-in"
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch('/api/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            site_name: r.site_name,
            source: 'full_report_download',
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not unlock report');
        markUnlocked();
      } catch (e) {
        // Still unlock locally if the request timed out — email is for lead capture only
        if (e?.name === 'AbortError') {
          markUnlocked();
          // Best-effort background retry without blocking UI
          fetch('/api/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              site_name: r.site_name,
              source: 'full_report_download_retry',
            }),
          }).catch(() => {});
          return;
        }
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Unlock full report';
        if (unlockStatus) {
          unlockStatus.hidden = false;
          unlockStatus.textContent = e.message || 'Unlock failed';
        }
      }
    });

    downloadBtn?.addEventListener('click', () => {
      if (!state.reportUnlocked) return;
      if (typeof downloadFullPdf === 'function') downloadFullPdf();
      else window.print();
    });

    root.querySelector('[data-send-inquiry]')?.addEventListener('click', async () => {
      const status = root.querySelector('[data-inquiry-status]');
      const email = String(
        root.querySelector('[data-inquiry-email]')?.value || state.reportEmail || ''
      ).trim();
      const name = String(root.querySelector('[data-inquiry-name]')?.value || '').trim();
      const message = String(root.querySelector('[data-inquiry-message]')?.value || '').trim();
      const selectedIds = new Set(state.selectedInterventions || []);
      const selectedItems = items
        .filter((i) => selectedIds.has(i.id))
        .map((i) => ({
          id: i.id,
          label: i.label,
          category: i.category,
        }));
      if (!selectedItems.length) {
        if (status) {
          status.hidden = false;
          status.textContent = 'Select at least one intervention above.';
        }
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (status) {
          status.hidden = false;
          status.textContent = 'Enter a valid email so we can reply.';
        }
        return;
      }
      const btn = root.querySelector('[data-send-inquiry]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending…';
      }
      try {
        const report_summary = {
          site_name: r.site_name,
          area_ha: r.geometry?.area_ha,
          location: {
            nearest_town: r.location?.nearest_town,
            municipality: r.location?.municipality,
            lat: r.location?.latitude,
            lng: r.location?.longitude,
          },
          elevation_m: r.topology?.elevation_m,
          hardiness: r.climate?.plant_hardiness_zone || r.hardiness?.hardiness_zone,
          wetlands_on_site: r.wetlands?.has_wetland_on_site,
          small_water: r.small_water?.summary,
          well_depth_m: r.predicted_well_depth?.estimated_depth_m,
          plant_highlights: (r.planting_plan?.recommended || [])
            .slice(0, 8)
            .map((p) => p.common_name)
            .filter(Boolean),
          selected: selectedItems,
        };
        const res = await fetch('/api/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            name,
            message,
            selected_items: selectedItems,
            site_name: r.site_name,
            location: r.location?.nearest_town || r.location?.municipality,
            area_ha: r.geometry?.area_ha,
            report_summary,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Inquiry failed');
        if (status) {
          status.hidden = false;
          status.textContent = data.message || 'Inquiry sent.';
        }
      } catch (e) {
        if (status) {
          status.hidden = false;
          status.textContent = e.message || 'Could not send inquiry';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Send inquiry with my selections';
        }
      }
    });
  });
}

/** @deprecated pillar cards — superseded by nextStepsSection harmonized list */
function servicePackagesSection(sp) {
  // Keep a slim version for pillar package slices (food/water tabs)
  if (!sp?.packages?.length) return '';
  const pillars = PILLAR_ORDER.map((pid) => {
    const list = (sp.by_category?.[pid] || []).filter((p) => p.id !== 'off_grid_garage' || pid === 'shelter');
    if (!list.length) return '';
    const meta = PILLAR_META[pid] || { label: pid, client: '' };
    // Garage not featured
    const cards = list
      .map((p) => {
        return `
          <article class="pkg-card${p.id === 'off_grid_garage' ? '' : p.featured ? ' pkg-card-featured' : ''}" data-category="${esc(p.category)}">
            <div class="pkg-card-top">
              <span class="mono pkg-cat">${esc(p.category_label || meta.label)}</span>
              ${p.id === 'off_grid_garage' ? '<span class="pkg-badge">Optional</span>' : ''}
            </div>
            <h3>${esc(p.label)}</h3>
            <p class="fine">${esc(p.blurb)}</p>
            <p class="fine pkg-reason"><strong>Why here:</strong> ${esc(p.reason || '')}</p>
            <p class="fine" style="margin-top:0.45rem">Select this in <strong>Your plan</strong> to include it in your inquiry.</p>
          </article>`;
      })
      .join('');
    return `
      <div class="pkg-pillar" id="pkg-${esc(pid)}">
        <div class="pkg-pillar-head">
          <h3>${esc(meta.label)}</h3>
          <p class="fine">${esc(meta.client)}</p>
        </div>
        <div class="pkg-grid">${cards}</div>
      </div>`;
  }).join('');

  return `
    <section class="report-block service-packages-block">
      <h2>Matching packages</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Context for this pillar. Use <strong>Your plan</strong> to select options and inquire.
        ${sp.summary_sentence ? esc(sp.summary_sentence) : ''}
      </p>
      ${pillars}
    </section>`;
}

function quoteSection(q, packages) {
  // Price estimates temporarily removed — section is hidden.
  void q; void packages;
  return '';
  const pkgItems =
    packages?.packages
      ?.filter((p) => p.price?.amount_cad != null && p.featured)
      .map((p) => ({
        serviceName: p.label,
        size: 1,
        unit: 'package',
        lineItems: [{ label: p.price.label || p.label, cost: p.price.amount_cad }],
        materialsCost: 0,
        materialsPct: 0,
        travelCost: 0,
        subtotal: p.price.amount_cad,
        rangeLow: p.price.range_low_cad ?? p.price.amount_cad,
        rangeHigh: p.price.range_high_cad ?? p.price.amount_cad,
        fieldDays: p.price.field_days || 0,
        valueProps: p.claims_note
          ? [{ confidence: 'moderate', headline: p.blurb, caveat: p.claims_note }]
          : [],
        category: p.category,
      })) || [];

  const fieldItems = q?.items || [];
  // Prefer package view when we have service_packages; still show field lines
  const items = [...pkgItems];
  for (const it of fieldItems) {
    // Avoid double-counting names already featured as packages
    if (items.some((x) => x.serviceName === it.serviceName)) continue;
    items.push(it);
  }
  if (!items.length) return '';

  const subtotal = items.reduce((s, i) => s + (i.subtotal || 0), 0);
  const rangeLow = items.reduce((s, i) => s + (i.rangeLow || i.subtotal || 0), 0);
  const rangeHigh = items.reduce((s, i) => s + (i.rangeHigh || i.subtotal || 0), 0);

  return `
    <section class="report-block quote-block">
      <h2>Estimated investment</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Planning-level costs for recommended service packages and field work —
        not a firm quote. Final scope is confirmed on a site walk.
      </p>

      <div class="quote-items">
        ${items
          .map(
            (it) => `
          <div class="quote-item">
            <div class="quote-item-head">
              <span class="quote-item-name">${esc(it.serviceName)}${it.category ? ` <span class="mono" style="font-size:0.7rem;opacity:0.75">${esc(it.category)}</span>` : ''}</span>
              <span class="quote-item-size mono">${esc(it.size)} ${esc(it.unit === 'flat' || it.unit === 'package' ? (it.unit === 'package' ? 'pkg' : '') : it.unit)}</span>
            </div>
            <div class="quote-item-lines">
              ${(it.lineItems || [])
                .map(
                  (l) => `
                <div class="quote-line">
                  <span>${esc(l.label)}</span>
                  <span class="mono">${fmtCad(l.cost)}</span>
                </div>`
                )
                .join('')}
              ${it.materialsCost ? `<div class="quote-line quote-line-sub"><span>Materials &amp; contingency (${Math.round((it.materialsPct || 0) * 100)}%)</span><span class="mono">${fmtCad(it.materialsCost)}</span></div>` : ''}
              ${it.travelCost ? `<div class="quote-line quote-line-sub"><span>Mobilization / demobilization + travel</span><span class="mono">${fmtCad(it.travelCost)}</span></div>` : ''}
            </div>
            <div class="quote-item-total">
              <span>Subtotal</span>
              <span class="mono">${fmtCad(it.subtotal)}</span>
            </div>
            <p class="fine quote-item-range">likely range ${fmtCad(it.rangeLow)} – ${fmtCad(it.rangeHigh)}${it.fieldDays ? ` · ≈ ${it.fieldDays} field day${it.fieldDays === 1 ? '' : 's'}` : ''}</p>
            ${
              it.valueProps?.length
                ? it.valueProps
                    .map(
                      (vp) => `
              <p class="fine quote-value-prop"><b>[${esc(vp.confidence)}]</b> ${esc(vp.headline)}${vp.caveat ? ` — ${esc(vp.caveat)}` : ''}</p>`
                    )
                    .join('')
                : ''
            }
          </div>`
          )
          .join('')}
      </div>

      <div class="quote-total-card">
        <span class="mono">Estimated total (${items.length} item${items.length === 1 ? '' : 's'})</span>
        <div class="quote-total-value">${fmtCad(subtotal)}</div>
        <p class="fine">likely range ${fmtCad(rangeLow)} – ${fmtCad(rangeHigh)}</p>
      </div>

      <div class="flag" data-severity="info" style="margin-top:1rem">
        <strong>Planning estimate only</strong>
        <p>${esc(
          q?.disclaimer ||
            'Planning-level estimates only. Final scope, site conditions, and materials are confirmed on a site walk before quoting.'
        )}</p>
      </div>
    </section>`;
}

/**
 * PDF generation — uses html2pdf.js (loaded from CDN in index.html).
 * Each .report-block section can be downloaded individually, or the entire
 * report as one document.
 */

function pdfFilename(label) {
  const site = state.report?.site_name || 'site-report';
  const safe = site.replace(/[^\w.-]+/g, '_').substring(0, 40);
  const slug = label.replace(/[^\w.-]+/g, '_').substring(0, 40);
  return `${safe}_${slug}.pdf`;
}

/**
 * Common html2pdf options for report sections.
 * @param {string} filename
 * @param {object} [opts]
 */
function pdfOpts(filename, opts = {}) {
  return {
    margin: [12, 10, 12, 10],
    filename,
    image: { type: 'jpeg', quality: 0.92 },
    html2canvas: {
      scale: 1.5,
      useCORS: true,
      logging: false,
      letterRendering: true,
      allowTaint: false,
      scrollY: 0,
      windowWidth: 1200,
      foreignObjectRendering: false,
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
    },
    pagebreak: {
      mode: ['avoid', 'css', 'legacy'],
      avoid: [
        'h2', 'h3', 'h4',
        '.summary-grid', '.well-range-card', '.rec-card', '.prox-card', '.pkg-card',
        '.intervention-card', '.econ-table', '.findings-accordion', '.flag', 'table',
        'tr', '.quote-item', '.quote-total-card', '.stat', '.report-block > p',
      ],
    },
    ...opts,
  };
}

/**
 * Harden a cloned (detached) node so nothing overflows the A4 page width when
 * html2canvas rasterizes it and nothing gets sliced at page breaks.
 * Shared by the full-report export and single-section exports.
 */
function preparePdfClone(clone) {
  // Ensure all tables and wide elements fit within A4 bounds
  clone.querySelectorAll('table, .econ-table-wrap').forEach((t) => {
    t.style.maxWidth = '100%';
    t.style.overflowX = 'auto';
  });
  clone.querySelectorAll('.econ-table').forEach((t) => {
    t.style.width = '100%';
    t.style.maxWidth = '100%';
    t.style.tableLayout = 'auto';
    t.style.fontSize = '8pt';
  });
  // Open any collapsed details so content is included
  clone.querySelectorAll('details').forEach((d) => { d.open = true; });
  // Remove interactive iframes (crime map, etc.)
  clone.querySelectorAll('iframe').forEach((f) => f.remove());
  // Remove buttons/inputs/selects that serve no purpose in a static PDF
  clone.querySelectorAll('button, input, select, textarea').forEach((b) => b.remove());
  // Remove empty containers left behind by stripping
  clone.querySelectorAll('div').forEach((d) => {
    if (!d.textContent.trim() && !d.querySelector('img, svg, table')) d.remove();
  });

  // Clamp intrinsic sizes so no element is wider than the canvas
  clone.querySelectorAll('*').forEach((el) => {
    el.style.maxWidth = '100%';
    if (el.style.minWidth) el.style.minWidth = '';
  });
  // Let long tokens/URLs wrap instead of forcing horizontal overflow
  clone.querySelectorAll('p, span, li, td, th, h1, h2, h3, h4, .fine, .mono, a, .step-row').forEach((el) => {
    el.style.overflowWrap = 'break-word';
    el.style.wordWrap = 'break-word';
    el.style.whiteSpace = 'normal';
  });
  clone.querySelectorAll('img, svg, canvas').forEach((el) => {
    el.style.height = 'auto';
  });
  // html2canvas clips overflow:auto content — switch to hidden so tables aren't cut mid-cell
  clone.querySelectorAll('.econ-table-wrap, .table-wrap, [class*="table-wrap"]').forEach((el) => {
    el.style.overflow = 'hidden';
  });
  // html2canvas renders absolute/fixed/sticky elements at odd offsets (or
  // drops them from the capture) — pin everything in normal flow so it stays
  // on the page.
  clone.querySelectorAll('section, article, header, footer, nav, aside, div').forEach((el) => {
    if (getComputedStyle(el).position === 'sticky' || getComputedStyle(el).position === 'absolute' || getComputedStyle(el).position === 'fixed') {
      el.style.position = 'static';
    }
  });
  // Keep atomic units together so no heading, table row, or card is sliced
  // across a page boundary.
  clone.querySelectorAll('h2, h3, h4').forEach((el) => { el.style.pageBreakAfter = 'avoid'; el.style.breakAfter = 'avoid-page'; });
  clone.querySelectorAll('tr').forEach((el) => { el.style.pageBreakInside = 'avoid'; el.style.breakInside = 'avoid'; });
  clone.querySelectorAll('.summary-grid, .well-range-card, .rec-card, .prox-card, .pkg-card, .intervention-card, .econ-table, .findings-accordion, .flag, table, .quote-item, .quote-total-card, .stat').forEach((el) => {
    el.style.pageBreakInside = 'avoid';
    el.style.breakInside = 'avoid';
  });
}

/**
 * Build a print-ready PDF document from the report data.
 * Creates a detached DOM tree with professional layout, TOC, branded sections,
 * and footer with page number — then renders via html2pdf.
 */
function buildPdfDocument(reportEl) {
  const r = state.report || {};
  const doc = document.createElement('div');
  doc.style.cssText = 'font-family:"Source Serif 4",Georgia,serif;color:#16211b;background:#fff;font-size:10pt;line-height:1.5;';

  /* ── Title Page ── */
  const titlePage = el('div', null, {
    cssText: 'text-align:center;padding:50px 30px 30px;page-break-after:always;min-height:265mm;display:flex;flex-direction:column;justify-content:center;',
  });

  const brandBlock = el('div', null, { cssText: 'margin-bottom:40px;' });
  brandBlock.appendChild(el('div', null, {
    textContent: 'LAND INTELLIGENCE',
    cssText: 'font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:11px;letter-spacing:2px;color:#5b3a73;text-transform:uppercase;',
  }));
  brandBlock.appendChild(el('div', null, {
    textContent: 'Land Intelligence',
    cssText: 'font-family:"Bricolage Grotesque",sans-serif;font-weight:600;font-size:13px;color:#46584c;margin-top:2px;',
  }));
  titlePage.appendChild(brandBlock);

  titlePage.appendChild(el('h1', null, {
    textContent: r.site_name || 'Site Design Report',
    cssText: 'font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:28px;color:#16211b;margin:0 0 12px;line-height:1.15;',
  }));

  const metaLine = el('p', null, {
    cssText: 'font-size:13px;color:#46584c;margin:0 0 6px;',
  });
  const parts = [];
  if (r.location?.nearest_town || r.location?.municipality) parts.push(r.location.nearest_town || r.location.municipality);
  if (r.geometry?.area_ha != null) parts.push(`${r.geometry.area_ha} ha`);
  if (r.climate?.plant_hardiness_zone) parts.push(`Zone ${r.climate.plant_hardiness_zone}`);
  metaLine.textContent = parts.join(' · ');
  titlePage.appendChild(metaLine);

  titlePage.appendChild(el('p', null, {
    textContent: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
    cssText: 'font-size:11px;color:#888;margin-top:40px;',
  }));

  titlePage.appendChild(el('p', null, {
    textContent: 'Land Intelligence',
    cssText: 'font-size:10px;color:#aaa;margin-top:4px;',
  }));

  titlePage.appendChild(el('p', null, {
    textContent: 'Planning guidance for conversation with Land Intelligence — not engineered drawings or a crime risk assessment.',
    cssText: 'font-size:8px;color:#bbb;margin-top:50px;font-style:italic;max-width:400px;margin-left:auto;margin-right:auto;',
  }));

  doc.appendChild(titlePage);

  /* ── Table of Contents ── */
  const tocData = getReportSectionList();
  const tocPage = el('div', null, { cssText: 'padding:20px 0 30px;page-break-after:always;' });
  tocPage.appendChild(el('h2', null, {
    textContent: 'Contents',
    cssText: 'font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:20px;color:#16211b;margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid #5b3a73;',
  }));

  const tocList = el('div', null, { cssText: 'display:flex;flex-direction:column;gap:6px;' });
  tocData.forEach((s) => {
    const row = el('div', null, { cssText: 'display:flex;align-items:baseline;gap:8px;' });
    row.appendChild(el('span', null, {
      textContent: s.label,
      cssText: 'font-size:10pt;color:#16211b;flex:1;',
    }));
    // Dotted leader
    const dots = el('span', null, {
      cssText: 'display:inline-block;flex:1;border-bottom:1px dotted #ccc;height:1px;min-width:20px;',
    });
    row.appendChild(dots);
    row.appendChild(el('span', null, {
      textContent: String(s.page),
      cssText: 'font-family:"IBM Plex Mono",monospace;font-size:9px;color:#888;',
    }));
    tocList.appendChild(row);
  });
  tocPage.appendChild(tocList);
  doc.appendChild(tocPage);

  /* ── Report Body ── */
  const bodyWrapper = el('div', null, { cssText: 'padding:0 4px;width:100%;max-width:170mm;box-sizing:border-box;' });

  // Clone report content but strip interactive elements that don't render well in PDF
  const clone = reportEl.cloneNode(true);
  clone.querySelectorAll('.btn-pdf-section, .minimap-embed, .report-map, .leaflet-container, .terrain-3d-host, .terrain-3d-controls, .terrain-semantic-controls, .cesium-container, .btn-view-2d, .btn-view-3d, .overview-actions, .next-steps-cta, .site-findings-block, .findings-jump, .plant-list-toolbar, .ee-services-grid, .ee-services-cta, .actions, .report-unlock-form, .inquiry-form').forEach((el) => el.remove());

  // Harden layout: clip overflow, keep cards/rows unsplit, nothing wider than A4
  preparePdfClone(clone);

  // Report blocks are rendered inside the report's outer `.panel` wrapper.
  // Do not restrict this query to direct children: that would silently omit
  // every section from the full export and leave only the title shell.
  const blocks = clone.querySelectorAll('.report-block');
  blocks.forEach((block, i) => {
    if (i > 0) {
      // Insert page break before sections after the first
      block.style.pageBreakBefore = 'always';
    }
    // Add branded section header
    const h2 = block.querySelector('h2');
    if (h2) {
      const sectionLabel = h2.textContent.trim();
      const headerBar = el('div', null, {
        cssText: 'display:flex;align-items:center;gap:8px;margin:0 0 1rem;padding:6px 8px;background:#f7f8f3;border-bottom:1px solid #c8cec1;',
      });
      headerBar.appendChild(el('span', null, {
        textContent: `${i + 1}.`,
        cssText: 'font-family:"IBM Plex Mono",monospace;font-size:8px;color:#5b3a73;letter-spacing:0.5px;',
      }));
      headerBar.appendChild(el('span', null, {
        textContent: sectionLabel,
        cssText: 'font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:14px;color:#16211b;',
      }));
      h2.replaceWith(headerBar);
    }
    bodyWrapper.appendChild(block);
  });

  doc.appendChild(bodyWrapper);

  /* ── Footer stamp on every page ── */
  // html2pdf doesn't support native PDF footers, so we add a discreet footer note
  // to the last section instead
  const lastBlock = bodyWrapper.lastElementChild;
  if (lastBlock) {
    lastBlock.appendChild(el('div', null, {
      cssText: 'margin-top:2rem;padding-top:12px;border-top:1px solid #c8cec1;text-align:center;',
    })).textContent = '© Land Intelligence';
  }

  return doc;
}

/**
 * Return a list of report sections with placeholder page numbers.
 * Real page numbers require post-render measurement; these are estimates.
 */
function getReportSectionList() {
  const r = state.report || {};
  const sections = [
    { label: 'Your parcel', skip: false },
    { label: 'Topology', skip: false },
    { label: 'Proximity & context', skip: false },
    { label: 'Crime map', skip: !r.crime },
    { label: 'Solar incidence & viability', skip: !r.solar },
    { label: 'Temperature profile', skip: !r.temperature },
    { label: 'Wildlife — White-tailed Deer', skip: !r.deer },
    { label: 'Access & mobility', skip: false },
    { label: 'Legal land description', skip: false },
    { label: 'Regional demographics', skip: !r.demographics },
    { label: 'Tree canopy cover', skip: !r.tree_cover },
    { label: 'Climate hardiness · flood · zoning', skip: false },
    { label: 'Land value', skip: !r.land_value },
    { label: 'Recommended plantings', skip: !(r.planting_plan?.recommended?.length) },
    { label: 'Predicted well depth', skip: !r.predicted_well_depth },
    { label: 'Provincial elevation contours', skip: !r.provincial_contours },
    { label: 'Wind & shelterbelt', skip: !r.wind },
    { label: 'Biodiversity', skip: !r.biodiversity },
    { label: 'Soil survey & tests', skip: !(r.soil_survey || r.soil_tests) },
    { label: 'Water collection budget', skip: !r.water_collection },
    { label: 'Geology & minerals', skip: !r.minerals },
    { label: 'Small water sources', skip: !r.small_water },
    { label: 'Wetlands', skip: !r.wetlands },
    { label: 'Placement recommendations', skip: !(r.recommendations?.length) },
    { label: 'Distance & context', skip: false },
    { label: 'Jurisdiction crime context', skip: !r.jurisdiction_crime },
    { label: 'Precipitation', skip: !r.precipitation },
    { label: 'Land fecundity assessment', skip: !r.fecundity },
    { label: 'Matching packages', skip: !r.service_packages },
    { label: 'Estimated investment', skip: !r.quote },
  ].filter((s) => !s.skip);

  // Assign rough page numbers based on expected content volume
  const pageAssignments = {};
  let currentPage = 2; // title + TOC take pages 1-2
  sections.forEach((s) => {
    pageAssignments[s.label] = currentPage;
    // Estimate pages: most sections ~1 page, some take more
    const extraPages = (s.label === 'Recommended plantings' || s.label === 'Biodiversity') ? 1 : 0;
    currentPage += 1 + extraPages;
  });
  sections.forEach((s) => { s.page = pageAssignments[s.label]; });
  return sections;
}

/**
 * Lightweight element factory used during PDF build.
 */
function el(tag, children, attrs = {}) {
  const e = document.createElement(tag);
  if (attrs.textContent != null) e.textContent = attrs.textContent;
  if (attrs.cssText) e.style.cssText = attrs.cssText;
  if (attrs.className) e.className = attrs.className;
  if (attrs.id) e.id = attrs.id;
  if (children) children.forEach((c) => e.appendChild(c));
  return e;
}

/**
 * Add a PDF download button to each .report-block section.
 */
function injectSectionPdfButtons() {
  const sections = document.querySelectorAll('#report .report-block');
  sections.forEach((sec) => {
    // Don't add twice
    if (sec.querySelector('.btn-pdf-section')) return;
    const heading = sec.querySelector('h2');
    if (!heading) return;
    const label = heading.textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-quiet btn-pdf-section';
    btn.textContent = '⬇ PDF';
    btn.title = `Download "${label}" as PDF`;
    btn.style.cssText = 'float:right;font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:-0.2rem;cursor:pointer;opacity:0.6;transition:opacity 0.2s';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.6'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSectionPdf(sec, label);
    });
    heading.appendChild(btn);
  });

  // Also add to planting pane
  const plantSections = document.querySelectorAll('#planting-pane .report-block, #planting-pane .panel');
  plantSections.forEach((sec) => {
    if (sec.querySelector('.btn-pdf-section')) return;
    const heading = sec.querySelector('h1, h2');
    if (!heading) return;
    const label = heading.textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-quiet btn-pdf-section';
    btn.textContent = '⬇ PDF';
    btn.title = `Download "${label}" as PDF`;
    btn.style.cssText = 'float:right;font-size:0.75rem;padding:0.15rem 0.5rem;margin-top:-0.2rem;cursor:pointer;opacity:0.6;transition:opacity 0.2s';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.6'; });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadSectionPdf(sec, label);
    });
    heading.appendChild(btn);
  });
}

/**
 * Download a single section as PDF.
 */
async function downloadSectionPdf(sectionEl, label) {
  if (typeof html2pdf === 'undefined') {
    setError('PDF library not loaded — try refreshing the page.');
    return;
  }
  const btn = sectionEl.querySelector('.btn-pdf-section');
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    // Clone the section so we can modify it for PDF without affecting the page
    const clone = sectionEl.cloneNode(true);
    // Remove the PDF button from the clone
    clone.querySelectorAll('.btn-pdf-section').forEach((b) => b.remove());

    // Strip interactive elements that don't render well in PDF (same list as buildPdfDocument)
    clone.querySelectorAll('.minimap-embed, .report-map, .leaflet-container, .terrain-3d-host, .terrain-3d-controls, .terrain-semantic-controls, .cesium-container, .btn-view-2d, .btn-view-3d, .overview-actions, .next-steps-cta, .site-findings-block, .findings-jump, .plant-list-toolbar, .ee-services-grid, .ee-services-cta, .actions, .report-unlock-form, .inquiry-form').forEach((el) => el.remove());

    // Harden layout: clip overflow, keep cards/rows unsplit, nothing wider than A4
    preparePdfClone(clone);

    // Wrap with a title block for the PDF
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family: system-ui, -apple-system, sans-serif; color: #16211b; padding: 0 4px;';

    // Add a header
    const hdr = document.createElement('div');
    hdr.style.cssText = 'margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #5b3a73;';
    hdr.innerHTML = `
      <div style="font-size:10px;color:#5b3a73;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Land Intelligence</div>
      <div style="font-size:14px;font-weight:700;margin-top:2px">${esc(state.report?.site_name || 'Site report')} — ${esc(label)}</div>
      <div style="font-size:9px;color:#888;margin-top:2px">${new Date().toLocaleDateString('en-CA')} · Land Intelligence</div>
    `;
    wrapper.appendChild(hdr);
    wrapper.appendChild(clone);

    const fname = pdfFilename(label);
    await html2pdf().set(pdfOpts(fname)).from(wrapper).save();
  } catch (err) {
    console.error('PDF generation failed:', err);
    setError(`PDF failed: ${err.message}`);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

/**
 * Download the full site design report as one PDF document.
 * Uses buildPdfDocument() for professional layout with TOC, branded sections, footer.
 */
async function downloadFullPdf() {
  if (typeof html2pdf === 'undefined') {
    setError('PDF library not loaded — try refreshing the page.');
    return;
  }
  const btn = $('btn-pdf-all');
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳ Generating PDF…'; btn.disabled = true; }

  try {
    const reportEl = $('report');
    if (!reportEl) throw new Error('No report to export');

    const doc = buildPdfDocument(reportEl);
    const r = state.report || {};
    const site = (r.site_name || 'site-report').replace(/[^\w.-]+/g, '_').substring(0, 40);
    const fname = `${site}_full_report.pdf`;

    await html2pdf()
      .set(pdfOpts(fname))
      .from(doc)
      .save();
  } catch (err) {
    console.error('Full PDF generation failed:', err);
    setError(`PDF failed: ${err.message}`);
  } finally {
    if (btn) { btn.textContent = origText || '⬇ Download full PDF'; btn.disabled = false; }
  }
}

/**
 * Populate each section pane with grouped content.
 * The "Full report" pane (#report) already has everything for PDF export.
 * Each section pane gets only the relevant sections for focused viewing.
 */
function fecunditySection(fec) {
  if (!fec) return '';
  const overall = fec.overallScore;
  const completeness = fec.dataCompleteness;
  const cats = fec.categories || [];
  const sat = fec.satellite || null;
  const reg = fec.regional_context?.soil_organic_carbon || sat?.regional_soc || null;

  // Radar-style SVG
  const W = 280, H = 280, cx = W / 2, cy = H / 2, maxR = 110;
  const n = cats.length;
  const catScores = cats.map((c) => c.score ?? 0);

  const pts = catScores.map((v, i) => {
    const a = ((i / n) * 360 - 90) * Math.PI / 180;
    const r = (v / 100) * maxR;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

  const rings = [0.25, 0.5, 0.75, 1.0];
  const ringsHtml = rings.map((f) =>
    `<circle cx="${cx}" cy="${cy}" r="${(f * maxR).toFixed(1)}" fill="none" stroke="var(--line)" stroke-width="0.5"/>`
  ).join('');

  const labelsHtml = cats.map((c, i) => {
    const a = ((i / n) * 360 - 90) * Math.PI / 180;
    const tx = cx + Math.cos(a) * (maxR + 18);
    const ty = cy + Math.sin(a) * (maxR + 18);
    const band = c.score != null ? scoreBandLocal(c.score) : null;
    const color = band ? band.color : 'var(--ink-soft)';
    return `<text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}" text-anchor="middle" class="svg-label" font-size="7px" fill="${color}">${esc(c.label.split('—')[0].trim())}</text>
    <text x="${tx.toFixed(1)}" y="${(ty + 11).toFixed(1)}" text-anchor="middle" class="svg-label" font-size="8px" font-weight="bold" fill="${color}">${c.score != null ? c.score : '—'}</text>`;
  }).join('');

  const scoreColor = overall != null ? scoreBandLocal(overall).color : 'var(--ink-soft)';

  const catCards = cats.map((c) => {
    const band = c.score != null ? scoreBandLocal(c.score) : null;
    const barW = c.score != null ? Math.round(c.score) : 0;
    const barColor = band ? band.color : 'var(--line)';
    const recs = (c.recommendations || []).map((r) =>
      `<span class="plant-chip gate-chip on" style="font-size:0.6rem"><strong>${esc(r.serviceId)}</strong> ${esc(r.rationale)}</span>`
    ).join('');
    const indLine = (c.indicatorScores || [])
      .map((i) => `${esc(i.key)} ${esc(i.score)}`)
      .join(' · ');
    return `
      <div class="el rec-card" style="border-left-color:${barColor};padding:0.75rem 0.85rem">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.25rem">
          <strong style="font-size:0.92rem">${esc(c.label)}</strong>
          <span style="font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:1.1rem;color:${barColor}">${c.score != null ? c.score : '—'}</span>
        </div>
        <div style="background:var(--line);border-radius:3px;height:6px;margin-bottom:0.35rem;overflow:hidden">
          <div style="background:${barColor};height:100%;width:${barW}%;border-radius:3px;transition:width 0.3s"></div>
        </div>
        <p class="fine" style="margin:0">${esc(c.narrative)}</p>
        ${indLine ? `<p class="fine" style="margin:0.25rem 0 0;font-size:0.7rem"><strong>Indicators:</strong> ${indLine}</p>` : ''}
        <p class="fine" style="margin:0.2rem 0 0;font-size:0.72rem"><strong>Basis:</strong> ${esc((c.dataBasis || []).join('; '))}</p>
        ${recs ? `<div class="plant-chips" style="margin-top:0.3rem">${recs}</div>` : ''}
      </div>`;
  }).join('');

  // Satellite / open-Canada vegetation index cards
  const idxCard = (label, idx) => {
    if (!idx || (idx.median == null && idx.mean == null)) return '';
    const primary = idx.median != null ? idx.median : idx.mean;
    return `
      <article class="prox-card">
        <span class="mono">${esc(label)}</span>
        <strong>${esc(primary)}${idx.unit ? ` <span class="fine">${esc(idx.unit)}</span>` : ''}</strong>
        <p class="fine">
          ${idx.min != null && idx.max != null ? `range ${fmt(idx.min)}–${fmt(idx.max)} · ` : ''}
          ${idx.p10 != null ? `p10–p90 ${fmt(idx.p10)}–${fmt(idx.p90)} · ` : ''}
          ${idx.resolution_m != null ? `${esc(idx.resolution_m)} m · ` : ''}
          ${esc(idx.confidence || '—')}
          ${idx.date ? ` · ${esc(idx.date)}` : ''}
          ${idx.source ? ` · ${esc(idx.source)}` : ''}
        </p>
      </article>`;
  };

  const nrcan = sat?.nrcan_vegetation || null;
  const lai = sat?.lai || nrcan?.lai || null;
  const fcover = sat?.fcover || nrcan?.fcover || null;
  const fapar = sat?.fapar || nrcan?.fapar || null;
  const avi = sat?.avi || nrcan?.avi || null;
  const resM =
    nrcan?.collection === 'monthly-vegetation-parameters-20m-v1' ||
    (nrcan && nrcan.resolution_m === 20)
      ? 20
      : nrcan?.resolution_m || 100;

  const satBlock = sat?.available
    ? `
      <p class="fine" style="margin-top:0.75rem">
        Primary vegetation indices from
        <a href="https://open.canada.ca/data/en/dataset/033ac0b8-653c-43b2-a843-171fa1c9ace4" target="_blank" rel="noopener">NRCan Canada-wide LAI / fCOVER / fAPAR</a>
        (Sentinel-2 biophysical products)
        with
        <a href="https://open.canada.ca/data/en/dataset/64b0e73a-da5f-4f7f-bca1-b656b6e86c94" target="_blank" rel="noopener">Alberta Vegetation Inventory (AVI) Crown</a>
        as structural inventory reference.
      </p>
      <div class="summary-grid" style="margin-top:0.85rem">
        <div class="stat"><span class="k">Green cover</span><strong>${sat.ndviCoverPct != null ? `${esc(sat.ndviCoverPct)}%` : '—'}</strong></div>
        <div class="stat"><span class="k">LAI</span><strong>${lai?.mean != null ? esc(lai.mean) : '—'}</strong></div>
        <div class="stat"><span class="k">fCOVER</span><strong>${fcover?.mean != null ? esc(fcover.mean) : '—'}</strong></div>
        <div class="stat"><span class="k">Vigor</span><strong>${esc(sat.vegetation_vigor || nrcan?.vegetation_vigor || '—')}</strong></div>
      </div>
      <div class="prox-grid" style="margin-top:0.75rem">
        ${idxCard(`LAI (NRCan · ~${resM} m)`, lai ? { ...lai, resolution_m: resM } : null)}
        ${idxCard(`fCOVER (NRCan · ~${resM} m)`, fcover ? { ...fcover, resolution_m: resM } : null)}
        ${idxCard(`fAPAR (NRCan · ~${resM} m)`, fapar ? { ...fapar, resolution_m: resM } : null)}
        ${idxCard('NDVI (Sentinel-2 supplementary)', sat.ndvi)}
        ${idxCard('NDMI moisture', sat.ndmi)}
      </div>
      ${
        avi
          ? `<div class="flag" data-severity="info" style="margin-top:0.75rem">
        <strong>Alberta Vegetation Inventory (AVI) Crown</strong>
        <p>${esc(avi.note || '')}</p>
        <p class="fine" style="margin:0.35rem 0 0">
          ${avi.natural_subregion?.name ? `Natural subregion: <strong>${esc(avi.natural_subregion.name)}</strong>${avi.natural_subregion.natural_region ? ` (${esc(avi.natural_subregion.natural_region)})` : ''}. ` : ''}
          ${avi.likely_relevant ? 'Forested / parkland setting — AVI standards are relevant for stand structure review. ' : ''}
          <a href="${esc(avi.dataset_url || 'https://open.canada.ca/data/en/dataset/64b0e73a-da5f-4f7f-bca1-b656b6e86c94')}" target="_blank" rel="noopener">Dataset</a>
          ${avi.standards_url ? ` · <a href="${esc(avi.standards_url)}" target="_blank" rel="noopener">Inventory standards</a>` : ''}
        </p>
      </div>`
          : ''
      }
      ${satelliteMapEmbed(sat)}
    `
    : '';

  const socBanner = reg
    ? `
      <div class="flag" data-severity="caution" style="margin-top:0.85rem">
        <strong>Regional SOC context only — ${esc(reg.confidence || 'low-moderate')} confidence</strong>
        <p>
          Mean ~${esc(reg.mean_g_kg)} g/kg
          ${reg.min_g_kg != null && reg.max_g_kg != null ? ` (range ${esc(reg.min_g_kg)}–${esc(reg.max_g_kg)})` : ''}
          · ${esc(reg.source || 'SoilGrids')} · ~${esc(reg.resolution_m || 250)} m resolution.
          ${esc(reg.note || 'Not a property-scale measurement.')}
          <strong>No numeric SOC claim without laboratory (or calibrated drone + lab) verification.</strong>
        </p>
      </div>`
    : '';

  const wfs = fec.waterFeatureSummary;
  const waterSummaryBanner = wfs?.lines?.length
    ? `
      <div class="flag" data-severity="${wfs.field_verification_recommended ? 'caution' : 'info'}" style="margin-top:0.85rem">
        <strong>Water features (lever input)</strong>
        <p>${wfs.lines.map((l) => esc(l)).join(' ')}</p>
        ${
          wfs.nearest_m != null || wfs.confirmed_area_m2 != null
            ? `<p class="fine" style="margin-top:0.35rem">
                ${wfs.nearest_m != null ? `Nearest: ${wfs.nearest_m === 0 ? 'on parcel' : wfs.nearest_m + ' m'}` : ''}
                ${wfs.confirmed_area_m2 != null ? ` · Confirmed ~${esc(wfs.confirmed_area_m2)} m²` : ''}
                ${wfs.possible_area_m2 != null && wfs.possible_area_m2 > 0 ? ` · Possible ~${esc(wfs.possible_area_m2)} m²` : ''}
              </p>`
            : ''
        }
      </div>`
    : '';

  return `
    <section class="report-block">
      <h2>Land fecundity assessment</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Six levers scored from live site data: topography, wetlands, soil survey, wind, wildlife,
        and <strong>satellite plant health</strong> (NRCan LAI / fCOVER / fAPAR${sat?.ndvi ? ' + Sentinel-2 NDVI' : ''}).
        Missing indicators drop out rather than penalizing the score.
        ${fec.indicatorsAnswered != null ? ` · <strong>${esc(fec.indicatorsAnswered)}</strong>/${esc(fec.indicatorsTotal || '—')} indicators answered` : ''}
        ${fec.plantHealthScore != null ? ` · plant-health subscore <strong>${esc(fec.plantHealthScore)}</strong>/100` : ''}
      </p>

      <div class="split-2col">
        <div>
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fecundity radar chart" style="max-width:280px">
            <rect x="0" y="0" width="${W}" height="${H}" fill="#f7f8f3" stroke="var(--line)" rx="8"/>
            ${ringsHtml}
            <polygon points="${pts}" fill="rgba(91,58,115,0.18)" stroke="${scoreColor}" stroke-width="2"/>
            ${labelsHtml}
            <circle cx="${cx}" cy="${cy}" r="3" fill="var(--ink)"/>
          </svg>
        </div>
        <div>
          <div class="well-range-card" style="border-left-color:${scoreColor};margin-bottom:0.75rem">
            <span class="mono">Overall fecundity score</span>
            <div class="well-range-value" style="color:${scoreColor}">${overall != null ? `${overall}/100` : '—'}</div>
            <p class="fine">
              ${overall != null ? scoreBandLocal(overall).tone : 'Insufficient data for overall score.'}
              · Data completeness: <strong>${completeness}%</strong>
              ${fec.plantHealthScore != null ? ` · satellite plant health <strong>${esc(fec.plantHealthScore)}</strong>/100` : ''}
              ${sat?.available || fec.siteDataUsed?.plant_health?.laiMean != null ? ' · LAI/fCOVER wired into score' : ''}
            </p>
          </div>
          ${fec.weakestCategories?.length ? `
            <p class="fine" style="margin:0 0 0.5rem">
              <strong>Weakest levers:</strong> ${fec.weakestCategories.map((w) => `${esc(w.label)} (${w.score})`).join(', ')}
            </p>
          ` : ''}
          ${fec.suggestedServices?.length ? `
            <p class="fine">
              <strong>Suggested services:</strong> ${fec.suggestedServices.map((s) => esc(s)).join(', ')}
            </p>
          ` : ''}
        </div>
      </div>

      ${satBlock}
      ${socBanner}
      ${waterSummaryBanner}

      <div class="elements" style="margin-top:1rem;display:grid;gap:0.65rem">
        ${catCards}
      </div>

      <div class="flag" data-severity="info" style="margin-top:1rem">
        <strong>Remote assessment — site walk recommended</strong>
        <p>${esc(
          fec.disclaimer ||
            'Satellite vegetation indices improve vegetative levers but do not replace soil tests for carbon or biology. A site walk with lab tests remains the high-confidence path.'
        )}</p>
        ${fec.attribution ? `<p class="fine" style="margin-top:0.35rem">${esc(fec.attribution)}</p>` : ''}
      </div>
    </section>`;
}

/**
 * Satellite supporting imagery: NRCan LAI/fCOVER WMS + optional NDVI + SOC points.
 */
function satelliteMapEmbed(sat) {
  const layers = sat?.map_layers || [];
  const ndviLayer = layers.find((l) => l.id === 'ndvi' && l.url);
  const laiWms = layers.find((l) => l.id === 'nrcan_lai' && l.type === 'wms');
  const fcoverWms = layers.find((l) => l.id === 'nrcan_fcover' && l.type === 'wms');
  const socLayer = layers.find((l) => l.id === 'regional_soc');
  const socPts =
    socLayer?.sample_points ||
    sat?.regional_soc?.sample_points ||
    [];
  const bbox = sat?.aoi?.bbox;
  if (!bbox && !socPts.length) return '';
  if (!ndviLayer && !laiWms && !fcoverWms && !socPts.length) return '';

  const id = 'sat-veg-soc-' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el || typeof L === 'undefined') return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: true, attributionControl: true });
    const base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri · NRCan vegetation', maxZoom: 18,
    }).addTo(map);

    const overlays = {};
    let controlAdded = false;
    const ensureControl = () => {
      if (controlAdded || !Object.keys(overlays).length) return;
      L.control.layers({ Imagery: base }, overlays, { collapsed: true }).addTo(map);
      controlAdded = true;
    };

    // NRCan LAI / fCOVER WMS (primary open Canada layers)
    if (typeof L.tileLayer.wms === 'function') {
      [laiWms, fcoverWms].filter(Boolean).forEach((cfg, i) => {
        try {
          const lyr = L.tileLayer.wms(cfg.url, {
            layers: cfg.layers,
            format: cfg.format || 'image/png',
            transparent: cfg.transparent !== false,
            version: cfg.version || '1.3.0',
            opacity: cfg.opacity ?? 0.65,
            attribution: cfg.attribution || 'NRCan',
          });
          if (i === 0) lyr.addTo(map);
          overlays[cfg.label || cfg.id] = lyr;
        } catch (e) {
          console.warn('NRCan WMS layer failed', e);
        }
      });
      ensureControl();
    }

    if (ndviLayer?.url) {
      fetch(ndviLayer.url)
        .then((r) => r.json())
        .then((tj) => {
          if (tj?.tiles?.[0]) {
            const ndvi = L.tileLayer(tj.tiles[0], {
              opacity: ndviLayer.opacity ?? 0.55,
              maxZoom: 18,
              attribution: ndviLayer.source || 'Sentinel-2',
            });
            if (!laiWms && !fcoverWms) ndvi.addTo(map);
            overlays['NDVI (Sentinel-2)'] = ndvi;
            ensureControl();
          }
        })
        .catch(() => {});
    }

    if (socPts.length) {
      const vals = socPts.map((p) => p.soc_g_kg).filter((v) => v != null);
      const lo = vals.length ? Math.min(...vals) : 0;
      const hi = vals.length ? Math.max(...vals) : 1;
      const grp = L.layerGroup();
      socPts.forEach((p) => {
        if (p.lat == null || p.lon == null) return;
        const t = hi > lo && p.soc_g_kg != null ? (p.soc_g_kg - lo) / (hi - lo) : 0.5;
        const r = Math.round(160 + (20 - 160) * t);
        const g = Math.round(100 + (140 - 100) * t);
        const b = Math.round(40 + (50 - 40) * t);
        L.circleMarker([p.lat, p.lon], {
          radius: 8,
          color: '#fff',
          weight: 1.5,
          fillColor: `rgb(${r},${g},${b})`,
          fillOpacity: 0.9,
        })
          .bindPopup(
            `<strong>SOC sample</strong><br>${fmt(p.soc_g_kg)} g/kg<br>` +
            `<span class="fine">SoilGrids ~250 m · regional context only</span>`
          )
          .addTo(grp);
      });
      grp.addTo(map);
      overlays['SOC samples (context)'] = grp;
      ensureControl();
    }

    if (bbox) {
      try {
        map.fitBounds(
          [[bbox.south, bbox.west], [bbox.north, bbox.east]],
          { padding: [12, 12] }
        );
      } catch { /* ignore */ }
    } else if (socPts.length) {
      try {
        map.fitBounds(
          socPts.filter((p) => p.lat != null).map((p) => [p.lat, p.lon]),
          { padding: [24, 24], maxZoom: 14 }
        );
      } catch { /* ignore */ }
    }
  }, 120);

  const titleBits = [];
  if (laiWms) titleBits.push('NRCan LAI');
  if (fcoverWms) titleBits.push('NRCan fCOVER');
  if (ndviLayer) titleBits.push(`NDVI · ${ndviLayer.date || 'latest'} · ${ndviLayer.resolution_m || 10} m`);
  if (socPts.length) titleBits.push(`SOC samples (${socPts.length}) · ~250 m context`);

  return `
    <div style="margin-top:0.85rem">
      <span class="mono topo-label">Satellite vegetation &amp; soil carbon · ${esc(titleBits.join(' · ') || 'imagery')}</span>
      <div id="${id}" class="report-map minimap-embed" style="height:280px;margin-top:0.35rem"></div>
      <p class="fine">
        ${laiWms ? esc(laiWms.legend_note || 'LAI = leaf area index') + ' · ' : ''}
        ${fcoverWms ? esc(fcoverWms.legend_note || 'fCOVER = green cover fraction') + ' · ' : ''}
        ${ndviLayer ? esc(ndviLayer.legend_note || 'NDVI = supplementary vigor') + ' · ' : ''}
        ${socPts.length ? 'SOC markers = SoilGrids model estimates (not lab). ' : ''}
        Toggle layers top-right.
        Primary: <a href="https://open.canada.ca/data/en/dataset/033ac0b8-653c-43b2-a843-171fa1c9ace4" target="_blank" rel="noopener">NRCan vegetation</a>
        · SOC: SoilGrids / ISRIC.
      </p>
    </div>`;
}

function scoreBandLocal(score) {
  if (score >= 80) return { label: 'Strong', color: 'var(--ok)', tone: 'Working well — maintain current conditions.' };
  if (score >= 60) return { label: 'Solid, with room to optimize', color: 'var(--gold)', tone: 'Functioning adequately but clear headroom for improvement.' };
  if (score >= 35) return { label: 'Below average', color: 'var(--caution)', tone: 'A meaningful limiting factor on overall productivity.' };
  return { label: 'Needs significant improvement', color: 'var(--danger)', tone: 'One of the biggest constraints on what the land can produce.' };
}

function pillarPackageSlice(sp, category) {
  if (!sp) return '';
  const slim = {
    ...sp,
    packages: (sp.packages || []).filter((p) => p.category === category),
    by_category: { [category]: sp.by_category?.[category] || [] },
    featured: (sp.featured || []).filter((p) => p.category === category),
    totals: null,
    flow: sp.flow,
    summary_sentence: null,
  };
  return servicePackagesSection(slim);
}

/**
 * Accordion section for findings — collapsed by default; open in PDF mode.
 */
function findingsAccordion(id, title, blurb, bodyHtml, opts = {}) {
  if (!bodyHtml || !String(bodyHtml).trim()) return '';
  const open = opts.open || opts.forPdf ? ' open' : '';
  return `
    <details class="findings-accordion" id="${esc(id)}"${open}>
      <summary class="findings-accordion-summary">
        <span class="findings-accordion-title">${esc(title)}</span>
        ${blurb ? `<span class="fine findings-accordion-blurb">${esc(blurb)}</span>` : ''}
        <span class="findings-accordion-hint mono" aria-hidden="true">Expand</span>
      </summary>
      <div class="findings-accordion-body">
        ${bodyHtml}
      </div>
    </details>`;
}

/**
 * Findings organized for landowners:
 * Land · Security · Economy · Water · Wildlife · Energy · Vegetation & food
 * Recommendations deferred to the end.
 */
function buildFindingsHtml(r, ctx, opts = {}) {
  const {
    topo, a, px, water, city, settlement, crime, nearestCrimes, centre, solar,
    landValue, hardiness, flood, zoning, allEls, els,
  } = ctx;
  const forPdf = !!opts.forPdf;
  const acc = (id, title, blurb, body) =>
    findingsAccordion(id, title, blurb, body, { forPdf });

  // ── Land: legal description, distance / access, soils, topo, hardiness, precipitation ──
  const landBody = [
    atsSection(r.ats, r.parcel_address),
    accessSection(r.access, city?.name, city?.distance_km),
    distanceContextSection(px, water, city, settlement),
    topologySection(topo, a),
    precipitationSection(r.precipitation || r.hydrology || r.climate),
    soilSurveySection(r.soil_survey || a.soil_survey),
    hardinessFloodZoningSection(hardiness, flood, zoning, r),
    temperatureSection(r.temperature || a.temperature),
  ]
    .filter(Boolean)
    .join('');

  // ── Security: EPS city list + crime stats (RCMP iframe map removed per user request) ──
  const securityBody = [
    crimeSectionStandalone(crime, px),
    nearestCrimesSection(nearestCrimes, centre),
  ]
    .filter(Boolean)
    .join('');

  // ── Economy: demographics, land prices ──
  const economyBody = [
    demographicsSection(r.demographics),
    landValueSection(landValue),
  ]
    .filter(Boolean)
    .join('');

  // ── Water: precip (NASA), wells, wetlands, seeps, water collection budget ──
  const waterBody = [
    precipitationSection(r.precipitation || r.hydrology || r.climate),
    waterCollectionSection(r.water_collection),
    wellDepthSection(r.predicted_well_depth || a.well_depth, centre),
    wetlandsSection(r.wetlands || r.fecundity?.wetlands),
    smallWaterSection(r.small_water),
  ]
    .filter(Boolean)
    .join('');

  // ── Wildlife ──
  const wildlifeBody = [
    wildlifeSection(r.wildlife || a.wildlife),
    biodiversitySection(r.biodiversity),
  ]
    .filter(Boolean)
    .join('');

  // ── Energy: solar (+ wind as energy climate) ──
  const energyBody = [
    solarSection(solar),
    windSection(r.climate, r, r.wind_rose),
  ]
    .filter(Boolean)
    .join('');

  // ── Vegetation & food (assessment, not shopping list) ──
  const vegBody = [
    treeCoverSection(r.tree_cover),
    fecunditySection(r.fecundity),
  ]
    .filter(Boolean)
    .join('');

  // ── Recommendations last ──
  const topRecs = (els || allEls || []).slice(0, 12);
  const recCards = topRecs.length
    ? forPdf
      ? `<ul>${topRecs
          .map(
            (e) =>
              `<li><strong>${esc(e.element_type || e.technique || 'Item')}</strong> — ${esc(
                e.condition_basis || e.value_headline || ''
              )}</li>`
          )
          .join('')}</ul>`
      : `<div class="elements">${topRecs.map((e) => recommendationCard(e)).join('')}</div>`
    : '<p class="fine">No placement recommendations matched this parcel profile.</p>';

  const recBody = `
    <section class="report-block">
      <h2>Placement recommendations</h2>
      <p class="fine" style="margin-top:-0.3rem">
        Technique-level ideas from site measurements. Choose what to pursue in <strong>Your plan</strong>.
      </p>
      ${recCards}
      ${siteDriversSection(ctx.siteDrivers) || ''}
    </section>
    ${recommendedPlantingsSection(r.recommended_plantings || r.planting_plan, r.planting_intervention_value)}
    ${
      !forPdf
        ? `<div class="plant-cta panel side-offer-cta-panel" style="margin-top:1rem;padding:0.95rem 1.1rem">
            <span class="mono eyebrow">Separate offering · <span class="badge beta">Beta</span></span>
            <h3 style="margin:0.2rem 0">Planting planner</h3>
            <p class="fine" style="margin:0 0 0.65rem">Re-score goals and economics in the beta planner.</p>
            <button type="button" class="btn btn-secondary" data-open-plant-beta onclick="window.__eeNav&&window.__eeNav('plant')">Open planting planner →</button>
          </div>`
        : ''
    }

  `;

  const flagsHtml = ctx.flags?.length
    ? `<div class="flags">${ctx.flags
        .map(
          (f) => `
      <div class="flag" data-severity="${esc(f.severity)}">
        <strong>${esc(severityLabel(f.severity))}</strong>
        <p>${esc(f.message)}</p>
      </div>`
        )
        .join('')}</div>`
    : '';

  return `
    ${flagsHtml}
    <p class="fine findings-toc">
      Expand a theme to review the supporting cards. Recommendations are last.
    </p>
    ${acc('findings-land', 'Land', 'Legal description, distance, soils, terrain, hardiness', landBody)}
    ${acc('findings-security', 'Security', 'Crime context near the parcel', securityBody)}
    ${acc('findings-economy', 'Economy', 'Demographics and land prices', economyBody)}
    ${acc('findings-water', 'Water', 'Precipitation, wells, wetlands, seeps', waterBody)}
    ${acc('findings-wildlife', 'Wildlife', 'Habitat and biodiversity signals', wildlifeBody)}
    ${acc('findings-energy', 'Energy', 'Solar resource and wind', energyBody)}
    ${acc('findings-vegetation', 'Vegetation & food', 'Canopy and land productivity (assessment)', vegBody)}
    ${acc('findings-minerals', 'Geology & minerals', 'Bedrock geology and mineral occurrences', [mineralsSection(r.minerals)].filter(Boolean).join(''))}
    ${acc('findings-recommendations', 'Recommendations', 'Placement ideas and plant fits — after the evidence', recBody)}
  `;
}

/** Distance / nearest places without crime (crime lives under Security). */
function distanceContextSection(px, water, city, settlement) {
  if (!water && !city && !settlement) return '';
  return `
    <section class="report-block">
      <h2>Distance &amp; context</h2>
      <div class="summary-grid">
        <div class="stat"><span class="k">Nearest water</span><strong>${
          water ? fmtDistance(water.distance_m) : '—'
        }</strong></div>
        <div class="stat"><span class="k">Nearest settlement</span><strong>${
          settlement
            ? `${esc(settlement.name)} · ${fmt(settlement.distance_km, 'km')}`
            : '—'
        }</strong></div>
        <div class="stat"><span class="k">Nearest city</span><strong>${
          city ? `${esc(city.name)} · ${fmt(city.distance_km, 'km')}` : '—'
        }</strong></div>
      </div>
      ${
        water?.feature_name || water?.feature_type
          ? `<p class="fine" style="margin-top:0.5rem">Water feature: ${esc(
              water.feature_name || water.feature_type || '—'
            )}</p>`
          : ''
      }
    </section>`;
}

function crimeSectionStandalone(crime, px) {
  const c = crime || px?.crime_risk;
  // Jurisdiction CSI / stats are optional; RCMP map is primary
  if (!c) return '';
  return `
    <section class="report-block">
      <h2>Jurisdiction crime context</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Statistics Canada / police-service level context (when available) — not a parcel risk rating.
        For current incident mapping, use the RCMP area crime map above.
      </p>
      <div class="summary-grid">
        <div class="stat"><span class="k">Classification</span><strong>${esc(
          c.rural_or_urban_classification || c.band || c.level || '—'
        )}</strong></div>
        <div class="stat"><span class="k">Crime Severity Index</span><strong>${
          c.crime_severity_index != null ? esc(c.crime_severity_index) : '—'
        }</strong></div>
        <div class="stat"><span class="k">Data year</span><strong>${esc(c.data_year || '—')}</strong></div>
        <div class="stat"><span class="k">Reporting area</span><strong style="font-size:0.9rem">${esc(
          c.reporting_jurisdiction || c.area_name || c.municipality || '—'
        )}</strong></div>
      </div>
      ${c.summary ? `<p class="fine" style="margin-top:0.55rem">${esc(c.summary)}</p>` : ''}
      ${c.note || c.disclaimer ? `<p class="fine">${esc(c.note || c.disclaimer)}</p>` : ''}
    </section>`;
}

/**
 * NASA POWER precipitation + GPM PPS archive attribution.
 */
function precipitationSection(precip) {
  // Accept full precipitation object or climate fallback
  const p =
    precip && (precip.mean_annual_mm != null || precip.monthly_mm || precip.available != null)
      ? precip
      : precip?.annual_precipitation_mm != null
        ? {
            available: true,
            mean_annual_mm: precip.annual_precipitation_mm,
            source: precip.precipitation_source || 'Site climate',
            monthly_mm: precip.monthly_precipitation_mm || null,
            years: precip.precipitation_normals_years
              ? { note: String(precip.precipitation_normals_years) }
              : null,
            gpm_pps: {
              archive_url: 'https://arthurhouhttps.pps.eosdis.nasa.gov/',
              registration_url: 'https://registration.pps.eosdis.nasa.gov/registration/',
            },
          }
        : null;

  if (!p) {
    return `
      <section class="report-block">
        <h2>Precipitation</h2>
        <p class="fine">Precipitation series not available for this point yet.</p>
        <p class="fine">
          Research archive:
          <a href="https://arthurhouhttps.pps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA GPM PPS (arthurhouhttps)</a>
        </p>
      </section>`;
  }

  const months = p.monthly_mm || p.monthly || p.monthly_precipitation_mm || null;
  const monthBars = months
    ? Object.entries(months)
        .map(([k, v]) => {
          const max = Object.values(months).reduce((m, x) => {
            const n = Number(x);
            return Number.isFinite(n) && n > m ? n : m;
          }, 1);
          const pct = Math.round((Number(v) / max) * 100);
          return `<div class="precip-month" title="${esc(k)}: ${esc(v)} mm">
            <span class="precip-bar" style="height:${Math.max(8, pct)}%"></span>
            <span class="precip-label mono">${esc(String(k).slice(0, 3))}</span>
          </div>`;
        })
        .join('')
    : '';

  const years = (p.annual_by_year || [])
    .slice(-6)
    .map((y) => `<span class="plant-chip">${esc(y.year)}: <strong>${esc(y.mm)}</strong> mm</span>`)
    .join('');

  const pps = p.gpm_pps || {};

  return `
    <section class="report-block">
      <h2>Precipitation</h2>
      <p class="fine" style="margin-top:-0.35rem">
        NASA POWER bias-corrected precipitation at the parcel centroid (planning screen).
        Full GPM IMERG research products live in the
        <a href="${esc(pps.archive_url || 'https://arthurhouhttps.pps.eosdis.nasa.gov/')}" target="_blank" rel="noopener">PPS archive (arthurhouhttps.pps.eosdis.nasa.gov)</a>.
      </p>
      <div class="summary-grid">
        <div class="stat"><span class="k">Mean annual</span><strong>${
          p.mean_annual_mm != null ? `${esc(p.mean_annual_mm)} mm` : '—'
        }</strong></div>
        <div class="stat"><span class="k">Series</span><strong style="font-size:0.9rem">${esc(
          p.years?.start && p.years?.end
            ? `${p.years.start}–${p.years.end}`
            : p.years?.note || (typeof p.years === 'string' ? p.years : '—')
        )}</strong></div>
        <div class="stat"><span class="k">Source</span><strong style="font-size:0.85rem">${esc(
          p.source || 'NASA'
        )}</strong></div>
      </div>
      ${
        monthBars
          ? `<div class="precip-chart" style="margin-top:0.75rem" aria-label="Mean monthly precipitation">${monthBars}</div>
             <p class="fine" style="margin-top:0.35rem">Mean monthly pattern (mm)</p>`
          : ''
      }
      ${years ? `<div class="plant-chips" style="margin-top:0.55rem">${years}</div>` : ''}
      <p class="fine" style="margin-top:0.65rem">
        ${esc(p.methodology_note || '')}
        ${p.source_url ? ` · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">NASA POWER</a>` : ''}
      </p>
      ${
        pps.authenticated || pps.authenticated_probe
          ? `<div class="flag" data-severity="info" style="margin-top:0.65rem">
              <strong>GPM PPS archive connected</strong>
              <p>
                Authenticated to
                <a href="${esc(pps.archive_url || 'https://arthurhouhttps.pps.eosdis.nasa.gov/')}" target="_blank" rel="noopener">arthurhouhttps.pps.eosdis.nasa.gov</a>
                ${pps.account ? ` as <span class="mono">${esc(pps.account)}</span>` : ''}.
                ${esc(pps.note || '')}
                ${
                  pps.sample_directory
                    ? `<br/><span class="fine">Sample dir: <a href="${esc(pps.sample_directory)}" target="_blank" rel="noopener">${esc(pps.sample_directory)}</a></span>`
                    : ''
                }
              </p>
            </div>`
          : `<p class="fine" style="margin-top:0.45rem">
              PPS:
              <a href="${esc(pps.archive_url || 'https://arthurhouhttps.pps.eosdis.nasa.gov/')}" target="_blank" rel="noopener">research archive</a>
              ${pps.note ? ` — ${esc(pps.note)}` : ''}
              ${
                pps.registration_url
                  ? ` · <a href="${esc(pps.registration_url)}" target="_blank" rel="noopener">register</a>`
                  : ''
              }
            </p>`
      }
    </section>`;
}

function renderSectionPanes(r, ctx) {
  const {
    topo, a, px, water, city, settlement, centre, solar, landValue,
    hardiness, recommendations, flags, allEls,
  } = ctx;
  const b = (html, el) => {
    if (el) el.innerHTML = html;
  };

  const solarDaily = solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt;
  const menuN = r.action_menu?.default_selected_ids?.length || r.action_menu?.items?.length || 0;

  // 1) Overview = map + facts + findings (one continuous page — no separate Findings tab)
  let findingsHtml = '';
  try {
    findingsHtml = buildFindingsHtml(r, ctx);
  } catch (e) {
    console.error('findings render failed', e);
    findingsHtml = `<p class="fine">Findings could not be fully rendered (${esc(e.message)}). Your plan is still available.</p>`;
  }

  b(
    `
    <div class="panel fade">
      <span class="mono eyebrow">Your site</span>
      <h1>${esc(r.site_name || 'Your parcel')}</h1>
      <p class="lede">
        ${esc(r.location?.nearest_town || r.location?.municipality || 'Alberta')}
        ${r.geometry?.area_ha != null ? ` · ${esc(r.geometry.area_ha)} ha` : ''}
        ${r.climate?.plant_hardiness_zone ? ` · zone ${esc(r.climate.plant_hardiness_zone)}` : ''}
        ${solar?.viability?.band ? ` · solar ${esc(solar.viability.band)}` : ''}
      </p>
      ${recommendations?.summary_sentence ? `<p class="rec-summary">${esc(recommendations.summary_sentence)}</p>` : ''}
      <div class="summary-grid">
        <div class="stat"><span class="k">Elevation</span><strong>${fmt(topo.elevation_m ?? a.elevation?.mean_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Slope</span><strong>${fmt(r.terrain?.slope_percent, '%')}</strong></div>
        <div class="stat"><span class="k">Soil texture</span><strong>${esc((r.soil_survey?.characteristics?.texture_class || r.soil_survey?.sample_summary?.texture_class || a.soil_survey?.characteristics?.texture_class || '—'))}</strong></div>
        <div class="stat"><span class="k">pH</span><strong>${esc((r.soil_survey?.characteristics?.ph_h2o_mean || r.soil_survey?.sample_summary?.mean_ph || a.soil_survey?.sample_summary?.mean_ph || '—'))}</strong></div>
        <div class="stat"><span class="k">SOC model</span><strong>${esc((r.soil_survey?.characteristics?.soc_g_kg_regional_mean || r.soil_survey?.sample_summary?.mean_soc_g_kg || a.soil_survey?.sample_summary?.mean_soc_g_kg || '—'))}${(r.soil_survey?.characteristics?.soc_g_kg_regional_mean || r.soil_survey?.sample_summary?.mean_soc_g_kg || a.soil_survey?.sample_summary?.mean_soc_g_kg) != null ? ' g/kg' : ''}</strong></div>
        <div class="stat"><span class="k">Nearest water</span><strong>${water ? fmtDistance(water.distance_m) : '—'}</strong></div>
        <div class="stat"><span class="k">Well depth</span><strong>${fmt(r.predicted_well_depth?.estimated_depth_m || a.well_depth?.estimated_depth_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Solar (lat tilt)</span><strong>${solarDaily != null ? `${esc(solarDaily)} kWh/m²·d` : '—'}</strong></div>
        <div class="stat"><span class="k">Nearest city</span><strong>${city ? `${esc(city.name)} · ${fmt(city.distance_km, 'km')}` : '—'}</strong></div>
      </div>
      ${mapEmbedSection('overview')}
      ${flags?.length ? `<div class="flags">${flags.map((f) => `<div class="flag" data-severity="${esc(f.severity)}"><strong>${esc(severityLabel(f.severity))}</strong><p>${esc(f.message)}</p></div>`).join('')}</div>` : ''}
      <div class="overview-actions" style="display:flex;flex-wrap:wrap;gap:0.65rem;margin-top:1.1rem">
        <button type="button" class="btn btn-secondary" data-scroll-findings onclick="window.__eeScrollFindings&&window.__eeScrollFindings()">Read findings ↓</button>
        <button type="button" class="btn" data-open-your-plan onclick="window.__eeNav&&window.__eeNav('services')">Build your plan${menuN ? ` (${menuN})` : ''} →</button>
      </div>

      <div id="site-findings" class="site-findings-block">
        <span class="mono eyebrow" style="display:block;margin-top:1.5rem">Evidence</span>
        <h2 style="margin-top:0.25rem">Site findings</h2>
        <p class="fine" style="margin-top:-0.15rem">
          Expand each theme for the supporting cards. Recommendations stay at the end.
        </p>
        <p class="findings-jump fine">
          <a href="#findings-land">Land</a> ·
          <a href="#findings-security">Security</a> ·
          <a href="#findings-economy">Economy</a> ·
          <a href="#findings-water">Water</a> ·
          <a href="#findings-wildlife">Wildlife</a> ·
          <a href="#findings-energy">Energy</a> ·
          <a href="#findings-vegetation">Vegetation &amp; food</a> ·
          <a href="#findings-minerals">Geology &amp; minerals</a> ·
          <a href="#findings-recommendations">Recommendations</a>
        </p>
        ${findingsHtml}
      </div>

      <div class="next-steps-cta panel" style="margin-top:1.25rem;padding:1rem 1.15rem">
        <h2 style="font-size:1.15rem;margin:0 0 0.4rem">Next: build your plan</h2>
        <p class="fine" style="margin:0 0 0.75rem">Select interventions, unlock the PDF with email, and send an inquiry.</p>
        <button type="button" class="btn" data-open-your-plan-findings onclick="window.__eeNav&&window.__eeNav('services')">Your plan →</button>
      </div>
    </div>
  `,
    $('report-overview')
  );

  // Clear retired findings pane if still in DOM
  const retiredFindings = $('report-findings');
  if (retiredFindings) {
    retiredFindings.innerHTML =
      '<p class="fine">Findings are on the <strong>Your site</strong> page.</p>';
  }

  // 2) Your plan
  b(
    `
    <div class="panel fade">
      ${nextStepsSection(r, 'services')}
    </div>
  `,
    $('report-services')
  );
  setTimeout(() => bindNextStepsInteractions(r), 50);

  // Map init is deferred from generateReport after showReport() so the container has size
  if (ctx.allEls) {
    try {
      bindValueFilters(ctx.allEls);
    } catch (e) {
      console.warn('value filters bind failed', e);
    }
  }
}

function paintCore(done) {
  const core = $('report-core');
  if (core) {
    core.innerHTML = CORE_LABELS.map(
      (item) => `
    <div class="step-row" data-done="${done ? '1' : '0'}" data-pane="${item.id}"
         style="${done ? `background-color:${item.color}` : ''};cursor:pointer">
      <span>${esc(item.label)}</span>
    </div>`
    ).join('');
    core.querySelectorAll('.step-row').forEach((sr) => {
      sr.addEventListener('click', () => {
        const pane = sr.dataset.pane;
        if (pane) switchReportPane(pane);
      });
    });
  }

  // Side offerings (planting planner, etc.) — separate from site core
  const side = $('report-side-offerings');
  if (side) {
    // Keep static card markup from HTML if present; refresh active state only.
    // Re-bind open handler (idempotent via onclick replace).
    const openBtn = $('btn-open-plant');
    if (openBtn) {
      openBtn.onclick = () => switchReportPane('plant');
      openBtn.classList.toggle('is-active-pane', false);
    }
  }
}

function confBadge(c) {
  if (c === 'rule_based_high') return '<span class="badge high">High confidence</span>';
  if (c === 'rule_based_moderate') return '<span class="badge moderate">Moderate</span>';
  return '<span class="badge visit">Needs site visit</span>';
}

function severityLabel(s) {
  if (s === 'block') return 'Regulatory / block';
  if (s === 'caution') return 'Caution';
  return 'Note';
}

function fmt(v, unit) {
  if (v == null || v === '') return '—';
  return `${v}${unit ? ' ' + unit : ''}`;
}

/* ============================================================
 * CesiumJS 3D Globe Viewer
 * Toggle between Leaflet 2D map and Cesium 3D globe
 * ============================================================ */

let cesiumViewer = null;
let cesiumContainer = null;
let leafletMapEl = null;

/**
 * Initialize the Cesium 3D globe viewer.
 * Shows Alberta region with terrain (Cesium World Terrain).
 */
function initCesiumViewer() {
  // Only initialize once
  if (cesiumViewer) return;

  const mapEl = $('map');
  if (!mapEl) return;

  // Create a container for Cesium inside the #map div
  cesiumContainer = document.createElement('div');
  cesiumContainer.id = 'cesium-container';
  cesiumContainer.style.width = '100%';
  cesiumContainer.style.height = '100%';
  cesiumContainer.style.position = 'absolute';
  cesiumContainer.style.top = '0';
  cesiumContainer.style.left = '0';
  cesiumContainer.style.zIndex = '1';

  // Hide the Leaflet map canvas/elements
  leafletMapEl = mapEl.querySelector('.leaflet-container');
  if (leafletMapEl) {
    leafletMapEl.style.display = 'none';
  }

  mapEl.appendChild(cesiumContainer);

  try {
    // Set Cesium token from Ion (free tier)
    // Using the default public token — for production, set CESIUM_ION_TOKEN in server env
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIwMmQ4YjFhNSfTtWQiJ9.slFv7MEAJ3QWV5QRJcnNz58BJiZXiB9WnVgBSbW15Vg';

    cesiumViewer = new Cesium.Viewer(cesiumContainer, {
      // Enable 3D terrain
      baseLayerPicker: true,
      geocoder: true,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: true,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      vrButton: false,
      selectionIndicator: true,
      // Use Cesium World Terrain for elevation
      terrainProvider: Cesium.createWorldTerrain(),
      // Start viewing Alberta (Sturgeon County area)
      target: Cesium.Cartesian3.fromDegrees(-113.5, 53.55, 0),
      orientation: {
        heading: Cesium.Math.toRadians(0), // North
        pitch: Cesium.Math.toRadians(-45),  // Tilted view
        roll: 0,
      },
    });

    // Add a box around the current parcel if one exists
    if (state.paths && state.paths.length >= 3) {
      addParcelToCesium(state.paths);
    }

    // Force resize after a short delay (Cesium needs rendered dimensions)
    setTimeout(() => {
      if (cesiumViewer) {
        cesiumViewer.resize();
        // If a parcel is drawn, addParcelToCesium already flew the camera to it.
        // Only fly to the Alberta overview when no parcel exists.
        if (!(state.paths && state.paths.length >= 3)) {
          cesiumViewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(-113.5, 53.55, 8000),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-60),
              roll: 0,
            },
            duration: 2,
          });
        }
      }
    }, 300);

    // Switch to 2D mode by default for cleaner look, but keep 3D terrain
    // Actually let's use 3D mode since that's what we want
    cesiumViewer.scene.globe.enableLighting = true;

    return cesiumViewer;
  } catch (err) {
    console.error('Cesium initialization failed:', err);
    // Fallback: remove the container and stay in 2D
    if (cesiumContainer) cesiumContainer.remove();
    cesiumContainer = null;
    if (leafletMapEl) leafletMapEl.style.display = '';
    cesiumViewer = null;
    setError('Cesium 3D globe failed to load. Check internet connection and try again.');
    return null;
  }
}

/**
 * Add the drawn parcel as a polygon entity on the Cesium globe.
 * @param {[[number, number]]} paths - Array of [lng, lat] pairs
 */
function addParcelToCesium(paths) {
  if (!cesiumViewer || !paths || paths.length < 3) return;

  const positions = paths.map(([lng, lat]) =>
    Cesium.Cartesian3.fromDegrees(lng, lat)
  );

  // Close the polygon ring if not already closed
  const closed =
    positions.length >= 4 &&
    positions[0].x === positions[positions.length - 1].x &&
    positions[0].y === positions[positions.length - 1].y &&
    positions[0].z === positions[positions.length - 1].z;
  const hierarchy = closed ? positions : [...positions, positions[0]];

  cesiumViewer.entities.add({
    id: 'parcel',
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(hierarchy),
      material: Cesium.Color.PURPLE.withAlpha(0.3),
      outline: true,
      outlineColor: Cesium.Color.PURPLE,
      outlineWidth: 2,
      clampToGround: true,
    },
  });

  // Fit camera to the parcel — scale range to parcel size so it's framed well
  const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
  const range = Math.max(boundingSphere.radius * 2.5, 250);
  cesiumViewer.camera.flyToBoundingSphere(boundingSphere, {
    offset: new Cesium.HeadingPitchRange(
      0,
      Cesium.Math.toRadians(-60),
      range
    ),
  });
}

/**
 * Remove the parcel entity from Cesium.
 */
function removeParcelFromCesium() {
  if (!cesiumViewer) return;
  cesiumViewer.entities.removeById('parcel');
}

/**
 * Switch from Cesium 3D back to Leaflet 2D map.
 */
function switchToLeaflet() {
  if (!cesiumViewer) return;

  // Destroy Cesium viewer
  if (cesiumViewer) {
    cesiumViewer.destroy();
    cesiumViewer = null;
  }

  // Remove Cesium container
  if (cesiumContainer) {
    cesiumContainer.remove();
    cesiumContainer = null;
  }

  // Show Leaflet map again
  if (leafletMapEl) {
    leafletMapEl.style.display = '';
    leafletMapEl = null;
  }

  // Update button states
  const btn2d = $('btn-view-2d');
  const btn3d = $('btn-view-3d');
  if (btn2d) {
    btn2d.setAttribute('aria-pressed', 'true');
    btn2d.classList.add('is-active');
  }
  if (btn3d) {
    btn3d.setAttribute('aria-pressed', 'false');
    btn3d.classList.remove('is-active');
  }

  // Invalidate Leaflet size after switching back
  setTimeout(() => {
    if (state._leafletMap) {
      try {
        state._leafletMap.invalidateSize({ animate: false });
      } catch (e) { /* ignore */ }
    }
  }, 100);
}

/**
 * Switch from Leaflet 2D to Cesium 3D globe.
 */
function switchToCesium() {
  // Initialize Cesium if not already
  const viewer = initCesiumViewer();
  if (!viewer) return;

  // Update button states
  const btn2d = $('btn-view-2d');
  const btn3d = $('btn-view-3d');
  if (btn2d) {
    btn2d.setAttribute('aria-pressed', 'false');
    btn2d.classList.remove('is-active');
  }
  if (btn3d) {
    btn3d.setAttribute('aria-pressed', 'true');
    btn3d.classList.add('is-active');
  }

  // If there's a parcel drawn, add it to Cesium
  if (state.paths && state.paths.length >= 3) {
    addParcelToCesium(state.paths);
  } else {
    // Just fly to Alberta
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-113.5, 53.55, 8000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-60),
        roll: 0,
      },
      duration: 2,
    });
  }
}

main().catch((e) => {
  console.error(e);
  setError(e.message || 'Failed to start map');
  // still try fallback
  if (!state.map && !state.fallback) {
    initFallbackMap({ defaultCenter: { lat: 53.55, lng: -113.5 } });
  }
});
