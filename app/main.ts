import { createGame, type GameStatus } from './game';
import { maps, type MapId } from './maps';
import {
  formatRaceTime as timeLabel,
  raceLaps,
  checkpointsPerLap,
  type RaceState,
} from './race';

let activeMap: MapId = 'ridge';
let latestStatus: GameStatus | undefined;
const debug = new URLSearchParams(location.search).get('debug') === '1';
const touchScreen = matchMedia('(pointer: coarse), (max-width: 700px)');

const ui = {
  viewport: document.querySelector<HTMLDivElement>('.viewport')!,
  hud: document.querySelector<HTMLDivElement>('.hud')!,
  lap: document.getElementById('lap')!,
  lapTime: document.getElementById('lap-time')!,
  split: document.getElementById('lap-split')!,
  raceMode: document.getElementById('race-mode')!,
  scores: document.querySelector<HTMLButtonElement>('#scores')!,
  scoresMenu: document.querySelector<HTMLDialogElement>('#scores-menu')!,
  scoresTrack: document.getElementById('scores-track')!,
  scoresTitle: document.getElementById('scores-title')!,
  scoresList: document.getElementById('scores-list')!,
  scoresClose: document.getElementById('scores-close')!,
  result: document.getElementById('race-result')!,
  resultTime: document.getElementById('result-time')!,
  resultLaps: document.getElementById('result-laps')!,
  resultMessage: document.getElementById('result-message')!,
  raceAgain: document.getElementById('race-again')!,
  checkpoints: document.getElementById('checkpoints')!,
  dots: document.querySelectorAll('.dots span'),
  time: document.getElementById('time')!,
  best: document.getElementById('best')!,
  loading: document.getElementById('loading')!,
  loadingTitle: document.getElementById('loading-title')!,
  loadingDescription: document.getElementById('loading-description')!,
  loadingArt: document.getElementById('loading-art')!,
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
  bakedLighting: document.querySelector<HTMLButtonElement>('#baked-lighting')!,
  flyLabel: document.getElementById('fly-label')!,
  flyHeight: document.getElementById('fly-height')!,
  dashboard: document.querySelector<HTMLElement>('.dashboard')!,
};

ui.fly.hidden = !debug;

let resultShownId: string | undefined;
let renderedLeaderboard: RaceState['leaderboard'] | undefined;
let renderedResultId: string | undefined;
let resumeAfterScores = false;

function renderScores(status: GameStatus) {
  const race = status.race;
  setText(ui.scoresTrack, maps[activeMap].name);
  setText(
    ui.scoresTitle,
    race.finished
      ? race.practice
        ? 'Practice finished'
        : race.personalBest
          ? 'New personal best!'
          : 'Race finished!'
      : 'Top 5 times',
  );
  ui.result.hidden = !race.finished;
  ui.raceAgain.hidden = !race.finished;
  setText(ui.scoresClose, race.finished ? 'Back to track' : 'Back to driving');
  if (race.result) {
    setText(ui.resultTime, timeLabel(race.result.time));
    const rank = race.leaderboard.findIndex(
      (entry) => entry.id === race.result?.id,
    );
    setText(
      ui.resultMessage,
      race.practice
        ? 'Practice run — not ranked. Reset to start a timed race.'
        : !race.saved
          ? 'Couldn’t save to this browser. Your result is shown here.'
          : rank >= 0
            ? `#${rank + 1} on this track’s top five.`
            : 'Outside the top five. Give it another go!',
    );
  }
  if (
    renderedLeaderboard !== race.leaderboard ||
    renderedResultId !== race.result?.id
  ) {
    renderedLeaderboard = race.leaderboard;
    renderedResultId = race.result?.id;
    ui.scoresList.replaceChildren(
      ...Array.from({ length: 5 }, (_, index) => {
        const entry = race.leaderboard[index];
        const row = document.createElement('li');
        const rank = document.createElement('span');
        rank.className = 'score-rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const time = document.createElement('strong');
        time.textContent = entry ? timeLabel(entry.time) : '—';
        const label = document.createElement('span');
        label.textContent = entry
          ? entry.id === race.result?.id
            ? 'This race'
            : new Date(entry.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })
          : 'No time yet';
        if (entry && entry.id === race.result?.id)
          row.setAttribute('aria-current', 'true');
        row.append(rank, time, label);
        return row;
      }),
    );
    ui.resultLaps.replaceChildren(
      ...race.laps.map((lap, index) => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `Lap ${index + 1}`;
        const time = document.createElement('strong');
        time.textContent = timeLabel(lap);
        row.append(label, time);
        return row;
      }),
    );
  }
}

function setText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text;
}

