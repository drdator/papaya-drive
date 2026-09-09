import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createVehiclePhysics,
  initializeVehiclePhysics,
} from '../app/vehicle-physics.ts';
import { createTerrainGeometry } from '../app/terrain.ts';
import { tropicalHeight } from '../app/tropical-map.ts';

await initializeVehiclePhysics();
const asset = await readFile(
  new URL('../public/models/props-palm-cove.glb', import.meta.url),
);
const { scene } = await new GLTFLoader().parseAsync(
  asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength),
  '',
);
const models = scene.children.filter((object) =>
  object.name.startsWith('Landing_crate_'),
);
const barrel = scene.children.find(
  (object) => object.name === 'Landing_barrel',
);
assert.ok(barrel);
const props = [
  { name: 'crate', model: models[0], shape: 'cuboid' as const },
  { name: 'barrel', model: barrel, shape: 'convex' as const },
];
const idle = { gas: false, reverse: false, brake: false, turn: 0 };
const dt = 1 / 120;

for (const prop of props) {
  await test(`a car strike pushes and tumbles an authored ${prop.name} without treating it as a wall`, () => {
    const ground = new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2);
    const physics = createVehiclePhysics(ground, () => 0);
    try {
      const model = prop.model.clone(true);
      model.position.set(1.1, 0.62, 7);
      model.quaternion.identity();
      const crate = physics.addFloatingProp(model, () => undefined, prop.shape);
      physics.reset(0, 0, 0);
      for (let i = 0; i < 120; i++) physics.step(idle, dt);
      physics.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
      let rotation = 0,
        impact = 0;
      for (let i = 0; i < 180; i++) {
        const state = physics.step(idle, dt);
        rotation = Math.max(
          rotation,
          new THREE.Quaternion()
            .copy(crate.body.rotation())
            .angleTo(new THREE.Quaternion()),
        );
        impact = Math.max(impact, state.impact.speed);
      }
      assert.ok(
        crate.body.translation().z > 10,
        'The car knocks the crate away',
      );
      assert.ok(rotation > 0.3, 'The crate tumbles instead of only sliding');
      assert.ok(
        impact < 3,
        'A lightweight crate does not cause wall-sized car damage',
      );
    } finally {
      physics.dispose();
      ground.dispose();
    }
  });

  await test(`a tipped ${prop.name} resurfaces and keeps floating with waves while the car is in flight`, () => {
    const ground = new THREE.PlaneGeometry(200, 200)
      .rotateX(-Math.PI / 2)
      .translate(0, -8, 0);
    const physics = createVehiclePhysics(ground, () => -8);
    try {
      const model = prop.model.clone(true);
      model.position.set(0, 2, 0);
      model.rotation.set(0.7, 0.3, 0.4);
      let time = 0;
      const surface = () => 0.2 * Math.sin(time * 0.9);
      const crate = physics.addFloatingProp(model, surface, prop.shape);
      crate.body.setLinvel({ x: 1, y: -5, z: 0 }, true);
      physics.body.setEnabled(false);
      let lowest = Infinity,
        highest = -Infinity;
      for (let i = 0; i < 2400; i++) {
        time += dt;
        physics.stepScenery(dt);
        if (i < 1200) continue;
        const y = crate.body.translation().y;
        assert.ok(
          Math.abs(y - surface()) < 0.8,
          'The crate stays near the waterline rather than sinking',
        );
        lowest = Math.min(lowest, y);
        highest = Math.max(highest, y);
      }
      assert.ok(highest - lowest > 0.15, 'The crate follows the moving water');
      assert.ok(
        Math.abs(crate.body.linvel().y) < 1,
        'The float settles without launching',
      );
      physics.renderFloatingProps(1);
      assert.ok(
        model.position.distanceTo(
          new THREE.Vector3().copy(crate.body.translation()),
        ) < 1e-5,
      );
    } finally {
      physics.dispose();
      ground.dispose();
    }
  });
}

for (const prop of props) {
  await test(`a car impact frees the upright resting ${prop.name}`, () => {
    const ground = new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2);
    const physics = createVehiclePhysics(ground, () => 0);
    try {
      const model = prop.model.clone(true);
      model.position.set(1.1, 0.65, 7);
      model.quaternion.identity();
      const supply = physics.addFloatingProp(
        model,
        () => undefined,
        prop.shape,
      );
      physics.settleFloatingProps();
      physics.reset(0, 0, 0);
      for (let i = 0; i < 120; i++) physics.step(idle, dt);
      assert.ok(Math.abs(supply.body.translation().z - 7) < 0.01);
      physics.body.setLinvel({ x: 0, y: 0, z: 12 }, true);
      for (let i = 0; i < 180; i++) physics.step(idle, dt);
      assert.ok(
        supply.body.translation().z > 10,
        'The car knocks the resting supply free',
      );
    } finally {
      physics.dispose();
      ground.dispose();
    }
  });
}

