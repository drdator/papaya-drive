import * as THREE from 'three';
import {
  initializeVehiclePhysics,
  createVehiclePhysics,
} from './vehicle-physics';
import { createSkidMarks } from './skid-marks';
import { createVehicleDamage, advanceVehicleDamage } from './vehicle-damage';
import { createVehicleAudio } from './vehicle-audio';
import { createCrashVisuals } from './vehicle-crash';
import { createVehicleWater, advanceVehicleWater } from './vehicle-water';
import { createWaterEffects } from './water-effects';
import { waterSurfaceOffset } from './water-waves';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createTerrain,
  createOcean,
  seaLevel,
  ridgeBaseHeight,
  terrainHeight as ridgeGroundHeight,
} from './terrain';
import { groundUnderCar, wheelMounts } from './vehicle-ground';
import { maps, type MapId } from './maps';
import { createFlyCamera } from './fly-camera';
import { createFloatingBoats } from './floating-boats';
import { createBoatWaterMask } from './boat-water-mask';
import { createCameraCollision } from './camera-collision';
import { createTropicalSurf } from './tropical-map';
import {
  createRidgeBackdrop,
  createCentralRockDetails,
} from './ridge-environment';
import {
  createRidgeRiver,
  riverDistance,
  riverLevel,
  bridge,
  bridgeCoordinates,
} from './ridge-river';
import { createCityGround } from './city-map';
import { createTropicalScenery } from './tropical-scenery';
import { loadIslandLighting } from './island-lighting';
import { createSunShadowTracking, sunShadowFragment } from './sun-shadows';
import {
  createRace,
  raceStorage,
  checkpointsPerLap,
  type RaceState,
} from './race';

export type GameStatus = {
  ready: boolean;
  speed: number;
  race: RaceState;
  paused: boolean;
  error: string | null;
  airborne: boolean;
  skidding: boolean;
  damage: number;
  muted: boolean;
  flooded: boolean;
  flying: boolean;
  bakedLighting: boolean | null;
};
export type GameControls = {
  dispose(): void;
  reset(): void;
  togglePause(): void;
  toggleMute(): void;
  toggleFly(): void;
  toggleBakedLighting(): void;
  setKey(key: string, down: boolean): void;
};
const gateCount = checkpointsPerLap;
const step = 1 / 120;

