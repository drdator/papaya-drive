import * as THREE from 'three';

export const terrainSize = 300;
export const terrainSegments = 240;
export const roadWidth = 7.6;

// The first ridge sits on a fast straight; the rest forms broad hills and valleys.
export function terrainHeight(x: number, z: number) {
  const hill = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    height: number,
  ) => height * Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  return (
    1.8 +
    1.2 * Math.sin(x * 0.045) * Math.cos(z * 0.04) +
    0.55 * Math.sin(z * 0.09) +
    hill(0, 30, 8, 18, 3.8) +
    hill(34, -27, 17, 12, 6) +
    hill(-36, -19, 12, 16, 4.5) -
    hill(3, -10, 18, 13, 1.6)
  );
}

const curve = new THREE.CatmullRomCurve3(
  [
    [-32, 30],
    [-12, 30],
    [12, 30],
    [35, 25],
    [48, 5],
    [30, -9],
    [42, -34],
    [14, -43],
    [-5, -24],
    [-27, -40],
    [-48, -20],
    [-36, 2],
    [-51, 30],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  true,
  'centripetal',
);
curve.arcLengthDivisions = 1400;
export const routeSamples = curve.getSpacedPoints(480);
export const routeLength = curve.getLength();

export function route(progress: number) {
  const p = curve.getPointAt(((progress % 1) + 1) % 1);
  p.y = terrainHeight(p.x, p.z);
  return p;
}
export function routeHeading(progress: number) {
  const tangent = curve.getTangentAt(((progress % 1) + 1) % 1);
  return Math.atan2(tangent.x, tangent.z);
}
export function distanceToRoad(x: number, z: number) {
  let distanceSquared = Infinity;
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
    distanceSquared = Math.min(
      distanceSquared,
      (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2,
    );
  }
  return Math.sqrt(distanceSquared);
}

export function createTerrain() {
  const geometry = new THREE.PlaneGeometry(
    terrainSize,
    terrainSize,
    terrainSegments,
    terrainSegments,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++)
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals();

  // Painting the road on the terrain makes it follow every hill without overlapping meshes.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4096;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the terrain texture');
  const pixelsPerMeter = canvas.width / terrainSize;
  context.fillStyle = '#91ae70';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.lineJoin = context.lineCap = 'round';
  context.beginPath();
  routeSamples.forEach((p, i) => {
    const x = (p.x + terrainSize / 2) * pixelsPerMeter;
    const y = (p.z + terrainSize / 2) * pixelsPerMeter;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.strokeStyle = '#a7af79';
  context.lineWidth = (roadWidth + 0.8) * pixelsPerMeter;
  context.stroke();
  context.strokeStyle = '#d9c49a';
  context.lineWidth = roadWidth * pixelsPerMeter;
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      flatShading: true,
    }),
  );
  terrain.receiveShadow = true;
  return terrain;
}
