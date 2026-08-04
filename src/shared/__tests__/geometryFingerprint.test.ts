import { expect, test } from 'vitest';
import { geometryFingerprint } from '../ar';
import type { ComparisonItem, Device } from '../types';

// The AR route caches immutably and cannot be purged from code, so everything the bytes depend on has
// to be in the URL. The path names the items; this names what they measure. Without it, correcting a
// device's radius left the edge serving the old shape for a year — and the only lever was
// AR_MODEL_VERSION, which invalidates all 99 devices to fix one.

const device = (over: Partial<Device> = {}): ComparisonItem => ({
  kind: 'device',
  device: {
    slug: 'phone',
    name: 'Phone',
    category: 'phone',
    h: 150,
    w: 75,
    d: 8,
    radius: 12,
    radiusAxis: 'z',
    screen: { h: 145, w: 70, radius: 10 },
    ...over,
  } as Device,
});

const fold = (over: Partial<Device> = {}): ComparisonItem => ({
  kind: 'device',
  device: {
    slug: 'fold',
    name: 'Fold',
    category: 'phone',
    h: 160,
    w: 70,
    d: 14,
    defaultState: 'closed',
    states: [
      { label: 'closed', h: 160, w: 70, d: 14, radius: 11, radiusAxis: 'z', seam: true },
      { label: 'open', h: 160, w: 140, d: 7, radius: 9, radiusAxis: 'z' },
    ],
    ...over,
  } as Device,
});

test('the same items always fingerprint the same', () => {
  expect(geometryFingerprint([device()])).toBe(geometryFingerprint([device()]));
  expect(geometryFingerprint([])).toBe(geometryFingerprint([]));
});

test('metadata that cannot change the mesh does not change it', () => {
  // A renamed device, a new source, a different search rank: same object in AR, so the cached bytes
  // stay valid and the URL must not move.
  const base = geometryFingerprint([device()]);
  expect(geometryFingerprint([device({ name: 'Phone Pro' })])).toBe(base);
  expect(geometryFingerprint([device({ rank: 99 })])).toBe(base);
  expect(geometryFingerprint([device({ source: 'elsewhere.com' })])).toBe(base);
  expect(geometryFingerprint([device({ aliases: ['p'] })])).toBe(base);
  expect(geometryFingerprint([device({ year: 2030 })])).toBe(base);
});

test('every field the mesh is built from changes it', () => {
  const base = geometryFingerprint([device()]);
  for (const over of [
    { h: 151 },
    { w: 76 },
    { d: 9 },
    { radius: 13 },
    { radiusAxis: 'y' as const },
    { radiusInner: 2 },
    { hinge: 'right' as const },
    { screen: { h: 145, w: 70, radius: 11 } },
    { screen: { h: 146, w: 70, radius: 10 } },
    { screen: undefined },
    { mesh: 'banana' as const },
    { model3d: { url: 'a.glb' } },
  ]) {
    expect(geometryFingerprint([device(over)])).not.toBe(base);
  }
});

test('a model3d rotation counts, since it orients the mesh', () => {
  const a = geometryFingerprint([device({ model3d: { url: 'a.glb' } })]);
  const b = geometryFingerprint([device({ model3d: { url: 'a.glb', rotation: [0, 90, 0] } })]);
  const c = geometryFingerprint([device({ model3d: { url: 'a.glb', rotation: [0, 180, 0] } })]);
  expect(new Set([a, b, c]).size).toBe(3);
});

test('a foldable fingerprints per state', () => {
  const closed = geometryFingerprint([{ ...fold(), state: 'closed' } as ComparisonItem]);
  const open = geometryFingerprint([{ ...fold(), state: 'open' } as ComparisonItem]);
  expect(closed).not.toBe(open);
  // An unspecified state resolves to the default, which is the same object the route would build.
  expect(geometryFingerprint([fold()])).toBe(closed);
});

test('changing one state does not move the other state’s fingerprint', () => {
  // This is the whole point of not using a global version: a correction to the closed geometry should
  // leave the open model's cache entry alone.
  const tweaked = fold({
    states: [
      {
        label: 'closed',
        h: 160,
        w: 70,
        d: 14,
        radius: 11,
        radiusAxis: 'z',
        radiusInner: 2,
        seam: true,
      },
      { label: 'open', h: 160, w: 140, d: 7, radius: 9, radiusAxis: 'z' },
    ],
  });
  const openBefore = geometryFingerprint([{ ...fold(), state: 'open' } as ComparisonItem]);
  const openAfter = geometryFingerprint([{ ...tweaked, state: 'open' } as ComparisonItem]);
  const closedBefore = geometryFingerprint([{ ...fold(), state: 'closed' } as ComparisonItem]);
  const closedAfter = geometryFingerprint([{ ...tweaked, state: 'closed' } as ComparisonItem]);
  expect(openAfter).toBe(openBefore);
  expect(closedAfter).not.toBe(closedBefore);
});

test('order matters, because palette colour is assigned by index', () => {
  const a = device({ slug: 'a', h: 10, w: 10, d: 10 });
  const b = device({ slug: 'b', h: 20, w: 20, d: 20 });
  expect(geometryFingerprint([a, b])).not.toBe(geometryFingerprint([b, a]));
});

test('custom items are covered too', () => {
  const c = (w: number): ComparisonItem => ({ kind: 'custom', name: 'Box', h: 10, w, d: 10 });
  expect(geometryFingerprint([c(10)])).not.toBe(geometryFingerprint([c(11)]));
});

test('the fingerprint is short and URL-safe', () => {
  const g = geometryFingerprint([device(), fold()]);
  expect(g).toMatch(/^[0-9a-z]{1,7}$/);
  expect(encodeURIComponent(g)).toBe(g);
});
