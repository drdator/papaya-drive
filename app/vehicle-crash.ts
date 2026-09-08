import * as THREE from 'three';

function crushedFrontZ(z: number) {
  return z - THREE.MathUtils.clamp((z - 0.5) / 1.38, 0, 1) * 0.98;
}

export type CarImpact = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  speed: number;
  damage: number;
  fatal?: boolean;
};

// Impact coordinates and deformation are in the car's frame, independent of heading.
export function dentVertex(
  vertex: THREE.Vector3,
  impact: CarImpact,
  strength = 1,
) {
  const radius = 1.1 + Math.min(1, impact.damage / 65) * 0.9;
  const distance = Math.hypot(
    vertex.x - impact.point.x,
    (vertex.y - impact.point.y) * 0.6,
    vertex.z - impact.point.z,
  );
  const weight = Math.max(0, 1 - distance / radius) ** 2;
  const depth = Math.min(0.65, impact.damage * 0.012) * weight * strength;
  vertex.addScaledVector(impact.normal, depth);
  // Upper sheet metal folds upward while the lower chassis resists crushing.
  if (vertex.y > 0.75) vertex.y += depth * 0.5;
  return weight;
}

export function createCrashVisuals(
  car: THREE.Group,
  body: THREE.Object3D,
  scene: THREE.Scene,
  heightAt: (x: number, z: number) => number,
  random = Math.random,
) {
  car.updateWorldMatrix(true, true);
  const carInverse = car.matrixWorld.clone().invert();
  const frontWheels = car.children
    .filter((object) => object.name.startsWith('Wheel_F'))
    .map((object) => ({
      object,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
    }));
  let frontDestroyed = false;
  const parts: {
    mesh: THREE.Mesh;
    parent: THREE.Object3D;
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    geometry: THREE.BufferGeometry;
    original: Float32Array;
    toCar: THREE.Matrix4;
    fromCar: THREE.Matrix4;
    center: THREE.Vector3;
    glass: boolean;
    breakAt: number;
    damage: number;
    detached: boolean;
    cracks?: THREE.LineSegments;
  }[] = [];
  body.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.parent) return;
    const geometry = object.geometry;
    // Keep the source GLB untouched so reset can restore it exactly.
    object.geometry = geometry.clone();
    object.geometry.computeBoundingBox();
    const toCar = carInverse.clone().multiply(object.matrixWorld);
    const name = object.name;
    parts.push({
      mesh: object,
      parent: object.parent,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      geometry,
      original: Float32Array.from(geometry.getAttribute('position').array),
      toCar,
      fromCar: toCar.clone().invert(),
      center: object.geometry
        .boundingBox!.getCenter(new THREE.Vector3())
        .applyMatrix4(toCar),
      glass: /window|windshield/i.test(name),
      breakAt: /bumper/i.test(name)
        ? 0.3
        : /mirror/i.test(name)
          ? 0.09
          : /light|indicator/i.test(name)
            ? 0.1
            : /grille|plate/i.test(name)
              ? 0.2
              : Infinity,
      damage: 0,
      detached: false,
    });
  });
  const debris: {
    object: THREE.Object3D;
    position: THREE.Vector3;
    previous: THREE.Vector3;
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
    rotation: THREE.Quaternion;
    previousRotation: THREE.Quaternion;
    radius: number;
    disposable: boolean;
    age: number;
  }[] = [];
  const shardGeometry = new THREE.TetrahedronGeometry(0.055);
  const shardMaterial = new THREE.MeshStandardMaterial({
    color: '#96c6cd',
    roughness: 0.2,
    metalness: 0.3,
  });
  const crackMaterial = new THREE.LineBasicMaterial({
    color: '#c1e3e3',
    transparent: true,
    opacity: 0.8,
  });
  const vertex = new THREE.Vector3();
  const original = new THREE.Vector3();
  const rotationStep = new THREE.Quaternion();
  const spinEuler = new THREE.Euler();

  function clearCracks(part: (typeof parts)[number]) {
    if (!part.cracks) return;
    part.cracks.removeFromParent();
    part.cracks.geometry.dispose();
    part.cracks = undefined;
  }

  function crackGlass(part: (typeof parts)[number]) {
    clearCracks(part);
    const positions = part.mesh.geometry.getAttribute('position');
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i),
    );
    const center = points
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .divideScalar(points.length);
    const normal = new THREE.Vector3()
      .subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0]))
      .normalize();
    const outward = part.center
      .clone()
      .setY(0)
      .transformDirection(part.fromCar);
    if (normal.dot(outward) < 0) normal.negate();
    center.addScaledVector(normal, 0.008);
    const lines: THREE.Vector3[] = [];
    points.forEach((p, i) => {
      const tip = p.clone().lerp(center, 0.06).addScaledVector(normal, 0.008);
      const elbow = center.clone().lerp(tip, 0.45);
      const branch = tip.clone().lerp(points[(i + 1) % points.length], 0.3);
      lines.push(center, elbow, elbow, tip, elbow, branch);
    });
    part.cracks = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(lines),
      crackMaterial,
    );
    part.mesh.add(part.cracks);
  }

  function throwPart(
    object: THREE.Object3D,
    velocity: THREE.Vector3,
    impact: CarImpact,
    disposable: boolean,
  ) {
    scene.attach(object);
    const normal = impact.normal.clone().transformDirection(car.matrixWorld);
    const position = object.position.clone();
    const bounds = new THREE.Box3().setFromObject(object);
    const radius = object.name.startsWith('Wheel_')
      ? 0.37
      : Math.min(0.35, Math.max(0.04, bounds.getSize(vertex).length() * 0.2));
    debris.push({
      object,
      position,
      previous: position.clone(),
      velocity: velocity
        .clone()
        .multiplyScalar(0.35)
        .addScaledVector(normal, Math.min(impact.speed * 0.16, 4))
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            1.2 + Math.random() * 2,
            (Math.random() - 0.5) * 2,
          ),
        ),
      spin: new THREE.Vector3(
        Math.random() * 6 - 3,
        Math.random() * 6 - 3,
        Math.random() * 6 - 3,
      ),
      rotation: object.quaternion.clone(),
      previousRotation: object.quaternion.clone(),
      radius,
      disposable,
      age: 0,
    });
  }

  function reset() {
    for (const piece of debris)
      if (piece.disposable) piece.object.removeFromParent();
    debris.length = 0;
    frontDestroyed = false;
    for (const wheel of frontWheels) {
      car.add(wheel.object);
      wheel.object.position.copy(wheel.position);
      wheel.object.quaternion.copy(wheel.quaternion);
    }
    for (const part of parts) {
      clearCracks(part);
      part.parent.add(part.mesh);
      part.mesh.position.copy(part.position);
      part.mesh.quaternion.copy(part.quaternion);
      part.mesh.visible = true;
      const positions = part.mesh.geometry.getAttribute('position');
      positions.array.set(part.original);
      positions.needsUpdate = true;
      part.mesh.geometry.computeVertexNormals();
      part.mesh.geometry.computeBoundingSphere();
      part.damage = 0;
      part.detached = false;
    }
  }

  return {
    reset,
    impact(impact: CarImpact, velocity: THREE.Vector3) {
      let glassBroken = false;
      const fatalFront =
        impact.fatal && impact.point.z > 0.5 && !frontDestroyed;
      if (fatalFront) frontDestroyed = true;
      car.updateWorldMatrix(true, true);
      for (const part of parts) {
        if (part.detached) continue;
        const near = Math.max(0, 1 - part.center.distanceTo(impact.point) / 2);
        part.damage += (impact.damage / 100) * near * near;
        if (fatalFront && part.center.z > 1.3) part.damage = 1;
        if (fatalFront && /windshield/i.test(part.mesh.name))
          part.damage = Math.max(0.1, part.damage);
        const positions = part.mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(part.toCar);
          original.fromArray(part.original, i * 3).applyMatrix4(part.toCar);
          dentVertex(
            vertex,
            impact,
            /cabin|roof|window|windshield/i.test(part.mesh.name) ? 0.45 : 1,
          );
          if (fatalFront && /^Body/i.test(part.mesh.name) && original.z > 0.5) {
            const nose = THREE.MathUtils.clamp((original.z - 0.5) / 1.38, 0, 1);
            const upper = THREE.MathUtils.smoothstep(original.y, 0.6, 0.95);
            // Fold the hood into a pronounced ridge and shorten the engine bay.
            vertex.z = Math.min(vertex.z, crushedFrontZ(original.z));
            vertex.y = Math.max(
              vertex.y,
              original.y + upper * (0.55 * Math.sin(nose * Math.PI * 0.85)),
            );
            vertex.x += (original.x - impact.point.x) * nose * 0.12;
          }
          // Bound accumulated dents so repeated scrapes cannot invert the body.
          vertex
            .sub(original)
            .clampLength(0, frontDestroyed && original.z > 0.5 ? 1.2 : 0.7)
            .add(original)
            .applyMatrix4(part.fromCar);
          positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
        }
        positions.needsUpdate = true;
        part.mesh.geometry.computeVertexNormals();
        part.mesh.geometry.computeBoundingSphere();
        if (part.glass && part.damage > 0.04 && near > 0) {
          if (!part.cracks) glassBroken = true;
          crackGlass(part);
        }
        if (part.damage > part.breakAt) {
          part.detached = true;
          throwPart(part.mesh, velocity, impact, false);
          if (/light|indicator/i.test(part.mesh.name)) glassBroken = true;
        }
      }
      if (
        fatalFront &&
        impact.speed >= 10 &&
        random() < 0.6 &&
        frontWheels.length
      ) {
        const nearest = frontWheels.reduce((a, b) =>
          Math.abs(a.position.x - impact.point.x) <
          Math.abs(b.position.x - impact.point.x)
            ? a
            : b,
        );
        throwPart(nearest.object, velocity, impact, false);
      }
      if (fatalFront) {
        // Attached wheel mounts follow the same compression as the engine bay.
        for (const wheel of frontWheels) {
          if (wheel.object.parent === car)
            wheel.object.position.z = crushedFrontZ(wheel.position.z);
        }
      }
      if (glassBroken) {
        for (let i = 0; i < 8 && debris.length < 48; i++) {
          const shard = new THREE.Mesh(shardGeometry, shardMaterial);
          shard.position
            .copy(impact.point)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 0.4,
                0.2 + Math.random() * 0.4,
                0,
              ),
            );
          car.add(shard);
          throwPart(shard, velocity, impact, true);
        }
      }
      return glassBroken;
    },
    update(dt: number) {
      for (const piece of debris) {
        piece.previous.copy(piece.position);
        piece.previousRotation.copy(piece.rotation);
        piece.age += dt;
        if (piece.age > 10) {
          if (piece.disposable) piece.object.visible = false;
          continue;
        }
        piece.velocity.y -= 14 * dt;
        piece.position.addScaledVector(piece.velocity, dt);
        const floor =
          heightAt(piece.position.x, piece.position.z) + piece.radius;
        if (piece.position.y < floor) {
          piece.position.y = floor;
          piece.velocity.y =
            Math.abs(piece.velocity.y) > 0.8
              ? Math.abs(piece.velocity.y) * 0.25
              : 0;
          piece.velocity.x *= Math.exp(-7 * dt);
          piece.velocity.z *= Math.exp(-7 * dt);
          piece.spin.multiplyScalar(Math.exp(-9 * dt));
        }
        rotationStep.setFromEuler(
          spinEuler.set(
            piece.spin.x * dt,
            piece.spin.y * dt,
            piece.spin.z * dt,
          ),
        );
        piece.rotation.multiply(rotationStep);
      }
    },
    render(alpha: number) {
      for (const piece of debris) {
        piece.object.position.lerpVectors(
          piece.previous,
          piece.position,
          alpha,
        );
        piece.object.quaternion.slerpQuaternions(
          piece.previousRotation,
          piece.rotation,
          alpha,
        );
      }
    },
    dispose() {
      reset();
      for (const part of parts) {
        part.mesh.geometry.dispose();
        part.mesh.geometry = part.geometry;
      }
      shardGeometry.dispose();
      shardMaterial.dispose();
      crackMaterial.dispose();
    },
  };
}
