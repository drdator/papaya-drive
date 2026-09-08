import * as THREE from 'three';

export function createMapRoute(
  points: number[][],
  heightAt: (x: number, z: number) => number,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    'centripetal',
  );
  curve.arcLengthDivisions = 1400;
  const routeSamples = curve.getSpacedPoints(480);
  return {
    routeSamples,
    routeLength: curve.getLength(),
    route: (progress: number) => {
      const p = curve.getPointAt(((progress % 1) + 1) % 1);
      p.y = heightAt(p.x, p.z);
      return p;
    },
    routeHeading: (progress: number) => {
      const tangent = curve.getTangentAt(((progress % 1) + 1) % 1);
      return Math.atan2(tangent.x, tangent.z);
    },
    distanceToRoad: (x: number, z: number) => {
      let nearest = Infinity;
      for (let i = 1; i < routeSamples.length; i++) {
        const a = routeSamples[i - 1],
          b = routeSamples[i];
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(
          ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz),
          0,
          1,
        );
        nearest = Math.min(
          nearest,
          (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2,
        );
      }
      return Math.sqrt(nearest);
    },
  };
}
