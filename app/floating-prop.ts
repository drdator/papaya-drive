import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { gravity } from './vehicle-ground.ts';

export function createFloatingProp(
  world: RAPIER.World,
  object: THREE.Object3D,
  waterAt: (x: number, z: number) => number | undefined,
  shape: 'cuboid' | 'convex' = 'cuboid',
) {
  object.updateWorldMatrix(true, true);
  const initialPosition = object.getWorldPosition(new THREE.Vector3());
  const initialRotation = object.getWorldQuaternion(new THREE.Quaternion());
  const scale = object.getWorldScale(new THREE.Vector3());
  const inverse = object.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const vertices: number[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positions = child.geometry.getAttribute('position');
    const transform = inverse.clone().multiply(child.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      point
        .fromBufferAttribute(positions, i)
        .applyMatrix4(transform)
        .multiply(scale);
      bounds.expandByPoint(point);
      if (shape === 'convex') vertices.push(point.x, point.y, point.z);
    }
  });
  const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const center = bounds.getCenter(new THREE.Vector3());
  const mass = half.x * half.y * half.z * 8 * 40;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...initialPosition.toArray())
      .setRotation(initialRotation)
      .setCcdEnabled(true)
      .setLinearDamping(0.15)
      .setAngularDamping(0.45)
      .setAdditionalSolverIterations(4),
  );
  const collider =
    shape === 'convex'
      ? RAPIER.ColliderDesc.convexHull(new Float32Array(vertices))
      : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(
          center.x,
          center.y,
          center.z,
        );
  if (!collider) throw new Error(`Cannot create collider for ${object.name}`);
  world.createCollider(
    collider.setMass(mass).setFriction(0.65).setRestitution(0.02),
    body,
  );
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) =>
        new THREE.Vector3(
          x * half.x * 0.7,
          y * half.y * 0.7,
          z * half.z * 0.7,
        ).add(center),
      ),
    ),
  );
  const previousPosition = initialPosition.clone(),
    position = initialPosition.clone();
  const previousRotation = initialRotation.clone(),
    rotation = initialRotation.clone();
  const parentInverse =
    object.parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
  const parentRotation =
    object.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ??
    new THREE.Quaternion();
  const impulse = new THREE.Vector3();
  return {
    body,
    halfSize: half,
    rememberRestPose() {
      initialPosition.copy(body.translation());
      initialRotation.copy(body.rotation());
      previousPosition.copy(initialPosition);
      position.copy(initialPosition);
      previousRotation.copy(initialRotation);
      rotation.copy(initialRotation);
    },
    reset() {
      body.setTranslation(initialPosition, true);
      body.setRotation(initialRotation, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      body.sleep();
      previousPosition.copy(initialPosition);
      position.copy(initialPosition);
      previousRotation.copy(initialRotation);
      rotation.copy(initialRotation);
    },
    beforeStep(dt: number) {
      previousPosition.copy(body.translation());
      previousRotation.copy(body.rotation());
      for (const corner of corners) {
        point
          .copy(corner)
          .applyQuaternion(previousRotation)
          .add(previousPosition);
        const surface = waterAt(point.x, point.z);
        if (surface === undefined) continue;
        const submerged = THREE.MathUtils.clamp(
          (surface - point.y) / (half.y * 1.2) + 0.5,
          0,
          1,
        );
        if (submerged === 0) continue;
        const velocity = body.velocityAtPoint(point);
        const drag = 1 - Math.exp(-1.7 * submerged * dt);
        const verticalDrag =
          1 - Math.exp(-(3 + Math.abs(velocity.y) * 0.6) * submerged * dt);
        impulse
          .set(
            -velocity.x * drag,
            gravity * 2.4 * submerged * dt - velocity.y * verticalDrag,
            -velocity.z * drag,
          )
          .multiplyScalar(mass / corners.length);
        body.applyImpulseAtPoint(impulse, point, true);
      }
    },
    afterStep() {
      position.copy(body.translation());
      rotation.copy(body.rotation());
    },
    render(alpha: number) {
      object.position
        .lerpVectors(previousPosition, position, alpha)
        .applyMatrix4(parentInverse);
      object.quaternion
        .slerpQuaternions(previousRotation, rotation, alpha)
        .premultiply(parentRotation);
      object.updateWorldMatrix(false, true);
    },
  };
}
