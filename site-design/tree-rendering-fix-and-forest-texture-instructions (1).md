# Task: Fix Tree Scale Bug, Adopt Kenney Nature Kit, Add Billboard-Impostor Rendering for Dense Canopy

## Part 1: Diagnose and fix the oversized trees

Oversized instanced trees are almost always one of a small set of causes — check each before assuming it needs a redesign:

1. **Unit mismatch.** Confirm `height_m` from the CHM/tree-detection output is genuinely meters, and that the 3D engine's world units are also meters (not feet, not an arbitrary "1 unit = 1 grid cell" convention left over from earlier terrain work). A meters-vs-feet mismatch alone produces roughly 3x oversized trees, which matches a common symptom of "too big."
2. **Base mesh not normalized before scaling.** The scale factor applied to a tree instance should be `height_m / base_mesh_height_in_world_units`, where `base_mesh_height_in_world_units` is the *actual* bounding-box height of the tree asset as authored — not an assumed value like 1.0. If the base mesh is, say, 10 units tall and the code assumes 1 unit, every tree ends up 10x too large. Check this per tree asset, since different asset packs may not be authored at consistent scale.
3. **Double-scaling.** Check whether a scale factor is being applied both in the instancing/placement code *and* baked into a prefab/material default — this compounds multiplicatively and is an easy thing to miss when instancing code was added on top of an existing asset pipeline.
4. **Non-uniform scaling artifacts.** If only a Y-axis (height) scale is applied without scaling X/Z proportionally, a tree can look grotesquely oversized/stretched even if the height number itself is correct — crown width needs to scale with height for a tree to read as normally proportioned, not just taller.

Add a sanity-check test asserting that a tree instanced with a known `height_m` (e.g. 10m) actually measures ~10m tall in scene units after all scaling is applied — this catches regressions from any of the above without relying on eyeballing the render.

## Part 1b: Replace the placeholder geometry with Kenney's Nature Kit

The current canopies are raw `ConeGeometry`/`CylinderGeometry` primitives, not a tree asset — that's the root cause of the uniform, oversized look (every canopy is a mathematically perfect cone with no natural variation, plus whatever scale bug applies from Part 1). Swap in real assets:

1. **Download Kenney's Nature Kit** (kenney.nl, CC0 — no attribution required, though crediting "kenney.nl" is appreciated). It includes 330+ low-poly nature objects — multiple tree types (conifer, deciduous, dead trees), rocks, and terrain foliage — already exported in GLTF/GLB format, which is exactly what Three.js wants.
2. **Load with `GLTFLoader`**, not a custom parser:
   ```js
   const loader = new GLTFLoader();
   loader.load('assets/nature-kit/tree_default.glb', (gltf) => {
     const treeMesh = gltf.scene;
     // measure actual bounding box before scaling — see step 3
   });
   ```
3. **Measure the real bounding box before computing scale** — do not assume the asset is authored at any particular unit height:
   ```js
   const box = new THREE.Box3().setFromObject(treeMesh);
   const baseHeight = box.max.y - box.min.y;
   const scaleFactor = height_m / baseHeight;
   treeMesh.scale.setScalar(scaleFactor); // uniform scale — avoids the non-uniform stretching issue from Part 1
   ```
   This measured-bounding-box approach sidesteps the "assumed base height" bug from Part 1 entirely, since it reads the actual asset rather than guessing.
4. **Use `InstancedMesh`** (Three.js) for the sparse-tier trees rather than one `Mesh` per tree — Nature Kit models are low-poly enough that instancing hundreds to low-thousands of them per tile stays cheap, which is the main performance win over the naive per-object approach.
5. **Vary species by height/context, not randomly** — Nature Kit ships multiple tree variants; assign conifer vs. deciduous models based on data you may already have (elevation, aspect, canopy shape from detection) where available, or a randomized-but-weighted mix otherwise, so a forest doesn't read as one tree copy-pasted everywhere. This alone fixes a lot of the "toy-like" impression even before the billboard work in Part 2.

## Part 2: Render dense forest as texture instead of individual instances

This is the right fix for both the visual problem and likely a performance one — instancing thousands of individual meshes for a background woodlot is wasteful when the user isn't going to interact with individual trees there anyway. Split rendering into two tiers based on canopy density, not one blanket approach:

### Classification: sparse vs. dense canopy

Reuse the canopy height/density data already being produced (CHM + the tree-detection pass) — no new data source needed. Classify each area by canopy cover percentage within a neighborhood window:
- **Sparse** (below a configurable canopy-cover threshold, e.g. isolated trees, orchard rows, guild plantings, anything in or near the zone 1–3 rings from the zone overlay) → keep as individually instanced tree meshes. This is where the user can see, select, or plan around specific trees, so individual geometry earns its cost here.
- **Dense** (above the threshold — natural woodlot/bush, typically zone 4–5, and anywhere already excluded from the planting-space layer as "existing canopy") → render as textured terrain, not instanced meshes.

### Dense-forest texture rendering

Rather than sourcing a separate generic forest texture, bake it from the same Kenney Nature Kit models used for the sparse tier — this keeps the dense background forest visually consistent with the individually-rendered trees near it instead of looking like a different art style pasted in:

1. **Bake billboard impostors from the Kenney tree models**: render each tree variant from several fixed angles (e.g. 8 around the vertical axis) to a texture atlas with alpha, offline or at build time, rather than at runtime. This turns each low-poly mesh into a small set of 2D cards that read as the same tree from any nearby viewing angle.
2. Scatter these impostor cards as a "billboard cloud" across the dense-canopy area (random position, slight rotation/scale jitter for variation) instead of instancing full 3D meshes — this is the actual game-industry technique for rendering distant/mass forest cheaply, and it now uses the same visual source as your close-up trees.
3. Use the CHM's average height within the dense area to set the impostor cards' height/scale distribution, so denser/taller CHM patches get taller card placements rather than a uniform card size everywhere.
4. Blend the boundary between sparse (real instanced meshes) and dense (billboard cloud) zones by scattering a few real instanced trees right at the transition line — since both tiers now come from the same asset set, this blend is far less likely to show a visible seam than mixing a modeled tree with a generic painted texture would.

### Why this also fixes the original problem

This is close to the "identify forested areas from above and add them almost like a texture" idea from the start of this project — the difference now is you have real CHM data to drive both the classification (sparse vs. dense) and the displacement (how tall the textured canopy should read), rather than treating it as a flat aerial overlay.

## Output/schema addition

```json
{
  "canopy_render_zones": [
    {
      "geometry": "<polygon>",
      "render_mode": "instanced" | "billboard_impostor",
      "avg_canopy_height_m": 0.0,
      "canopy_cover_pct": 0.0
    }
  ]
}
```

## Performance note

Expect a substantial reduction in mesh-instance count for parcels with significant natural woodlot — that's the point of this change, and worth confirming with a before/after instance-count check on a heavily forested test parcel, not just a visual check.
