import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createCascadedSun } from '../app/cascaded-sun.ts';

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
    assert.equal(light.intensity, sun.intensity);
    assert.ok(light.color.equals(sun.color));
  }
  const oldWidth = lights[0].shadow.camera.right;
  camera.aspect = 0.75;
  cascades.updateFrustums();
  assert.ok(lights[0].shadow.camera.right < oldWidth);

  // Crash debris clones materials after loading; Three does not clone hooks.
  const debrisMaterial = material.clone();
  scene.add(new THREE.Mesh(geometry, debrisMaterial));
  cascades.update();
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
