# Billboard Impostor Trees — Coding Agent Instructions

## Goal

Replace both the current tree rendering (whatever primitive/asset is live now)
and the generic-photo dense-canopy texture with **billboard impostors**: flat,
camera-facing (or fixed-angle) planes textured with a baked render of an actual
3D tree model. This gets real tree geometry/silhouette/foliage detail into the
scene at a fraction of the polygon and draw-call cost of instancing full 3D
models everywhere.

This supersedes the "tiled aerial-canopy photo" approach from the prior
dense-forest-texture instructions — the texture source is now a rendered
photoreal 3D tree, not a stock photo.

---

## Step 1: Source real 3D tree models to bake from

Use the same asset sources already identified for photorealistic trees:
Poly Haven CC0 trees as primary, Quaternius realistic variants as secondary,
vetted CC0/CC-BY Sketchfab models as tertiary. You need a small library here
(6–10 distinct models covering the species mix relevant to Alberta — conifer,
aspen/poplar, birch, a couple of shrub/understory models) since one impostor
repeated everywhere reads just as artificial as a flat texture did.

## Step 2: Bake each model into an impostor texture atlas

For each source model:

1. **Cross-billboard (recommended over single-plane)**: render the model from
   two camera angles 90° apart (front and side), each capturing the full tree
   with alpha transparency (transparent background), at a resolution
   appropriate to how close the camera will ever get to that tree tier (start
   at 512×512 or 1024×1024 per view; don't over-allocate for trees that will
   only ever be seen from mid-to-far distance).
2. Pack front + side renders into a single texture atlas per tree model
   (2 views side by side, or a proper texture atlas if you add more angles
   later — e.g. an 8-angle rotating billboard set for trees closer to the
   camera that need to look right as the view rotates).
3. Bake a matching normal map from the same render pass if your renderer
   supports it (most engines' offline-bake or "impostor" render mode do) —
   this is what keeps foliage from looking flat-shaded once real-time
   lighting hits the billboard.
4. This baking step is a one-time offline asset-prep task, not runtime work —
   do it once per model and cache the resulting atlas + normal map as static
   assets alongside the other tree assets, not regenerated per session.

## Step 3: Rendering tiers (revise existing sparse/dense split)

Replace the binary sparse=instanced-mesh / dense=flat-texture split with a
three-tier system:

1. **Near tier** (individually placed, close to viewer — homestead, orchard,
   guild plantings): keep full 3D model geometry as already implemented. No
   change here; impostors aren't worth it at close range where geometry detail
   actually matters.

2. **Mid tier** (background trees, visible but not close — general parcel
   cover outside the near-tier zones): render as **cross-billboard impostors**
   using the baked atlases from Step 2. Each impostor is two perpendicular
   textured planes intersecting in an X, always rotating to face the camera
   (standard billboard technique) — this is what gives you real tree
   silhouettes at a fraction of near-tier's polygon cost. Scatter these
   individually across the mid-tier zone (using the same placement logic
   already used for the sparse instancing tier) rather than tiling one big
   texture, so it still reads as discrete trees, not a painted surface.

3. **Far/dense tier** (background woodlot/bush, far from any expected
   interaction point): this is where the old flat-texture-plus-displacement
   approach still applies, but upgrade its source texture: instead of a stock
   aerial-canopy photo, render a **top-down bake of a small cluster of the
   same 3D tree models** (e.g. 8–12 trees arranged naturally, rendered from
   directly above) and tile *that* as the seamless texture. This keeps visual
   consistency between what a user sees up close (real baked tree models) and
   what they see from far away (a texture, but one genuinely derived from the
   same models) rather than the aerial photo looking like a different biome
   entirely.

## Step 4: Transition/LOD blending

Keep the existing edge-blending approach (soft alpha blend or scattered
individually-instanced trees at zone boundaries) but apply it at *two*
transitions now instead of one: near→mid (geometry to billboard) and
mid→far (billboard to tiled texture). Distance thresholds for each transition
should be configurable, not hardcoded, since the right distance depends on
target hardware/performance budget.

## Species variety on impostors

Reuse the AVI-species-to-asset lookup table (from the photorealistic-tree
work) so impostors are selected per-zone by actual species typing rather than
one impostor everywhere — a spruce stand and an aspen stand should read as
visually distinct even at billboard distance.

## Output schema addition

```json
{
  "tree_render_tiers": [
    {
      "geometry": "<polygon>",
      "tier": "near" | "mid" | "far",
      "render_mode": "full_geometry" | "billboard_impostor" | "tiled_texture",
      "species_asset_id": "",
      "impostor_atlas": "" ,
      "transition_blend_zone": true
    }
  ]
}
```

## Performance check

Confirm draw-call and polygon-count reduction on the same heavily-forested
test parcel used for the prior tree-rendering fix — the mid tier is the one
most likely to blow the polygon budget if impostor billboards aren't properly
batched/instanced (use instanced rendering for the billboard planes themselves,
not one draw call per tree).
