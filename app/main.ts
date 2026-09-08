import { createGame, type GameStatus } from './game';
import { maps, type MapId } from './maps';

let activeMap: MapId = 'ridge';
let latestStatus: GameStatus | undefined;
const touchScreen = matchMedia('(pointer: coarse), (max-width: 700px)');

const ui = {
  viewport: document.querySelector<HTMLDivElement>('.viewport')!,
  lap: document.getElementById('lap')!,
  checkpoints: document.getElementById('checkpoints')!,
  dots: document.querySelectorAll('.dots span'),
  time: document.getElementById('time')!,
  best: document.getElementById('best')!,
  loading: document.getElementById('loading')!,
  loadingTitle: document.getElementById('loading-title')!,
  loadingDescription: document.getElementById('loading-description')!,
  retry: document.getElementById('retry')!,
  wreck: document.getElementById('wreck')!,
  wreckTitle: document.getElementById('wreck-title')!,
  wreckDescription: document.getElementById('wreck-description')!,
  repair: document.getElementById('repair')!,
  paused: document.getElementById('paused')!,
  resume: document.getElementById('resume')!,
  hint: document.getElementById('hint')!,
  speed: document.getElementById('speed')!,
  speedArc: document.querySelector<SVGCircleElement>('#speed-arc')!,
  gear: document.getElementById('gear')!,
  damageLabel: document.getElementById('damage-label')!,
  damage: document.querySelector<HTMLMeterElement>('#car-damage')!,
  sound: document.getElementById('sound')!,
  reset: document.getElementById('reset')!,
  pause: document.getElementById('pause')!,
  pauseIcon: document.querySelector<SVGUseElement>('#pause-icon')!,
  maps: document.querySelector<HTMLButtonElement>('#maps')!,
  mapMenu: document.querySelector<HTMLDialogElement>('#map-menu')!,
  trailName: document.getElementById('trail-name')!,
  fly: document.querySelector<HTMLButtonElement>('#fly')!,
  flyLabel: document.getElementById('fly-label')!,
  flyHeight: document.getElementById('fly-height')!,
  dashboard: document.querySelector<HTMLElement>('.dashboard')!,
};

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function setText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function updateStatus(status: GameStatus) {
  latestStatus = status;
  const map = maps[activeMap];
  setText(ui.trailName, map.name);
  setText(
    ui.hint,
    status.flying
      ? touchScreen.matches
        ? 'Arrows move; + / − change height. Drive drops the car.'
        : 'WASD move · Q/E height · Drag to look · Drive drops car'
      : map.hint,
  );
  ui.fly.disabled = !status.ready;
  ui.fly.setAttribute('aria-pressed', String(status.flying));
  ui.fly.setAttribute(
    'aria-label',
    status.flying ? 'Drop car and drive' : 'Fly around map',
  );
  setText(ui.flyLabel, status.flying ? 'Drive' : 'Fly');
  ui.flyHeight.hidden = !status.flying;
  ui.dashboard.hidden = status.flying;
  ui.maps.disabled = !status.ready && !status.error;
  const wrecked = status.damage >= 100 || status.flooded;
  setText(ui.lap, String(status.lap));
  setText(ui.checkpoints, `${status.gate} / 8`);
  ui.dots.forEach((dot, i) => {
    dot.classList.toggle('done', i < status.gate);
    dot.classList.toggle('current', i === status.gate);
  });
  setText(ui.time, timeLabel(status.time));
  setText(
    ui.best,
    `Best ${status.best === null ? '—' : timeLabel(status.best)}`,
  );
  ui.loading.hidden = status.ready;
  setText(
    ui.loadingTitle,
    status.error ? 'Couldn’t start the drive' : 'Packing the picnic…',
  );
  setText(ui.loadingDescription, status.error ?? map.loading);
  ui.retry.hidden = !status.error;
  ui.wreck.hidden = !status.ready || !wrecked || status.flying;
  setText(ui.wreckTitle, status.flooded ? 'Engine flooded.' : 'Car wrecked.');
  setText(
    ui.wreckDescription,
    status.flooded
      ? 'The water reached the engine. Restart to get back on the island.'
      : 'Too much damage to keep driving.',
  );
  setText(ui.repair, status.flooded ? 'Restart on shore' : 'Repair & restart');
  ui.paused.hidden =
    !status.ready || !status.paused || (wrecked && !status.flying);
  ui.hint.hidden =
    !status.ready ||
    status.paused ||
    (!status.flying && (status.started || wrecked));
  for (const [key, driving, flying] of [
    ['ArrowLeft', 'Steer left', 'Fly left'],
    ['ArrowRight', 'Steer right', 'Fly right'],
    ['ArrowUp', 'Accelerate', 'Fly forward'],
    ['ArrowDown', 'Brake or reverse', 'Fly backward'],
  ])
    document
      .querySelector(`[data-key="${key}"]`)
      ?.setAttribute('aria-label', status.flying ? flying : driving);
  setText(
    ui.speed,
    Math.round(Math.abs(status.speed) * 3.6)
      .toString()
      .padStart(2, '0'),
  );
  setText(
    ui.gear,
    wrecked
      ? status.flooded
        ? 'FLOODED'
        : 'WRECKED'
      : status.airborne
        ? '↗ Airborne'
        : status.skidding
          ? '↝ Sliding'
          : status.speed < -0.2
            ? 'R · Reverse'
            : '',
  );
  setText(ui.damageLabel, `${Math.floor(status.damage)}%`);
  ui.damage.value = status.damage;
  ui.sound.classList.toggle('is-muted', status.muted);
  ui.sound.dataset.tooltip = status.muted ? 'Sound off' : 'Sound on';
  ui.sound.setAttribute(
    'aria-label',
    status.muted ? 'Unmute sound' : 'Mute sound',
  );
  ui.sound.setAttribute('aria-pressed', String(status.muted));
  ui.pauseIcon.setAttribute(
    'href',
    status.paused ? '#icon-play' : '#icon-pause',
  );
  ui.pause.setAttribute('aria-label', status.paused ? 'Resume' : 'Pause');
  ui.pause.dataset.tooltip = status.paused ? 'Resume · Esc' : 'Pause · Esc';
  ui.speedArc.style.strokeDashoffset = String(
    75 * (1 - Math.min(1, (Math.abs(status.speed) * 3.6) / 95)),
  );
}

