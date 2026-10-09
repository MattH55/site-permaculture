/**
 * Walk-the-land viewer — a full-screen, true-scale (1 unit = 1 m) 3D model
 * of the property you can move around in, first- or third-person.
 *
 * Built from the same report the dashboard twin uses: HRDEM terrain (north
 * up — see lib/cog-lonlat-grid.js), satellite drape, every detected tree as
 * a 3D model (nature-kit CC0 GLBs scaled to its measured height), building
 * footprints, roads, mapped water bodies, the parcel boundary and the
 * recommended pond. Opened from the "Walk the land" button under the 3D
 * twin; closes with the × button or Esc.
 *
 * Controls
 *   W A S D / arrows   walk        Shift      run
 *   mouse (click first) look       V / button first ↔ third person
 *   Esc                 release the mouse, then close
 *
 * Global THREE (r147 UMD) and THREE.GLTFLoader are loaded by index.html.
 */

const TREE_GLB = {
  conifer: '/assets/nature-kit/tree_pineTallA.glb',
  deciduous: '/assets/nature-kit/tree_default.glb',
  deciduousB: '/assets/nature-kit/tree_oak.glb',
};
const EYE_HEIGHT_M = 1.7;
const WALK_MPS = 2.2;
const RUN_MPS = 6;
const THIRD_PERSON_DIST_M = 6;
const MAX_TREES = 600;

