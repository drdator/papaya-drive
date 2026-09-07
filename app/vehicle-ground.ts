import { MathUtils } from 'three';
import { terrainHeight } from './terrain.ts';

export const gravity = 14;
export const tireRadius = 0.37;
export const suspensionDroop = 0.12;
export const wheelMounts = [
  { name: 'Wheel_FR', x: 0.84, z: 1.13 },
  { name: 'Wheel_FL', x: -0.84, z: 1.13 },
  { name: 'Wheel_RR', x: 0.84, z: -1.12 },
  { name: 'Wheel_RL', x: -0.84, z: -1.12 },
];
const springRate = 55;
const staticCompression = gravity / (springRate * 4);

export function groundUnderCar(x: number, z: number, heading: number) {
  const fx = Math.sin(heading),
    fz = Math.cos(heading);
  const heights = wheelMounts.map(
    (wheel) =>
      terrainHeight(
        x + fx * wheel.z + fz * wheel.x,
        z + fz * wheel.z - fx * wheel.x,
      ) + 0.025,
  );
  const [frontRight, frontLeft, rearRight, rearLeft] = heights;
  const forwardSlope =
    (frontRight + frontLeft - rearRight - rearLeft) / (2 * 2.25);
  const sideSlope =
    (frontRight + rearRight - frontLeft - rearLeft) / (4 * 0.84);
  return {
    height: (frontRight + frontLeft + rearRight + rearLeft) / 4,
    pitch: -Math.atan(forwardSlope),
    bank: Math.atan(sideSlope),
    forwardSlope,
    sideSlope,
    heights,
  };
}

export function createVerticalMotion(
  ground: ReturnType<typeof groundUnderCar>,
) {
  return {
    height: ground.height,
    velocity: 0,
    grounded: true,
    pitch: ground.pitch,
    bank: ground.bank,
    pitchVelocity: 0,
    bankVelocity: 0,
    groundHeights: [...ground.heights],
    wheelOffsets: wheelMounts.map(() => 0),
    wheelContacts: wheelMounts.map(() => true),
  };
}

export function advanceVerticalMotion(
  motion: ReturnType<typeof createVerticalMotion>,
  ground: ReturnType<typeof groundUnderCar>,
  dt: number,
  acceleration = { forward: 0, sideways: 0 },
) {
  // Small substeps keep the progressive bump stops stable on hard landings.
  const steps = Math.ceil(dt / (1 / 240));
  const substep = dt / steps;
  for (let step = 0; step < steps; step++) {
    const cp = Math.cos(motion.pitch),
      sp = Math.sin(motion.pitch);
    const cb = Math.cos(motion.bank),
      sb = Math.sin(motion.bank);
    let force = 0,
      pitchTorque = 0,
      bankTorque = 0,
      contacts = 0;
    for (let i = 0; i < wheelMounts.length; i++) {
      const wheel = wheelMounts[i];
      const height = MathUtils.lerp(
        motion.groundHeights[i],
        ground.heights[i],
        (step + 1) / steps,
      );
      const surfaceVelocity =
        (ground.heights[i] - motion.groundHeights[i]) / dt;
      const tireBottom =
        motion.height +
        cp * (sb * wheel.x + cb * tireRadius) -
        sp * wheel.z -
        tireRadius;
      const compression = height - tireBottom;
      const contact = compression >= -suspensionDroop;
      motion.wheelContacts[i] = contact;
      if (!contact) continue;
      contacts++;
      const pitchLever = -sp * (sb * wheel.x + cb * tireRadius) - cp * wheel.z;
      const bankLever = cp * (cb * wheel.x - sb * tireRadius);
      const relativeVelocity =
        motion.velocity +
        pitchLever * motion.pitchVelocity +
        bankLever * motion.bankVelocity -
        surfaceVelocity;
      const engagement = MathUtils.smoothstep(
        compression,
        -suspensionDroop,
        -suspensionDroop + 0.035,
      );
      const damping = relativeVelocity < 0 ? 6 : 3.8;
      const bumpStop = Math.max(0, compression - 0.09) * 1200;
      // The suspension can push up, but it cannot pull airborne tires toward the road.
      const wheelForce =
        Math.max(
          0,
          (staticCompression + compression) * springRate -
            relativeVelocity * damping +
            bumpStop,
        ) * engagement;
      force += wheelForce;
      pitchTorque += pitchLever * wheelForce;
      bankTorque += bankLever * wheelForce;
    }
    motion.grounded = contacts > 0;
    const verticalAcceleration = force - gravity;
    motion.height +=
      motion.velocity * substep +
      0.5 * verticalAcceleration * substep * substep;
    motion.velocity += verticalAcceleration * substep;
    // Tire forces rotate the body around its center of mass. In the air it keeps
    // its angular momentum instead of being steered toward the flight trajectory.
    const transfer = contacts / wheelMounts.length;
    pitchTorque -=
      MathUtils.clamp(acceleration.forward, -20, 20) * 0.55 * transfer;
    bankTorque -=
      MathUtils.clamp(acceleration.sideways, -24, 24) * 0.5 * transfer;
    motion.pitchVelocity +=
      (pitchTorque / 1.8 - motion.pitchVelocity * 0.7) * substep;
    motion.bankVelocity +=
      (bankTorque / 1.1 - motion.bankVelocity * 0.9) * substep;
    motion.pitch += motion.pitchVelocity * substep;
    motion.bank += motion.bankVelocity * substep;
  }
  const cp = Math.cos(motion.pitch),
    sp = Math.sin(motion.pitch);
  const cb = Math.cos(motion.bank),
    sb = Math.sin(motion.bank);
  for (let i = 0; i < wheelMounts.length; i++) {
    const wheel = wheelMounts[i];
    const tireBottom =
      motion.height +
      cp * (sb * wheel.x + cb * tireRadius) -
      sp * wheel.z -
      tireRadius;
    motion.wheelOffsets[i] = MathUtils.clamp(
      (ground.heights[i] - tireBottom) / Math.max(cp * cb, 0.3),
      -suspensionDroop,
      0.24,
    );
    motion.groundHeights[i] = ground.heights[i];
  }
}
