import * as THREE from 'three';
import { terrainHeight } from './terrain';

export function createSkidMarks() {
  const capacity = 2048;
  const positions = new THREE.Float32BufferAttribute(
    new Float32Array(capacity * 18),
    3,
  );
  positions.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: '#62563c',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  const previous = [new THREE.Vector2(), new THREE.Vector2()];
  let connected = false,
    cursor = 0,
    count = 0;
  return {
    mesh,
    reset() {
      connected = false;
      cursor = 0;
      count = 0;
      geometry.setDrawRange(0, 0);
    },
    update(x: number, z: number, heading: number, skidding: boolean) {
      if (!skidding) {
        connected = false;
        return;
      }
      const fx = Math.sin(heading),
        fz = Math.cos(heading);
      for (let tire = 0; tire < 2; tire++) {
        const side = tire === 0 ? -0.84 : 0.84;
        const px = x - fx * 1.12 + fz * side;
        const pz = z - fz * 1.12 - fx * side;
        const last = previous[tire];
        const dx = px - last.x,
          dz = pz - last.y;
        const length = Math.hypot(dx, dz);
        if (connected && length < 1) {
          if (length < 0.12) continue;
          const nx = (-dz / length) * 0.09,
            nz = (dx / length) * 0.09;
          const corners = [
            [last.x + nx, last.y + nz],
            [last.x - nx, last.y - nz],
            [px + nx, pz + nz],
            [px - nx, pz - nz],
          ];
          [0, 1, 2, 1, 3, 2].forEach((corner, vertex) => {
            const [cx, cz] = corners[corner];
            positions.setXYZ(
              cursor * 6 + vertex,
              cx,
              terrainHeight(cx, cz) + 0.045,
              cz,
            );
          });
          cursor = (cursor + 1) % capacity;
          count = Math.min(count + 1, capacity);
          geometry.setDrawRange(0, count * 6);
          positions.needsUpdate = true;
        }
        last.set(px, pz);
      }
      connected = true;
    },
  };
}
