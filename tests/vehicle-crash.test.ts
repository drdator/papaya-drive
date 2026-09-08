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

await test('hard front crashes sometimes open the hood on a hinge, and reset repairs it', async () => {
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
  const body = model.scene.getObjectByName('Body_1');
  assert.ok(body instanceof THREE.Mesh);
  const sourceIndex = Array.from(body.geometry.index.array);
  let chance = 1;
  const visual = createCrashVisuals(
    car,
    model.scene,
    scene,
    () => 0,
    () => chance,
  );
  const originalIndex = Array.from(body.geometry.index.array);
  try {
    visual.impact(frontImpact, new THREE.Vector3());
    assert.equal(
      car.getObjectByName('Popped_hood'),
      undefined,
      'Release is optional',
    );
    visual.reset();
    chance = 0.3;
    for (const impact of [
      { ...frontImpact, speed: 4, damage: 2 },
      { ...frontImpact, point: new THREE.Vector3(0, 0.8, -1.7) },
    ]) {
      visual.impact(impact, new THREE.Vector3());
      assert.equal(
        car.getObjectByName('Popped_hood'),
        undefined,
        'Nudges and rear hits keep the latch closed',
      );
      visual.reset();
    }
    visual.impact(frontImpact, new THREE.Vector3());
    const hood = car.getObjectByName('Popped_hood');
    assert.ok(hood instanceof THREE.Mesh);
    assert.equal(hood.parent, car, 'The hood stays attached to the moving car');
    assert.ok(hood.geometry.attributes.position.count > 6);
    hood.geometry.computeBoundingBox();
    const hoodSize = hood.geometry.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(
      hoodSize.x > 1.5 && hoodSize.z > 0.75 && hoodSize.y < 0.2,
      'The popped hood retains a broad, nearly flat shape after a hard hit',
    );
    assert.equal(
      body.geometry.index.count,
      originalIndex.length - hood.geometry.attributes.position.count,
      'The closed panel is removed',
    );
    const hinge = hood.position.clone();
    visual.update(1 / 120);
    visual.render(0);
    assert.equal(Math.abs(hood.rotation.x), 0);
    visual.render(1);
    assert.ok(hood.rotation.x < 0, 'The front edge swings upward');
    for (let i = 0; i < 360; i++) visual.update(1 / 120);
    visual.render(1);
    assert.ok(Math.abs(hood.rotation.x + 1.15) < 0.01, 'The hood settles open');
    assert.deepEqual(hood.position, hinge);
    const angle = hood.rotation.x;
    visual.update(0);
    visual.render(1);
    assert.equal(hood.rotation.x, angle, 'Pausing holds the hood still');
    visual.impact({ ...frontImpact, speed: 7, damage: 5 }, new THREE.Vector3());
    assert.equal(
      car.children.filter((child) => child.name === 'Popped_hood').length,
      1,
      'A mild follow-up hit leaves the popped hood attached',
    );
    chance = 1;
    visual.impact({ ...frontImpact, damage: 0 }, new THREE.Vector3());
    assert.equal(
      hood.parent,
      scene,
      'A hard follow-up hit always tears off an open hood, even when damage is already capped',
    );
    visual.reset();
    assert.equal(car.getObjectByName('Popped_hood'), undefined);
    assert.deepEqual(Array.from(body.geometry.index.array), originalIndex);
    chance = 0;
    visual.impact({ ...frontImpact, fatal: true }, new THREE.Vector3(0, 0, 20));
    const looseHood = scene.getObjectByName('Popped_hood');
    assert.ok(
      looseHood instanceof THREE.Mesh && looseHood.parent === scene,
      'A hard crash can tear the hood off completely',
    );
    const released = looseHood.position.clone();
    for (let i = 0; i < 600; i++) visual.update(1 / 120);
    visual.render(1);
    assert.ok(
      looseHood.position.distanceTo(released) > 1,
      'The hood carries crash momentum',
    );
    assert.ok(
      looseHood.position.y > 0 && looseHood.position.y < 0.4,
      'The loose hood falls to the ground',
    );
    visual.reset();
    assert.equal(
      scene.getObjectByName('Popped_hood'),
      undefined,
      'Reset removes the loose hood',
    );
    assert.deepEqual(Array.from(body.geometry.index.array), originalIndex);
    chance = 0.3;
    visual.impact(
      {
        ...frontImpact,
        fatal: true,
        radius: 0.28,
        point: new THREE.Vector3(0.7, 0.8, 1.7),
      },
      new THREE.Vector3(),
    );
    const cornerHood = car.getObjectByName('Popped_hood');
    assert.ok(cornerHood instanceof THREE.Mesh);
    cornerHood.geometry.computeBoundingBox();
    assert.ok(
      cornerHood.geometry.boundingBox!.getSize(new THREE.Vector3()).y < 0.2,
      'A corner hit leaves only mild twisting in the opened panel',
    );
  } finally {
    visual.dispose();
  }
  assert.equal(car.getObjectByName('Popped_hood'), undefined);
  assert.deepEqual(Array.from(body.geometry.index.array), sourceIndex);
});

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

