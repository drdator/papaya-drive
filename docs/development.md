# Development

[Back to README](../README.md) · [Lighting](lighting.md)

Run commands from the repository root. The game is a static Vite app; Rapier runs locally in WebAssembly and needs no backend.

## Commands

| Command          | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `npm run dev`    | Local server at `http://localhost:3000`                 |
| `npm run build`  | Type-check and build into `dist/`                       |
| `npm start`      | Preview the production build                            |
| `npm test`       | Driving, collision, racing, terrain and lighting checks |
| `npm run lint`   | Lint with Oxlint                                        |
| `npm run format` | Format with Oxfmt                                       |

## Code map

| Files                                                                    | Responsibility                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `app/game.ts`                                                            | Scene, game loop, input and resource lifecycle        |
| `app/vehicle-physics.ts`                                                 | Rapier world, suspension and tire forces              |
| `app/main.ts`, `index.html`, `app/globals.css`                           | HUD, menus and loading screen                         |
| `app/race.ts`                                                            | Three-lap races and local leaderboards                |
| `app/maps.ts`, `app/map-route.ts`, `app/terrain.ts`                      | Map definitions, routes and shared terrain            |
| `app/ridge-environment.ts`, `app/ridge-river.ts`, `app/ridge-scenery.ts` | Ridge mountains, river, bridge and woodland placement |
| `app/tropical-map.ts`, `app/tropical-scenery.ts`                         | Palm Cove terrain and scenery                         |
| `app/grass.ts`, `app/mushrooms.ts`                                       | Batched low-poly ground plants                        |
| `app/city-map.ts`, `app/city-layout.ts`                                  | City roads, blocks and elevation                      |
| `public/models/`, `assets/`, `scripts/`                                  | Exported models, Blender sources and build tools      |

Physics runs at 120 Hz with interpolated rendering. Four raycast wheels handle suspension, grip and braking. Chassis impacts cause damage and can detach parts; water applies buoyancy and can flood the engine. Reset restores the car and props.

Palm Cove has six animated beach crabs (`app/beach-crabs.ts`, `public/models/crab.glb`), including one beside the fishing landing and one near the starting beach. Each starts on a short sand patrol, with independent timing and terrain tilt. Their walking pace is 50% faster than the original. They flee when the car comes within 6 metres or its projected path threatens them, looking up to 0.9 seconds ahead. Escapes use clear sand routes around rocks, palms and fishing props (`app/crab-navigation.ts`), leaving the original patrol and replanning as the car moves. They sprint at 3.8 m/s, increasing to 5.5 m/s within 4 metres, and keep their chosen dodge side to avoid reversing across the car's path. Once at least 10 metres from the car and 3.5 metres clear of its projected path, they resume wandering near their refuge. Fly mode does not scare them. The scenery clock freezes them when paused or when a race finishes. Instances share geometry and material, stay outside static batching and lighting bakes, and have no vehicle collision.

Races have eight ordered checkpoints per lap. The clock starts on acceleration, pauses with menus, and finishes after three forward crossings of the finish line. The five fastest completed races are stored per map under `papaya-drive:times:v1:<map>` in `localStorage`. Incomplete and practice runs are excluded; equal times retain the older entry first. Changing maps starts a fresh race and retains the sound preference.

The editable crab is `assets/crab.blend`. Rebuild the model, its animation and a preview with `Blender --background --python scripts/build-crab.py`.

## Debug controls

Add `?debug=1` to show **Fly** and **Baked lighting: On/Off**.

Fly uses WASD/arrows to move, Q/E for height, Shift for faster movement, and dragging to look. **Drive** drops the car at the current location. Flying marks the run as practice; reset to start a ranked race. The lighting toggle compares the bake without resetting the camera or race.

Use `?shadows=single`, or `?debug=1&shadows=single`, to compare the older single shadow map with cascaded shadows.

Papaya City remains in the repo but is hidden from the map picker. Remove `hidden` from its button in `index.html` to expose it for development.

## Rendering performance

`app/static-scenery.ts` batches compatible fixed meshes into 32-metre regions after collision construction and GI loading. It retains vertex colors, UVs and baked irradiance, freezes fixed mesh transforms, and leaves the car, movable props, water and transparent materials separate. CSM registers new objects through scene events instead of scanning the scene each frame. At normal page scale, rendering resolution, shadow depth resolution, filtering, lighting assets and 120 Hz physics are unchanged.

