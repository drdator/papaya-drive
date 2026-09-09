import * as THREE from 'three';

export function ridgeCentralHeight(x: number, z: number) {
  const dx = x + 15,
    dz = z + 5;
  // Keep the original footprint so the trail and its shoulders stay clear.
  const radius = Math.hypot((dx + 0.22 * dz) / 11.5, dz / 10);
  const footprint = Math.max(
    0,
    1 - radius ** 2 * (1 + 0.2 * Math.tanh((dx - dz) / 6)),
  );
  const shortRadius = Math.hypot(x + 8, z - 1) / 10;
  const shortFootprint = Math.max(0, 1 - shortRadius);
  if (footprint === 0 && shortFootprint === 0) return 0;
  const gully = (line: number, width: number) =>
    Math.exp(-((line / width) ** 2));
  // A leaning crest with a broad western shoulder and a cut into its eastern face.
  let tall =
    27 * footprint ** 1.65 * (1 - 0.14 * Math.tanh((dx + dz * 0.65) / 3.5));
  tall = Math.min(
    tall,
    21.4 + dx * 0.22 - dz * 0.1 + 0.45 * Math.sin(dx * 0.65),
  );
  tall -=
    footprint *
    (3.5 *
      gully(dx - 0.5 * dz - 3, 1.5) *
      THREE.MathUtils.smoothstep(dz, -5, 3) +
      2.4 *
        gully(dz + 0.65 * dx + 3, 1.25) *
        THREE.MathUtils.smoothstep(dx, -5, 1));
  // Broad, offset strata break up the slopes into ledges instead of a smooth cone.
  const ledges =
    (1 - THREE.MathUtils.smoothstep(tall, 17, 23)) *
    THREE.MathUtils.smoothstep(tall, 1, 5);
  tall +=
    ledges *
    (0.85 * Math.sin(tall * 0.94 + dx * 0.18) +
      0.4 * Math.sin(dz * 0.8 - dx * 0.45));
  const short =
    15 *
    shortFootprint ** 1.35 *
    (1 + 0.16 * Math.tanh((x + 8 - (z - 1) * 0.8) / 3));
  const joined = Math.max(tall, short) + Math.min(tall, short) * 0.18;
  return Math.max(0, joined);
}

