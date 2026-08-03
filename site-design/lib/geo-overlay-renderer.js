/**
 * Three.js overlay renderer for geo-feature layers.
 *
 * Takes normalized feature objects (from geo-overlays.js) and renders them
 * as 3D objects on the HRDEM terrain mesh with per-layer color coding and
 * opacity controls.
 *
 * Layer palette:
 *   water       — deep blue (#2060a0), opaque polygons + lines
 *   wetlands    — teal (#40a080), semi-transparent fill
 *   buildings   — grey (#888), extruded boxes
 *   roads       — amber (#c8a040), raised lines
 *   railways    — dark brown (#705030), dashed lines
 *   landcover   — categorical grid
 */

import * as THREE from 'three';

// ── Layer colour map ────────────────────────────────────────────────────────

const LAYER_COLORS = {
  water: 0x2060a0,
  wetlands: 0x40a080,
  buildings: 0x888888,
  roads: 0xc8a040,
  railways: 0x705030,
  landcover: 0x999999,
  infrastructure: 0xcc4444,
};

const LAYER_OPAQUE = {
  water: true,
  wetlands: false,
  buildings: true,
  roads: true,
  railways: true,
  landcover: false,
  infrastructure: true,
};

const LAYER_OPACITY = {
  water: 0.92,
  wetlands: 0.55,
  buildings: 0.85,
  roads: 1.0,
  railways: 1.0,
  landcover: 0.45,
  infrastructure: 0.9,
};

// ── Terrain helpers ─────────────────────────────────────────────────────────

/**
 * Sample terrain height at WGS84 [lng, lat] using bilinear interpolation.
 * @param {object} terrain — { width, height, zMin, relHt, originLng, originLat, cellSize }
 */
function sampleTerrain(terrain, lng, lat) {
  if (!terrain || !terrain.grid) return 0;
  const { grid, originLng, originLat, cellSize, width, height, zMin, relHt } = terrain;
  const col = Math.round((lng - originLng) / cellSize);
  const row = Math.round((lat - originLat) / cellSize);
  if (col < 0 || col >= width || row < 0 || row >= height) return 0;
  const elev = grid[row * width + col];
  if (elev == null || elev === 0) return 0;
  return zMin + elev * relHt;
}

/** Convert WGS84 [lng, lat] → local mesh coordinates [x, y=height, z]. */
function lonLatToWorld(terrain, lng, lat) {
  const elev = sampleTerrain(terrain, lng, lat);
  // Map lng/lat offset to mesh x/z relative to terrain centre
  const dx = (lng - (terrain.originLng + terrain.width * terrain.cellSize / 2)) / terrain.cellSize;
  const dz = (lat - (terrain.originLat + terrain.height * terrain.cellSize / 2)) / terrain.cellSize;
  return [dx, elev, dz];
}

// ── Feature geometry → Three.js object ──────────────────────────────────────

/**
 * Create a Three.js group for a single feature.
 * @param {object} feature — normalized feature object
 * @param {number} lift — vertical lift above terrain
 * @returns {THREE.Object3D|null}
 */
function featureToMesh(feature, lift = 0.5) {
  const geom = feature.geometry;
  if (!geom) return null;

  switch (geom.type) {
    case 'Polygon':
      return polygonToMesh(geom.coordinates, feature, lift);
    case 'MultiPolygon':
      return multiPolygonToMesh(geom.coordinates, feature, lift);
    case 'LineString':
      return lineToMesh(geom.coordinates, feature);
    case 'Point':
      return pointToMesh(geom.coordinates, feature, lift);
    default:
      return null;
  }
}

