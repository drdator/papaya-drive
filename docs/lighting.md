# Lighting

[Back to README](../README.md) · [Development](development.md)

## Sun shadows

Ridge Trail and Palm Cove use the same sun-shadow settings: two 4096² cascades, with a detailed near cascade ending at 32 metres of camera depth and a wider cascade reaching 160 metres, blended together. `app/cascaded-sun.ts` uses Three's CSM addon, preserves the custom terrain and baked-lighting shaders, and registers new crash-debris materials as they appear. The cascades align to whole texels to reduce shimmering. Both maps use the nine-sample PCF filter in `app/sun-shadows.ts` and the same slightly softer ground filter. The far cascade has a larger bias to avoid self-shadowing stripes on mountain faces.

For comparison, add `?shadows=single` (or `&shadows=single` alongside `?debug=1`) to use the previous stabilized 4096² map covering 152 metres. Cascades add one shadow map and one shadow rendering pass. `tests/cascaded-sun.test.ts` checks shader composition, new materials, resizing and resource cleanup; `tests/sun-shadows.test.ts` checks single-map grid stability and PCF shader compatibility.

In Chrome at 1440 × 900 on an M4 Max, matched Palm Cove views held 60 FPS with both approaches. Average GPU time increased from 1.88 to 2.27 ms near the grove and from 1.75 to 2.01 ms in the wide view. These desktop measurements do not establish performance on mobile GPUs.

## Baked map lighting

Palm Cove and Ridge Trail share the same baked GI pipeline in `app/baked-lighting.ts`: sky visibility and three diffuse bounces of sunlight, computed offline with Blender Cycles. Palm Cove covers 441 fixed meshes, including the shoreline, mountain and jetty; Ridge Trail covers 1,510, including its trees, rocks, grass, mushrooms, mountain ranges and timber bridge. Scenery blends at 75% strength with the ambient fill to preserve the bright art style; ground lightmaps use 100% strength on Palm Cove and 90% on Ridge Trail, where a little ambient fill softens the shaded ground. Live sunlight and cascaded shadows remain active. Cars, water and movable props are excluded from the bake.

Lighting is enabled during normal play. With `?debug=1`, **Baked lighting: On/Off** compares it with the original lighting without moving the camera or resetting the race. Detailed scenery uses vertex irradiance; terrain uses denoised half-float RGB EXR lightmaps with separate UVs, mipmaps and anisotropic filtering. This avoids stretching lighting across the terrain's 1.25 m triangles.

| Map         | Ground lightmap | Coverage                      | Vertex data | Ground texture | GPU texture memory, including mipmaps |
| ----------- | --------------- | ----------------------------- | ----------- | -------------- | ------------------------------------- |
| Palm Cove   | 2048²           | 170 × 145 m, about 8 cm/texel | 2.42 MB     | 3.71 MB        | 43 MiB                                |
| Ridge Trail | 4096²           | 310 × 310 m, about 8 cm/texel | 4.98 MB     | 15.68 MB       | 171 MiB                               |

Ridge uses a larger texture to maintain the island's ground-lighting detail across its larger terrain. Its lossless PIZ compression reduces transfer size without changing decoded lighting values; Palm Cove retains ZIP compression. Combined lighting assets are approximately 4.47 MB / 16.77 MB with gzip for Palm Cove / Ridge Trail. Only the active map's bake is loaded, and its resources are disposed when switching maps. There are no additional GI render passes. Each scenery instance has its own lighting attribute; compatible materials are shared. If a bake cannot load, or its geometry/placement signatures no longer match, the game falls back to the original lighting.

On an Apple M4 Max in Chrome at 1440 × 900, Ridge Trail's start view held 60 FPS with GI on and off; average GPU render time was approximately 2.17 / 2.19 ms across two runs of each, within measurement variation. A wide Palm Cove view previously measured about 2.22 / 1.82 ms with baked lighting on/off, also at 60 FPS. These desktop measurements do not establish mobile performance; the larger Ridge texture mainly increases loading cost and GPU memory use.

Rebake after changing a map's scenery, terrain, models or sun lighting. Use `ridge` for Ridge Trail or `island` for Palm Cove:

1. Run `npm run dev`, open the game, and run this in the browser console:

   ```js
   await (
     await import('/scripts/export-lighting.ts')
   ).downloadLighting('ridge');
   ```

2. Put the downloaded `ridge-lighting-scene.json` in `work/`.
3. Run Blender with `--background --python scripts/bake-lighting.py -- --map ridge`. This writes `public/lighting/ridge.json` and `public/lighting/ridge-ground.exr`. Scenery uses 128 samples; terrain uses 256 samples followed by compositor denoising. Append `--terrain-only` to regenerate just the terrain texture while preserving an existing scenery bake. Use a full rebake after changing geometry, placement or lighting. No Blender process is needed during gameplay.
4. Run `node --experimental-strip-types --test tests/baked-lighting.test.ts` to check both maps' bake coverage, signatures, lightmap dimensions/HDR values and terrain UV coverage against current assets and placements. `app/ridge-scenery.ts` supplies the same deterministic woodland placements to the game and exporter. Ridge has 181 sparse grass tufts beside the trail, clear of the road, river and obstacles. Both maps use `app/grass.ts` for the same tapered six-blade style, batched into one non-colliding mesh per map. Twelve mushrooms (six fly agarics and six king boletes) occupy just eight separated spots near trees; `app/mushrooms.ts` batches their faceted caps, stems and pale flecks into one non-colliding mesh.
