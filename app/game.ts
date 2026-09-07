import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
};
export type GameControls = {
  dispose(): void;
  reset(): void;
  togglePause(): void;
  setKey(key: string, down: boolean): void;
};
type Obstacle = { x: number; z: number; radius: number };
const route = (t: number) =>
  new THREE.Vector3(Math.sin(t) * 32, 0, Math.cos(t) * 24);
const routeHeading = (t: number) =>
  Math.atan2(32 * Math.cos(t), -24 * Math.sin(t));
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
    '3D forest driving playground. Use WASD or arrow keys to drive, Space to brake, R to reset, and Escape to pause.',
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: '#91ae70', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const roadGeometry = new THREE.BufferGeometry();
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    const p = route(t);
    const normal = new THREE.Vector3(
      24 * Math.sin(t),
      0,
      32 * Math.cos(t),
    ).normalize();
    for (const edge of [-1, 1])
      positions.push(
        p.x + normal.x * edge * 3.8,
        0.025,
        p.z + normal.z * edge * 3.8,
      );
    if (i < 160) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  roadGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  roadGeometry.setIndex(indices);
  roadGeometry.computeVertexNormals();
  const road = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({
      color: '#d9c49a',
      roughness: 1,
      side: THREE.DoubleSide,
    }),
  );
  road.receiveShadow = true;
  scene.add(road);

  // Small route posts make the edge legible without a hard track barrier.
  const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.65, 5);
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#f8eed6' });
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2,
      p = route(t);
    const normal = new THREE.Vector3(
      24 * Math.sin(t),
      0,
      32 * Math.cos(t),
    ).normalize();
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, postMaterial);
      post.position.set(
        p.x + normal.x * side * 4,
        0.325,
        p.z + normal.z * side * 4,
      );
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
    route(((i + 1) / gateCount) * Math.PI * 2),
  );
  function placeGate() {
    const angle = ((status.gate + 1) / gateCount) * Math.PI * 2;
    checkpoint.position.copy(gatePositions[status.gate]);
    checkpoint.rotation.y = routeHeading(angle);
  }
  placeGate();

  const car = new THREE.Group();
  scene.add(car);
  let body: THREE.Object3D | undefined;
  const wheels: {
    object: THREE.Object3D;
    rest: THREE.Quaternion;
    front: boolean;
  }[] = [];
  const obstacles: Obstacle[] = [];
  const keys = new Set<string>();
  let disposed = false,
    frame = 0,
    heading = Math.PI / 2,
    steering = 0,
    wheelAngle = 0;
  let previousTime = 0,
    accumulator = 0,
    hudTime = 0;
  const cameraGoal = new THREE.Vector3(),
    cameraLook = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const roll = new THREE.Quaternion(),
    steer = new THREE.Quaternion();
  const localAxle = new THREE.Vector3(1, 0, 0);

  function reset() {
    car.position.copy(route(0));
    heading = Math.PI / 2;
    car.rotation.y = heading;
    status.speed = 0;
    status.time = 0;
    status.gate = 0;
    status.started = false;
    status.paused = false;
    steering = 0;
    wheelAngle = 0;
    keys.clear();
    placeGate();
    camera.position.set(car.position.x - 12, 8, car.position.z);
    cameraLook.copy(car.position).add(new THREE.Vector3(3, 0.6, 0));
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
      body = models[0];
      car.add(body);
      body.traverse((child) => {
        if (child.name.startsWith('Wheel_'))
          wheels.push({
            object: child,
            rest: child.quaternion.clone(),
            front: child.name.startsWith('Wheel_F'),
          });
      });
      // Keep the road and the starting spot clear. The same seven GLBs are used throughout.
      for (let i = 0; i < 255; i++) {
        const x = (random() - 0.5) * 145,
          z = (random() - 0.5) * 145;
        const roadAngle = Math.atan2(x / 32, z / 24);
        if (route(roadAngle).distanceTo(new THREE.Vector3(x, 0, z)) < 6.4)
          continue;
        if (Math.hypot(x, z - 24) < 8) continue;
        const isTree = random() > 0.32;
        const index = isTree
          ? 1 + Math.floor(random() * 3)
          : 4 + Math.floor(random() * 3);
        const model = models[index].clone(true);
        const scale = isTree ? 1.6 + random() * 1.5 : 0.9 + random() * 1.25;
        model.scale.setScalar(scale);
        model.position.set(x, 0, z);
        model.rotation.y = random() * Math.PI * 2;
        scene.add(model);
        obstacles.push({
          x,
          z,
          radius: (isTree ? 0.16 : index === 5 ? 0.8 : 0.67) * scale,
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
    const gas = keys.has('w') || keys.has('ArrowUp');
    const reverse = keys.has('s') || keys.has('ArrowDown');
    const brake = keys.has(' ');
    const turn =
      Number(keys.has('a') || keys.has('ArrowLeft')) -
      Number(keys.has('d') || keys.has('ArrowRight'));
    if (gas || reverse) status.started = true;
    if (status.started) status.time += dt;
    if (brake || (gas && reverse))
      status.speed = THREE.MathUtils.damp(status.speed, 0, 5, dt);
    else if (gas) status.speed += (status.speed < 0 ? 18 : 9) * dt;
    else if (reverse) status.speed -= (status.speed > 0 ? 18 : 7) * dt;
    else
      status.speed =
        Math.sign(status.speed) *
        Math.max(0, Math.abs(status.speed) - 2.3 * dt);
    status.speed = THREE.MathUtils.clamp(status.speed, -6, 20);
    steering = THREE.MathUtils.damp(steering, turn * 0.48, 9, dt);
    heading +=
      ((status.speed / 2.5) * Math.tan(steering) * dt) /
      (1 + Math.abs(status.speed) * 0.055);
    const fx = Math.sin(heading),
      fz = Math.cos(heading);
    car.position.x += fx * status.speed * dt;
    car.position.z += fz * status.speed * dt;
    // Two circles approximate the long car body, with sliding and a small bounce.
    for (const obstacle of obstacles) {
      if (
        Math.abs(car.position.x - obstacle.x) > obstacle.radius + 3 ||
        Math.abs(car.position.z - obstacle.z) > obstacle.radius + 3
      )
        continue;
      for (const offset of [-0.85, 0.85]) {
        const dx = car.position.x + fx * offset - obstacle.x,
          dz = car.position.z + fz * offset - obstacle.z;
        const distance = Math.hypot(dx, dz),
          radius = obstacle.radius + 0.85;
        if (distance < radius) {
          const nx = distance > 0.0001 ? dx / distance : 1,
            nz = distance > 0.0001 ? dz / distance : 0;
          car.position.x += nx * (radius - distance);
          car.position.z += nz * (radius - distance);
          if ((fx * nx + fz * nz) * status.speed < 0) status.speed *= -0.18;
        }
      }
    }
    const distanceFromCenter = Math.hypot(car.position.x, car.position.z);
    if (distanceFromCenter > 81) {
      car.position.x *= 81 / distanceFromCenter;
      car.position.z *= 81 / distanceFromCenter;
      status.speed *= -0.3;
    }
    car.rotation.y = heading;
    if (body)
      body.rotation.z = THREE.MathUtils.damp(
        body.rotation.z,
        -steering * status.speed * 0.006,
        8,
        dt,
      );
    wheelAngle += (status.speed * dt) / 0.37;
    for (const wheel of wheels) {
      roll.setFromAxisAngle(localAxle, wheelAngle);
      steer.setFromAxisAngle(up, wheel.front ? steering : 0);
      wheel.object.quaternion.copy(steer).multiply(wheel.rest).multiply(roll);
    }
    if (car.position.distanceTo(gatePositions[status.gate]) < 3.3) {
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
    } else accumulator = 0;
    const forwardX = Math.sin(heading),
      forwardZ = Math.cos(heading);
    const distance = 12 + Math.abs(status.speed) * 0.1;
    cameraGoal.set(
      car.position.x - forwardX * distance,
      8,
      car.position.z - forwardZ * distance,
    );
    camera.position.lerp(cameraGoal, 1 - Math.exp(-3.6 * dt));
    cameraLook.lerp(
      new THREE.Vector3(
        car.position.x + forwardX * 4,
        0.6,
        car.position.z + forwardZ * 4,
      ),
      1 - Math.exp(-5 * dt),
    );
    camera.lookAt(cameraLook);
    sun.position.set(car.position.x - 25, 42, car.position.z + 18);
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
      release(scene);
      loaded.forEach(release);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