export function createGame(
  container: HTMLElement,
  onStatus: (status: GameStatus) => void,
  mapId: MapId = 'ridge',
): GameControls {
  const map = maps[mapId];
  const city = mapId === 'city';
  const { route, routeHeading, routeLength, distanceToRoad } = map;
  const {
    heightAt: terrainHeight,
    mountainAt: mountainHeight,
    tropical,
  } = map.terrain;
  const race = createRace(mapId, raceStorage());
  const lightingAbort = new AbortController();
  let islandLighting:
    | Awaited<ReturnType<typeof loadIslandLighting>>
    | undefined;
  const status: GameStatus = {
    ready: false,
    speed: 0,
    race: race.state,
    paused: false,
    error: null,
    airborne: false,
    skidding: false,
    damage: 0,
    muted: false,
    flooded: false,
    flying: false,
    bakedLighting: null,
  };
  const scene = new THREE.Scene();
  const sky = tropical ? '#94d7ee' : city ? '#c4dbe0' : '#bccfd1';
  scene.background = new THREE.Color(sky);
  const fog = new THREE.Fog(
    sky,
    tropical ? 120 : city ? 230 : 95,
    tropical ? 320 : city ? 850 : 430,
  );
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(
    48,
    1,
    0.1,
    tropical ? 400 : city ? 1200 : 650,
  );
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
    return {
      dispose() {},
      reset() {},
      togglePause() {},
      toggleMute() {},
      toggleFly() {},
      toggleBakedLighting() {},
      setKey() {},
    };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  THREE.ShaderChunk.shadowmap_pars_fragment = sunShadowFragment;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = tropical ? 1.1 : city ? 1.05 : 1.25;
  const drivingDescription = `3D ${map.name} driving playground. Use W or Up to accelerate, S or Down to brake and reverse, A/D or Left/Right to steer, Space for the handbrake, R to reset, and Escape to pause.`;
  renderer.domElement.setAttribute('aria-label', drivingDescription);
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#f6f2db', '#6f8263', 2.4));
  const sun = new THREE.DirectionalLight('#fff0ce', 3.1);
  sun.position.set(-50, 84, 36);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, {
    left: -76,
    right: 76,
    top: 76,
    bottom: -76,
    near: 1,
    far: 240,
  });
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.00015;
  const trackSunShadow = createSunShadowTracking(sun);
  scene.add(sun, sun.target);

  const waterTime = new THREE.Uniform(0);
  const boatWaterMask = createBoatWaterMask();
  function waterSurfaceAt(x: number, z: number) {
    if (tropical)
      return (
        seaLevel +
        waterSurfaceOffset(
          x,
          z,
          seaLevel - terrainHeight(x, z),
          waterTime.value,
        )
      );
    if (mapId === 'ridge' && riverDistance(x, z) < 0) return riverLevel(z);
    return undefined;
  }
  const ground = city
    ? createCityGround()
    : createTerrain(map.terrain, waterTime);
  const mountain = new THREE.Group();
  if (mapId === 'ridge')
    mountain.add(
      createRidgeBackdrop(terrainHeight),
      createCentralRockDetails(terrainHeight, distanceToRoad),
    );
  scene.add(mountain);
  scene.add(ground);
  const river =
    mapId === 'ridge'
      ? createRidgeRiver(ridgeBaseHeight, ridgeGroundHeight, waterTime)
      : undefined;
  if (river) scene.add(river.group);
  if (tropical) scene.add(createOcean(map.terrain, waterTime, boatWaterMask));
  const surf = tropical ? createTropicalSurf(waterTime) : undefined;
  if (surf) scene.add(surf);
  const cameraOrigin = new THREE.Vector3();
  const waterEffects = createWaterEffects();
  scene.add(waterEffects.group);
  const skidMarks = createSkidMarks(terrainHeight);
  scene.add(skidMarks.mesh);

  // Small route posts make the edge legible without a hard track barrier.
  const postGeometry = new THREE.CylinderGeometry(0.065, 0.08, 0.65, 5);
  const postMaterial = new THREE.MeshStandardMaterial({ color: '#f8eed6' });
  const postCount = city ? 0 : Math.ceil(routeLength / 5);
  for (let i = 0; i < postCount; i++) {
    const progress = i / postCount;
    const p = route(progress);
    const heading = routeHeading(progress);
    for (const side of [-1, 1]) {
      const x = p.x + Math.cos(heading) * side * 4.2;
      const z = p.z - Math.sin(heading) * side * 4.2;
      const bridgePosition = bridgeCoordinates(x, z);
      if (
        river &&
        Math.abs(bridgePosition.along) < 11 &&
        Math.abs(bridgePosition.across) < 6
      )
        continue;
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
  if (river)
    gatePositions[0].set(bridge.x, terrainHeight(bridge.x, bridge.z), bridge.z);
  function placeGate() {
    checkpoint.visible = !race.state.finished;
    if (race.state.finished) return;
    const heading =
      river && race.state.gate === 0
        ? Math.PI / 2 + bridge.angle
        : routeHeading((race.state.gate + 1) / gateCount);
    const p = gatePositions[race.state.gate];
    const surface = groundUnderCar(p.x, p.z, heading, terrainHeight);
    checkpoint.position.set(p.x, surface.height, p.z);
    checkpoint.rotation.set(surface.pitch, heading, surface.bank, 'YXZ');
  }
  placeGate();
  const finish = new THREE.Group();
  const finishPoint = route(0);
  const finishHeading = routeHeading(0);
  const finishSurface = groundUnderCar(
    finishPoint.x,
    finishPoint.z,
    finishHeading,
    terrainHeight,
  );
  finish.position.set(
    finishPoint.x,
    finishSurface.height + 0.015,
    finishPoint.z,
  );
  finish.rotation.set(
    finishSurface.pitch,
    finishHeading,
    finishSurface.bank,
    'YXZ',
  );
  const finishTile = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);
  const finishColors = ['#fffbe9', '#254d40'].map(
    (color) => new THREE.MeshBasicMaterial({ color }),
  );
  for (let x = 0; x < 12; x++)
    for (let z = 0; z < 2; z++) {
      const tile = new THREE.Mesh(finishTile, finishColors[(x + z) % 2]);
      tile.position.set((x - 5.5) * 0.5, 0, (z - 0.5) * 0.5);
      finish.add(tile);
    }
  scene.add(finish);

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
  const axles: {
    beam: THREE.Mesh;
    differential: THREE.Mesh;
    left: THREE.Object3D;
    right: THREE.Object3D;
  }[] = [];
  const axleLeft = new THREE.Vector3();
  const axleRight = new THREE.Vector3();
  const axleDirection = new THREE.Vector3();
  let physics: ReturnType<typeof createVehiclePhysics> | undefined;
  const keys = new Set<string>();
  let disposed = false,
    frame = 0,
    heading = routeHeading(0),
    steering = 0;
  let previousTime = 0,
    accumulator = 0,
    hudTime = 0;
  // Physics owns this pose; the scene object is interpolated only for rendering.
  const position = new THREE.Vector3();
  const previousPosition = new THREE.Vector3();
  const motion = { x: 0, z: 0 };
  const rotation = new THREE.Quaternion();
  const previousRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const damage = createVehicleDamage();
  const water = createVehicleWater();
  const audio = createVehicleAudio(map.music);
  let crashVisuals: ReturnType<typeof createCrashVisuals> | undefined;
  const impactPoint = new THREE.Vector3();
  const impactNormal = new THREE.Vector3();
  const impactVelocity = new THREE.Vector3();
  const previousWheelOffsets = wheelMounts.map(() => 0);
  const start = route(0);
  const surfaceAtStart = groundUnderCar(
    start.x,
    start.z,
    heading,
    terrainHeight,
  );
  const vertical = {
    height: surfaceAtStart.height,
    velocity: 0,
    grounded: false,
    pitch: surfaceAtStart.pitch,
    bank: surfaceAtStart.bank,
    wheelOffsets: wheelMounts.map(() => 0),
  };
  rotation.setFromEuler(
    new THREE.Euler(vertical.pitch, heading, vertical.bank, 'YXZ'),
  );
  const wheelAngles = wheelMounts.map(() => 0);
  const previousWheelAngles = wheelMounts.map(() => 0);
  let previousSteering = steering,
    previousSpeed = 0;
  const cameraGoal = new THREE.Vector3(),
    cameraLook = new THREE.Vector3(),
    cameraLookGoal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const roll = new THREE.Quaternion(),
    steer = new THREE.Quaternion();
  const localAxle = new THREE.Vector3(1, 0, 0);
  let orbitPointer: number | null = null;
  let orbitX = 0,
    orbitY = 0,
    orbitYaw = 0,
    orbitPitch = 0;
  let orbitBlend = 0,
    orbitReturnAt = 0;
  const canvas = renderer.domElement;
  let cameraCollision: ReturnType<typeof createCameraCollision> | undefined;
  let floatingBoats: ReturnType<typeof createFloatingBoats> | undefined;
  const movingProps: (() => void)[] = [];
  const flyCamera = createFlyCamera(
    camera,
    terrainHeight,
    (from, destination) => cameraCollision?.move(from, destination),
  );

  function stopOrbit() {
    if (orbitPointer === null) return;
    const pointer = orbitPointer;
    orbitPointer = null;
    if (canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
    canvas.classList.remove('orbiting');
    // Return by the shortest arc, even after dragging around several full turns.
    orbitYaw = Math.atan2(Math.sin(orbitYaw), Math.cos(orbitYaw));
    orbitReturnAt = performance.now() + 3000;
  }
  function startOrbit(event: PointerEvent) {
    if (!status.ready || event.button !== 0 || orbitPointer !== null) return;
    if (!status.paused) audio.unlock();
    event.preventDefault();
    orbitPointer = event.pointerId;
    orbitX = event.clientX;
    orbitY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('orbiting');
  }
  function moveOrbit(event: PointerEvent) {
    if (event.pointerId !== orbitPointer) return;
    if (status.flying) {
      if (!status.paused)
        flyCamera.look(event.clientX - orbitX, event.clientY - orbitY);
      orbitX = event.clientX;
      orbitY = event.clientY;
      return;
    }
    orbitYaw -= (event.clientX - orbitX) * 0.006;
    orbitPitch = THREE.MathUtils.clamp(
      orbitPitch + (event.clientY - orbitY) * 0.004,
      -0.4,
      0.75,
    );
    orbitX = event.clientX;
    orbitY = event.clientY;
  }
  function endOrbit(event: PointerEvent) {
    if (event.pointerId === orbitPointer) stopOrbit();
  }
  canvas.addEventListener('pointerdown', startOrbit);
  canvas.addEventListener('pointermove', moveOrbit);
  canvas.addEventListener('pointerup', endOrbit);
  canvas.addEventListener('pointercancel', endOrbit);
  canvas.addEventListener('lostpointercapture', endOrbit);

  function readPhysics() {
    if (!physics) return;
    const state = physics.state;
    position.copy(state.position);
    rotation.copy(state.rotation);
    motion.x = state.velocity.x;
    motion.z = state.velocity.z;
    heading = state.heading;
    steering = state.steering;
    vertical.height = position.y;
    vertical.velocity = state.velocity.y;
    vertical.pitch = state.pitch;
    vertical.bank = state.bank;
    vertical.grounded = state.grounded;
    state.wheels.forEach((wheel, i) => {
      vertical.wheelOffsets[i] = wheel.offset;
      wheelAngles[i] = wheel.rotation;
    });
  }
  function reset() {
    if (status.flying) toggleFly();
    stopOrbit();
    orbitYaw = orbitPitch = orbitBlend = orbitReturnAt = 0;
    audio.reset();
    waterEffects.reset();
    crashVisuals?.reset();
    position.copy(start);
    heading = routeHeading(0);
    motion.x = motion.z = 0;
    Object.assign(damage, createVehicleDamage());
    Object.assign(water, createVehicleWater());
    status.flooded = false;
    status.damage = 0;
    previousWheelOffsets.fill(0);
    skidMarks.reset();
    physics?.reset(position.x, position.z, heading);
    readPhysics();
    previousPosition.copy(position);
    previousRotation.copy(rotation);
    car.position.copy(position);
    car.quaternion.copy(rotation);
    status.speed = 0;
    race.reset();
    status.airborne = false;
    status.skidding = false;
    status.paused = false;
    steering = 0;
    wheelAngles.fill(0);
    previousSteering = 0;
    previousWheelAngles.fill(0);
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
    cameraOrigin.copy(car.position).y += 2.2;
    cameraCollision?.move(cameraOrigin, camera.position, false);
    camera.lookAt(cameraLook);
    onStatus({ ...status });
  }
  function togglePause() {
    if (!status.ready || race.state.finished) return;
    status.paused = !status.paused;
    if (status.paused) audio.silence();
    else audio.unlock();
    keys.clear();
    onStatus({ ...status });
  }
  function toggleFly() {
    if (!status.ready || race.state.finished) return;
    race.useFly();
    stopOrbit();
    keys.clear();
    status.flying = !status.flying;
    physics?.body.setEnabled(!status.flying);
    if (status.flying) {
      status.paused = false;
      flyCamera.enter(car.position);
      flyCamera.update(0, keys);
      audio.silence();
    } else {
      physics?.teleport(flyCamera.carPosition, flyCamera.carRotation);
      readPhysics();
      previousPosition.copy(position);
      previousRotation.copy(rotation);
      previousWheelOffsets.splice(
        0,
        previousWheelOffsets.length,
        ...vertical.wheelOffsets,
      );
      previousSteering = steering;
      previousSpeed = status.speed = 0;
      status.airborne = true;
      status.skidding = false;
      status.paused = false;
      accumulator = 0;
      damage.impactTime = damage.impactPeak = 0;
      water.depth = 0;
      waterEffects.reset();
      skidMarks.update([
        { point: position, skidding: false },
        { point: position, skidding: false },
      ]);
      cameraLook.copy(position).y += 0.6;
      renderCar(0);
      orbitYaw = orbitPitch = orbitBlend = orbitReturnAt = 0;
    }
    fog.near = status.flying
      ? city
        ? 550
        : 200
      : tropical
        ? 120
        : city
          ? 230
          : 95;
    fog.far = status.flying
      ? city
        ? 1300
        : 600
      : tropical
        ? 320
        : city
          ? 850
          : 430;
    camera.far = status.flying
      ? city
        ? 1600
        : 800
      : tropical
        ? 400
        : city
          ? 1200
          : 650;
    camera.updateProjectionMatrix();
    audio.unlock();
    canvas.setAttribute(
      'aria-label',
      status.flying
        ? `Free flight over ${map.name}. Drag to look, use WASD or arrows to move, Q/E to descend or rise, and Shift to move faster. Use Drive to drop the car here.`
        : drivingDescription,
    );
    onStatus({ ...status });
  }
  function toggleMute() {
    status.muted = !status.muted;
    audio.setMuted(status.muted);
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
    if (down && !status.paused && !race.state.finished) audio.unlock();
    if (down && !status.paused && !race.state.finished) keys.add(key);
    else keys.delete(key);
  }
  function keyDown(event: KeyboardEvent) {
    if (
      event.target instanceof Element &&
      (event.target.closest('dialog') ||
        (event.target instanceof HTMLButtonElement &&
          [' ', 'Enter'].includes(event.key)))
    )
      return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (
      controlledKeys.has(key) ||
      (status.flying && ['q', 'e', 'Shift'].includes(key))
    ) {
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
    stopOrbit();
    audio.silence();
    keys.clear();
    if (status.ready && !status.paused && !race.state.finished) {
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
    ...map.trees,
    ...(city ? [] : ['rock-boulder', 'rock-flat', 'rock-crag']),
    ...(map.mountain ? [map.mountain] : []),
    ...(map.props ? [map.props] : []),
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
      const gltf = await loader.loadAsync(
        `${import.meta.env.BASE_URL}models/${name}.glb`,
      );
      if (disposed) {
        release(gltf.scene);
        return gltf.scene;
      }
      loaded.push(gltf.scene);
      gltf.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = !child.name.startsWith('Road_paint');
          child.receiveShadow = true;
        }
      });
      return gltf.scene;
    }),
  )
    .then(async (models) => {
      await initializeVehiclePhysics();
      if (disposed) return;
      if (map.mountain) mountain.add(models[assetNames.indexOf(map.mountain)]);
      physics = createVehiclePhysics(ground.geometry, terrainHeight);
      cameraCollision = createCameraCollision();
      cameraCollision.add(ground);
      cameraCollision.add(mountain);
      if (river) {
        cameraCollision.add(river.solids);
        river.solids.traverse((object) => {
          if (object instanceof THREE.Mesh) physics!.addSolid(object);
        });
      }
      mountain.traverse((object) => {
        if (object instanceof THREE.Mesh) physics!.addSolid(object);
      });
      if (map.props) {
        const props = models[assetNames.indexOf(map.props)];
        (city ? mountain : scene).add(props);
        if (tropical) {
          floatingBoats = createFloatingBoats(
            props,
            terrainHeight,
            boatWaterMask,
          );
          scene.add(floatingBoats.ropes);
        }
        const floatingProps = new Set(
          props.children.filter(
            (child) =>
              child.name.startsWith('Landing_crate_') ||
              child.name === 'Landing_barrel',
          ),
        );
        for (const prop of floatingProps)
          physics.addFloatingProp(
            prop,
            waterSurfaceAt,
            prop.name === 'Landing_barrel' ? 'convex' : 'cuboid',
          );
        for (const child of props.children)
          cameraCollision.add(
            child,
            floatingProps.has(child) || floatingBoats?.objects.includes(child),
          );
        props.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            !object.name.includes('rope') &&
            (!city ||
              object.name.startsWith('City_solids') ||
              object.name.startsWith('City_streets'))
          ) {
            let root: THREE.Object3D | null = object;
            while (
              root &&
              !floatingProps.has(root) &&
              !floatingBoats?.objects.includes(root)
            )
              root = root.parent;
            if (root && floatingProps.has(root)) return;
            const update = physics!.addSolid(object, root !== null);
            if (update) movingProps.push(update);
          }
        });
      }
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
      const axleGeometry = new THREE.CylinderGeometry(0.065, 0.065, 1, 8);
      const differentialGeometry = new THREE.BoxGeometry(0.3, 0.2, 0.26);
      const axleMaterial = new THREE.MeshStandardMaterial({
        color: '#39433e',
        roughness: 0.75,
        metalness: 0.3,
      });
      for (const end of ['F', 'R']) {
        const left = wheelObjects.find(
          (wheel) => wheel.name === `Wheel_${end}L`,
        )!;
        const right = wheelObjects.find(
          (wheel) => wheel.name === `Wheel_${end}R`,
        )!;
        const beam = new THREE.Mesh(axleGeometry, axleMaterial);
        const differential = new THREE.Mesh(differentialGeometry, axleMaterial);
        beam.name = `Axle_${end}`;
        differential.name = `Differential_${end}`;
        beam.castShadow = differential.castShadow = true;
        car.add(beam, differential);
        axles.push({ beam, differential, left, right });
      }
      // Each map keeps its scenery clear of the driving line.
      crashVisuals = createCrashVisuals(car, body, scene, terrainHeight);
      if (tropical) {
        const scenery = createTropicalScenery(models.slice(1, 4));
        scene.add(scenery.group);
        cameraCollision.add(scenery.group);
        scenery.solids.forEach((mesh) => physics!.addSolid(mesh));
        scenery.trunks.forEach((trunk) => physics!.addObstacle(trunk));
        try {
          islandLighting = await loadIslandLighting(
            ground,
            scenery.group,
            mountain,
            models[assetNames.indexOf(map.props!)],
            lightingAbort.signal,
          );
          status.bakedLighting = true;
          islandLighting.setEnabled(true);
        } catch (error) {
          if (!disposed)
            console.warn(
              'Using original island lighting because the bake could not load',
              error,
            );
        }
        if (disposed) return;
      } else if (!city)
        for (let i = 0; i < 440; i++) {
          const spread = i < 255 ? 145 : 235;
          const x = (random() - 0.5) * spread,
            z = (random() - 0.5) * spread;
          if (distanceToRoad(x, z) < 6.4) continue;
          if (river && riverDistance(x, z) < 2.5) continue;
          if (Math.hypot(x - start.x, z - start.z) < 8) continue;
          const surface = terrainHeight(x, z);
          if (surface < seaLevel + 1.2) continue;
          const isTree = random() > 0.32;
          const index = isTree
            ? 1 + Math.floor(random() * 3)
            : 4 + Math.floor(random() * 3);
          const model = models[index].clone(true);
          const scale = isTree ? 1.6 + random() * 1.5 : 0.9 + random() * 1.25;
          model.scale.setScalar(scale);
          model.position.set(x, surface - 0.08, z);
          model.rotation.y = random() * Math.PI * 2;
          if (isTree && mountainHeight(x, z) > (Math.hypot(x, z) > 68 ? 24 : 6))
            continue;
          if (!isTree && Math.hypot(x, z) < 40 && mountainHeight(x, z) > 4)
            continue;
          scene.add(model);
          cameraCollision.add(model);
          physics.addObstacle({
            x,
            z,
            radius: (isTree ? 0.16 : index === 5 ? 0.8 : 0.67) * scale,
            bottom: surface,
            top: surface + (isTree ? 3.5 : index === 5 ? 0.6 : 1.4) * scale,
          });
        }
      physics.settleFloatingProps();
      cameraCollision.update();
      cameraCollision.build();
      status.ready = true;
      reset();
    })
    .catch((error) => {
      if (!disposed) {
        console.error('Game loading failed', error);
        status.error =
          'The game couldn’t load. Check your connection and try again.';
        onStatus({ ...status });
      }
    });

  function simulate(dt: number) {
    if (!physics || race.state.finished) return;
    previousPosition.copy(position);
    previousRotation.copy(rotation);
    previousSteering = steering;
    previousWheelAngles.splice(0, previousWheelAngles.length, ...wheelAngles);
    previousSpeed = status.speed;
    vertical.wheelOffsets.forEach((offset, i) => {
      previousWheelOffsets[i] = offset;
    });

    const wrecked = status.damage >= 100 || status.flooded;
    const gas = !wrecked && (keys.has('w') || keys.has('ArrowUp'));
    const reverse = !wrecked && (keys.has('s') || keys.has('ArrowDown'));
    const brake = wrecked || keys.has(' ');
    const turn = wrecked
      ? 0
      : Number(keys.has('a') || keys.has('ArrowLeft')) -
        Number(keys.has('d') || keys.has('ArrowRight'));
    if (!wrecked) race.advance(dt, gas || reverse);
    const waterSurface = waterSurfaceAt(position.x, position.z);
    const state = physics.step({ gas, reverse, brake, turn }, dt, waterSurface);
    readPhysics();
    const strongestImpact = state.impact.speed;
    inverseRotation.copy(rotation).invert();
    impactPoint
      .copy(state.impact.point)
      .sub(position)
      .applyQuaternion(inverseRotation);
    impactNormal.copy(state.impact.normal).applyQuaternion(inverseRotation);
    impactVelocity.copy(state.impact.velocity);
    const previousImpactPeak = damage.impactTime > dt ? damage.impactPeak : 0;
    advanceVehicleDamage(damage, strongestImpact, dt);
    const addedDamage = damage.amount - status.damage;
    if (
      addedDamage > 0 ||
      (strongestImpact >= 18 && strongestImpact > previousImpactPeak)
    ) {
      // Use the current simulated pose when releasing parts into the world.
      car.position.copy(position);
      car.quaternion.copy(rotation);
      const glassBroken =
        crashVisuals?.impact(
          {
            point: impactPoint,
            normal: impactNormal,
            speed: strongestImpact,
            radius: state.impact.radius,
            damage: addedDamage,
            fatal: damage.amount >= 100,
          },
          impactVelocity,
        ) ?? false;
      audio.crash(strongestImpact, glassBroken, impactPoint.x * 0.5);
      for (const wheel of wheels)
        physics.setWheelMount(
          wheel.mountIndex,
          wheel.object.position.z,
          wheel.object.parent === car,
        );
    }
    status.damage = damage.amount;
    crashVisuals?.update(dt);
    status.speed =
      Math.hypot(motion.x, motion.z) * (state.speed < -0.1 ? -1 : 1);
    advanceVehicleWater(
      water,
      position.y,
      vertical.pitch,
      vertical.bank,
      dt,
      tropical ? seaLevel : (waterSurface ?? -Infinity),
    );
    status.flooded = water.flooded;
    status.airborne = !state.grounded;
    const dry = water.depth < 0.1 && !status.flooded;
    status.skidding =
      dry && state.wheels.some((wheel) => wheel.contact && wheel.skid > 0.15);
    skidMarks.update(
      [state.wheels[3], state.wheels[2]].map((wheel) => ({
        point: wheel.point,
        skidding: dry && wheel.contact && wheel.skid > 0.15,
      })),
    );
    const gate = gatePositions[race.state.gate];
    const beforeFinish =
      (previousPosition.x - finishPoint.x) * Math.sin(finishHeading) +
      (previousPosition.z - finishPoint.z) * Math.cos(finishHeading);
    const afterFinish =
      (position.x - finishPoint.x) * Math.sin(finishHeading) +
      (position.z - finishPoint.z) * Math.cos(finishHeading);
    // Passing above the road still counts when a crest carries the car through an arch.
    if (
      race.state.started &&
      status.damage < 100 &&
      !status.flooded &&
      (race.state.gate !== gateCount - 1 ||
        (beforeFinish < 0 && afterFinish >= 0)) &&
      Math.hypot(position.x - gate.x, position.z - gate.z) < 3.3 &&
      // The bridge checkpoint must be crossed on the deck, not in the river below.
      (!river || race.state.gate !== 0 || position.y > gate.y - 0.5) &&
      Math.abs(position.y - gate.y) < 5
    ) {
      audio.checkpoint();
      race.checkpoint(race.state.gate);
      if (race.state.finished) {
        keys.clear();
        audio.silence();
        previousPosition.copy(position);
        previousRotation.copy(rotation);
        onStatus({ ...status });
      }
      placeGate();
    }
  }
  function renderCar(alpha: number) {
    crashVisuals?.render(alpha);
    car.position.lerpVectors(previousPosition, position, alpha);
    car.quaternion.slerpQuaternions(previousRotation, rotation, alpha);
    const visibleSteering = THREE.MathUtils.lerp(
      previousSteering,
      steering,
      alpha,
    );
    for (const wheel of wheels) {
      if (wheel.object.parent !== car) continue;
      wheel.object.position.y =
        wheel.restHeight +
        THREE.MathUtils.lerp(
          previousWheelOffsets[wheel.mountIndex],
          vertical.wheelOffsets[wheel.mountIndex],
          alpha,
        );
      roll.setFromAxisAngle(
        localAxle,
        THREE.MathUtils.lerp(
          previousWheelAngles[wheel.mountIndex],
          wheelAngles[wheel.mountIndex],
          alpha,
        ),
      );
      steer.setFromAxisAngle(up, wheel.front ? visibleSteering : 0);
      wheel.object.quaternion.copy(steer).multiply(wheel.rest).multiply(roll);
    }
    for (const axle of axles) {
      const leftAttached = axle.left.parent === car;
      const rightAttached = axle.right.parent === car;
      axle.beam.visible = axle.differential.visible =
        leftAttached || rightAttached;
      if (!axle.beam.visible) continue;
      axleLeft.copy(leftAttached ? axle.left.position : axle.right.position);
      axleRight.copy(rightAttached ? axle.right.position : axle.left.position);
      // A detached wheel leaves a short broken shaft, never a beam chasing debris.
      if (!leftAttached) axleLeft.x = -0.25;
      if (!rightAttached) axleRight.x = 0.25;
      axle.beam.position.copy(axleLeft).lerp(axleRight, 0.5);
      axleDirection.subVectors(axleRight, axleLeft);
      axle.beam.scale.y = axleDirection.length();
      axle.beam.quaternion.setFromUnitVectors(up, axleDirection.normalize());
      axle.differential.position.copy(axle.beam.position);
      axle.differential.position.x = 0;
    }
  }
  function animate(time: number) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 0;
    previousTime = time;
    if (!status.paused && !race.state.finished) {
      waterTime.value += dt;
      if (floatingBoats) {
        floatingBoats.update(waterTime.value);
        movingProps.forEach((update) => update());
      }
    }
    const driving =
      status.ready && !status.paused && !status.flying && !race.state.finished;
    if (status.ready && !status.paused && !race.state.finished) {
      accumulator += dt;
      while (accumulator >= step) {
        if (driving) simulate(step);
        else physics?.stepScenery(step);
        accumulator -= step;
      }
    }
    // Keep the remainder while paused so the visible car cannot jump backward.
    const alpha = accumulator / step;
    physics?.renderFloatingProps(alpha);
    if (!status.paused && floatingBoats) cameraCollision?.update();
    renderCar(alpha);
    const splashStrength = waterEffects.update(
      driving ? dt : 0,
      car,
      Math.abs(status.speed),
      vertical.velocity,
      waterSurfaceAt(car.position.x, car.position.z) ?? -Infinity,
    );
    if (splashStrength > 0) audio.splash(splashStrength);
    const gas = keys.has('w') || keys.has('ArrowUp');
    const reverse = keys.has('s') || keys.has('ArrowDown');
    const handbrake = keys.has(' ');
    const tireSkid = physics
      ? Math.max(
          ...physics.state.wheels.map((wheel) =>
            wheel.contact ? wheel.skid : 0,
          ),
        )
      : 0;
    audio.update(
      {
        speed: status.speed,
        throttle:
          handbrake || (gas && reverse)
            ? 0
            : gas
              ? 1
              : reverse && status.speed < 0.1
                ? 0.65
                : 0,
        grounded:
          physics?.state.wheels.slice(2).some((wheel) => wheel.contact) ??
          false,
        skid: water.depth < 0.1 ? tireSkid : 0,
        running:
          driving &&
          !race.state.finished &&
          status.damage < 100 &&
          !status.flooded,
        active: driving && !race.state.finished,
        musicActive: status.ready && !status.paused,
      },
      dt,
    );
    if (status.flying) {
      if (!status.paused) flyCamera.update(dt, keys);
      car.position.copy(flyCamera.carPosition);
      car.quaternion.copy(flyCamera.carRotation);
    } else {
      const forwardX = Math.sin(car.rotation.y),
        forwardZ = Math.cos(car.rotation.y);
      const distance =
        12 +
        Math.abs(THREE.MathUtils.lerp(previousSpeed, status.speed, alpha)) *
          0.1;
      const orbitHeld = orbitPointer !== null || time < orbitReturnAt;
      if (!orbitHeld) {
        orbitYaw = THREE.MathUtils.damp(orbitYaw, 0, 2.5, dt);
        orbitPitch = THREE.MathUtils.damp(orbitPitch, 0, 2.5, dt);
      }
      orbitBlend = THREE.MathUtils.damp(orbitBlend, orbitHeld ? 1 : 0, 4, dt);
      const cameraHeading = car.rotation.y + orbitYaw;
      const elevation = THREE.MathUtils.clamp(
        Math.atan2(7.4, distance) + orbitPitch,
        0.12,
        1.3,
      );
      const orbitRadius = Math.hypot(distance, 7.4);
      const horizontalDistance = Math.cos(elevation) * orbitRadius;
      cameraGoal.set(
        car.position.x - Math.sin(cameraHeading) * horizontalDistance,
        car.position.y + 0.6 + Math.sin(elevation) * orbitRadius,
        car.position.z - Math.cos(cameraHeading) * horizontalDistance,
      );
      cameraGoal.y = Math.max(
        cameraGoal.y,
        seaLevel + 2.5,
        terrainHeight(cameraGoal.x, cameraGoal.z) + 3.5,
      );
      camera.position.lerp(
        cameraGoal,
        1 - Math.exp(-(orbitPointer !== null ? 14 : 3.6) * dt),
      );
      camera.position.y = Math.max(
        camera.position.y,
        seaLevel + 2,
        terrainHeight(camera.position.x, camera.position.z) + 2,
      );
      cameraLook.lerp(
        cameraLookGoal.set(
          car.position.x + forwardX * 4 * (1 - orbitBlend),
          car.position.y + 0.6,
          car.position.z + forwardZ * 4 * (1 - orbitBlend),
        ),
        1 - Math.exp(-5 * dt),
      );
      cameraOrigin.copy(car.position).y += 2.2;
      cameraCollision?.move(cameraOrigin, camera.position, false);
      camera.lookAt(cameraLook);
    }
    trackSunShadow(status.flying ? camera.position : car.position);
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
    toggleMute,
    toggleFly,
    toggleBakedLighting() {
      if (!islandLighting) return;
      status.bakedLighting = !status.bakedLighting;
      islandLighting.setEnabled(status.bakedLighting);
      onStatus({ ...status });
    },
    setKey,
    dispose() {
      disposed = true;
      lightingAbort.abort();
      islandLighting?.dispose();
      audio.dispose();
      physics?.dispose();
      cameraCollision?.dispose();
      crashVisuals?.dispose();
      cancelAnimationFrame(frame);
      resize.disconnect();
      stopOrbit();
      canvas.removeEventListener('pointerdown', startOrbit);
      canvas.removeEventListener('pointermove', moveOrbit);
      canvas.removeEventListener('pointerup', endOrbit);
      canvas.removeEventListener('pointercancel', endOrbit);
      canvas.removeEventListener('lostpointercapture', endOrbit);
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
