// Shared by the runtime, route, and Blender exporter. Logical coordinates only
// organize the neighborhoods; their world positions follow the valley's bends.
export const cityStreets = [-120, -80, -40, 0, 40, 80, 120];
export const cityCenters = [-100, -60, -20, 20, 60, 100];
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export function cityPoint(x: number, z: number): [number, number] {
  return [
    1.4 * x + 26 * Math.sin(z / 65) + 12 * Math.sin(x / 70 + z / 110),
    1.35 * z + 24 * Math.sin(x / 78) - 14 * Math.cos(z / 65),
  ];
}
export function citySlope(x: number, z: number) {
  return (
    2 +
    23 * Math.exp(-(((x + 125) / 95) ** 2) - ((z + 95) / 110) ** 2) +
    15 * Math.exp(-(((x - 140) / 90) ** 2) - ((z - 70) / 100) ** 2)
  );
}
export const cityBlocks = cityCenters.flatMap((z) =>
  cityCenters.map((x) => {
    const [wx, wz] = cityPoint(x, z);
    const [ax, az] = cityPoint(x + 0.1, z);
    const [bx, bz] = cityPoint(x, z + 0.1);
    const angle = Math.atan2(az - wz - (bx - wx), ax - wx + bz - wz);
    return { x, z, wx, wz, angle, height: citySlope(wx, wz) };
  }),
);
// Merged green blocks and missing links break the grid into distinct districts.
export const cityParks = [
  [-100, 60],
  [-60, 100],
  [-100, 100],
  [60, -60],
  [100, -60],
  [-100, 20],
  [-60, 20],
  [20, -20],
  [20, -60],
];
export const closedCityLinks = [
  [-120, 40, -120, 80],
  [-120, 80, -120, 120],
  [-120, 120, -80, 120],
  [-80, 80, -80, 120],

  [0, 0, 0, 40],
  [0, 40, 0, 80],
  [-80, -40, -80, 0],
  [-40, -120, -40, -80],
  [80, 80, 80, 120],
  [40, -80, 80, -80],
  [80, 0, 120, 0],
  [-120, -40, -80, -40],

  [80, -80, 80, -40],
  [-80, 0, -80, 40],
  [0, -120, 0, -80],
  [0, -40, 40, -40],
  [40, 40, 80, 40],
  [-120, 80, -80, 80],
];
export const cityRoads: number[][][] = [];
for (const s of cityStreets) {
  for (let i = 0; i < cityStreets.length - 1; i++) {
    const a = cityStreets[i],
      b = cityStreets[i + 1];
    for (const edge of [
      [s, a, s, b],
      [a, s, b, s],
    ]) {
      if (closedCityLinks.some((link) => link.every((v, j) => v === edge[j])))
        continue;
      const [x, z, nx, nz] = edge;
      cityRoads.push(
        Array.from({ length: 21 }, (_, j) =>
          cityPoint(x + ((nx - x) * j) / 20, z + ((nz - z) * j) / 20),
        ),
      );
    }
  }
}
// A diagonal avenue cuts across the lower gardens and trims the city's corner.
export const cityAvenue = [
  [-120, 40],
  [-104, 49],
  [-87, 69],
  [-70, 91],
  [-53, 112],
  [-40, 120],
];
const avenue: number[][] = [];
for (let i = 1; i < cityAvenue.length; i++) {
  const [ax, az] = cityAvenue[i - 1],
    [bx, bz] = cityAvenue[i];
  for (let j = 0; j < 12; j++)
    avenue.push(
      cityPoint(ax + ((bx - ax) * j) / 12, az + ((bz - az) * j) / 12),
    );
}
avenue.push(cityPoint(-40, 120));
cityRoads.push(avenue);

export function cityMountainHeight(x: number, z: number) {
  const foothills = smooth(
    (Math.max(Math.abs(x) / 1.05, Math.abs(z)) - 210) / 55,
  );
  let height = 0;
  for (const [cx, cz, rx, rz, h] of [
    [-285, -165, 105, 110, 108],
    [-165, -320, 115, 85, 145],
    [50, -315, 100, 95, 114],
    [265, -255, 95, 110, 164],
    [325, -15, 100, 135, 117],
    [285, 235, 110, 110, 133],
    [40, 320, 145, 105, 104],
    [-235, 280, 115, 100, 151],
    [-340, 60, 100, 145, 127],
  ]) {
    const radius = Math.hypot((x - cx + (z - cz) * 0.22) / rx, (z - cz) / rz);
    const peak = h * Math.max(0, 1 - radius ** 1.6) ** 1.3;
    height = Math.max(height, peak);
  }
  return foothills * (12 + height * (1 + 0.08 * Math.sin(x * 0.07 + z * 0.04)));
}
export function cityHeight(x: number, z: number) {
  let height = citySlope(x, z);
  // Level building pads blend into graded streets and gentle retaining banks.
  for (const block of cityBlocks) {
    const dx = x - block.wx,
      dz = z - block.wz;
    if (Math.abs(dx) > 26 || Math.abs(dz) > 26) continue;
    const c = Math.cos(block.angle),
      s = Math.sin(block.angle);
    const radius = Math.max(
      Math.abs(dx * c + dz * s),
      Math.abs(-dx * s + dz * c),
    );
    const blend = 1 - smooth((radius - 13.5) / 9);
    height += (block.height - height) * blend;
  }
  return height + cityMountainHeight(x, z);
}
export function cityRoadDistance(x: number, z: number) {
  let distance = Infinity;
  for (const road of cityRoads)
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1],
        [bx, bz] = road[i];
      const dx = bx - ax,
        dz = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
      );
      distance = Math.min(
        distance,
        Math.hypot(x - ax - t * dx, z - az - t * dz),
      );
    }
  return distance;
}
