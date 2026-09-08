import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createVehiclePhysics,
  initializeVehiclePhysics,
} from '../app/vehicle-physics.ts';
import { createTerrainGeometry, seaLevel } from '../app/terrain.ts';
import { tropicalHeight } from '../app/tropical-map.ts';
import { gravity } from '../app/vehicle-ground.ts';
import {
  advanceVehicleWater,
  createVehicleWater,
} from '../app/vehicle-water.ts';
import {
  advanceVehicleDamage,
  createVehicleDamage,
} from '../app/vehicle-damage.ts';

await initializeVehiclePhysics();
const dt = 1 / 120;
const idle = { gas: false, reverse: false, brake: false, turn: 0 };
const gas = { ...idle, gas: true };
const flat = new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2);
const terrain = createTerrainGeometry();
function flatCar(y = 0.04, pitch = 0) {
  const car = createVehiclePhysics(flat);
  car.reset(0, 0, 0);
  car.body.setTranslation({ x: 0, y, z: 0 }, true);
  car.body.setRotation(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0)),
    true,
  );
  car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return car;
}

await test('flat-road acceleration, braking, reverse and parking retain their tuning', () => {
  const car = flatCar();
  try {
    for (let i = 0; i < 240; i++) car.step(idle, dt);
    assert.ok(car.state.wheels.every((wheel) => wheel.contact));
    const parked = car.state.position.clone();
    for (let i = 0; i < 240; i++) car.step(idle, dt);
    assert.ok(car.state.position.distanceTo(parked) < 0.001);
    for (let i = 0; i < 210; i++) car.step(gas, dt);
    assert.ok(car.state.speed * 3.6 > 72 && car.state.speed * 3.6 < 78);
    for (let i = 0; i < 600; i++) car.step(gas, dt);
    assert.ok(Math.abs(car.state.speed * 3.6 - 95) < 0.1);
    const speed = car.state.speed;
    for (let i = 0; i < 120; i++) car.step({ ...idle, reverse: true }, dt);
    assert.ok(Math.abs(speed - car.state.speed - 14) < 0.5);
    for (let i = 0; i < 360; i++) car.step({ ...idle, reverse: true }, dt);
    assert.ok(car.state.speed < -5 && car.state.speed > -6.1);
    for (let i = 0; i < 240; i++) car.step({ ...idle, brake: true }, dt);
    assert.ok(Math.abs(car.state.speed) < 0.05);
  } finally {
    car.dispose();
  }
});

await test('airborne controls cannot steer, accelerate, brake or leave tire slip', () => {
  const car = flatCar(8, 0.3);
  try {
    car.body.setLinvel({ x: 5, y: 4, z: 12 }, true);
    const start = car.body.translation().y;
    for (let i = 0; i < 60; i++) car.step({ ...gas, brake: true, turn: 1 }, dt);
    assert.equal(car.state.grounded, false);
    assert.ok(Math.abs(car.state.velocity.x - 5) < 0.001);
    assert.ok(Math.abs(car.state.velocity.z - 12) < 0.001);
    assert.ok(Math.abs(car.state.velocity.y - (4 - gravity * 0.5)) < 0.001);
    assert.ok(
      Math.abs(car.state.position.y - (start + 2 - 0.5 * gravity * 0.5 ** 2)) <
        0.04,
    );
    assert.ok(Math.abs(car.state.pitch - 0.3) < 0.001);
    assert.ok(Math.abs(car.state.heading) < 0.001);
    assert.ok(
      car.state.wheels.every((wheel) => !wheel.contact && wheel.skid === 0),
    );
  } finally {
    car.dispose();
  }
});

await test('rear-only contact cannot steer; front-only contact cannot apply rear-wheel drive', () => {
  for (const pitch of [-0.3, 0.3]) {
    const controlled = flatCar(0.4, pitch),
      coasting = flatCar(0.4, pitch);
    try {
      for (const car of [controlled, coasting])
        car.body.setLinvel({ x: 0, y: 0, z: 10 }, true);
      for (let i = 0; i < 10; i++) {
        controlled.step(pitch < 0 ? { ...gas, turn: 1 } : gas, dt);
        coasting.step(pitch < 0 ? gas : idle, dt);
      }
      assert.deepEqual(
        controlled.state.wheels.map((wheel) => wheel.contact),
        pitch < 0 ? [false, false, true, true] : [true, true, false, false],
      );
      if (pitch < 0)
        assert.ok(
          Math.abs(controlled.state.heading - coasting.state.heading) < 0.001,
        );
      else {
        // Coasting applies rolling resistance to the grounded front tires, so allow that small difference.
        assert.ok(
          controlled.state.velocity.distanceTo(coasting.state.velocity) < 0.1,
        );
        assert.ok(
          controlled.state.wheels.slice(2).every((wheel) => wheel.skid === 0),
        );
      }
    } finally {
      controlled.dispose();
      coasting.dispose();
    }
  }
});

