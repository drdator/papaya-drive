import * as THREE from 'three';
import { createPlanarMotion, advancePlanarMotion } from './vehicle-motion';
import { createSkidMarks } from './skid-marks';
import { createVehicleDamage, advanceVehicleDamage } from './vehicle-damage';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createTerrain,
  terrainHeight,
  route,
  routeHeading,
  routeLength,
  distanceToRoad,
} from './terrain';
import {
  groundUnderCar,
  createVerticalMotion,
  advanceVerticalMotion,
  wheelMounts,
} from './vehicle-ground';

export type GameStatus = {
  ready: boolean;
  speed: number;
  gate: number;
  lap: number;
  time: number;
  best: number | null;
  paused: boolean;
  error: string | null;
  started: boolean;
  airborne: boolean;
  skidding: boolean;
  damage: number;
};
export type GameControls = {
  dispose(): void;
  reset(): void;
  togglePause(): void;
  setKey(key: string, down: boolean): void;
};
type Obstacle = {
  x: number;
  z: number;
  radius: number;
  bottom: number;
  top: number;
};
const gateCount = 8;
const step = 1 / 120;

export function createGame(
  container: HTMLElement,
  onStatus: (status: GameStatus) => void,
): GameControls {
  const status: GameStatus = {
    ready: false,
    speed: 0,
    gate: 0,
    lap: 1,
    time: 0,
    best: null,
    paused: false,
    error: null,
    started: false,
    airborne: false,
    skidding: false,
    damage: 0,
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c5dfd6');
  scene.fog = new THREE.Fog('#c5dfd6', 55, 140);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    onStatus({
      ...status,
      error:
        'This browser needs WebGL enabled to play. Try another browser or enable hardware acceleration.',
    });
    return { dispose() {}, reset() {}, togglePause() {}, setKey() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute(
    'aria-label',
    '3D forest driving playground. Use W or Up to accelerate, S or Down to brake and reverse, A/D or Left/Right to steer, Space for the handbrake, R to reset, and Escape to pause.',
  );
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#f6f2db', '#6f8263', 2.4));
  const sun = new THREE.DirectionalLight('#fff0ce', 3.1);
  sun.position.set(-25, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -38,
    right: 38,
    top: 38,
    bottom: -38,
    near: 1,
    far: 120,
  });
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.00015;
  scene.add(sun, sun.target);

  const ground = createTerrain();
  scene.add(ground);
  const skidMarks = createSkidMarks();
  scene.add(skidMarks.mesh);

  // Small route posts make the edge legible without a hard track barrier.
  const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.65, 5);
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#f8eed6' });
  const postCount = Math.ceil(routeLength / 5);
  for (let i = 0; i < postCount; i++) {
    const progress = i / postCount;
    const p = route(progress);
    const heading = routeHeading(progress);
    for (const side of [-1, 1]) {
      const x = p.x + Math.cos(heading) * side * 4.2;
      const z = p.z - Math.sin(heading) * side * 4.2;
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(x, terrainHeight(x, z) + 0.325, z);
      post.castShadow = true;
      scene.add(post);
    }
  }

  const checkpoint = new THREE.Group();
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(2.85, 0.14, 5, 16, Math.PI),
    new THREE.MeshStandardMaterial({
      color: '#ffb932',
      emissive: '#eb8119',
      emissiveIntensity: 0.3,
      roughness: 0.4,
    }),
  );
  arch.position.y = 0.15;
  checkpoint.add(arch);
  const gatePad = new THREE.Mesh(
    new THREE.CircleGeometry(3.1, 32),
    new THREE.MeshBasicMaterial({
      color: '#ffcf65',
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  gatePad.rotation.x = -Math.PI / 2;
  gatePad.position.y = 0.04;
  checkpoint.add(gatePad);
  scene.add(checkpoint);
  const gatePositions = Array.from({ length: gateCount }, (_, i) =>
    route((i + 1) / gateCount),
  );
  function placeGate() {
    const heading = routeHeading((status.gate + 1) / gateCount);
    const p = gatePositions[status.gate];
    const surface = groundUnderCar(p.x, p.z, heading);
    checkpoint.position.set(p.x, surface.height, p.z);
    checkpoint.rotation.set(surface.pitch, heading, surface.bank, 'YXZ');
  }
  placeGate();

  const car = new THREE.Group();
  car.rotation.order = 'YXZ';
  scene.add(car);
  const wheels: {
    object: THREE.Object3D;
    rest: THREE.Quaternion;
    front: boolean;
    mountIndex: number;
    restHeight: number;
  }[] = [];
  const obstacles: Obstacle[] = [];
  const keys = new Set<string>();
  let disposed = false,
    frame = 0,
    heading = routeHeading(0),
    steering = 0,
    wheelAngle = 0;
  let previousTime = 0,
    accumulator = 0,
    hudTime = 0;
  // Physics owns this pose; the scene object is interpolated only for rendering.
  const position = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const motion = createPlanarMotion(heading);
  const damage = createVehicleDamage();
  const previousWheelOffsets = wheelMounts.map(() => 0);
  const start = route(0);
  const vertical = createVerticalMotion(
    groundUnderCar(start.x, start.z, heading),
  );
  let previousPitch = vertical.pitch,
    previousBank = vertical.bank;
  let previousHeading = heading,
    previousSteering = steering,
    previousWheelAngle = wheelAngle,
    previousSpeed = 0;
  const cameraGoal = new THREE.Vector3(),
    cameraLook = new THREE.Vector3(),
    cameraLookGoal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const roll = new THREE.Quaternion(),
    steer = new THREE.Quaternion();
  const localAxle = new THREE.Vector3(1, 0, 0);

  function reset() {
    position.copy(start);
    heading = routeHeading(0);
    Object.assign(motion, createPlanarMotion(heading));
    Object.assign(damage, createVehicleDamage());
    status.damage = 0;
    previousWheelOffsets.fill(0);
    skidMarks.reset();
    Object.assign(
      vertical,
      createVerticalMotion(groundUnderCar(position.x, position.z, heading)),
    );
    position.y = vertical.height;
    previousPosition.copy(position);
    car.position.copy(position);
    previousPitch = vertical.pitch;
    previousBank = vertical.bank;
    previousHeading = heading;
    car.rotation.y = heading;
    status.speed = 0;
    status.time = 0;
    status.gate = 0;
    status.started = false;
    status.airborne = false;
    status.skidding = false;
    status.paused = false;
    steering = 0;
    wheelAngle = 0;
    previousSteering = 0;
    previousWheelAngle = 0;
    previousSpeed = 0;
    accumulator = 0;
    renderCar(0);
    keys.clear();
    placeGate();
    camera.position.set(
      position.x - Math.sin(heading) * 12,
      position.y + 8,
      position.z - Math.cos(heading) * 12,
    );
    cameraLook
      .copy(position)
      .add(
        new THREE.Vector3(Math.sin(heading) * 4, 0.6, Math.cos(heading) * 4),
      );
    camera.lookAt(cameraLook);
    onStatus({ ...status });
  }
  function togglePause() {
    if (!status.ready) return;
    status.paused = !status.paused;
    keys.clear();
    onStatus({ ...status });
  }
  const controlledKeys = new Set([
    'w',
    'a',
    's',
    'd',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    ' ',
  ]);
  function setKey(key: string, down: boolean) {
    if (down && !status.paused) keys.add(key);
    else keys.delete(key);
  }
  function keyDown(event: KeyboardEvent) {
    if (
      event.target instanceof HTMLButtonElement &&
      [' ', 'Enter'].includes(event.key)
    )
      return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (controlledKeys.has(key)) {
      event.preventDefault();
      setKey(key, true);
    }
    if (!event.repeat && key === 'r') reset();
    if (!event.repeat && key === 'Escape') togglePause();
  }
  function keyUp(event: KeyboardEvent) {
    setKey(event.key.length === 1 ? event.key.toLowerCase() : event.key, false);
  }
  function blur() {
    keys.clear();
    if (status.ready && !status.paused) {
      status.paused = true;
      onStatus({ ...status });
    }
  }
  function visibility() {
    if (document.hidden) blur();
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility);
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  });
  resize.observe(container);

  let seed = 81;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const loader = new GLTFLoader();
  const assetNames = [
    'papaya-car',
    'tree-oak',
    'tree-aspen',
    'tree-pine',
    'rock-boulder',
    'rock-flat',
    'rock-crag',
  ];
  const loaded: THREE.Object3D[] = [];
  function release(object: THREE.Object3D) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material)
          ? child.material
          : [child.material])
          material.dispose();
      }
    });
  }
  Promise.all(
    assetNames.map(async (name) => {
      const gltf = await loader.loadAsync(`/models/${name}.glb`);
      if (disposed) {
        release(gltf.scene);
        return gltf.scene;
      }
      loaded.push(gltf.scene);
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      return gltf.scene;
    }),
  )
    .then((models) => {
      if (disposed) return;
      const body = models[0];
      car.add(body);
      const wheelObjects: THREE.Object3D[] = [];
      body.traverse((child) => {
        if (child.name.startsWith('Wheel_')) wheelObjects.push(child);
      });
      // Each wheel can compress or extend independently beneath the sprung body.
      for (const wheel of wheelObjects) {
        car.attach(wheel);
        wheels.push({
          object: wheel,
          rest: wheel.quaternion.clone(),
          front: wheel.name.startsWith('Wheel_F'),
          mountIndex: wheelMounts.findIndex(
            (mount) => mount.name === wheel.name,
          ),
          restHeight: wheel.position.y,
        });
      }
      // Keep the road and the starting spot clear. The same seven GLBs are used throughout.
      for (let i = 0; i < 255; i++) {
        const x = (random() - 0.5) * 145,
          z = (random() - 0.5) * 145;
        if (distanceToRoad(x, z) < 6.4) continue;
        if (Math.hypot(x - start.x, z - start.z) < 8) continue;
        const isTree = random() > 0.32;
        const index = isTree
          ? 1 + Math.floor(random() * 3)
          : 4 + Math.floor(random() * 3);
        const model = models[index].clone(true);
        const scale = isTree ? 1.6 + random() * 1.5 : 0.9 + random() * 1.25;
        model.scale.setScalar(scale);
        const surface = terrainHeight(x, z);
        model.position.set(x, surface - 0.08, z);
        model.rotation.y = random() * Math.PI * 2;
        scene.add(model);
        obstacles.push({
          x,
          z,
          radius: (isTree ? 0.16 : index === 5 ? 0.8 : 0.67) * scale,
          bottom: surface,
          top: surface + (isTree ? 3.5 : index === 5 ? 0.6 : 1.4) * scale,
        });
      }
      // Distant, faceted hills give the small world a horizon.
      const hillGeometry = new THREE.ConeGeometry(1, 1, 7);
      const hillMaterial = new THREE.MeshStandardMaterial({
        color: '#719879',
        flatShading: true,
      });
      for (let i = 0; i < 18; i++) {
        const angle = (i / 18) * Math.PI * 2;
        const height = 14 + random() * 18;
        const hill = new THREE.Mesh(hillGeometry, hillMaterial);
        hill.scale.set(18 + random() * 16, height, 18 + random() * 16);
        hill.position.set(
          Math.sin(angle) * 112,
          height / 2 - 2,
          Math.cos(angle) * 112,
        );
        scene.add(hill);
      }
      status.ready = true;
      reset();
    })
    .catch((error) => {
      if (!disposed) {
        console.error('Model loading failed', error);
        status.error =
          'The models couldn’t load. Check your connection and try again.';
        onStatus({ ...status });
      }
    });

  function simulate(dt: number) {
    previousPosition.copy(position);
    previousHeading = heading;
    previousSteering = steering;
    previousWheelAngle = wheelAngle;
    previousSpeed = status.speed;
    vertical.wheelOffsets.forEach((offset, i) => {
      previousWheelOffsets[i] = offset;
    });
    const previousVelocityX = motion.x,
      previousVelocityZ = motion.z;
    previousPitch = vertical.pitch;
    previousBank = vertical.bank;
    const wrecked = status.damage >= 100;
    const gas = !wrecked && (keys.has('w') || keys.has('ArrowUp'));
    const reverse = !wrecked && (keys.has('s') || keys.has('ArrowDown'));
    const brake = wrecked || keys.has(' ');
    const turn = wrecked
      ? 0
      : Number(keys.has('a') || keys.has('ArrowLeft')) -
        Number(keys.has('d') || keys.has('ArrowRight'));
    if (gas || reverse) status.started = true;
    if (status.started && !wrecked) status.time += dt;
    advancePlanarMotion(
      motion,
      { gas, reverse, brake, turn },
      vertical.grounded,
      vertical.pitch,
      dt,
    );
    heading = motion.heading;
    steering = motion.steering;
    const fx = Math.sin(heading),
      fz = Math.cos(heading);
    position.x += motion.x * dt;
    position.z += motion.z * dt;
    let strongestImpact = 0;
    // Two circles approximate the long car body, with sliding and a small bounce.
    for (const obstacle of obstacles) {
      if (
        position.y > obstacle.top ||
        position.y + 1.6 < obstacle.bottom ||
        Math.abs(position.x - obstacle.x) > obstacle.radius + 3 ||
        Math.abs(position.z - obstacle.z) > obstacle.radius + 3
      )
        continue;
      for (const offset of [-0.85, 0.85]) {
        const dx = position.x + fx * offset - obstacle.x,
          dz = position.z + fz * offset - obstacle.z;
        const distance = Math.hypot(dx, dz),
          radius = obstacle.radius + 0.85;
        if (distance < radius) {
          const nx = distance > 0.0001 ? dx / distance : 1,
            nz = distance > 0.0001 ? dz / distance : 0;
          position.x += nx * (radius - distance);
          position.z += nz * (radius - distance);
          const impact = motion.x * nx + motion.z * nz;
          if (impact < 0) {
            strongestImpact = Math.max(strongestImpact, -impact);
            motion.x -= nx * impact * 1.18;
            motion.z -= nz * impact * 1.18;
          }
        }
      }
    }
    advanceVehicleDamage(damage, strongestImpact, dt);
    status.damage = damage.amount;
    const distanceFromCenter = Math.hypot(position.x, position.z);
    if (distanceFromCenter > 81) {
      position.x *= 81 / distanceFromCenter;
      position.z *= 81 / distanceFromCenter;
      const nx = position.x / 81,
        nz = position.z / 81;
      const outwardSpeed = motion.x * nx + motion.z * nz;
      if (outwardSpeed > 0) {
        motion.x -= nx * outwardSpeed * 1.3;
        motion.z -= nz * outwardSpeed * 1.3;
      }
    }
    const surface = groundUnderCar(position.x, position.z, heading);
    const forwardSpeed = motion.x * fx + motion.z * fz;
    const sidewaysSpeed = motion.x * fz - motion.z * fx;
    status.speed =
      Math.hypot(motion.x, motion.z) * (forwardSpeed < -0.1 ? -1 : 1);
    advanceVerticalMotion(vertical, surface, dt, {
      forward:
        ((motion.x - previousVelocityX) * fx +
          (motion.z - previousVelocityZ) * fz) /
        dt,
      sideways:
        ((motion.x - previousVelocityX) * fz -
          (motion.z - previousVelocityZ) * fx) /
        dt,
    });
    position.y = vertical.height;
    status.airborne = !vertical.grounded && position.y - surface.height > 0.12;
    status.skidding =
      vertical.grounded &&
      motion.slip > 0.15 &&
      Math.abs(status.speed) > 5 &&
      Math.abs(sidewaysSpeed) > 1.2;
    skidMarks.update(position.x, position.z, heading, status.skidding);
    wheelAngle += (forwardSpeed * dt) / 0.37;
    const gate = gatePositions[status.gate];
    // Passing above the road still counts when a crest carries the car through an arch.
    if (
      status.damage < 100 &&
      Math.hypot(position.x - gate.x, position.z - gate.z) < 3.3 &&
      Math.abs(position.y - gate.y) < 5
    ) {
      status.gate++;
      if (status.gate === gateCount) {
        status.best = Math.min(status.best ?? Infinity, status.time);
        status.lap++;
        status.time = 0;
        status.gate = 0;
      }
      placeGate();
    }
  }
  function renderCar(alpha: number) {
    car.position.lerpVectors(previousPosition, position, alpha);
    // Angles remain continuous across full turns, so linear interpolation is safe.
    car.rotation.set(
      THREE.MathUtils.lerp(previousPitch, vertical.pitch, alpha),
      THREE.MathUtils.lerp(previousHeading, heading, alpha),
      THREE.MathUtils.lerp(previousBank, vertical.bank, alpha),
      'YXZ',
    );
    const visibleSteering = THREE.MathUtils.lerp(
      previousSteering,
      steering,
      alpha,
    );
    roll.setFromAxisAngle(
      localAxle,
      THREE.MathUtils.lerp(previousWheelAngle, wheelAngle, alpha),
    );
    for (const wheel of wheels) {
      wheel.object.position.y =
        wheel.restHeight +
        THREE.MathUtils.lerp(
          previousWheelOffsets[wheel.mountIndex],
          vertical.wheelOffsets[wheel.mountIndex],
          alpha,
        );
      steer.setFromAxisAngle(up, wheel.front ? visibleSteering : 0);
      wheel.object.quaternion.copy(steer).multiply(wheel.rest).multiply(roll);
    }
  }
  function animate(time: number) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 0;
    previousTime = time;
    if (status.ready && !status.paused) {
      accumulator += dt;
      while (accumulator >= step) {
        simulate(step);
        accumulator -= step;
      }
    }
    // Keep the remainder while paused so the visible car cannot jump backward.
    const alpha = accumulator / step;
    renderCar(alpha);
    const forwardX = Math.sin(car.rotation.y),
      forwardZ = Math.cos(car.rotation.y);
    const distance =
      12 +
      Math.abs(THREE.MathUtils.lerp(previousSpeed, status.speed, alpha)) * 0.1;
    cameraGoal.set(
      car.position.x - forwardX * distance,
      car.position.y + 8,
      car.position.z - forwardZ * distance,
    );
    cameraGoal.y = Math.max(
      cameraGoal.y,
      terrainHeight(cameraGoal.x, cameraGoal.z) + 3.5,
    );
    camera.position.lerp(cameraGoal, 1 - Math.exp(-3.6 * dt));
    camera.position.y = Math.max(
      camera.position.y,
      terrainHeight(camera.position.x, camera.position.z) + 2,
    );
    cameraLook.lerp(
      cameraLookGoal.set(
        car.position.x + forwardX * 4,
        car.position.y + 0.6,
        car.position.z + forwardZ * 4,
      ),
      1 - Math.exp(-5 * dt),
    );
    camera.lookAt(cameraLook);
    sun.position.set(
      car.position.x - 25,
      car.position.y + 42,
      car.position.z + 18,
    );
    sun.target.position.copy(car.position);
    gatePad.material.opacity = 0.22 + Math.sin(time * 0.003) * 0.07;
    renderer.render(scene, camera);
    hudTime += dt;
    if (hudTime > 0.1) {
      onStatus({ ...status });
      hudTime = 0;
    }
  }
  reset();
  frame = requestAnimationFrame(animate);
  return {
    reset,
    togglePause,
    setKey,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      ground.material.map?.dispose();
      release(scene);
      loaded.forEach(release);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
