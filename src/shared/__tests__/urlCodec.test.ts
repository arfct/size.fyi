import { describe, expect, test } from 'vitest';
import type { ComparisonItem, Device } from '../types';
import { comparisonTitle, decodeComparison, encodeComparison, slugify } from '../urlCodec';

const iphone: Device = {
  slug: 'iphone-16-pro',
  name: 'iPhone 16 Pro',
  category: 'phone',
  h: 149.6,
  w: 71.5,
  d: 8.25,
};
const a4: Device = { slug: 'paper-a4', name: 'Paper: A4', category: 'paper', h: 297, w: 210, d: 1 };
const fold: Device = {
  slug: 'galaxy-z-fold8',
  name: 'Galaxy Z Fold8',
  category: 'phone',
  h: 123.9,
  w: 81.9,
  d: 9.7,
  defaultState: 'closed',
  states: [
    { label: 'closed', h: 123.9, w: 81.9, d: 9.7, seam: true },
    { label: 'open', h: 123.9, w: 161.4, d: 4.5 },
  ],
};
const bySlug = new Map([
  [iphone.slug, iphone],
  [a4.slug, a4],
  [fold.slug, fold],
]);
const dev = (device: Device): ComparisonItem => ({ kind: 'device', device });
const custom: ComparisonItem = { kind: 'custom', name: 'Shoebox', h: 350, w: 250, d: 130 };

test('encodes devices with -vs-', () =>
  expect(encodeComparison([dev(iphone), dev(a4)])).toBe('/iphone-16-pro-vs-paper-a4'));
test('encodes custom items with ~', () =>
  expect(encodeComparison([custom, dev(a4)])).toBe('/shoebox~350x250x130-vs-paper-a4'));
test('empty encodes to /', () => expect(encodeComparison([])).toBe('/'));

test('decode round-trips devices and customs', () => {
  const r = decodeComparison('/shoebox~350x250x130-vs-paper-a4', bySlug);
  expect(r.missing).toEqual([]);
  expect(r.items).toEqual([{ kind: 'custom', name: 'Shoebox', h: 350, w: 250, d: 130 }, dev(a4)]);
});
test('decimal dims round-trip', () => {
  const c: ComparisonItem = { kind: 'custom', name: 'Thing', h: 8.3, w: 71.5, d: 149.6 };
  const r = decodeComparison(encodeComparison([c]), bySlug);
  expect(r.items).toEqual([c]);
});
test('unknown slugs reported as missing, rest kept', () => {
  const r = decodeComparison('/nokia-3310-vs-paper-a4', bySlug);
  expect(r.missing).toEqual(['nokia-3310']);
  expect(r.items).toEqual([dev(a4)]);
});
test('hostile input never throws, yields empty', () => {
  for (const p of [
    '/',
    '',
    '/api/devices',
    '/%2e%2e/etc',
    '/a~bxcxd',
    '/x~1x2',
    '/x~-1x2x3',
    '/-vs--vs-',
    '/a'.repeat(500),
  ]) {
    const r = decodeComparison(p, bySlug);
    expect(Array.isArray(r.items)).toBe(true);
  }
});
test('caps at 8 items', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `t${i}~10x10x10`).join('-vs-');
  expect(decodeComparison('/' + nine, bySlug).items).toHaveLength(8);
});
test('title', () =>
  expect(comparisonTitle([dev(iphone), custom])).toBe('iPhone 16 Pro vs Shoebox'));
test('slugify', () => {
  expect(slugify('Paper: A4')).toBe('paper-a4');
  expect(slugify('  Böxy thing!! ')).toBe('boxy-thing');
});