await test('the landing props settle in place and return on reset', () => {
  assert.equal(models.length, 3);
  const ground = createTerrainGeometry(tropicalHeight);
  const physics = createVehiclePhysics(ground, tropicalHeight);
  try {
    const objects = [...models, barrel].map((model) => model.clone(true));
    const crates = objects.map((model) =>
      physics.addFloatingProp(
        model,
        () => undefined,
        model.name === 'Landing_barrel' ? 'convex' : 'cuboid',
      ),
    );
    physics.settleFloatingProps();
    const original = crates.map((crate) =>
      new THREE.Vector3().copy(crate.body.translation()),
    );
    assert.ok(
      original[2].y > original[0].y + 0.7,
      'The small crate stays stacked above the large one',
    );
    assert.ok(
      Math.hypot(original[2].x - original[0].x, original[2].z - original[0].z) <
        0.9,
    );
    const assertUpright = () =>
      crates.forEach((crate) => {
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
          new THREE.Quaternion().copy(crate.body.rotation()),
        );
        assert.ok(up.y > 0.9999, 'Supplies stand upright on the level sand');
      });
    assertUpright();
    for (const i of [0, 1, 3]) {
      assert.ok(
        Math.abs(
          original[i].y -
            crates[i].halfSize.y -
            tropicalHeight(original[i].x, original[i].z),
        ) < 0.03,
        'The supplies rest against the sand without buried colliders',
      );
    }
    physics.body.setEnabled(false);
    for (let i = 0; i < 600; i++) physics.stepScenery(dt);
    assertUpright();
    crates.forEach((crate, i) =>
      assert.ok(
        new THREE.Vector3()
          .copy(crate.body.translation())
          .distanceTo(original[i]) < 0.35,
        'The initial stack settles in place',
      ),
    );
    crates[0].body.setLinvel({ x: 8, y: 3, z: 0 }, true);
    for (let i = 0; i < 120; i++) physics.stepScenery(dt);
    assert.ok(
      new THREE.Vector3()
        .copy(crates[0].body.translation())
        .distanceTo(original[0]) > 0.5,
      'The resting crate still moves when disturbed',
    );
    physics.reset(0, 0, 0);
    assertUpright();
    objects.forEach((object, i) =>
      assert.ok(
        object.position.distanceTo(original[i]) < 0.02,
        'Reset immediately restores the visible stack',
      ),
    );
    crates.forEach((crate, i) =>
      assert.ok(
        new THREE.Vector3()
          .copy(crate.body.translation())
          .distanceTo(original[i]) < 0.02,
      ),
    );
  } finally {
    physics.dispose();
    ground.dispose();
  }
});

await test('slow bumps move the landing supplies without launching them', () => {
  for (const targetIndex of [0, 3]) {
    for (const speed of [1.5, 3]) {
      const ground = createTerrainGeometry(tropicalHeight);
      const physics = createVehiclePhysics(ground, tropicalHeight);
      try {
        const supplies = [...models, barrel].map((source) =>
          physics.addFloatingProp(
            source.clone(true),
            () => undefined,
            source.name === 'Landing_barrel' ? 'convex' : 'cuboid',
          ),
        );
        physics.settleFloatingProps();
        const start = new THREE.Vector3().copy(
          supplies[targetIndex].body.translation(),
        );
        const direction = targetIndex === 0 ? 1 : -1;
        physics.reset(
          start.x - direction * 2.45,
          start.z,
          (direction * Math.PI) / 2,
        );
        for (let i = 0; i < 120; i++)
          physics.step({ ...idle, brake: true }, dt);
        physics.body.setLinvel({ x: direction * speed, y: 0, z: 0 }, true);
        let fastest = 0,
          upward = 0;
        let contacted = false;
        for (let i = 0; i < 360; i++) {
          // Hold a known approach speed until contact, including on the beach slope.
          if (!contacted)
            physics.body.setLinvel(
              {
                x: direction * speed,
                y: physics.body.linvel().y,
                z: 0,
              },
              true,
            );
          physics.step(idle, dt);
          contacted ||=
            new THREE.Vector3()
              .copy(supplies[targetIndex].body.translation())
              .distanceTo(start) > 0.005;
          for (const supply of supplies) {
            const velocity = supply.body.linvel();
            fastest = Math.max(
              fastest,
              Math.hypot(velocity.x, velocity.y, velocity.z),
            );
            upward = Math.max(upward, velocity.y);
          }
        }
        const moved = new THREE.Vector3()
          .copy(supplies[targetIndex].body.translation())
          .distanceTo(start);
        assert.ok(moved > 0.15, 'A gentle car bump moves the supply');
        assert.ok(
          fastest < speed * 2 + 1,
          'A bump does not create excessive speed',
        );
        assert.ok(upward < 1.5, 'Ground contacts do not catapult the supplies');
      } finally {
        physics.dispose();
        ground.dispose();
      }
    }
  }
});

await test('the exported crates have visible wooden undersides', () => {
  for (const source of models) {
    const model = source.clone(true);
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    for (const x of [-0.5, 0, 0.5]) {
      for (const z of [-0.5, 0, 0.5]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(
            center.x + x * half.x,
            bounds.min.y - 1,
            center.z + z * half.z,
          ),
          new THREE.Vector3(0, 1, 0),
        );
        const [hit] = ray.intersectObject(model, true);
        assert.ok(
          hit && hit.point.y < bounds.min.y + 0.1,
          'Bottom boards cover the crate underside with outward-facing surfaces',
        );
      }
    }
  }
});
