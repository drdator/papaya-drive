import * as THREE from 'three';
import { shorelineSwellShader } from './water-waves.ts';
import { createMapRoute } from './map-route.ts';
import { seaLevel, type TerrainProfile } from './terrain.ts';

function coastlineRadius(angle: number) {
  return (
    1 +
    0.16 * Math.sin(angle * 3 - 0.5) +
    0.09 * Math.sin(angle * 5 + 1.2) +
    0.06 * Math.cos(angle + 0.6) +
    0.17 * Math.exp(-0.5 * ((angle + 0.35) / 0.23) ** 2)
  );
}
function islandRadius(x: number, z: number) {
  return (
    Math.hypot(x / 67, z / 55) / coastlineRadius(Math.atan2(z / 55, x / 67))
  );
}
function foothills(x: number, z: number) {
  const main =
    13 * Math.max(0, 1 - ((x - 8) / 43) ** 2 - ((z + 2) / 37) ** 2) ** 2;
  const ridge = 8 * Math.max(0, 1 - ((x - 30) / 20) ** 2 - (z / 25) ** 2) ** 2;
  const front =
    4 * Math.max(0, 1 - ((x - 17) / 23) ** 2 - ((z - 18) / 18) ** 2) ** 2;
  const west =
    4 * Math.max(0, 1 - ((x + 15) / 20) ** 2 - ((z - 7) / 24) ** 2) ** 2;
  return main + ridge + front + west;
}
function islandHeight(x: number, z: number) {
  const radius = islandRadius(x, z);
  const shore = THREE.MathUtils.smoothstep(radius, 0.84, 1.25);
  const dune = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    height: number,
  ) => height * Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const dunes =
    0.45 * Math.sin(x * 0.1) * Math.cos(z * 0.12) +
    dune(28, -47, 11, 10, 6.5) +
    dune(-43, -17, 12, 9, 5.8) +
    dune(-25, 36, 11, 9, 5.5) +
    dune(37, 25, 10, 9, 3.8) -
    dune(-43, 17, 10, 12, 1.1);
  return THREE.MathUtils.lerp(2.4 + dunes + foothills(x, z), -6.5, shore);
}
// A small level patch of packed sand supports the fishing supplies. The same
// surface is used for rendering and physics, so the props need no hidden anchors.
const landingSand = { x: 66.35, z: 21.9 };
const landingHeight = 1.25; // Just below the jetty deck.
export function tropicalHeight(x: number, z: number) {
  const distance = Math.hypot(x - landingSand.x, z - landingSand.z);
  return THREE.MathUtils.lerp(
    landingHeight,
    islandHeight(x, z),
    THREE.MathUtils.smoothstep(distance, 4.25, 7),
  );
}
function mountainFootprint(x: number, z: number) {
  const main = 38 * Math.max(0, 1 - ((x - 8) / 34) ** 2 - ((z + 2) / 28) ** 2);
  const front =
    18 * Math.max(0, 1 - ((x - 17) / 20) ** 2 - ((z - 15) / 16) ** 2);
  const west = 18 * Math.max(0, 1 - ((x + 13) / 18) ** 2 - ((z - 7) / 20) ** 2);
  const spur =
    x > 29 && x < 68 && Math.abs(z) < 12 && (x < 44 || x > 61)
      ? 15 * THREE.MathUtils.smoothstep(12 - Math.abs(z), 0, 5)
      : 0;
  const weathering =
    1 + 0.12 * Math.sin(x * 0.48 + z * 0.3) * Math.cos(z * 0.4);
  return Math.max(main, front, west, spur, foothills(x, z) * 1.1) * weathering;
}
function beachPoint(degrees: number, inset: number) {
  const angle = THREE.MathUtils.degToRad(degrees);
  const radius = coastlineRadius(angle) * inset;
  return [Math.cos(angle) * 67 * radius, Math.sin(angle) * 55 * radius];
}
export const tropicalRoute = createMapRoute(
  [
    beachPoint(55, 0.76),
    beachPoint(35, 0.78),
    [52.5, 13],
    [52.5, 0],
    [52.5, -14],
    beachPoint(-45, 0.77),
    beachPoint(-65, 0.8),
    beachPoint(-90, 0.79),
    beachPoint(-115, 0.76),
    beachPoint(-140, 0.8),
    beachPoint(-165, 0.77),
    beachPoint(-190, 0.78),
    beachPoint(-215, 0.76),
    beachPoint(-240, 0.8),
    beachPoint(-265, 0.75),
    beachPoint(-290, 0.77),
  ],
  tropicalHeight,
);
export const tropicalTerrain: TerrainProfile = {
  heightAt: tropicalHeight,
  mountainAt: mountainFootprint,
  coastAt: (x, z) => THREE.MathUtils.smoothstep(islandRadius(x, z), 0.53, 1.12),
  samples: tropicalRoute.routeSamples,
  tropical: true,
};

