import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createFlyCamera } from '../app/fly-camera.ts';

await test('free flight carries the car, follows the view, and keeps the drop position above terrain', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 20, 30);
  const rotation = camera.quaternion.clone();
  const flight = createFlyCamera(camera, () => 2);
  flight.enter(new THREE.Vector3(10, 17, 20));
  flight.update(1, new Set(['w']));
  assert.deepEqual(camera.position.toArray(), [10, 20, 12]);
  assert.deepEqual(flight.carPosition.toArray(), [10, 17, 2]);
  flight.update(0.5, new Set(['e', 'Shift']));
  assert.equal(camera.position.y, 44);
  assert.equal(flight.carPosition.y, 41);
  const previous = camera.position.clone();
  flight.update(1, new Set(['w', 'd', 'e']));
  assert.ok(
    Math.abs(camera.position.distanceTo(previous) - 18) < 0.001,
    'Diagonal flight has the same speed',
  );
  flight.look(200, -100);
  assert.notDeepEqual(camera.quaternion.toArray(), rotation.toArray());
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const before = camera.position.clone();
  flight.update(0.1, new Set(['w']));
  assert.ok(
    camera.position.clone().sub(before).normalize().distanceTo(direction) <
      0.001,
    'Forward follows the viewing direction',
  );
  flight.update(10, new Set(['q']));
  assert.ok(camera.position.y >= 2.8, 'The camera stays above the surface');
  assert.ok(flight.carPosition.y >= 2.25, 'The car stays above the surface');
  const localOffset = flight.carPosition
    .clone()
    .sub(camera.position)
    .applyQuaternion(camera.quaternion.clone().invert());
  assert.ok(
    localOffset.distanceTo(new THREE.Vector3(0, -3, -10)) < 0.001,
    'The car keeps its visible position relative to the camera',
  );
  const carForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    flight.carRotation,
  );
  assert.ok(
    Math.abs(carForward.y) < 0.001,
    'The car stays upright for the drop',
  );
  direction.y = 0;
  assert.ok(
    carForward.distanceTo(direction.normalize()) < 0.001,
    'The car points in the viewing direction',
  );
});
