import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { gravity } from './vehicle-ground.ts';

export function createVehicleBuoyancy(body: RigidBody, mass: number) {
  const corners = [-0.65, 0.65].flatMap((x) =>
    [-1.4, 1.4].map((z) => new THREE.Vector3(x, 0.45, z)),
  );
  const point = new THREE.Vector3();
  const impulse = new THREE.Vector3();
  let immersedTime = 0;
  let dryTime = 0;

  return {
    reset() {
      immersedTime = dryTime = 0;
    },
    update(surface: number | undefined, dt: number) {
      const position = body.translation();
      const rotation = body.rotation();
      let immersion = 0;
      // Trapped air briefly supports the chassis, then escapes as it fills up.
      const lift = 1.35 * (1 - THREE.MathUtils.smoothstep(immersedTime, 2, 5));
      for (const corner of corners) {
        point.copy(corner).applyQuaternion(rotation).add(position);
        const submerged =
          surface === undefined
            ? 0
            : THREE.MathUtils.clamp((surface - point.y) / 0.85, 0, 1);
        immersion += submerged / corners.length;
        if (submerged === 0) continue;
        const speed = body.velocityAtPoint(point);
        // Stronger drag on fast entries absorbs the splash without a bounce impulse.
        const verticalDrag =
          1 - Math.exp(-(3 + Math.abs(speed.y) * 0.6) * submerged * dt);
        const horizontalDrag = 1 - Math.exp(-3 * submerged * dt);
        impulse
          .set(
            -speed.x * horizontalDrag,
            gravity * lift * submerged * dt - speed.y * verticalDrag,
            -speed.z * horizontalDrag,
          )
          .multiplyScalar(mass / corners.length);
        body.applyImpulseAtPoint(impulse, point, true);
      }
      if (immersion > 0.1) {
        immersedTime += dt;
        dryTime = 0;
      } else {
        // A momentary bob above the surface must not refill the car with air.
        dryTime += dt;
        if (dryTime > 1) immersedTime = 0;
      }
    },
  };
}
