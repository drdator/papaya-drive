import { MathUtils } from 'three';

export const topSpeed = 95 / 3.6;

export function createPlanarMotion(heading: number) {
  return { x: 0, z: 0, heading, steering: 0, slip: 0 };
}
export type DriveInput = {
  gas: boolean;
  reverse: boolean;
  brake: boolean;
  turn: number;
};

export function advancePlanarMotion(
  motion: ReturnType<typeof createPlanarMotion>,
  input: DriveInput,
  grounded: boolean,
  pitch: number,
  dt: number,
) {
  const speed = Math.hypot(motion.x, motion.z);
  const steeringLimit = MathUtils.lerp(
    0.48,
    0.4,
    MathUtils.smoothstep(speed, 20, topSpeed),
  );
  motion.steering = MathUtils.damp(
    motion.steering,
    input.turn * steeringLimit,
    9,
    dt,
  );
  // Tires cannot redirect momentum or apply brakes while the car is airborne.
  if (!grounded) return;
  let fx = Math.sin(motion.heading),
    fz = Math.cos(motion.heading);
  let forward = motion.x * fx + motion.z * fz;
  let sideways = motion.x * fz - motion.z * fx;
  const reversing =
    input.reverse && !input.gas && forward < 0.1 && Math.abs(sideways) < 0.3;
  const braking =
    input.brake ||
    (input.gas && input.reverse) ||
    (input.reverse && !reversing) ||
    (input.gas && forward < -0.2);
  const breakGrip = braking && speed > 7 && Math.abs(motion.steering) > 0.09;
  motion.slip = MathUtils.damp(
    motion.slip,
    breakGrip ? 1 : 0,
    breakGrip ? 7 : 2.5,
    dt,
  );

  if (braking) {
    // Braking dissipates momentum without immediately rotating it toward the nose.
    const remaining = Math.max(
      0,
      speed - MathUtils.lerp(14, 9.5, motion.slip) * dt,
    );
    const ratio = speed > 0 ? remaining / speed : 0;
    motion.x *= ratio;
    motion.z *= ratio;
  } else if (input.gas || reversing) {
    const acceleration = input.gas ? 12 : -7;
    motion.x += fx * acceleration * dt;
    motion.z += fz * acceleration * dt;
  } else {
    const ratio = speed > 0 ? Math.max(0, speed - 2.3 * dt) / speed : 0;
    motion.x *= ratio;
    motion.z *= ratio;
  }
  if (!braking && speed > 0.1) {
    motion.x += fx * Math.sin(pitch) * 4 * dt;
    motion.z += fz * Math.sin(pitch) * 4 * dt;
  }
  forward = motion.x * fx + motion.z * fz;
  motion.heading +=
    (((forward / 2.5) * Math.tan(motion.steering) * dt) / (1 + speed * 0.055)) *
    (1 + motion.slip * 0.2);
  fx = Math.sin(motion.heading);
  fz = Math.cos(motion.heading);
  forward = motion.x * fx + motion.z * fz;
  sideways = motion.x * fz - motion.z * fx;
  const grip = MathUtils.lerp(18, 1.35, motion.slip);
  sideways *= Math.exp(-grip * dt);
  motion.x = fx * forward + fz * sideways;
  motion.z = fz * forward - fx * sideways;
  const limit = reversing ? 6 : topSpeed;
  const resultingSpeed = Math.hypot(motion.x, motion.z);
  if (resultingSpeed > limit) {
    motion.x *= limit / resultingSpeed;
    motion.z *= limit / resultingSpeed;
  }
}
