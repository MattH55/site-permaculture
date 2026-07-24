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
  windbreak: 'Windbreak',
  shelterbelt_zone: 'Shelterbelt zone',
  food_forest_guild: 'Food forest guild',
  herb_spiral: 'Herb spiral',
  keyhole_bed: 'Keyhole bed',
};

const CORE_LABELS = ['Elev', 'Slope', 'Water', 'Soil', 'Wind', 'Cover', 'Rules', 'Report'];
const HORIZONS = [
  'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)',
  'var(--h5)', 'var(--h6)', 'var(--h7)', 'var(--h8)',
];

const state = {
  config: null,
  map: null,
  shape: null, // google.maps.Polygon | Rectangle
  preview: null, // polyline while drawing
  vertexMarkers: [],
  paths: null, // [[lng, lat], ...]
  report: null,
  mode: 'google', // or 'fallback'
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
  $('btn-cancel-load')?.addEventListener('click', () => {
    state._reportAbort?.abort();
    clearInterval(state._loadTimer);
    showLoading(false);
    setError('Cancelled.');
  });
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
    mapTypeId: 'terrain',
    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      mapTypeIds: ['terrain', 'hybrid', 'roadmap', 'satellite'],
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
  const els = r.design_elements || [];
  const flags = r._meta?.flags || [];
  const a = r.analysis || {};
  const exportObj = { ...r };
  delete exportObj._meta;

  $('report').innerHTML = `
    <div class="panel fade">
      <span class="mono eyebrow">Expanding Edge · Alberta map → report</span>
      <h1>${esc(r.site_name || 'Your parcel')}</h1>
      <div class="score-row">
        <span class="score">${els.length}</span>
        <span class="score-of">design elements recommended</span>
      </div>
      <p class="lede">
        ${esc(r.location?.municipality || r.location?.nearest_town || 'Alberta')}
        ${r.geometry?.area_ha != null ? ` · ${esc(r.geometry.area_ha)} ha` : ''}
        ${r.climate?.plant_hardiness_zone ? ` · zone ${esc(r.climate.plant_hardiness_zone)}` : ''}
        ${r.hydrology?.watershed ? ` · ${esc(r.hydrology.watershed)}` : ''}
        ${a.hrdem?.available ? ' · HRDEM LiDAR available' : ''}
      </p>

      <div class="summary-grid">
        <div class="stat"><span class="k">Elevation</span><strong>${fmt(a.elevation?.mean_m, 'm')}</strong></div>
        <div class="stat"><span class="k">Slope</span><strong>${fmt(r.terrain?.slope_percent, '%')}</strong></div>
        <div class="stat"><span class="k">Aspect</span><strong>${esc(r.terrain?.aspect || '—')}</strong></div>
        <div class="stat"><span class="k">Landform</span><strong>${esc((r.terrain?.landform_position || '—').replace(/_/g, ' '))}</strong></div>
        <div class="stat"><span class="k">Wetland</span><strong>${a.wetlands?.present ? esc(a.wetlands.class || 'yes') : 'none detected'}</strong></div>
        <div class="stat"><span class="k">Soil group</span><strong>${esc(a.soils?.group || r.soil?.soil_series || '—')}</strong></div>
        <div class="stat"><span class="k">Wind</span><strong>${esc(r.climate?.prevailing_wind_direction || '—')}</strong></div>
        <div class="stat"><span class="k">Precip (est.)</span><strong>${fmt(r.hydrology?.annual_precipitation_mm, 'mm')}</strong></div>
      </div>

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

      <h2>Placement recommendations</h2>
      <p class="fine" style="margin-top:-0.3rem">From live layers + the Alberta if→then ruleset. Confidence reflects data completeness and risk.</p>
      <div class="elements">
        ${
          els.length
            ? els
                .map(
                  (e) => `
          <article class="el">
            <div class="el-head">
              <h3>${esc(ELEMENT_LABELS[e.element_type] || e.element_type)}</h3>
              <span class="badge zone">Zone ${esc(e.zone)}</span>
              ${confBadge(e.confidence)}
            </div>
            <div class="basis">${esc(e.condition_basis)}</div>
            <p>${esc(e.placement_notes)}</p>
          </article>`
                )
                .join('')
            : '<p class="fine">No elements matched — try a larger parcel or different ground.</p>'
        }
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
              ? `<li>DEM samples: ${esc(a.elevation.source)} (${esc(a.elevation.grid)} grid, ${esc(a.elevation.samples)} pts)</li>`
              : ''
          }
          ${
            a.hrdem?.note
              ? `<li>HRDEM: ${esc(a.hrdem.note)}${
                  a.hrdem.projects?.length
                    ? ` [${a.hrdem.projects.map(esc).join(', ')}]`
                    : ''
                }</li>`
              : ''
          }
          ${
            a.wet_areas?.predicted_stream_count != null
              ? `<li>Predicted streams in box: ${esc(a.wet_areas.predicted_stream_count)}</li>`
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
        Planning guidance for conversation with Expanding Edge — not engineered drawings.
        (780) 236-3630 · <a href="mailto:info@expandingedge.ca">info@expandingedge.ca</a>
        ${r._meta?.duration_ms ? ` · generated in ${Math.round(r._meta.duration_ms / 100) / 10}s` : ''}
        ${r._meta?.cache === 'hit' ? ' · cached' : ''}
      </p>
    </div>`;

  $('btn-again-map').onclick = () => {
    clearShape();
    showMap();
  };
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
