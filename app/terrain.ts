import * as THREE from 'three';
import { shorelineSwellShader } from './water-waves.ts';
import { boatWaterMaskShader, createBoatWaterMask } from './boat-water-mask.ts';
import {
  ridgeGroundColor,
  ridgeMountainHeight,
  ridgeCentralHeight as mountainHeight,
} from './ridge-environment.ts';
export { ridgeCentralHeight as mountainHeight } from './ridge-environment.ts';
import { createMapRoute } from './map-route.ts';
import {
  carveRiver,
  riverDistance,
  bridge,
  bridgeCoordinates,
  bridgePoint,
  bridgeHeight,
  bridgeApproach,
} from './ridge-river.ts';

export const terrainSize = 300;
export const terrainSegments = 240;
export const roadWidth = 7.6;
export const seaLevel = -0.6;

// The first ridge sits on a fast straight; the rest forms broad hills and valleys.
export function ridgeBaseHeight(x: number, z: number) {
  const hill = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    height: number,
  ) => height * Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const inland =
    1.8 +
    1.2 * Math.sin(x * 0.045) * Math.cos(z * 0.04) +
    0.55 * Math.sin(z * 0.09) +
    hill(0, 30, 8, 18, 3.8) +
    hill(34, -27, 17, 12, 6) +
    hill(-36, -19, 12, 16, 4.5) -
    hill(3, -10, 18, 13, 1.6);
  return inland + mountainHeight(x, z) + ridgeMountainHeight(x, z);
}

export function terrainHeight(x: number, z: number) {
  const height = carveRiver(x, z, ridgeBaseHeight(x, z));
  const { along, across } = bridgeCoordinates(x, z);
  return Math.abs(along) >= bridge.halfLength
    ? bridgeApproach(x, z, height, ridgeBaseHeight)
    : Math.min(
        height,
        THREE.MathUtils.lerp(
          height,
          bridgeHeight(along, ridgeBaseHeight) - 0.05,
          1 -
            THREE.MathUtils.smoothstep(
              Math.abs(across),
              bridge.halfWidth + 0.3,
              7,
            ),
        ),
      );
}

export function ridgeDrivingHeight(x: number, z: number) {
  const { along, across } = bridgeCoordinates(x, z);
  return Math.abs(along) <= bridge.halfLength &&
    Math.abs(across) <= bridge.halfWidth
    ? Math.max(terrainHeight(x, z), bridgeHeight(along, ridgeBaseHeight))
    : terrainHeight(x, z);
}

export const {
  route,
  routeHeading,
  routeSamples,
  routeLength,
  distanceToRoad,
} = createMapRoute(
  [
    [-32, 30],
    [-12, 30],
    ...[-17, -10, 0, 10, 17].map((along) => {
      const p = bridgePoint(along, 0);
      return [p.x, p.z];
    }),
    [48, 5],
    [30, -9],
    [42, -34],
    [14, -43],
    [-5, -24],
    [-27, -40],
    [-48, -20],
    [-36, 2],
    [-51, 30],
  ],
  ridgeDrivingHeight,
);

export type TerrainProfile = {
  heightAt: (x: number, z: number) => number;
  groundAt?: (x: number, z: number) => number;
  mountainAt: (x: number, z: number) => number;
  coastAt: (x: number, z: number) => number;
  samples: THREE.Vector3[];
  tropical: boolean;
};
export const forestTerrain: TerrainProfile = {
  heightAt: ridgeDrivingHeight,
  groundAt: terrainHeight,
  mountainAt: (x, z) => mountainHeight(x, z) + ridgeMountainHeight(x, z),
  coastAt: () => 0,
  samples: routeSamples,
  tropical: false,
};

