import * as THREE from 'three';
import { renderPixelRatio } from './render-resolution';

// Standalone dev-server comparison: no game assets, physics, or shadow passes.
const view = document.querySelector<HTMLElement>('#view')!;
const spin = document.querySelector<HTMLButtonElement>('#spin')!;
const stats = document.querySelector<HTMLOutputElement>('#stats')!;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const canvas = renderer.domElement;
canvas.setAttribute('aria-label', 'Cube: drag to orbit, or use arrow keys');
canvas.tabIndex = 0;
view.append(canvas);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9e5db');
scene.add(new THREE.HemisphereLight('#ffffff', '#718165', 2.5));
const sun = new THREE.DirectionalLight('#fff2da', 3);
sun.position.set(4, 8, 5);
scene.add(sun);
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  ['#e99451', '#bf7140', '#fff5d9', '#829976', '#6d9460', '#638a9c'].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 1 }),
  ),
);
cube.position.y = 1;
scene.add(cube);
scene.add(new THREE.GridHelper(16, 16, '#718165', '#b1c4b2'));

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
const target = new THREE.Vector3(0, 0.8, 0);
let yaw = 0.65;
let pitch = 0.35;
let autoRotate = false;
let pointer: number | null = null;
let pointerX = 0;
let pointerY = 0;

function setAutoRotate(active: boolean) {
  autoRotate = active;
  spin.setAttribute('aria-pressed', String(active));
  spin.textContent = active ? 'Stop rotation' : 'Auto rotate';
}
spin.addEventListener('click', () => setAutoRotate(!autoRotate));

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || pointer !== null) return;
  event.preventDefault();
  setAutoRotate(false);
  pointer = event.pointerId;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.setPointerCapture(pointer);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== pointer) return;
  yaw -= (event.clientX - pointerX) * 0.006;
  pitch = THREE.MathUtils.clamp(
    pitch + (event.clientY - pointerY) * 0.004,
    0.05,
    1.4,
  );
  pointerX = event.clientX;
  pointerY = event.clientY;
});
function endDrag(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = null;
  if (canvas.hasPointerCapture(event.pointerId))
    canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
canvas.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return;
  event.preventDefault();
  setAutoRotate(false);
  if (event.key === 'ArrowLeft') yaw -= 0.08;
  if (event.key === 'ArrowRight') yaw += 0.08;
  if (event.key === 'ArrowUp') pitch = Math.min(1.4, pitch + 0.06);
  if (event.key === 'ArrowDown') pitch = Math.max(0.05, pitch - 0.06);
});

function resize() {
  const { width, height } = view.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = renderPixelRatio(devicePixelRatio, visualViewport?.scale);
  renderer.setDrawingBufferSize(width, height, ratio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
visualViewport?.addEventListener('resize', resize);
resize();

let previousTime = 0;
let elapsed = 0;
let frames = 0;
let worstFrame = 0;
document.addEventListener('visibilitychange', () => {
  previousTime = elapsed = frames = worstFrame = 0;
});
function animate(time: number) {
  requestAnimationFrame(animate);
  const interval = previousTime ? time - previousTime : 0;
  previousTime = time;
  if (autoRotate) yaw += Math.min(interval / 1000, 0.1) * 0.5;
  camera.position.set(
    Math.sin(yaw) * Math.cos(pitch) * 7,
    target.y + Math.sin(pitch) * 7,
    Math.cos(yaw) * Math.cos(pitch) * 7,
  );
  camera.lookAt(target);
  renderer.render(scene, camera);

  if (interval > 0) {
    elapsed += interval;
    frames++;
    worstFrame = Math.max(worstFrame, interval);
    if (elapsed >= 1000) {
      stats.textContent = `${Math.round((frames * 1000) / elapsed)} FPS · longest frame ${worstFrame.toFixed(1)} ms`;
      elapsed = frames = worstFrame = 0;
    }
  }
}
requestAnimationFrame(animate);