export function createTropicalSurf(time = new THREE.Uniform(0)) {
  const vertices: number[] = [];
  const indices: number[] = [];
  const depths: number[] = [];
  const distances: number[] = [];
  const segments = 240;
  const rows = 21;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    let inner = 20,
      outer = 115;
    for (let j = 0; j < 14; j++) {
      const radius = (inner + outer) / 2;
      if (
        tropicalHeight(Math.cos(angle) * radius, Math.sin(angle) * radius) >
        seaLevel
      )
        inner = radius;
      else outer = radius;
    }
    // The foam rides the same changing water surface as the ocean. Terrain
    // depth determines where that surface intersects the beach each frame.
    for (let row = 0; row < rows; row++) {
      const distance = -4 + row * 0.5;
      const radius = (inner + outer) / 2 + distance;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      vertices.push(x, seaLevel + 0.04, z);
      depths.push(seaLevel - tropicalHeight(x, z));
      distances.push(distance);
      if (i < segments && row < rows - 1) {
        const a = i * rows + row;
        indices.push(a, a + rows, a + 1, a + 1, a + rows, a + rows + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.setAttribute(
    'waterDepth',
    new THREE.Float32BufferAttribute(depths, 1),
  );
  geometry.setAttribute(
    'shoreDistance',
    new THREE.Float32BufferAttribute(distances, 1),
  );
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: '#edffef',
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float waterTime;
        attribute float waterDepth;
        attribute float shoreDistance;
        varying float wetDepth;
        varying float beachDistance;
        varying float foamFade;
        ${shorelineSwellShader}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float lift = shorelineSwell(position.xz, waterDepth, waterTime)
          + smallWaterRipples(position.xz, waterDepth, waterTime);
        transformed.y += lift;
        wetDepth = waterDepth + lift;
        beachDistance = shoreDistance;
        // Dissolve after the crest, then rebuild during the next incoming wave.
        float cycle = mod(shorelinePhase(position.xz, waterTime) - 1.5707963, 6.2831853);
        foamFade = cycle < 3.14159265
          ? mix(1.0, 0.04, smoothstep(0.0, 2.5, cycle))
          : mix(0.04, 1.0, smoothstep(3.14159265, 5.6, cycle));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float wetDepth;
        varying float beachDistance;
        varying float foamFade;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float submerged = smoothstep(-0.02, 0.05, wetDepth);
        float foam = (1.0 - smoothstep(0.06, 0.24, wetDepth)) * foamFade;
        float wash = 1.0 - smoothstep(0.15, 0.6, wetDepth);
        float edge = smoothstep(-4.0, -3.3, beachDistance)
          * (1.0 - smoothstep(5.0, 6.0, beachDistance));
        diffuseColor.rgb = mix(vec3(0.46, 0.78, 0.71), diffuseColor.rgb, foam);
        diffuseColor.a *= edge * submerged * (0.85 * foam + 0.18 * wash);`,
      );
  };
  mesh.name = 'Shore break';
  // Both surfaces are transparent; draw the wash after the ocean from every view.
  mesh.renderOrder = 2;
  return mesh;
}
