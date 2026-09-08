import type { Collider } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// Colliders are authored in world coordinates. Move them by the rigid change
// from that original pose, keeping animated boats aligned with their surfaces.
export function createColliderMotion(mesh: THREE.Mesh, collider: Collider) {
  const originalInverse = mesh.matrixWorld.clone().invert();
  const change = new THREE.Matrix4();
  const position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  return () => {
    mesh.updateWorldMatrix(true, false);
    change
      .multiplyMatrices(mesh.matrixWorld, originalInverse)
      .decompose(position, rotation, scale);
    collider.setTranslation(position);
    collider.setRotation(rotation);
  };
}