await test('nose-first landings swing the rear down; level landings compress and settle', () => {
  for (const pitch of [0, 0.3]) {
    const car = flatCar(1.2, pitch);
    try {
      let front: number | undefined, rear: number | undefined;
      let rearImpact = 0,
        rearBodySpeed = 0,
        lowest = 0,
        rebound = 0;
      for (let i = 0; i < 600; i++) {
        const state = car.step(idle, dt);
        if (front === undefined && state.wheels[0].contact) {
          front = i * dt;
          assert.ok(
            state.velocity.y < -3,
            'Suspension must absorb the landing over time',
          );
        }
        if (rear === undefined && state.wheels[2].contact) {
          rear = i * dt;
          rearImpact = car.body.velocityAtPoint(state.wheels[2].point).y;
          rearBodySpeed = state.velocity.y;
        }
        lowest = Math.min(lowest, state.position.y);
        if (lowest < -0.02) rebound = Math.max(rebound, state.position.y);
      }
      assert.ok(front !== undefined && rear !== undefined);
      if (pitch > 0) {
        assert.ok(rear - front > 0.08);
        assert.ok(
          rearImpact < rearBodySpeed - 1,
          'Front contact must rotate the rear toward the ground',
        );
      } else {
        assert.ok(lowest < -0.03 && lowest > -0.18);
        assert.ok(rebound > 0 && rebound < 0.03);
      }
      assert.ok(Math.abs(car.state.pitch) < 0.002);
      assert.ok(Math.abs(car.state.position.y) < 0.01);
      assert.ok(Math.abs(car.body.angvel().x) < 0.001);
    } finally {
      car.dispose();
    }
  }
});

await test('braking turns stay controllable, with stronger slides reserved for the handbrake', () => {
  const slips: number[] = [];
  for (const kind of ['powered', 'brake', 'handbrake']) {
    const car = flatCar();
    try {
      for (let i = 0; i < 240; i++) car.step(idle, dt);
      car.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
      let maximum = 0;
      for (let i = 0; i < 120; i++) {
        const state = car.step(
          {
            ...idle,
            gas: kind === 'powered',
            reverse: kind === 'brake',
            brake: kind === 'handbrake',
            turn: 1,
          },
          dt,
        );
        maximum = Math.max(
          maximum,
          Math.abs(
            state.velocity.x * Math.cos(state.heading) -
              state.velocity.z * Math.sin(state.heading),
          ),
        );
      }
      slips.push(maximum);
      if (kind === 'brake') {
        assert.ok(maximum < 3, 'S braking should not throw the rear sideways');
        assert.ok(
          car.state.heading < Math.PI / 2,
          'A one-second braking turn should not spin the car around',
        );
        const velocity = car.state.velocity.clone();
        car.step(gas, dt);
        assert.ok(
          car.state.velocity.distanceTo(velocity) < 0.5,
          'Grip must return smoothly',
        );
      }
    } finally {
      car.dispose();
    }
  }
  assert.ok(slips[0] < 1.5);
  assert.ok(
    slips[2] > slips[1] * 2,
    'The handbrake should still allow deliberate slides',
  );
});

await test('sideways touchdown preserves some slip before the tires regain normal grip', () => {
  const car = flatCar(1.2);
  try {
    car.body.setLinvel({ x: 5, y: 0, z: 20 }, true);
    let touchdown: number | undefined;
    for (let i = 0; i < 180; i++) {
      const state = car.step(idle, dt);
      if (
        touchdown === undefined &&
        state.wheels.some((wheel) => wheel.contact)
      ) {
        touchdown = i;
        assert.ok(
          state.velocity.x > 4,
          'The first tire impulse must not grab away most sideways momentum',
        );
        assert.ok(
          state.velocity.y < -3,
          'Suspension contact must still absorb the landing immediately',
        );
      }
      if (touchdown !== undefined && i === touchdown + 5)
        assert.ok(
          state.velocity.x > 1.5,
          'The car should retain a brief slide while settling',
        );
      if (touchdown !== undefined && i === touchdown + 36) {
        assert.ok(
          Math.abs(state.velocity.x) < 0.1,
          'Normal traction must return after touchdown',
        );
        assert.ok(state.wheels.every((wheel) => wheel.contact));
      }
    }
    assert.ok(touchdown !== undefined);
  } finally {
    car.dispose();
  }
});

