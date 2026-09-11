# Photorealistic Tree Textures + Building Rendering — Coding Agent Instructions

## Context

Trees currently use Kenney Nature Kit (stylized, low-poly, CC0) as the drop-in
replacement for the old cone/cylinder primitives. That fixed the scale/proportion
bug but reads as "game-stylized," not photorealistic. This doc covers (1) upgrading
tree assets to a more photoreal tier without abandoning the instancing/billboard
architecture already in place, and (2) generating 3D building geometry from the
Microsoft Canadian Building Footprints + DSM-DTM height data already in the
pipeline.

---

## Part 1: Photorealistic tree assets

### Why Kenney/Quaternius read as "gamey"

Both are hand-modeled low-poly art direction — flat-shaded or simple-gradient
canopies, no real leaf-cluster detail, no PBR roughness/normal maps. That's a
*style* choice in those packs, not a technical limitation you can texture your way
out of. Getting photoreal requires swapping to assets built from photogrammetry
or high-detail sculpted/scanned foliage with proper PBR materials (albedo,
normal, roughness, and often subsurface-scattering-ish translucency maps for
leaves).

### Asset source options, in order of recommendation

1. **Quaternius "Ultimate Nature Pack" realistic variants / Poly Haven trees**
   (CC0) — Poly Haven (polyhaven.com/models, filter by "plant"/"tree") has a
   small but growing set of photogrammetry-scanned trees and bushes with full
   PBR texture sets, true CC0, glTF-ready. Limited species count (oak, pine,
   birch, a few bushes) but genuinely photoreal and license-clean. Best first
   stop since it slots into the existing `GLTFLoader` pipeline with zero
   licensing review needed.

