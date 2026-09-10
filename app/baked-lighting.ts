import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { seaLevel } from './terrain.ts';

// Pass only fixed scenery: moving objects must not leave baked shadows behind.
export function lightingMeshes(
  ground: THREE.Mesh,
  roots: Record<string, THREE.Object3D | undefined>,
) {
  const meshes = new Map<string, THREE.Mesh>([['ground', ground]]);
  ground.updateMatrixWorld(true);
  for (const [prefix, root] of Object.entries(roots)) {
    if (!root) continue;
    root.updateWorldMatrix(true, true);
    let index = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh)
        meshes.set(`${prefix}-${index++}`, object);
    });
  }
  return meshes;
}

// Detect moved instances or changed geometry before applying an obsolete bake.
export function lightingSignature(mesh: THREE.Mesh) {
  let hash = 2166136261;
  function add(value: number) {
    hash = Math.imul(hash ^ Math.round(value * 10000), 16777619);
  }
  mesh.matrixWorld.elements.forEach(add);
  for (const name of ['position', 'normal']) {
    const attribute = mesh.geometry.getAttribute(name);
    if (!attribute) continue;
    for (let i = 0; i < attribute.count; i++) {
      add(attribute.getX(i));
      add(attribute.getY(i));
      add(attribute.getZ(i));
    }
  }
  const indices = mesh.geometry.index;
  if (indices) for (let i = 0; i < indices.count; i++) add(indices.getX(i));
  return (hash >>> 0).toString(16);
}

export type LightingBake = {
  terrain: {
    id: string;
    count: number;
    signature: string;
    bounds: [number, number, number, number];
    texture: string;
    size: number;
  };
  meshes: {
    id: string;
    count: number;
    signature: string;
    vertices: number[];
    irradiance: number[];
  }[];
};

