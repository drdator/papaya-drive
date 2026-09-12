import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';

export function createCascadedSun(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  { compactBuffers = false, farShadowMapSize = 4096 } = {},
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
    if (i === 1) light.shadow.mapSize.setScalar(farShadowMapSize);
    if (compactBuffers) {
      // PCF samples the depth texture. Three still requires a color attachment;
      // one byte per pixel suffices for that unused buffer instead of four.
      const { x: width, y: height } = light.shadow.mapSize;
      const depth = new THREE.DepthTexture(
        width,
        height,
        THREE.UnsignedIntType,
      );
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = depth.magFilter = THREE.LinearFilter;
      depth.name = 'Sun shadow depth';
      light.shadow.map = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RedFormat,
        depthTexture: depth,
      });
    }
  });
  csm.updateFrustums();
  const lightRotation = new THREE.Matrix4().lookAt(
    new THREE.Vector3(),
    csm.lightDirection,
    new THREE.Vector3(0, 1, 0),
  );
  const inverseLightRotation = lightRotation.clone().invert();
  const shadowCenter = new THREE.Vector3();

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
  const watched = new Set<THREE.Object3D>();
  const shadowHooks = new Map<THREE.Mesh, THREE.Object3D['onBeforeShadow']>();
  const colorWritingDepthMaterials = new Set<THREE.Material>();
  function watch(object: THREE.Object3D) {
    if (watched.has(object)) return;
    watched.add(object);
    if (object instanceof THREE.Mesh) {
      if (Array.isArray(object.material))
        object.material.forEach(setupMaterial);
      else setupMaterial(object.material);
      if (compactBuffers) {
        // oxlint-disable-next-line typescript/unbound-method -- Preserve identity for restoration; call with the mesh as this.
        const previous = object.onBeforeShadow;
        shadowHooks.set(object, previous);
        object.onBeforeShadow = function (
          renderer,
          scene,
          camera,
          shadowCamera,
          geometry,
          depthMaterial,
          group,
        ) {
          previous.call(
            this,
            renderer,
            scene,
            camera,
            shadowCamera,
            geometry,
            depthMaterial,
            group,
          );
          // Keep Three's depth material variants (alpha tests, skinning, etc.).
          // Only suppress output to the color texture that PCF never samples.
          if (depthMaterial.colorWrite) {
            colorWritingDepthMaterials.add(depthMaterial);
            depthMaterial.colorWrite = false;
          }
        };
      }
    }
    object.addEventListener('childadded', childAdded);
    object.addEventListener('childremoved', childRemoved);
    object.children.forEach(watch);
  }
  function unwatch(object: THREE.Object3D) {
    watched.delete(object);
    object.removeEventListener('childadded', childAdded);
    object.removeEventListener('childremoved', childRemoved);
    if (object instanceof THREE.Mesh) {
      const previous = shadowHooks.get(object);
      if (previous) object.onBeforeShadow = previous;
      shadowHooks.delete(object);
    }
    object.children.forEach(unwatch);
  }
  function childAdded(event: { child: THREE.Object3D }) {
    watch(event.child);
  }
  function childRemoved(event: { child: THREE.Object3D }) {
    unwatch(event.child);
  }
  return {
    updateFrustums() {
      csm.updateFrustums();
    },
    update() {
      // Register the loaded scene once, then catch debris as it is attached.
      if (!watched.has(scene)) watch(scene);
      camera.updateMatrixWorld();
      csm.update();
      if (farShadowMapSize !== 4096) {
        // CSM assumes one resolution for every cascade. Keep the far light
        // aligned to its actual texel grid when testing a smaller far map.
        const light = csm.lights[1];
        const shadowCamera = light.shadow.camera;
        const texelSize =
          (shadowCamera.right - shadowCamera.left) / farShadowMapSize;
        shadowCenter.copy(light.position).applyMatrix4(inverseLightRotation);
        shadowCenter.x = Math.round(shadowCenter.x / texelSize) * texelSize;
        shadowCenter.y = Math.round(shadowCenter.y / texelSize) * texelSize;
        shadowCenter.applyMatrix4(lightRotation);
        light.position.copy(shadowCenter);
        light.target.position.copy(shadowCenter).add(csm.lightDirection);
      }
    },
    dispose() {
      unwatch(scene);
      for (const material of colorWritingDepthMaterials)
        material.colorWrite = true;
      colorWritingDepthMaterials.clear();
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
