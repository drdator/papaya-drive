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

Races have eight ordered checkpoints per lap. The clock starts on acceleration, pauses with menus, and finishes after three forward crossings of the finish line. The five fastest completed races are stored per map under `papaya-drive:times:v1:<map>` in `localStorage`. Incomplete and practice runs are excluded; equal times retain the older entry first. Changing maps starts a fresh race and retains the sound preference.

## Debug controls

Add `?debug=1` to show **Fly** and **Baked lighting: On/Off**.

Fly uses WASD/arrows to move, Q/E for height, Shift for faster movement, and dragging to look. **Drive** drops the car at the current location. Flying marks the run as practice; reset to start a ranked race. The lighting toggle compares the bake without resetting the camera or race.

Use `?shadows=single`, or `?debug=1&shadows=single`, to compare the older single shadow map with cascaded shadows.

Papaya City remains in the repo but is hidden from the map picker. Remove `hidden` from its button in `index.html` to expose it for development.

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
