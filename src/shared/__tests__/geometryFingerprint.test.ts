import { expect, test } from 'vitest';
import { cardFingerprint, geometryFingerprint, geometryKey } from '../ar';
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

// The card draws names; AR does not. Renaming a device must move the card's URL and leave the AR
// model's alone — the exact case that surfaced when "Steam Machine (2026)" became "Steam Machine".
test('a rename moves the card fingerprint but not the geometry one', () => {
  const before = device({ name: 'Steam Machine (2026)' });
  const after = device({ name: 'Steam Machine' });
  expect(geometryFingerprint([after])).toBe(geometryFingerprint([before]));
  expect(cardFingerprint([after])).not.toBe(cardFingerprint([before]));
});

test('the card fingerprint still moves when geometry moves', () => {
  expect(cardFingerprint([device({ h: 151 })])).not.toBe(cardFingerprint([device()]));
});

test('a rotated alternate fingerprints differently, since its mesh is the turned one', () => {
  const phone = device({ rotation: 'ccw' });
  const turned: ComparisonItem = { ...phone, rotated: true } as ComparisonItem;
  expect(geometryFingerprint([turned])).not.toBe(geometryFingerprint([phone]));
  // Without a rotation authored the flag means nothing, so the fingerprint holds still.
  const plain = device();
  expect(geometryFingerprint([{ ...plain, rotated: true } as ComparisonItem])).toBe(
    geometryFingerprint([plain]),
  );
});

test('geometryKey names the rotated layer, only where a rotation exists', () => {
  const phone = device({ rotation: 'ccw' });
  const duo = fold({
    states: [
      { label: 'closed', h: 118, w: 84, d: 11, rotation: 'cw' },
      { label: 'open', h: 118, w: 165, d: 5, rotation: 'cw' },
    ],
  });
  const dev = (i: ComparisonItem) => (i.kind === 'device' ? i.device : (null as never));
  expect(geometryKey(dev(phone), undefined, true)).toBe('phone-rotated');
  expect(geometryKey(dev(phone))).toBe('phone');
  expect(geometryKey(dev(duo), 'open', true)).toBe('fold-open-rotated');
  expect(geometryKey(dev(duo), undefined, true)).toBe('fold-closed-rotated');
  expect(geometryKey(dev(fold()), 'open', true)).toBe('fold-open');
});
