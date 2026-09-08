import * as THREE from 'three';

export const terrainSize = 300;
export const terrainSegments = 240;
export const roadWidth = 7.6;
export const seaLevel = -0.6;

export function mountainHeight(x: number, z: number) {
  // A finite footprint leaves the road and its shoulders completely untouched.
  const tall = 19 * Math.max(0, 1 - Math.hypot(x + 14, z + 4) / 11.5) ** 1.4;
  const short = 14.5 * Math.max(0, 1 - Math.hypot(x + 5, z - 4) / 10) ** 1.4;
  return Math.max(tall, short) + Math.min(tall, short) * 0.3;
}

function coastAmount(x: number, z: number) {
  const angle = Math.atan2(z, x);
  const radius = 86 + 4 * Math.sin(angle * 3) + 3 * Math.cos(angle * 5);
  return THREE.MathUtils.smoothstep(Math.hypot(x, z), radius - 14, radius + 20);
}

// The first ridge sits on a fast straight; the rest forms broad hills and valleys.
export function terrainHeight(x: number, z: number) {
  const hill = (
    cx: number,
    cz: number,
    sx: number,
    sz: number,
    height: number,
  ) => height * Math.exp(-0.5 * (((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const inland =
    1.8 +
    1.2 * Math.sin(x * 0.045) * Math.cos(z * 0.04) +
    0.55 * Math.sin(z * 0.09) +
    hill(0, 30, 8, 18, 3.8) +
    hill(34, -27, 17, 12, 6) +
    hill(-36, -19, 12, 16, 4.5) -
    hill(3, -10, 18, 13, 1.6);
  return (
    THREE.MathUtils.lerp(inland, -7, coastAmount(x, z)) + mountainHeight(x, z)
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

export function createTerrainGeometry() {
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
  return geometry;
}

export function createTerrain() {
  const geometry = createTerrainGeometry();

  // Painting the road on the terrain makes it follow every hill without overlapping meshes.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4096;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the terrain texture');
  const pixelsPerMeter = canvas.width / terrainSize;
  // Bake the beach into the ground texture, keeping the road on the same surface.
  const base = document.createElement('canvas');
  base.width = base.height = 256;
  const baseContext = base.getContext('2d')!;
  const pixels = baseContext.createImageData(base.width, base.height);
  for (let y = 0; y < base.height; y++) {
    for (let x = 0; x < base.width; x++) {
      const coast = coastAmount(
        (x / (base.width - 1) - 0.5) * terrainSize,
        (y / (base.height - 1) - 0.5) * terrainSize,
      );
      const beach = THREE.MathUtils.smoothstep(coast, 0.035, 0.23);
      const offset = (y * base.width + x) * 4;
      pixels.data[offset] = THREE.MathUtils.lerp(145, 226, beach);
      pixels.data[offset + 1] = THREE.MathUtils.lerp(174, 208, beach);
      pixels.data[offset + 2] = THREE.MathUtils.lerp(112, 163, beach);
      const mountain = mountainHeight(
        (x / (base.width - 1) - 0.5) * terrainSize,
        (y / (base.height - 1) - 0.5) * terrainSize,
      );
      const rock = THREE.MathUtils.smoothstep(mountain, 4, 10);
      const summit = THREE.MathUtils.smoothstep(mountain, 13, 18);
      [139, 148, 140].forEach((channel, i) => {
        const stone = THREE.MathUtils.lerp(channel, 218, summit);
        pixels.data[offset + i] = THREE.MathUtils.lerp(
          pixels.data[offset + i],
          stone,
          rock,
        );
      });
      pixels.data[offset + 3] = 255;
    }
  }
  baseContext.putImageData(pixels, 0, 0);
  context.drawImage(base, 0, 0, canvas.width, canvas.height);
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

export function createOcean() {
  const geometry = new THREE.PlaneGeometry(800, 800, 200, 200);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  const colors = new THREE.Float32BufferAttribute(positions.count * 3, 3);
  const shallow = new THREE.Color('#80c9ba');
  const deep = new THREE.Color('#337d98');
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const depth =
      seaLevel - terrainHeight(positions.getX(i), positions.getZ(i));
    color.copy(shallow).lerp(deep, THREE.MathUtils.smoothstep(depth, 0, 6));
    colors.setXYZ(i, color.r, color.g, color.b);
  }
  geometry.setAttribute('color', colors);
  const ocean = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.12,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  ocean.name = 'Ocean';
  ocean.position.y = seaLevel;
  return ocean;
}
