import * as THREE from 'three';
import { waterSurfaceOffset } from './water-waves.ts';
import { seaLevel } from './terrain.ts';
import { createBoatWaterMask } from './boat-water-mask.ts';

export function createFloatingBoats(
  props: THREE.Object3D,
  heightAt: (x: number, z: number) => number,
  waterMask = createBoatWaterMask(),
) {
  const ropes = new THREE.Group();
  ropes.name = 'Animated mooring lines';
  const ropeMaterial = new THREE.MeshStandardMaterial({
    color: '#c7b48e',
    roughness: 1,
  });
  const ropeGeometry = new THREE.CylinderGeometry(0.032, 0.032, 1, 5);
  const boats = [
    'Moored_boat',
    'Offshore_yacht',
    'Fishing_buoy_1',
    'Fishing_buoy_2',
  ].map((name, index) => {
    const object = props.getObjectByName(name);
    if (!object) throw new Error(`Missing floating prop: ${name}`);
    return {
      object,
      position: object.position.clone(),
      rotation: object.quaternion.clone(),
      yacht: name === 'Offshore_yacht',
      buoy: name.startsWith('Fishing_buoy_'),
      phase: index * 1.7,
    };
  });
  props.getObjectByName('Mooring_ropes')!.visible = false;
  const boat = boats[0].object;
  const outline: number[][] = boat.userData.water_hull_outline;
  outline.forEach(([ax, az], i) => {
    const [bx, bz] = outline[(i + 1) % outline.length];
    waterMask.planes.value[i].set(
      az - bz,
      bx - ax,
      (bz - az) * ax - (bx - ax) * az,
    );
  });
  waterMask.active.value = 1;
  const anchors: number[][] = boat.userData.mooring_anchors;
  const points: number[][] = boat.userData.mooring_points;
  const lines = anchors.map((anchor, i) => {
    const segments = [
      new THREE.Mesh(ropeGeometry, ropeMaterial),
      new THREE.Mesh(ropeGeometry, ropeMaterial),
    ];
    segments.forEach((mesh) => {
      mesh.castShadow = true;
      ropes.add(mesh);
    });
    return {
      anchor: new THREE.Vector3(...anchor),
      local: new THREE.Vector3(...points[i]),
      segments,
    };
  });
  const sample = new THREE.Vector3(),
    forward = new THREE.Vector3(),
    right = new THREE.Vector3();
  const tilt = new THREE.Quaternion(),
    angles = new THREE.Euler();
  const end = new THREE.Vector3(),
    middle = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    up = new THREE.Vector3(0, 1, 0);
  function wave(point: THREE.Vector3, time: number) {
    return waterSurfaceOffset(
      point.x,
      point.z,
      seaLevel - heightAt(point.x, point.z),
      time,
    );
  }
  return {
    objects: boats.map((boat) => boat.object),
    ropes,
    waterMask,
    update(time: number) {
      for (const boat of boats) {
        const length = boat.buoy ? 1 : boat.yacht ? 8 : 4,
          width = boat.buoy ? 1 : boat.yacht ? 2.8 : 1.8;
        forward.set(0, 0, 1).applyQuaternion(boat.rotation);
        right.set(1, 0, 0).applyQuaternion(boat.rotation);
        const front = wave(
          sample.copy(boat.position).addScaledVector(forward, length / 2),
          time,
        );
        const back = wave(
          sample.copy(boat.position).addScaledVector(forward, -length / 2),
          time,
        );
        const starboard = wave(
          sample.copy(boat.position).addScaledVector(right, width / 2),
          time,
        );
        const port = wave(
          sample.copy(boat.position).addScaledVector(right, -width / 2),
          time,
        );
        const pitch =
          Math.atan2(back - front, length) +
          (boat.buoy
            ? 0.012 * Math.sin(time * 0.73 + boat.phase)
            : boat.yacht
              ? 0.006 * Math.cos(time * 0.47)
              : 0);
        const roll =
          Math.atan2(starboard - port, width) +
          (boat.buoy
            ? 0.025 * Math.sin(time * 0.92 + boat.phase)
            : boat.yacht
              ? 0.018 * Math.sin(time * 0.63 + 1.2)
              : 0.006 * Math.sin(time * 0.8));
        boat.object.position.copy(boat.position).y += wave(boat.position, time);
        boat.object.quaternion
          .copy(boat.rotation)
          .multiply(tilt.setFromEuler(angles.set(pitch, 0, roll)));
        boat.object.updateWorldMatrix(true, true);
      }
      waterMask.inverse.value.copy(boat.matrixWorld).invert();
      for (const line of lines) {
        end.copy(line.local).applyMatrix4(boat.matrixWorld);
        middle.copy(line.anchor).lerp(end, 0.5);
        middle.y -= 0.45;
        const positions = [line.anchor, middle, end];
        line.segments.forEach((segment, i) => {
          direction.subVectors(positions[i + 1], positions[i]);
          segment.position.copy(positions[i]).lerp(positions[i + 1], 0.5);
          segment.scale.y = direction.length();
          segment.quaternion.setFromUnitVectors(up, direction.normalize());
        });
      }
    },
  };
}
