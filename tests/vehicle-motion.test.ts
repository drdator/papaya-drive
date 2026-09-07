import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPlanarMotion,
  advancePlanarMotion,
} from '../app/vehicle-motion.ts';

const dt = 1 / 120;
const sidewaysSpeed = (motion: ReturnType<typeof createPlanarMotion>) =>
  motion.x * Math.cos(motion.heading) - motion.z * Math.sin(motion.heading);

await test('S brakes before entering reverse, while the handbrake only stops', () => {
  for (const handbrake of [false, true]) {
    const motion = createPlanarMotion(0);
    motion.z = 20;
    let passedThroughStop = false;
    for (let i = 0; i < 360; i++) {
      if (Math.abs(motion.z) < 0.1) passedThroughStop = true;
      advancePlanarMotion(
        motion,
        { gas: false, reverse: !handbrake, brake: handbrake, turn: 0 },
        true,
        0,
        dt,
      );
      if (motion.z < 0)
        assert.ok(
          passedThroughStop,
          'Reverse must not engage while moving forward',
        );
    }
    assert.ok(passedThroughStop);
    if (handbrake) assert.equal(motion.z, 0);
    else assert.ok(motion.z < -5 && motion.z >= -6);
  }
});

await test('a fast braking turn retains lateral momentum and recovers grip gradually', () => {
  const drive = createPlanarMotion(0),
    slide = createPlanarMotion(0);
  drive.z = slide.z = 20;
  let maxNormalSlip = 0,
    maxBrakingSlip = 0;
  for (let i = 0; i < 120; i++) {
    advancePlanarMotion(
      drive,
      { gas: true, reverse: false, brake: false, turn: 1 },
      true,
      0,
      dt,
    );
    advancePlanarMotion(
      slide,
      { gas: false, reverse: true, brake: false, turn: 1 },
      true,
      0,
      dt,
    );
    maxNormalSlip = Math.max(maxNormalSlip, Math.abs(sidewaysSpeed(drive)));
    maxBrakingSlip = Math.max(maxBrakingSlip, Math.abs(sidewaysSpeed(slide)));
  }
  assert.ok(maxBrakingSlip > maxNormalSlip * 2);
  assert.ok(Math.hypot(slide.x, slide.z) < 20);
  const before = Math.abs(sidewaysSpeed(slide));
  advancePlanarMotion(
    slide,
    { gas: true, reverse: false, brake: false, turn: 0 },
    true,
    0,
    dt,
  );
  assert.ok(
    Math.abs(sidewaysSpeed(slide)) > before * 0.8,
    'Grip must not snap back in one frame',
  );
  for (let i = 0; i < 120; i++)
    advancePlanarMotion(
      slide,
      { gas: true, reverse: false, brake: false, turn: 0 },
      true,
      0,
      dt,
    );
  assert.ok(Math.abs(sidewaysSpeed(slide)) < 0.2);
});

await test('slow turns stay planted and airborne inputs cannot change momentum', () => {
  const slow = createPlanarMotion(0);
  slow.z = 5;
  for (let i = 0; i < 60; i++)
    advancePlanarMotion(
      slow,
      { gas: false, reverse: true, brake: false, turn: 1 },
      true,
      0,
      dt,
    );
  assert.equal(slow.slip, 0);
  const air = createPlanarMotion(0.7);
  air.x = 5;
  air.z = 12;
  for (let i = 0; i < 120; i++)
    advancePlanarMotion(
      air,
      { gas: false, reverse: true, brake: true, turn: 1 },
      false,
      0,
      dt,
    );
  assert.equal(air.x, 5);
  assert.equal(air.z, 12);
  assert.equal(air.heading, 0.7);
});

await test('acceleration reaches 72 km/h sooner and forward speed is capped at 95 km/h', () => {
  const motion = createPlanarMotion(0);
  for (let i = 0; i < 210; i++)
    advancePlanarMotion(
      motion,
      { gas: true, reverse: false, brake: false, turn: 0 },
      true,
      0,
      dt,
    );
  assert.ok(motion.z * 3.6 > 72);
  for (let i = 0; i < 600; i++)
    advancePlanarMotion(
      motion,
      { gas: true, reverse: false, brake: false, turn: 0 },
      true,
      0,
      dt,
    );
  assert.ok(Math.abs(motion.z * 3.6 - 95) < 1e-9);
});
