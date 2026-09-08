import * as THREE from 'three';
import { seaLevel } from './terrain.ts';

export function createFlyCamera(
  camera: THREE.PerspectiveCamera,
  heightAt: (x: number, z: number) => number,
) {
  const carPosition = new THREE.Vector3();
  const carRotation = new THREE.Quaternion();
  const carOffset = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const look = new THREE.Euler(0, 0, 0, 'YXZ');
  const movement = new THREE.Vector3();
  return {
    carPosition,
    carRotation,
    enter(position: THREE.Vector3) {
      carPosition.copy(position);
      carOffset
        .copy(position)
        .sub(camera.position)
        .applyQuaternion(camera.quaternion.clone().invert());
      look.setFromQuaternion(camera.quaternion, 'YXZ');
    },
    look(dx: number, dy: number) {
      look.y -= dx * 0.004;
      look.x = THREE.MathUtils.clamp(look.x - dy * 0.004, -1.45, 1.45);
      camera.quaternion.setFromEuler(look);
    },
    update(dt: number, keys: ReadonlySet<string>) {
      const forward =
        Number(keys.has('w') || keys.has('ArrowUp')) -
        Number(keys.has('s') || keys.has('ArrowDown'));
      const sideways =
        Number(keys.has('d') || keys.has('ArrowRight')) -
        Number(keys.has('a') || keys.has('ArrowLeft'));
      const vertical =
        Number(keys.has('e') || keys.has(' ')) - Number(keys.has('q'));
      movement.set(sideways, 0, -forward).applyQuaternion(camera.quaternion);
      movement.y += vertical;
      movement.clampLength(0, 1);
      camera.position.addScaledVector(
        movement,
        dt * (keys.has('Shift') ? 48 : 18),
      );
      camera.position.y = Math.max(
        camera.position.y,
        seaLevel + 0.8,
        heightAt(camera.position.x, camera.position.z) + 0.8,
      );
      carPosition
        .copy(carOffset)
        .applyQuaternion(camera.quaternion)
        .add(camera.position);
      const lift = Math.max(
        0,
        heightAt(carPosition.x, carPosition.z) + 0.25 - carPosition.y,
      );
      camera.position.y += lift;
      carPosition.y += lift;
      viewDirection.set(0, 0, -1).applyQuaternion(camera.quaternion);
      carRotation.setFromAxisAngle(
        up,
        Math.atan2(viewDirection.x, viewDirection.z),
      );
    },
  };
}
