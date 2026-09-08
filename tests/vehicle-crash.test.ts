import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCrashVisuals, dentVertex } from '../app/vehicle-crash.ts';

const frontImpact = {
  point: new THREE.Vector3(0, 0.8, 1.7),
  normal: new THREE.Vector3(0, 0, -1),
  speed: 25,
  damage: 100,
};

await test('dents follow contact direction and leave the far end unchanged', () => {
  const front = new THREE.Vector3(0.3, 0.9, 1.8);
  const small = front.clone();
  dentVertex(small, { ...frontImpact, damage: 8 });
  dentVertex(front, frontImpact);
  assert.ok(front.z < small.z && small.z < 1.8);
  assert.ok(front.y > 0.9, 'The hood folds upward');
  const rear = new THREE.Vector3(0, 0.8, -1.7);
  dentVertex(rear, frontImpact);
  assert.deepEqual(rear.toArray(), [0, 0.8, -1.7]);
  const side = new THREE.Vector3(-0.85, 0.8, 0);
  dentVertex(side, {
    ...frontImpact,
    point: side.clone(),
    normal: new THREE.Vector3(1, 0, 0),
  });
  assert.ok(side.x > -0.85);
  assert.equal(side.z, 0);
});

await test('the actual car sheds nearby trim, debris falls, and reset restores the original model', async () => {
  const file = await readFile(
    new URL('../public/models/papaya-car.glb', import.meta.url),
  );
  const model = await new GLTFLoader().parseAsync(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    '',
  );
  const car = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(car);
  car.add(model.scene);
  const wheels: THREE.Object3D[] = [];
  model.scene.traverse((object) => {
    if (object.name.startsWith('Wheel_')) wheels.push(object);
  });
  wheels.forEach((wheel) => car.attach(wheel));
  const wheelPositions = new Map(
    wheels.map((wheel) => [wheel, wheel.position.clone()]),
  );
  const meshes: THREE.Mesh[] = [];
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  const originals = meshes.map((mesh) => ({
    mesh,
    parent: mesh.parent,
    geometry: mesh.geometry,
    positions: Array.from(mesh.geometry.getAttribute('position').array),
  }));
  let wheelChance = 0;
  const visual = createCrashVisuals(
    car,
    model.scene,
    scene,
    () => 0,
    () => wheelChance,
  );
  assert.ok(
    visual.impact(frontImpact, new THREE.Vector3(0, 0, 20)),
    'A major frontal hit breaks glass',
  );
  const frontBumper = meshes.find((mesh) => /front.*bumper/i.test(mesh.name))!;
  const rearBumper = meshes.find((mesh) => /rear.*bumper/i.test(mesh.name))!;
  assert.equal(frontBumper.parent, scene);
  assert.notEqual(rearBumper.parent, scene);
  assert.ok(
    meshes.some((mesh) =>
      mesh.children.some((child) => child instanceof THREE.LineSegments),
    ),
  );
  for (let i = 0; i < 600; i++) visual.update(1 / 120);
  visual.render(1);
  assert.ok(frontBumper.position.y >= 0 && frontBumper.position.y < 0.4);
  for (let i = 0; i < 20; i++) visual.impact(frontImpact, new THREE.Vector3());
  for (const { mesh, positions } of originals) {
    if (mesh.parent === scene) continue;
    const current = mesh.geometry.getAttribute('position');
    for (let i = 0; i < current.count; i++) {
      const offset = new THREE.Vector3()
        .fromBufferAttribute(current, i)
        .sub(new THREE.Vector3().fromArray(positions, i * 3));
      assert.ok(
        offset.length() <= 0.701,
        'Repeated crashes must not invert the body',
      );
    }
  }
  visual.reset();
  for (const { mesh, parent, positions } of originals) {
    assert.equal(mesh.parent, parent);
    assert.deepEqual(
      Array.from(mesh.geometry.getAttribute('position').array),
      positions,
    );
    assert.equal(mesh.children.length, 0);
  }
  assert.equal(
    scene.children.length,
    1,
    'Reset removes every loose part and shard',
  );
  // Even the final hit after accumulated damage should visibly collapse the nose.
  visual.impact(
    { ...frontImpact, damage: 1, fatal: true },
    new THREE.Vector3(0, 0, 20),
  );
  const frontWheels = wheels.filter((wheel) =>
    wheel.name.startsWith('Wheel_F'),
  );
  assert.equal(frontWheels.filter((wheel) => wheel.parent === scene).length, 1);
  const attachedFrontWheel = frontWheels.find((wheel) => wheel.parent === car)!;
  assert.ok(
    attachedFrontWheel.position.z <
      wheelPositions.get(attachedFrontWheel)!.z - 0.4,
    'The remaining front wheel moves back with the crushed nose',
  );
  for (const wheel of wheels.filter((wheel) =>
    wheel.name.startsWith('Wheel_R'),
  ))
    assert.deepEqual(wheel.position, wheelPositions.get(wheel));
  assert.ok(
    wheels
      .filter((wheel) => wheel.name.startsWith('Wheel_R'))
      .every((wheel) => wheel.parent === car),
  );
  const body = originals.find((part) => part.mesh.name === 'Body_1')!;
  const noseIndex = body.positions.findIndex(
    (value, i) => i % 3 === 2 && value > 1.8,
  );
  assert.ok(
    body.mesh.geometry
      .getAttribute('position')
      .getZ(Math.floor(noseIndex / 3)) <
      body.positions[noseIndex] - 0.8,
  );
  visual.update(1 / 120);
  visual.render(0.5);
  assert.ok(
    attachedFrontWheel.position.z <
      wheelPositions.get(attachedFrontWheel)!.z - 0.4,
    'Debris rendering preserves the attached wheel’s damaged mount',
  );
  visual.reset();
  for (const wheel of wheels)
    assert.deepEqual(wheel.position, wheelPositions.get(wheel));
  assert.ok(
    wheels.every((wheel) => wheel.parent === car),
    'Reset refits detached wheels',
  );
  assert.equal(scene.children.length, 1);
  assert.deepEqual(
    Array.from(body.mesh.geometry.getAttribute('position').array),
    body.positions,
  );
  wheelChance = 1;
  visual.impact({ ...frontImpact, fatal: true }, new THREE.Vector3(0, 0, 20));
  assert.ok(
    wheels.every((wheel) => wheel.parent === car),
    'Wheel release is optional',
  );
  assert.ok(
    frontWheels.every(
      (wheel) => wheel.position.z < wheelPositions.get(wheel)!.z - 0.4,
    ),
    'Both front wheels follow the crushed nose when neither detaches',
  );
  visual.reset();
  wheelChance = 0;
  visual.impact(
    {
      ...frontImpact,
      fatal: true,
      point: new THREE.Vector3(0, 0.8, -1.7),
      normal: new THREE.Vector3(0, 0, 1),
    },
    new THREE.Vector3(0, 0, -20),
  );
  assert.ok(
    wheels.every((wheel) => wheel.parent === car),
    'Rear impacts do not eject front wheels',
  );
  visual.dispose();
  for (const { mesh, geometry } of originals)
    assert.equal(mesh.geometry, geometry);
});
