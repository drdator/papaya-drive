import * as THREE from 'three';

export function createBoatWaterMask() {
  return {
    active: new THREE.Uniform(0),
    inverse: new THREE.Uniform(new THREE.Matrix4()),
    planes: new THREE.Uniform(
      Array.from({ length: 9 }, () => new THREE.Vector3()),
    ),
  };
}

// The rowboat's tapered hull excludes ocean fragments, including below its
// floor. Work in its animated local coordinates so the cutout bobs and tilts
// with the boat without exposing a hole in the surrounding water.
export const boatWaterMaskShader = `
uniform float boatWaterMaskActive;
uniform mat4 waterWorldToBoat;
uniform vec3 boatHullPlanes[9];
bool insideBoatHull(vec3 worldPosition) {
  if (boatWaterMaskActive < 0.5) return false;
  vec3 p = (waterWorldToBoat * vec4(worldPosition, 1.0)).xyz;
  if (p.y < -0.33 || p.y > 0.74) return false;
  float width = mix(0.57, 1.0, clamp((p.y + 0.33) / 1.05, 0.0, 1.0));
  vec2 footprint = p.xz / vec2(width, 0.87 + 0.13 * width);
  for (int i = 0; i < 9; i++) {
    if (dot(boatHullPlanes[i], vec3(footprint, 1.0)) > 0.0) return false;
  }
  return true;
}
`;