function polygonToMesh(coords, feature, lift) {
  const color = LAYER_COLORS[feature.layer] || 0xaaaaaa;
  const opacity = LAYER_OPACITY[feature.layer] ?? 0.8;
  const transparent = !LAYER_OPAQUE[feature.layer];

  // Flatten ring vertices to world space
  const positions = [];
  for (const ring of coords) {
    for (const [lng, lat] of ring) {
      const [x, y, z] = lonLatToWorld(_terrain, lng, lat);
      positions.push(x, y + lift, z);
    }
  }

  if (positions.length < 9) return null;

  // Build a simple filled polygon (flat on terrain)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  // Try to triangulate (fan triangulation for convex-ish polygons)
  const indices = [];
  for (let i = 1; i < positions.length / 3 - 1; i++) {
    indices.push(0, i, i + 1);
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent,
    opacity,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.1,
  });

  return new THREE.Mesh(geo, mat);
}

function multiPolygonToMesh(coords, feature, lift) {
  const group = new THREE.Group();
  for (const poly of coords) {
    const mesh = polygonToMesh([poly], feature, lift);
    if (mesh) group.add(mesh);
  }
  return group.children.length ? group : null;
}

function lineToMesh(coords, feature) {
  const color = LAYER_COLORS[feature.layer] || 0xaaaaaa;

  const positions = [];
  for (const [lng, lat] of coords) {
    const [x, y, z] = lonLatToWorld(_terrain, lng, lat);
    positions.push(x, y + 0.3, z); // slight lift above terrain
  }

  if (positions.length < 6) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const mat = new THREE.LineBasicMaterial({ color });
  return new THREE.Line(geo, mat);
}

function pointToMesh(coords, feature, lift) {
  const color = LAYER_COLORS[feature.layer] || 0xaaaaaa;
  const [x, y, z] = lonLatToWorld(_terrain, coords[0], coords[1]);

  const size = feature.feature_type === 'building' ? 2.0 : 1.0;
  const geo = new THREE.BoxGeometry(size, size * 2, size);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: !LAYER_OPAQUE[feature.layer],
    opacity: LAYER_OPACITY[feature.layer] ?? 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y + lift, z);
  return mesh;
}

// Shared terrain reference (set by initOverlayRenderer)
let _terrain = null;

// ── Overlay renderer class ──────────────────────────────────────────────────

export class GeoOverlayRenderer {
  constructor() {
    /** Map<layerName, THREE.Group> */
    this.groups = new Map();
    /** Map<layerName, boolean> visibility */
    this.visibility = new Map();
    this._scene = null;
    this._initialized = false;
  }

  /**
   * Initialize with the scene and terrain model.
   * @param {THREE.Scene} scene
   * @param {object} terrain — terrain mesh metadata
   */
  init(scene, terrain) {
    this._scene = scene;
    _terrain = terrain;
    this._initialized = true;
    return this;
  }

  /**
   * Load overlay features and render them.
   * @param {object} result — from fetchGeoOverlays()
   */
  load(result) {
    if (!this._initialized || !this._scene) return this;

    // Clear existing
    this.clear();

    const features = result.features || [];
    const layerResults = result.layer_results || {};

    // Group features by layer
    for (const feature of features) {
      const layer = feature.layer || 'unknown';
      if (!this.groups.has(layer)) {
        this.groups.set(layer, new THREE.Group());
        this.visibility.set(layer, true);
        this._scene.add(this.groups.get(layer));
      }
      const group = this.groups.get(layer);
      const mesh = featureToMesh(feature, 0.2);
      if (mesh) {
        mesh.userData.semanticFeature = feature;
        group.add(mesh);
      }
    }

    // Set layer-level opacity
    for (const [layer, group] of this.groups) {
      group.traverse((child) => {
        if (child.isMesh && child.material) {
          const baseOpacity = LAYER_OPACITY[layer] ?? 0.8;
          if (Array.isArray(child.material)) {
            for (const m of child.material) {
              m.opacity = baseOpacity;
              m.transparent = !LAYER_OPAQUE[layer];
            }
          } else {
            child.material.opacity = baseOpacity;
            child.material.transparent = !LAYER_OPAQUE[layer];
          }
        }
      });
    }

    console.log(`geo-overlay: loaded ${features.length} features across ${this.groups.size} layers`);
    return this;
  }

