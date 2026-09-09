import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { terrainHeight } from './terrain.ts';
import { createColliderMotion } from './moving-collider.ts';
import { createVehicleBuoyancy } from './vehicle-buoyancy.ts';
import { createFloatingProp } from './floating-prop.ts';
import {
  gravity,
  groundUnderCar,
  tireRadius,
  wheelMounts,
} from './vehicle-ground.ts';

export const topSpeed = 95 / 3.6;
export type DriveInput = {
  gas: boolean;
  reverse: boolean;
  brake: boolean;
  turn: number;
};
let initialization: Promise<void> | undefined;
export function initializeVehiclePhysics() {
  return (initialization ??= RAPIER.init());
}

export function createVehiclePhysics(
  terrain: THREE.BufferGeometry,
  heightAt = terrainHeight,
) {
  const mass = 1000;
  const restLength = 0.36;
  const mountHeight = tireRadius + restLength - gravity / (55 * 4);
  const world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(
      Float32Array.from(terrain.getAttribute('position').array),
      Uint32Array.from(terrain.index!.array),
    ).setFriction(0.8),
  );
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAngularDamping(0.4)
      .setAdditionalMassProperties(
        mass,
        { x: 0, y: 0.55, z: 0 },
        { x: 1800, y: 2500, z: 1100 },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
  );
  const chassis = [
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.77, 0.22, 1.7)
        .setTranslation(0, 0.65, 0)
        .setDensity(0)
        .setFriction(0.55)
        .setRestitution(0.08),
      body,
    ),
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.63, 0.3, 0.76)
        .setTranslation(0, 1.15, -0.23)
        .setDensity(0)
        .setFriction(0.55)
        .setRestitution(0.05),
      body,
    ),
  ];
  function createController() {
    const vehicle = world.createVehicleController(body);
    vehicle.indexUpAxis = 1;
    vehicle.setIndexForwardAxis = 2;
    wheelMounts.forEach((wheel, i) => {
      vehicle.addWheel(
        { x: wheel.x, y: mountHeight, z: wheel.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        restLength,
        tireRadius,
      );
      vehicle.setWheelSuspensionStiffness(i, 55);
      vehicle.setWheelSuspensionCompression(i, 8);
      vehicle.setWheelSuspensionRelaxation(i, 10);
      vehicle.setWheelMaxSuspensionTravel(i, 0.22);
      vehicle.setWheelMaxSuspensionForce(i, 45000);
      vehicle.setWheelFrictionSlip(i, 2.2);
      vehicle.setWheelSideFrictionStiffness(i, 1);
    });
    return vehicle;
  }
  let vehicle = createController();
  const buoyancy = createVehicleBuoyancy(body, mass);
  const floatingProps: ReturnType<typeof createFloatingProp>[] = [];
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const velocity = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const axle = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const contactNormal = new THREE.Vector3();
  const pointVelocity = new THREE.Vector3();
  const previousVelocity = new THREE.Vector3();
  const previousAngularVelocity = new THREE.Vector3();
  const previousCenter = new THREE.Vector3();
  const patchPoint = new THREE.Vector3();
  const localPoint = new THREE.Vector3();
  const contactRotation = new THREE.Quaternion();
  const obstacleRadii = new Map<number, number>();
  const impact = {
    speed: 0,
    radius: 1.1,
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
  };
  const wheels = wheelMounts.map(() => ({
    contact: false,
    load: 0,
    offset: -0.12,
    rotation: 0,
    skid: 0,
    grip: 2.2,
    airTime: 0,
    contactTime: 0.2,
    point: new THREE.Vector3(),
    attached: true,
  }));
  const state = {
    position,
    rotation,
    velocity,
    wheels,
    speed: 0,
    steering: 0,
    heading: 0,
    pitch: 0,
    bank: 0,
    grounded: false,
    impact,
  };

  function readState() {
    position.copy(body.translation());
    rotation.copy(body.rotation());
    velocity.copy(body.linvel());
    forward.set(0, 0, 1).applyQuaternion(rotation);
    state.speed = velocity.dot(forward);
    // Keep yaw continuous for the chase camera, even through full turns.
    const yaw = Math.atan2(forward.x, forward.z);
    state.heading += Math.atan2(
      Math.sin(yaw - state.heading),
      Math.cos(yaw - state.heading),
    );
    euler.setFromQuaternion(rotation, 'YXZ');
    state.pitch = euler.x;
    state.bank = euler.z;
  }

  return {
    state,
    body,
    addFloatingProp(
      object: THREE.Object3D,
      waterAt: (x: number, z: number) => number | undefined,
      shape: 'cuboid' | 'convex' = 'cuboid',
    ) {
      const prop = createFloatingProp(world, object, waterAt, shape);
      floatingProps.push(prop);
      return prop;
    },
    renderFloatingProps(alpha: number) {
      floatingProps.forEach((prop) => prop.render(alpha));
    },
    settleFloatingProps() {
      if (!floatingProps.length) return;
      const placed: {
        prop: (typeof floatingProps)[number];
        original: THREE.Vector3;
      }[] = [];
      for (const prop of [...floatingProps].sort(
        (a, b) => a.body.translation().y - b.body.translation().y,
      )) {
        const p = new THREE.Vector3().copy(prop.body.translation());
        const original = p.clone();
        const support = placed.find(
          ({ original: below, prop: base }) =>
            Math.hypot(p.x - below.x, p.z - below.z) <
              Math.min(base.halfSize.x, base.halfSize.z) &&
            p.y > below.y + base.halfSize.y,
        );
        const orientation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            0,
            new THREE.Euler().setFromQuaternion(
              new THREE.Quaternion().copy(prop.body.rotation()),
              'YXZ',
            ).y,
            0,
          ),
        );
        if (support) {
          p.y =
            support.prop.body.translation().y +
            support.prop.halfSize.y +
            prop.halfSize.y +
            0.01;
        } else {
          // Start clear of the ground; the level sand at the landing supports
          // the supplies upright without pinning or burying their colliders.
          let ground = heightAt(p.x, p.z);
          for (const x of [-1, 1])
            for (const z of [-1, 1]) {
              const corner = new THREE.Vector3(
                x * prop.halfSize.x,
                0,
                z * prop.halfSize.z,
              ).applyQuaternion(orientation);
              ground = Math.max(
                ground,
                heightAt(p.x + corner.x, p.z + corner.z),
              );
            }
          p.y = ground + prop.halfSize.y + 0.01;
        }
        prop.body.setTranslation(p, true);
        prop.body.setRotation(orientation, true);
        placed.push({ prop, original });
      }
      const enabled = body.isEnabled();
      body.setEnabled(false);
      world.timestep = 1 / 120;
      for (let i = 0; i < 240; i++) world.step();
      body.setEnabled(enabled);
      floatingProps.forEach((prop) => {
        prop.rememberRestPose();
        prop.reset();
        prop.render(1);
      });
    },
    stepScenery(dt: number) {
      floatingProps.forEach((prop) => prop.beforeStep(dt));
      world.timestep = dt;
      world.step();
      floatingProps.forEach((prop) => prop.afterStep());
    },
    addSolid(mesh: THREE.Mesh, moving = false) {
      mesh.updateWorldMatrix(true, false);
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const positions = geometry.getAttribute('position');
      const indices =
        geometry.index?.array ??
        Array.from({ length: positions.count }, (_, i) => i);
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          Float32Array.from(positions.array),
          Uint32Array.from(indices),
        )
          .setFriction(0.8)
          .setRestitution(0.08),
      );
      geometry.dispose();
      return moving ? createColliderMotion(mesh, collider) : undefined;
    },
    addObstacle(obstacle: {
      x: number;
      z: number;
      radius: number;
      bottom: number;
      top: number;
    }) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cylinder(
          (obstacle.top - obstacle.bottom) / 2,
          obstacle.radius,
        )
          .setTranslation(
            obstacle.x,
            (obstacle.top + obstacle.bottom) / 2,
            obstacle.z,
          )
          .setFriction(0.6)
          .setRestitution(0.12),
      );
      obstacleRadii.set(collider.handle, obstacle.radius);
    },
    reset(x: number, z: number, heading: number) {
      buoyancy.reset();
      floatingProps.forEach((prop) => prop.reset());
      const surface = groundUnderCar(x, z, heading, heightAt);
      rotation.setFromEuler(
        euler.set(surface.pitch, heading, surface.bank, 'YXZ'),
      );
      body.setTranslation({ x, y: surface.height + 0.04, z }, true);
      body.setRotation(rotation, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      world.removeVehicleController(vehicle);
      vehicle = createController();
      state.heading = heading;
      state.steering = 0;
      state.grounded = false;
      wheels.forEach((wheel, i) => {
        wheel.attached = true;
        wheel.grip = 2.2;
        wheel.airTime = 0;
        wheel.contactTime = 0.2;
        wheel.contact = false;
        wheel.skid = wheel.load = wheel.offset = wheel.rotation = 0;
        vehicle.setWheelChassisConnectionPointCs(i, {
          x: wheelMounts[i].x,
          y: mountHeight,
          z: wheelMounts[i].z,
        });
      });
      impact.speed = 0;
      // Refresh scene queries after resetting, before the next suspension raycasts.
      world.timestep = 1 / 120;
      world.step();
      readState();
      floatingProps.forEach((prop) => {
        prop.afterStep();
        prop.render(1);
      });
    },
    teleport(target: THREE.Vector3, orientation: THREE.Quaternion) {
      buoyancy.reset();
      body.setTranslation(target, true);
      body.setRotation(orientation, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.resetForces(true);
      body.resetTorques(true);
      state.steering = 0;
      state.grounded = false;
      impact.speed = 0;
      wheels.forEach((wheel) => {
        wheel.contact = false;
        wheel.airTime = 0.1;
        wheel.contactTime = 0;
        wheel.skid = wheel.load = 0;
        wheel.offset = -0.12;
      });
      readState();
    },
    setWheelMount(i: number, z: number, attached: boolean) {
      wheels[i].attached = attached;
      vehicle.setWheelChassisConnectionPointCs(i, {
        x: wheelMounts[i].x,
        y: mountHeight,
        z,
      });
    },
    step(input: DriveInput, dt: number, waterSurface?: number) {
      readState();
      const waterDepth =
        waterSurface === undefined ? 0 : Math.max(0, waterSurface - position.y);
      previousVelocity.copy(velocity);
      previousAngularVelocity.copy(body.angvel());
      previousCenter.copy(body.worldCom());
      const speed = Math.abs(state.speed);
      const reversing = input.reverse && !input.gas && state.speed < 0.1;
      const braking =
        input.brake ||
        (input.gas && input.reverse) ||
        (input.reverse && !reversing);
      const targetSteering =
        (input.turn *
          THREE.MathUtils.lerp(
            0.48,
            0.32,
            THREE.MathUtils.smoothstep(speed, 8, topSpeed),
          )) /
        (1 + speed * 0.055);
      state.steering = THREE.MathUtils.damp(
        state.steering,
        targetSteering,
        9,
        dt,
      );
      const drive = braking
        ? 0
        : input.gas
          ? 12 * THREE.MathUtils.clamp((topSpeed - state.speed) / 0.7, 0, 1)
          : reversing
            ? -7 * THREE.MathUtils.clamp((6 - speed) / 0.5, 0, 1)
            : 0;
      const brake = braking ? 14 : drive === 0 ? 2.3 : 0;
      wheels.forEach((wheel, i) => {
        const rear = i >= 2;
        vehicle.setWheelSteering(i, rear ? 0 : state.steering);
        vehicle.setWheelEngineForce(
          i,
          wheel.attached && rear ? (drive * mass) / 2 : 0,
        );
        // Braking transfers weight forward: spare the unloaded rear tires some brake force.
        const brakeShare =
          braking && !input.brake ? (rear ? 0.175 : 0.325) : 0.25;
        vehicle.setWheelBrake(
          i,
          wheel.attached ? brake * mass * dt * brakeShare : 0,
        );
        vehicle.setWheelMaxSuspensionForce(i, wheel.attached ? 45000 : 0);
        // Progressive bump stops absorb hard landings before the suspension bottoms out.
        const compression =
          restLength - (vehicle.wheelSuspensionLength(i) ?? restLength);
        const bumpStop = THREE.MathUtils.smoothstep(compression, 0.12, 0.24);
        vehicle.setWheelSuspensionStiffness(i, 55 + 250 * bumpStop);
        vehicle.setWheelSuspensionCompression(i, 8 + 8 * bumpStop);
        // Dissipate the bump stop’s stored energy on extension instead of launching again.
        vehicle.setWheelSuspensionRelaxation(i, 10 + 8 * bumpStop);
        const sliding =
          speed > 7 &&
          rear &&
          (input.brake || (braking && Math.abs(state.steering) > 0.04));
        // Keep ordinary braking predictable; the handbrake deliberately breaks more rear grip.
        wheel.grip = THREE.MathUtils.damp(
          wheel.grip,
          sliding ? (input.brake ? 1.15 : 2.0) : 2.2,
          sliding ? 5 : 6,
          dt,
        );
        // Prepare reduced grip while airborne so even the first touchdown impulse is softened.
        // Suspension forces remain immediate; only tire traction ramps back over 0.2 seconds.
        const landingGrip = THREE.MathUtils.lerp(
          0.2,
          1,
          THREE.MathUtils.smoothstep(wheel.contactTime, 0, 0.2),
        );
        vehicle.setWheelFrictionSlip(
          i,
          wheel.attached ? wheel.grip * landingGrip : 0,
        );
      });
      buoyancy.update(waterSurface, dt);
      floatingProps.forEach((prop) => prop.beforeStep(dt));
      vehicle.updateVehicle(
        dt,
        undefined,
        undefined,
        (collider) => collider.parent()?.handle !== body.handle,
      );
      wheels.forEach((wheel, i) => {
        wheel.load = wheel.attached
          ? (vehicle.wheelSuspensionForce(i) ?? 0)
          : 0;
        wheel.contact =
          wheel.attached && vehicle.wheelIsInContact(i) && wheel.load > 20;
        if (wheel.contact) {
          wheel.airTime = 0;
          wheel.contactTime = Math.min(0.2, wheel.contactTime + dt);
        } else {
          wheel.airTime += dt;
          // Ignore momentary unloading on uneven ground instead of repeatedly weakening grip.
          if (wheel.airTime >= 0.04) wheel.contactTime = 0;
        }
        wheel.offset =
          mountHeight -
          (vehicle.wheelSuspensionLength(i) ?? restLength) -
          tireRadius;
        wheel.rotation = vehicle.wheelRotation(i) ?? wheel.rotation;
        const point = vehicle.wheelContactPoint(i);
        if (point) wheel.point.copy(point);
      });
      world.timestep = dt;
      world.step();
      readState();
      floatingProps.forEach((prop) => prop.afterStep());
      state.grounded = wheels.some((wheel) => wheel.contact);
      wheels.forEach((wheel, i) => {
        wheel.skid = 0;
        if (!wheel.contact || waterDepth > 0.1) return;
        pointVelocity.copy(body.velocityAtPoint(wheel.point));
        axle
          .set(1, 0, 0)
          .applyAxisAngle(up, i < 2 ? state.steering : 0)
          .applyQuaternion(rotation);
        const sideways = Math.abs(pointVelocity.dot(axle));
        const locking = braking && speed > 5 && (i >= 2 || !input.brake);
        wheel.skid = Math.max(
          THREE.MathUtils.clamp((sideways - 1.2) / 5, 0, 1),
          locking ? 0.5 : 0,
        );
      });
      impact.speed = 0;
      impact.velocity.copy(previousVelocity);
      for (const collider of chassis)
        world.contactPairsWith(collider, (other) => {
          world.contactPair(collider, other, (manifold, flipped) => {
            patchPoint.set(0, 0, 0);
            let contacts = manifold.numSolverContacts();
            if (contacts) {
              for (let i = 0; i < contacts; i++)
                patchPoint.add(manifold.solverContactPoint(i)!);
            } else {
              // CCD terrain hits can retain geometric contacts after the solver
              // contacts have been cleared. Only accept points at the collision skin.
              contactRotation.copy(other.rotation());
              for (let i = 0; i < manifold.numContacts(); i++) {
                if (manifold.contactDist(i) > 0.015) continue;
                const point = flipped
                  ? manifold.localContactPoint1(i)
                  : manifold.localContactPoint2(i);
                if (!point) continue;
                patchPoint.add(
                  localPoint
                    .copy(point)
                    .applyQuaternion(contactRotation)
                    .add(other.translation()),
                );
                contacts++;
              }
            }
            if (!contacts) return;
            patchPoint.divideScalar(contacts);
            state.grounded = true;
            const normal = contactNormal
              .copy(manifold.normal())
              .multiplyScalar(flipped ? -1 : 1);
            // A rotating nose or roof can hit hard even with little body translation.
            pointVelocity
              .subVectors(patchPoint, previousCenter)
              .crossVectors(previousAngularVelocity, pointVelocity)
              .add(previousVelocity);
            const otherBody = other.parent();
            // A light prop transfers much less impact to the car than a fixed wall.
            const transferred = otherBody?.isDynamic()
              ? otherBody.mass() / (mass + otherBody.mass())
              : 1;
            const closing = pointVelocity.dot(normal) * transferred;
            if (closing > impact.speed) {
              impact.speed = closing;
              impact.radius = obstacleRadii.get(other.handle) ?? 1.1;
              impact.point.copy(patchPoint);
              impact.normal.copy(normal).negate();
            }
          });
        });
      return state;
    },
    dispose() {
      world.free();
    },
  };
}
