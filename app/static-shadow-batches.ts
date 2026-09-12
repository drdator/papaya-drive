import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Reserved for shadow-only geometry; the game's visible scene uses layer 0.
const shadowLayer = 31;

export function createStaticShadowBatches(
  scene: THREE.Scene,
  shadowMap: Pick<THREE.WebGLShadowMap, 'render'>,
  meshes: THREE.Mesh[],
) {
  scene.updateMatrixWorld(true);
  const inverse = scene.matrixWorld.clone().invert();
  const transform = new THREE.Matrix4();
  const center = new THREE.Vector3();
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const mesh of meshes) {
    const material = mesh.material;
    if (
      !(material instanceof THREE.MeshStandardMaterial) ||
      !mesh.castShadow ||
      mesh.matrixAutoUpdate ||
      mesh.matrixWorldAutoUpdate ||
      mesh.layers.mask !== 1 ||
      mesh instanceof THREE.SkinnedMesh ||
      mesh instanceof THREE.InstancedMesh ||
      mesh.morphTargetInfluences ||
      mesh.customDepthMaterial ||
      mesh.customDistanceMaterial ||
      mesh.onBeforeShadow !== THREE.Object3D.prototype.onBeforeShadow ||
      mesh.onAfterShadow !== THREE.Object3D.prototype.onAfterShadow ||
      mesh.geometry.drawRange.start !== 0 ||
      mesh.geometry.drawRange.count !== Infinity ||
      material.transparent ||
      material.opacity !== 1 ||
      material.alphaTest ||
      material.alphaHash ||
      material.alphaToCoverage ||
      material.displacementMap ||
      material.clippingPlanes ||
      material.wireframe ||
      !material.visible
    )
      continue;
    let visible = true;
    for (
      let parent: THREE.Object3D | null = mesh;
      parent;
      parent = parent.parent
    )
      visible &&= parent.visible;
    if (!visible || mesh.matrixWorld.determinant() <= 0) continue;
    const position = mesh.geometry.getAttribute('position');
    if (
      !(position instanceof THREE.BufferAttribute) ||
      !(position.array instanceof Float32Array)
    )
      continue;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.boundingBox!.getCenter(center).applyMatrix4(mesh.matrixWorld);
    const key = [
      Math.floor(center.x / 32),
      Math.floor(center.z / 32),
      material.side,
      material.shadowSide,
      mesh.frustumCulled,
      Boolean(mesh.geometry.index),
    ].join('|');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(mesh);
    else buckets.set(key, [mesh]);
  }

  const sources: THREE.Mesh[] = [];
  const batches: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] =
    [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    // Opaque shadow depth needs positions, not visible colors, normals or GI.
    const parts = bucket.map((mesh) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        mesh.geometry.getAttribute('position').clone(),
      );
      if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
      geometry.applyMatrix4(
        transform.multiplyMatrices(inverse, mesh.matrixWorld),
      );
      return geometry;
    });
    const geometry = mergeGeometries(parts);
    parts.forEach((part) => part.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const source = bucket[0];
    // All bucket members passed the single-material eligibility check above.
    const material = source.material as THREE.MeshStandardMaterial;
    const batch = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        side: material.side,
        shadowSide: material.shadowSide,
      }),
    );
    batch.name = 'Static shadow batch';
    batch.layers.set(shadowLayer);
    batch.castShadow = true;
    batch.frustumCulled = source.frustumCulled;
    scene.add(batch);
    batch.updateMatrixWorld(true);
    batch.matrixAutoUpdate = batch.matrixWorldAutoUpdate = false;
    batches.push(batch);
    sources.push(...bucket);
  }

  let enabled = true;
  sources.forEach((mesh) => {
    mesh.castShadow = false;
  });
  // The render list excludes these batches. Admit them only inside the shadow
  // pass, which Three culls using the viewing camera's layers as well.
  const originalRender = shadowMap.render.bind(shadowMap);
  shadowMap.render = (lights, scene, camera) => {
    const mask = camera.layers.mask;
    if (enabled && camera.layers.isEnabled(0))
      camera.layers.enable(shadowLayer);
    try {
      originalRender(lights, scene, camera);
    } finally {
      camera.layers.mask = mask;
    }
  };

  return {
    setEnabled(active: boolean) {
      enabled = active;
      sources.forEach((mesh) => {
        mesh.castShadow = !active;
      });
      batches.forEach((mesh) => {
        mesh.visible = active;
      });
    },
    dispose() {
      shadowMap.render = originalRender;
      sources.forEach((mesh) => {
        mesh.castShadow = true;
      });
      for (const batch of batches) {
        batch.removeFromParent();
        batch.geometry.dispose();
        batch.material.dispose();
      }
    },
  };
}