export function createCentralRockDetails(
  heightAt: (x: number, z: number) => number,
  distanceToRoad: (x: number, z: number) => number,
) {
  const group = new THREE.Group();
  group.name = 'Central mountain outcrops';
  const materials = ['#909286', '#a49d88', '#7f887f'].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        flatShading: true,
      }),
  );
  const formations = [
    [-23, -7, 2.2, 3.1, 1.5],
    [-24, -3, 1.8, 2.4, 1.4],
    [-22, 1, 2.5, 2.2, 1.7],
    [-18, 5, 2.8, 1.7, 1.6],
    [-14, 7.5, 1.6, 2.1, 1.2],
    [-10, 9, 2.2, 1.4, 1.5],
    [-4, 6, 1.8, 2.8, 1.3],
    [-2, 2, 1.2, 1.7, 1],
    [-6, -6, 1.4, 2.8, 1.2],
    [-17, -12, 2.2, 2.5, 1.4],
    [-22, -11, 1.5, 1.3, 1],
  ];
  formations.forEach(([startX, startZ, rx, ry, rz], i) => {
    let x = startX,
      z = startZ;
    const outward = new THREE.Vector2(x + 12, z + 2).normalize();
    // Seat the loose formations at the foot, rather than on steep cliff faces.
    for (let step = 0; step < 16 && ridgeCentralHeight(x, z) > 1.8; step++) {
      x += outward.x * 0.5;
      z += outward.y * 0.5;
    }
    if (distanceToRoad(x, z) < 6 + Math.max(rx, rz)) return;
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const vertices = geometry.getAttribute('position');
    for (let v = 0; v < vertices.count; v++) {
      const px = vertices.getX(v),
        py = vertices.getY(v),
        pz = vertices.getZ(v);
      const uneven = 1 + 0.12 * Math.sin(px * 7 + py * 4 + pz * 3 + i * 2);
      vertices.setXYZ(v, px * uneven, py * uneven, pz * uneven);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials[i % materials.length]);
    mesh.name = 'Weathered mountain outcrop';
    mesh.scale.set(rx, ry, rz);
    mesh.rotation.y = i * 2.37;
    const foot = Math.min(
      heightAt(x, z),
      heightAt(x - rx * 0.65, z),
      heightAt(x + rx * 0.65, z),
      heightAt(x, z - rz * 0.65),
      heightAt(x, z + rz * 0.65),
    );
    mesh.position.set(x, foot + ry * 0.15, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    // A few fragments collect at the foot of each formation, with different gaps.
    for (let j = 0; j < (i % 3) + 1; j++) {
      const angle = i * 1.7 + j * 2.4;
      const px = x + Math.cos(angle) * (rx + 0.7 + j * 0.5),
        pz = z + Math.sin(angle) * (rz + 0.5 + j * 0.3);
      if (distanceToRoad(px, pz) < 6.7) continue;
      if (
        Math.hypot(
          heightAt(px + 0.5, pz) - heightAt(px - 0.5, pz),
          heightAt(px, pz + 0.5) - heightAt(px, pz - 0.5),
        ) > 1.2
      )
        continue;
      const size = 0.3 + 0.17 * ((i + j) % 3);
      const fragment = new THREE.Mesh(
        geometry,
        materials[(i + j) % materials.length],
      );
      fragment.name = 'Mountain scree';
      fragment.scale.set(size * 1.2, size * 0.65, size);
      fragment.rotation.set(i * 0.3, j + i, 0.2);
      fragment.position.set(px, heightAt(px, pz) + size * 0.12, pz);
      fragment.castShadow = fragment.receiveShadow = true;
      group.add(fragment);
    }
  });
  return group;
}

// Overlapping, offset ridges leave openings and saddles around the driving valley.
const peaks = [
  [-112, -72, 62, 45, 78, -0.35],
  [-24, -125, 60, 45, 92, 0.3],
  [74, -114, 52, 61, 108, -0.45],
  [126, -25, 43, 67, 83, 0.2],
  [119, 88, 60, 49, 74, -0.4],
  [18, 135, 67, 46, 96, 0.3],
  [-84, 112, 59, 50, 82, -0.25],
  [-131, 27, 48, 65, 91, 0.4],
  [-180, -190, 100, 75, 146, 0.4],
  [96, -230, 105, 81, 170, -0.3],
  [236, 78, 83, 109, 138, 0.3],
  [-107, 243, 121, 77, 153, -0.4],
];

export function ridgeMountainHeight(x: number, z: number) {
  const distance = Math.hypot(x, z);
  const valley = THREE.MathUtils.smoothstep(distance, 68, 94);
  if (valley === 0) return 0;
  let highest = 0,
    second = 0;
  for (const [cx, cz, rx, rz, height, lean] of peaks) {
    const dx = x - cx + (z - cz) * lean;
    const dz = z - cz;
    const radius = Math.hypot(dx / rx, dz / rz);
    const ribs =
      1 +
      0.09 * Math.sin(dx * 0.13 + dz * 0.08) +
      0.045 * Math.cos(dz * 0.23 - dx * 0.07);
    const scale = Math.hypot(cx, cz) < 180 ? 0.76 : 1;
    const peak = height * scale * Math.max(0, 1 - radius ** 1.7) ** 1.35 * ribs;
    if (peak > highest) {
      second = highest;
      highest = peak;
    } else second = Math.max(second, peak);
  }
  const foothills = 9 + 5 * Math.sin(x * 0.021 + z * 0.014) ** 2;
  return valley * (foothills + highest + second * 0.18);
}

