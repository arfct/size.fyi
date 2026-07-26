import * as THREE from 'three';
import { expect, test } from 'vitest';
import { computeKeys, computeTargetBounds, computeTargets, type SceneItem } from '../scene';

const item = (
  overrides: Partial<SceneItem> & Pick<SceneItem, 'name' | 'h' | 'w' | 'd'>,
): SceneItem => ({
  color: '#123456',
  ...overrides,
});

test('computeKeys disambiguates duplicate name+dims+mesh items with a stable #n suffix', () => {
  const phone = item({ name: 'Phone', h: 150, w: 75, d: 8 });
  const keys = computeKeys([phone, phone, phone]);
  expect(keys).toEqual(['Phone|150x75x8||', 'Phone|150x75x8||#1', 'Phone|150x75x8||#2']);
});

test('computeKeys keeps distinct items (different dims or mesh) unsuffixed', () => {
  const a = item({ name: 'Phone', h: 150, w: 75, d: 8 });
  const b = item({ name: 'Phone', h: 160, w: 75, d: 8 }); // different h
  const c = item({ name: 'Banana', h: 20, w: 40, d: 20, mesh: 'banana' });
  expect(computeKeys([a, b, c])).toEqual([
    'Phone|150x75x8||',
    'Phone|160x75x8||',
    'Banana|20x40x20|banana|',
  ]);
});

test('computeKeys distinguishes same dims by seam state (foldable open vs closed key)', () => {
  const closed = item({ name: 'Fold', h: 150, w: 75, d: 8, seam: true });
  const open = item({ name: 'Fold', h: 150, w: 75, d: 8 });
  expect(computeKeys([closed, open])).toEqual(['Fold|150x75x8||seam', 'Fold|150x75x8||']);
});

test('row targets: sequential x, gap = smaller neighbour min-dimension, front-aligned to z=0 (center at -d/2), renderOrder 0', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 }); // vol 1000, minDim 10
  const b = item({ name: 'B', h: 10, w: 20, d: 10 }); // vol 2000, minDim 10
  const keys = computeKeys([a, b]);
  const targets = computeTargets([a, b], keys, 'row');

  const gap = Math.min(10, 10); // min-dim of the a/b pair

  const ta = targets.get(keys[0]!)!;
  expect(ta.pos.x).toBeCloseTo(0 + a.w / 2); // 5
  expect(ta.pos.y).toBeCloseTo(a.h / 2);
  expect(ta.pos.z).toBeCloseTo(-a.d / 2); // front face at z=0, extending back
  expect(ta.renderOrder).toBe(0);

  const expectedBx = a.w + gap + b.w / 2; // 10 + 10 + 10 = 30
  const tb = targets.get(keys[1]!)!;
  expect(tb.pos.x).toBeCloseTo(expectedBx);
  expect(tb.pos.y).toBeCloseTo(b.h / 2);
  expect(tb.pos.z).toBeCloseTo(-b.d / 2); // front face at z=0, extending back
  expect(tb.renderOrder).toBe(0);
});

test('layout sorts smallest-to-largest by volume regardless of input order', () => {
  const big = item({ name: 'Big', h: 30, w: 30, d: 30 }); // vol 27000
  const small = item({ name: 'Small', h: 5, w: 5, d: 5 }); // vol 125
  const mid = item({ name: 'Mid', h: 10, w: 10, d: 10 }); // vol 1000
  const keys = computeKeys([big, small, mid]); // deliberately out of order
  const targets = computeTargets([big, small, mid], keys, 'row');
  // x increases smallest → largest, so small sits leftmost, big rightmost.
  const xs = keys.map((k) => targets.get(k)!.pos.x);
  const [xBig, xSmall, xMid] = xs;
  expect(xSmall!).toBeLessThan(xMid!);
  expect(xMid!).toBeLessThan(xBig!);
});