function updateStatus(status: GameStatus) {
  const wasReady = latestStatus?.ready;
  latestStatus = status;
  const map = maps[activeMap];
  const race = status.race;
  setText(ui.trailName, map.name);
  setText(
    ui.hint,
    status.flying
      ? touchScreen.matches
        ? 'Arrows move; + / − change height. Drive drops the car.'
        : 'WASD move · Q/E height · Drag to look · Drive drops car'
      : race.finished
        ? 'Race finished · Leaderboard for results · R to race again'
        : race.practice
          ? 'Practice — times won’t be saved. R starts a fresh race.'
          : `3 laps to finish. ${map.hint}`,
  );
  ui.fly.disabled = !status.ready || race.finished;
  ui.bakedLighting.hidden = !debug || status.bakedLighting === null;
  ui.bakedLighting.disabled = !status.ready;
  ui.bakedLighting.setAttribute(
    'aria-pressed',
    String(status.bakedLighting === true),
  );
  setText(
    ui.bakedLighting,
    `Baked lighting: ${status.bakedLighting ? 'On' : 'Off'}`,
  );
  ui.pause.toggleAttribute('disabled', !status.ready || race.finished);
  ui.scores.disabled = !status.ready;
  ui.fly.setAttribute('aria-pressed', String(status.flying));
  ui.fly.setAttribute(
    'aria-label',
    status.flying ? 'Drop car and drive' : 'Fly around map',
  );
  setText(ui.flyLabel, status.flying ? 'Drive' : 'Fly');
  ui.flyHeight.hidden = !status.flying;
  ui.dashboard.hidden = status.flying || race.finished;
  ui.maps.disabled = !status.ready && !status.error;
  const wrecked = status.damage >= 100 || status.flooded;
  setText(ui.lap, `${race.lap} / ${raceLaps}`);
  setText(ui.lapTime, timeLabel(race.lapTime));
  setText(
    ui.raceMode,
    race.practice
      ? 'Practice · not ranked'
      : race.finished
        ? 'Finished'
        : '3 laps to finish',
  );
  setText(ui.checkpoints, `${race.gate} / ${checkpointsPerLap}`);
  ui.dots.forEach((dot, i) => {
    dot.classList.toggle('done', i < race.gate);
    dot.classList.toggle('current', i === race.gate);
  });
  setText(ui.time, timeLabel(race.time));
  setText(
    ui.best,
    `Best ${race.leaderboard[0] ? timeLabel(race.leaderboard[0].time) : '—'}`,
  );
  ui.loading.hidden = status.ready;
  ui.hud.inert = !status.ready;
  ui.viewport.inert = !status.ready;
  ui.viewport.setAttribute('aria-busy', String(!status.ready));
  ui.loadingArt.hidden = Boolean(status.error);
  setText(
    ui.loadingTitle,
    status.error ? 'Couldn’t start the drive' : `Loading ${map.name}`,
  );
  setText(ui.loadingDescription, status.error ?? status.loading);
  ui.retry.hidden = !status.error;
  if (status.ready && !wasReady)
    ui.viewport.querySelector('canvas')?.focus({ preventScroll: true });
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
    !status.ready ||
    !status.paused ||
    race.finished ||
    (wrecked && !status.flying);
  ui.hint.hidden =
    !status.ready ||
    status.paused ||
    (!status.flying &&
      !race.finished &&
      !race.practice &&
      (race.started || wrecked));
  ui.split.hidden =
    !race.split ||
    race.splitRemaining === 0 ||
    status.paused ||
    race.finished ||
    race.practice;
  if (race.split) {
    const { lap, time, delta } = race.split;
    const comparison =
      delta === null
        ? ''
        : Math.abs(delta) < 0.005
          ? ' · Level with your best'
          : ` · ${Math.abs(delta).toFixed(2)}s ${delta < 0 ? 'ahead' : 'behind'} your best`;
    setText(ui.split, `Lap ${lap} · ${timeLabel(time)}${comparison}`);
  }
  if (ui.scoresMenu.open) renderScores(status);
  if (race.result && resultShownId !== race.result.id) {
    resultShownId = race.result.id;
    resumeAfterScores = false;
    renderScores(status);
    if (!ui.scoresMenu.open) ui.scoresMenu.showModal();
    ui.scoresMenu.scrollTop = 0;
    ui.raceAgain.focus({ preventScroll: true });
  }
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
ui.scores.addEventListener(
  'click',
  () => {
    if (!latestStatus) return;
    resumeAfterScores = !latestStatus.paused && !latestStatus.race.finished;
    if (resumeAfterScores) game.togglePause();
    renderScores(latestStatus);
    ui.scoresMenu.showModal();
  },
  options,
);
ui.scoresClose.addEventListener('click', () => ui.scoresMenu.close(), options);
ui.scoresMenu.addEventListener(
  'close',
  () => {
    if (resumeAfterScores && latestStatus?.paused) game.togglePause();
    resumeAfterScores = false;
    ui.viewport.querySelector('canvas')?.focus();
  },
  options,
);
ui.raceAgain.addEventListener(
  'click',
  () => {
    resumeAfterScores = false;
    ui.scoresMenu.close();
    game.reset();
    ui.viewport.querySelector('canvas')?.focus();
  },
  options,
);
ui.pause.addEventListener('click', () => game.togglePause(), options);
ui.sound.addEventListener('click', () => game.toggleMute(), options);
ui.bakedLighting.addEventListener(
  'click',
  () => {
    game.toggleBakedLighting();
    ui.viewport.querySelector('canvas')?.focus();
  },
  options,
);
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
