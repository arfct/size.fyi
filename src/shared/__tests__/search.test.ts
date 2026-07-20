import { expect, test } from 'vitest';
import { searchDevices } from '../search';
import type { Device } from '../types';

const D = (slug: string, name: string, extra: Partial<Device> = {}): Device =>
  ({ slug, name, category: 'phone', h: 1, w: 1, d: 1, ...extra });

const devices = [
  D('iphone-16', 'iPhone 16', { brand: 'Apple' }),
  D('iphone-16-pro', 'iPhone 16 Pro', { brand: 'Apple' }),
  D('galaxy-s24', 'Galaxy S24', { brand: 'Samsung', aliases: ['s24'] }),
  D('paper-a4', 'Paper: A4', { category: 'paper' }),
];

test('prefix beats substring', () => {
  const r = searchDevices(devices, 'iphone');
  expect(r[0]!.slug).toBe('iphone-16');
  expect(r.map((d) => d.slug)).toContain('iphone-16-pro');
});
test('matches brand and aliases', () => {
  expect(searchDevices(devices, 'samsung')[0]!.slug).toBe('galaxy-s24');
  expect(searchDevices(devices, 's24')[0]!.slug).toBe('galaxy-s24');
});
test('multi-token requires all tokens', () =>
  expect(searchDevices(devices, '16 pro')[0]!.slug).toBe('iphone-16-pro'));
test('no match → empty; empty query → empty', () => {
  expect(searchDevices(devices, 'zzz')).toEqual([]);
  expect(searchDevices(devices, '  ')).toEqual([]);
});
test('respects limit', () =>
  expect(searchDevices(devices, 'a', 2)).toHaveLength(2));