Devices with a coarse primary pointer use compact CSM color attachments: R8 instead of RGBA8, with color writes and color clears disabled for those shadow targets. PCF still samples the same unsigned-integer depth textures at 4096², with the same filtering, biases and per-frame updates. This saves 96 MiB of unused color-buffer storage across the two cascades. Desktop keeps the standard path. Use `?shadowBuffers=standard` for comparison or `?shadowBuffers=compact` to force the optimization for verification. Frozen Ridge and Palm Cove image comparisons were pixel-identical; an initial iPhone 13 Pro Max prototype improved a stationary view from about 49 to 53 FPS. This is a modest optimization, not a guarantee of steady 60 FPS.

Add `?stats=1` to show FPS, frame interval, CPU frame work and draw calls. CPU time includes simulation and render submission; it is not a GPU timer. Add `&batching=off` to compare without static batching. These switches do not mark a race as practice.

Phones also batch compatible opaque static shadow casters across visible material colors, retaining the original triangles and 32-metre culling regions. Shadow-only meshes use reserved layer 31, enabled only inside the shadow render pass; visible meshes, GI, moving shadows and update frequency stay unchanged. `&shadowBatching=off` disables this, and `&shadowBatching=on` forces it on desktop for QA. A stationary iPhone comparison reduced 1,024 draws to 473 with identical pixels; repeated timings showed only a small FPS improvement, not a reliable 80 FPS result.

For an **opt-in** phone comparison, use `?stats=1&distantShadows=2048`. This keeps nearby shadows at 4096² and reduces only the far cascade to 2048², snapping its light to the actual texel grid. It preserves shadow distance, GI and display resolution, but distant shadow edges have less detail. Both cascades remain 4096² by default, including on desktop. A preliminary stationary iPhone sample reached about 75 FPS with the smaller far map, versus 68 FPS in the restored baseline; sustained driving and thermal conditions still need testing. Safari's “Prefer Page Rendering Updates near 60fps” flag must be disabled to test above 60 FPS on a ProMotion iPhone.

`/motion-test.html` is a dev-server-only cube comparison with direct drag orbit, automatic rotation, and the same render scale as the game.

The render buffer retains the 1.8 device-pixel-ratio cap at normal zoom. When Safari reports a visual viewport scale below 1, its pixel ratio is multiplied by that scale so the enlarged layout viewport does not inflate the drawing buffer. Container, window and visual viewport resize events update the buffer; shadow maps, GI and simulation settings are unaffected. On an iPhone 13 Pro Max at 50% page scale, a stationary Ridge trail comparison improved from 38–43 FPS at 1540 × 2617 to 60 FPS at 770 × 1308 with all shadows and GI enabled. This is a scene-specific measurement, not a full-lap guarantee.

Frozen 1440 × 900 views on an M4 Max reduced draw calls from 2,637 to 1,397 on Ridge Trail and 1,105 to 726 on Palm Cove. Render submission time measured roughly 4.2 → 2.8 ms and 2.5 → 2.2 ms, respectively. Same-scene image comparisons showed only tiny edge rounding differences. These are desktop measurements; test sustained driving on the target phone to establish its frame rate.

## Rebuild assets

Run Blender with `--background --python <script>`:

| Asset           | Blender source                    | Build script                     |
| --------------- | --------------------------------- | -------------------------------- |
| Palm trees      | `assets/papaya-palms.blend`       | `scripts/build-papaya-palms.py`  |
| Island props    | `assets/palm-cove-props.blend`    | `scripts/build-palm-props.py`    |
| Island mountain | `assets/palm-cove-mountain.blend` | `scripts/build-palm-mountain.py` |
| City            | `assets/papaya-city.blend`        | `scripts/build-papaya-city.py`   |

The city builder uses `scripts/build-city-streets.ts` for street polygons. Scenery placement is deterministic and shared with the lighting exporter. After changing geometry, placement or sun lighting, [rebake the map lighting](lighting.md#baked-map-lighting).

## Deploy to AWS

```sh
AWS_PROFILE=roventskij npm run deploy:s3
```

This builds the static app, uploads it to `papaya-drive-779045249836` in `eu-north-1`, and invalidates CloudFront distribution `E1XV070WW0P6T`. The bucket blocks public access; CloudFront serves it over HTTPS using origin access control. `npm run build:static` builds without deploying.
