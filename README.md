# Papaya Drive

A small Three.js driving game using the Blender car, three rocks, and three trees from the adjacent asset folders.

Run `npm install` then `npm run dev`. Build with `npm run build`.

- WASD / arrows: drive, steer, brake and reverse
- Space: handbrake
- R: reset the car and current lap
- Escape: pause
- Touch controls appear on phones and tablets

Follow the eight golden checkpoint arches around the forest loop. The timer starts when you accelerate. Complete a loop to start another and record your best time for this session.

Models are in `public/models`; gameplay and Three.js rendering are in `app/game.ts`, and the HUD is in `app/page.tsx`. Movement uses a fixed simulation step, simple bicycle steering, and circle-based obstacle collisions. No physics engine or backend state is required.
