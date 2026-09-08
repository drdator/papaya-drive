import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSkidMarks } from '../app/skid-marks.ts';

await test('each rear tire paints independently and contact loss breaks its trail', () => {
  const marks = createSkidMarks();
  const tires = [
    { point: { x: 30, y: 0, z: 30 }, skidding: true },
    { point: { x: 32, y: 0, z: 30 }, skidding: false },
  ];
  marks.update(tires);
  tires.forEach((tire) => (tire.point.z += 0.3));
  marks.update(tires);
  assert.equal(marks.mesh.geometry.drawRange.count, 6);
  tires[0].skidding = false;
  marks.update(tires);
  tires.forEach((tire) => {
    tire.point.z += 0.3;
    tire.skidding = true;
  });
  marks.update(tires);
  assert.equal(
    marks.mesh.geometry.drawRange.count,
    6,
    'Touching down must not bridge an airborne gap',
  );
  tires.forEach((tire) => (tire.point.z += 0.3));
  marks.update(tires);
  assert.equal(marks.mesh.geometry.drawRange.count, 18);
  marks.reset();
  assert.equal(marks.mesh.geometry.drawRange.count, 0);
  marks.mesh.geometry.dispose();
  marks.mesh.material.dispose();
});
