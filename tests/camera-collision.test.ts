import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createCameraCollision,
  cameraClearance,
} from '../app/camera-collision.ts';
import { initializeVehiclePhysics } from '../app/vehicle-physics.ts';
import { createFlyCamera } from '../app/fly-camera.ts';

await initializeVehiclePhysics();

await test('camera sweeps stop at walls and roof edges, slide along them, and recover from inside a building', () => {
  const collision = createCameraCollision();
  const building = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 10));
  building.position.set(0, 4, 0);
  collision.add(building);
  collision.build();
  try {
    const destination = new THREE.Vector3(12, 3, 0);
    collision.move(new THREE.Vector3(-12, 3, 0), destination, false);
    assert.ok(
      destination.x < -2 - cameraClearance,
      'Chase camera stops in front of the wall',
    );
    destination.set(12, 3, 2);
    collision.move(new THREE.Vector3(-12, 3, -2), destination);
    assert.ok(
      destination.x < -2 - cameraClearance,
      'Fast flight cannot tunnel through a building',
    );
    assert.ok(destination.z > 1.9, 'Flight slides along the wall');
    destination.set(0, 3, 0);
    collision.move(destination.clone(), destination);
    assert.ok(
      Math.abs(destination.x) >= 2 + cameraClearance ||
        Math.abs(destination.z) >= 5 + cameraClearance ||
        destination.y >= 8 + cameraClearance,
      'An embedded starting point is recovered outside',
    );
    destination.set(0, 2, 0);
    collision.move(new THREE.Vector3(0, 12, 0), destination, false);
    assert.ok(
      destination.y > 8 + cameraClearance,
      'Descending camera stops above a roof',
    );
    destination.set(12, 8.25, 0);
    collision.move(new THREE.Vector3(-12, 8.25, 0), destination, false);
    assert.ok(
      destination.x < -2,
      'The camera volume catches a roof edge even when its center ray clears it',
    );
  } finally {
    collision.dispose();
    building.geometry.dispose();
    (building.material as THREE.Material).dispose();
  }
});

await test('open arch roofs block flight without filling the passage, and the carried car follows the corrected camera', () => {
  const collision = createCameraCollision();
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(20, 20));
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = 6;
  collision.add(roof);
  collision.build();
  try {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 8);
    const flight = createFlyCamera(
      camera,
      () => 0,
      (from, to) => collision.move(from, to),
    );
    flight.enter(new THREE.Vector3(0, 1, 5));
    flight.update(0.5, new Set(['w']));
    assert.ok(
      camera.position.z < 0,
      'The space beneath an open roof remains accessible',
    );
    flight.update(1, new Set(['e', 'Shift']));
    assert.ok(
      camera.position.y < 6 - cameraClearance,
      'Fast ascent cannot enter a ceiling from below',
    );
    assert.ok(
      Math.abs(flight.carPosition.y - (camera.position.y - 1)) < 0.001,
      'The carried car follows the collision-corrected pose',
    );
  } finally {
    collision.dispose();
    roof.geometry.dispose();
    (roof.material as THREE.Material).dispose();
  }
});

await test('camera collision follows an animated scenery mesh instead of leaving an invisible obstacle behind', () => {
  const collision = createCameraCollision();
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 8));
  cabin.position.set(0, 5, 0);
  collision.add(cabin, true);
  collision.build();
  cabin.position.x = 20;
  cabin.rotation.y = Math.PI / 2;
  collision.update();
  const destination = new THREE.Vector3(8, 5, 0);
  collision.move(new THREE.Vector3(-8, 5, 0), destination, false);
  assert.equal(destination.x, 8, 'The original position is clear');
  destination.set(30, 5, 0);
  collision.move(new THREE.Vector3(8, 5, 0), destination, false);
  assert.ok(
    destination.x < 16 - cameraClearance && destination.x > 15,
    'The rotated cabin blocks the camera at its new position',
  );
  collision.dispose();
  cabin.geometry.dispose();
  (cabin.material as THREE.Material).dispose();
});