await test('hard moving landings absorb the drop without a second large jump', () => {
  for (const height of [3, 5])
    for (const pitch of [0, 0.3]) {
      const car = flatCar(height, pitch);
      try {
        car.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
        let touched = false,
          rebounding = false,
          rebound = 0;
        for (let i = 0; i < 360; i++) {
          const state = car.step(idle, dt);
          touched ||= state.wheels.some((wheel) => wheel.contact);
          if (touched && state.velocity.y > 0) rebounding = true;
          if (rebounding) rebound = Math.max(rebound, state.position.y);
        }
        assert.ok(touched && rebounding);
        assert.ok(
          rebound < (height === 3 ? 0.35 : 0.6),
          'The old suspension rebounded one to two meters after these landings',
        );
        assert.ok(car.state.grounded);
        assert.ok(Math.abs(car.state.position.y) < 0.015);
        assert.ok(Math.abs(car.state.velocity.y) < 0.1);
      } finally {
        car.dispose();
      }
    }
});

await test('full-speed mountain approaches use momentum to climb without catapulting the car', () => {
  for (let direction = 0; direction < 8; direction++) {
    const angle = (direction * Math.PI) / 4,
      heading = angle + Math.PI;
    const car = createVehiclePhysics(terrain);
    try {
      car.reset(-10 + Math.sin(angle) * 34, Math.cos(angle) * 34, heading);
      car.body.setLinvel(
        { x: Math.sin(heading) * 26, y: 0, z: Math.cos(heading) * 26 },
        true,
      );
      for (let i = 0; i < 960; i++) {
        const state = car.step(gas, dt);
        assert.ok(Number.isFinite(state.position.y));
        assert.ok(
          state.position.y < 22,
          'The old solver launched the car over 65 meters high',
        );
        assert.ok(
          state.velocity.y < 20,
          'Climbing must not manufacture launch speed',
        );
      }
    } finally {
      car.dispose();
    }
  }
});

await test('obstacles generate damage, detached wheels lose contact, and reset restores drive', () => {
  const car = flatCar();
  try {
    car.addObstacle({ x: 0, z: 15, radius: 1, bottom: 0, top: 4 });
    const damage = createVehicleDamage();
    for (let i = 0; i < 240; i++) car.step(idle, dt);
    car.body.setLinvel({ x: 0, y: 0, z: 26 }, true);
    for (let i = 0; i < 120; i++)
      advanceVehicleDamage(damage, car.step(gas, dt).impact.speed, dt);
    assert.equal(damage.amount, 100);
    car.setWheelMount(0, 0.6, false);
    car.step(idle, dt);
    assert.equal(car.state.wheels[0].contact, false);
    assert.equal(car.state.wheels[0].load, 0);
    car.reset(0, 0, 0);
    car.body.setTranslation({ x: 0, y: 0.04, z: 0 }, true);
    car.body.setRotation(new THREE.Quaternion(), true);
    for (let i = 0; i < 240; i++) car.step(idle, dt);
    assert.ok(
      car.state.wheels.every((wheel) => wheel.attached && wheel.contact),
    );
    for (let i = 0; i < 60; i++) car.step(gas, dt);
    assert.ok(car.state.speed > 5);
  } finally {
    car.dispose();
  }
});

await test('crash contacts report the obstacle width and centered contact patch', () => {
  for (const radius of [0.28, 1.4]) {
    const car = flatCar();
    try {
      car.addObstacle({ x: 0, z: 10, radius, bottom: 0, top: 4 });
      for (let i = 0; i < 240; i++) car.step(idle, dt);
      car.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
      let hit = false;
      for (let i = 0; i < 120; i++) {
        const { impact } = car.step(gas, dt);
        if (impact.speed < 8) continue;
        assert.equal(impact.radius, radius);
        assert.ok(Math.abs(impact.point.x) < 0.1);
        assert.ok(impact.normal.z < -0.9);
        hit = true;
        break;
      }
      assert.ok(hit, 'The car reaches the obstacle at speed');
    } finally {
      car.dispose();
    }
  }
});

await test('driving down the real beach submerges and floods the engine', () => {
  const beach = createTerrainGeometry(tropicalHeight);
  const car = createVehiclePhysics(beach, tropicalHeight);
  try {
    car.reset(68, 20, Math.PI / 2);
    const water = createVehicleWater();
    for (let i = 0; i < 1200 && !water.flooded; i++) {
      const state = car.step(gas, dt, seaLevel);
      advanceVehicleWater(water, state.position.y, state.pitch, state.bank, dt);
    }
    assert.equal(water.flooded, true);
    assert.ok(car.state.position.x > 75 && car.state.position.x < 105);
  } finally {
    car.dispose();
    beach.dispose();
  }
});

