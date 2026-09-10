import * as THREE from 'three';

// Six tapered blades per tuft, batched into one mesh for each map.
export function createGrass(
  heightAt: (x: number, z: number) => number,
  random: () => number,
) {
  const grassPositions: number[] = [],
    grassColors: number[] = [];
  const rootColor = new THREE.Color('#657f3f');
  const tipColor = new THREE.Color('#b1b96b');
  const color = new THREE.Color();
  function addTuft(x: number, z: number) {
    const y = heightAt(x, z);
    const size = 0.65 + random() * 0.75;
    const shade = 0.93 + random() * 0.12;
    for (let blade = 0; blade < 6; blade++) {
      const angle = random() * Math.PI * 2;
      const height = (0.35 + random() * 0.4) * size;
      const width = (0.045 + random() * 0.04) * size;
      const lean = (0.15 + random() * 0.25) * size;
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      const bx = x + (random() - 0.5) * 0.2,
        bz = z + (random() - 0.5) * 0.2;
      const base = heightAt(bx, bz) - 0.035;
      const points = [
        [bx - dz * width, base, bz + dx * width],
        [bx + dz * width, base, bz - dx * width],
        [
          bx + dx * lean * 0.3 - dz * width * 0.65,
          y + height * 0.58,
          bz + dz * lean * 0.3 + dx * width * 0.65,
        ],
        [
          bx + dx * lean * 0.3 + dz * width * 0.65,
          y + height * 0.58,
          bz + dz * lean * 0.3 - dx * width * 0.65,
        ],
        [bx + dx * lean, y + height, bz + dz * lean],
      ];
      for (const index of [0, 1, 2, 1, 3, 2, 2, 3, 4]) {
        grassPositions.push(...points[index]);
        color
          .copy(rootColor)
          .lerp(tipColor, index === 4 ? 0.8 : index >= 2 ? 0.3 : 0)
          .multiplyScalar(shade);
        grassColors.push(color.r, color.g, color.b);
      }
    }
  }
  function build(name: string) {
    const grassGeometry = new THREE.BufferGeometry();
    grassGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(grassPositions, 3),
    );
    grassGeometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(grassColors, 3),
    );
    grassGeometry.computeVertexNormals();
    const grass = new THREE.Mesh(
      grassGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
    );
    grass.name = name;
    grass.castShadow = grass.receiveShadow = true;
    grass.userData.cameraCollision = false;
    return grass;
  }
  return { addTuft, build };
}
