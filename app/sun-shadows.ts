import * as THREE from 'three';

// Keep Three's PCF disk radius and noise rotation, but sample it more densely.
// Terrain's separate radius adjustment still applies to this shared chunk.
const pcfSamples = Array.from(
  { length: 9 },
  (_, i) =>
    `texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( ${i}, 9, phi ) * radius, shadowCoord.z ) )`,
).join(' +\n');
const fiveSampleFilter =
  /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \)[\s\S]*?\) \* 0\.2;/;

export const sunShadowFragment = THREE.ShaderChunk.shadowmap_pars_fragment
  .replace(fiveSampleFilter, `shadow = ( ${pcfSamples} ) / 9.0;`)
  .replace(
    '5 samples using Vogel disk + IGN = effectively 20 filtered taps with better distribution',
    '9 samples using Vogel disk + IGN = effectively 36 filtered taps',
  );

export function createSunShadowTracking(sun: THREE.DirectionalLight) {
  const offset = sun.position.clone().sub(sun.target.position);
  const camera = sun.shadow.camera;
  const lightRotation = new THREE.Matrix4().lookAt(
    offset,
    new THREE.Vector3(),
    camera.up,
  );
  const inverseRotation = lightRotation.clone().transpose();
  const center = new THREE.Vector3();

  return (target: THREE.Vector3) => {
    // Snap in the light's image plane, not world X/Z. Keep depth continuous
    // and move light + target together so the sun direction never changes.
    const texelWidth = (camera.right - camera.left) / sun.shadow.mapSize.x;
    const texelHeight = (camera.top - camera.bottom) / sun.shadow.mapSize.y;
    center.copy(target).applyMatrix4(inverseRotation);
    center.x = Math.round(center.x / texelWidth) * texelWidth;
    center.y = Math.round(center.y / texelHeight) * texelHeight;
    center.applyMatrix4(lightRotation);
    sun.target.position.copy(center);
    sun.position.copy(center).add(offset);
  };
}
