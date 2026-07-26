import { expect, test } from 'vitest';
import { searchDevices, suggestDevices } from '../search';
import type { Device } from '../types';

const D = (slug: string, name: string, extra: Partial<Device> = {}): Device => ({
  slug,
  name,
  category: 'phone',
  h: 1,
  w: 1,
  d: 1,
  ...extra,
});

const devices = [
  D('iphone-16', 'iPhone 16', { make: 'Apple' }),
  D('iphone-16-pro', 'iPhone 16 Pro', { make: 'Apple' }),
  D('galaxy-s24', 'Galaxy S24', { make: 'Samsung', model: 'Galaxy S24', aliases: ['s24'] }),
  D('paper-a4', 'Paper: A4', { category: 'paper' }),
];

test('prefix beats substring', () => {
  const r = searchDevices(devices, 'iphone');
  expect(r[0]!.slug).toBe('iphone-16');
  expect(r.map((d) => d.slug)).toContain('iphone-16-pro');
});
test('matches make, model, and aliases', () => {
  expect(searchDevices(devices, 'samsung')[0]!.slug).toBe('galaxy-s24');
  expect(searchDevices(devices, 's24')[0]!.slug).toBe('galaxy-s24');
});
test('multi-token requires all tokens', () =>
  expect(searchDevices(devices, '16 pro')[0]!.slug).toBe('iphone-16-pro'));
test('no match → empty; empty query → empty', () => {
  expect(searchDevices(devices, 'zzz')).toEqual([]);
  expect(searchDevices(devices, '  ')).toEqual([]);
});
test('respects limit', () => expect(searchDevices(devices, 'a', 2)).toHaveLength(2));

const suggestFixture = [
  D('phone-hi', 'Phone Hi', { make: 'A', rank: 90 }),
  D('phone-lo', 'Phone Lo', { make: 'A', rank: 40 }),
  D('phone-mid', 'Phone Mid', { make: 'A', rank: 60 }),
  D('tablet-hi', 'Tablet Hi', { category: 'tablet', rank: 95 }),
  D('everyday-hi', 'Everyday Hi', { category: 'everyday', rank: 99 }),
];

test('suggestDevices ranks by rank descending and caps at the limit', () => {
  const out = suggestDevices(suggestFixture, new Set(), new Set(), 3);
  expect(out.map((d) => d.slug)).toEqual(['everyday-hi', 'tablet-hi', 'phone-hi']);
});

test('suggestDevices filters to the given categories when any are provided', () => {
  const out = suggestDevices(suggestFixture, new Set(['phone']), new Set(), 4);
  expect(out.map((d) => d.slug)).toEqual(['phone-hi', 'phone-mid', 'phone-lo']);
});

test('suggestDevices excludes already-added slugs', () => {
  const out = suggestDevices(suggestFixture, new Set(['phone']), new Set(['phone-hi']), 4);
  expect(out.map((d) => d.slug)).toEqual(['phone-mid', 'phone-lo']);
});
