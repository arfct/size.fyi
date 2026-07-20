import { expect, test } from 'vitest';
import { safeAreaFrame } from '../scene';

test('with no inset, the safe area is the full frame', () => {
  const frame = safeAreaFrame(1200, 800, 0);
  expect(frame).toEqual({ width: 1200, height: 800, safeW: 1200, aspect: 1200 / 800 });
});

test('a left inset shrinks the safe-area width and aspect, not the full width', () => {
  const frame = safeAreaFrame(1200, 800, 320);
  expect(frame.width).toBe(1200);
  expect(frame.safeW).toBe(880);
  expect(frame.aspect).toBeCloseTo(880 / 800);
});

test('degenerate inputs are clamped to stay at least 1px', () => {
  expect(safeAreaFrame(0, 0, 0)).toEqual({ width: 1, height: 1, safeW: 1, aspect: 1 });
  expect(safeAreaFrame(100, 100, -50)).toMatchObject({ safeW: 100 }); // negative inset ignored
  expect(safeAreaFrame(100, 100, 500)).toMatchObject({ safeW: 1 }); // inset larger than width
});
