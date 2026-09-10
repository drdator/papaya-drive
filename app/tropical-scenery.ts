import * as THREE from 'three';
import { createGrass } from './grass.ts';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { seaLevel } from './terrain.ts';
import {
  tropicalHeight,
  tropicalRoute,
  tropicalTerrain,
} from './tropical-map.ts';

export function createTropicalScenery(palms: THREE.Object3D[]) {
  const group = new THREE.Group();
  group.name = 'Palm cove shoreline and groves';
  const solids: THREE.Mesh[] = [];
  const trunks: {
    x: number;
    z: number;
    radius: number;
    bottom: number;
    top: number;
  }[] = [];
  let seed = 7351;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const up = new THREE.Vector3(0, 1, 0);
  function clear(x: number, z: number, radius: number, dry = true) {
    return (
      // Leave a quiet patch of beach around the fishing landing and its approach.
      Math.hypot(x - 72, z - 18) > 10 + radius &&
      tropicalRoute.distanceToRoad(x, z) > 6 + radius &&
      tropicalTerrain.mountainAt(x, z) < 5 &&
      (!dry || tropicalHeight(x, z) > seaLevel + 0.7)
    );
  }
  function add(mesh: THREE.Mesh, solid = false) {
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) solids.push(mesh);
  }

  // Four split-stone silhouettes, reused with varied proportions and burial depths.
  const rockShapes = Array.from({ length: 4 }, (_, variant) => {
    const points: THREE.Vector3[] = [];
    for (const [y, radius] of [
      [-0.9, 1],
      [0.1, 1],
      [0.9, 0.55],
    ]) {
      for (let i = 0; i < 7; i++) {
        const a = (i * Math.PI * 2) / 7 + variant * 0.27;
        const r = radius * (0.8 + random() * 0.35);
        points.push(
          new THREE.Vector3(
            Math.cos(a) * r + y * 0.12,
            y + 0.22 * Math.sin(a * 2 + variant),
            Math.sin(a) * r,
          ),
        );
      }
    }
    const geometry = new ConvexGeometry(points);
    const positions = geometry.getAttribute('position');
    const colors = new THREE.Float32BufferAttribute(positions.count * 3, 3);
    for (let i = 0; i < positions.count; i += 3) {
      const shade = 0.86 + random() * 0.14;
      for (let j = 0; j < 3; j++) colors.setXYZ(i + j, shade, shade, shade);
    }
    geometry.setAttribute('color', colors);
    return geometry;
  });
  const stoneColors = ['#a99d8b', '#82868b', '#b9aa91', '#777e78'].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        vertexColors: true,
        roughness: 1,
        flatShading: true,
      }),
  );
  function rock(
    x: number,
    z: number,
    radius: number,
    height: number,
    palette: number,
    submerged = false,
  ) {
    if (!clear(x, z, radius * 1.25, !submerged)) return;
    const mesh = new THREE.Mesh(
      rockShapes[Math.floor(random() * rockShapes.length)],
      stoneColors[palette],
    );
    mesh.name = submerged ? 'Shallow-water outcrop' : 'Beach stone';
    mesh.scale.set(radius, height, radius * (0.6 + random() * 0.35));
    mesh.rotation.y = random() * Math.PI * 2;
    const base = tropicalHeight(x, z);
    mesh.position.set(x, base + height * 0.5, z);
    add(mesh, true);
  }

  const palmVariants = palms.flatMap((palm) =>
    [0.91, 1, 1.06].map((shade) => {
      const model = palm.clone(true);
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        function tint(source: THREE.Material) {
          const material = source.clone();
          if (material instanceof THREE.MeshStandardMaterial)
            material.color.multiplyScalar(shade);
          return material;
        }
        object.material = Array.isArray(object.material)
          ? object.material.map(tint)
          : tint(object.material);
      });
      return model;
    }),
  );
  function palm(x: number, z: number) {
    if (
      !clear(x, z, 1.3) ||
      trunks.some((t) => Math.hypot(t.x - x, t.z - z) < 2.4)
    )
      return;
    const model =
      palmVariants[Math.floor(random() * palmVariants.length)].clone(true);
    const width = 1.3 + random() * 0.8,
      height = 1.5 + random() * 1.5;
    const bottom = tropicalHeight(x, z);
    model.scale.set(width, height, width);
    model.rotation.y = random() * Math.PI * 2;
    model.position.set(x, bottom - 0.12, z);
    group.add(model);
    trunks.push({
      x,
      z,
      radius: 0.16 * width,
      bottom,
      top: bottom + 3.5 * height,
    });
  }

  // Broad waxy leaves add a low layer beneath the palms; these plants are soft scenery.
  const leafVertices: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i * Math.PI * 2) / 9;
    const length = 1.1 + random() * 0.6;
    const points = [
      [0, 0, 0],
      [length * 0.4, 0.7, -0.26],
      [length * 0.43, 0.84, 0],
      [length * 0.4, 0.7, 0.26],
      [length, 0.35, 0],
    ];
    for (const index of [0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]) {
      const [x, y, z] = points[index];
      leafVertices.push(
        x * Math.cos(a) - z * Math.sin(a),
        y,
        x * Math.sin(a) + z * Math.cos(a),
      );
    }
  }
  const leafGeometry = new THREE.BufferGeometry();
  leafGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(leafVertices, 3),
  );
  leafGeometry.computeVertexNormals();
  const leafMaterials = ['#4a8549', '#698f43', '#397861'].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
  );
  function plant(x: number, z: number) {
    if (!clear(x, z, 1.5)) return;
    const mesh = new THREE.Mesh(
      leafGeometry,
      leafMaterials[Math.floor(random() * leafMaterials.length)],
    );
    mesh.name = 'Broad-leaf understory';
    mesh.position.set(x, tropicalHeight(x, z) - 0.06, z);
    mesh.scale.setScalar(0.55 + random() * 0.75);
    mesh.rotation.y = random() * Math.PI * 2;
    add(mesh);
  }
  for (const [cx, cz] of [
    [-34, 5],
    [-30, -19],
    [-20, 29],
    [30, 28],
    [40, -20],
    [0, -31],
  ]) {
    for (let i = 0; i < 9; i++) {
      const a = random() * Math.PI * 2,
        r = random() * 8;
      palm(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
    for (let i = 0; i < 35; i++) {
      const a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * 10;
      plant(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
  }
  for (let i = 0; i < 95; i++)
    palm((random() - 0.5) * 135, (random() - 0.5) * 115);

  function shore(degrees: number) {
    const a = THREE.MathUtils.degToRad(degrees);
    let low = 20,
      high = 115;
    for (let i = 0; i < 18; i++) {
      const r = (low + high) / 2;
      if (tropicalHeight(Math.cos(a) * r, Math.sin(a) * r) > seaLevel) low = r;
      else high = r;
    }
    return new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(
      (low + high) / 2,
    );
  }
  // Alternate quiet beaches with groups of weathered rocks and offshore stacks.
  for (const degrees of [72, 146, 211, 283, 329]) {
    const point = shore(degrees);
    for (let i = 0; i < 7; i++) {
      const x = point.x * 0.94 + (random() - 0.5) * 11;
      const z = point.y * 0.94 + (random() - 0.5) * 11;
      const radius = i === 0 ? 2.7 : 0.6 + random() * 1.4;
      rock(x, z, radius, radius * (0.25 + random() * 0.7), i % 4);
    }
  }
  for (const degrees of [117, 228, 307]) {
    const point = shore(degrees).multiplyScalar(1.12);
    for (let i = 0; i < 3; i++) {
      const x = point.x + (random() - 0.5) * 7,
        z = point.y + (random() - 0.5) * 7;
      const depth = seaLevel - tropicalHeight(x, z);
      rock(
        x,
        z,
        2.5 + random() * 2,
        (depth + 2 + random() * 3) / 1.3,
        i % 2,
        true,
      );
    }
  }

  const bark = new THREE.MeshStandardMaterial({
    color: '#86735a',
    roughness: 1,
    flatShading: true,
  });
  const logGeometry = new THREE.CylinderGeometry(0.23, 0.34, 1, 7);
  const branchGeometry = new THREE.CylinderGeometry(0.08, 0.13, 1, 5);
  for (const degrees of [45, 170, 247, 345]) {
    const point = shore(degrees).multiplyScalar(0.95);
    if (!clear(point.x, point.y, 2.7)) continue;
    const heading = (degrees * Math.PI) / 180 + 1.1;
    const direction = new THREE.Vector3(
      Math.cos(heading),
      0.05,
      Math.sin(heading),
    ).normalize();
    const log = new THREE.Mesh(logGeometry, bark);
    log.name = 'Sun-bleached driftwood';
    log.position.set(point.x, tropicalHeight(point.x, point.y) + 0.22, point.y);
    log.scale.y = 3.7;
    log.quaternion.setFromUnitVectors(up, direction);
    add(log, true);
    const branch = new THREE.Mesh(branchGeometry, bark);
    branch.position.copy(log.position).addScaledVector(direction, 0.6);
    branch.position.y += 0.16;
    branch.scale.y = 1.2;
    branch.quaternion.setFromUnitVectors(
      up,
      new THREE.Vector3(-direction.z, 0.4, direction.x).normalize(),
    );
    add(branch, true);
  }
  // Small, uneven tussocks leave most of the sand open between the groves.
  const grassBuilder = createGrass(tropicalHeight, random);
  for (const [cx, cz] of [
    [-38, 9],
    [-32, -22],
    [-22, 28],
    [25, 31],
    [39, -22],
    [1, -35],
    [-44, -3],
    [-8, 40],
    [42, 12],
  ]) {
    const radius = 2.3 + random() * 2;
    const count = 12 + Math.floor(random() * 13);
    for (let tuft = 0; tuft < count; tuft++) {
      const a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      if (
        !clear(x, z, 0.6) ||
        trunks.some((t) => Math.hypot(t.x - x, t.z - z) < t.radius + 0.35)
      )
        continue;
      const slope = Math.hypot(
        tropicalHeight(x + 0.4, z) - tropicalHeight(x - 0.4, z),
        tropicalHeight(x, z + 0.4) - tropicalHeight(x, z - 0.4),
      );
      if (slope > 0.7) continue;
      grassBuilder.addTuft(x, z);
    }
  }
  add(grassBuilder.build('Sparse island grass'));
  return { group, solids, trunks };
}
