import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createBeachCrabs } from '../app/beach-crabs.ts';
import { createTropicalScenery } from '../app/tropical-scenery.ts';
import {
  tropicalHeight,
  tropicalRoute,
  tropicalTerrain,
} from '../app/tropical-map.ts';
import { createTerrainGeometry, seaLevel } from '../app/terrain.ts';

async function load(name: string) {
  const bytes = await readFile(
    new URL(`../public/models/${name}.glb`, import.meta.url),
  );
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  gltf.scene.animations = gltf.animations;
  return gltf.scene;
}

await test('six independently animated crabs walk and pause on clear, dry beach paths', async () => {
  const [model, props, ...palms] = await Promise.all(
    [
      'crab',
      'props-palm-cove',
      'tree-palm-tall',
      'tree-palm-curved',
      'tree-palm-short',
    ].map(load),
  );
  const ground = new THREE.Mesh(
    createTerrainGeometry(tropicalHeight),
    new THREE.MeshBasicMaterial(),
  );
  const scenery = createTropicalScenery(palms);
  const obstacles = [...scenery.solids, ...props.children].map((object) =>
    new THREE.Box3().setFromObject(object).expandByScalar(0.5),
  );
  const motion = createBeachCrabs(model, ground.geometry);
  const crabs = motion.group.children;
  assert.equal(crabs.length, 6);
  const skins: THREE.SkinnedMesh[] = [];
  motion.group.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skins.push(object);
  });
  assert.equal(skins.length, 6);
  assert.equal(new Set(skins.map((skin) => skin.skeleton.bones[0])).size, 6);
  assert.equal(new Set(skins.map((skin) => skin.geometry)).size, 1);
  const previous = crabs.map((crab) => crab.position.clone());
  const travelled = crabs.map(() => 0),
    pauses = crabs.map(() => 0);
  for (let time = 0.5; time <= 150; time += 0.5) {
    motion.update(time);
    crabs.forEach((crab, i) => {
      const { x, z } = crab.position;
      assert.ok(tropicalHeight(x, z) > seaLevel + 0.85, 'Above the surf');
      assert.ok(tropicalTerrain.coastAt(x, z) > 0.45, 'On beach sand');
      assert.ok(
        tropicalRoute.distanceToRoad(x, z) > 6,
        'Outside the driving line',
      );
      assert.ok(
        !obstacles.some(
          (box) =>
            x >= box.min.x &&
            x <= box.max.x &&
            z >= box.min.z &&
            z <= box.max.z,
        ),
        'Clear of rocks and fishing props',
      );
      assert.ok(
        scenery.trunks.every(
          (trunk) => Math.hypot(x - trunk.x, z - trunk.z) > trunk.radius + 0.5,
        ),
      );
      const distance = previous[i].distanceTo(crab.position);
      assert.ok(distance < 0.24, 'No jumps at turnarounds');
      travelled[i] += distance;
      if (distance < 1e-8) pauses[i]++;
      previous[i].copy(crab.position);
    });
  }
  assert.ok(travelled.every((distance) => distance > 10));
  assert.ok(pauses.every((count) => count > 10));
  const ray = new THREE.Raycaster(
    new THREE.Vector3(),
    new THREE.Vector3(0, -1, 0),
  );
  for (const time of [150, 167, 193]) {
    motion.update(time);
    for (const crab of crabs) {
      ray.ray.origin.set(crab.position.x, 20, crab.position.z);
      const hit = ray.intersectObject(ground)[0];
      assert.ok(hit);
      assert.ok(
        Math.abs(crab.position.y - hit.point.y - 0.008) < 1e-5,
        'Follows the rendered terrain triangles',
      );
    }
  }
  motion.group.updateMatrixWorld(true);
  const pose = skins.map((skin) =>
    skin.skeleton.bones.map((bone) => bone.matrixWorld.toArray()),
  );
  motion.update(193);
  motion.group.updateMatrixWorld(true);
  assert.deepEqual(
    skins.map((skin) =>
      skin.skeleton.bones.map((bone) => bone.matrixWorld.toArray()),
    ),
    pose,
    'Frozen game time preserves the complete pose',
  );
  motion.dispose();
  const geometry = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  for (const root of [
    ground,
    model,
    props,
    scenery.group,
    motion.group,
    ...palms,
  ]) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      geometry.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    });
  }
  geometry.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
});

