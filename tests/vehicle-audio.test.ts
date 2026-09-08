import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createEngineSoundState,
  advanceEngineSound,
  blendEngineRecordings,
  engineRecordings,
} from '../app/vehicle-audio.ts';

const dt = 1 / 60;

await test('RPM layers crossfade without volume holes or large pitch stretching', () => {
  for (const recordings of Object.values(engineRecordings)) {
    for (let rpm = recordings[0]; rpm <= 6400; rpm += 7) {
      const mix = blendEngineRecordings(rpm, recordings);
      assert.ok(
        Math.abs(mix.reduce((power, voice) => power + voice.gain ** 2, 0) - 1) <
          1e-10,
      );
      assert.ok(mix.filter((voice) => voice.gain > 1e-6).length <= 2);
      mix.forEach((voice, i) => {
        if (voice.gain < 1e-6) return;
        assert.ok(
          Math.abs(voice.rate * recordings[i] - rpm) < 1e-6,
          'Overlapping recordings must agree on the engine RPM',
        );
        assert.ok(voice.rate >= 0.72 && voice.rate <= 1.4);
      });
    }
    for (const rpm of recordings.slice(1, -1)) {
      const before = blendEngineRecordings(rpm - 0.01, recordings);
      const after = blendEngineRecordings(rpm + 0.01, recordings);
      assert.ok(
        before.every(
          (voice, i) => Math.abs(voice.gain - after[i].gain) < 0.001,
        ),
      );
    }
  }
  const idle = blendEngineRecordings(950, engineRecordings.motor);
  assert.equal(idle[0].gain, 1);
  assert.ok(idle[0].rate > 0.8);
});

await test('acceleration shifts up with a rev drop and coasting shifts down without hunting', () => {
  const engine = createEngineSoundState();
  let shifts = 0;
  for (let i = 0; i < 360; i++) {
    const before = engine.gear;
    const beforeRpm = engine.rpm;
    advanceEngineSound(
      engine,
      {
        speed: Math.min(26.4, i * dt * 7),
        throttle: 1,
        grounded: true,
        skid: 0,
        running: true,
      },
      dt,
    );
    if (engine.gear > before) {
      shifts++;
      assert.ok(
        engine.rpm < beforeRpm,
        'Upshifting must lower the engine note',
      );
    }
    assert.ok(engine.rpm >= 950 && engine.rpm <= 6400);
  }
  assert.equal(shifts, 2);
  for (let i = 0; i < 180; i++)
    advanceEngineSound(
      engine,
      { speed: 0, throttle: 0, grounded: true, skid: 0, running: true },
      dt,
    );
  assert.equal(engine.gear, 0);
  assert.ok(Math.abs(engine.rpm - 950) < 1);
});

await test('airborne throttle free-revs, reverse stays in one gear, and wrecking stops the engine', () => {
  const engine = createEngineSoundState();
  for (let i = 0; i < 120; i++)
    advanceEngineSound(
      engine,
      { speed: 8, throttle: 1, grounded: false, skid: 0, running: true },
      dt,
    );
  assert.ok(engine.rpm > 6200);
  assert.equal(engine.gear, 0);
  for (let i = 0; i < 120; i++)
    advanceEngineSound(
      engine,
      { speed: -6, throttle: 0.65, grounded: true, skid: 0, running: true },
      dt,
    );
  assert.equal(engine.gear, 0);
  assert.ok(engine.rpm > 2900 && engine.rpm < 3100);
  for (let i = 0; i < 120; i++)
    advanceEngineSound(
      engine,
      { speed: 0, throttle: 1, grounded: true, skid: 0, running: false },
      dt,
    );
  assert.ok(engine.rpm < 1);
});
