import * as THREE from 'three';
import { seaLevel } from './terrain.ts';
import { tropicalRoute, tropicalTerrain } from './tropical-map.ts';

type Point = Pick<THREE.Vector3, 'x' | 'z'>;
const spacing = 0.75;

export function distanceToCarPath(point: Point, car: Point, velocity: Point) {
  const lookAhead = Math.min(
    0.9,
    24 / Math.max(1, Math.hypot(velocity.x, velocity.z)),
  );
  const dx = velocity.x * lookAhead,
    dz = velocity.z * lookAhead;
  const t = THREE.MathUtils.clamp(
    ((point.x - car.x) * dx + (point.z - car.z) * dz) /
      (dx * dx + dz * dz || 1),
    0,
    1,
  );
  return Math.hypot(point.x - car.x - t * dx, point.z - car.z - t * dz);
}

export function createCrabNavigation(
  heightAt: (x: number, z: number) => number,
  obstacles: THREE.Box3[],
) {
  const blocked = obstacles.map((box) => box.clone().expandByScalar(0.55));
  function clear(x: number, z: number) {
    return (
      Math.abs(x) < 140 &&
      Math.abs(z) < 140 &&
      heightAt(x, z) > seaLevel + 0.85 &&
      tropicalTerrain.coastAt(x, z) > 0.4 &&
      tropicalTerrain.mountainAt(x, z) < 0.7 &&
      tropicalRoute.distanceToRoad(x, z) > 5 &&
      Math.hypot(
        heightAt(x + 0.3, z) - heightAt(x - 0.3, z),
        heightAt(x, z + 0.3) - heightAt(x, z - 0.3),
      ) < 0.45 &&
      !blocked.some(
        (box) =>
          x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z,
      )
    );
  }
  function segmentClear(a: Point, b: Point) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2);
    for (let i = 1; i <= steps; i++) {
      if (
        !clear(a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps)
      )
        return false;
    }
    return true;
  }
  const nodes = new Map<
    string,
    { x: number; z: number; neighbors?: string[] }
  >();
  const rejected = new Set<string>();
  function node(ix: number, iz: number) {
    const key = `${ix},${iz}`;
    if (rejected.has(key)) return;
    if (nodes.has(key)) return key;
    const point = { x: ix * spacing, z: iz * spacing };
    if (!clear(point.x, point.z)) {
      rejected.add(key);
      return;
    }
    nodes.set(key, point);
    return key;
  }
  function neighbors(key: string) {
    const point = nodes.get(key)!;
    if (point.neighbors) return point.neighbors;
    point.neighbors = [];
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) {
        if (!x && !z) continue;
        const next = node(
          Math.round(point.x / spacing) + x,
          Math.round(point.z / spacing) + z,
        );
        if (next && segmentClear(point, nodes.get(next)!))
          point.neighbors.push(next);
      }
    return point.neighbors;
  }
  function path(
    origin: Point,
    score: (point: Point) => number,
    goal: (point: Point) => boolean,
    allows: (a: Point, b: Point) => boolean = () => true,
  ) {
    // Connect the exact foot position to the nearest reachable grid point.
    let start: string | undefined,
      nearest = Infinity;
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++) {
        const key = node(
          Math.round(origin.x / spacing) + x,
          Math.round(origin.z / spacing) + z,
        );
        if (!key) continue;
        const point = nodes.get(key)!;
        const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
        if (
          distance < nearest &&
          segmentClear(origin, point) &&
          allows(origin, point)
        ) {
          nearest = distance;
          start = key;
        }
      }
    if (!start) return [];
    const queue = [start],
      parents = new Map<string, string | null>([[start, null]]);
    let best = start,
      bestScore = score(nodes.get(start)!);
    for (let i = 0; i < queue.length && i < 2200; i++) {
      const key = queue[i],
        point = nodes.get(key)!;
      const value = score(point);
      if (value > bestScore) {
        best = key;
        bestScore = value;
      }
      if (goal(point)) {
        best = key;
        break;
      }
      for (const next of [...neighbors(key)].sort(
        (a, b) => score(nodes.get(b)!) - score(nodes.get(a)!),
      )) {
        if (parents.has(next) || !allows(point, nodes.get(next)!)) continue;
        parents.set(next, key);
        queue.push(next);
      }
    }
    const route: Point[] = [];
    for (let key: string | null = best; key !== null; key = parents.get(key)!)
      route.push(nodes.get(key)!);
    route.reverse();
    // Remove grid zigzags only when the entire shortcut remains on clear sand.
    const smooth: Point[] = [];
    let from = origin;
    for (let i = 0; i < route.length;) {
      let next = route.length - 1;
      while (
        next > i &&
        (!segmentClear(from, route[next]) || !allows(from, route[next]))
      )
        next--;
      smooth.push(route[next]);
      from = route[next];
      i = next + 1;
    }
    return smooth;
  }
  return {
    escape(origin: Point, car: Point, velocity: Point, side = 0) {
      const speed = Math.hypot(velocity.x, velocity.z);
      const clearance = Math.min(
        2.8,
        Math.hypot(origin.x - car.x, origin.z - car.z) - 0.01,
      );
      function lateral(point: Point) {
        const distance =
          ((point.z - car.z) * velocity.x - (point.x - car.x) * velocity.z) /
          Math.max(1, speed);
        return side ? distance * side : Math.abs(distance);
      }
      return path(
        origin,
        (point) =>
          Math.min(12, Math.hypot(point.x - car.x, point.z - car.z)) +
          (speed > 6
            ? 3 * Math.min(5, lateral(point))
            : Math.min(8, distanceToCarPath(point, car, velocity))),
        (point) =>
          Math.hypot(point.x - car.x, point.z - car.z) >= 10 &&
          distanceToCarPath(point, car, velocity) >= 3.5 &&
          (speed <= 6 || lateral(point) >= 3.5),
        (a, b) => {
          const dx = b.x - a.x,
            dz = b.z - a.z;
          const t = THREE.MathUtils.clamp(
            ((car.x - a.x) * dx + (car.z - a.z) * dz) /
              (dx * dx + dz * dz || 1),
            0,
            1,
          );
          return (
            Math.hypot(a.x + t * dx - car.x, a.z + t * dz - car.z) >= clearance
          );
        },
      );
    },
    wander(origin: Point, angle: number) {
      return path(
        origin,
        (point) =>
          (point.x - origin.x) * Math.cos(angle) +
          (point.z - origin.z) * Math.sin(angle),
        (point) => Math.hypot(point.x - origin.x, point.z - origin.z) >= 1.5,
      );
    },
  };
}
