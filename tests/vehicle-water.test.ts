import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceVehicleWater,
  createVehicleWater,
} from '../app/vehicle-water.ts';
import { seaLevel } from '../app/terrain.ts';
import {
  tropicalHeight as terrainHeight,
  tropicalRoute,
} from '../app/tropical-map.ts';
const { route, routeHeading } = tropicalRoute;
await test('the full track stays dry and the island drops into deep water on every side', () => {
  for (let i = 0; i < 480; i++) {
    const p = route(i / 480);
    const heading = routeHeading(i / 480);
    for (const side of [-4.2, 0, 4.2]) {
      assert.ok(
        terrainHeight(
          p.x + Math.cos(heading) * side,
          p.z - Math.sin(heading) * side,
        ) >
          seaLevel + 0.3,
      );
    }
    const angle = (i / 480) * Math.PI * 2;
    assert.ok(
      terrainHeight(Math.cos(angle) * 120, Math.sin(angle) * 120) <
        seaLevel - 4,
    );
  }
});

await test('shallow water and brief splashes are recoverable, but a submerged intake stays flooded until reset', () => {
  const water = createVehicleWater();
  for (let i = 0; i < 600; i++)
    advanceVehicleWater(water, seaLevel - 0.4, 0, 0, 1 / 120);
  assert.equal(water.flooded, false);
  advanceVehicleWater(water, seaLevel - 1, 0, 0, 0.1);
  advanceVehicleWater(water, seaLevel + 1, 0, 0, 0.1);
  assert.equal(water.exposure, 0);
  assert.equal(water.flooded, false);
  // A nose-first entry can flood the front intake while the rear is still high.
  for (let i = 0; i < 30; i++)
    advanceVehicleWater(water, seaLevel - 0.4, 0.4, 0, 1 / 120);
  assert.equal(water.flooded, true);
  advanceVehicleWater(water, seaLevel + 3, 0, 0, 1);
  assert.equal(water.flooded, true);
  Object.assign(water, createVehicleWater());
  assert.equal(water.flooded, false);
});
