/**
 * Expanding Edge — map-first Alberta site design
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
  food_forest_guild:                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        'Food forest guild',
  herb_spiral: 'Herb spiral',
  keyhole_bed: 'Keyhole bed',
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

const CORE_LABELS = ['Elev', 'Topo', 'Water', 'Well', 'Plants', 'Safety', 'Rules', 'Report'];
const HORIZONS = [
  'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)',
  'var(--h5)', 'var(--h6)', 'var(--h7)', 'var(--h8)',
];

/** EE service labels for card CTAs (mirrors lib/recommendation-values.js). */
const EE_SERVICE_META = {
  water_earthworks_consult: {
    label: 'Water & earthworks consult',
    cta: 'Talk earthworks',
    href: 'https://www.expandingedge.ca/services-landing',
  },
  shelterbelt_design: {
    label: 'Shelterbelt design',
    cta: 'Design a shelterbelt',
    href: 'https://www.expandingedge.ca/services-landing',
  },
  food_forest_design: {
    label: 'Food forest design',
    cta: 'Plan a food forest',
    href: 'https://www.expandingedge.ca/services-landing',
  },
  kitchen_garden_design: {
    label: 'Kitchen garden design',
    cta: 'Design Zone 1',
    href: 'https://www.expandingedge.ca/services-landing',
  },
  full_site_design: {
    label: 'Full site design',
    cta: 'Book full design',
    href: 'https://www.expandingedge.ca/services-landing',
  },
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

  if (cfg.googleMapsApiKey) {
    await loadGoogleMaps(cfg.googleMapsApiKey);
    initGoogleMap(cfg);
  } else {
    initFallbackMap(cfg);
  }

  $('btn-draw-poly').onclick = () => startDraw('polygon');
  $('btn-draw-rect').onclick = () => startDraw('rectangle');
  $('btn-clear').onclick = clearShape;
  $('btn-report').onclick = generateReport;
  $('btn-back-map').onclick = showMap;
  $('btn-back-map-top')?.addEventListener('click', showMap);
  $('btn-open-plant')?.addEventListener('click', () => switchReportPane('plant'));
  $('tab-site')?.addEventListener('click', () => switchReportPane('site'));
  $('tab-plant')?.addEventListener('click', () => switchReportPane('plant'));
  $('btn-cancel-load')?.addEventListener('click', () => {
    state._reportAbort?.abort();
    clearInterval(state._loadTimer);
    showLoading(false);
    setError('Cancelled.');
  });
}

