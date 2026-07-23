import { expect, test } from 'vitest';
import { deviceDims, itemDims, defaultStateLabel, activeState } from '../types';
import type { Device } from '../types';

const fold: Device = {
  slug: 'galaxy-z-fold8', name: 'Galaxy Z Fold8', category: 'phone', h: 123.9, w: 81.9, d: 9.7,
  defaultState: 'closed',
  states: [
    { label: 'closed', h: 123.9, w: 81.9, d: 9.7, seam: true },
    { label: 'open', h: 123.9, w: 161.4, d: 4.5 },
  ],
};
const flat: Device = { slug: 'iphone', name: 'iPhone', category: 'phone', h: 150, w: 71, d: 8 };

test('defaultStateLabel prefers defaultState, else first', () => {
  expect(defaultStateLabel(fold)).toBe('closed');
  expect(defaultStateLabel({ ...fold, defaultState: undefined })).toBe('closed');
  expect(defaultStateLabel(flat)).toBeUndefined();
});

test('deviceDims resolves the active state, defaults to the default state', () => {
  expect(deviceDims(fold)).toMatchObject({ w: 81.9, d: 9.7, seam: true });
  expect(deviceDims(fold, 'open')).toMatchObject({ w: 161.4, d: 4.5 });
  expect(deviceDims(fold, 'open').seam).toBeUndefined();
});

test('unknown state label falls back to the first state', () => {
  expect(activeState(fold, 'bogus')?.label).toBe('closed');
});

test('flat devices ignore state and return their own dims', () => {
  expect(deviceDims(flat, 'open')).toMatchObject({ h: 150, w: 71, d: 8 });
});

test('itemDims handles custom items', () => {
  expect(itemDims({ kind: 'custom', name: 'Box', h: 10, w: 20, d: 30 })).toEqual({ h: 10, w: 20, d: 30 });
  expect(itemDims({ kind: 'device', device: fold, state: 'open' })).toMatchObject({ w: 161.4 });
});
