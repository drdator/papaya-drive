import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { maps } from '../app/maps.ts';
import { createTerrainGeometry, seaLevel, route } from '../app/terrain.ts';
import { tropicalHeight, tropicalRoute } from '../app/tropical-map.ts';
import {
  createVehiclePhysics,
  initializeVehiclePhysics,
} from '../app/vehicle-physics.ts';

await test('both maps keep independent routes and the tropical beach loop stays dry', () => {
  assert.deepEqual(maps.ridge.route(0), route(0));
  assert.ok(maps.tropical.route(0).distanceTo(route(0)) > 20);
  for (let i = 0; i < 480; i++) {
    const p = tropicalRoute.route(i / 480);
    const heading = tropicalRoute.routeHeading(i / 480);
    for (const side of [-4.5, 0, 4.5]) {
      const x = p.x + Math.cos(heading) * side;
      const z = p.z - Math.sin(heading) * side;
      assert.ok(
        tropicalHeight(x, z) > seaLevel + 0.7,
        'The track and shoulders remain above water',
      );
    }
    assert.ok(
      maps.tropical.terrain.coastAt(p.x, p.z) > 0.2,
      'The loop follows the beach',
    );
  }
  assert.ok(tropicalRoute.distanceToRoad(52.5, 0) < 0.1);
});

await initializeVehiclePhysics();
await test('the car can drive under the arch while its stone pillars remain solid', async () => {
  const terrain = createTerrainGeometry(tropicalHeight);
  const asset = await readFile(
    new URL('../public/models/mountain-palm-cove.glb', import.meta.url),
  );
  const { scene: mountain } = await new GLTFLoader().parseAsync(
    asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
    '',
  );
  const solids: THREE.Mesh[] = [];
  mountain.traverse((object) => {
    if (object instanceof THREE.Mesh) solids.push(object);
  });
  try {
    for (const [x, direction] of [
      [49, -1],
      [52.5, -1],
      [56, -1],
      [52.5, 1],
      [64, -1],
    ]) {
      const startZ = -19 * direction;
      const car = createVehiclePhysics(terrain, tropicalHeight);
      try {
        solids.forEach((mesh) => car.addSolid(mesh));
        car.reset(x, startZ, direction < 0 ? Math.PI : 0);
        for (let i = 0; i < 120; i++)
          car.step(
            { gas: false, reverse: false, brake: false, turn: 0 },
            1 / 120,
          );
        assert.ok(
          Math.abs(car.state.position.y - tropicalHeight(x, startZ)) < 0.3,
          'Reset uses the selected island surface',
        );
        car.body.setLinvel({ x: 0, y: 0, z: 12 * direction }, true);
        let impact = 0;
        for (let i = 0; i < 360; i++) {
          const state = car.step(
            { gas: true, reverse: false, brake: false, turn: 0 },
            1 / 120,
          );
          impact = Math.max(impact, state.impact.speed);
          // Stop after clearing the tunnel; continuing straight eventually runs off the beach.
          if (x < 60 && state.position.z * direction > 15) break;
        }
        if (x < 60) {
          assert.ok(
            car.state.position.z * direction > 15,
            'The car crosses the whole rock tunnel',
          );
          assert.ok(impact < 4, 'There is no invisible wall in the opening');
        } else {
          assert.ok(
            car.state.position.z > 7 && Math.abs(car.state.speed) < 1,
            'The adjacent stone pillar blocks the car',
          );
        }
      } finally {
        car.dispose();
      }
    }
  } finally {
    terrain.dispose();
    for (const mesh of solids) mesh.geometry.dispose();
    const materials = new Set(
      solids.flatMap((mesh) =>
        Array.isArray(mesh.material) ? mesh.material : [mesh.material],
      ),
    );
    for (const material of materials) material.dispose();
  }
});

await test('tropical scenery adds shoreline variety while leaving the track clear', async () => {
  const { createTropicalScenery } = await import('../app/tropical-scenery.ts');
  const scenery = createTropicalScenery([
    new THREE.Group(),
    new THREE.Group(),
    new THREE.Group(),
  ]);
  const asset = await readFile(
    new URL('../public/models/props-palm-cove.glb', import.meta.url),
  );
  const { scene: props } = await new GLTFLoader().parseAsync(
    asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
    '',
  );
  scenery.group.add(props);
  props.traverse((object) => {
    if (object instanceof THREE.Mesh) scenery.solids.push(object);
  });
  scenery.group.updateMatrixWorld(true);
  const jetty = props.getObjectByName('Jetty');
  const boat = props.getObjectByName('Moored_boat');
  assert.ok(jetty && boat, 'The fishing landing models load');
  const boatBounds = new THREE.Box3().setFromObject(boat);
  assert.ok(boatBounds.min.y < seaLevel && boatBounds.max.y > seaLevel);
  const deck = new THREE.Vector3(67.393, 1.43, 18.058);
  assert.ok(
    Math.abs(deck.y - tropicalHeight(deck.x, deck.z)) < 0.4,
    'The jetty joins the sand at walking height',
  );
  assert.ok(scenery.trunks.length > 20, 'Palms form several groves');
  assert.ok(
    scenery.solids.some((mesh) => mesh.name === 'Shallow-water outcrop'),
  );
  assert.ok(
    scenery.solids.some((mesh) => mesh.name === 'Sun-bleached driftwood'),
  );
  const point = new THREE.Vector3();
  for (const mesh of scenery.solids) {
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      assert.ok(
        tropicalRoute.distanceToRoad(point.x, point.z) > 5.5,
        `${mesh.name} leaves both the lane and shoulders clear`,
      );
    }
  }
  for (const trunk of scenery.trunks)
    assert.ok(
      tropicalRoute.distanceToRoad(trunk.x, trunk.z) > 6 + trunk.radius,
    );
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scenery.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
});
