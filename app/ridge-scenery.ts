import * as THREE from 'three';
import { forestTerrain, distanceToRoad, route, seaLevel } from './terrain.ts';
import { riverDistance } from './ridge-river.ts';
import { createGrass } from './grass.ts';
import { createMushrooms, type MushroomPlacement } from './mushrooms.ts';

// Shared by the game and lighting exporter so placement and collision stay aligned.
export function createRidgeScenery(models: THREE.Object3D[]) {
  const group = new THREE.Group();
  group.name = 'Ridge woodland scenery';
  const obstacles = [];
  const start = route(0);
  let seed = 81;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 440; i++) {
    const spread = i < 255 ? 145 : 235;
    const x = (random() - 0.5) * spread;
    const z = (random() - 0.5) * spread;
    if (distanceToRoad(x, z) < 6.4) continue;
    if (riverDistance(x, z) < 2.5) continue;
    if (Math.hypot(x - start.x, z - start.z) < 8) continue;
    const surface = forestTerrain.heightAt(x, z);
    if (surface < seaLevel + 1.2) continue;
    const isTree = random() > 0.32;
    const index = isTree
      ? Math.floor(random() * 3)
      : 3 + Math.floor(random() * 3);
    const model = models[index].clone(true);
    const scale = isTree ? 1.6 + random() * 1.5 : 0.9 + random() * 1.25;
    model.scale.setScalar(scale);
    model.position.set(x, surface - 0.08, z);
    model.rotation.y = random() * Math.PI * 2;
    const mountainHeight = forestTerrain.mountainAt(x, z);
    if (isTree && mountainHeight > (Math.hypot(x, z) > 68 ? 24 : 6)) continue;
    if (!isTree && Math.hypot(x, z) < 40 && mountainHeight > 4) continue;
    group.add(model);
    obstacles.push({
      x,
      z,
      radius: (isTree ? 0.16 : index === 4 ? 0.8 : 0.67) * scale,
      bottom: surface,
      top: surface + (isTree ? 3.5 : index === 4 ? 0.6 : 1.4) * scale,
    });
  }
  // Loose pockets beside the trail leave plenty of open ground between them.
  const heightAt = forestTerrain.heightAt;
  const grass = createGrass(heightAt, random);
  for (let patch = 0; patch < 75; patch++) {
    const cx = (random() - 0.5) * 140;
    const cz = (random() - 0.5) * 140;
    const distance = distanceToRoad(cx, cz);
    if (distance < 8 || distance > 21) continue;
    const radius = 1.5 + random() * 2;
    const count = 5 + Math.floor(random() * 6);
    for (let tuft = 0; tuft < count; tuft++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      if (
        distanceToRoad(x, z) < 6.8 ||
        riverDistance(x, z) < 3.5 ||
        heightAt(x, z) < seaLevel + 1.2 ||
        forestTerrain.mountainAt(x, z) > 4 ||
        obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 0.6)
      )
        continue;
      const slope = Math.hypot(
        heightAt(x + 0.4, z) - heightAt(x - 0.4, z),
        heightAt(x, z + 0.4) - heightAt(x, z - 0.4),
      );
      if (slope < 0.7) grass.addTuft(x, z);
    }
  }
  group.add(grass.build('Sparse ridge grass'));
  // Just eight separated woodland spots, with a lone mushroom or a small pair.
  const mushrooms: MushroomPlacement[] = [];
  const patches: { x: number; z: number }[] = [];
  const trees = obstacles.filter((o) => o.top - o.bottom > 4);
  for (let attempt = 0; attempt < 300 && patches.length < 8; attempt++) {
    const tree = trees[Math.floor(random() * trees.length)];
    const angle = random() * Math.PI * 2;
    const radius = tree.radius + 1.2 + random() * 1.8;
    const x = tree.x + Math.cos(angle) * radius;
    const z = tree.z + Math.sin(angle) * radius;
    if (
      distanceToRoad(x, z) < 7.5 ||
      distanceToRoad(x, z) > 18 ||
      riverDistance(x, z) < 4 ||
      heightAt(x, z) < seaLevel + 1.2 ||
      forestTerrain.mountainAt(x, z) > 4 ||
      patches.some((p) => Math.hypot(p.x - x, p.z - z) < 14) ||
      obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + 1.1) ||
      Math.hypot(
        heightAt(x + 0.5, z) - heightAt(x - 0.5, z),
        heightAt(x, z + 0.5) - heightAt(x, z - 0.5),
      ) > 0.45
    )
      continue;
    const kind = patches.length % 2 ? 'king-bolete' : 'fly-agaric';
    const count = patches.length % 4 < 2 ? 2 : 1;
    patches.push({ x, z });
    for (let i = 0; i < count; i++) {
      mushrooms.push({
        x: x + i * 0.65,
        z: z + i * 0.25,
        scale: i === 0 ? 0.8 + random() * 0.2 : 0.55 + random() * 0.15,
        rotation: random() * Math.PI * 2,
        kind,
      });
    }
  }
  group.add(createMushrooms(mushrooms, heightAt));
  return { group, obstacles };
}
