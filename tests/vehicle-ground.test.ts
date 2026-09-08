import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  route,
  routeLength,
  terrainHeight,
  distanceToRoad,
} from '../app/terrain.ts';

await test('the winding route closes smoothly and its checkpoints follow the hills', () => {
  assert.ok(route(0).distanceTo(route(1)) < 1e-9);
  assert.ok(routeLength > 300);
  const heights = [];
  for (let i = 0; i < 8; i++) {
    const point = route(i / 8);
    assert.equal(point.y, terrainHeight(point.x, point.z));
    assert.ok(distanceToRoad(point.x, point.z) < 0.02);
    heights.push(point.y);
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 3);
});