export function openWalkViewer(report, opts = {}) {
  if (typeof THREE === 'undefined') throw new Error('three.js not loaded');
  const prior = opts.prior || null;

  // ---------- geo frame (metres, +x east, −z north) ----------
  const ht = report?.hrdem_terrain;
  let rows, cols, elev;
  if (ht?.available && ht.elevations_m?.length) {
    rows = ht.rows; cols = ht.cols; elev = ht.elevations_m;
  } else {
    const g = report?.topology?.grid || {};
    rows = g.rows; cols = g.cols; elev = g.elevations_m;
  }
  const bboxArr = report?.geometry?.bbox || (ht?.bbox ? [ht.bbox.west, ht.bbox.south, ht.bbox.east, ht.bbox.north] : null);
  if (!bboxArr) throw new Error('report has no bbox');
  const [west, south, east, north] = bboxArr;
  const midLat = (north + south) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const widthM = (east - west) * mPerDegLon;
  const depthM = (north - south) * mPerDegLat;
  if (!rows || !cols || !elev?.length) { rows = 2; cols = 2; elev = [0, 0, 0, 0]; }
  const finite = elev.filter(Number.isFinite);
  const zMin = finite.length ? Math.min(...finite) : 0;
  const zMean = finite.length ? finite.reduce((s, z) => s + z, 0) / finite.length : 0;
  const heights = elev.map((z) => (Number.isFinite(z) ? z : zMean) - zMin);

  const toLocal = (lat, lon) => ({ x: (lon - west) * mPerDegLon - widthM / 2, z: depthM / 2 - (lat - south) * mPerDegLat });
  const toLatLon = (x, z) => ({ lon: west + (x + widthM / 2) / mPerDegLon, lat: south + (depthM / 2 - z) / mPerDegLat });
  const heightAt = (x, z) => {
    const gc = ((x + widthM / 2) / widthM) * (cols - 1);
    const gr = ((z + depthM / 2) / depthM) * (rows - 1);
    const c0 = Math.max(0, Math.min(cols - 2, Math.floor(gc)));
    const r0 = Math.max(0, Math.min(rows - 2, Math.floor(gr)));
    const fc = Math.max(0, Math.min(1, gc - c0));
    const fr = Math.max(0, Math.min(1, gr - r0));
    const h = (r, c) => heights[r * cols + c];
    return h(r0, c0) * (1 - fr) * (1 - fc) + h(r0, c0 + 1) * (1 - fr) * fc + h(r0 + 1, c0) * fr * (1 - fc) + h(r0 + 1, c0 + 1) * fr * fc;
  };

  // ---------- overlay DOM ----------
  const overlay = document.createElement('div');
  overlay.className = 'walk-viewer';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0f14;color:#eef1ea;font-family:"IBM Plex Mono",monospace;';
  overlay.innerHTML = `
    <div data-walk-hud style="position:absolute;top:10px;left:10px;z-index:2;display:flex;flex-direction:column;gap:6px;max-width:min(380px,calc(100vw - 100px));pointer-events:none">
      <div style="display:flex;gap:6px;pointer-events:auto;flex-wrap:wrap">
        <button type="button" data-walk-mode="first" style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid #9b8bbf;background:#5b3a73;color:#fff;border-radius:3px;cursor:pointer">1st person</button>
        <button type="button" data-walk-mode="third" style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid #6b6b6b;background:#1d2420;color:#eee;border-radius:3px;cursor:pointer">3rd person</button>
        <button type="button" data-walk-look style="font:inherit;font-size:12px;padding:6px 10px;border:1px solid #6b6b6b;background:#1d2420;color:#eee;border-radius:3px;cursor:pointer">🖱 Click to look</button>
      </div>
      <div data-walk-readout style="font-size:12px;line-height:1.5;background:rgba(10,15,20,0.72);padding:6px 9px;border-radius:3px"></div>
      <div style="font-size:11px;opacity:0.8;background:rgba(10,15,20,0.72);padding:5px 9px;border-radius:3px">W A S D walk · Shift run · mouse look · V switch view · Esc release / close</div>
    </div>
    <div data-walk-compass style="position:absolute;top:10px;right:56px;width:64px;height:64px;z-index:2;pointer-events:none">
      <svg viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
        <circle r="29" fill="rgba(10,15,20,0.72)" stroke="rgba(255,255,255,0.55)"/>
        <g data-walk-rose>
          <polygon points="0,-24 6,0 0,-4 -6,0" fill="#e24a3b"/><polygon points="0,24 6,0 0,4 -6,0" fill="#e8e0d0"/>
          <text x="0" y="-13" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">N</text>
          <text x="15" y="3.5" text-anchor="middle" font-size="8" fill="#ddd">E</text>
          <text x="0" y="19" text-anchor="middle" font-size="8" fill="#ddd">S</text>
          <text x="-15" y="3.5" text-anchor="middle" font-size="8" fill="#ddd">W</text>
        </g>
      </svg>
    </div>
    <button type="button" data-walk-close aria-label="Close walk view" style="position:absolute;top:10px;right:10px;z-index:3;width:36px;height:36px;font:inherit;font-size:18px;border:1px solid #6b6b6b;background:#1d2420;color:#eee;border-radius:3px;cursor:pointer">×</button>
    <div data-walk-status style="position:absolute;bottom:12px;left:12px;z-index:2;font-size:12px;background:rgba(10,15,20,0.72);padding:5px 9px;border-radius:3px">loading…</div>`;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const statusEl = $('[data-walk-status]');
  const readoutEl = $('[data-walk-readout]');
  const roseEl = $('[data-walk-rose]');

  // ---------- scene ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc7e8);
  scene.fog = new THREE.Fog(0x9fc7e8, Math.max(widthM, depthM) * 0.9, Math.max(widthM, depthM) * 3);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair';
  overlay.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xdcefff, 0x3a4a2e, 0.9));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(widthM * 0.6, Math.max(widthM, depthM) * 0.8, depthM * 0.5); // SE, high — afternoon-ish
  scene.add(sun);

  // Terrain (true metres). Row 0 = north = −z, matching the dashboard twin.
  const geom = new THREE.PlaneGeometry(widthM, depthM, cols - 1, rows - 1);
  geom.rotateX(-Math.PI / 2);
  const pos = geom.attributes.position.array;
  const colors = new Float32Array(pos.length);
  const relief = Math.max(...heights) || 1;
  for (let i = 0; i < rows * cols; i++) {
    pos[i * 3 + 1] = heights[i];
    const t = heights[i] / relief;
    colors[i * 3] = 0.28 + t * 0.12; colors[i * 3 + 1] = 0.42 + t * 0.2; colors[i * 3 + 2] = 0.2 + t * 0.08;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const terrain = new THREE.Mesh(geom, terrainMat);
  scene.add(terrain);
  // Surrounding ground so the horizon isn't a cliff at the bbox edge.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(widthM * 6, depthM * 6), new THREE.MeshLambertMaterial({ color: 0x4f6a3a }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  scene.add(apron);

  loadSatelliteDrape({ west, south, east, north }, geom, terrainMat).catch(() => {});

  // Parcel boundary.
  const ring = report?.geometry?.coordinates?.[0] || [];
  if (ring.length >= 4) {
    const pts = ring.map(([lon, lat]) => { const p = toLocal(lat, lon); return new THREE.Vector3(p.x, heightAt(p.x, p.z) + 0.3, p.z); });
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd23f })));
  }

  // Water bodies (mapped) — flat, slightly above ground.
  for (const wb of report?.surface_water?.water_bodies || []) {
    const r = wb.geometry?.coordinates?.[0];
    if (!r || r.length < 4) continue;
    const pts2 = r.map(([lon, lat]) => toLocal(lat, lon));
    const base = Math.min(...pts2.map((p) => heightAt(clampX(p.x), clampZ(p.z))));
    scene.add(flatPolygon(pts2, base + 0.08, 0x2a9dc9, 0.85));
  }
  // Recommended pond.
  const ps = report?.pond_scenarios;
  if (ps?.available && ps.pond_point) {
    const tier = ps.tiers?.find((t) => t.tier_id === ps.recommendation?.tier_id) || ps.tiers?.[0];
    const rM = Math.sqrt((tier?.surface_area_m2 || 100) / Math.PI);
    const p = toLocal(ps.pond_point.lat, ps.pond_point.lon);
    const y = heightAt(clampX(p.x), clampZ(p.z));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(rM, 40), new THREE.MeshLambertMaterial({ color: 0x2a7fb5, transparent: true, opacity: 0.9 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(p.x, y + 0.1, p.z); scene.add(pond);
    const rim = new THREE.Mesh(new THREE.RingGeometry(rM, rM * 1.15, 40), new THREE.MeshLambertMaterial({ color: 0x7a5c3e, side: THREE.DoubleSide }));
    rim.rotation.x = -Math.PI / 2; rim.position.set(p.x, y + 0.12, p.z); scene.add(rim);
  }
  // Buildings (footprint × height).
  for (const b of report?.buildings?.buildings || []) {
    const r = b.geometry?.coordinates?.[0] || b.footprint?.coordinates?.[0];
    if (!r || r.length < 4) continue;
    const pts2 = r.map(([lon, lat]) => toLocal(lat, lon));
    const base = Math.min(...pts2.map((p) => heightAt(clampX(p.x), clampZ(p.z))));
    const h = Math.max(Number(b.height_m) || 4, 2.5);
    const shape = new THREE.Shape(pts2.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xb8a892 }));
    m.position.y = base; scene.add(m);
  }
  // Roads (async GeoJSON from the dashboard, if it has them).
  Promise.resolve(typeof opts.roads === 'function' ? opts.roads() : opts.roads).then((gj) => {
    for (const f of gj?.features || []) {
      if (f.geometry?.type !== 'LineString') continue;
      const pts = f.geometry.coordinates.map(([lon, lat]) => { const p = toLocal(lat, lon); return new THREE.Vector3(p.x, heightAt(clampX(p.x), clampZ(p.z)) + 0.15, p.z); });
      if (pts.length > 1) scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8dcb0 })));
    }
  }).catch(() => {});

  // Trees — every detected instance as a 3D model at its measured height.
  const treeGroup = new THREE.Group(); scene.add(treeGroup);
  const instances = (report?.canopy?.tree_instances || []).slice(0, MAX_TREES);
  loadTreeTemplates().then((templates) => {
    let placed = 0;
    instances.forEach((t, i) => {
      const kind = treeKind(t, prior);
      const pool = (kind === 'conifer' ? [templates.conifer] : [templates.deciduous, templates.deciduousB]).filter(Boolean);
      if (!pool.length) return;
      const tpl = pool[Math.floor(jitter(i * 23 + 5) * pool.length) % pool.length];
      const box = new THREE.Box3().setFromObject(tpl);
      const srcH = Math.max(box.max.y - box.min.y, 0.001);
      const hM = Math.max(2, Math.min(30, Number(t.height_m) || 6));
      const s = hM / srcH;
      const m = tpl.clone(true);
      m.scale.setScalar(s);
      const p = toLocal(t.x, t.y); // canopy.js stores x = lat, y = lon
      if (p.x < -widthM / 2 || p.x > widthM / 2 || p.z < -depthM / 2 || p.z > depthM / 2) return;
      m.position.set(p.x, heightAt(p.x, p.z) - box.min.y * s, p.z);
      m.rotation.y = jitter(i * 31 + 7) * Math.PI * 2;
      treeGroup.add(m); placed++;
    });
    statusEl.textContent = `${placed} trees · ${Math.round(widthM)} × ${Math.round(depthM)} m · relief ${relief.toFixed(1)} m`;
  }).catch((e) => { statusEl.textContent = `trees failed to load: ${e.message}`; });

  // ---------- player / avatar ----------
  const player = { x: 0, z: 0, yaw: 0, pitch: -0.05, mode: 'first' };
  const parcelCentre = ring.length ? toLocal(ring.reduce((s, p) => s + p[1], 0) / ring.length, ring.reduce((s, p) => s + p[0], 0) / ring.length) : { x: 0, z: 0 };
  player.x = clampX(parcelCentre.x); player.z = clampZ(parcelCentre.z + Math.min(depthM * 0.2, 25));
  const avatar = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.0, 4, 10), new THREE.MeshLambertMaterial({ color: 0x5b3a73 }));
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshLambertMaterial({ color: 0xe9c9a8 }));
  head.position.y = 1.62;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0xe24a3b }));
  nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.6, -0.18);
  avatar.add(body, head, nose);
  avatar.visible = false;
  scene.add(avatar);

  function clampX(x) { return Math.max(-widthM / 2 + 1, Math.min(widthM / 2 - 1, x)); }
  function clampZ(z) { return Math.max(-depthM / 2 + 1, Math.min(depthM / 2 - 1, z)); }

  const keys = new Set();
  const onKey = (e) => {
    if (e.type === 'keydown' && e.key === 'Escape' && document.pointerLockElement !== renderer.domElement) { close(); return; }
    if (e.type === 'keydown' && (e.key === 'v' || e.key === 'V')) { setMode(player.mode === 'first' ? 'third' : 'first'); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.type === 'keydown') keys.add(k); else keys.delete(k);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);

  let dragging = false;
  let lastX = 0, lastY = 0;
  const look = (dx, dy) => {
    player.yaw -= dx * 0.0025;
    player.pitch = Math.max(-1.2, Math.min(1.2, player.pitch - dy * 0.0025));
  };
  const onMouseMove = (e) => {
    if (document.pointerLockElement === renderer.domElement) look(e.movementX, e.movementY);
    else if (dragging) { look(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
  };
  const onMouseDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.requestPointerLock?.(); };
  const onMouseUp = () => { dragging = false; };
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  $('[data-walk-look]').addEventListener('click', () => renderer.domElement.requestPointerLock?.());
  $('[data-walk-close]').addEventListener('click', close);
  overlay.querySelectorAll('[data-walk-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.getAttribute('data-walk-mode'))));

  function setMode(mode) {
    player.mode = mode;
    avatar.visible = mode === 'third';
    overlay.querySelectorAll('[data-walk-mode]').forEach((b) => {
      const on = b.getAttribute('data-walk-mode') === mode;
      b.style.background = on ? '#5b3a73' : '#1d2420';
      b.style.borderColor = on ? '#9b8bbf' : '#6b6b6b';
    });
  }
  setMode(opts.mode === 'third' ? 'third' : 'first');

  const clock = new THREE.Clock();
  let raf = null;
  const up = new THREE.Vector3(0, 1, 0);
  function step() {
    raf = requestAnimationFrame(step);
    const dt = Math.min(clock.getDelta(), 0.1);
    const run = keys.has('shift');
    const speed = run ? RUN_MPS : WALK_MPS;
    let fwd = 0, strafe = 0;
    if (keys.has('w') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('s') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('a') || keys.has('ArrowLeft')) strafe -= 1;
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe);
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); // yaw 0 faces north (−z)
      const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      player.x = clampX(player.x + ((fx * fwd + rx * strafe) / len) * speed * dt);
      player.z = clampZ(player.z + ((fz * fwd + rz * strafe) / len) * speed * dt);
      avatar.rotation.y = Math.atan2(-(fx * fwd + rx * strafe), -(fz * fwd + rz * strafe));
    }
    const ground = heightAt(player.x, player.z);
    const eye = new THREE.Vector3(player.x, ground + EYE_HEIGHT_M, player.z);
    const dir = new THREE.Vector3(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
    if (player.mode === 'first') {
      camera.position.copy(eye);
      camera.lookAt(eye.clone().add(dir));
    } else {
      avatar.position.set(player.x, ground, player.z);
      const back = dir.clone().multiplyScalar(-THIRD_PERSON_DIST_M);
      const camPos = eye.clone().add(back).add(up.clone().multiplyScalar(1.2));
      // Keep the chase camera above the terrain.
      camPos.y = Math.max(camPos.y, heightAt(clampX(camPos.x), clampZ(camPos.z)) + 0.8);
      camera.position.copy(camPos);
      camera.lookAt(eye.clone().add(up.clone().multiplyScalar(-0.3)));
    }
    const headingDeg = ((-player.yaw * 180) / Math.PI + 360) % 360;
    roseEl.setAttribute('transform', `rotate(${(-headingDeg).toFixed(0)})`);
    const ll = toLatLon(player.x, player.z);
    readoutEl.textContent = `${player.mode === 'first' ? '1st' : '3rd'} person · heading ${headingDeg.toFixed(0)}° ${compassName(headingDeg)} · ${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)} · ${(ground + zMin).toFixed(1)} m asl`;
    renderer.render(scene, camera);
  }
  function resize() {
    const w = overlay.clientWidth, h = overlay.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  step();

  function close() {
    if (raf) cancelAnimationFrame(raf);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('resize', resize);
    scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
    renderer.dispose();
    overlay.remove();
    delete window.__walkViewer;
  }

  const api = {
    close, setMode,
    // For automated checks: move/turn the player and read state.
    teleport(x, z, yawDeg) { player.x = clampX(x); player.z = clampZ(z); if (yawDeg != null) player.yaw = (-yawDeg * Math.PI) / 180; },
    state() { return { ...player, treeCount: treeGroup.children.length, widthM, depthM }; },
  };
  window.__walkViewer = api;
  return api;
}

