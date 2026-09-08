import { createGame, type GameStatus } from './game';

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
};

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

function setText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function updateStatus(status: GameStatus) {
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
  setText(
    ui.loadingDescription,
    status.error ?? 'Loading your car and the forest.',
  );
  ui.retry.hidden = !status.error;
  ui.wreck.hidden = !status.ready || !wrecked;
  setText(ui.wreckTitle, status.flooded ? 'Engine flooded.' : 'Car wrecked.');
  setText(
    ui.wreckDescription,
    status.flooded
      ? 'The water reached the engine. Restart to get back on the island.'
      : 'Too much damage to keep driving.',
  );
  setText(ui.repair, status.flooded ? 'Restart on shore' : 'Repair & restart');
  ui.paused.hidden = !status.ready || !status.paused || wrecked;
  ui.hint.hidden = !status.ready || status.started || status.paused || wrecked;
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

const game = createGame(ui.viewport, updateStatus);
const events = new AbortController();
const options = { signal: events.signal };
ui.retry.addEventListener('click', () => location.reload(), options);
ui.repair.addEventListener('click', () => game.reset(), options);
ui.reset.addEventListener('click', () => game.reset(), options);
ui.resume.addEventListener('click', () => game.togglePause(), options);
ui.pause.addEventListener('click', () => game.togglePause(), options);
ui.sound.addEventListener('click', () => game.toggleMute(), options);

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
