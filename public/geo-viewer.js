/**
 * Geo Feature Overlay Viewer
 * 
 * Standalone 3D terrain viewer with semantic feature overlays from Alberta open data.
 * Fetches water, wetlands, buildings, roads from ESRI REST / GeoJSON sources,
 * reprojects to WGS84, and renders as Three.js meshes draped on HRDEM terrain.
 */

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Default bbox (Sturgeon County area) - can be overridden via URL params
  defaultBbox: { west: -113.7, south: 53.6, east: -113.4, north: 53.9 },
  
  // Terrain mesh resolution
  meshSize: 256,
  
  // No vertical exaggeration - use true scale
  relief: 1,
  
  // Layer colors (matching geo-overlay-renderer.js palette)
  colors: {
    water: 0x2060a0,
    wetlands: 0x40a080,
    buildings: 0x888888,
    roads: 0xc8a040,
    railways: 0x705030,
    landcover: 0x999999,
    infrastructure: 0xcc4444,
    terrain: 0x6b8c42,
    contour: 0x000000,
  },
  
  // Layer opacity
  opacity: {
    water: 0.92,
    wetlands: 0.55,
    buildings: 0.85,
    roads: 1.0,
    overlayDefault: 0.85,
  },
  
  // ESRI REST endpoints (Alberta)
  endpoints: {
    hydrography: 'https://geospatial.alberta.ca/titan/rest/services/environment/inland_base_hydrography_update_10tm_nad83_aep/MapServer',
    wetlands: 'https://geospatial.alberta.ca/titan/rest/services/environment/alberta_merged_wetland_inventory/MapServer',
  },
};

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  terrain: null,      // { mesh, grid, bbox, width, height, zMin, zMax }
  groups: {},         // layer name → THREE.Group
  features: [],       // normalized feature objects
  animId: null,
  disposed: false,
  lastFrameTime: 0,
  frameCount: 0,
  fpsUpdateTime: 0,
};

// ── Initialization ───────────────────────────────────────────────────────────

async function init() {
  const container = document.getElementById('canvas-container');
  const loading = document.getElementById('loading');
  const loadingDetail = document.getElementById('loading-detail');
  
  try {
    // Parse URL params for bbox override
    const params = new URLSearchParams(window.location.search);
    const bbox = parseBboxParam(params) || CONFIG.defaultBbox;
    
    updateStatus('bbox', `${bbox.west.toFixed(3)}, ${bbox.south.toFixed(3)}, ${bbox.east.toFixed(3)}, ${bbox.north.toFixed(3)}`);
    
    // Setup Three.js scene
    loadingDetail.textContent = 'Setting up 3D scene…';
    setupScene(container);
    
    // Fetch terrain
    loadingDetail.textContent = 'Fetching HRDEM elevation…';
    await fetchTerrain(bbox);
    
    // Build terrain mesh
    loadingDetail.textContent = 'Building terrain mesh…';
    buildTerrainMesh();
    
    // Build contour lines
    loadingDetail.textContent = 'Generating contours…';
    buildContourLines();
    
    // Hide loading
    loading.classList.add('hidden');
    
    // Start render loop
    animate();
    
    // Setup controls
    setupUIControls();
    
  } catch (err) {
    console.error('Init failed:', err);
    showError(err.message || 'Failed to initialize viewer');
    loading.classList.add('hidden');
  }
}

// ── Scene Setup ──────────────────────────────────────────────────────────────

function setupScene(container) {
  // Scene
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x1a1a2e);
  state.scene.fog = new THREE.Fog(0x1a1a2e, 500, 2000);
  
  // Camera
  const aspect = container.clientWidth / container.clientHeight;
  state.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
  
  // Renderer
  state.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  state.renderer.setSize(container.clientWidth, container.clientHeight);
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(state.renderer.domElement);
  
  // Controls
  state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.05;
  state.controls.maxPolarAngle = Math.PI * 0.45;
  state.controls.minDistance = 10;
  state.controls.maxDistance = 1500;
  
  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  state.scene.add(ambientLight);
  
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
  sunLight.position.set(200, 300, 100);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 1000;
  sunLight.shadow.camera.left = -300;
  sunLight.shadow.camera.right = 300;
  sunLight.shadow.camera.top = 300;
  sunLight.shadow.camera.bottom = -300;
  state.scene.add(sunLight);
  
  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-100, 50, -100);
  state.scene.add(fillLight);
  
  // Create layer groups
  const layerNames = ['terrain', 'contours', 'wireframe', 'water', 'wetlands', 'buildings', 'roads'];
  for (const name of layerNames) {
    const group = new THREE.Group();
    group.name = name;
    state.groups[name] = group;
    state.scene.add(group);
  }
  
  // Resize handler
  window.addEventListener('resize', onResize);
}

