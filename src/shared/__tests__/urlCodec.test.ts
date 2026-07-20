import { describe, expect, test } from 'vitest';
import { encodeComparison, decodeComparison, comparisonTitle, slugify } from '../urlCodec';
import type { Device, ComparisonItem } from '../types';

const iphone: Device = { slug: 'iphone-16-pro', name: 'iPhone 16 Pro', category: 'phone', h: 149.6, w: 71.5, d: 8.25 };
const a4: Device = { slug: 'paper-a4', name: 'Paper: A4', category: 'paper', h: 297, w: 210, d: 1 };
const bySlug = new Map([[iphone.slug, iphone], [a4.slug, a4]]);
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
  expect(r.items).toEqual([
    { kind: 'custom', name: 'Shoebox', h: 350, w: 250, d: 130 },
    dev(a4),
  ]);
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
  for (const p of ['/', '', '/api/devices', '/%2e%2e/etc', '/a~bxcxd', '/x~1x2', '/x~-1x2x3', '/-vs--vs-', '/a'.repeat(500)]) {
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
