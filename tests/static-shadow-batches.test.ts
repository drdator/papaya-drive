import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createStaticShadowBatches } from '../app/static-shadow-batches.ts';

function fixedMesh(scene: THREE.Scene, color: string, x: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.position.set(x, 2, 3);
  mesh.rotation.y = x * 0.2;
  mesh.scale.set(1, 2, 1);
  mesh.castShadow = true;
  scene.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
  return mesh;
}

await test('shadow batches preserve world triangles and leave visible materials and geometry intact', () => {
  const scene = new THREE.Scene();
  const meshes = [fixedMesh(scene, 'red', 1), fixedMesh(scene, 'blue', 4)];
  const original = meshes.map((mesh) => ({
    material: mesh.material,
    geometry: mesh.geometry,
    world: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
  }));
  const shadowMap = { render() {} };
  const batching = createStaticShadowBatches(scene, shadowMap, meshes);
  const batches = scene.children.filter(
    (mesh) => mesh.name === 'Static shadow batch',
  );
  assert.equal(batches.length, 1);
  const batch = batches[0] as THREE.Mesh;
  assert.deepEqual(Object.keys(batch.geometry.attributes), ['position']);
  assert.equal(batch.layers.test(new THREE.Camera().layers), false);
  assert.equal(batch.castShadow, true);
  let offset = 0;
  for (const [index, mesh] of meshes.entries()) {
    assert.equal(mesh.material, original[index].material);
    assert.equal(mesh.geometry, original[index].geometry);
    assert.equal(mesh.castShadow, false);
    const source = original[index].world.getAttribute('position');
    const result = batch.geometry.getAttribute('position');
    for (let i = 0; i < source.count; i++) {
      for (let component = 0; component < 3; component++) {
        assert.equal(
          result.getComponent(offset + i, component),
          source.getComponent(i, component),
        );
      }
    }
    offset += source.count;
  }
  let disposed = 0;
  batch.geometry.addEventListener('dispose', () => disposed++);
  batching.setEnabled(false);
  assert.ok(meshes.every((mesh) => mesh.castShadow));
  assert.equal(batch.visible, false);
  batching.setEnabled(true);
  assert.ok(meshes.every((mesh) => !mesh.castShadow));
  batching.dispose();
  assert.equal(disposed, 1);
  assert.equal(batch.parent, null);
  assert.ok(meshes.every((mesh) => mesh.castShadow));
});

await test('shadow-only layers are admitted only during shadow rendering, including failure cleanup', () => {
  const scene = new THREE.Scene();
  const meshes = [fixedMesh(scene, 'red', 1), fixedMesh(scene, 'blue', 4)];
  const camera = new THREE.PerspectiveCamera();
  const masks: number[] = [];
  let fail = false;
  const shadowMap = {
    render(_lights: THREE.Light[], _scene: THREE.Scene, camera: THREE.Camera) {
      masks.push(camera.layers.mask);
      if (fail) throw new Error('Render failure');
    },
  };
  const batching = createStaticShadowBatches(scene, shadowMap, meshes);
  shadowMap.render([], scene, camera);
  assert.equal(masks[0], 1 | (1 << 31));
  assert.equal(camera.layers.mask, 1);
  fail = true;
  assert.throws(() => shadowMap.render([], scene, camera), /Render failure/);
  assert.equal(camera.layers.mask, 1);
  fail = false;
  camera.layers.set(2);
  shadowMap.render([], scene, camera);
  assert.equal(masks.at(-1), 4);
  batching.dispose();
  camera.layers.set(0);
  shadowMap.render([], scene, camera);
  assert.equal(masks.at(-1), 1);
});

await test('moving, alpha-tested, custom and separate-sided casters retain their original shadow paths', () => {
  const scene = new THREE.Scene();
  const meshes = Array.from({ length: 7 }, (_, i) =>
    fixedMesh(scene, 'green', i),
  );
  meshes[0].matrixAutoUpdate = true;
  meshes[1].material.alphaTest = 0.5;
  meshes[2].customDepthMaterial = new THREE.MeshDepthMaterial();
  meshes[3].material.side = THREE.DoubleSide;
  meshes[4].onBeforeShadow = () => {};
  // Only these two compatible, opaque, fixed meshes can share a shadow draw.
  const batching = createStaticShadowBatches(scene, { render() {} }, meshes);
  assert.ok(meshes.slice(0, 5).every((mesh) => mesh.castShadow));
  assert.ok(meshes.slice(5).every((mesh) => !mesh.castShadow));
  batching.dispose();
});