await test('water cushions an entry, briefly floats the car, then lets it settle on the seabed', () => {
  const seabed = flat.clone().translate(0, -10, 0);
  const car = createVehiclePhysics(seabed, () => -10);
  try {
    for (const pitch of [0, 1.2, Math.PI]) {
      // Reusing the submerged car also checks that a new flight drop restores buoyancy.
      car.teleport(
        new THREE.Vector3(0, 1, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0)),
      );
      car.body.setLinvel({ x: 4, y: -8, z: 0 }, true);
      for (let i = 0; i < 240; i++) car.step(idle, dt, seaLevel);
      const center = car.body.worldCom();
      assert.ok(
        center.y > seaLevel - 2 && center.y < seaLevel + 0.5,
        'The chassis returns near the surface after the initial plunge',
      );
      assert.ok(
        car.state.velocity.y > -0.5,
        'Buoyancy arrests the fall before the seabed',
      );
      assert.ok(
        Math.abs(car.state.velocity.x) < 1,
        'Water slows forward motion',
      );
      for (let i = 0; i < 360; i++) car.step(idle, dt, seaLevel);
      assert.ok(
        car.state.position.y < -3 && car.state.velocity.y < -2,
        'Lost buoyancy lets the flooded car sink',
      );
      for (let i = 0; i < 480; i++) car.step(idle, dt, seaLevel);
      assert.ok(car.body.worldCom().y < -8.5, 'The car reaches the bottom');
      assert.ok(
        Math.abs(car.state.velocity.y) < 0.1,
        'The car rests on the seabed',
      );
    }
  } finally {
    car.dispose();
    seabed.dispose();
  }
});

await test('a flight drop clears old momentum, falls from the chosen pose, and can drive after landing', () => {
  const car = flatCar();
  try {
    for (let i = 0; i < 120; i++) car.step(gas, dt);
    car.body.setAngvel({ x: 2, y: 1, z: 3 }, true);
    const target = new THREE.Vector3(30, 16, -20);
    const orientation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2,
    );
    car.teleport(target, orientation);
    assert.deepEqual(car.state.position.toArray(), target.toArray());
    assert.equal(car.state.velocity.length(), 0);
    assert.equal(new THREE.Vector3().copy(car.body.angvel()).length(), 0);
    assert.ok(
      !car.state.grounded && car.state.wheels.every((wheel) => !wheel.contact),
    );
    for (let i = 0; i < 60; i++) car.step(idle, dt);
    assert.ok(
      car.state.position.y < 15 && car.state.position.y > 12,
      'The car falls through the air instead of snapping to the terrain',
    );
    assert.ok(Math.abs(car.state.position.x - 30) < 0.1);
    for (let i = 0; i < 420; i++) car.step(idle, dt);
    assert.ok(car.state.grounded && Math.abs(car.state.position.y) < 0.3);
    for (let i = 0; i < 120; i++) car.step(gas, dt);
    assert.ok(
      car.state.position.x > 32,
      'Driving resumes in the selected heading',
    );
  } finally {
    car.dispose();
  }
});

await test('hard nose-first ground strikes damage the body while wheel-first landings use suspension', () => {
  for (const scenario of [
    { pitch: 1.2, height: 6, fall: -18, minimum: 60, maximum: 99 },
    { pitch: 1.5, height: 6, fall: -26, minimum: 100, maximum: 100 },
    { pitch: 0, height: 1.2, fall: 0, minimum: 0, maximum: 0 },
  ]) {
    const car = flatCar(scenario.height, scenario.pitch);
    const damage = createVehicleDamage();
    let firstStrike = false;
    try {
      car.body.setLinvel({ x: 0, y: scenario.fall, z: 24 }, true);
      for (let i = 0; i < 360; i++) {
        const state = car.step(idle, dt);
        if (!firstStrike && state.impact.speed > 10 && scenario.pitch > 1) {
          const local = state.impact.point
            .clone()
            .sub(state.position)
            .applyQuaternion(state.rotation.clone().invert());
          assert.ok(local.z > 1.3, 'The impact is located at the nose');
          assert.ok(
            state.wheels.every((wheel) => !wheel.contact),
            'The body strikes before the tires touch',
          );
          firstStrike = true;
        }
        advanceVehicleDamage(damage, state.impact.speed, dt);
      }
      assert.ok(
        damage.amount >= scenario.minimum && damage.amount <= scenario.maximum,
        `Expected ${scenario.minimum}–${scenario.maximum}% damage, got ${damage.amount}`,
      );
      if (scenario.pitch > 1) assert.ok(firstStrike);
    } finally {
      car.dispose();
    }
  }
});
