import { expect, test } from 'vitest';
import { gridSpec } from '../scene';

test('metric grid: 1 cm major squares with 5 mm minor lines', () => {
  const s = gridSpec('metric', 100);
  expect(s.unitMM).toBe(10);
  expect(s.minorMM).toBe(5);
  expect(s.halfExtent).toBe(s.majorCount * 10);
});

test('imperial grid: 1 inch major squares with half-inch minor lines', () => {
  const s = gridSpec('imperial', 100);
  expect(s.unitMM).toBeCloseTo(25.4);
  expect(s.minorMM).toBeCloseTo(12.7);
  expect(s.halfExtent).toBeCloseTo(s.majorCount * 25.4);
});

test('extent grows with content but is clamped for very large objects', () => {
  expect(gridSpec('metric', 1).majorCount).toBe(6); // small floor
  expect(gridSpec('metric', 5000).majorCount).toBe(40); // clamped ceiling
});
