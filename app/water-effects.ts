import * as THREE from 'three';
import { seaLevel } from './terrain.ts';
import { wheelMounts } from './vehicle-ground.ts';

export function createWaterEffects() {
  const group = new THREE.Group();
  group.name = 'Water effects';
  const ringGeometry = new THREE.RingGeometry(0.92, 1, 40);
  ringGeometry.rotateX(-Math.PI / 2);
  const dropGeometry = new THREE.TetrahedronGeometry(0.075);
  const rings = Array.from({ length: 10 }, () => {
    const mesh = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: '#ecf8e5',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    return { mesh, age: 2, strength: 0 };
  });
  const drops = Array.from({ length: 36 }, () => {
    const mesh = new THREE.Mesh(
      dropGeometry,
      new THREE.MeshBasicMaterial({
        color: '#d7efe5',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    return { mesh, age: 1, velocity: new THREE.Vector3() };
  });
  let ringCursor = 0,
    dropCursor = 0,
    wet = false,
    cooldown = 0;
  const contact = new THREE.Vector3();
  const lowest = new THREE.Vector3();

  function ripple(
    x: number,
    z: number,
    strength: number,
    surface: number,
    delay = 0,
  ) {
    const ring = rings[ringCursor++ % rings.length];
    ring.age = -delay;
    ring.strength = strength;
    ring.mesh.position.set(x, surface + 0.035, z);
    ring.mesh.visible = false;
  }

  return {
    group,
    reset() {
      wet = false;
      cooldown = ringCursor = dropCursor = 0;
      for (const particle of [...rings, ...drops]) {
        particle.age = 2;
        particle.mesh.visible = false;
      }
    },
    update(
      dt: number,
      car: THREE.Object3D,
      speed: number,
      verticalSpeed: number,
      surface = seaLevel,
    ) {
      if (dt <= 0) return 0;
      let splashStrength = 0;
      cooldown = Math.max(0, cooldown - dt);
      lowest.set(0, Infinity, 0);
      for (const mount of wheelMounts) {
        contact
          .set(mount.x, 0, mount.z)
          .applyQuaternion(car.quaternion)
          .add(car.position);
        if (contact.y < lowest.y) lowest.copy(contact);
      }
      const touching = lowest.y < surface - 0.02;
      if (touching && !wet && cooldown === 0) {
        const strength = THREE.MathUtils.clamp(
          (speed + Math.max(0, -verticalSpeed) * 2) / 20,
          0.15,
          1,
        );
        splashStrength = strength;
        ripple(lowest.x, lowest.z, strength, surface);
        ripple(lowest.x, lowest.z, strength * 0.8, surface, 0.16);
        for (let i = 0; i < 12; i++) {
          const drop = drops[dropCursor++ % drops.length];
          const angle = (i / 12) * Math.PI * 2;
          const spread = 1 + strength * 1.8;
          drop.age = 0;
          drop.mesh.position.set(lowest.x, surface + 0.06, lowest.z);
          drop.velocity.set(
            Math.cos(angle) * spread,
            1.5 + strength * 2.3,
            Math.sin(angle) * spread,
          );
        }
        cooldown = 0.45;
      } else if (
        touching &&
        speed > 2 &&
        car.position.y > surface - 1.4 &&
        cooldown === 0
      ) {
        ripple(car.position.x, car.position.z, 0.2, surface);
        cooldown = 0.45;
      }
      // Hysteresis prevents suspension bobbing at the surface from repeating splashes.
      if (touching) wet = true;
      else if (lowest.y > surface + 0.1) wet = false;
      for (const ring of rings) {
        ring.age += dt;
        ring.mesh.visible = ring.age >= 0 && ring.age < 2;
        if (!ring.mesh.visible) continue;
        ring.mesh.scale.setScalar(
          0.45 + ring.age * (1.3 + ring.strength * 1.2),
        );
        ring.mesh.material.opacity =
          (0.32 + ring.strength * 0.24) *
          Math.min(1, ring.age / 0.08) *
          (1 - ring.age / 2) ** 2;
      }
      for (const drop of drops) {
        drop.age += dt;
        drop.mesh.visible = drop.age < 0.95 && drop.mesh.position.y > surface;
        if (!drop.mesh.visible) continue;
        drop.velocity.y -= 8 * dt;
        drop.mesh.position.addScaledVector(drop.velocity, dt);
        drop.mesh.material.opacity = 0.75 * (1 - drop.age / 0.95);
      }
      return splashStrength;
    },
  };
}