2. **Sketchfab "Downloadable" + CC0/CC-BY filter** — search "tree" or
   "conifer," filter License → CC0 or CC-Attribution, filter Downloadable →
   Yes. Quality varies a lot; vet each model (polycount, texture resolution,
   whether it's a photogrammetry scan vs. a low-effort stylized upload) before
   committing. CC-BY assets need an attribution line in the app's credits —
   flag any non-CC0 picks for a quick license-compliance check before ship.

3. **Quixel Megascans (via Epic account, free tier)** — genuinely
   photogrammetry-scanned foliage, the highest visual quality available for
   free. Caveat: Megascans' free license is tied to use *within* Unreal
   Engine/Twinmotion content or requires an Epic account and has usage terms
   that don't cleanly cover an arbitrary Three.js web app — have the agent
   read the current Quixel EULA before pulling any assets in, since this is
   the one option with real licensing risk for this project.

4. **Procedural generation (SpeedTree free/indie tier, or a Three.js proctree
   library)** — generates unlimited species/variation instead of a fixed
   asset library, at the cost of build complexity. Worth it later if the
   fixed-pack options above don't give enough species variety for Alberta's
   actual tree cover (aspen, white spruce, lodgepole pine, poplar), but
   overkill for a first pass — treat as a stretch goal, not this task.

**Recommended default: start with Poly Haven CC0 trees for the sparse/individual
rendering tier (near homestead, orchard, guild plantings) and keep the existing
canopy-texture-and-displacement approach (already implemented per the prior
tree-rendering-fix instructions) for dense/background woodlot — just swap the
*source imagery* for that canopy texture to a photoreal aerial-canopy photo
texture (see below) instead of a flat green tile.**

### Upgrading the dense-canopy texture specifically

The existing dense-forest render mode (tiled canopy texture + CHM-driven
displacement) is architecturally fine — the fix here is texture quality, not
approach:

1. Source a seamless, tileable aerial-canopy PBR texture set (albedo + normal
   + roughness) rather than a flat painted green. PolyHaven's "terrain"/nature
   texture category has CC0 aerial-canopy-style tileable textures; alternatively
   generate one from a top-down photo of real canopy with a tiling/seamless
   pass (e.g., in GIMP/Photoshop offset-and-heal, or an automated seamless-tile
   tool) — flag this as a one-time asset-prep step, not runtime work.
2. Keep the CHM-driven per-patch variation and instanced edge-tree blending
   already specified in the prior instructions unchanged — only the texture
   source changes.

### Species variety note

Kenney/Quaternius/Poly Haven trees don't map 1:1 to real Alberta species. Since
the pipeline already has Alberta Vegetation Inventory species typing (per the
prior AVI integration work), have the agent build a small lookup table mapping
AVI species codes → best-available asset (e.g., `SW` white spruce → conifer
model A, `PB` white birch → deciduous model B, fallback → generic deciduous/
conifer by broad type) rather than using one tree model everywhere.

---

## Part 2: 3D building rendering

### Inputs already available

- Building footprints: Microsoft Canadian Building Footprints (polygon per
  building), OSM as fallback/merge.
- Height: DSM − DTM (digital surface model minus digital terrain model) gives
  a per-pixel height-above-ground raster you can sample within each footprint.

### Recommended approach: procedural extrusion + texture atlas (not fixed assets)

Fixed building models (e.g., a Quaternius barn/house pack) only work when you
can reliably classify "this footprint is a barn" vs. "this is a house" —
you don't have that classifier yet, and footprint shape alone is a weak
signal. Procedural extrusion instead uses the data you actually have (polygon
+ height) and scales to every building on a parcel without per-building
manual matching:

1. **Footprint → wall geometry**: extrude each building polygon vertically by
   its DSM-DTM max (or 90th-percentile, to avoid single-pixel spikes) height
   within the footprint. Use `THREE.ExtrudeGeometry` with the footprint as
   the shape.
2. **Roof inference**: 
   - If footprint is roughly rectangular and DSM shows a ridge (height varies
     smoothly from edges to a center line) → generate a simple gable roof
     (two sloped planes meeting at a ridge line).
   - If DSM is roughly flat across the footprint → flat roof.
   - Otherwise → flat roof as the safe default; don't over-invest in roof
     shape inference for this pass, it's a visual nicety not a data need.
3. **Texturing**: apply a small library of tileable PBR wall materials
   (siding, brick, stucco — CC0 sources: Poly Haven "textures" category,
   ambientCG.com is also fully CC0 and has a large building-material set) via
   UV-mapped triangle-planar projection on the extruded walls, and a
   separate roof-material tile (asphalt shingle, metal) on roof faces.
   Pick material per-building using a simple heuristic (e.g., footprint size
   threshold: small footprint → shed/outbuilding material set, large →
   house material set) rather than true classification — flag this as a
   placeholder to refine once/if a real building-type classifier exists.
4. **LOD**: for buildings far from the camera/outside the focal parcel,
   collapse to a simple untextured box (footprint + flat height) — same
   sparse/dense-style performance pattern already used for trees.

### Output schema addition

```json
{
  "buildings": [
    {
      "footprint": "<polygon>",
      "height_m": 0.0,
      "roof_type": "flat" | "gable",
      "wall_material": "siding" | "brick" | "stucco" | "metal",
      "roof_material": "asphalt_shingle" | "metal",
      "lod": "detailed" | "box"
    }
  ]
}
```

### Why not a fixed asset pack for buildings

Quaternius's farm/building pack (already noted as available) is still useful
as a *fallback visual* for footprints where DSM height data is missing or
unreliable (small/noisy footprints, data gaps) — use it as the degraded-data
path, procedural extrusion as the primary path. Worth flagging to the agent
explicitly so it doesn't end up building two disconnected systems.

---

## Suggested build order

1. Swap sparse-tree assets to Poly Haven CC0 trees + AVI-species lookup table.
2. Swap dense-canopy texture source to a photoreal tileable aerial-canopy
   material (keep existing displacement/blending logic).
3. Build the footprint-extrusion + roof-inference + texture-atlas building
   pipeline, with Quaternius pack as the missing-data fallback.
4. Re-run the before/after instance-count and visual check on the same test
   parcel used for the tree-rendering fix, this time including buildings.
