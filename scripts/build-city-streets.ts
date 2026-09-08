import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { cityRoads, cityHeight } from '../app/city-layout.ts';

type Point = [number, number];
type Surface = { vertices: number[][]; faces: number[][] };

// Roads are unioned before meshing, so junctions have no overlapping surfaces
// and sidewalk/curb boundaries stop at every street opening.
function stroke(road: number[][], width: number): polygonClipping.Polygon {
  const path = road.filter((_, i) => i % 4 === 0 || i === road.length - 1);
  const left: Point[] = [],
    right: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = new THREE.Vector2(...path[i]);
    const before = new THREE.Vector2(...path[Math.max(0, i - 1)]);
    const after = new THREE.Vector2(...path[Math.min(path.length - 1, i + 1)]);
    const incoming = (
      i ? p.clone().sub(before) : after.clone().sub(p)
    ).normalize();
    const outgoing = (
      i < path.length - 1 ? after.clone().sub(p) : incoming.clone()
    ).normalize();
    const normal = new THREE.Vector2(
      -incoming.y - outgoing.y,
      incoming.x + outgoing.x,
    ).normalize();
    const offset = normal.multiplyScalar(
      width / normal.dot(new THREE.Vector2(-incoming.y, incoming.x)),
    );
    if (i === 0) p.addScaledVector(incoming, -width);
    if (i === path.length - 1) p.addScaledVector(outgoing, width);
    left.push([p.x + offset.x, p.y + offset.y]);
    right.push([p.x - offset.x, p.y - offset.y]);
  }
  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]);
  return [ring];
}

// Match the game's actual 1.25 m terrain triangles, including their diagonals.
// Road geometry can then sit only a centimetre above the ground without flicker.
function surfaceHeight(x: number, z: number) {
  const ax = Math.floor((x + 230) / 1.25) * 1.25 - 230;
  const az = Math.floor((z + 230) / 1.25) * 1.25 - 230;
  const u = (x - ax) / 1.25,
    v = (z - az) / 1.25;
  const b = cityHeight(ax + 1.25, az),
    c = cityHeight(ax, az + 1.25);
  return u + v <= 1
    ? cityHeight(ax, az) * (1 - u - v) + b * u + c * v
    : cityHeight(ax + 1.25, az + 1.25) * (u + v - 1) +
        b * (1 - v) +
        c * (1 - u);
}
function clip(points: Point[], distance: (p: Point) => number) {
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = distance(a),
      db = distance(b);
    if (da >= 0) result.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}
function face(surface: Surface, points: Point[], lift: number) {
  if (points.length < 3) return;
  const start = surface.vertices.length;
  surface.vertices.push(
    ...points.map(([x, z]) => [x, surfaceHeight(x, z) + lift, z]),
  );
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[0], points[i], points[i + 1]];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) < 1e-8) continue;
    surface.faces.push(
      cross < 0
        ? [start, start + i, start + i + 1]
        : [start, start + i + 1, start + i],
    );
  }
}
function top(polygons: polygonClipping.MultiPolygon, lift: number): Surface {
  const surface: Surface = { vertices: [], faces: [] };
  for (const polygon of polygons) {
    const rings = polygon.map((ring) =>
      ring.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)),
    );
    const triangles = THREE.ShapeUtils.triangulateShape(
      rings[0],
      rings.slice(1),
    );
    const vertices = rings.flat();
    for (const triangle of triangles) {
      const points: Point[] = triangle.map((i) => [
        vertices[i].x,
        vertices[i].y,
      ]);
      const xs = points.map((p) => p[0]),
        zs = points.map((p) => p[1]);
      for (
        let z = Math.floor((Math.min(...zs) + 230) / 1.25) * 1.25 - 230;
        z < Math.max(...zs);
        z += 1.25
      )
        for (
          let x = Math.floor((Math.min(...xs) + 230) / 1.25) * 1.25 - 230;
          x < Math.max(...xs);
          x += 1.25
        ) {
          let part = clip(points, (p) => p[0] - x);
          part = clip(part, (p) => x + 1.25 - p[0]);
          part = clip(part, (p) => p[1] - z);
          part = clip(part, (p) => z + 1.25 - p[1]);
          face(
            surface,
            clip(part, (p) => x + z + 1.25 - p[0] - p[1]),
            lift,
          );
          face(
            surface,
            clip(part, (p) => p[0] + p[1] - x - z - 1.25),
            lift,
          );
        }
    }
  }
  return surface;
}
export function buildCityStreets() {
  const [firstRoad, ...otherRoads] = cityRoads.map((road) => stroke(road, 7));
  const [firstOuter, ...otherOuter] = cityRoads.map((road) => stroke(road, 10));
  const roads = polygonClipping.union(firstRoad, ...otherRoads);
  const outer = polygonClipping.union(firstOuter, ...otherOuter);
  const sidewalks = polygonClipping.difference(outer, roads);
  const curb: Surface = { vertices: [], faces: [] };
  for (const polygon of sidewalks)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const [ax, az] = ring[i - 1],
          [bx, bz] = ring[i];
        const steps = Math.ceil(Math.hypot(bx - ax, bz - az));
        for (let j = 0; j < steps; j++) {
          const x = ax + ((bx - ax) * j) / steps,
            z = az + ((bz - az) * j) / steps;
          const nx = ax + ((bx - ax) * (j + 1)) / steps,
            nz = az + ((bz - az) * (j + 1)) / steps;
          const y = surfaceHeight(x, z),
            ny = surfaceHeight(nx, nz),
            start = curb.vertices.length;
          curb.vertices.push(
            [x, y - 0.01, z],
            [nx, ny - 0.01, nz],
            [nx, ny + 0.18, nz],
            [x, y + 0.18, z],
          );
          curb.faces.push([start, start + 1, start + 2, start + 3]);
        }
      }
  return { asphalt: top(roads, 0.012), sidewalk: top(sidewalks, 0.18), curb };
}
