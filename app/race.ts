export const raceLaps = 3;
export const checkpointsPerLap = 8;
export type RaceTime = {
  id: string;
  time: number;
  laps: number[];
  date: number;
};
type RaceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const milliseconds = (seconds: number) => Math.round(seconds * 1000) / 1000;

export function formatRaceTime(seconds: number) {
  const hundredths = Math.round(seconds * 100);
  return `${Math.floor(hundredths / 6000)}:${(Math.floor(hundredths / 100) % 60).toString().padStart(2, '0')}.${(hundredths % 100).toString().padStart(2, '0')}`;
}

export function raceStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRaceTime(value: unknown): value is RaceTime {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RaceTime>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    entry.id.length < 100 &&
    typeof entry.time === 'number' &&
    Number.isFinite(entry.time) &&
    entry.time > 0 &&
    typeof entry.date === 'number' &&
    Number.isFinite(entry.date) &&
    entry.date > 0 &&
    entry.date < 8.64e15 &&
    Array.isArray(entry.laps) &&
    entry.laps.length === raceLaps &&
    entry.laps.every(
      (lap) => typeof lap === 'number' && Number.isFinite(lap) && lap > 0,
    ) &&
    Math.abs(entry.laps.reduce((sum, lap) => sum + lap, 0) - entry.time) < 0.005
  );
}

export function createRace(mapId: string, storage?: RaceStorage) {
  const key = `papaya-drive:times:v1:${mapId}`;
  function readTimes(): RaceTime[] {
    try {
      const value: unknown = JSON.parse(storage?.getItem(key) ?? '[]');
      return Array.isArray(value)
        ? value
            .filter(isRaceTime)
            .sort((a, b) => a.time - b.time)
            .slice(0, 5)
        : [];
    } catch {
      return [];
    }
  }
  const state = {
    lap: 1,
    gate: 0,
    time: 0,
    lapTime: 0,
    laps: [] as number[],
    started: false,
    finished: false,
    practice: false,
    leaderboard: readTimes(),
    result: null as RaceTime | null,
    personalBest: false,
    saved: false,
    split: null as { lap: number; time: number; delta: number | null } | null,
    splitRemaining: 0,
  };
  let reference = state.leaderboard[0];
  let lapStartedAt = 0;
  return {
    state,
    reset() {
      const leaderboard = storage ? readTimes() : state.leaderboard;
      Object.assign(state, {
        lap: 1,
        gate: 0,
        time: 0,
        lapTime: 0,
        laps: [],
        started: false,
        finished: false,
        practice: false,
        leaderboard,
        result: null,
        personalBest: false,
        saved: false,
        split: null,
        splitRemaining: 0,
      });
      reference = leaderboard[0];
      lapStartedAt = 0;
    },
    useFly() {
      state.practice = true;
    },
    advance(dt: number, accelerating: boolean) {
      if (state.finished) return;
      if (accelerating) state.started = true;
      if (!state.started) return;
      state.time += dt;
      state.lapTime = state.time - lapStartedAt;
      state.splitRemaining = Math.max(0, state.splitRemaining - dt);
    },
    checkpoint(index: number) {
      if (!state.started || state.finished || index !== state.gate) return;
      state.gate++;
      if (state.gate < checkpointsPerLap) return;
      state.laps.push(milliseconds(state.lapTime));
      state.split = {
        lap: state.lap,
        time: state.laps.at(-1)!,
        delta:
          !state.practice && reference
            ? state.time -
              reference.laps
                .slice(0, state.lap)
                .reduce((sum, lap) => sum + lap, 0)
            : null,
      };
      state.splitRemaining = 5;
      if (state.lap < raceLaps) {
        state.lap++;
        state.gate = 0;
        lapStartedAt = state.time;
        state.lapTime = 0;
        return;
      }
      state.finished = true;
      state.time = milliseconds(state.laps.reduce((sum, lap) => sum + lap, 0));
      state.result = {
        id:
          globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        time: state.time,
        laps: [...state.laps],
        date: Date.now(),
      };
      if (state.practice) return;
      // Read again so another tab's completed races are retained.
      const times = storage ? readTimes() : state.leaderboard;
      state.personalBest = !times[0] || state.time < times[0].time;
      state.leaderboard = [...times, state.result]
        .sort((a, b) => a.time - b.time)
        .slice(0, 5);
      try {
        storage?.setItem(key, JSON.stringify(state.leaderboard));
        state.saved = storage !== undefined;
      } catch {
        // A blocked or full store must never prevent finishing the race.
        state.saved = false;
      }
    },
  };
}

export type RaceState = ReturnType<typeof createRace>['state'];