export function createTerrainGeometry(heightAt = terrainHeight) {
  const geometry = new THREE.PlaneGeometry(
    terrainSize,
    terrainSize,
    terrainSegments,
    terrainSegments,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();
  return geometry;
}

export function createTerrain(
  profile = forestTerrain,
  time = new THREE.Uniform(0),
) {
  const geometry = createTerrainGeometry(profile.groundAt ?? profile.heightAt);

  // Painting the road on the terrain makes it follow every hill without overlapping meshes.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4096;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the terrain texture');
  const pixelsPerMeter = canvas.width / terrainSize;
  // Bake the beach into the ground texture, keeping the road on the same surface.
  const base = document.createElement('canvas');
  base.width = base.height = 256;
  const baseContext = base.getContext('2d')!;
  const pixels = baseContext.createImageData(base.width, base.height);
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const coast = profile.coastAt(
        (x / (base.width - 1) - 0.5) * terrainSize,
        (y / (base.height - 1) - 0.5) * terrainSize,
      );
      const beach = THREE.MathUtils.smoothstep(coast, 0.035, 0.23);
      const offset = (y * base.width + x) * 4;
      pixels.data[offset] = THREE.MathUtils.lerp(
        profile.tropical ? 106 : 145,
        profile.tropical ? 248 : 226,
        beach,
      );
      pixels.data[offset + 1] = THREE.MathUtils.lerp(
        profile.tropical ? 158 : 174,
        profile.tropical ? 229 : 208,
        beach,
      );
      pixels.data[offset + 2] = THREE.MathUtils.lerp(
        profile.tropical ? 76 : 112,
        profile.tropical ? 180 : 163,
        beach,
      );
      const mountain = profile.mountainAt(
        (x / (base.width - 1) - 0.5) * terrainSize,
        (y / (base.height - 1) - 0.5) * terrainSize,
      );
      const rock = THREE.MathUtils.smoothstep(mountain, 4, 10);
      const summit = THREE.MathUtils.smoothstep(mountain, 13, 18);
      (profile.tropical ? [132, 125, 112] : [139, 148, 140]).forEach(
        (channel, i) => {
          const stone = THREE.MathUtils.lerp(
            channel,
            profile.tropical ? channel + 10 : 218,
            summit,
          );
          pixels.data[offset + i] = THREE.MathUtils.lerp(
            pixels.data[offset + i],
            stone,
            rock,
          );
        },
      );
      if (profile.tropical) {
        const worldX = (x / (base.width - 1) - 0.5) * terrainSize;
        const worldZ = (y / (base.height - 1) - 0.5) * terrainSize;
        const mottling =
          Math.sin(worldX * 0.22 + Math.cos(worldZ * 0.17)) *
          Math.cos(worldZ * 0.28 - worldX * 0.07);
        const wetSand = THREE.MathUtils.smoothstep(coast, 0.7, 1) * 13;
        for (let channel = 0; channel < 3; channel++)
          pixels.data[offset + channel] +=
            mottling * (beach > 0.8 ? 4 : 8) - wetSand;
      } else {
        const channels = ridgeGroundColor(
          (x / (base.width - 1) - 0.5) * terrainSize,
          (y / (base.height - 1) - 0.5) * terrainSize,
          mountain,
        );
        channels.forEach((value, i) => {
          const bank =
            1 -
            THREE.MathUtils.smoothstep(
              riverDistance(
                (x / (base.width - 1) - 0.5) * terrainSize,
                (y / (base.height - 1) - 0.5) * terrainSize,
              ),
              0.3,
              2.8,
            );
          pixels.data[offset + i] = THREE.MathUtils.lerp(
            value,
            [156, 152, 113][i],
            bank,
          );
        });
      }
      pixels.data[offset + 3] = 255;
    }
  }
  baseContext.putImageData(pixels, 0, 0);
  context.drawImage(base, 0, 0, canvas.width, canvas.height);
  context.lineJoin = context.lineCap = 'round';
  context.beginPath();
  profile.samples.forEach((p, i) => {
    const x = (p.x + terrainSize / 2) * pixelsPerMeter;
    const y = (p.z + terrainSize / 2) * pixelsPerMeter;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = profile.tropical ? '#ecd5a4' : '#a7af79';
  context.lineWidth = (roadWidth + 0.8) * pixelsPerMeter;
  context.stroke();
  context.strokeStyle = profile.tropical ? '#f5dfb3' : '#d9c49a';
  context.lineWidth = roadWidth * pixelsPerMeter;
  context.stroke();
  if (profile === forestTerrain) {
    // Widen the approaches partway toward the deck width, then taper into the trail.
    // Use the same route normals as the driving line so the curved approaches agree.
    const edges = profile.samples.slice(0, -1).map((p, i, samples) => {
      const before = samples[(i + samples.length - 1) % samples.length];
      const after = samples[(i + 1) % samples.length];
      const tangent = after.clone().sub(before).normalize();
      const { along, across } = bridgeCoordinates(p.x, p.z);
      const blend =
        Math.abs(across) < 8
          ? 1 -
            THREE.MathUtils.smoothstep(
              Math.abs(along),
              bridge.halfLength + 1,
              bridge.halfLength + 9,
            )
          : 0;
      return {
        p,
        tangent,
        width: THREE.MathUtils.lerp(
          roadWidth / 2,
          bridge.halfWidth - 0.45,
          blend,
        ),
      };
    });
    for (const shoulder of [0.4, 0]) {
      context.beginPath();
      for (const side of [-1, 1]) {
        edges.forEach(({ p, tangent, width }, i) => {
          const x =
            (p.x + tangent.z * (width + shoulder) * side + terrainSize / 2) *
            pixelsPerMeter;
          const z =
            (p.z - tangent.x * (width + shoulder) * side + terrainSize / 2) *
            pixelsPerMeter;
          if (i === 0) context.moveTo(x, z);
          else context.lineTo(x, z);
        });
        context.closePath();
      }
      context.fillStyle = shoulder ? '#a7af79' : '#d9c49a';
      context.fill('evenodd');
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      flatShading: true,
    }),
  );
  if (profile.tropical) {
    terrain.material.onBeforeCompile = (shader) => {
      // Smooth shadow-map stair steps on the ground without softening the palms.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <shadowmap_pars_fragment>',
        THREE.ShaderChunk.shadowmap_pars_fragment.replace(
          'float radius = shadowRadius * texelSize.x;',
          'float radius = max(shadowRadius, 2.0) * texelSize.x;',
        ),
      );
      shader.uniforms.waterTime = time;
      shader.uniforms.restingSeaLevel = new THREE.Uniform(seaLevel);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 sandPosition;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          sandPosition = position;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float waterTime;
          uniform float restingSeaLevel;
          varying vec3 sandPosition;
          ${shorelineSwellShader}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float heightAboveSea = sandPosition.y - restingSeaLevel;
          float phase = shorelinePhase(sandPosition.xz, waterTime);
          float reach = 1.0 - smoothstep(0.51, 0.56, heightAboveSea);
          // The last falling crossing tells us how long this patch has been
          // exposed. Keep it damp after the wave recedes, then dry gradually.
          float threshold = clamp(heightAboveSea / 0.55, -1.0, 1.0);
          float retreatPhase = 3.14159265 - asin(threshold);
          float exposedFor = mod(phase - retreatPhase, 6.2831853) / 0.8;
          float wetSand = reach * (sin(phase) >= threshold
            ? 1.0 : exp(-exposedFor / 4.0));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.53, 0.49), wetSand);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.46, wetSand);`,
        );
    };
  }
  terrain.receiveShadow = true;
  return terrain;
}

export function createOcean(
  profile = forestTerrain,
  time = new THREE.Uniform(0),
  boatMask = createBoatWaterMask(),
) {
  const geometry = new THREE.PlaneGeometry(800, 800, 200, 200);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new THREE.Float32BufferAttribute(positions.count * 3, 3);
  const waveStrength = new THREE.Float32BufferAttribute(positions.count, 1);
  const waterDepth = new THREE.Float32BufferAttribute(positions.count, 1);
  const shallow = new THREE.Color(profile.tropical ? '#70e7d6' : '#80c9ba');
  const deep = new THREE.Color(profile.tropical ? '#2388b7' : '#337d98');
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const depth =
      seaLevel - profile.heightAt(positions.getX(i), positions.getZ(i));
    color.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(depth, 0, 6));
    colors.setXYZ(i, color.r, color.g, color.b);
    waveStrength.setX(i, THREE.MathUtils.smoothstep(depth, 0, 2));
    waterDepth.setX(i, depth);
  }
  geometry.setAttribute('color', colors);
  geometry.setAttribute('waveStrength', waveStrength);
  geometry.setAttribute('waterDepth', waterDepth);
  const ocean = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.12,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  // Coastal swells lift the actual surface through the beach slope. The smaller
  // offshore ripples and the gameplay flooding threshold retain their tuning.
  ocean.material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.boatWaterMaskActive = boatMask.active;
    shader.uniforms.waterWorldToBoat = boatMask.inverse;
    shader.uniforms.boatHullPlanes = boatMask.planes;
    shader.uniforms.coastalMotion = new THREE.Uniform(profile.tropical ? 1 : 0);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float waterTime;
        uniform float coastalMotion;
        attribute float waveStrength;
        attribute float waterDepth;
        varying vec3 waterWorldPosition;
        varying vec2 waterPosition;
        varying float waterMotion;
        ${shorelineSwellShader}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float swellA = dot(position.xz, vec2(0.45, 0.21)) - waterTime * 0.65;
        float swellB = dot(position.xz, vec2(-0.28, 0.52)) - waterTime * 0.47;
        vec2 slope = waveStrength * (
          0.055 * cos(swellA) * vec2(0.45, 0.21) +
          0.028 * cos(swellB) * vec2(-0.28, 0.52));
        float coastalHeight = coastalMotion * shorelineSwell(position.xz, waterDepth, waterTime);
        slope += coastalMotion * vec2(
          shorelineSwell(position.xz + vec2(0.5, 0.0), waterDepth, waterTime)
            - shorelineSwell(position.xz - vec2(0.5, 0.0), waterDepth, waterTime),
          shorelineSwell(position.xz + vec2(0.0, 0.5), waterDepth, waterTime)
            - shorelineSwell(position.xz - vec2(0.0, 0.5), waterDepth, waterTime));
        objectNormal = normalize(vec3(-slope.x, 1.0, -slope.y));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.y += coastalHeight + smallWaterRipples(position.xz, waterDepth, waterTime);
        waterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        waterPosition = position.xz;
        waterMotion = waveStrength;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float waterTime;
        varying vec3 waterWorldPosition;
        varying vec2 waterPosition;
        varying float waterMotion;
        ${boatWaterMaskShader}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (insideBoatHull(waterWorldPosition)) discard;
        float ripple = sin(dot(waterPosition, vec2(0.58, 0.27)) - waterTime * 0.65)
          * sin(dot(waterPosition, vec2(-0.19, 0.43)) - waterTime * 0.38);
        diffuseColor.rgb *= 1.0 + 0.035 * ripple * waterMotion;`,
      );
  };
  ocean.name = 'Ocean';
  ocean.position.y = seaLevel;
  return ocean;
}
