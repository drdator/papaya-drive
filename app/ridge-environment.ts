import * as THREE from 'three';

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
