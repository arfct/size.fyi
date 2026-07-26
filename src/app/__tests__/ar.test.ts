import { expect, test } from 'vitest';
import { isAndroid, sceneViewerUrl } from '../ar';

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