  /**
   * Toggle layer visibility.
   * @param {string} layer
   * @param {boolean} visible
   */
  setLayerVisibility(layer, visible) {
    const group = this.groups.get(layer);
    if (!group) return false;
    group.visible = visible;
    this.visibility.set(layer, visible);
    return true;
  }

  /** Get layer visibility. */
  getLayerVisibility(layer) {
    return this.visibility.get(layer) ?? true;
  }

  /** Get all available layers. */
  getLayers() {
    return Array.from(this.groups.keys()).map((layer) => ({
      layer,
      label: this._layerLabel(layer),
      count: this.groups.get(layer)?.children.length || 0,
      visible: this.getLayerVisibility(layer),
      color: '#' + (LAYER_COLORS[layer] || 0xaaaaaa).toString(16).padStart(6, '0'),
    }));
  }

  /** Clear all overlays. */
  clear() {
    for (const [, group] of this.groups) {
      this._scene?.remove(group);
      group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            for (const m of child.material) m.dispose();
          } else {
            child.material.dispose();
          }
        }
      });
    }
    this.groups.clear();
    this.visibility.clear();
    return this;
  }

  /** Dispose resources. */
  dispose() {
    this.clear();
    this._scene = null;
    _terrain = null;
    this._initialized = false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _layerLabel(layer) {
    const labels = {
      water: 'Water bodies & streams',
      wetlands: 'Wetlands',
      buildings: 'Building footprints',
      roads: 'Roads',
      railways: 'Railways',
      landcover: 'Land cover',
      infrastructure: 'Infrastructure',
    };
    return labels[layer] || layer;
  }
}

// ── Layer toggle UI builder ─────────────────────────────────────────────────

/**
 * Build HTML for the layer toggle panel.
 * @param {GeoOverlayRenderer} renderer
 * @returns {HTMLElement}
 */
export function buildLayerTogglePanel(renderer) {
  const container = document.createElement('div');
  container.className = 'layer-toggle-panel';
  container.style.cssText = `
    position: absolute; bottom: 1rem; right: 1rem;
    background: rgba(12,18,16,0.92); border: 1px solid #2a3a30;
    border-radius: 8px; padding: 0.75rem; min-width: 200px;
    font-family: var(--font-mono, monospace); font-size: 0.8rem;
    color: #b8c4b0; z-index: 100;
  `;

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:bold;margin-bottom:0.5rem;color:#d4e0cc;font-size:0.85rem;';
  title.textContent = 'Map Layers';
  container.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;';

  function refresh() {
    list.innerHTML = '';
    for (const layerInfo of renderer.getLayers()) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;cursor:pointer;';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = layerInfo.visible;
      cb.style.cssText = 'accent-color:#40a080;';
      cb.addEventListener('change', () => {
        renderer.setLayerVisibility(layerInfo.layer, cb.checked);
      });

      const swatch = document.createElement('span');
      swatch.style.cssText = `
        display:inline-block;width:12px;height:12px;border-radius:2px;
        background:${layerInfo.color};border:1px solid #4a5a40;
      `;

      const name = document.createElement('span');
      name.style.cssText = 'flex:1;';
      name.textContent = layerInfo.label;

      const count = document.createElement('span');
      count.style.cssText = 'opacity:0.6;font-size:0.75rem;';
      count.textContent = `${layerInfo.count}`;

      row.appendChild(cb);
      row.appendChild(swatch);
      row.appendChild(name);
      row.appendChild(count);
      list.appendChild(row);
    }

    if (renderer.getLayers().length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:0.5;padding:0.5rem;text-align:center;';
      empty.textContent = 'No layers loaded';
      list.appendChild(empty);
    }
  }

  refresh();

  // Expose refresh method for updates
  container.refresh = refresh;

  container.appendChild(list);
  return container;
}