export async function loadBakedLighting(
  map: 'island' | 'ridge',
  meshes: Map<string, THREE.Mesh>,
  signal: AbortSignal,
) {
  const ground = meshes.get('ground');
  if (!ground) throw new Error('Lighting bake needs a ground mesh');
  const response = await fetch(
    `${import.meta.env.BASE_URL}lighting/${map}.json`,
    { signal },
  );
  if (!response.ok) throw new Error('Map lighting bake could not load');
  const bake: LightingBake = await response.json();
  signal.throwIfAborted();
  if (bake.meshes.length + 1 !== meshes.size)
    throw new Error('Map scenery changed; rebake its lighting');
  const materials: THREE.MeshStandardMaterial[] = [];
  const originalGeometries = new Set<THREE.BufferGeometry>();
  const originalMaterials = new Set<THREE.Material>();
  const materialCache = new Map<THREE.Material, THREE.Material>();
  // Check the entire bake before changing any live meshes.
  for (const entry of [...bake.meshes, bake.terrain]) {
    const mesh = meshes.get(entry.id);
    if (
      !mesh ||
      mesh.geometry.getAttribute('position').count !== entry.count ||
      lightingSignature(mesh) !== entry.signature
    )
      throw new Error('Map lighting is out of date; rebake the map');
  }
  const lightmapResponse = await fetch(
    `${import.meta.env.BASE_URL}lighting/${bake.terrain.texture}`,
    { signal },
  );
  if (!lightmapResponse.ok)
    throw new Error('Map ground lightmap could not load');
  const buffer = await lightmapResponse.arrayBuffer();
  signal.throwIfAborted();
  const lightmap = new EXRLoader().createDataTexture(buffer);
  if (
    lightmap.image.width !== bake.terrain.size ||
    lightmap.image.height !== bake.terrain.size
  ) {
    lightmap.dispose();
    throw new Error('Map ground lightmap has the wrong dimensions');
  }
  lightmap.channel = 1;
  lightmap.generateMipmaps = true;
  lightmap.minFilter = THREE.LinearMipmapLinearFilter;
  lightmap.anisotropy = 8;

  // The ground needs per-pixel irradiance: vertex interpolation smears lighting
  // across its large triangles, especially along the mountain's buried edges.
  const [minX, maxX, minZ, maxZ] = bake.terrain.bounds;
  const positions = ground.geometry.getAttribute('position');
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    uv[i * 2] = (positions.getX(i) - minX) / (maxX - minX);
    uv[i * 2 + 1] = (maxZ - positions.getZ(i)) / (maxZ - minZ);
  }
  ground.geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  const groundMaterials = Array.isArray(ground.material)
    ? ground.material
    : [ground.material];
  for (const material of groundMaterials) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    material.lightMap = lightmap;
    const previousCompile = material.onBeforeCompile.bind(material);
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 bakedGroundPosition;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nbakedGroundPosition = position;',
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec3 bakedGroundPosition;',
      );
      // Keep a little ambient fill on Ridge to soften its shaded ground.
      // The island keeps full ground contrast; scenery uses its 75% blend.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_maps>',
        THREE.ShaderChunk.lights_fragment_maps.replace(
          'irradiance += lightMapIrradiance;',
          `#ifdef BAKED_LIGHTING
            float groundBakeWeight = ${map === 'island' ? `smoothstep(${seaLevel - 3}, ${seaLevel - 1}, bakedGroundPosition.y)` : '0.9'};
            irradiance = mix(irradiance, lightMapIrradiance, groundBakeWeight);
          #endif`,
        ),
      );
    };
    material.customProgramCacheKey = () =>
      `${previousKey}-${map}-ground-lightmap-v4`;
    materials.push(material);
  }
  for (const entry of bake.meshes) {
    const mesh = meshes.get(entry.id)!;
    // Each instance needs its own lighting attribute, even when its shape is shared.
    const originalGeometry = mesh.geometry;
    originalGeometries.add(originalGeometry);
    mesh.geometry = mesh.geometry.clone();
    const values = new Float32Array(entry.count * 4);
    for (const [offset, vertex] of entry.vertices.entries()) {
      for (let channel = 0; channel < 3; channel++)
        values[vertex * 4 + channel] = entry.irradiance[offset * 3 + channel];
      values[vertex * 4 + 3] = 1;
    }
    mesh.geometry.setAttribute(
      'bakedIrradiance',
      new THREE.BufferAttribute(values, 4),
    );
    function materialWithBake(source: THREE.Material) {
      const cached = materialCache.get(source);
      if (cached) return cached;
      if (!(source instanceof THREE.MeshStandardMaterial)) return source;
      originalMaterials.add(source);
      const material = source.clone();
      const previousCompile = source.onBeforeCompile.bind(material);
      const previousKey = source.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile(shader, renderer);
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
          #ifdef BAKED_LIGHTING
            attribute vec4 bakedIrradiance;
            varying vec4 sceneIrradiance;
          #endif`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
          #ifdef BAKED_LIGHTING
            sceneIrradiance = bakedIrradiance;
          #endif`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
          #ifdef BAKED_LIGHTING
            varying vec4 sceneIrradiance;
          #endif`,
          )
          .replace(
            '#include <lights_fragment_end>',
            `
          #ifdef BAKED_LIGHTING
            // Keep some of the game's bright ambient fill beneath the foliage.
            irradiance = mix(irradiance, sceneIrradiance.rgb, sceneIrradiance.a * 0.75);
          #endif
          #include <lights_fragment_end>`,
          );
      };
      material.customProgramCacheKey = () => `${previousKey}-vertex-bake-v3`;
      materialCache.set(source, material);
      materials.push(material);
      return material;
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(materialWithBake)
      : materialWithBake(mesh.material);
  }
  return {
    dispose() {
      lightmap.dispose();
      originalGeometries.forEach((geometry) => geometry.dispose());
      originalMaterials.forEach((material) => material.dispose());
    },
    setEnabled(enabled: boolean) {
      for (const material of materials) {
        material.defines ??= {};
        if (enabled) material.defines.BAKED_LIGHTING = '';
        else delete material.defines.BAKED_LIGHTING;
        material.needsUpdate = true;
      }
    },
  };
}