await test('crabs escape beyond their old patrols, avoid the real scenery, and dodge an approaching car', async () => {
  const [model, props, ...palms] = await Promise.all(
    [
      'crab',
      'props-palm-cove',
      'tree-palm-tall',
      'tree-palm-curved',
      'tree-palm-short',
    ].map(load),
  );
  const ground = createTerrainGeometry(tropicalHeight);
  const scenery = createTropicalScenery(palms);
  const obstacles = [
    ...[...scenery.solids, ...props.children].map((object) =>
      new THREE.Box3().setFromObject(object),
    ),
    ...scenery.trunks.map(
      (t) =>
        new THREE.Box3(
          new THREE.Vector3(t.x - t.radius, t.bottom, t.z - t.radius),
          new THREE.Vector3(t.x + t.radius, t.top, t.z + t.radius),
        ),
    ),
  ];
  const margin = obstacles.map((box) => box.clone().expandByScalar(0.5));
  const motions: ReturnType<typeof createBeachCrabs>[] = [];
  function spawn() {
    const motion = createBeachCrabs(model, ground, obstacles);
    motions.push(motion);
    return motion;
  }
  function clear(position: THREE.Vector3) {
    const { x, z } = position;
    assert.ok(tropicalHeight(x, z) > seaLevel + 0.8, 'Stays above the surf');
    assert.ok(
      tropicalRoute.distanceToRoad(x, z) > 4.9,
      'Keeps off the driving line',
    );
    assert.ok(
      !margin.some(
        (box) =>
          x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z,
      ),
      'Does not cut through scenery',
    );
  }
  for (let i = 0; i < 6; i++) {
    const motion = spawn(),
      crab = motion.group.children[i];
    const start = crab.position.clone();
    const car = start.clone().add(new THREE.Vector3(i % 2 ? -2 : 2, 0, 0));
    let safe = false,
      stopped = 0;
    for (let frame = 1; frame <= 240; frame++) {
      const before = crab.position.clone();
      motion.update(frame / 30, car);
      clear(crab.position);
      const moved = crab.position.distanceTo(before);
      assert.ok(moved < 0.22, 'Moves continuously');
      if (crab.position.distanceTo(car) >= 10) {
        safe = true;
        break;
      }
      stopped = moved < 0.01 ? stopped + 1 : 0;
      assert.ok(stopped < 15, `Crab ${i + 1} must not freeze while threatened`);
    }
    assert.ok(safe, `Crab ${i + 1} reaches a safe distance`);
    assert.ok(
      crab.position.distanceTo(start) > 6,
      'Leaves the original short patrol',
    );
    const escaped = crab.position.clone();
    motion.update(9);
    assert.ok(
      crab.position.distanceTo(escaped) < 0.01,
      'Does not snap home when the threat disappears',
    );
    for (let frame = 271; frame <= 600; frame++) {
      motion.update(frame / 30);
      clear(crab.position);
    }
    assert.ok(
      crab.position.distanceTo(escaped) > 0.1,
      'Resumes wandering at the refuge',
    );
    const paused = crab.position.clone();
    motion.update(20, crab.position.clone());
    assert.deepEqual(crab.position, paused, 'Pausing freezes fleeing too');
  }
  // A car aimed straight at a crab at 65 km/h should trigger a lateral dodge
  // before it enters the ordinary proximity radius.
  for (let index = 0; index < 6; index++)
    for (const velocity of [
      { x: 18, z: 0 },
      { x: -18, z: 0 },
      { x: 0, z: 18 },
      { x: 0, z: -18 },
    ]) {
      const motion = spawn(),
        crab = motion.group.children[index];
      const start = crab.position.clone();
      let closest = Infinity;
      for (let frame = 1; frame <= 90; frame++) {
        const time = frame / 60;
        const car = start
          .clone()
          .add(
            new THREE.Vector3(
              velocity.x * (time - 1),
              0,
              velocity.z * (time - 1),
            ),
          );
        motion.update(time, car, velocity);
        closest = Math.min(
          closest,
          Math.hypot(crab.position.x - car.x, crab.position.z - car.z),
        );
        clear(crab.position);
        if (frame === 20)
          assert.ok(
            crab.position.distanceTo(start) > 0.6,
            'Reacts before the car is close',
          );
      }
      assert.ok(
        closest > 1.8,
        `Crab ${index + 1} dodges ${JSON.stringify(velocity)}; closest distance ${closest}`,
      );
    }
  const pursuit = spawn(),
    pursued = pursuit.group.children[0];
  const chaseStart = pursued.position.clone();
  const chasingCar = chaseStart.clone().add(new THREE.Vector3(3, 0, 0));
  let frozenFrames = 0;
  for (let frame = 1; frame <= 600; frame++) {
    const direction = pursued.position
      .clone()
      .sub(chasingCar)
      .setY(0)
      .normalize();
    const velocity = { x: direction.x * 2.7, z: direction.z * 2.7 };
    chasingCar.x += velocity.x / 30;
    chasingCar.z += velocity.z / 30;
    chasingCar.y = tropicalHeight(chasingCar.x, chasingCar.z);
    const before = pursued.position.clone();
    pursuit.update(frame / 30, chasingCar, velocity);
    clear(pursued.position);
    const distance = pursued.position.distanceTo(chasingCar);
    assert.ok(
      distance > 1.8,
      `Keeps clear of a pursuing car: frame ${frame}, distance ${distance}`,
    );
    frozenFrames =
      distance < 6 && before.distanceTo(pursued.position) < 0.01
        ? frozenFrames + 1
        : 0;
    assert.ok(frozenFrames < 15, 'Does not freeze during continued pursuit');
  }
  assert.ok(
    pursued.position.distanceTo(chaseStart) > 10,
    'Can keep fleeing beyond the first refuge',
  );
  const geometry = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  for (const motion of motions) motion.dispose();
  for (const root of [
    model,
    props,
    scenery.group,
    ...palms,
    ...motions.map((motion) => motion.group),
  ])
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      geometry.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(material);
    });
  geometry.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  ground.dispose();
});