export function ridgeGroundColor(x: number, z: number, mountain: number) {
  const outer = THREE.MathUtils.smoothstep(Math.hypot(x, z), 68, 100);
  if (outer === 0 && mountain > 0) {
    const slope =
      Math.hypot(
        ridgeCentralHeight(x + 0.7, z) - ridgeCentralHeight(x - 0.7, z),
        ridgeCentralHeight(x, z + 0.7) - ridgeCentralHeight(x, z - 0.7),
      ) / 1.4;
    const rock =
      THREE.MathUtils.smoothstep(mountain, 0.8, 5) *
      Math.max(
        THREE.MathUtils.lerp(
          0.45,
          1,
          THREE.MathUtils.smoothstep(slope, 0.7, 1.9),
        ),
        THREE.MathUtils.smoothstep(mountain, 15, 21) * 0.9,
      );
    const altitude = THREE.MathUtils.smoothstep(mountain, 3, 24);
    const weathering =
      5 * Math.sin(x * 0.55 + z * 0.2) + 3 * Math.cos(z * 0.7 - x * 0.3);
    return [145, 174, 112].map((grass, i) =>
      THREE.MathUtils.lerp(
        grass,
        THREE.MathUtils.lerp([111, 120, 122][i], [193, 180, 154][i], altitude) +
          weathering,
        rock,
      ),
    );
  }
  const rock = THREE.MathUtils.smoothstep(
    mountain,
    THREE.MathUtils.lerp(4, 20, outer),
    THREE.MathUtils.lerp(10, 44, outer),
  );
  const summit = THREE.MathUtils.smoothstep(
    mountain,
    THREE.MathUtils.lerp(13, 75, outer),
    THREE.MathUtils.lerp(18, 125, outer),
  );
  const mottling = outer * 4 * Math.sin(x * 0.13) * Math.cos(z * 0.11);
  return [145, 174, 112].map((grass, i) => {
    const stone = THREE.MathUtils.lerp([139, 148, 140][i], 218, summit);
    return THREE.MathUtils.lerp(grass, stone, rock) + mottling;
  });
}

export function createRidgeBackdrop(
  heightAt: (x: number, z: number) => number,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  // Continue the central terrain at its exact square boundary, using larger
  // facets for the distant mountains. The same surface supplies collision.
  function vertex(x: number, z: number) {
    positions.push(x, heightAt(x, z), z);
    const [r, g, b] = ridgeGroundColor(x, z, ridgeMountainHeight(x, z));
    color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
  }
  for (let z = -450; z < 450; z += 10) {
    for (let x = -450; x < 450; x += 10) {
      if (x >= -150 && x < 150 && z >= -150 && z < 150) continue;
      const nextX = x + 10,
        nextZ = z + 10;
      const border =
        ((x === -160 || x === 150) && z >= -150 && z < 150) ||
        ((z === -160 || z === 150) && x >= -150 && x < 150);
      if (border) {
        // Only the innermost edge needs the terrain's 1.25 m spacing. Fan
        // these border cells out into the regular facets of the distant mesh.
        const corners = [
          [x, z],
          [x, nextZ],
          [nextX, nextZ],
          [nextX, z],
        ];
        for (let edge = 0; edge < 4; edge++) {
          const [ax, az] = corners[edge],
            [bx, bz] = corners[(edge + 1) % 4];
          const innerEdge =
            (ax === bx && Math.abs(ax) === 150) ||
            (az === bz && Math.abs(az) === 150);
          const steps = innerEdge ? 8 : 1;
          for (let i = 0; i < steps; i++) {
            vertex(x + 5, z + 5);
            vertex(
              THREE.MathUtils.lerp(ax, bx, i / steps),
              THREE.MathUtils.lerp(az, bz, i / steps),
            );
            vertex(
              THREE.MathUtils.lerp(ax, bx, (i + 1) / steps),
              THREE.MathUtils.lerp(az, bz, (i + 1) / steps),
            );
          }
        }
        continue;
      }
      vertex(x, z);
      vertex(x, nextZ);
      vertex(nextX, z);
      vertex(nextX, z);
      vertex(x, nextZ);
      vertex(nextX, nextZ);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      flatShading: true,
    }),
  );
  mesh.name = 'Outer mountain ranges';
  mesh.receiveShadow = true;
  return mesh;
}
