import { seaLevel } from './terrain.ts';

export function createVehicleWater() {
  return { depth: 0, exposure: 0, flooded: false };
}

export function advanceVehicleWater(
  water: ReturnType<typeof createVehicleWater>,
  height: number,
  pitch: number,
  bank: number,
  dt: number,
) {
  water.depth = Math.max(0, seaLevel - height);
  // The intake sits near the front of the engine bay, above the wheel hubs.
  const intakeHeight =
    height + 0.82 * Math.cos(pitch) * Math.cos(bank) - 1.15 * Math.sin(pitch);
  water.exposure = intakeHeight < seaLevel ? water.exposure + dt : 0;
  if (water.exposure >= 0.2) water.flooded = true;
}