function onResize() {
  const container = document.getElementById('canvas-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  
  state.camera.aspect = w / h;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(w, h);
}

// ── Terrain Fetching ─────────────────────────────────────────────────────────

async function fetchTerrain(bbox) {
  // Try HRDEM first via our API
  const url = `/api/hrdem?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&resolution=10`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HRDEM fetch failed: ${res.status}`);
    
    const data = await res.json();
    
    if (data.grid && Array.isArray(data.grid) && data.grid.length > 0) {
      state.terrain = {
        grid: data.grid,
        width: data.width || Math.sqrt(data.grid.length),
        height: data.height || Math.sqrt(data.grid.length),
        bbox: bbox,
        zMin: data.zMin ?? Math.min(...data.grid.filter(v => v != null)),
        zMax: data.zMax ?? Math.max(...data.grid.filter(v => v != null)),
        cellSize: data.cellSize || (bbox.east - bbox.west) / (data.width || 256),
      };
      return;
    }
  } catch (err) {
    console.warn('HRDEM fetch failed, using synthetic terrain:', err.message);
  }
  
  // Fallback: generate synthetic terrain from bbox
  generateSyntheticTerrain(bbox);
}

function generateSyntheticTerrain(bbox) {
  const size = CONFIG.meshSize;
  const grid = new Float32Array(size * size);
  
  // Generate rolling hills using sine waves
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = col / size;
      const y = row / size;
      
      // Base elevation gradient (north-south)
      let elev = 600 + y * 100;
      
      // Add some hills
      elev += Math.sin(x * 8) * 20;
      elev += Math.cos(y * 6) * 15;
      elev += Math.sin((x + y) * 12) * 10;
      
      grid[row * size + col] = elev;
    }
  }
  
  state.terrain = {
    grid,
    width: size,
    height: size,
    bbox,
    zMin: 580,
    zMax: 750,
    cellSize: (bbox.east - bbox.west) / size,
  };
}

// ── Terrain Mesh Building ────────────────────────────────────────────────────

function buildTerrainMesh() {
  const { grid, width, height, bbox, zMin, zMax } = state.terrain;
  const relief = CONFIG.relief;
  
  // Calculate mesh dimensions
  const meshW = 400;
  const meshH = 400;
  
  // Create plane geometry
  const geo = new THREE.PlaneGeometry(meshW, meshH, width - 1, height - 1);
  geo.rotateX(-Math.PI / 2);
  
  const positions = geo.attributes.position.array;
  const colors = new Float32Array(positions.length);
  
  const zRange = zMax - zMin || 1;
  
  for (let i = 0; i < width * height; i++) {
    const row = Math.floor(i / width);
    const col = i % width;
    
    const elev = grid[i] ?? zMin;
    const normalizedElev = (elev - zMin) / zRange;
    
    // Set Y position (height)
    positions[i * 3 + 1] = (elev - zMin) * relief;
    
    // Color based on elevation
    const color = getTerrainColor(normalizedElev);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: false,
  });
  
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  
  state.groups.terrain.add(mesh);
  state.terrain.mesh = mesh;
  
  // Position camera
  state.camera.position.set(meshW * 0.5, Math.max(relief * 50, 200), meshH * 1.2);
  state.controls.target.set(meshW * 0.5, 0, meshH * 0.5);
  state.controls.update();
}

function getTerrainColor(t) {
  // Color ramp: low (green-brown) → high (grey-white)
  if (t < 0.2) return { r: 0.42, g: 0.55, b: 0.26 };      // Lowland green
  if (t < 0.4) return { r: 0.52, g: 0.58, b: 0.32 };      // Mid green
  if (t < 0.6) return { r: 0.62, g: 0.58, b: 0.42 };      // Brown
  if (t < 0.8) return { r: 0.68, g: 0.65, b: 0.58 };      // Light brown
  return { r: 0.78, g: 0.78, b: 0.75 };                    // Highland grey
}

// ── Contour Lines ────────────────────────────────────────────────────────────

function buildContourLines() {
  const { grid, width, height, zMin, zMax } = state.terrain;
  const relief = CONFIG.relief;
  const meshW = 400;
  const meshH = 400;
  
  // Contour interval (meters)
  const interval = 5;
  const levels = [];
  for (let z = Math.ceil(zMin / interval) * interval; z <= zMax; z += interval) {
    levels.push(z);
  }
  
  const points = [];
  
  for (const level of levels) {
    // March through grid looking for contour crossings
    for (let row = 0; row < height - 1; row++) {
      for (let col = 0; col < width - 1; col++) {
        const i = row * width + col;
        const e00 = grid[i];
        const e10 = grid[i + 1];
        const e01 = grid[i + width];
        const e11 = grid[i + width + 1];
        
        // Check edges for crossings
        checkEdge(e00, e10, level, col, row, col + 1, row, points, meshW, meshH, width, height, relief, zMin);
        checkEdge(e00, e01, level, col, row, col, row + 1, points, meshW, meshH, width, height, relief, zMin);
      }
    }
  }
  
  if (points.length > 0) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ 
      color: CONFIG.colors.contour, 
      transparent: true, 
      opacity: 0.25 
    });
    const lines = new THREE.LineSegments(geo, mat);
    state.groups.contours.add(lines);
  }
}

function checkEdge(e0, e1, level, c0, r0, c1, r1, points, meshW, meshH, width, height, relief, zMin) {
  if ((e0 < level && e1 >= level) || (e0 >= level && e1 < level)) {
    const t = (level - e0) / (e1 - e0);
    const col = c0 + t * (c1 - c0);
    const row = r0 + t * (r1 - r0);
    
    // Match terrain mesh coordinate mapping exactly
    // PlaneGeometry after rotateX(-PI/2):
    //   X axis maps to columns (west→east)
    //   Z axis is INVERTED relative to row index (row 0 = north = high Z after rotation)
    //   Y axis is up (elevation)
    // Reflect Z over the long axis: row 0 → meshH, row max → 0
    const x = (col / (width - 1)) * meshW;
    const z = meshH - (row / (height - 1)) * meshH;
    const y = (level - zMin) * relief;
    
    points.push(new THREE.Vector3(x, y, z));
  }
}

// ── Feature Fetching ─────────────────────────────────────────────────────────

async function fetchFeatures() {
  const loading = document.getElementById('loading');
  const loadingDetail = document.getElementById('loading-detail');
  
  loading.classList.remove('hidden');
  
  const bbox = state.terrain.bbox;
  const allFeatures = [];
  
  try {
    // Fetch water features
    loadingDetail.textContent = 'Fetching water features…';
    const waterFeatures = await fetchEsriFeatures(CONFIG.endpoints.hydrography, bbox, 'water');
    allFeatures.push(...waterFeatures);
    updateLayerCount('water', waterFeatures.length);
    
    // Fetch wetlands
    loadingDetail.textContent = 'Fetching wetlands…';
    const wetlandFeatures = await fetchEsriFeatures(CONFIG.endpoints.wetlands, bbox, 'wetlands');
    allFeatures.push(...wetlandFeatures);
    updateLayerCount('wetlands', wetlandFeatures.length);
    
    // Store features
    state.features = allFeatures;
    updateStatus('features', allFeatures.length.toString());
    
    // Render features
    loadingDetail.textContent = 'Rendering features…';
    renderFeatures(allFeatures);
    
  } catch (err) {
    console.error('Feature fetch failed:', err);
    showError('Failed to fetch features: ' + err.message);
  } finally {
    loading.classList.add('hidden');
  }
}

async function fetchEsriFeatures(baseUrl, bbox, layer) {
  // Convert bbox to EPSG:3400 (Alberta 10TM) for ESRI query
  // For simplicity, we'll use lon/lat bbox directly with inSR=4326
  const geometry = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  
  // Query multiple layers (0-5 typically contain different feature types)
  const features = [];
  
  for (let layerId = 0; layerId <= 3; layerId++) {
    try {
      const url = `${baseUrl}/${layerId}/query?` + new URLSearchParams({
        geometry,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outFields: '*',
        outSR: '4326',
        f: 'geojson',
        returnGeometry: 'true',
      });
      
      const res = await fetch(url);
      if (!res.ok) continue;
      
      const data = await res.json();
      if (data.features) {
        for (const f of data.features) {
          features.push({
            ...f,
            layer,
            sourceLayer: layerId,
          });
        }
      }
    } catch (err) {
      console.warn(`Layer ${layerId} fetch failed:`, err);
    }
  }
  
  return features;
}

// ── Feature Rendering ────────────────────────────────────────────────────────

function renderFeatures(features) {
  // Clear existing feature meshes
  for (const layerName of ['water', 'wetlands', 'buildings', 'roads']) {
    const group = state.groups[layerName];
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      group.remove(child);
    }
  }
  
  const { bbox } = state.terrain;
  const meshW = 400;
  const meshH = 400;
  
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;
    
    const layerName = feature.layer;
    const group = state.groups[layerName];
    if (!group) continue;
    
    const color = CONFIG.colors[layerName] || 0xaaaaaa;
    const opacity = CONFIG.opacity[layerName] || CONFIG.opacity.overlayDefault;
    
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
      
      for (const rings of polygons) {
        const points = [];
        for (const ring of rings) {
          for (const [lng, lat] of ring) {
            const x = ((lng - bbox.west) / (bbox.east - bbox.west)) * meshW;
            // Reflect Z over long axis to match contour orientation
            const z = meshH - ((lat - bbox.south) / (bbox.north - bbox.south)) * meshH;
            const elev = sampleTerrainAt(lng, lat);
            const y = (elev - state.terrain.zMin) * CONFIG.relief + 0.2;
            points.push(new THREE.Vector3(x, y, z));
          }
        }
        
        if (points.length >= 3) {
          const shape = new THREE.Shape(points);
          const shapeGeo = new THREE.ShapeGeometry(shape);
          shapeGeo.rotateX(-Math.PI / 2);
          
          const mat = new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            roughness: 0.7,
          });
          
          const mesh = new THREE.Mesh(shapeGeo, mat);
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    } else if (geom.type === 'LineString') {
      const points = [];
      for (const [lng, lat] of geom.coordinates) {
        const x = ((lng - bbox.west) / (bbox.east - bbox.west)) * meshW;
        // Reflect Z over long axis to match contour orientation
        const z = meshH - ((lat - bbox.south) / (bbox.north - bbox.south)) * meshH;
        const elev = sampleTerrainAt(lng, lat);
        const y = (elev - state.terrain.zMin) * CONFIG.relief + 0.2;
        points.push(new THREE.Vector3(x, y, z));
      }
      
      if (points.length >= 2) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({ 
          color, 
          linewidth: 2,
          transparent: true,
          opacity,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        group.add(line);
      }
    }
  }
}

function sampleTerrainAt(lng, lat) {
  const { grid, width, height, bbox, zMin } = state.terrain;
  
  // Match terrain mesh coordinate mapping:
  // Terrain mesh iterates i from 0 to width*height-1
  // row = floor(i / width), col = i % width
  // x = (col / (width-1)) * meshW  → lng maps to col
  // z = (row / (height-1)) * meshH → lat maps to row
  const col = ((lng - bbox.west) / (bbox.east - bbox.west)) * (width - 1);
  const row = ((lat - bbox.south) / (bbox.north - bbox.south)) * (height - 1);

  // Bilinear interpolation for smoother sampling
  const c0 = Math.max(0, Math.min(width - 2, Math.floor(col)));
  const r0 = Math.max(0, Math.min(height - 2, Math.floor(row)));
  const fc = Math.max(0, Math.min(1, col - c0));
  const fr = Math.max(0, Math.min(1, row - r0));

  const e00 = grid[r0 * width + c0] ?? zMin;
  const e10 = grid[r0 * width + c0 + 1] ?? e00;
  const e01 = grid[(r0 + 1) * width + c0] ?? e00;
  const e11 = grid[(r0 + 1) * width + c0 + 1] ?? e00;

  return e00 * (1 - fr) * (1 - fc) + e10 * (1 - fr) * fc + e01 * fr * (1 - fc) + e11 * fr * fc;
}

// ── UI Controls ──────────────────────────────────────────────────────────────

function setupUIControls() {
  // Layer toggles
  document.querySelectorAll('[data-layer]').forEach(cb => {
    cb.addEventListener('change', () => {
      const layer = cb.getAttribute('data-layer');
      const group = state.groups[layer];
      if (group) {
        group.visible = cb.checked;
      }
    });
  });
  
  // Relief slider removed - using fixed scale of 1

  // Opacity slider
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityVal = document.getElementById('opacity-val');
  opacitySlider.addEventListener('input', () => {
    const val = parseFloat(opacitySlider.value);
    opacityVal.textContent = Math.round(val * 100) + '%';
    updateOverlayOpacity(val);
  });

  // Reset button
  document.getElementById('btn-reset').addEventListener('click', () => {
    const meshW = 400;
    const meshH = 400;
    state.camera.position.set(meshW * 0.5, Math.max(CONFIG.relief * 50, 200), meshH * 1.2);
    state.controls.target.set(meshW * 0.5, 0, meshH * 0.5);
    state.controls.update();
  });
  
  // Screenshot button
  document.getElementById('btn-screenshot').addEventListener('click', () => {
    state.renderer.render(state.scene, state.camera);
    const link = document.createElement('a');
    link.download = `geo-viewer-${Date.now()}.png`;
    link.href = state.renderer.domElement.toDataURL('image/png');
    link.click();
  });
  
  // Fetch features button
  document.getElementById('btn-fetch').addEventListener('click', fetchFeatures);
}

function rebuildTerrainHeight() {
  const { grid, width, height, zMin } = state.terrain;
  const relief = CONFIG.relief;
  const mesh = state.terrain.mesh;
  
  if (!mesh) return;
  
  const positions = mesh.geometry.attributes.position.array;
  
  for (let i = 0; i < width * height; i++) {
    const elev = grid[i] ?? zMin;
    positions[i * 3 + 1] = (elev - zMin) * relief;
  }
  
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  
  // Rebuild contours
  const contourGroup = state.groups.contours;
  while (contourGroup.children.length > 0) {
    const child = contourGroup.children[0];
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
    contourGroup.remove(child);
  }
  buildContourLines();
  
  // Re-render features if present
  if (state.features.length > 0) {
    renderFeatures(state.features);
  }
}

function updateOverlayOpacity(opacity) {
  for (const layerName of ['water', 'wetlands', 'buildings', 'roads']) {
    const group = state.groups[layerName];
    if (!group) continue;
    
    group.traverse(obj => {
      if (obj.material && obj.material.transparent) {
        obj.material.opacity = opacity;
        obj.material.needsUpdate = true;
      }
    });
  }
}

// ── Animation Loop ───────────────────────────────────────────────────────────

function animate() {
  if (state.disposed) return;
  
  state.animId = requestAnimationFrame(animate);
  
  const now = performance.now();
  state.frameCount++;
  
  // Update FPS every second
  if (now - state.fpsUpdateTime >= 1000) {
    const fps = Math.round(state.frameCount * 1000 / (now - state.fpsUpdateTime));
    updateStatus('fps', fps.toString());
    state.frameCount = 0;
    state.fpsUpdateTime = now;
  }
  
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

// ── Utilities ────────────────────────────────────────────────────────────────

function parseBboxParam(params) {
  const bboxStr = params.get('bbox');
  if (!bboxStr) return null;
  
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  
  return { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
}

function updateStatus(key, value) {
  const el = document.getElementById(`status-${key}`);
  if (el) el.textContent = value;
}

function updateLayerCount(layer, count) {
  const el = document.getElementById(`count-${layer}`);
  if (el) el.textContent = count.toString();
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) {
    el.textContent = msg;
    el.classList.add('visible');
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

function dispose() {
  state.disposed = true;
  
  if (state.animId) cancelAnimationFrame(state.animId);
  
  window.removeEventListener('resize', onResize);
  
  // Dispose all geometries and materials
  state.scene.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
  
  state.renderer.dispose();
  state.controls.dispose();
}

// ── Entry Point ──────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', dispose);