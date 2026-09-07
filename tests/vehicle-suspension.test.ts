import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVerticalMotion,
  advanceVerticalMotion,
} from '../app/vehicle-ground.ts';

const dt = 1 / 120;
const flatGround = {
  height: 0,
  pitch: 0,
  bank: 0,
  forwardSlope: 0,
  sideSlope: 0,
  heights: [0, 0, 0, 0],
};

await test('nose-first contact swings the rear down into a separate impact', () => {
  const motion = createVerticalMotion(flatGround);
  motion.height = 1.2;
  motion.pitch = 0.3;
  motion.grounded = false;
  let frontContact: number | undefined, rearContact: number | undefined;
  let rearImpactVelocity = 0,
    bodyVelocityAtRearImpact = 0;
  for (let i = 0; i < 480; i++) {
    advanceVerticalMotion(motion, flatGround, dt);
    if (motion.wheelContacts[0] && frontContact === undefined)
      frontContact = i * dt;
    if (motion.wheelContacts[2] && rearContact === undefined) {
      rearContact = i * dt;
      bodyVelocityAtRearImpact = motion.velocity;
      rearImpactVelocity =
        motion.velocity + Math.cos(motion.pitch) * 1.12 * motion.pitchVelocity;
    }
  }
  assert.ok(frontContact !== undefined && rearContact !== undefined);
  assert.ok(rearContact - frontContact > 0.08);
  assert.ok(rearImpactVelocity < -3);
  assert.ok(
    rearImpactVelocity < bodyVelocityAtRearImpact - 1,
    'Pitch momentum must drive the rear into the ground',
  );
  assert.ok(Math.abs(motion.pitch) < 0.002);
  assert.ok(Math.abs(motion.pitchVelocity) < 0.001);
  assert.ok(Math.abs(motion.velocity) < 0.001);
});

await test('touchdown absorbs downward momentum over time instead of adding a hop', () => {
  const motion = createVerticalMotion(flatGround);
  motion.height = 1.2;
  motion.grounded = false;
  let touched = false,
    compression = 0,
    rebound = 0;
  for (let i = 0; i < 480; i++) {
    advanceVerticalMotion(motion, flatGround, dt);
    if (motion.grounded && !touched) {
      touched = true;
      assert.ok(
        motion.velocity < -3,
        'Velocity must not snap upward at first contact',
      );
    }
    if (touched) {
      compression = Math.min(compression, motion.height);
      if (compression < -0.02) rebound = Math.max(rebound, motion.height);
    }
  }
  assert.ok(compression < -0.03 && compression > -0.15);
  assert.ok(rebound > 0 && rebound < 0.12);
  assert.ok(Math.abs(motion.height) < 0.001);
  assert.ok(Math.abs(motion.velocity) < 0.001);
});

await test('the airborne body keeps its attitude until tire contact applies torque', () => {
  const motion = createVerticalMotion(flatGround);
  motion.height = 8;
  motion.pitch = 0.3;
  motion.bank = -0.1;
  motion.grounded = false;
  for (let i = 0; i < 60; i++) advanceVerticalMotion(motion, flatGround, dt);
  assert.equal(motion.pitch, 0.3);
  assert.equal(motion.bank, -0.1);
  assert.equal(motion.grounded, false);
});
