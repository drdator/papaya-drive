import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { terrainSize, terrainSegments } from './terrain.ts';
import { createCrabNavigation, distanceToCarPath } from './crab-navigation.ts';

// Short, clear stretches of sand: landing, east beach, start, north, west, south.
const walks = [
  { x: 63.5481, z: 19.6176, angle: 18, scale: 0.5, cycles: 14 },
  { x: 54.374, z: 36.5417, angle: 35, scale: 0.56, cycles: 16 },
  { x: 34.1248, z: 49.679, angle: 57, scale: 0.62, cycles: 18 },
  { x: -0.7608, z: 41.2667, angle: 93, scale: 0.5, cycles: 20 },
  { x: -59.0211, z: 0.6948, angle: 181, scale: 0.56, cycles: 22 },
  { x: -11.3851, z: -52.5717, angle: 260, scale: 0.62, cycles: 24 },
];

export function createBeachCrabs(
  model: THREE.Object3D,
  ground: THREE.BufferGeometry,
  obstacles: THREE.Box3[] = [],
) {
  const clip = model.animations.find(
    (animation) => animation.name === 'Scuttle',
  );
  if (!clip) throw new Error('The beach crab is missing its Scuttle animation');
  const group = new THREE.Group();
  group.name = 'Beach crabs';
  const positions = ground.getAttribute('position');
  const cellSize = terrainSize / terrainSegments;
  // Match the rendered terrain triangles, including the diagonal in each cell.
  function heightAt(x: number, z: number) {
    const gx = (x + terrainSize / 2) / cellSize;
    const gz = (z + terrainSize / 2) / cellSize;
    const col = Math.floor(gx),
      row = Math.floor(gz);
    const fx = gx - col,
      fz = gz - row;
    const a = row * (terrainSegments + 1) + col;
    const h00 = positions.getY(a),
      h10 = positions.getY(a + 1);
    const h01 = positions.getY(a + terrainSegments + 1);
    const h11 = positions.getY(a + terrainSegments + 2);
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  const navigation = createCrabNavigation(heightAt, obstacles);
  const crabs = walks.map((walk, index) => {
    const object = clone(model);
    object.name = `Beach crab ${index + 1}`;
    object.scale.setScalar(walk.scale);
    group.add(object);
    const mixer = new THREE.AnimationMixer(object);
    mixer.clipAction(clip).play();
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = child.receiveShadow = true;
      if (child instanceof THREE.SkinnedMesh) {
        // A fixed envelope covers every leg pose without per-frame skin bounds.
        child.boundingSphere = new THREE.Sphere(
          new THREE.Vector3(0, 0.25, 0),
          1,
        );
      }
    });
    const angle = THREE.MathUtils.degToRad(walk.angle);
    return {
      ...walk,
      object,
      mixer,
      dx: -Math.sin(angle),
      dz: Math.cos(angle),
      walkTime: clip.duration * walk.cycles,
      pace: (0.9 + index * 0.07) * 1.5,
      pause: 2 + (index % 3) * 0.8,
      clock: index * 7.3,
      fleeing: false,
      free: false,
      route: [] as ReturnType<typeof navigation.escape>,
      replanAt: 0,
      restUntil: 0,
      animationTime: 0,
      wanderAngle: index * 2.4,
      escapeSide: 0,
    };
  });
  const right = new THREE.Vector3(),
    up = new THREE.Vector3();
  const forward = new THREE.Vector3(),
    basis = new THREE.Matrix4();
  let previousTime = 0;
  function update(
    time: number,
    carPosition?: THREE.Vector3,
    carVelocity = { x: 0, z: 0 },
  ) {
    const dt = Math.max(0, time - previousTime);
    previousTime = time;
    for (const crab of crabs) {
      if (dt > 0) {
        const carDistance =
          carPosition?.distanceTo(crab.object.position) ?? Infinity;
        const pathDistance = carPosition
          ? distanceToCarPath(crab.object.position, carPosition, carVelocity)
          : Infinity;
        const wasFleeing = crab.fleeing;
        crab.fleeing = crab.fleeing
          ? carDistance < 10 || pathDistance < 3.5
          : carDistance < 6 || (carDistance < 26 && pathDistance < 3.5);
        if (crab.fleeing && carPosition) {
          crab.free = true;
          if (!wasFleeing) crab.escapeSide = 0;
          if (!wasFleeing || time >= crab.replanAt || !crab.route.length) {
            crab.route = navigation.escape(
              crab.object.position,
              carPosition,
              carVelocity,
              crab.escapeSide,
            );
            const target = crab.route.at(-1);
            if (
              target &&
              !crab.escapeSide &&
              Math.hypot(carVelocity.x, carVelocity.z) > 6
            ) {
              // Keep the chosen dodge side while the car approaches; changing
              // sides mid-escape can send a crab back through the driving line.
              crab.escapeSide = Math.sign(
                (target.z - carPosition.z) * carVelocity.x -
                  (target.x - carPosition.x) * carVelocity.z,
              );
            }
            crab.replanAt = time + (carDistance < 6 ? 0.12 : 0.4);
          }
        } else if (wasFleeing) {
          // Settle where the escape ended; never snap back to the old patrol.
          crab.route = [];
          crab.restUntil = time + 1.2;
        } else if (!crab.free) {
          crab.clock += dt * crab.pace;
        }
        if (crab.free) {
          if (!crab.fleeing && !crab.route.length && time >= crab.restUntil) {
            crab.wanderAngle += 2.4;
            crab.route = navigation.wander(
              crab.object.position,
              crab.wanderAngle,
            );
          }
          const speed = crab.fleeing
            ? carDistance < 4
              ? 5.5
              : 3.8
            : 0.35 * crab.scale * crab.pace;
          const moving = crab.route.length > 0;
          let remaining = dt * speed;
          while (remaining > 0 && crab.route.length) {
            const target = crab.route[0];
            const dx = target.x - crab.object.position.x,
              dz = target.z - crab.object.position.z;
            const distance = Math.hypot(dx, dz);
            const step = Math.min(remaining, distance);
            if (distance > 1e-6) {
              crab.dx = dx / distance;
              crab.dz = dz / distance;
              crab.object.position.x += crab.dx * step;
              crab.object.position.z += crab.dz * step;
              crab.animationTime += step / (0.35 * crab.scale);
            }
            remaining -= step;
            if (distance <= step) crab.route.shift();
          }
          if (!crab.fleeing && moving && !crab.route.length)
            crab.restUntil = time + crab.pause;
        }
      }
      const t = crab.clock % (2 * (crab.walkTime + crab.pause));
      const travel =
        t < crab.walkTime + crab.pause
          ? Math.min(t, crab.walkTime)
          : Math.max(0, 2 * crab.walkTime + crab.pause - t);
      // Reversing the clip on the return walk keeps planted feet from sliding.
      // Whole animation cycles put all eight feet down for the pauses.
      if (!crab.free) {
        const distance = travel * 0.35 * crab.scale;
        crab.object.position.x = crab.x + crab.dx * distance;
        crab.object.position.z = crab.z + crab.dz * distance;
        crab.animationTime = travel;
      }
      const { x, z } = crab.object.position;
      const slopeX = (heightAt(x + 0.25, z) - heightAt(x - 0.25, z)) / 0.5;
      const slopeZ = (heightAt(x, z + 0.25) - heightAt(x, z - 0.25)) / 0.5;
      right
        .set(crab.dx, slopeX * crab.dx + slopeZ * crab.dz, crab.dz)
        .normalize();
      up.set(-slopeX, 1, -slopeZ).normalize();
      forward.crossVectors(right, up).normalize();
      crab.object.quaternion.setFromRotationMatrix(
        basis.makeBasis(right, up, forward),
      );
      crab.object.position.set(x, heightAt(x, z) + 0.008, z);
      crab.mixer.setTime(crab.animationTime);
    }
  }
  update(0);
  return {
    group,
    update,
    dispose() {
      for (const crab of crabs) {
        crab.mixer.stopAllAction();
        crab.mixer.uncacheRoot(crab.object);
      }
      // The game's scene teardown releases shared meshes/materials and skeletons.
    },
  };
}
