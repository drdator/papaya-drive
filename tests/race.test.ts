import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRace, checkpointsPerLap, formatRaceTime } from '../app/race.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function finishLap(race: ReturnType<typeof createRace>, seconds: number) {
  for (let gate = 0; gate < checkpointsPerLap; gate++) {
    race.advance(seconds / checkpointsPerLap, true);
    race.checkpoint(gate);
  }
}

await test('a race starts on throttle, requires all 24 ordered checkpoints, and finishes only once', () => {
  const storage = memoryStorage();
  const race = createRace('ridge', storage);
  race.advance(10, false);
  race.checkpoint(0);
  assert.equal(race.state.time, 0);
  assert.equal(race.state.gate, 0);
  race.advance(1, true);
  race.checkpoint(1);
  assert.equal(race.state.gate, 0, 'Cannot skip a checkpoint');
  finishLap(race, 29);
  assert.equal(race.state.lap, 2);
  assert.equal(race.state.time, 30);
  assert.equal(race.state.lapTime, 0);
  assert.equal(
    race.state.leaderboard.length,
    0,
    'Single laps are not race records',
  );
  finishLap(race, 31);
  assert.equal(race.state.finished, false);
  finishLap(race, 32);
  assert.equal(race.state.finished, true);
  assert.equal(race.state.lap, 3);
  assert.equal(race.state.gate, 8);
  assert.equal(race.state.time, 93);
  assert.deepEqual(race.state.laps, [30, 31, 32]);
  assert.equal(race.state.saved, true);
  const id = race.state.result!.id;
  race.advance(20, true);
  race.checkpoint(8);
  assert.equal(race.state.time, 93);
  assert.equal(race.state.leaderboard.length, 1);
  assert.equal(race.state.result!.id, id);
  race.reset();
  assert.equal(race.state.lap, 1);
  assert.equal(race.state.time, 0);
  assert.equal(race.state.started, false);
  assert.equal(race.state.finished, false);
  assert.deepEqual(race.state.laps, []);
  assert.equal(race.state.leaderboard[0].time, 93);
});

await test('top five persists per track, preserves ties, and compares cumulative splits with the best race', () => {
  const storage = memoryStorage();
  for (const lap of [40, 35, 30, 33, 31, 34, 32]) {
    const race = createRace('ridge', storage);
    for (let i = 0; i < 3; i++) finishLap(race, lap);
  }
  const race = createRace('ridge', storage);
  assert.deepEqual(
    race.state.leaderboard.map((entry) => entry.time),
    [90, 93, 96, 99, 102],
  );
  assert.deepEqual(createRace('tropical', storage).state.leaderboard, []);
  finishLap(race, 29);
  assert.equal(race.state.split!.delta, -1);
  finishLap(race, 31);
  assert.equal(race.state.split!.delta, 0);
  const bestId = race.state.leaderboard[0].id;
  finishLap(race, 30);
  assert.equal(
    race.state.personalBest,
    false,
    'Tying a time does not replace the personal best',
  );
  assert.equal(race.state.leaderboard[0].id, bestId);
  assert.equal(race.state.leaderboard[1].id, race.state.result!.id);
});

await test('using Fly makes the entire attempt practice; reset restores eligibility', () => {
  const storage = memoryStorage();
  const race = createRace('ridge', storage);
  finishLap(race, 30);
  race.useFly();
  finishLap(race, 30);
  finishLap(race, 30);
  assert.equal(race.state.finished, true);
  assert.equal(race.state.practice, true);
  assert.equal(race.state.saved, false);
  assert.equal(race.state.leaderboard.length, 0);
  assert.equal(createRace('ridge', storage).state.leaderboard.length, 0);
  race.reset();
  assert.equal(race.state.practice, false);
  for (let i = 0; i < 3; i++) finishLap(race, 40);
  assert.equal(race.state.saved, true);
  assert.equal(race.state.leaderboard.length, 1);
});

await test('bad stored data and unavailable storage cannot break racing or finishing', () => {
  const storage = memoryStorage();
  for (const value of [
    '{',
    '{}',
    '[null,{},false]',
    '[{"id":"fake","time":1,"laps":[1,1,1],"date":1}]',
  ]) {
    storage.setItem('papaya-drive:times:v1:ridge', value);
    assert.deepEqual(createRace('ridge', storage).state.leaderboard, []);
  }
  for (const unavailable of [
    undefined,
    {
      getItem() {
        throw new Error('Blocked');
      },
      setItem() {
        throw new Error('Full');
      },
    },
  ]) {
    const race = createRace('ridge', unavailable);
    for (let i = 0; i < 3; i++) finishLap(race, 30);
    assert.equal(race.state.finished, true);
    assert.equal(race.state.saved, false);
    assert.equal(race.state.result!.time, 90);
  }
});

await test('race time formatting carries rounded seconds into minutes', () => {
  assert.equal(formatRaceTime(0), '0:00.00');
  assert.equal(formatRaceTime(59.999), '1:00.00');
  assert.equal(formatRaceTime(125.125), '2:05.13');
});
