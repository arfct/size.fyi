import { describe, expect, test } from 'vitest';
import type { Device } from '../types';
import {
  activeState,
  defaultStateLabel,
  deviceDims,
  itemDims,
  orientation,
  rotationOf,
} from '../types';

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
  expect(itemDims({ kind: 'custom', name: 'Box', h: 10, w: 20, d: 30 })).toEqual({
    h: 10,
    w: 20,
    d: 30,
  });
  expect(itemDims({ kind: 'device', device: fold, state: 'open' })).toMatchObject({ w: 161.4 });
});

describe('rotation', () => {
  const phone: Device = {
    ...flat,
    rotation: 'ccw',
    radiusInner: 2,
    screen: { h: 140, w: 65, radius: 8, px: { w: 1206, h: 2622 } },
  };
  const duo: Device = {
    ...fold,
    states: [
      { label: 'closed', h: 117.8, w: 84.1, d: 11.3, rotation: 'cw', seam: true },
      { label: 'open', h: 117.8, w: 164.6, d: 5.2, rotation: 'cw', hinge: 'right' },
    ],
  };

  test('rotated swaps height and width, and the screen with its pixels', () => {
    expect(deviceDims(phone, undefined, true)).toMatchObject({
      h: 71,
      w: 150,
      d: 8,
      screen: { h: 65, w: 140, radius: 8, px: { w: 2622, h: 1206 } },
    });
  });
  test('the hinge follows the turn: cw takes left to top, ccw takes left to bottom', () => {
    expect(deviceDims(duo, 'closed', true).hinge).toBe('top');
    expect(deviceDims(duo, 'open', true).hinge).toBe('bottom');
    expect(deviceDims(phone, undefined, true).hinge).toBe('bottom');
  });
  test('unrotated dims are untouched, hinge included', () => {
    expect(deviceDims(phone)).toMatchObject({ h: 150, w: 71 });
    expect(deviceDims(phone).hinge).toBeUndefined();
    expect(deviceDims(duo, 'open').hinge).toBe('right');
  });
  test('rotated is ignored where no rotation is authored', () => {
    expect(deviceDims(flat, undefined, true)).toMatchObject({ h: 150, w: 71 });
    expect(deviceDims(fold, 'open', true)).toMatchObject({ h: 123.9, w: 161.4 });
  });
  test('itemDims carries the item flag', () => {
    expect(itemDims({ kind: 'device', device: phone, rotated: true })).toMatchObject({ w: 150 });
    expect(itemDims({ kind: 'device', device: duo, state: 'open', rotated: true })).toMatchObject({
      h: 164.6,
      w: 117.8,
    });
  });
  test('rotationOf reads the active geometry', () => {
    expect(rotationOf(phone)).toBe('ccw');
    expect(rotationOf(duo, 'open')).toBe('cw');
    expect(rotationOf(flat)).toBeUndefined();
    expect(rotationOf(fold, 'open')).toBeUndefined();
  });
  test('orientation is whichever dimension is longer, portrait on a tie', () => {
    expect(orientation({ h: 150, w: 71 })).toBe('portrait');
    expect(orientation({ h: 117.8, w: 164.6 })).toBe('landscape');
    expect(orientation({ h: 100, w: 100 })).toBe('portrait');
  });
});
