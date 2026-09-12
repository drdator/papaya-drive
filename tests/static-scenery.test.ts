import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { batchStaticScenery } from '../app/static-scenery.ts';

await test('static batches preserve world triangles, normals, UVs and per-instance baked light', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  const meshes = [0, 1, 2].map((i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const count = mesh.geometry.getAttribute('position').count;
    const light = new Float32Array(count * 4).fill(0.2 + i * 0.3);
    mesh.geometry.setAttribute(
      'bakedIrradiance',
      new THREE.BufferAttribute(light, 4),
    );
    mesh.position.set(i * 3, i, 1);
    mesh.scale.set(1, 1.5, 0.7);
    mesh.rotation.y = i * 0.4;
    mesh.castShadow = mesh.receiveShadow = true;
    const parent = new THREE.Group();
    parent.position.set(2, 0, 1);
    parent.add(mesh);
    scene.add(parent);
    return mesh;
  });
  scene.updateMatrixWorld(true);
  const expected = meshes.map((mesh) =>
    mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
  );
  let disposed = 0;
  meshes.forEach((mesh) =>
    mesh.geometry.addEventListener('dispose', () => disposed++),
  );
  const batched = batchStaticScenery(scene, meshes);
  assert.equal(scene.children.length, 1);
  const batch = scene.children[0] as THREE.Mesh;
  assert.equal(batch.material, material);
  assert.equal(batch.castShadow, true);
  assert.equal(batch.receiveShadow, true);
  assert.equal(batch.matrixAutoUpdate, false);
  assert.equal(batch.matrixWorldAutoUpdate, false);
  let vertexOffset = 0,
    indexOffset = 0;
  for (const geometry of expected) {
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const result = batch.geometry.getAttribute(name);
      for (let i = 0; i < attribute.count; i++)
        for (let c = 0; c < attribute.itemSize; c++)
          assert.equal(
            result.getComponent(vertexOffset + i, c),
            attribute.getComponent(i, c),
            name,
          );
    }
    for (let i = 0; i < geometry.index!.count; i++)
      assert.equal(
        batch.geometry.index!.getX(indexOffset + i),
        geometry.index!.getX(i) + vertexOffset,
      );
    vertexOffset += geometry.getAttribute('position').count;
    indexOffset += geometry.index!.count;
  }
  batched.dispose();
  assert.equal(disposed, 3);
});

await test('batching preserves separate culling regions and excludes transparent or animated meshes', () => {
  const scene = new THREE.Scene();
  const opaque = new THREE.MeshStandardMaterial();
  const transparent = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.5,
  });
  const meshes = [0, 1, 64, 65].map((x) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), opaque);
    mesh.position.x = x;
    scene.add(mesh);
    return mesh;
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), transparent);
  const animated = new THREE.Mesh(new THREE.BoxGeometry(), opaque);
  animated.onBeforeRender = () => {};
  const car = new THREE.Mesh(new THREE.BoxGeometry(), opaque);
  scene.add(glass, animated, car);
  batchStaticScenery(scene, [...meshes, glass, animated]);
  assert.equal(scene.children.length, 5);
  assert.equal(glass.parent, scene);
  assert.equal(animated.parent, scene);
  assert.equal(car.parent, scene);
  assert.equal(glass.matrixAutoUpdate, true);
  assert.equal(animated.matrixAutoUpdate, true);
  assert.equal(car.matrixAutoUpdate, true);
});