function switchReportPane(which) {
  const site = $('pane-site');
  const plant = $('pane-plant');
  const tabSite = $('tab-site');
  const tabPlant = $('tab-plant');
  if (!site || !plant) return;
  const isPlant = which === 'plant';
  site.classList.toggle('is-active', !isPlant);
  plant.classList.toggle('is-active', isPlant);
  site.hidden = isPlant;
  plant.hidden = !isPlant;
  tabSite?.classList.toggle('is-active', !isPlant);
  tabPlant?.classList.toggle('is-active', isPlant);
  tabSite?.setAttribute('aria-selected', String(!isPlant));
  tabPlant?.setAttribute('aria-selected', String(isPlant));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    // Drawing library was removed from Maps JS (mid-2026). We draw with
    // native map click listeners + Polygon/Rectangle instead.
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&libraries=geometry&v=weekly&loading=async`;
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
    mapDiv.style.cursor = activeKind ? 'crosshair' : '';
    mapDiv.classList.toggle('is-drawing', !!activeKind);
  }
}

function detachDrawListeners() {
  for (const l of state.draw.listeners) {
    try {
      google.maps.event.removeListener(l);
    } catch { /* ignore */ }
  }
  state.draw.listeners = [];
}

function clearVertexMarkers() {
  for (const m of state.vertexMarkers) m.setMap(null);
  state.vertexMarkers = [];
}

function clearPreview() {
  if (state.preview) {
    state.preview.setMap(null);
    state.preview = null;
  }
  if (state.draw.rectShape) {
    state.draw.rectShape.setMap(null);
    state.draw.rectShape = null;
  }
  clearVertexMarkers();
}

function stopDrawingMode() {
  detachDrawListeners();
  state.draw.active = false;
  state.draw.kind = null;
  state.draw.points = [];
  state.draw.rectStart = null;
  clearPreview();
  setDrawButtons(null);
  if (state.map) state.map.setOptions(mapGestureOpts(false));
}

function startDraw(kind) {
  setError('');
  if (state.mode === 'fallback') {
    fallbackStartDraw(kind);
    return;
  }
  if (!state.map || !window.google?.maps) {
    setError('Map is still loading — try again in a second.');
    return;
  }

  // Toggle off if same tool clicked again
  if (state.draw.active && state.draw.kind === kind) {
    stopDrawingMode();
    $('draw-hint').textContent = 'Drawing cancelled. Click Draw parcel when ready.';
    return;
  }

  clearShape(false);
  stopDrawingMode();

  state.draw.active = true;
  state.draw.kind = kind;
  state.draw.points = [];
  state.draw.rectStart = null;
  setDrawButtons(kind);

  // Keep pan enabled while drawing — only disable double-click zoom for polygons
  state.map.setOptions(mapGestureOpts(true));

  if (kind === 'polygon') {
    $('draw-hint').textContent =
      'Click the map to place corners. Double-click (or press Finish) to close the parcel.';
    ensureFinishButton(true);
    const clickL = state.map.addListener('click', onPolygonClick);
    state.draw.listeners.push(clickL);
  } else {
    ensureFinishButton(false);
    $('draw-hint').textContent =
      'Click one corner of the parcel, then click the opposite corner.';
    const clickL = state.map.addListener('click', onRectClick);
    state.draw.listeners.push(clickL);
  }
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

function onPolygonClick(e) {
  if (!state.draw.active || state.draw.kind !== 'polygon') return;
  if (!e.latLng) return;
  state.draw.points.push(e.latLng);

  // Vertex marker
  const m = new google.maps.Marker({
    map: state.map,
    position: e.latLng,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 5,
      fillColor: '#5b3a73',
      fillOpacity: 1,
      strokeColor: '#f7f8f3',
      strokeWeight: 2,
    },
    clickable: false,
    zIndex: 3,
  });
  state.vertexMarkers.push(m);

  // Preview line / open polygon
  if (!state.preview) {
    state.preview = new google.maps.Polyline({
      map: state.map,
      path: state.draw.points,
      strokeColor: '#5b3a73',
      strokeOpacity: 0.95,
      strokeWeight: 2.5,
      clickable: false,
      zIndex: 2,
    });
  } else {
    state.preview.setPath(state.draw.points);
  }

  const finishBtn = $('btn-finish-poly');
  if (finishBtn) finishBtn.disabled = state.draw.points.length < 3;

  $('draw-hint').textContent =
    state.draw.points.length < 3
      ? `Corner ${state.draw.points.length} placed — need at least 3. Keep clicking.`
      : `${state.draw.points.length} corners — double-click or Finish parcel to close.`;
}

function finishPolygonDraw() {
  if (!state.draw.active || state.draw.kind !== 'polygon') return;
  if (state.draw.points.length < 3) {
    setError('Need at least 3 corners to make a parcel.');
    return;
  }

  const path = state.draw.points.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  clearPreview();

  const poly = new google.maps.Polygon({
    map: state.map,
    paths: path,
    ...styleOpts({ editable: true }),
  });
  state.shape = poly;
  state.paths = pathFromPolygon(poly);

  const sync = () => {
    state.paths = pathFromPolygon(poly);
    updateParcelMeta();
  };
  poly.getPath().addListener('set_at', sync);
  poly.getPath().addListener('insert_at', sync);
  poly.getPath().addListener('remove_at', sync);

  stopDrawingMode();
  ensureFinishButton(false);
  updateParcelMeta();
  $('draw-hint').textContent =
    'Parcel set. Drag purple handles to refine, then Generate site report.';
  setError('');
}

function onRectClick(e) {
  if (!state.draw.active || state.draw.kind !== 'rectangle') return;
  if (!e.latLng) return;

  // First corner
  if (!state.draw.rectStart) {
    state.draw.rectStart = e.latLng;
    const m = new google.maps.Marker({
      map: state.map,
      position: e.latLng,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: '#5b3a73',
        fillOpacity: 1,
        strokeColor: '#f7f8f3',
        strokeWeight: 2,
      },
      clickable: false,
      zIndex: 3,
    });
    state.vertexMarkers.push(m);
    state.draw.rectShape = new google.maps.Rectangle({
      map: state.map,
      bounds: new google.maps.LatLngBounds(e.latLng, e.latLng),
      ...styleOpts({ clickable: false }),
    });
    const moveL = state.map.addListener('mousemove', (ev) => {
      if (!state.draw.rectStart || !ev.latLng || !state.draw.rectShape) return;
      const b = new google.maps.LatLngBounds(state.draw.rectStart, state.draw.rectStart);
      b.extend(ev.latLng);
      state.draw.rectShape.setBounds(b);
    });
    state.draw.listeners.push(moveL);
    $('draw-hint').textContent = 'Now click the opposite corner.';
    return;
  }

  // Second corner — finish
  const b = new google.maps.LatLngBounds(state.draw.rectStart, state.draw.rectStart);
  b.extend(e.latLng);
  clearPreview();

  const rect = new google.maps.Rectangle({
    map: state.map,
    bounds: b,
    ...styleOpts({ editable: true, draggable: true }),
  });
  state.shape = rect;
  state.paths = pathFromRect(rect);
  rect.addListener('bounds_changed', () => {
    state.paths = pathFromRect(rect);
    updateParcelMeta();
  });

  stopDrawingMode();
  updateParcelMeta();
  $('draw-hint').textContent =
    'Parcel set. Adjust the rectangle handles, then Generate site report.';
  setError('');
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
  stopDrawingMode();
  ensureFinishButton(false);

  if (state.shape) {
    if (state.mode === 'google') state.shape.setMap(null);
    state.shape = null;
  }
  if (state.mode === 'fallback') fallbackClear();
  state.paths = null;
  $('btn-report').disabled = true;
  $('parcel-meta').hidden = true;
  if (resetHint) {
    $('draw-hint').textContent =
      'Click Draw parcel, then click the map to place corners (double-click to finish).';
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
  ctx.fillText('© OpenStreetMap · EE fallback map', 12, r.height - 10);
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
  const timeoutMs = 90_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        site_name: $('site_name').value.trim(),
        polygon: { paths: [state.paths] },
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
    } catch (renderErr) {
      console.error(renderErr);
      showLoading(false);
      setError('Report ready but display failed: ' + (renderErr.message || renderErr));
    }
  } catch (e) {
    showLoading(false);
    const msg =
      e.name === 'AbortError'
        ? 'Timed out waiting for land data (try a smaller parcel or again in a moment).'
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
      sub.textContent =
        sec < 3
          ? 'Reading the land…'
          : `Reading the land… (${sec}s — elevation & Alberta layers)`;
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

function showReport() {
  $('map-stage').hidden = true;
  $('report-stage').hidden = false;
  switchReportPane('site');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMap() {
  $('report-stage').hidden = true;
  $('map-stage').hidden = false;
  if (state.mode === 'fallback') setTimeout(drawFallback, 50);
  else if (state.map) google.maps.event.trigger(state.map, 'resize');
}

/* ---------- report UI ---------- */

function renderReport(r) {
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

  // Slim export for JSON (drop dense elevation grids if huge — keep topology summary)
  const exportObj = JSON.parse(JSON.stringify(r));
  delete exportObj._meta;
  if (exportObj.topology?.grid?.elevations_m) {
    // keep normalized grid for re-use; drop raw if needed later
  }

  const solarDaily =
    solar?.mean_daily_global_insolation_kwh_m2?.south_latitude_tilt;

  $('report').innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Expanding Edge · Alberta map → report</span>
      <h1>${esc(r.site_name || 'Your parcel')}</h1>
      <div class="score-row">
        <span class="score">${allEls.length}</span>
        <span class="score-of">recommendations for this parcel</span>
      </div>
      <p class="lede">
        ${esc(r.location?.nearest_town || r.location?.municipality || 'Alberta')}
        ${r.geometry?.area_ha != null ? ` · ${esc(r.geometry.area_ha)} ha` : ''}
        ${r.climate?.plant_hardiness_zone ? ` · zone ${esc(r.climate.plant_hardiness_zone)}` : ''}
        ${r.hydrology?.watershed ? ` · ${esc(r.hydrology.watershed)}` : ''}
        ${a.hrdem?.available ? ' · HRDEM LiDAR available' : ''}
        ${solar?.viability?.band ? ` · solar ${esc(solar.viability.band)}` : ''}
      </p>
      ${
        recommendations?.summary_sentence
          ? `<p class="rec-summary">${esc(recommendations.summary_sentence)}</p>`
          : ''
      }

      <div class="summary-grid">
        <div class="stat"><span class="k">Elevation</span><strong>${fmt(topo.elevation_m ?? a.elevation?.mean_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Relief</span><strong>${fmt(topo.relief_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Slope</span><strong>${fmt(r.terrain?.slope_percent, '%')}</strong></div>
        <div class="stat"><span class="k">Aspect</span><strong>${esc(r.terrain?.aspect || '—')}</strong></div>
        <div class="stat"><span class="k">Landform</span><strong>${esc((r.terrain?.landform_position || '—').replace(/_/g, ' '))}</strong></div>
        <div class="stat"><span class="k">Nearest water</span><strong>${water ? fmtDistance(water.distance_m) : '—'}</strong></div>
        <div class="stat"><span class="k">Nearest city</span><strong>${city ? `${esc(city.name)} · ${fmt(city.distance_km, 'km')}` : '—'}</strong></div>
        <div class="stat"><span class="k">Solar (lat tilt)</span><strong>${
          solarDaily != null ? `${esc(solarDaily)} kWh/m²·d` : '—'
        }</strong></div>
      </div>

      ${mapEmbedSection()}

      ${topologySection(topo, a)}
      ${temperatureSection(r.temperature || a.temperature)}
      ${hardinessFloodZoningSection(hardiness, flood, zoning, r)}
      ${solarSection(solar)}
      ${landValueSection(landValue)}
      ${proximitySection(px, water, city, settlement, crime, nearestCrimes, centre)}
      ${wellDepthSection(r.predicted_well_depth || a.well_depth, centre)}
      ${wildlifeSection(r.wildlife || a.wildlife)}
      ${treeCoverSection(r.tree_cover)}
      ${accessSection(r.access)}

      ${
        flags.length
          ? `<div class="flags">${flags
              .map(
                (f) => `
            <div class="flag" data-severity="${esc(f.severity)}">
              <strong>${esc(severityLabel(f.severity))}</strong>
              <p>${esc(f.message)}</p>
            </div>`
              )
              .join('')}</div>`
          : ''
      }

      <section class="report-block placement-block">
        <h2>What this parcel needs</h2>
        <p class="fine" style="margin-top:-0.3rem">
          Outcomes first (water, wind, food, soil…), matched to measured site conditions — not a fixed checklist.
        </p>
        ${siteDriversSection(siteDrivers)}
        ${valueFilterBar(valueCounts, state.valueFilter, allEls.length)}
        <div class="elements" id="rec-elements">
          ${
            els.length
              ? els.map((e) => recommendationCard(e)).join('')
              : allEls.length
                ? '<p class="fine" id="rec-empty-filter">No recommendations in this value filter — try All or another outcome.</p>'
                : '<p class="fine">No recommendations matched — try a larger parcel or different ground.</p>'
          }
        </div>
        ${servicesCtaSection(services)}
      </section>

      ${quoteSection(r.service_quote || a.service_quote)}

      <div class="plant-cta panel" style="margin-top:1.2rem;padding:1rem 1.2rem">
        <span class="mono eyebrow">Next</span>
        <h2 style="font-size:1.25rem;margin:0.2rem 0 0.4rem">Planting plan</h2>
        <p class="fine" style="margin:0 0 0.8rem">
          Open the separate planting pane for Alberta-suited crops, economics, and vendor links
          for seeds, saplings, and fertilizer.
        </p>
        <button type="button" class="btn" id="btn-goto-plant">Open planting plan →</button>
      </div>

      <div class="sources">
        <span class="mono">Data provenance</span>
        <ul>
          ${(r.data_provenance || [])
            .map(
              (p) =>
                `<li><strong>${esc(p.field)}</strong> — ${esc(p.source_name)}${
                  p.source_url
                    ? ` · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">source</a>`
                    : ''
                }</li>`
            )
            .join('')}
          ${
            a.elevation?.source
              ? `<li>DEM samples: ${esc(a.elevation.source)} (${esc(a.elevation.grid)} grid)</li>`
              : ''
          }
          ${
            a.hrdem?.note
              ? `<li>HRDEM: ${esc(a.hrdem.note)}</li>`
              : ''
          }
        </ul>
      </div>

      <div class="json-box">
        <header>
          <span class="mono">Schema export</span>
          <div>
            <button type="button" class="btn-quiet" id="copy-json">Copy</button>
            <button type="button" class="btn-quiet" id="dl-json">Download</button>
          </div>
        </header>
        <pre>${esc(JSON.stringify(exportObj, null, 2))}</pre>
      </div>

      <div class="actions">
        <button type="button" class="btn" id="btn-again-map">Draw another parcel</button>
        <a class="btn btn-secondary" href="https://www.expandingedge.ca/services-landing" target="_blank" rel="noopener">Book a design consult</a>
      </div>
      <p class="fine" style="margin-top:1rem">
        Planning guidance for conversation with Expanding Edge — not engineered drawings or a crime risk assessment for a parcel.
        (780) 236-3630 · <a href="mailto:info@expandingedge.ca">info@expandingedge.ca</a>
        ${r._meta?.duration_ms ? ` · generated in ${Math.round(r._meta.duration_ms / 100) / 10}s` : ''}
        ${r._meta?.cache === 'hit' ? ' · cached' : ''}
      </p>
    </div>`;

  initReportMapEmbed(r);

  $('btn-again-map').onclick = () => {
    clearShape();
    showMap();
  };
  $('btn-goto-plant')?.addEventListener('click', () => switchReportPane('plant'));
  bindValueFilters(allEls);
  renderPlantingPane(r.planting_plan);
  $('copy-json').onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportObj, null, 2));
      $('copy-json').textContent = 'Copied';
      setTimeout(() => ($('copy-json').textContent = 'Copy'), 1200);
    } catch { /* ignore */ }
  };
  $('dl-json').onclick = () => {
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(r.site_id || 'site-report').replace(/[^\w.-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

/** Placeholder host for the live Google Map embed — populated by initReportMapEmbed() after insertion. */
function mapEmbedSection() {
  return `
    <section class="report-block report-map-block">
      <h2>Your parcel</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Live satellite/roadmap view — the exact boundary you drew, on real Google Maps imagery.
      </p>
      <div id="report-map" class="report-map"></div>
    </section>`;
}

/**
 * Draws the parcel polygon on a real (non-editable) Google Map inside the
 * report. Reuses the already-loaded Maps JavaScript API — no extra Google
 * API product needs to be enabled beyond what the drawing map already uses.
 */
function initReportMapEmbed(r) {
  const el = $('report-map');
  if (!el) return;
  if (state.mode !== 'google' || typeof google === 'undefined') {
    el.innerHTML = `<p class="fine" style="padding:1rem">Live map unavailable — showing planning data only.</p>`;
    return;
  }
  const ring = r.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return;

  const path = ring.map(([lng, lat]) => ({ lat, lng }));
  const bounds = new google.maps.LatLngBounds();
  path.forEach((p) => bounds.extend(p));

  const map = new google.maps.Map(el, {
    center: bounds.getCenter(),
    zoom: 15,
    mapTypeId: 'hybrid',
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      mapTypeIds: ['hybrid', 'satellite', 'roadmap', 'terrain'],
    },
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    gestureHandling: 'cooperative',
  });

  new google.maps.Polygon({
    paths: path,
    strokeColor: '#a8801f',
    strokeWeight: 3,
    fillColor: '#a8801f',
    fillOpacity: 0.15,
    map,
    clickable: false,
  });

  google.maps.event.addListenerOnce(map, 'idle', () => {
    map.fitBounds(bounds, 40);
    google.maps.event.trigger(map, 'resize');
  });
}

function topologySection(topo, a) {
  if (!topo || topo.elevation_m == null) {
    return `<h2>Topology</h2><p class="fine">Elevation samples unavailable for this parcel.</p>`;
  }
  const heat = topoHeatHtml(topo);
  const profile = topoProfileSvg(topo.profile || []);
  const contour = topoContourSvg(topo);
  return `
    <section class="report-block">
      <h2>Topology</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Derived from DEM samples${a.elevation?.source ? ` (${esc(a.elevation.source)})` : ''}.
        Relief ${fmt(topo.relief_m, 'm')} ·
        ${topo.keypoint_present ? 'keypoint candidate present' : 'no clear keypoint'} ·
        erosion ${esc(topo.erosion_risk || '—')}
      </p>
      <div class="topo-layout">
        <div class="topo-heat-wrap">
          <span class="mono topo-label">Elevation surface (sample grid)</span>
          ${heat}
          <div class="topo-scale mono">
            <span>${fmt(topo.elevation_min_m, 'm')}</span>
            <span>low → high</span>
            <span>${fmt(topo.elevation_max_m, 'm')}</span>
          </div>
        </div>
        <div class="topo-profile-wrap">
          <span class="mono topo-label">W → E cross-section (mid parcel)</span>
          ${profile}
        </div>
        <div class="topo-contour-wrap">
          <span class="mono topo-label">Contour map (plan view)</span>
          ${contour}
        </div>
      </div>
      <div class="summary-grid" style="margin-top:1rem">
        <div class="stat"><span class="k">Min elev</span><strong>${fmt(topo.elevation_min_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Mean elev</span><strong>${fmt(topo.elevation_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Max elev</span><strong>${fmt(topo.elevation_max_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Slope p90</span><strong>${fmt(topo.slope_stats?.p90, '%')}</strong></div>
      </div>
    </section>`;
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
      let points = `${ax.toFixed(1)},${ay.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`;

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
            points += ` ${ex.toFixed(1)},${ey.toFixed(1)}`;
            extended = true;
            break;
          }
          if (Math.abs(ex - headX) < 0.6 && Math.abs(ey - headY) < 0.6) {
            used.add(j);
            headX = sx;
            headY = sy;
            points += ` ${sx.toFixed(1)},${sy.toFixed(1)}`;
            extended = true;
            break;
          }
        }
      }

      lines.push({ points, level, isIndexContour: isIndex(level) });
    }

    pathsByLevel.push(...lines);
  }

  if (!pathsByLevel.length) return '<p class="fine">No contour lines generated for this grid resolution.</p>';

  const indexPaths = pathsByLevel.filter((l) => l.isIndexContour);
  const intermediatePaths = pathsByLevel.filter((l) => !l.isIndexContour);

  const indexD = indexPaths.map(
    (l) => `<path class="contour-index" d="M${l.points}"/>`
  ).join('');

  const interD = intermediatePaths.map(
    (l) => `<path class="contour-inter" d="M${l.points}"/>`
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
        <span class="mono">Safety context (jurisdiction — not parcel-level)</span>
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
            : `<p class="fine">Crime context unavailable.</p>`
        }
        ${nearestCrimesSection(nearestCrimes, centre)}
      </div>
    </section>`;
}

function nearestCrimesSection(nc, centre) {
  if (!nc) return '';
  if (!nc.available) {
    return `
      <div class="crime-nearest" style="margin-top:1rem">
        <span class="mono">EPS Community Safety Map — nearest occurrences</span>
        <p class="fine" style="margin:0.4rem 0 0">${esc(
          nc.note || nc.error || 'Live EPS nearest-occurrence list not available for this site.'
        )}</p>
        ${
          nc.source_url
            ? `<p class="fine"><a href="${esc(nc.source_url)}" target="_blank" rel="noopener">Open Community Safety Map</a></p>`
            : ''
        }
      </div>`;
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
      <span class="mono">20 nearest EPS-reported occurrences</span>
      <p class="fine" style="margin:0.35rem 0 0.6rem">${esc(nc.note || '')}</p>
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
            ? ` · <a href="${esc(nc.source_url)}" target="_blank" rel="noopener">Community Safety Map</a>`
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
      </div>
      <p class="fine" style="margin:0.75rem 0 0.5rem">${esc(v.summary || '')}</p>
      ${
        solar.aspect_guidance
          ? `<p class="fine"><strong>Site aspect:</strong> ${esc(solar.aspect_guidance)}</p>`
          : ''
      }
      ${bars}
      <div class="flag" data-severity="info" style="margin-top:0.85rem">
        <strong>Methodology note</strong>
        <p>${esc(solar.methodology_note || '')} ${esc(solar.disclaimer || '')}</p>
      </div>
    </section>`;
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
    const highY = padY + ((maxHigh - (m.avg_high || 0)) / range) * usableH;
    const highH = padY + ((maxHigh - minLow) / range) * usableH - highY;
    // Low bar (cold)
    const lowTop = padY + ((maxHigh - (m.avg_low || 0)) / range) * usableH;
    const lowH = padY + usableH - lowTop;
    return `<g>
      <rect x="${(x - 6).toFixed(1)}" y="${highY.toFixed(1)}" width="12" height="${Math.max(2, highH).toFixed(1)}" fill="#c23e2e" opacity="0.7" rx="2"/>
      <rect x="${(x - 6).toFixed(1)}" y="${lowTop.toFixed(1)}" width="12" height="${Math.max(2, lowH).toFixed(1)}" fill="#2a6f97" opacity="0.7" rx="2"/>
      <text x="${x.toFixed(1)}" y="${(h - 8).toFixed(1)}" class="temp-month-label" text-anchor="middle">${esc(m.month || '')}</text>
      <text x="${x.toFixed(1)}" y="${(highY - 3).toFixed(1)}" class="temp-val-label" text-anchor="middle">${(m.avg_high || 0).toFixed(0)}</text>
      <text x="${x.toFixed(1)}" y="${(lowTop + lowH + 9).toFixed(1)}" class="temp-val-label" text-anchor="middle">${(m.avg_low || 0).toFixed(0)}</text>
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
  const sightings = wl.recent_sightings;

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

function accessSection(acc) {
  if (!acc || !acc.available) return '';
  const road = acc.nearest_road || {};
  const market = acc.nearest_supermarket || {};
  const trips = acc.trip_costs_to_supermarket || [];

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
          ${road.name
            ? `<strong>${esc(road.name)}</strong>
               <p>${esc(road.type || 'road')} · ${fmt(road.distance_m, 'm')}</p>`
            : `<strong>—</strong><p class="fine">No road data</p>`}
        </article>
        <article class="prox-card">
          <span class="mono">Nearest supermarket</span>
          ${market.name
            ? `<strong>${esc(market.name)}</strong>
               <p>${fmt(market.distance_km, 'km')} · ${esc(market.type || 'grocery')}</p>`
            : `<strong>—</strong><p class="fine">No grocery found within search radius</p>`}
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
      ` : ''}
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
        : floodClass === 'no_data'
          ? 'info'
          : 'info';

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
          <strong>${esc(labelFlood(floodClass))}</strong>
          <p>
            ${
              flood?.in_mapped_study_area
                ? `Mapped study${
                    flood.primary?.river_name
                      ? ` · ${esc(flood.primary.river_name)}`
                      : ''
                  }${
                    flood.primary?.study_name
                      ? `<br>${esc(flood.primary.study_name)}`
                      : ''
                  }`
                : esc(flood?.note || 'No FHIP polygon at this parcel.')
            }
          </p>
          <p class="fine">
            ${
              floodClass === 'no_data'
                ? 'no_data ≠ no risk — many rural watercourses are unmapped.'
                : esc(flood?.note || '')
            }
            ${
              flood?.awareness_map
                ? ` · <a href="${esc(flood.awareness_map)}" target="_blank" rel="noopener">floods.alberta.ca</a>`
                : ''
            }
          </p>
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

