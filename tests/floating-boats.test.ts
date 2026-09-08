import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFloatingBoats } from '../app/floating-boats.ts';
import { tropicalHeight } from '../app/tropical-map.ts';

await test('the authored boats float without drifting, while mooring lines stay attached at both ends', async () => {
  const asset = await readFile(
    new URL('../public/models/props-palm-cove.glb', import.meta.url),
  );
  const { scene } = await new GLTFLoader().parseAsync(
    asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
    '',
  );
  const motion = createFloatingBoats(scene, tropicalHeight);
  const [boat, yacht] = motion.objects;
  const buoys = motion.objects
    .slice(2)
    .map((object) => ({
      object,
      rest: object.position.clone(),
      heights: [] as number[],
    }));
  assert.equal(buoys.length, 2);
  const boatRest = boat.position.clone(),
    yachtRest = yacht.quaternion.clone();
  const jetty = scene.getObjectByName('Jetty')!;
  const jettyRest = jetty.position.clone();
  const heights: number[] = [];
  for (let time = 0; time < 16; time += 0.5) {
    motion.update(time);
    motion.ropes.updateMatrixWorld(true);
    heights.push(boat.position.y);
    for (const buoy of buoys) {
      buoy.heights.push(buoy.object.position.y);
      assert.equal(buoy.object.position.x, buoy.rest.x);
      assert.equal(buoy.object.position.z, buoy.rest.z);
    }
    assert.equal(boat.position.x, boatRest.x);
    assert.equal(boat.position.z, boatRest.z);
    assert.ok(
      yacht.quaternion.angleTo(yachtRest) < 0.08,
      'The yacht has a gentle tilt',
    );
    const anchors: number[][] = boat.userData.mooring_anchors;
    const points: number[][] = boat.userData.mooring_points;
    for (let i = 0; i < 2; i++) {
      const dockEnd = new THREE.Vector3(0, -0.5, 0).applyMatrix4(
        motion.ropes.children[i * 2].matrixWorld,
      );
      const boatEnd = new THREE.Vector3(0, 0.5, 0).applyMatrix4(
        motion.ropes.children[i * 2 + 1].matrixWorld,
      );
      assert.ok(
        dockEnd.distanceTo(new THREE.Vector3(...anchors[i])) < 0.001,
        'Jetty attachment stays fixed',
      );
      assert.ok(
        boatEnd.distanceTo(
          new THREE.Vector3(...points[i]).applyMatrix4(boat.matrixWorld),
        ) < 0.001,
        'Hull attachment moves with the boat',
      );
    }
  }
  assert.ok(
    Math.max(...heights) - Math.min(...heights) > 0.6,
    'The little boat follows the coastal swell',
  );
  for (const buoy of buoys)
    assert.ok(
      Math.max(...buoy.heights) - Math.min(...buoy.heights) > 0.08,
      'Both buoys rise and fall with the water',
    );
  assert.deepEqual(jetty.position.toArray(), jettyRest.toArray());
  motion.update(3);
  const pose = yacht.quaternion.clone();
  motion.update(3);
  assert.ok(
    yacht.quaternion.angleTo(pose) < 1e-6,
    'The same paused water time preserves the pose',
  );
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  for (const root of [scene, motion.ropes])
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).forEach((material) => materials.add(material));
    });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
});
