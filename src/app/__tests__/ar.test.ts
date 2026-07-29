import { expect, test } from 'vitest';
import type { ComparisonItem, Device } from '../../shared/types';
import { comparisonArUrl, isAndroid, sceneViewerUrl } from '../ar';

test('isAndroid detects the platform from the user agent', () => {
  expect(isAndroid('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome')).toBe(true);
  expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(false);
  expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(false);
});

test('sceneViewerUrl builds a Scene Viewer intent with an absolute file + fallback', () => {
  const u = sceneViewerUrl(
    '/models/pebble-time-2.glb',
    'Pebble Time 2',
    'https://size.fyi/pebble-time-2',
  );
  const decoded = decodeURIComponent(u);
  expect(u.startsWith('intent://arvr.google.com/scene-viewer/1.0?file=')).toBe(true);
  expect(decoded).toContain('/models/pebble-time-2.glb'); // resolved to an absolute URL
  expect(u).toContain('mode=ar_preferred');
  expect(decoded).toContain('S.browser_fallback_url=https://size.fyi/pebble-time-2');
  expect(u.endsWith(';end;')).toBe(true);
});

test('comparisonArUrl points at the Worker route using the shareable path grammar', () => {
  const items: ComparisonItem[] = [
    { kind: 'device', device: { slug: 'iphone-13-mini', name: 'iPhone 13 mini' } as Device },
    { kind: 'custom', name: 'My Box', h: 300, w: 200, d: 100 },
  ];
  // Custom dimensions encode height x width x depth, matching the grammar the README documents.
  expect(comparisonArUrl(items, 'row', 'usdz')).toBe(
    '/ar/iphone-13-mini-vs-my_box~300x200x100.usdz',
  );
});

test('comparisonArUrl carries the layout, since a stack and a row are different models', () => {
  const items: ComparisonItem[] = [
    { kind: 'device', device: { slug: 'a', name: 'A' } as Device },
    { kind: 'device', device: { slug: 'b', name: 'B' } as Device },
  ];
  // Side-by-side is the route's default, so it stays out of the URL and keeps one cache entry.
  expect(comparisonArUrl(items, 'row', 'usdz')).toBe('/ar/a-vs-b.usdz');
  expect(comparisonArUrl(items, 'stack', 'usdz')).toBe('/ar/a-vs-b.usdz?layout=stack');
});

test('comparisonArUrl emits an explicit state, so the route never has to redirect', () => {
  const fold = {
    slug: 'galaxy-z-fold8',
    name: 'Galaxy Z Fold8',
    defaultState: 'closed',
    states: [
      { label: 'closed', h: 1, w: 1, d: 1 },
      { label: 'open', h: 1, w: 2, d: 1 },
    ],
  } as Device;
  const items: ComparisonItem[] = [
    { kind: 'device', device: fold, state: 'open' },
    { kind: 'device', device: { slug: 'x', name: 'X' } as Device },
  ];
  expect(comparisonArUrl(items, 'row', 'usdz')).toBe('/ar/galaxy-z-fold8-open-vs-x.usdz');
});

test('comparisonArUrl serves both viewers off one path', () => {
  const items: ComparisonItem[] = [
    { kind: 'device', device: { slug: 'a', name: 'A' } as Device },
    { kind: 'device', device: { slug: 'b', name: 'B' } as Device },
  ];
  // Quick Look takes USDZ, Scene Viewer takes GLB; same comparison, same layout handling.
  expect(comparisonArUrl(items, 'row', 'usdz')).toBe('/ar/a-vs-b.usdz');
  expect(comparisonArUrl(items, 'row', 'glb')).toBe('/ar/a-vs-b.glb');
  expect(comparisonArUrl(items, 'stack', 'glb')).toBe('/ar/a-vs-b.glb?layout=stack');
});
