import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTerrainGeometry, seaLevel } from '../app/terrain.ts';
import { tropicalHeight } from '../app/tropical-map.ts';
import { createTropicalScenery } from '../app/tropical-scenery.ts';
import {
  type IslandBake,
  islandLightingMeshes,
  islandLightingSignature,
} from '../app/island-lighting.ts';

await test('the shipped island bake matches all current static scenery and excludes movable props', async () => {
  const loader = new GLTFLoader();
  const palms = await Promise.all(
    [
      'tree-palm-tall',
      'tree-palm-curved',
      'tree-palm-short',
      'mountain-palm-cove',
      'props-palm-cove',
    ].map(async (name) => {
      const bytes = await readFile(
        new URL(`../public/models/${name}.glb`, import.meta.url),
      );
      return (
        await loader.parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          '',
        )
      ).scene;
    }),
  );
  const ground = new THREE.Mesh(createTerrainGeometry(tropicalHeight));
  const scenery = createTropicalScenery(palms.slice(0, 3));
  const meshes = islandLightingMeshes(
    ground,
    scenery.group,
    palms[3],
    palms[4],
  );
  const bake: IslandBake = JSON.parse(
    await readFile(
      new URL('../public/lighting/island.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(bake.terrain.id, 'ground');
  assert.ok(!bake.meshes.some((entry) => entry.id === 'ground'));
  assert.equal(
    bake.terrain.count,
    ground.geometry.getAttribute('position').count,
  );
  assert.equal(bake.terrain.signature, islandLightingSignature(ground));
  assert.ok(bake.meshes.some((entry) => entry.id.startsWith('scenery-')));
  assert.ok(bake.meshes.some((entry) => entry.id.startsWith('mountain-')));
  assert.ok(bake.meshes.some((entry) => entry.id.startsWith('jetty-')));
  assert.equal(
    bake.meshes.length + 1,
    meshes.size,
    'Every fixed mesh should be baked',
  );
  assert.ok(
    [...meshes.values()].every(
      (mesh) => !/boat|yacht|buoy|crate|barrel|rope/i.test(mesh.name),
    ),
  );
  for (const entry of bake.meshes) {
    const mesh = meshes.get(entry.id);
    assert.ok(mesh, `Missing baked mesh ${entry.id}`);
    assert.equal(
      mesh.geometry.getAttribute('position').count,
      entry.count,
      `Rebake ${entry.id}: geometry changed`,
    );
    assert.equal(
      islandLightingSignature(mesh),
      entry.signature,
      `Rebake ${entry.id}: geometry or placement changed`,
    );
    assert.equal(
      entry.vertices.length,
      entry.count,
      `Incomplete bake for ${entry.id}`,
    );
    assert.equal(entry.irradiance.length, entry.vertices.length * 3);
    assert.equal(new Set(entry.vertices).size, entry.vertices.length);
    assert.ok(
      entry.vertices.every(
        (vertex) =>
          Number.isInteger(vertex) && vertex >= 0 && vertex < entry.count,
      ),
    );
    assert.ok(
      entry.irradiance.every((value) => Number.isFinite(value) && value >= 0),
    );
  }
});

await test('the terrain HDR lightmap is valid and its UV bounds cover all visible land', async () => {
  const bake: IslandBake = JSON.parse(
    await readFile(
      new URL('../public/lighting/island.json', import.meta.url),
      'utf8',
    ),
  );
  const bytes = await readFile(
    new URL(`../public/lighting/${bake.terrain.texture}`, import.meta.url),
  );
  const texture = new EXRLoader().createDataTexture(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 2048);
  assert.equal(texture.type, THREE.HalfFloatType);
  assert.equal(texture.colorSpace, THREE.LinearSRGBColorSpace);
  const data = texture.image.data;
  assert.ok(data);
  let maximum = 0;
  for (let i = 0; i < data.length; i++) {
    const value = THREE.DataUtils.fromHalfFloat(data[i]);
    assert.ok(
      Number.isFinite(value) && value >= 0,
      `Invalid irradiance at ${i}`,
    );
    if (i % 4 !== 3) maximum = Math.max(maximum, value);
  }
  assert.ok(maximum > 1, 'Preserve HDR irradiance without clipping');
  assert.ok(maximum < 10, 'Unexpected lightmap intensity');
  const [minX, maxX, minZ, maxZ] = bake.terrain.bounds;
  const geometry = createTerrainGeometry(tropicalHeight);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) <= seaLevel - 3) continue;
    assert.ok(positions.getX(i) > minX && positions.getX(i) < maxX);
    assert.ok(positions.getZ(i) > minZ && positions.getZ(i) < maxZ);
  }
  texture.dispose();
  geometry.dispose();
});
