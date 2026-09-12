import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPixelRatio } from '../app/render-resolution.ts';

await test('normal zoom retains the existing desktop and phone resolution', () => {
  for (const [deviceRatio, expected] of [
    [1, 1],
    [1.25, 1.25],
    [2, 1.8],
    [3, 1.8],
  ]) {
    assert.equal(renderPixelRatio(deviceRatio), expected);
    assert.equal(renderPixelRatio(deviceRatio, 1), expected);
  }
});

await test('Safari zoom-out preserves drawing-buffer density instead of quadrupling pixels', () => {
  const buffer = (width: number, height: number, scale: number) => {
    const ratio = renderPixelRatio(3, scale);
    return [Math.floor(width * ratio), Math.floor(height * ratio)];
  };
  const normal = buffer(428, 727, 1);
  assert.deepEqual(normal, [770, 1308]);
  assert.deepEqual(buffer(856, 1454, 0.5), normal);
  assert.deepEqual(buffer(1712, 2908, 0.25), normal);
  // Rotation changes the aspect ratio, not the pixel budget.
  assert.deepEqual(buffer(1454, 856, 0.5), [1308, 770]);
});

await test('zoom-in and inactive viewport reports do not alter the existing resolution cap', () => {
  for (const scale of [2, 3, 0, NaN]) {
    assert.equal(renderPixelRatio(3, scale), 1.8);
  }
});
