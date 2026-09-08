import { terrainHeight } from './terrain.ts';

export const gravity = 14;
export const tireRadius = 0.37;
export const wheelMounts = [
  { name: 'Wheel_FR', x: 0.84, z: 1.13 },
  { name: 'Wheel_FL', x: -0.84, z: 1.13 },
  { name: 'Wheel_RR', x: 0.84, z: -1.12 },
  { name: 'Wheel_RL', x: -0.84, z: -1.12 },
];
export function groundUnderCar(
  x: number,
  z: number,
  heading: number,
  heightAt = terrainHeight,
) {
  const fx = Math.sin(heading),
    fz = Math.cos(heading);
  const heights = wheelMounts.map(
    (wheel) =>
      heightAt(
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
