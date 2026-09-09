import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;
export const bridge = {
  x: 22,
  z: 29,
  angle: 0.14,
  halfLength: 10,
  halfWidth: 4.7,
};
export const riverCenter = (z: number) =>
  18 + 5 * Math.sin(z * 0.055) + 1.2 * Math.sin(z * 0.18);
export const riverLevel = (z: number) => 1.15 - (z + 4) * 0.014;

// A winding channel ending in a small pool; signed distance also shapes its banks.
export function riverDistance(x: number, z: number) {
  const along = THREE.MathUtils.clamp(z, -3, 58);
  const stream =
    Math.hypot(x - riverCenter(along), z - along) -
    (2.35 + 0.3 * Math.sin(along * 0.21));
  const pool = (Math.hypot((x - 16.8) / 7, (z - 62) / 10) - 1) * 7;
  return Math.min(stream, pool);
}

export function carveRiver(x: number, z: number, height: number) {
  const distance = riverDistance(x, z);
  if (distance >= 4.5) return height;
  const bed = riverLevel(z) + Math.max(-1.8, distance) * 0.65;
  return Math.min(
    height,
    THREE.MathUtils.lerp(bed, height, smooth(distance, 0, 4.5)),
  );
}

export function bridgeCoordinates(x: number, z: number) {
  const dx = x - bridge.x,
    dz = z - bridge.z;
  return {
    along: dx * Math.cos(bridge.angle) - dz * Math.sin(bridge.angle),
    across: dx * Math.sin(bridge.angle) + dz * Math.cos(bridge.angle),
  };
}

export function bridgePoint(along: number, across: number) {
  return new THREE.Vector3(
    bridge.x + along * Math.cos(bridge.angle) + across * Math.sin(bridge.angle),
    0,
    bridge.z - along * Math.sin(bridge.angle) + across * Math.cos(bridge.angle),
  );
}

export function bridgeHeight(
  along: number,
  baseHeight: (x: number, z: number) => number,
) {
  const start = bridgePoint(-bridge.halfLength, 0),
    end = bridgePoint(bridge.halfLength, 0);
  const t = THREE.MathUtils.clamp(
    (along + bridge.halfLength) / (2 * bridge.halfLength),
    0,
    1,
  );
  return (
    THREE.MathUtils.lerp(
      baseHeight(start.x, start.z),
      baseHeight(end.x, end.z),
      t,
    ) +
    Math.sin(t * Math.PI) * 0.24
  );
}

export function bridgeApproach(
  x: number,
  z: number,
  ground: number,
  baseHeight: (x: number, z: number) => number,
) {
  const { along, across } = bridgeCoordinates(x, z);
  // Level the two landings across the road, blending back into the original hills.
  const weight =
    (1 - smooth(Math.abs(along), 10, 15)) *
    (1 - smooth(Math.abs(across), 4.7, 7));
  return THREE.MathUtils.lerp(ground, bridgeHeight(along, baseHeight), weight);
}

