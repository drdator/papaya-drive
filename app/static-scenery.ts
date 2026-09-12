import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Call only for fixed scenery, after collision geometry and baked lighting exist.
// Keep nearby meshes together so camera and shadow frusta can still cull them.
export function batchStaticScenery(scene: THREE.Scene, meshes: THREE.Mesh[]) {
  scene.updateMatrixWorld(true);
  const sceneInverse = scene.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  const originalGeometries = new Set<THREE.BufferGeometry>();
  const fixedMeshes = new Set<THREE.Mesh>();
  const center = new THREE.Vector3();
  for (const mesh of meshes) {
    const material = mesh.material;
    if (
      !(material instanceof THREE.MeshStandardMaterial) ||
      material.transparent ||
      material.opacity !== 1 ||
      mesh instanceof THREE.SkinnedMesh ||
      mesh instanceof THREE.InstancedMesh ||
      mesh.children.length ||
      mesh.morphTargetInfluences ||
      mesh.customDepthMaterial ||
      mesh.customDistanceMaterial ||
      mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      mesh.geometry.drawRange.start !== 0 ||
      mesh.geometry.drawRange.count !== Infinity ||
      mesh.matrixWorld.determinant() <= 0
    )
      continue;
    let visible = true;
    for (
      let parent: THREE.Object3D | null = mesh;
      parent;
      parent = parent.parent
    )
      visible &&= parent.visible;
    if (!visible) continue;
    mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
    fixedMeshes.add(mesh);
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();
    geometry.boundingBox!.getCenter(center).applyMatrix4(mesh.matrixWorld);
    const attributes = Object.entries(geometry.attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, attribute]) =>
          `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}:${'gpuType' in attribute ? attribute.gpuType : undefined}`,
      )
      .join(',');
    const key = [
      material.uuid,
      Math.floor(center.x / 32),
      Math.floor(center.z / 32),
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.renderOrder,
      mesh.layers.mask,
      mesh.frustumCulled,
      Boolean(geometry.index),
      attributes,
    ].join('|');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(mesh);
    else buckets.set(key, [mesh]);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const geometries = bucket.map((mesh) => {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(sceneInverse.clone().multiply(mesh.matrixWorld));
      geometry.clearGroups();
      return geometry;
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const source = bucket[0];
    const batch = new THREE.Mesh(geometry, source.material);
    batch.name = 'Static scenery batch';
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.layers.mask = source.layers.mask;
    batch.frustumCulled = source.frustumCulled;
    scene.add(batch);
    batch.updateMatrixWorld(true);
    batch.matrixAutoUpdate = batch.matrixWorldAutoUpdate = false;
    fixedMeshes.add(batch);
    for (const mesh of bucket) {
      fixedMeshes.delete(mesh);
      originalGeometries.add(mesh.geometry);
      let parent = mesh.parent;
      mesh.removeFromParent();
      // Empty model containers no longer need a place in the render tree.
      while (
        parent &&
        parent !== scene &&
        !parent.children.length &&
        !(parent instanceof THREE.Mesh)
      ) {
        const next = parent.parent;
        parent.removeFromParent();
        parent = next;
      }
    }
  }
  return {
    meshes: [...fixedMeshes],
    dispose() {
      originalGeometries.forEach((geometry) => geometry.dispose());
    },
  };
}