test('stack targets: largest at the back (z=0) down to smallest at the front, per-pair min-dim gap', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 }); // vol 1000, minDim 10
  const b = item({ name: 'B', h: 20, w: 20, d: 30 }); // vol 12000, minDim 20
  const c = item({ name: 'C', h: 5, w: 5, d: 5 }); // vol 125, minDim 5
  const items = [a, b, c];
  const keys = computeKeys(items); // keys[0]=a, keys[1]=b, keys[2]=c
  const targets = computeTargets(items, keys, 'stack');

  // Largest→smallest along +z: b, a, c. Gaps: b→a = min(20,10)=10, a→c = min(10,5)=5.
  const tb = targets.get(keys[1]!)!;
  expect(tb.pos.x).toBeCloseTo(b.w / 2); // left edge at x=0
  expect(tb.pos.y).toBeCloseTo(b.h / 2);
  expect(tb.pos.z).toBeCloseTo(b.d / 2); // 15
  expect(tb.renderOrder).toBe(0);

  const ta = targets.get(keys[0]!)!;
  expect(ta.pos.z).toBeCloseTo(b.d + 10 + a.d / 2); // 30 + 10 + 5 = 45
  expect(ta.renderOrder).toBe(1);

  const tc = targets.get(keys[2]!)!;
  expect(tc.pos.z).toBeCloseTo(b.d + 10 + a.d + 5 + c.d / 2); // 30 + 10 + 10 + 5 + 2.5 = 57.5
  expect(tc.renderOrder).toBe(2);

  // All stacked items share the bottom-left corner: left edge at x=0.
  for (const [it, t] of [
    [a, ta],
    [b, tb],
    [c, tc],
  ] as const)
    expect(t.pos.x - it.w / 2).toBeCloseTo(0);

  // No overlap in depth along the placement order b → a → c.
  expect(ta.pos.z - a.d / 2).toBeGreaterThanOrEqual(tb.pos.z + b.d / 2 - 1e-9);
  expect(tc.pos.z - c.d / 2).toBeGreaterThanOrEqual(ta.pos.z + a.d / 2 - 1e-9);
});

test('stack gap is capped at 1 cm even for large items', () => {
  const big = item({ name: 'Big', h: 100, w: 100, d: 100 }); // minDim 100
  const bigger = item({ name: 'Bigger', h: 120, w: 120, d: 120 }); // minDim 120
  const keys = computeKeys([big, bigger]);
  const targets = computeTargets([big, bigger], keys, 'stack');
  // Uncapped the gap would be min(120,100)=100; capped to 10.
  const zBigger = targets.get(keys[1]!)!.pos.z; // largest, at the back
  const zBig = targets.get(keys[0]!)!.pos.z;
  expect(zBigger).toBeCloseTo(bigger.d / 2); // 60
  expect(zBig).toBeCloseTo(bigger.d + 10 + big.d / 2); // 120 + 10 + 50 = 180
});

test('row layout keeps renderOrder 0 for all items', () => {
  const big = item({ name: 'Big', h: 30, w: 100, d: 100 });
  const small = item({ name: 'Small', h: 10, w: 10, d: 10 });
  const keys = computeKeys([big, small]);
  const targets = computeTargets([big, small], keys, 'row');
  expect(targets.get(keys[0]!)!.renderOrder).toBe(0);
  expect(targets.get(keys[1]!)!.renderOrder).toBe(0);
});

test('computeTargetBounds matches the expected Box3 for a known row fixture', () => {
  const a = item({ name: 'A', h: 10, w: 10, d: 10 }); // sorted first: x=5, gap 10
  const b = item({ name: 'B', h: 10, w: 20, d: 10 }); // sorted second: x=30
  const keys = computeKeys([a, b]);
  const targets = computeTargets([a, b], keys, 'row');
  const box = computeTargetBounds([a, b], keys, targets);

  const expected = new THREE.Box3(
    new THREE.Vector3(0, 0, -10), // front-aligned: centers at z=-d/2, so each item spans [-d, 0]
    new THREE.Vector3(40, 10, 0),
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