// ---------- helpers ----------
const _tpl = new Map();
/**
 * The nature-kit GLBs ship with metallicFactor 1, which under a plain
 * directional/hemisphere light (no environment map) renders as near-black.
 * They are painted wood and leaves — make them matte.
 */
function matteTreeMaterials(root) {
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { if ('metalness' in m) { m.metalness = 0; m.roughness = 0.85; m.needsUpdate = true; } }
  });
  return root;
}

function loadTreeTemplates() {
  const load = (url) => {
    if (_tpl.has(url)) return _tpl.get(url);
    const p = new Promise((resolve) => {
      if (typeof THREE.GLTFLoader !== 'function') return resolve(null);
      new THREE.GLTFLoader().load(url, (g) => resolve(matteTreeMaterials(g.scene)), undefined, () => resolve(null));
    });
    _tpl.set(url, p);
    return p;
  };
  return Promise.all([load(TREE_GLB.conifer), load(TREE_GLB.deciduous), load(TREE_GLB.deciduousB)])
    .then(([conifer, deciduous, deciduousB]) => ({ conifer, deciduous, deciduousB }));
}

/** Same rule as public/tree-scale.js resolveTreeAsset(), without the import. */
function treeKind(t, prior) {
  if (t.form === 'conifer' || t.form === 'deciduous') return t.form;
  const h = Number(t.height_m) || 0, r = Number(t.crown_radius_m) || 0;
  if (h > 0 && r > 0 && h / r >= 5) return 'conifer';
  if (prior === 'conifer' || prior === 'deciduous') return prior;
  return h >= 14 ? 'conifer' : 'deciduous';
}