function sourceLabel(src) {
  if (src === 'municipal_assessment') return 'Municipal assessment';
  if (src === 'cli_municipality_aggregate') return 'CLI municipality aggregate';
  return 'None';
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
      <span class="mono eyebrow">Expanding Edge · next steps</span>
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
        Or call <a href="tel:+17802363630">(780) 236-3630</a>
        · <a href="mailto:info@expandingedge.ca">info@expandingedge.ca</a>
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
  const headline =
    e.value_headline ||
    e.placement_notes ||
    `Deliver ${String(valueLabel).toLowerCase()} on this parcel.`;
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
      <div class="value-chips">${chips}</div>
      <p class="value-headline">${esc(headline)}</p>
      <div class="el-head">
        <h3 class="technique-label">${esc(technique)}</h3>
        <span class="badge zone">Zone ${esc(e.zone)}</span>
        ${confBadge(e.confidence)}
        ${e.effort ? `<span class="badge effort">${esc(e.effort)} effort</span>` : ''}
      </div>
      <div class="basis"><span class="basis-label">Why this property</span> ${esc(e.condition_basis || '')}</div>
      ${e.placement_notes ? `<p class="placement-how">${esc(e.placement_notes)}</p>` : ''}
      ${e.season_hint ? `<p class="season-hint"><span class="basis-label">Season</span> ${esc(e.season_hint)}</p>` : ''}
      ${serviceLinks ? `<div class="rec-service-links">${serviceLinks}</div>` : ''}
    </article>`;
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
      <div class="panel fade">
        <span class="mono eyebrow">Planting plan</span>
        <h1>No suitable plantings</h1>
        <p class="fine">Nothing scored well for this site profile. Adjust parcel data or succession stage.</p>
        <button type="button" class="btn btn-secondary" id="btn-back-site">← Site design</button>
      </div>`;
    $('btn-back-site')?.addEventListener('click', () => switchReportPane('site'));
    return;
  }

  // Keep plant value filter only when re-rendering same plan object
  if (state._plantPlan !== plan) {
    state.plantValueFilter = 'all';
    state._plantPlan = plan;
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
              <th>Yield / ha</th>
              <th>Gross / parcel</th>
              <th>Channels</th>
            </tr>
          </thead>
          <tbody>
            ${cash
              .map((c) => {
                const e = c.economics || {};
                const w = e.price_wholesale_cad_per_kg;
                const y = e.yield_kg_per_ha;
                const g = e.gross_revenue_cad;
                const vl =
                  VALUE_LABELS[c.primary_value] || c.primary_value || '—';
                return `<tr>
                  <td><strong>${esc(c.common_name)}</strong></td>
                  <td class="fine">${esc(vl)}</td>
                  <td>${esc(c.suitability)} (${esc(c.score)})</td>
                  <td>${w ? `${fmtMoney(w.low)}–${fmtMoney(w.high)}` : '—'}</td>
                  <td>${y ? `${esc(y.low)}–${esc(y.high)} kg` : '—'}</td>
                  <td class="econ-rev">${
                    g
                      ? `${fmtMoney(g.low)}–${fmtMoney(g.high)}`
                      : e.non_cash_value
                        ? 'Non-cash'
                        : '—'
                  }</td>
                  <td class="fine">${esc((e.market_channels || []).slice(0, 3).join(', ') || '—')}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="fine">${esc(plan.economics_disclaimer || '')}</p>
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
        ? `<br><span class="fine">Value-add (${esc(
            e.value_add.product || 'processed'
          )}): ~${fmtMoney(e.value_add.gross_mid_cad)} if ×${esc(
            e.value_add.multiplier
          )} processing step</span>`
        : '';
    const econLine = e
      ? e.gross_revenue_cad
        ? `<p class="plant-econ"><strong>Gross ~${fmtMoney(
            e.gross_revenue_cad.mid
          )}/yr</strong> on parcel
             (${fmtMoney(e.gross_revenue_cad.low)}–${fmtMoney(e.gross_revenue_cad.high)}
             wholesale ladder · ${esc(e.unit || 'kg')}
             ${e.establishment_years ? ` · ~${esc(e.establishment_years)} yr establish` : ''}
             ${e.labour_intensity ? ` · labour ${esc(e.labour_intensity)}` : ''})
             ${
               e.market_channels?.length
                 ? `<br><span class="fine">Markets: ${esc(e.market_channels.join(', '))}</span>`
                 : ''
             }
             ${valueAdd}
           </p>`
        : e.non_cash_value
          ? `<p class="plant-econ fine"><strong>Non-cash:</strong> ${esc(e.non_cash_value)}</p>`
          : ''
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
    return `
      <article class="plant-card" data-suit="${esc(p.suitability)}" data-value="${esc(
        p.primary_value || ''
      )}">
        ${chips}
        ${
          p.value_headline
            ? `<p class="value-headline plant-value-headline">${esc(p.value_headline)}</p>`
            : ''
        }
        <div class="plant-head">
          <h3>${esc(p.common_name)}</h3>
          <span class="badge ${suitBadgeClass(p.suitability)}">${esc(p.suitability)} · ${esc(p.score)}</span>
        </div>
        <div class="basis">${esc(p.scientific_name || '')}${
          p.guild_layer ? ` · ${esc(String(p.guild_layer).replace(/_/g, ' '))}` : ''
        }${p.category ? ` · ${esc(p.category)}` : ''}${
          p.alberta_native ? ' · Alberta native' : ''
        }${
          p.alberta_in_range ? ' · USDA: Alberta in range' : ''
        }</div>
        ${plantSpecLine(p)}
        ${
          p.reasons?.length
            ? `<p class="plant-ok">${p.reasons.map(esc).join(' · ')}</p>`
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

  el.innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Planting plan · crop schema + suppliers</span>
      <h1>What to plant</h1>
      <p class="lede">
        Same value tags as site design (food, N-fix, wind, soil…) plus EcoCrop suitability,
        farmfit economics, and vendor links.
      </p>
      <p class="fine">${esc(plan.phase_note || '')}</p>
      <div class="plant-chips">${layers}</div>
      ${valueFilterBar(plantCounts, state.plantValueFilter, allPlants.length).replace(
        'Filter by value',
        'Filter plants by value'
      )}
      ${cashBlock}
      <div class="plant-list" id="plant-list">${
        rows ||
        '<p class="fine">No plants in this value filter — try All.</p>'
      }</div>
      <p class="fine" style="margin-top:1rem">
        Filters: zone ${esc(plan.site_filters?.plant_hardiness_zone || '—')},
        ${esc(plan.site_filters?.frost_free_days ?? '—')} FFD,
        ~${esc(plan.site_filters?.annual_precipitation_mm ?? '—')} mm,
        ${esc(plan.site_filters?.texture || '—')} /
        ${esc(plan.site_filters?.drainage_class || '—')},
        ${esc(areaHa != null ? Number(areaHa).toFixed(2) : '—')} ha.
        Schema:
        <a href="/schema/crop.schema.json" target="_blank" rel="noopener">crop.schema.json</a>.
        Vendor links are search starting points — verify stock and hardiness.
      </p>
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="btn-back-site">← Site design</button>
        <button type="button" class="btn-quiet" id="btn-plant-map">Map</button>
      </div>
    </div>`;

  $('btn-back-site')?.addEventListener('click', () => switchReportPane('site'));
  $('btn-plant-map')?.addEventListener('click', showMap);

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
    });
  });
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
  if (!el || typeof google === 'undefined' || !google.maps) return;
  const bounds = new google.maps.LatLngBounds();
  wells.forEach((w) => bounds.extend({ lat: w.lat, lng: w.lng }));
  bounds.extend({ lat: centre.latitude, lng: centre.longitude });

  const map = new google.maps.Map(el, {
    mapTypeId: 'hybrid',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
  });

  google.maps.event.addListenerOnce(map, 'idle', () => {
    map.fitBounds(bounds, 30);
  });

  // Site centre marker
  new google.maps.Marker({
    position: { lat: centre.latitude, lng: centre.longitude },
    map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#a8801f',
      fillOpacity: 1,
      strokeColor: '#16211b',
      strokeWeight: 2,
    },
    title: 'Site centre',
    zIndex: 10,
  });

  // Well markers with depth-color ramp
  wells.forEach((w) => {
    const depth = w.depth_m || 0;
    const t = Math.min(1, depth / 300);
    const fill = `hsl(24, ${40 + t * 30}%, ${60 - t * 35}%)`;
    new google.maps.Marker({
      position: { lat: w.lat, lng: w.lng },
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: fill,
        fillOpacity: 0.85,
        strokeColor: '#fff',
        strokeWeight: 1.5,
      },
      title: `${w.depth_m}m deep · ${w.distance_km}km away`,
      zIndex: 5,
    });
  });
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
  if (!el || typeof google === 'undefined' || !google.maps) return;
  const bounds = new google.maps.LatLngBounds();
  crimes.forEach((c) => bounds.extend({ lat: c.latitude, lng: c.longitude }));
  bounds.extend({ lat: centre.latitude, lng: centre.longitude });

  const map = new google.maps.Map(el, {
    mapTypeId: 'hybrid',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
  });

  google.maps.event.addListenerOnce(map, 'idle', () => {
    map.fitBounds(bounds, 30);
  });

  new google.maps.Marker({
    position: { lat: centre.latitude, lng: centre.longitude },
    map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#a8801f',
      fillOpacity: 1,
      strokeColor: '#16211b',
      strokeWeight: 2,
    },
    title: 'Site centre',
    zIndex: 10,
  });

  crimes.forEach((c) => {
    new google.maps.Marker({
      position: { lat: c.latitude, lng: c.longitude },
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: '#8c2f1d',
        fillOpacity: 0.8,
        strokeColor: '#fff',
        strokeWeight: 1.5,
      },
      title: `${c.occurrence_type || 'Occurrence'} · ${Math.round(c.distance_m)}m`,
      zIndex: 5,
    });
  });
}

function wellDepthSection(w, centre) {
  if (!w) {
    return `
      <section class="report-block">
        <h2>Predicted well depth</h2>
        <p class="fine">No estimate available for this site.</p>
      </section>`;
  }
  const low = w.estimated_depth_range_m?.low_m;
  const high = w.estimated_depth_range_m?.high_m;
  const confLabel = {
    well_control_dense: 'Dense nearby well control',
    well_control_sparse: 'Sparse nearby well control',
    no_nearby_wells_bedrock_model_only: 'No nearby wells — bedrock model only',
  }[w.confidence] || w.confidence;

  return `
    <section class="report-block well-depth-block">
      <h2>Predicted well depth</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Interpolated from nearby drilled records (primary) with bedrock topography as a covariate —
        not a topography-only guess. Always shown as a <strong>range</strong>.
      </p>

      <div class="well-range-card">
        <span class="mono">Estimated drilled depth range</span>
        <div class="well-range-value">
          ${fmt(low, 'm')} <span class="well-range-sep">–</span> ${fmt(high, 'm')}
        </div>
        <p class="fine">
          Midpoint estimate ${fmt(w.estimated_depth_m, 'm')}
          ${w.estimated_static_water_level_m != null
            ? ` · static water level ~${fmt(w.estimated_static_water_level_m, 'm')} below grade`
            : ''}
        </p>
      </div>

      <div class="summary-grid">
        <div class="stat"><span class="k">Nearby wells used</span><strong>${esc(
          w.nearby_well_count ?? '—'
        )}</strong></div>
        <div class="stat"><span class="k">Search radius</span><strong>${fmt(
          w.nearby_well_search_radius_km,
          'km'
        )}</strong></div>
        <div class="stat"><span class="k">Confidence</span><strong>${esc(confLabel)}</strong></div>
        <div class="stat"><span class="k">Target unit</span><strong>${esc(
          w.target_hydrostratigraphic_unit || '—'
        )}</strong></div>
      </div>

      ${wellsMinimap(w, centre)}

      <div class="flag" data-severity="caution" style="margin-top:1rem">
        <strong>Required — consult a licensed driller</strong>
        <p>${esc(
          w.disclaimer ||
            'This is an estimate range only, not a guaranteed drilled depth. Consult a local licensed water-well driller for a site-specific quote before any construction decision.'
        )}</p>
      </div>
    </section>`;
}

function quoteSection(q) {
  if (!q || !q.items?.length) return '';

  return `
    <section class="report-block quote-block">
      <h2>Estimated investment</h2>
      <p class="fine" style="margin-top:-0.35rem">
        Rough planning-level cost built from published day rates for the recommendations above —
        not a firm quote. Final scope, site conditions, and materials are always confirmed on a site walk.
      </p>

      <div class="quote-items">
        ${q.items
          .map(
            (it) => `
          <div class="quote-item">
            <div class="quote-item-head">
              <span class="quote-item-name">${esc(it.serviceName)}</span>
              <span class="quote-item-size mono">${esc(it.size)} ${esc(it.unit === 'flat' ? '' : it.unit)}</span>
            </div>
            <div class="quote-item-lines">
              ${it.lineItems
                .map(
                  (l) => `
                <div class="quote-line">
                  <span>${esc(l.label)}</span>
                  <span class="mono">${fmtCad(l.cost)}</span>
                </div>`
                )
                .join('')}
              ${it.materialsCost ? `<div class="quote-line quote-line-sub"><span>Materials &amp; contingency (${Math.round(it.materialsPct * 100)}%)</span><span class="mono">${fmtCad(it.materialsCost)}</span></div>` : ''}
              <div class="quote-line quote-line-sub"><span>Mob/demob + travel</span><span class="mono">${fmtCad(it.travelCost)}</span></div>
            </div>
            <div class="quote-item-total">
              <span>Subtotal</span>
              <span class="mono">${fmtCad(it.subtotal)}</span>
            </div>
            <p class="fine quote-item-range">likely range ${fmtCad(it.rangeLow)} – ${fmtCad(it.rangeHigh)} · ≈ ${it.fieldDays} field day${it.fieldDays === 1 ? '' : 's'}</p>
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
        <span class="mono">Estimated total (${q.itemCount} item${q.itemCount === 1 ? '' : 's'}, ≈ ${q.totalFieldDays} field day${q.totalFieldDays === 1 ? '' : 's'})</span>
        <div class="quote-total-value">${fmtCad(q.subtotal)}</div>
        <p class="fine">likely range ${fmtCad(q.rangeLow)} – ${fmtCad(q.rangeHigh)}</p>
      </div>

      <div class="flag" data-severity="info" style="margin-top:1rem">
        <strong>Planning estimate only</strong>
        <p>${esc(q.disclaimer)}</p>
      </div>
    </section>`;
}

function paintCore(done) {
  $('report-core').innerHTML = CORE_LABELS.map(
    (label, n) => `
    <div class="step-row" data-done="${done ? '1' : '0'}"
         style="${done ? `background-color:${HORIZONS[n]}` : ''}">
      <span>${esc(label)}</span>
    </div>`
  ).join('');
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

main().catch((e) => {
  console.error(e);
  setError(e.message || 'Failed to start map');
  // still try fallback
  if (!state.map && !state.fallback) {
    initFallbackMap({ defaultCenter: { lat: 53.55, lng: -113.5 } });
  }
});