export function createRidgeRiver(
  baseHeight: (x: number, z: number) => number,
  groundHeight: (x: number, z: number) => number,
  time: THREE.Uniform<number>,
) {
  const group = new THREE.Group();
  group.name = 'Ridge river';
  const solids = new THREE.Group();
  solids.name = 'Timber bridge and river stones';
  group.add(solids);
  const positions: number[] = [];
  const vertex = (x: number, z: number) => ({ x, z, d: riverDistance(x, z) });
  // Clip small triangles at the shoreline, avoiding rectangular water edges.
  function triangle(points: ReturnType<typeof vertex>[]) {
    const clipped: ReturnType<typeof vertex>[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (a.d <= 0) clipped.push(a);
      if (a.d < 0 !== b.d < 0) {
        const t = a.d / (a.d - b.d);
        clipped.push(
          vertex(
            THREE.MathUtils.lerp(a.x, b.x, t),
            THREE.MathUtils.lerp(a.z, b.z, t),
          ),
        );
      }
    }
    for (let i = 1; i < clipped.length - 1; i++) {
      for (const p of [clipped[0], clipped[i], clipped[i + 1]])
        positions.push(p.x, riverLevel(p.z), p.z);
    }
  }
  for (let z = -7; z < 73; z++)
    for (let x = 8; x < 29; x++) {
      triangle([vertex(x, z), vertex(x, z + 1), vertex(x + 1, z)]);
      triangle([vertex(x + 1, z), vertex(x, z + 1), vertex(x + 1, z + 1)]);
    }
  const waterGeometry = new THREE.BufferGeometry();
  waterGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  waterGeometry.computeVertexNormals();
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: '#589c9b',
    roughness: 0.32,
    metalness: 0.12,
  });
  waterMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.riverTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 riverPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nriverPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float riverTime;\nvarying vec3 riverPosition;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      float flow = riverPosition.z * 3.2 - riverTime * 1.7 + sin(riverPosition.x * 2.7 + sin(riverPosition.z * 0.8));
      float ripple = smoothstep(0.94, 1.0, sin(flow)) * (0.5 + 0.5 * sin(riverPosition.x * 3.1 + riverPosition.z * 0.6));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.67, 0.84, 0.78), ripple * 0.075);`,
      );
  };
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.name = 'Flowing river water';
  water.receiveShadow = true;
  group.add(water);

  const wood = new THREE.MeshStandardMaterial({
    color: '#96704a',
    roughness: 0.95,
  });
  const railWood = new THREE.MeshStandardMaterial({
    color: '#796047',
    roughness: 1,
  });
  const stone = new THREE.MeshStandardMaterial({
    color: '#8f968b',
    roughness: 1,
    flatShading: true,
  });
  function beam(
    name: string,
    a: THREE.Vector3,
    b: THREE.Vector3,
    width: number,
    depth: number,
    material = railWood,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, a.distanceTo(b), depth),
      material,
    );
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    solids.add(mesh);
  }
  const deckPositions: number[] = [],
    deckColors: number[] = [];
  const color = new THREE.Color();
  for (let i = 0; i < 40; i++) {
    const a = -10 + i * 0.5,
      b = a + 0.5;
    const corners = [
      bridgePoint(a, -4.7),
      bridgePoint(a, 4.7),
      bridgePoint(b, 4.7),
      bridgePoint(b, -4.7),
    ];
    corners.forEach((p, j) => (p.y = bridgeHeight(j < 2 ? a : b, baseHeight)));
    const lower = corners.map((p) =>
      p.clone().add(new THREE.Vector3(0, -0.26, 0)),
    );
    const vertices = [...corners, ...lower];
    color.setScalar(0.96 + 0.035 * Math.sin(i * 17.31));
    for (const index of [
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0,
      3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
    ]) {
      deckPositions.push(...vertices[index].toArray());
      deckColors.push(color.r, color.g, color.b);
    }
    // Fine recessed seams read as planks without uneven tire contact.
    const seamA = corners[0].clone(),
      seamB = corners[1].clone();
    seamA.y += 0.025;
    seamB.y += 0.025;
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.006, 9.4),
      railWood,
    );
    seam.position.copy(seamA).add(seamB).multiplyScalar(0.5);
    seam.rotation.y = bridge.angle;
    group.add(seam);
  }
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(deckPositions, 3),
  );
  deckGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(deckColors, 3),
  );
  deckGeometry.computeVertexNormals();
  wood.vertexColors = true;
  const deck = new THREE.Mesh(deckGeometry, wood);
  deck.name = 'Bridge deck';
  deck.castShadow = deck.receiveShadow = true;
  solids.add(deck);
  for (const side of [-1, 1]) {
    for (let u = -10; u <= 10; u += 2.5) {
      const a = bridgePoint(u, side * 4.85);
      a.y = bridgeHeight(u, baseHeight) - 0.25;
      beam(
        'Bridge post',
        a,
        a.clone().add(new THREE.Vector3(0, 1.45, 0)),
        0.2,
        0.2,
      );
      if (u < 10)
        for (const height of [0.48, 1.08]) {
          const b = bridgePoint(u + 2.5, side * 4.85);
          b.y = bridgeHeight(u + 2.5, baseHeight) + height;
          const c = a.clone();
          c.y = bridgeHeight(u, baseHeight) + height;
          if (side === 1 && u === 0 && height === 1.08) {
            const leftBreak = c.clone().lerp(b, 0.43);
            leftBreak.y -= 0.38;
            const rightBreak = c.clone().lerp(b, 0.76);
            rightBreak.y -= 0.08;
            beam('Broken upper rail', c, leftBreak, 0.15, 0.16);
            beam('Broken upper rail', rightBreak, b, 0.15, 0.16);
          } else beam('Bridge rail', c, b, 0.15, 0.16);
        }
    }
    const a = bridgePoint(-10, side * 3.7),
      b = bridgePoint(10, side * 3.7);
    a.y = bridgeHeight(-10, baseHeight) - 0.5;
    b.y = bridgeHeight(10, baseHeight) - 0.5;
    beam('Under-deck timber', a, b, 0.32, 0.5);
  }
  for (const u of [-9.5, 9.5]) {
    const p = bridgePoint(u, 0);
    const bottom = Math.min(groundHeight(p.x, p.z) - 0.6, riverLevel(p.z));
    const top = bridgeHeight(u, baseHeight) - 0.26;
    const abutment = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, top - bottom, 10),
      stone,
    );
    abutment.name = 'Stone bridge abutment';
    abutment.position.set(p.x, (top + bottom) / 2, p.z);
    abutment.rotation.y = bridge.angle;
    abutment.castShadow = abutment.receiveShadow = true;
    solids.add(abutment);
  }
  for (const [along, across, size] of [
    [10.3, 5.55, 0.55],
    [11.15, 5.25, 0.3],
    [10.7, 6.05, 0.24],
    [9.8, 6.2, 0.18],
  ]) {
    const p = bridgePoint(along, across);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), stone);
    rock.name = 'Railing end stones';
    rock.scale.set(1.15, 0.8, 0.9);
    rock.rotation.set(along, size * 4, across);
    rock.position.set(p.x, groundHeight(p.x, p.z) + size * 0.3, p.z);
    rock.castShadow = rock.receiveShadow = true;
    solids.add(rock);
  }
  let seed = 4271;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  // Uneven clusters leave quiet stretches, without alternating between banks.
  for (let cluster = 0; cluster < 14; cluster++) {
    const centerZ = -2 + random() * 70;
    const side = random() < 0.5 ? -1 : 1;
    const count = 1 + Math.floor(random() * 4);
    for (let i = 0; i < count; i++) {
      const z = centerZ + (random() - 0.5) * 3.8;
      let x = riverCenter(z) + side * 2;
      // Follow the wider pool's shoreline as well as the narrow stream.
      while (riverDistance(x, z) < 0.3) x += side * 0.2;
      x += side * random() * 1.8;
      const local = bridgeCoordinates(x, z);
      if (Math.abs(local.along) < 13 && Math.abs(local.across) < 7) continue;
      const size = 0.22 + random() ** 1.5 * 0.7;
      const rock = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size, 0),
        stone,
      );
      rock.name = 'Riverbank stone';
      rock.scale.set(
        0.8 + random() * 0.7,
        0.5 + random() * 0.5,
        0.7 + random() * 0.6,
      );
      rock.rotation.set(random() * 3, random() * Math.PI * 2, random() * 2);
      rock.position.set(x, groundHeight(x, z) + size * 0.15, z);
      rock.castShadow = rock.receiveShadow = true;
      solids.add(rock);
    }
  }
  for (const [x, z, size] of [
    [15, -5.5, 1.5],
    [17.3, -6.4, 1.7],
    [19.2, -4.8, 1.1],
  ]) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), stone);
    rock.name = 'Rocky spring';
    rock.scale.set(1.2, 0.85, 1);
    rock.rotation.set(x, 0.6, z);
    rock.position.set(x, groundHeight(x, z) + size * 0.3, z);
    rock.castShadow = rock.receiveShadow = true;
    solids.add(rock);
  }
  return { group, solids, deck };
}