function jitter(i) { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); }

function compassName(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

function flatPolygon(pts2, y, color, opacity) {
  const shape = new THREE.Shape(pts2.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide }));
  m.position.y = y;
  return m;
}

/** Esri World Imagery tiles stitched over the bbox and mapped onto the terrain UVs. */
async function loadSatelliteDrape(bbox, geom, material) {
  const zoom = 17;
  const lat2t = (lat, z) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
  const lng2t = (lng, z) => (lng + 180) / 360 * 2 ** z;
  const t2lng = (x, z) => x / 2 ** z * 360 - 180;
  const t2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const x0 = Math.floor(lng2t(bbox.west, zoom)), x1 = Math.floor(lng2t(bbox.east, zoom));
  const y0 = Math.floor(lat2t(bbox.north, zoom)), y1 = Math.floor(lat2t(bbox.south, zoom));
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  if (tw * th > 64) return;
  const canvas = document.createElement('canvas');
  canvas.width = 256 * tw; canvas.height = 256 * th;
  const ctx = canvas.getContext('2d');
  await Promise.all(Array.from({ length: tw * th }, (_, k) => new Promise((resolve) => {
    const tx = x0 + (k % tw), ty = y0 + Math.floor(k / tw);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256, 256, 256); resolve(); };
    img.onerror = () => resolve();
    img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
  })));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const tWest = t2lng(x0, zoom), tEast = t2lng(x1 + 1, zoom), tNorth = t2lat(y0, zoom), tSouth = t2lat(y1 + 1, zoom);
  const uMin = (bbox.west - tWest) / (tEast - tWest), uMax = (bbox.east - tWest) / (tEast - tWest);
  const vNorth = 1 - (tNorth - bbox.north) / (tNorth - tSouth), vSouth = 1 - (tNorth - bbox.south) / (tNorth - tSouth);
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uMin + uv.getX(i) * (uMax - uMin), vSouth + uv.getY(i) * (vNorth - vSouth));
  }
  uv.needsUpdate = true;
  material.map = tex;
  material.vertexColors = false;
  material.color.set(0xffffff);
  material.needsUpdate = true;
}
