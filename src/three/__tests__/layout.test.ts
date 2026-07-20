import * as THREE from 'three';
import { expect, test } from 'vitest';
import { computeKeys, computeTargetBounds, computeTargets, type SceneItem } from '../scene';

const item = (overrides: Partial<SceneItem> & Pick<SceneItem, 'name' | 'h' | 'w' | 'd'>): SceneItem => ({
  color: '#123456',
  ...overrides,
});

test('computeKeys disambiguates duplicate name+dims+mesh items with a stable #n suffix', () => {
  const phone = item({ name: 'Phone', h: 150, w: 75, d: 8 });
  const keys = computeKeys([phone, phone, phone]);
  expect(keys).toEqual(['Phone|150x75x8|', 'Phone|150x75x8|#1', 'Phone|150x75x8|#2']);
});

test('computeKeys keeps distinct items (different dims or mesh) unsuffixed', () => {
  const a = item({ name: 'Phone', h: 150, w: 75, d: 8 });
  const b = item({ name: 'Phone', h: 160, w: 75, d: 8 }); // different h
  const c = item({ name: 'Banana', h: 20, w: 40, d: 20, mesh: 'banana' });
  expect(computeKeys([a, b, c])).toEqual(['Phone|150x75x8|', 'Phone|160x75x8|', 'Banana|20x40x20|banana']);
});

test('row targets: sequential x with an 8%-of-max-dimension gap, all at z=0, renderOrder 0', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 });
  const b = item({ name: 'B', h: 10, w: 20, d: 10 });
  const keys = computeKeys([a, b]);
  const targets = computeTargets([a, b], keys, 'row');

  const maxDim = 20;
  const gap = maxDim * 0.08; // 1.6

  const ta = targets.get(keys[0]!)!;
  expect(ta.pos.x).toBeCloseTo(0 + a.w / 2); // 5
  expect(ta.pos.y).toBeCloseTo(a.h / 2);
  expect(ta.pos.z).toBe(0);
  expect(ta.renderOrder).toBe(0);

  const expectedBx = a.w + gap + b.w / 2; // 10 + 1.6 + 10 = 21.6
  const tb = targets.get(keys[1]!)!;
  expect(tb.pos.x).toBeCloseTo(expectedBx);
  expect(tb.pos.y).toBeCloseTo(b.h / 2);
  expect(tb.pos.z).toBe(0);
  expect(tb.renderOrder).toBe(0);
});

test('stack targets: sequential z (front-to-back) with an 8%-of-max gap, centered on x=0, no overlap', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 });
  const b = item({ name: 'B', h: 20, w: 20, d: 30 });
  const c = item({ name: 'C', h: 5, w: 5, d: 5 });
  const items = [a, b, c];
  const keys = computeKeys(items);
  const targets = computeTargets(items, keys, 'stack');

  const maxDim = 30; // max of all dims
  const gap = maxDim * 0.08; // 2.4

  const ta = targets.get(keys[0]!)!;
  expect(ta.pos.x).toBe(0);
  expect(ta.pos.y).toBeCloseTo(a.h / 2);
  expect(ta.pos.z).toBeCloseTo(a.d / 2); // 5

  const tb = targets.get(keys[1]!)!;
  expect(tb.pos.x).toBe(0);
  expect(tb.pos.y).toBeCloseTo(b.h / 2);
  expect(tb.pos.z).toBeCloseTo(a.d + gap + b.d / 2); // 10 + 2.4 + 15 = 27.4

  const tc = targets.get(keys[2]!)!;
  expect(tc.pos.z).toBeCloseTo(a.d + gap + b.d + gap + c.d / 2); // 10 + 2.4 + 30 + 2.4 + 2.5 = 47.3

  // renderOrder increases front-to-back so nearer items draw last (correct translucent blending).
  expect(ta.renderOrder).toBe(0);
  expect(tb.renderOrder).toBe(1);
  expect(tc.renderOrder).toBe(2);

  // No overlap in depth: each item's near face sits beyond the previous item's far face.
  expect(tb.pos.z - b.d / 2).toBeGreaterThanOrEqual(ta.pos.z + a.d / 2 - 1e-9);
  expect(tc.pos.z - c.d / 2).toBeGreaterThanOrEqual(tb.pos.z + b.d / 2 - 1e-9);
});

test('row layout resets renderOrder to 0 regardless of footprint', () => {
  const big = item({ name: 'Big', h: 30, w: 100, d: 100 });
  const small = item({ name: 'Small', h: 10, w: 10, d: 10 });
  const keys = computeKeys([big, small]);
  const targets = computeTargets([big, small], keys, 'row');
  expect(targets.get(keys[0]!)!.renderOrder).toBe(0);
  expect(targets.get(keys[1]!)!.renderOrder).toBe(0);
});

test('computeTargetBounds matches the expected Box3 for a known row fixture', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 }); // centered at x=5, y=5, z=0
  const b = item({ name: 'B', h: 10, w: 20, d: 10 }); // centered at x=21.6, y=5, z=0
  const keys = computeKeys([a, b]);
  const targets = computeTargets([a, b], keys, 'row');
  const box = computeTargetBounds([a, b], keys, targets);

  const expected = new THREE.Box3(
    new THREE.Vector3(0, 0, -5),
    new THREE.Vector3(31.6, 10, 5),
  );
  expect(box.min.x).toBeCloseTo(expected.min.x);
  expect(box.min.y).toBeCloseTo(expected.min.y);
  expect(box.min.z).toBeCloseTo(expected.min.z);
  expect(box.max.x).toBeCloseTo(expected.max.x);
  expect(box.max.y).toBeCloseTo(expected.max.y);
  expect(box.max.z).toBeCloseTo(expected.max.z);
});

test('computeTargetBounds falls back to a fixed default box for empty items', () => {
  const box = computeTargetBounds([], [], new Map());
  expect(box.min).toEqual(new THREE.Vector3(-100, 0, -100));
  expect(box.max).toEqual(new THREE.Vector3(100, 100, 100));
});
