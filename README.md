# Papaya Drive

A small Three.js driving game using the Blender car, three rocks, and three trees from the adjacent asset folders.

Run `npm install` then `npm run dev`. Build with `npm run build`. Run the focused terrain and gravity checks with `npm test` (Node 22.13+).

- W / Up: accelerate
- A/D / Left/Right: steer
- S / Down: brake, then reverse once stopped
- Space: handbrake
- R: repair and reset the car and current lap
- Escape: pause
- Touch controls appear on phones and tablets

Follow the eight golden checkpoint arches around the winding ridge trail. The timer starts when you accelerate. Complete a loop to start another and record your best time for this session.

Tree and rock collisions fill the damage meter beneath the speedometer. Damage depends on speed into the obstacle, so glancing hits are less costly. Small crashes accumulate; a full-speed head-on crash can wreck the car immediately. At 100% damage the car loses drive and brakes to a stop, and checkpoint progress and timing stop. Use Reset car, R, or Repair & restart to repair it and return to the start.

Models are in `public/models`; gameplay and Three.js rendering are in `app/game.ts`, and the HUD is in `app/page.tsx`. Movement uses a fixed simulation step with interpolated rendering, simple bicycle steering, and obstacle collisions. The road is painted onto rolling terrain, so the driving surface has no overlapping road mesh. Four independent wheel contacts apply spring and damper forces to the body. Nose-first landings load the front suspension first, then swing the rear wheels down into a second impact. The same forces produce compression and settling, without a scripted upward kick or forced leveling. The car keeps angular momentum in flight. Acceleration is 12 m/s² and top speed is 95 km/h, with gentler steering at high speed. Steering and braking require ground contact. At speed, braking while turning reduces tire grip: the car slides in its original direction as the nose turns, leaving tire marks. Release the brake or countersteer to regain control.

Terrain and route generation are in `app/terrain.ts`; ground contact and gravity are in `app/vehicle-ground.ts`, momentum and tire grip are in `app/vehicle-motion.ts`. No physics engine or backend state is required.
