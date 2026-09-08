import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { createVehicleEngine } from './vehicle-engine.ts';

export type CarImpact = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  speed: number;
  damage: number;
  radius?: number;
  fatal?: boolean;
};

// Impact coordinates and deformation are in the car's frame, independent of heading.
export function dentVertex(
  vertex: THREE.Vector3,
  impact: CarImpact,
  strength = 1,
  reference = vertex,
) {
  const radius = THREE.MathUtils.clamp(impact.radius ?? 1.1, 0.15, 1.6);
  const dx = reference.x - impact.point.x,
    dy = reference.y - impact.point.y,
    dz = reference.z - impact.point.z;
  const horizontal = Math.hypot(impact.normal.x, impact.normal.z);
  const nx = horizontal > 0.1 ? impact.normal.x / horizontal : 0,
    nz = horizontal > 0.1 ? impact.normal.z / horizontal : 1;
  const across = dx * nz - dz * nx;
  const inward =
    dx * impact.normal.x + dy * impact.normal.y + dz * impact.normal.z;
  const lateral =
    1 -
    THREE.MathUtils.smoothstep(Math.abs(across), radius * 0.55, radius + 0.28);
  const vertical = 1 - THREE.MathUtils.smoothstep(Math.abs(dy), 0.35, 1.1);
  const propagation =
    1 - THREE.MathUtils.smoothstep(Math.max(0, inward), 0, 1.5);
  const weight = lateral * vertical * propagation;
  const depth = Math.min(0.95, impact.damage * 0.014) * weight * strength;
  const upper = THREE.MathUtils.smoothstep(reference.y, 0.65, 1);
  vertex.addScaledVector(impact.normal, depth);
  // Sheet metal folds at the sides of the indentation and behind the contact.
  vertex.y +=
    depth *
    upper *
    horizontal *
    (0.12 +
      0.45 * (1 - lateral) +
      0.25 * Math.sin((Math.max(0, inward) * Math.PI) / 1.5));
  return weight;
}

