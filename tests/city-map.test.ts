import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  cityHeight,
  cityRoute,
  createCityGroundGeometry,
} from '../app/city-map.ts';
import { cityPoint, cityRoadDistance } from '../app/city-layout.ts';
import {
  createVehiclePhysics,
  initializeVehiclePhysics,
} from '../app/vehicle-physics.ts';

await test('the city circuit stays on streets and clears the authored buildings and parked cars', async () => {
  const asset = await readFile(
    new URL('../public/models/city-papaya.glb', import.meta.url),
  );
  const { scene } = await new GLTFLoader().parseAsync(
    asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const solids: THREE.Mesh[] = [];
  const streets: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith('City_solids'))
      solids.push(object);
    if (object instanceof THREE.Mesh && object.name.startsWith('City_streets'))
      streets.push(object);
  });
  assert.ok(solids.length > 5, 'Blender collision surfaces load');
  assert.equal(
    streets.length,
    3,
    'Asphalt, sidewalks, and curb faces are real meshes',
  );
  const asphalt = streets.filter((mesh) => mesh.name.includes('asphalt'));
  const sidewalks = streets.filter((mesh) => mesh.name.includes('sidewalk'));
  const ray = new THREE.Raycaster(
    new THREE.Vector3(),
    new THREE.Vector3(0, -1, 0),
    0,
    60,
  );
  for (let i = 0; i < 600; i++) {
    const p = cityRoute.route(i / 600);
    const heading = cityRoute.routeHeading(i / 600);
    for (const side of [-1.4, 0, 1.4]) {
      const x = p.x + Math.cos(heading) * side,
        z = p.z - Math.sin(heading) * side;
      assert.ok(
        cityRoadDistance(x, z) < 7,
        'The full driving line stays on asphalt',
      );
      ray.ray.origin.set(x, 90, z);
      ray.far = 100;
      assert.equal(
        ray.intersectObjects([...solids, ...sidewalks]).length,
        0,
        'The full driving line stays clear',
      );
      assert.ok(
        ray.intersectObjects(asphalt).length > 0,
        'Road mesh covers the circuit through curves and junctions',
      );
    }
  }
  await initializeVehiclePhysics();
  const ground = createCityGroundGeometry();
  const car = createVehiclePhysics(ground, cityHeight);
  try {
    [...solids, ...streets].forEach((mesh) => car.addSolid(mesh));
    // Drive a real uphill street section. Both the car and Blender props use
    // the same graded surface; paint must not create physical bumps.
    const [sx, sz] = cityPoint(-75, -80);
    const [ex, ez] = cityPoint(-50, -80);
    car.reset(sx, sz, Math.atan2(ex - sx, ez - sz));
    let impact = 0;
    for (let i = 0; i < 500 && car.state.position.x < ex; i++) {
      const state = car.step(
        { gas: true, reverse: false, brake: false, turn: 0 },
        1 / 120,
      );
      impact = Math.max(impact, state.impact.speed);
    }
    assert.ok(car.state.position.x >= ex, 'The car crosses the graded street');
    assert.ok(impact < 2, 'Road markings introduce no collision bumps');
    const heights = Array.from(
      { length: 100 },
      (_, i) => cityRoute.route(i / 100).y,
    );
    assert.ok(
      Math.max(...heights) - Math.min(...heights) > 12,
      'The circuit climbs between neighborhoods',
    );
    assert.ok(cityHeight(265, -255) > 100, 'Mountains surround the city');
  } finally {
    car.dispose();
    ground.dispose();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).forEach((material) => materials.add(material));
    });
    materials.forEach((material) => material.dispose());
  }
});