let game = createGame(ui.viewport, updateStatus, activeMap);
const events = new AbortController();
const options = { signal: events.signal };
ui.retry.addEventListener('click', () => location.reload(), options);
ui.repair.addEventListener('click', () => game.reset(), options);
ui.reset.addEventListener('click', () => game.reset(), options);
ui.resume.addEventListener('click', () => game.togglePause(), options);
ui.pause.addEventListener('click', () => game.togglePause(), options);
ui.sound.addEventListener('click', () => game.toggleMute(), options);
ui.fly.addEventListener(
  'click',
  () => {
    game.toggleFly();
    ui.viewport.querySelector('canvas')?.focus();
  },
  options,
);
let resumeAfterMenu = false;
ui.maps.addEventListener(
  'click',
  () => {
    resumeAfterMenu = latestStatus?.ready === true && !latestStatus.paused;
    if (resumeAfterMenu) game.togglePause();
    ui.mapMenu.showModal();
  },
  options,
);
ui.mapMenu.addEventListener(
  'close',
  () => {
    if (resumeAfterMenu && latestStatus?.paused) game.togglePause();
    resumeAfterMenu = false;
  },
  options,
);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-map]',
)) {
  button.addEventListener(
    'click',
    () => {
      const next = button.dataset.map;
      if (next !== 'ridge' && next !== 'tropical' && next !== 'city') return;
      if (next !== activeMap) {
        const muted = latestStatus?.muted;
        resumeAfterMenu = false;
        game.dispose();
        activeMap = next;
        game = createGame(ui.viewport, updateStatus, activeMap);
        if (muted) game.toggleMute();
        for (const choice of document.querySelectorAll<HTMLButtonElement>(
          '[data-map]',
        ))
          choice.setAttribute(
            'aria-pressed',
            String(choice.dataset.map === activeMap),
          );
      }
      ui.mapMenu.close();
      ui.viewport.querySelector('canvas')?.focus();
    },
    options,
  );
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  '[data-key]',
)) {
  const key = button.dataset.key!;
  button.addEventListener(
    'pointerdown',
    (event) => {
      button.setPointerCapture(event.pointerId);
      game.setKey(key, true);
    },
    options,
  );
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(event, () => game.setKey(key, false), options);
}

import.meta.hot?.dispose(() => {
  events.abort();
  game.dispose();
});