export function createCrashVisuals(
  car: THREE.Group,
  body: THREE.Object3D,
  scene: THREE.Scene,
  heightAt: (x: number, z: number) => number,
  random = Math.random,
) {
  const engine = createVehicleEngine();
  body.add(engine.group);
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
    index: THREE.BufferAttribute | null;
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
    object.geometry = /body|bumper|grille/i.test(object.name)
      ? new TessellateModifier(0.22, 8).modify(geometry)
      : geometry.clone();
    if (!object.geometry.index)
      object.geometry.setIndex(
        Array.from(
          { length: object.geometry.getAttribute('position').count },
          (_, i) => i,
        ),
      );
    object.geometry.computeBoundingBox();
    const toCar = carInverse.clone().multiply(object.matrixWorld);
    const name = object.name;
    parts.push({
      mesh: object,
      parent: object.parent,
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      geometry,
      index: object.geometry.index!.clone(),
      original: Float32Array.from(
        object.geometry.getAttribute('position').array,
      ),
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
  let hood: ReturnType<typeof openHood>;

  function openHood() {
    const part = parts.find((part) => part.mesh.name === 'Body_1');
    if (!part) return;
    const positions = part.mesh.geometry.getAttribute('position');
    const index = part.index;
    const panel: number[] = [];
    const remaining: number[] = [];
    // The GLB's hood is the upper panel between the windshield and nose.
    for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
      const triangle = [0, 1, 2].map((j) =>
        index ? index.getX(i + j) : i + j,
      );
      const corners = triangle.map((j) =>
        new THREE.Vector3()
          .fromArray(part.original, j * 3)
          .applyMatrix4(part.toCar),
      );
      const normal = new THREE.Vector3()
        .subVectors(corners[1], corners[0])
        .cross(new THREE.Vector3().subVectors(corners[2], corners[0]))
        .normalize();
      const isHood =
        normal.y > 0.8 &&
        triangle.every((j) => {
          original.fromArray(part.original, j * 3).applyMatrix4(part.toCar);
          return original.y > 0.9 && original.z > 0.69;
        });
      (isHood ? panel : remaining).push(...triangle);
    }
    if (!panel.length) return;
    const rearZ = Math.min(
      ...panel.map(
        (i) =>
          original.fromArray(part.original, i * 3).applyMatrix4(part.toCar).z,
      ),
    );
    const rearIndices = [...new Set(panel)].filter(
      (i) =>
        original.fromArray(part.original, i * 3).applyMatrix4(part.toCar).z <
        rearZ + 0.01,
    );
    const hinge = new THREE.Vector3();
    const originalHinge = new THREE.Vector3();
    for (const i of rearIndices) {
      hinge.add(
        vertex.fromBufferAttribute(positions, i).applyMatrix4(part.toCar),
      );
      originalHinge.add(
        original.fromArray(part.original, i * 3).applyMatrix4(part.toCar),
      );
    }
    hinge.divideScalar(rearIndices.length);
    originalHinge.divideScalar(rearIndices.length);
    const points = panel.map((i) => {
      const rest = new THREE.Vector3()
        .fromArray(part.original, i * 3)
        .applyMatrix4(part.toCar)
        .sub(originalHinge);
      const dent = new THREE.Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(part.toCar)
        .sub(hinge)
        .sub(rest);
      // The released panel keeps its shape instead of inheriting the crushed nose.
      return rest.add(dent.multiplyScalar(0.2).clampLength(0, 0.1));
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.computeVertexNormals();
    const sourceMaterial = Array.isArray(part.mesh.material)
      ? part.mesh.material[0]
      : part.mesh.material;
    const material = sourceMaterial.clone();
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Popped_hood';
    mesh.position.copy(hinge);
    mesh.castShadow = mesh.receiveShadow = true;
    car.add(mesh);
    part.mesh.geometry.setIndex(remaining);
    return { mesh, angle: 0, previous: 0, velocity: 4, detached: false };
  }

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
    if (hood) {
      hood.mesh.removeFromParent();
      hood.mesh.geometry.dispose();
      hood.mesh.material.dispose();
      hood = undefined;
    }
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
      part.mesh.geometry.setIndex(part.index?.clone() ?? null);
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
      const alreadyPopped = hood !== undefined && !hood.detached;
      const fatalFront =
        impact.fatal && impact.point.z > 0.5 && !frontDestroyed;
      if (fatalFront) frontDestroyed = true;
      car.updateWorldMatrix(true, true);
      for (const part of parts) {
        if (part.detached) continue;
        const positions = part.mesh.geometry.getAttribute('position');
        let coverage = 0;
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(part.toCar);
          original.fromArray(part.original, i * 3).applyMatrix4(part.toCar);
          coverage += dentVertex(
            vertex,
            impact,
            /cabin|roof|window|windshield/i.test(part.mesh.name) ? 0.45 : 1,
            original,
          );
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
        coverage /= positions.count;
        part.damage += (impact.damage / 100) * coverage;
        if (part.glass && part.damage > 0.04 && coverage > 0) {
          if (!part.cracks) glassBroken = true;
          crackGlass(part);
        }
        if (part.damage > part.breakAt) {
          part.detached = true;
          throwPart(part.mesh, velocity, impact, false);
          if (/light|indicator/i.test(part.mesh.name)) glassBroken = true;
        }
      }
      let struckWheel: (typeof frontWheels)[number] | undefined;
      let strongestWheelContact = 0.35;
      for (const wheel of frontWheels) {
        if (wheel.object.parent !== car) continue;
        original.copy(wheel.position).setY(0.65);
        vertex.copy(original);
        const weight = dentVertex(vertex, impact, 0.75);
        wheel.object.position.z = THREE.MathUtils.clamp(
          wheel.object.position.z + vertex.z - original.z,
          wheel.position.z - 0.8,
          wheel.position.z + 0.3,
        );
        if (weight > strongestWheelContact) {
          struckWheel = wheel;
          strongestWheelContact = weight;
        }
      }
      if (fatalFront && impact.speed >= 10 && struckWheel && random() < 0.6)
        throwPart(struckWheel.object, velocity, impact, false);
      if (
        !hood &&
        impact.point.z > 0.5 &&
        impact.speed >= 8 &&
        random() < THREE.MathUtils.clamp((impact.speed - 5) * 0.025, 0, 0.55)
      )
        hood = openHood();
      if (
        hood &&
        !hood.detached &&
        impact.speed >= 18 &&
        (alreadyPopped || (impact.damage >= 45 && random() < 0.25))
      ) {
        hood.mesh.rotation.x = -hood.angle;
        hood.mesh.geometry.computeBoundingBox();
        const center = hood.mesh.geometry.boundingBox!.getCenter(
          new THREE.Vector3(),
        );
        hood.mesh.geometry.translate(-center.x, -center.y, -center.z);
        hood.mesh.position.add(center.applyQuaternion(hood.mesh.quaternion));
        throwPart(hood.mesh, velocity, impact, false);
        hood.detached = true;
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
      if (hood && !hood.detached) {
        hood.previous = hood.angle;
        hood.velocity += ((1.15 - hood.angle) * 40 - hood.velocity * 7) * dt;
        hood.angle += hood.velocity * dt;
      }
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
      if (hood && !hood.detached)
        hood.mesh.rotation.x = -THREE.MathUtils.lerp(
          hood.previous,
          hood.angle,
          alpha,
        );
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
      engine.dispose();
      shardGeometry.dispose();
      shardMaterial.dispose();
      crackMaterial.dispose();
    },
  };
}
