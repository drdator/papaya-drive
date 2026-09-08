import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createWaterEffects } from '../app/water-effects.ts';
import {
  mountainHeight,
  route,
  routeHeading,
  seaLevel,
} from '../app/terrain.ts';

await test('the mountain leaves the whole track and six-meter shoulders untouched', () => {
  const taller = mountainHeight(-15, -5),
    shorter = mountainHeight(-8, 1);
  assert.ok(taller > shorter && shorter > 12);
  assert.ok(
    mountainHeight(-11.5, -2) < shorter,
    'A shallow saddle connects the two peaks',
  );
  for (let i = 0; i < 960; i++) {
    const p = route(i / 960);
    const heading = routeHeading(i / 960);
    for (const side of [-6, -4, 0, 4, 6]) {
      assert.equal(
        mountainHeight(
          p.x + Math.cos(heading) * side,
          p.z - Math.sin(heading) * side,
        ),
        0,
      );
    }
  }
});

await test('water entry emits bounded effects that pause, fade, and reset without repeating at rest', () => {
  const effects = createWaterEffects();
  const car = new THREE.Group();
  car.position.set(100, seaLevel + 1, 0);
  effects.update(1 / 60, car, 10, 0);
  assert.ok(effects.group.children.every((mesh) => !mesh.visible));
  car.position.y = seaLevel - 0.1;
  effects.update(1 / 60, car, 10, -1);
  const visible = effects.group.children.filter((mesh) => mesh.visible);
  assert.ok(visible.length >= 9);
  const before = visible.map((mesh) => ({
    position: mesh.position.clone(),
    scale: mesh.scale.clone(),
  }));
  effects.update(0, car, 0, 0);
  visible.forEach((mesh, i) => {
    assert.deepEqual(mesh.position, before[i].position);
    assert.deepEqual(mesh.scale, before[i].scale);
  });
  for (let i = 0; i < 180; i++) effects.update(1 / 60, car, 0, 0);
  assert.ok(effects.group.children.every((mesh) => !mesh.visible));
  const capacity = effects.group.children.length;
  for (let i = 0; i < 600; i++) effects.update(1 / 60, car, 10, 0);
  assert.equal(effects.group.children.length, capacity);
  effects.reset();
  assert.ok(effects.group.children.every((mesh) => !mesh.visible));
});
