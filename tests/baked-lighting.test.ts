import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createTerrainGeometry,
  seaLevel,
  forestTerrain,
  distanceToRoad,
  ridgeBaseHeight,
  terrainHeight,
} from '../app/terrain.ts';
import { createRidgeScenery } from '../app/ridge-scenery.ts';
import {
  createRidgeBackdrop,
  createCentralRockDetails,
} from '../app/ridge-environment.ts';
import { createRidgeRiver } from '../app/ridge-river.ts';
import { maps } from '../app/maps.ts';
import { tropicalHeight } from '../app/tropical-map.ts';
import { createTropicalScenery } from '../app/tropical-scenery.ts';
import {
  type LightingBake,
  lightingMeshes,
  lightingSignature,
} from '../app/baked-lighting.ts';

for (const map of ['island', 'ridge'] as const) {
  await test(`${map}: the shipped bake matches all fixed scenery`, async () => {
    const loader = new GLTFLoader();
    const names =
      map === 'island'
        ? [...maps.tropical.trees, 'mountain-palm-cove', 'props-palm-cove']
        : [...maps.ridge.trees, 'rock-boulder', 'rock-flat', 'rock-crag'];
    const models = await Promise.all(
      names.map(async (name) => {
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
    const ground = new THREE.Mesh(
      createTerrainGeometry(map === 'island' ? tropicalHeight : terrainHeight),
    );
    let meshes: Map<string, THREE.Mesh>;
    if (map === 'island') {
      const scenery = createTropicalScenery(models.slice(0, 3));
      meshes = lightingMeshes(ground, {
        scenery: scenery.group,
        mountain: models[3],
        jetty: models[4].getObjectByName('Jetty'),
      });
    } else {
      const scenery = createRidgeScenery(models);
      const mountain = new THREE.Group();
      mountain.add(
        createRidgeBackdrop(forestTerrain.heightAt),
        createCentralRockDetails(forestTerrain.heightAt, distanceToRoad),
      );
      const river = createRidgeRiver(
        ridgeBaseHeight,
        terrainHeight,
        new THREE.Uniform(0),
      );
      meshes = lightingMeshes(ground, {
        scenery: scenery.group,
        mountain,
        bridge: river.solids,
      });
    }
    const bake: LightingBake = JSON.parse(
      await readFile(
        new URL(`../public/lighting/${map}.json`, import.meta.url),
        'utf8',
      ),
    );
    assert.equal(bake.terrain.id, 'ground');
    assert.ok(!bake.meshes.some((entry) => entry.id === 'ground'));
    assert.equal(
      bake.terrain.count,
      ground.geometry.getAttribute('position').count,
    );
    assert.equal(bake.terrain.signature, lightingSignature(ground));
    assert.ok(bake.meshes.some((entry) => entry.id.startsWith('scenery-')));
    assert.ok(bake.meshes.some((entry) => entry.id.startsWith('mountain-')));
    assert.ok(
      bake.meshes.some((entry) =>
        entry.id.startsWith(map === 'island' ? 'jetty-' : 'bridge-'),
      ),
    );
    assert.equal(
      bake.meshes.length + 1,
      meshes.size,
      'Every fixed mesh should be baked',
    );
    assert.ok(
      [...meshes.values()].every(
        (mesh) =>
          !/boat|yacht|buoy|crate|barrel|rope|Popped_hood/i.test(mesh.name),
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
        lightingSignature(mesh),
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

  await test(`${map}: the HDR lightmap is valid and covers the terrain`, async () => {
    const bake: LightingBake = JSON.parse(
      await readFile(
        new URL(`../public/lighting/${map}.json`, import.meta.url),
        'utf8',
      ),
    );
    const bytes = await readFile(
      new URL(`../public/lighting/${bake.terrain.texture}`, import.meta.url),
    );
    const texture = new EXRLoader().createDataTexture(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    assert.equal(texture.image.width, map === 'ridge' ? 4096 : 2048);
    assert.equal(texture.image.height, map === 'ridge' ? 4096 : 2048);
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
    const geometry = createTerrainGeometry(
      map === 'island' ? tropicalHeight : terrainHeight,
    );
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      if (map === 'island' && positions.getY(i) <= seaLevel - 3) continue;
      assert.ok(positions.getX(i) > minX && positions.getX(i) < maxX);
      assert.ok(positions.getZ(i) > minZ && positions.getZ(i) < maxZ);
    }
    texture.dispose();
    geometry.dispose();
  });
}
