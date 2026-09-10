import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type MushroomPlacement = {
  x: number;
  z: number;
  scale: number;
  rotation: number;
  kind: 'fly-agaric' | 'king-bolete';
};

export function createMushrooms(
  placements: MushroomPlacement[],
  heightAt: (x: number, z: number) => number,
) {
  const cream = '#eee2be';
  function colored(geometry: THREE.BufferGeometry, tint: string) {
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    flat.deleteAttribute('uv');
    const color = new THREE.Color(tint);
    const colors = new Float32Array(flat.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return flat;
  }
  function lathe(points: [number, number][], tint: string) {
    return colored(
      new THREE.LatheGeometry(
        points.map(([x, y]) => new THREE.Vector2(x, y)),
        8,
      ),
      tint,
    );
  }
  function model(kind: MushroomPlacement['kind']) {
    const fly = kind === 'fly-agaric';
    const stem = lathe(
      fly
        ? [
            [0, -0.04],
            [0.12, -0.04],
            [0.1, 0.06],
            [0.065, 0.46],
            [0, 0.46],
          ]
        : [
            [0, -0.04],
            [0.13, -0.04],
            [0.18, 0.09],
            [0.15, 0.28],
            [0.105, 0.45],
            [0, 0.45],
          ],
      fly ? cream : '#d8bf8a',
    );
    const cap = lathe(
      fly
        ? [
            [0.43, 0.42],
            [0.46, 0.46],
            [0.36, 0.6],
            [0.18, 0.71],
            [0, 0.75],
          ]
        : [
            [0.35, 0.36],
            [0.43, 0.41],
            [0.44, 0.49],
            [0.35, 0.62],
            [0.18, 0.69],
            [0, 0.71],
          ],
      fly ? '#c94332' : '#8e5937',
    );
    const underside = colored(
      new THREE.CircleGeometry(fly ? 0.43 : 0.35, 8),
      cream,
    );
    underside.rotateX(Math.PI / 2).translate(0, fly ? 0.42 : 0.36, 0);
    const parts = [stem, cap, underside];
    if (fly) {
      parts.push(
        lathe(
          [
            [0.065, 0.27],
            [0.14, 0.28],
            [0.09, 0.33],
            [0.065, 0.33],
          ],
          cream,
        ),
      );
      // Small pentagonal flecks sit directly on the faceted cap surface.
      const material = new THREE.MeshBasicMaterial();
      const surface = new THREE.Mesh(cap, material);
      const ray = new THREE.Raycaster();
      const up = new THREE.Vector3(0, 0, 1);
      for (let i = 0; i < 8; i++) {
        const angle = i * 2.4;
        const radius = i === 0 ? 0 : i % 2 ? 0.22 : 0.34;
        ray.set(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            1,
            Math.sin(angle) * radius,
          ),
          new THREE.Vector3(0, -1, 0),
        );
        const hit = ray.intersectObject(surface)[0];
        if (!hit?.face) continue;
        const spot = colored(
          new THREE.CircleGeometry(i % 2 ? 0.045 : 0.035, 5),
          cream,
        );
        spot.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(up, hit.face.normal),
        );
        spot.translate(
          ...hit.point.addScaledVector(hit.face.normal, 0.002).toArray(),
        );
        parts.push(spot);
      }
      material.dispose();
    }
    const result = mergeGeometries(parts)!;
    parts.forEach((part) => part.dispose());
    return result;
  }
  const models = {
    'fly-agaric': model('fly-agaric'),
    'king-bolete': model('king-bolete'),
  };
  const instances = placements.map(({ x, z, scale, rotation, kind }) =>
    models[kind]
      .clone()
      .scale(scale, scale, scale)
      .rotateY(rotation)
      .translate(x, heightAt(x, z), z),
  );
  const geometry = mergeGeometries(instances)!;
  instances.forEach((instance) => instance.dispose());
  Object.values(models).forEach((shape) => shape.dispose());
  const mushrooms = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      flatShading: true,
    }),
  );
  mushrooms.name = 'Rare ridge mushrooms';
  mushrooms.castShadow = mushrooms.receiveShadow = true;
  mushrooms.userData.cameraCollision = false;
  return mushrooms;
}
