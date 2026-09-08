import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { createColliderMotion } from './moving-collider.ts';

export const cameraClearance = 0.55;

// Only closed meshes have an inside. Open roofs, leaves, and terrain still
// block camera movement from either side, without treating the space below
// them as a solid volume (which would close the island's arch).
function isClosed(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const vertices = new Map<string, number>();
  const ids: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((v) => Math.round(v * 10000))
      .join(',');
    if (!vertices.has(key)) vertices.set(key, vertices.size);
    ids.push(vertices.get(key)!);
  }
  const indices = geometry.index?.array ?? ids.map((_, i) => i);
  const edges = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [
      ids[indices[i]],
      ids[indices[i + 1]],
      ids[indices[i + 2]],
    ];
    if (new Set(triangle).size < 3) continue;
    for (let j = 0; j < 3; j++) {
      const a = triangle[j],
        b = triangle[(j + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return (
    edges.size > 0 && [...edges.values()].every((count) => count % 2 === 0)
  );
}

// A separate, static query world includes visible scenery details without
// making windows, foliage, or awnings into new vehicle collision obstacles.
// Call after initializeVehiclePhysics(), and build() once after adding scenery.
export function createCameraCollision() {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const shape = new RAPIER.Ball(cameraClearance);
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const skin = 0.025;
  const moving: (() => void)[] = [];
  const closed = new WeakMap<THREE.BufferGeometry, boolean>();
  const position = new THREE.Vector3(),
    remaining = new THREE.Vector3(),
    normal = new THREE.Vector3();

  function separate(point: THREE.Vector3) {
    for (let i = 0; i < 8; i++) {
      let moved = false;
      // Recover a reset/drop whose camera anchor starts inside a building.
      world.intersectionsWithPoint(point, (collider) => {
        const surface = collider.projectPoint(point, false);
        if (!surface) return true;
        normal.copy(surface.point).sub(point);
        if (normal.lengthSq() < 1e-10) return true;
        point
          .copy(surface.point)
          .addScaledVector(normal.normalize(), cameraClearance + skin);
        moved = true;
        return true;
      });
      world.intersectionsWithShape(point, rotation, shape, (collider) => {
        const contact = collider.contactShape(shape, point, rotation, skin);
        if (contact && contact.distance < skin) {
          point.addScaledVector(
            normal.copy(contact.normal1),
            skin - contact.distance,
          );
          moved = true;
        }
        return true;
      });
      if (!moved) break;
    }
  }

  return {
    add(root: THREE.Object3D, animated = false) {
      root.updateWorldMatrix(true, true);
      root.traverseVisible((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          object.name.startsWith('Road_paint')
        )
          return;
        const source = object.geometry;
        if (!closed.has(source)) closed.set(source, isClosed(source));
        const geometry = source.clone().applyMatrix4(object.matrixWorld);
        const positions = geometry.getAttribute('position');
        const indices =
          geometry.index?.array ??
          Array.from({ length: positions.count }, (_, i) => i);
        const collider = world.createCollider(
          RAPIER.ColliderDesc.trimesh(
            Float32Array.from(positions.array),
            Uint32Array.from(indices),
            RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES |
              (closed.get(source) ? RAPIER.TriMeshFlags.ORIENTED : 0),
          ),
        );
        geometry.dispose();
        if (animated) moving.push(createColliderMotion(object, collider));
      });
    },
    build() {
      world.step();
    },
    update() {
      if (!moving.length) return;
      moving.forEach((update) => update());
      world.step();
    },
    // Mutates the destination. Chase uses a direct sightline; free flight slides
    // along the first surface hit, with continuous sweeps even at high speed.
    move(from: THREE.Vector3, destination: THREE.Vector3, slide = true) {
      position.copy(from);
      separate(position);
      remaining.subVectors(destination, position);
      for (let i = 0; i < 5 && remaining.lengthSq() > 1e-10; i++) {
        const hit = world.castShape(
          position,
          rotation,
          remaining,
          shape,
          skin,
          1,
          true,
        );
        if (!hit) {
          position.add(remaining);
          break;
        }
        position.addScaledVector(
          remaining,
          Math.max(0, hit.time_of_impact - 0.0001),
        );
        if (!slide) break;
        remaining.multiplyScalar(1 - hit.time_of_impact);
        normal.copy(hit.normal1).normalize();
        const inward = remaining.dot(normal);
        if (inward >= 0) break;
        remaining.addScaledVector(normal, -inward);
      }
      separate(position);
      destination.copy(position);
    },
    dispose() {
      world.free();
    },
  };
}
