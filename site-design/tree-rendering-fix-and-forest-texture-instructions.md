# Task: Fix Tree Scale Bug + Add Textured-Forest Rendering for Dense Canopy

## Part 1: Diagnose and fix the oversized trees

Oversized instanced trees are almost always one of a small set of causes — check each before assuming it needs a redesign:

1. **Unit mismatch.** Confirm `height_m` from the CHM/tree-detection output is genuinely meters, and that the 3D engine's world units are also meters (not feet, not an arbitrary "1 unit = 1 grid cell" convention left over from earlier terrain work). A meters-vs-feet mismatch alone produces roughly 3x oversized trees, which matches a common symptom of "too big."
2. **Base mesh not normalized before scaling.** The scale factor applied to a tree instance should be `height_m / base_mesh_height_in_world_units`, where `base_mesh_height_in_world_units` is the *actual* bounding-box height of the tree asset as authored — not an assumed value like 1.0. If the base mesh is, say, 10 units tall and the code assumes 1 unit, every tree ends up 10x too large. Check this per tree asset, since different asset packs may not be authored at consistent scale.
3. **Double-scaling.** Check whether a scale factor is being applied both in the instancing/placement code *and* baked into a prefab/material default — this compounds multiplicatively and is an easy thing to miss when instancing code was added on top of an existing asset pipeline.
4. **Non-uniform scaling artifacts.** If only a Y-axis (height) scale is applied without scaling X/Z proportionally, a tree can look grotesquely oversized/stretched even if the height number itself is correct — crown width needs to scale with height for a tree to read as normally proportioned, not just taller.

Add a sanity-check test asserting that a tree instanced with a known `height_m` (e.g. 10m) actually measures ~10m tall in scene units after all scaling is applied — this catches regressions from any of the above without relying on eyeballing the render.

## Part 2: Render dense forest as texture instead of individual instances

This is the right fix for both the visual problem and likely a performance one — instancing thousands of individual meshes for a background woodlot is wasteful when the user isn't going to interact with individual trees there anyway. Split rendering into two tiers based on canopy density, not one blanket approach:

### Classification: sparse vs. dense canopy

Reuse the canopy height/density data already being produced (CHM + the tree-detection pass) — no new data source needed. Classify each area by canopy cover percentage within a neighborhood window:
- **Sparse** (below a configurable canopy-cover threshold, e.g. isolated trees, orchard rows, guild plantings, anything in or near the zone 1–3 rings from the zone overlay) → keep as individually instanced tree meshes. This is where the user can see, select, or plan around specific trees, so individual geometry earns its cost here.
- **Dense** (above the threshold — natural woodlot/bush, typically zone 4–5, and anywhere already excluded from the planting-space layer as "existing canopy") → render as textured terrain, not instanced meshes.

### Dense-forest texture rendering

1. Take the terrain mesh for the dense-canopy area and apply a tiled/repeating forest-canopy texture (aerial-canopy-appearance material) rather than instancing individual tree geometry.
2. Use the CHM's average height within that area to height-displace the textured surface (displacement/bump mapping) so the dense-forest area reads as raised canopy relative to open ground, rather than a flat painted texture sitting at ground level.
3. Vary the texture/displacement subtly across the area using the underlying CHM variation (not a uniform flat texture) so denser/taller patches within the "dense" classification still show some visual variation rather than looking like a single uniform blob.
4. Blend the boundary between sparse (instanced) and dense (textured) zones — either a soft alpha blend or a scattering of a few individually-instanced "edge trees" right at the transition line, so the switch from real geometry to texture isn't a visible hard seam.

### Why this also fixes the original problem

This is close to the "identify forested areas from above and add them almost like a texture" idea from the start of this project — the difference now is you have real CHM data to drive both the classification (sparse vs. dense) and the displacement (how tall the textured canopy should read), rather than treating it as a flat aerial overlay.

## Output/schema addition

```json
{
  "canopy_render_zones": [
    {
      "geometry": "<polygon>",
      "render_mode": "instanced" | "textured",
      "avg_canopy_height_m": 0.0,
      "canopy_cover_pct": 0.0
    }
  ]
}
```

## Performance note

Expect a substantial reduction in mesh-instance count for parcels with significant natural woodlot — that's the point of this change, and worth confirming with a before/after instance-count check on a heavily forested test parcel, not just a visual check.
