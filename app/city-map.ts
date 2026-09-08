import * as THREE from 'three';
import { createMapRoute } from './map-route.ts';
import type { TerrainProfile } from './terrain.ts';

import { cityHeight, cityMountainHeight, cityPoint } from './city-layout.ts';
export { cityHeight } from './city-layout.ts';
const corners = [
  [-80, 80],
  [80, 80],
  [80, 0],
  [40, 0],
  [40, -80],
  [-80, -80],
  [-80, -40],
  [-40, -40],
  [-40, 40],
  [-80, 40],
];
const points: number[][] = [];
for (let i = 0; i < corners.length; i++) {
  const [x, z] = corners[i];
  const [nextX, nextZ] = corners[(i + 1) % corners.length];
  const steps = Math.ceil(Math.hypot(nextX - x, nextZ - z) / 8);
  for (let j = 0; j < steps; j++)
    points.push(
      cityPoint(
        THREE.MathUtils.lerp(x, nextX, j / steps),
        THREE.MathUtils.lerp(z, nextZ, j / steps),
      ),
    );
}
// Start partway along a straight, giving the player room before the first turn.
export const cityRoute = createMapRoute(
  [...points.slice(3), ...points.slice(0, 3)],
  cityHeight,
);
export const cityTerrain: TerrainProfile = {
  heightAt: cityHeight,
  mountainAt: cityMountainHeight,
  coastAt: () => 0,
  samples: cityRoute.routeSamples,
  tropical: false,
};

// Fine, continuous road collision; larger facets on the surrounding mountains.
export function createCityGroundGeometry() {
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  function vertex(x: number, z: number) {
    const index = positions.length / 3;
    positions.push(x, cityHeight(x, z), z);
    uv.push((x + 500) / 1000, 1 - (z + 500) / 1000);
    return index;
  }
  const size = 369;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) vertex(-230 + i * 1.25, -230 + j * 1.25);
  for (let j = 0; j < size - 1; j++)
    for (let i = 0; i < size - 1; i++) {
      const a = j * size + i,
        b = a + size;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // Square mountain facets with subdivided valley-facing edges avoid stretched
  // strips while meeting the fine road mesh exactly, including its collision.
  for (let z = -500; z < 500; z += 10)
    for (let x = -500; x < 500; x += 10) {
      if (x >= -230 && x < 230 && z >= -230 && z < 230) continue;
      const ring: number[] = [];
      const corners = [
        [x, z],
        [x, z + 10],
        [x + 10, z + 10],
        [x + 10, z],
      ];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k],
          [bx, bz] = corners[(k + 1) % 4];
        const seam =
          (ax === bx &&
            Math.abs(ax) === 230 &&
            Math.min(az, bz) >= -230 &&
            Math.max(az, bz) <= 230) ||
          (az === bz &&
            Math.abs(az) === 230 &&
            Math.min(ax, bx) >= -230 &&
            Math.max(ax, bx) <= 230);
        const steps = seam ? 8 : 1;
        for (let n = 0; n < steps; n++)
          ring.push(
            vertex(ax + ((bx - ax) * n) / steps, az + ((bz - az) * n) / steps),
          );
      }
      if (ring.length === 4)
        indices.push(ring[0], ring[1], ring[3], ring[3], ring[1], ring[2]);
      else {
        const center = vertex(x + 5, z + 5);
        for (let k = 0; k < ring.length; k++)
          indices.push(center, ring[k], ring[(k + 1) % ring.length]);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createCityGround() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4096;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the city street texture');
  const pixels = canvas.width / 1000;
  const at = (value: number) => (value + 500) * pixels;
  // Height-colored foothills continue directly into the city, without a square edge.
  for (let z = -500; z < 500; z += 2)
    for (let x = -500; x < 500; x += 2) {
      const h = cityMountainHeight(x, z);
      const stone = THREE.MathUtils.smoothstep(h, 22, 65);
      const summit = THREE.MathUtils.smoothstep(h, 85, 145);
      const shade = 3 * Math.sin(x * 0.035) * Math.cos(z * 0.04);
      const rgb = [128, 151, 111].map((v, i) =>
        Math.round(
          THREE.MathUtils.lerp(v, [145, 148, 140][i] + summit * 42, stone) +
            shade,
        ),
      );
      context.fillStyle = `rgb(${rgb.join(',')})`;
      context.fillRect(at(x), at(z), pixels * 2 + 1, pixels * 2 + 1);
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const ground = new THREE.Mesh(
    createCityGroundGeometry(),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      flatShading: true,
    }),
  );
  ground.name = 'City streets and mountain valley';
  ground.receiveShadow = true;
  return ground;
}
