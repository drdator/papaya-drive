import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

export function createCascadedSun(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
) {
  const originalChunks = {
    lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin,
    lights_pars_begin: THREE.ShaderChunk.lights_pars_begin,
  };
  const csm = new CSM({
    camera,
    parent: scene,
    cascades: 2,
    maxFar: 160,
    mode: 'custom',
    customSplitsCallback: (_count, _near, far, breaks) => {
      breaks.push(32 / far, 1);
    },
    shadowMapSize: 4096,
    lightDirection: sun.target.position.clone().sub(sun.position).normalize(),
    lightIntensity: sun.intensity,
    lightNear: 1,
    lightFar: 500,
    lightMargin: 90,
    shadowBias: -0.00007,
  });
  csm.fade = true;
  csm.lights.forEach((light, i) => {
    light.color.copy(sun.color);
    // The wider cascade needs a larger offset to avoid stripes on rock faces.
    light.shadow.bias = i === 0 ? -0.00007 : -0.00015;
    light.shadow.normalBias = i === 0 ? 0.015 : 0.06;
  });
  csm.updateFrustums();

  const hooks = new Map<
    THREE.Material,
    Pick<THREE.Material, 'onBeforeCompile' | 'customProgramCacheKey'>
  >();
  function forgetMaterial(event: { target: THREE.Material }) {
    hooks.delete(event.target);
    csm.shaders.delete(event.target);
    event.target.removeEventListener('dispose', forgetMaterial);
  }
  function setupMaterial(material: THREE.Material) {
    if (
      hooks.has(material) ||
      !(material instanceof THREE.MeshStandardMaterial)
    )
      return;
    const previousCompile = material.onBeforeCompile.bind(material);
    const previousCacheKey = material.customProgramCacheKey.bind(material);
    const previousKey = previousCacheKey();
    hooks.set(material, {
      onBeforeCompile: previousCompile,
      customProgramCacheKey: previousCacheKey,
    });
    csm.setupMaterial(material);
    const compileCascades = material.onBeforeCompile.bind(material);
    // CSM replaces this hook; chain it with terrain, water and baked GI shaders.
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile(shader, renderer);
      compileCascades(shader, renderer);
    };
    material.customProgramCacheKey = () => `${previousKey}-csm-2`;
    material.needsUpdate = true;
    material.addEventListener('dispose', forgetMaterial);
  }
  return {
    updateFrustums() {
      csm.updateFrustums();
    },
    update() {
      // Also catch materials created by crashes after the map has loaded.
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (Array.isArray(object.material))
          object.material.forEach(setupMaterial);
        else setupMaterial(object.material);
      });
      camera.updateMatrixWorld();
      csm.update();
    },
    dispose() {
      csm.dispose();
      for (const [material, original] of hooks) {
        Object.assign(material, original);
        material.removeEventListener('dispose', forgetMaterial);
      }
      hooks.clear();
      csm.remove();
      csm.lights.forEach((light) => light.shadow.dispose());
      Object.assign(THREE.ShaderChunk, originalChunks);
    },
  };
}
