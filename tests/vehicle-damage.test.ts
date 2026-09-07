import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVehicleDamage,
  advanceVehicleDamage,
} from '../app/vehicle-damage.ts';

const dt = 1 / 120;

await test('a hard crash wrecks the car while separate small collisions accumulate', () => {
  const hard = createVehicleDamage();
  advanceVehicleDamage(hard, 95 / 3.6, dt);
  assert.equal(hard.amount, 100);

  const small = createVehicleDamage();
  advanceVehicleDamage(small, 5, dt);
  assert.ok(small.amount > 4 && small.amount < 6);
  for (let i = 0; i < 20; i++) advanceVehicleDamage(small, 5, 0.5);
  assert.equal(small.amount, 100);
});

await test('a single crash spanning multiple collision ticks is counted once', () => {
  const damage = createVehicleDamage();
  advanceVehicleDamage(damage, 12, dt);
  const firstImpact = damage.amount;
  for (let i = 0; i < 10; i++) advanceVehicleDamage(damage, 10, dt);
  assert.equal(damage.amount, firstImpact);

  // A stronger second contact must still add its extra damage.
  advanceVehicleDamage(damage, 18, dt);
  const direct = createVehicleDamage();
  advanceVehicleDamage(direct, 18, dt);
  assert.ok(Math.abs(damage.amount - direct.amount) < 1e-9);

  advanceVehicleDamage(damage, 0, 0.3);
  advanceVehicleDamage(damage, 12, dt);
  assert.ok(Math.abs(damage.amount - direct.amount - firstImpact) < 1e-9);
});

await test('resting, nudging and moving away from an obstacle do not cause damage', () => {
  const damage = createVehicleDamage();
  for (let i = 0; i < 1200; i++) {
    for (const speed of [-10, 0, 0.1, 1.5])
      advanceVehicleDamage(damage, speed, dt);
  }
  assert.equal(damage.amount, 0);
});
