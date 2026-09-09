import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createTerrainGeometry,
  terrainHeight,
  ridgeBaseHeight,
  ridgeDrivingHeight,
} from '../app/terrain.ts';
import {
  bridgePoint,
  bridgeCoordinates,
  bridgeHeight,
  riverCenter,
  riverLevel,
  createRidgeRiver,
} from '../app/ridge-river.ts';
import {
  createVehiclePhysics,
  initializeVehiclePhysics,
} from '../app/vehicle-physics.ts';
import {
  advanceVehicleWater,
  createVehicleWater,
} from '../app/vehicle-water.ts';

await initializeVehiclePhysics();
await test('the river has a carved bed, and the timber bridge carries the car across in both directions', () => {
  const ground = createTerrainGeometry();
  const river = createRidgeRiver(
    ridgeBaseHeight,
    terrainHeight,
    new THREE.Uniform(0),
  );
  const car = createVehiclePhysics(ground, ridgeDrivingHeight);
  try {
    river.solids.updateMatrixWorld(true);
    river.solids.traverse((object) => {
      if (object instanceof THREE.Mesh) car.addSolid(object);
    });
    for (let z = 0; z < 67; z += 3)
      assert.ok(terrainHeight(riverCenter(z), z) < riverLevel(z) - 0.6);
    assert.ok(bridgeHeight(0, ridgeBaseHeight) > riverLevel(29) + 1.5);
    for (const direction of [1, -1]) {
      const start = bridgePoint(-15 * direction, 0);
      car.reset(
        start.x,
        start.z,
        Math.PI / 2 + 0.14 + (direction < 0 ? Math.PI : 0),
      );
      const water = createVehicleWater();
      let crossed = false;
      for (let i = 0; i < 600; i++) {
        const state = car.step(
          { gas: true, reverse: false, brake: false, turn: 0 },
          1 / 120,
        );
        const { along, across } = bridgeCoordinates(
          state.position.x,
          state.position.z,
        );
        if (Math.abs(along) < 9) {
          assert.ok(Math.abs(across) < 2, 'The car stays on the bridge');
          assert.ok(
            state.position.y > bridgeHeight(along, ridgeBaseHeight) - 0.2,
            'The wheels stay above the deck',
          );
          advanceVehicleWater(
            water,
            state.position.y,
            state.pitch,
            state.bank,
            1 / 120,
            riverLevel(state.position.z),
          );
          assert.equal(water.flooded, false);
        }
        assert.ok(
          state.impact.speed < 4,
          'There is no hard collision at the bridge landings',
        );
        if (along * direction > 14) {
          crossed = true;
          break;
        }
      }
      assert.ok(crossed, 'The car drives all the way over the bridge');
    }
  } finally {
    car.dispose();
    ground.dispose();
  }
});
