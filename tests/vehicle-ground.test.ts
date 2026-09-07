import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceVerticalMotion,
  createVerticalMotion,
  groundUnderCar,
  gravity,
} from '../app/vehicle-ground.ts';
import {
  route,
  routeLength,
  terrainHeight,
  distanceToRoad,
} from '../app/terrain.ts';

const dt = 1 / 120;
function crossRidge(speed: number) {
  const motion = createVerticalMotion(groundUnderCar(-32, 30, Math.PI / 2));
  let maxClearance = 0,
    airborneTime = 0;
  for (let x = -32; x < 32; x += speed * dt) {
    const ground = groundUnderCar(x, 30, Math.PI / 2);
    advanceVerticalMotion(motion, ground, dt);
    assert.ok(
      motion.height + 0.25 >= ground.height,
      'Suspension travel must keep the chassis clear of the ground',
    );
    const clearance = motion.height - ground.height;
    maxClearance = Math.max(maxClearance, clearance);
    if (!motion.grounded) airborneTime += dt;
  }
  return { motion, maxClearance, airborneTime };
}

await test('slow driving follows the ridge; high speed launches and lands', () => {
  const slow = crossRidge(5);
  assert.equal(slow.airborneTime, 0);
  const fast = crossRidge(20);
  assert.ok(fast.maxClearance > 0.5 && fast.maxClearance < 2);
  assert.ok(fast.airborneTime > 0.4 && fast.airborneTime < 1.2);
  assert.equal(fast.motion.grounded, true);
});

await test('airborne vertical motion follows gravity independently of terrain below it', () => {
  const ground = groundUnderCar(0, 30, 0);
  const motion = createVerticalMotion(ground);
  motion.height += 8;
  motion.velocity = 4;
  motion.grounded = false;
  const initialHeight = motion.height;
  for (let i = 0; i < 60; i++) advanceVerticalMotion(motion, ground, dt);
  assert.ok(
    Math.abs(
      motion.height - (initialHeight + 4 * 0.5 - 0.5 * gravity * 0.5 ** 2),
    ) < 1e-9,
  );
  assert.ok(Math.abs(motion.velocity - (4 - gravity * 0.5)) < 1e-9);
});

await test('parking on a slope settles, and reversing follows the downhill surface', () => {
  const ground = groundUnderCar(-8, 30, Math.PI / 2);
  const parked = createVerticalMotion(ground);
  for (let i = 0; i < 600; i++) advanceVerticalMotion(parked, ground, dt);
  const settledHeight = parked.height;
  for (let i = 0; i < 600; i++) advanceVerticalMotion(parked, ground, dt);
  assert.ok(Math.abs(parked.height - settledHeight) < 1e-6);
  assert.ok(Math.abs(parked.velocity) < 1e-6);
  assert.equal(parked.grounded, true);
  const reverse = createVerticalMotion(ground);
  for (let i = 1; i <= 240; i++)
    advanceVerticalMotion(
      reverse,
      groundUnderCar(-8 - 4 * dt * i, 30, Math.PI / 2),
      dt,
    );
  assert.ok(reverse.velocity < -0.1);
  assert.equal(reverse.grounded, true);
});

await test('the winding route closes smoothly and its checkpoints follow the hills', () => {
  assert.ok(route(0).distanceTo(route(1)) < 1e-9);
  assert.ok(routeLength > 300);
  const heights = [];
  for (let i = 0; i < 8; i++) {
    const point = route(i / 8);
    assert.equal(point.y, terrainHeight(point.x, point.z));
    assert.ok(distanceToRoad(point.x, point.z) < 0.02);
    heights.push(point.y);
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 3);
});
