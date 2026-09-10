// Run exportIslandLighting() in a Vite browser page, then save its JSON for Blender.
// This uses the real terrain texture, palm instances and mountain geometry.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTerrain, seaLevel } from '../app/terrain.ts';
import { tropicalTerrain } from '../app/tropical-map.ts';
import { createTropicalScenery } from '../app/tropical-scenery.ts';
import {
  islandLightingSignature,
  islandLightingMeshes,
} from '../app/island-lighting.ts';

export async function exportIslandLighting() {
  const loader = new GLTFLoader();
  const models = await Promise.all(
    [
      'tree-palm-tall',
      'tree-palm-curved',
      'tree-palm-short',
      'mountain-palm-cove',
      'props-palm-cove',
    ].map(
      async (name) => (await loader.loadAsync(`/models/${name}.glb`)).scene,
    ),
  );
  const ground = createTerrain(tropicalTerrain);
  const scenery = createTropicalScenery(models.slice(0, 3));
  const meshes = islandLightingMeshes(
    ground,
    scenery.group,
    models[3],
    models[4],
  );
  const canvas = ground.material.map!.image as HTMLCanvasElement;
  const pixels = canvas
    .getContext('2d')!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const result = [];
  for (const [id, mesh] of meshes) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const vertexColors = geometry.getAttribute('color');
    const uv = geometry.getAttribute('uv');
    const source = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const vertices: number[][] = [];
    const colors: number[][] = [];
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      vertices.push(point.toArray());
      color.setRGB(1, 1, 1);
      if (vertexColors) color.fromBufferAttribute(vertexColors, i);
      if (mesh === ground) {
        const x = THREE.MathUtils.clamp(
          Math.round(uv.getX(i) * (canvas.width - 1)),
          0,
          canvas.width - 1,
        );
        const y = THREE.MathUtils.clamp(
          Math.round((1 - uv.getY(i)) * (canvas.height - 1)),
          0,
          canvas.height - 1,
        );
        const offset = (y * canvas.width + x) * 4;
        color.setRGB(
          pixels[offset] / 255,
          pixels[offset + 1] / 255,
          pixels[offset + 2] / 255,
          THREE.SRGBColorSpace,
        );
      }
      colors.push(color.toArray());
    }
    const faces = [];
    const indices = geometry.index;
    for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
      const face = [0, 1, 2].map((j) =>
        indices ? indices.getX(i + j) : i + j,
      );
      const materialIndex =
        geometry.groups.find((g) => i >= g.start && i < g.start + g.count)
          ?.materialIndex ?? 0;
      const material = source[materialIndex];
      const tint =
        material instanceof THREE.MeshStandardMaterial
          ? material.color.toArray()
          : [1, 1, 1];
      faces.push({
        vertices: face,
        colors: face.map((v) =>
          colors[v].map((channel, j) => channel * tint[j]),
        ),
        target:
          mesh !== ground || face.some((v) => vertices[v][1] > seaLevel - 3),
      });
    }
    if (faces.length)
      result.push({
        id,
        count: positions.count,
        signature: islandLightingSignature(mesh),
        vertices,
        faces,
      });
  }
  return { meshes: result };
}

export async function downloadIslandLighting() {
  const blob = new Blob([JSON.stringify(await exportIslandLighting())], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'island-lighting-scene.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
