import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createSunShadowTracking,
  sunShadowFragment,
} from '../app/sun-shadows.ts';

await test('shadow coordinates stay fixed within a texel and advance by whole texels', () => {
  const sun = new THREE.DirectionalLight();
  sun.position.set(-50, 84, 36);
  sun.shadow.mapSize.set(4096, 2048);
  Object.assign(sun.shadow.camera, {
    left: -76,
    right: 76,
    top: 76,
    bottom: -76,
    near: 1,
    far: 240,
  });
  const track = createSunShadowTracking(sun);
  sun.shadow.camera.updateProjectionMatrix();
  const offset = sun.position.clone();
  const rotation = new THREE.Matrix4().lookAt(
    offset,
    new THREE.Vector3(),
    sun.shadow.camera.up,
  );
  const point = new THREE.Vector3(8, 3, -12);
  function projected(target: THREE.Vector3) {
    track(target);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    sun.shadow.updateMatrices(sun);
    assert.ok(
      sun.position.clone().sub(sun.target.position).distanceTo(offset) < 1e-10,
    );
    return point.clone().applyMatrix4(sun.shadow.matrix);
  }
  const origin = projected(new THREE.Vector3());
  for (const axis of ['x', 'y'] as const) {
    const resolution = axis === 'x' ? 4096 : 2048;
    const step = new THREE.Vector3();
    step[axis] = 152 / resolution;
    step.applyMatrix4(rotation);
    const inside = projected(step.clone().multiplyScalar(0.49));
    assert.ok(Math.abs(inside.x - origin.x) < 1e-10);
    assert.ok(Math.abs(inside.y - origin.y) < 1e-10);
    for (const direction of [-1, 1]) {
      const outside = projected(step.clone().multiplyScalar(direction * 0.51));
      assert.ok(
        Math.abs(outside[axis] - origin[axis] + direction / resolution) < 1e-10,
      );
    }
  }
  const depth = projected(new THREE.Vector3(0, 0, 12).applyMatrix4(rotation));
  assert.ok(Math.abs(depth.x - origin.x) < 1e-10);
  assert.ok(Math.abs(depth.y - origin.y) < 1e-10);
});

await test('the PCF customization still matches the installed Three shader', () => {
  assert.notEqual(sunShadowFragment, THREE.ShaderChunk.shadowmap_pars_fragment);
  assert.ok(sunShadowFragment.includes('vogelDiskSample( 8, 9, phi )'));
  assert.ok(
    !sunShadowFragment.includes(
      'shadowCoord.xy + vogelDiskSample( 0, 5, phi )',
    ),
  );
  assert.ok(
    sunShadowFragment.includes('float radius = shadowRadius * texelSize.x;'),
  );
});