await test('a pole makes a narrow dent, a corner hit spares the other side, and a broad hit spreads', async () => {
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
  const wheelPositions = wheels.map((wheel) => wheel.position.clone());
  const visual = createCrashVisuals(
    car,
    model.scene,
    scene,
    () => 0,
    () => 1,
  );
  const body = model.scene.getObjectByName('Body_1');
  assert.ok(body instanceof THREE.Mesh);
  const positions = body.geometry.getAttribute('position');
  const original = Float32Array.from(positions.array);
  function displacement(minX: number, maxX: number) {
    let maximum = 0,
      samples = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = original[i * 3],
        z = original[i * 3 + 2];
      if (x < minX || x > maxX || z < 1.6) continue;
      samples++;
      maximum = Math.max(maximum, z - positions.getZ(i));
    }
    assert.ok(samples > 0, 'The actual mesh has vertices in the dent region');
    return maximum;
  }
  try {
    visual.impact(
      { ...frontImpact, radius: 0.28, fatal: true },
      new THREE.Vector3(),
    );
    assert.ok(
      displacement(-0.15, 0.15) > 0.7,
      'A tree bites into the middle of the nose',
    );
    assert.equal(displacement(-0.85, -0.65), 0);
    assert.equal(displacement(0.65, 0.85), 0);
    wheels.forEach((wheel, i) =>
      assert.deepEqual(wheel.position, wheelPositions[i]),
    );
    visual.reset();
    visual.impact(
      {
        ...frontImpact,
        radius: 0.28,
        fatal: true,
        point: new THREE.Vector3(0.7, 0.8, 1.7),
      },
      new THREE.Vector3(),
    );
    assert.ok(displacement(0.6, 0.8) > 0.7);
    assert.equal(
      displacement(-0.85, -0.2),
      0,
      'The opposite half remains straight',
    );
    const hitWheel = wheels.find((wheel) => wheel.name === 'Wheel_FR')!;
    const otherWheel = wheels.find((wheel) => wheel.name === 'Wheel_FL')!;
    assert.ok(
      hitWheel.position.z < wheelPositions[wheels.indexOf(hitWheel)].z - 0.2,
    );
    assert.deepEqual(
      otherWheel.position,
      wheelPositions[wheels.indexOf(otherWheel)],
    );
    const lights: THREE.Mesh[] = [];
    model.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name.startsWith('Headlight'))
        lights.push(object);
    });
    assert.equal(
      lights.length,
      1,
      'Only the headlight on the struck corner detaches',
    );
    visual.reset();
    visual.impact(
      { ...frontImpact, radius: 1.4, fatal: true },
      new THREE.Vector3(),
    );
    assert.ok(displacement(-0.85, -0.65) > 0.6);
    assert.ok(displacement(0.65, 0.85) > 0.6);
    visual.reset();
    visual.impact(
      { ...frontImpact, radius: 0.28, damage: 1, fatal: true },
      new THREE.Vector3(),
    );
    assert.ok(
      displacement(-0.15, 0.15) < 0.03,
      'Crossing the wreck threshold adds no preset collapse',
    );
    const glancing = new THREE.Vector3(0.7, 0.8, 1.7);
    dentVertex(glancing, {
      ...frontImpact,
      damage: 15,
      point: glancing.clone(),
      normal: new THREE.Vector3(-0.95, 0, -0.31).normalize(),
    });
    assert.ok(
      0.7 - glancing.x > (1.7 - glancing.z) * 2,
      'Glancing contact pushes mostly sideways',
    );
  } finally {
    visual.dispose();
  }
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
  for (const part of originals)
    part.positions = Array.from(
      part.mesh.geometry.getAttribute('position').array,
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
  // A broad, severe frontal hit compresses both sides of the nose.
  visual.impact({ ...frontImpact, fatal: true }, new THREE.Vector3(0, 0, 20));
  const frontWheels = wheels.filter((wheel) =>
    wheel.name.startsWith('Wheel_F'),
  );
  assert.equal(frontWheels.filter((wheel) => wheel.parent === scene).length, 1);
  const attachedFrontWheel = frontWheels.find((wheel) => wheel.parent === car)!;
  assert.ok(
    attachedFrontWheel.position.z <
      wheelPositions.get(attachedFrontWheel)!.z - 0.2,
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
    (value, i) =>
      i % 3 === 2 && value > 1.8 && Math.abs(body.positions[i - 2]) < 0.2,
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
      wheelPositions.get(attachedFrontWheel)!.z - 0.2,
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
      (wheel) => wheel.position.z < wheelPositions.get(wheel)!.z - 0.2,
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
