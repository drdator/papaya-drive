import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCascadedSun } from '../app/cascaded-sun.ts';

await test('smaller distant shadows preserve the near cascade and snap to the far texture grid', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 0.6, 0.1, 650);
  camera.position.set(4, 10, 28);
  camera.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight();
  sun.position.set(-50, 84, 36);
  const cascades = createCascadedSun(scene, camera, sun, {
    compactBuffers: true,
    farShadowMapSize: 2048,
  });
  const lights = scene.children.filter(
    (object) => object instanceof THREE.DirectionalLight,
  );
  assert.deepEqual(
    lights.map((light) => light.shadow.mapSize.x),
    [4096, 2048],
  );
  assert.deepEqual(
    lights.map((light) => light.shadow.map!.width),
    [4096, 2048],
  );
  const direction = sun.target.position.clone().sub(sun.position).normalize();
  const inverseRotation = new THREE.Matrix4()
    .lookAt(new THREE.Vector3(), direction, new THREE.Vector3(0, 1, 0))
    .invert();
  for (let i = 0; i < 20; i++) {
    camera.position.x += 0.023;
    cascades.update();
    const far = lights[1];
    const position = far.position.clone().applyMatrix4(inverseRotation);
    const texel = (far.shadow.camera.right - far.shadow.camera.left) / 2048;
    for (const coordinate of [position.x, position.y])
      assert.ok(
        Math.abs(coordinate / texel - Math.round(coordinate / texel)) < 1e-8,
      );
    assert.ok(
      far.target.position.clone().sub(far.position).distanceTo(direction) <
        1e-10,
    );
  }
  cascades.dispose();
});

await test('cascades preserve custom lighting, cover new materials and release their resources', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1.6, 0.1, 400);
  const sun = new THREE.DirectionalLight('#fff0ce', 3.1);
  sun.position.set(-50, 84, 36);
  const originalChunk = THREE.ShaderChunk.lights_fragment_begin;
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bakedLighting = { value: 0.75 };
  };
  material.customProgramCacheKey = () => 'custom-baked-lighting';
  const geometry = new THREE.BoxGeometry();
  scene.add(new THREE.Mesh(geometry, material));
  const cascades = createCascadedSun(scene, camera, sun);
  function compile(source: THREE.Material) {
    // These hooks only edit shader data; GPU compilation is checked in-browser.
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '',
    } as THREE.WebGLProgramParametersWithUniforms;
    source.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader.uniforms;
  }
  cascades.update();
  const uniforms = compile(material);
  assert.equal(uniforms.bakedLighting.value, 0.75);
  assert.equal(uniforms.shadowFar.value, 160);
  assert.deepEqual(
    uniforms.CSM_cascades.value.map((v: THREE.Vector2) => v.toArray()),
    [
      [0, 0.2],
      [0.2, 1],
    ],
  );
  assert.equal(material.defines?.CSM_FADE, '');
  assert.equal(material.customProgramCacheKey(), 'custom-baked-lighting-csm-2');
  const lights = scene.children.filter(
    (object) => object instanceof THREE.DirectionalLight,
  );
  assert.equal(lights.length, 2);
  assert.ok(lights[0].shadow.camera.right < lights[1].shadow.camera.right);
  for (const light of lights) {
    assert.equal(light.shadow.map, null);
    assert.equal(light.intensity, sun.intensity);
    assert.ok(light.color.equals(sun.color));
  }
  const oldWidth = lights[0].shadow.camera.right;
  camera.aspect = 0.75;
  cascades.updateFrustums();
  assert.ok(lights[0].shadow.camera.right < oldWidth);

  // Crash debris clones materials after loading; Three does not clone hooks.
  const debrisMaterial = material.clone();
  const debris = new THREE.Mesh(geometry, debrisMaterial);
  const debrisGroup = new THREE.Group();
  scene.add(debrisGroup);
  debrisGroup.add(debris);
  assert.equal(compile(debrisMaterial).shadowFar.value, 160);
  // Moving an existing part out of the car must retain its shadow setup.
  scene.attach(debris);
  const traverse = scene.traverse.bind(scene);
  scene.traverse = () => {
    throw new Error('Per-frame scene scan');
  };
  cascades.update();
  scene.traverse = traverse;
  assert.equal(compile(debrisMaterial).shadowFar.value, 160);
  debrisMaterial.dispose();
  let disposedMaps = 0;
  for (const light of lights) {
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    light.shadow.map.addEventListener('dispose', () => disposedMaps++);
  }
  cascades.dispose();
  assert.equal(disposedMaps, 2);
  assert.ok(
    !scene.children.some((object) => object instanceof THREE.DirectionalLight),
  );
  assert.equal(THREE.ShaderChunk.lights_fragment_begin, originalChunk);
  assert.equal(material.defines?.USE_CSM, undefined);
  assert.equal(material.customProgramCacheKey(), 'custom-baked-lighting');
  assert.equal(compile(material).bakedLighting.value, 0.75);
  assert.equal(compile(material).CSM_cascades, undefined);
  material.dispose();
  geometry.dispose();
});

await test('compact shadow buffers retain depth precision, filtering and per-frame updates', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.castShadow = true;
  let shadowCalls = 0;
  const originalShadowHook = () => {
    shadowCalls++;
  };
  mesh.onBeforeShadow = originalShadowHook;
  scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(48, 1.6, 0.1, 400);
  const sun = new THREE.DirectionalLight('#fff0ce', 3.1);
  sun.position.set(-50, 84, 36);
  const cascades = createCascadedSun(scene, camera, sun, {
    compactBuffers: true,
  });
  const lights = scene.children.filter(
    (object) => object instanceof THREE.DirectionalLight,
  );
  assert.equal(lights.length, 2);
  cascades.update();
  const depthMaterial = new THREE.MeshDepthMaterial({ alphaTest: 0.4 });
  mesh.onBeforeShadow(
    {} as THREE.WebGLRenderer,
    scene,
    camera,
    lights[0].shadow.camera,
    mesh.geometry,
    depthMaterial,
    new THREE.Group(),
  );
  assert.equal(shadowCalls, 1);
  assert.equal(depthMaterial.colorWrite, false);
  assert.equal(depthMaterial.alphaTest, 0.4);
  let disposed = 0;
  for (const light of lights) {
    const map = light.shadow.map!;
    const depth = map.depthTexture!;
    assert.deepEqual([map.width, map.height], [4096, 4096]);
    assert.equal(map.texture.format, THREE.RedFormat);
    assert.equal(map.texture.type, THREE.UnsignedByteType);
    assert.equal(depth.format, THREE.DepthFormat);
    assert.equal(depth.type, THREE.UnsignedIntType);
    assert.equal(depth.compareFunction, THREE.LessEqualCompare);
    assert.equal(depth.minFilter, THREE.LinearFilter);
    assert.equal(depth.magFilter, THREE.LinearFilter);
    assert.equal(light.shadow.autoUpdate, true);
    map.addEventListener('dispose', () => disposed++);
  }
  cascades.dispose();
  assert.equal(disposed, 2);
  assert.ok(mesh.onBeforeShadow === originalShadowHook);
  assert.equal(depthMaterial.colorWrite, true);
  mesh.geometry.dispose();
  mesh.material.dispose();
  depthMaterial.dispose();
});