describe('multi-state devices', () => {
  test('state is encoded explicitly as slug-state', () => {
    expect(encodeComparison([{ kind: 'device', device: fold }])).toBe('/galaxy-z-fold8-closed'); // default
    expect(encodeComparison([{ kind: 'device', device: fold, state: 'closed' }])).toBe(
      '/galaxy-z-fold8-closed',
    );
    expect(encodeComparison([{ kind: 'device', device: fold, state: 'open' }])).toBe(
      '/galaxy-z-fold8-open',
    );
  });
  test('slug-state selects the state', () => {
    expect(decodeComparison('/galaxy-z-fold8-open', bySlug).items).toEqual([
      { kind: 'device', device: fold, state: 'open' },
    ]);
    expect(decodeComparison('/galaxy-z-fold8-closed', bySlug).items).toEqual([
      { kind: 'device', device: fold, state: 'closed' },
    ]);
  });
  test('bare slug → default state (no explicit state)', () => {
    expect(decodeComparison('/galaxy-z-fold8', bySlug).items).toEqual([
      { kind: 'device', device: fold },
    ]);
  });
  test('legacy colon form still decodes', () => {
    expect(decodeComparison('/galaxy-z-fold8:open', bySlug).items).toEqual([
      { kind: 'device', device: fold, state: 'open' },
    ]);
  });
  test('unknown state on a real foldable falls back to default', () => {
    expect(decodeComparison('/galaxy-z-fold8-bogus', bySlug).items).toEqual([
      { kind: 'device', device: fold },
    ]);
  });
  test('a -state suffix on a single-state device is not mis-parsed', () => {
    // iphone-16-pro exists but has no states → the token is just unknown, not iphone-16-pro+"open"
    const r = decodeComparison('/iphone-16-pro-open', bySlug);
    expect(r.items).toEqual([]);
    expect(r.missing).toEqual(['iphone-16-pro-open']);
  });
  test('open state round-trips through encode→decode', () => {
    const item: ComparisonItem = { kind: 'device', device: fold, state: 'open' };
    expect(decodeComparison(encodeComparison([item]), bySlug).items).toEqual([item]);
  });
  test('title includes the state label for foldables', () => {
    expect(
      comparisonTitle([
        { kind: 'device', device: fold, state: 'open' },
        { kind: 'device', device: fold },
      ]),
    ).toBe('Galaxy Z Fold8 (open) vs Galaxy Z Fold8 (closed)');
  });
});

// Issue 1: custom names containing "vs" must round-trip correctly
test('custom name with "vs" round-trips correctly', () => {
  const item: ComparisonItem = { kind: 'custom', name: 'Tv Vs Monitor', h: 100, w: 100, d: 100 };
  const encoded = encodeComparison([item]);
  expect(encoded).toBe('/tv_vs_monitor~100x100x100');
  const r = decodeComparison(encoded, bySlug);
  expect(r.missing).toEqual([]);
  expect(r.items).toEqual([item]);
});
test('custom name with "vs" mixed with device', () => {
  const item: ComparisonItem = { kind: 'custom', name: 'A Vs B', h: 350, w: 250, d: 130 };
  const r = decodeComparison(encodeComparison([item, dev(a4)]), bySlug);
  expect(r.items).toHaveLength(2);
  expect(r.items[0]).toEqual(item);
  expect(r.items[1]).toEqual(dev(a4));
  expect(r.missing).toEqual([]);
});

// Issue 2: empty slug handled by fallback to 'item'
test('custom name with no ASCII encodes to "item"', () => {
  const item: ComparisonItem = { kind: 'custom', name: '你好', h: 100, w: 100, d: 100 };
  const encoded = encodeComparison([item]);
  expect(encoded).toBe('/item~100x100x100');
  const r = decodeComparison(encoded, bySlug);
  expect(r.items).toEqual([{ kind: 'custom', name: 'Item', h: 100, w: 100, d: 100 }]);
});

// Issue 3: cap missing like items (at most 8 total)
test('caps missing at 8 when decoding many unknown slugs', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `unknown-${i}`).join('-vs-');
  const r = decodeComparison('/' + twelve, bySlug);
  expect(r.missing.length).toBeLessThanOrEqual(8);
  expect(r.items.length + r.missing.length).toBeLessThanOrEqual(8);
});

// Issue 4: reserved prefix check simplified
test('reserved prefix /api yields empty', () => {
  const r = decodeComparison('/api', bySlug);
  expect(r.items).toEqual([]);
  expect(r.missing).toEqual([]);
});
