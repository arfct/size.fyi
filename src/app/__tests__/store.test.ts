import { expect, test } from 'vitest';
import type { ComparisonItem } from '../../shared/types';
import { type ComparisonState, reducer } from '../store';

const empty: ComparisonState = {
  items: [],
  view: '3d',
  units: 'metric',
  missing: [],
  layoutMode: 'row',
  projection: 'perspective',
  hovered: null,
};
const item = (name: string): ComparisonItem => ({ kind: 'custom', name, h: 10, w: 10, d: 10 });

test('add appends', () =>
  expect(reducer(empty, { type: 'add', item: item('A') }).items).toHaveLength(1));
test('add caps at 8', () => {
  let s = empty;
  for (let i = 0; i < 10; i++) s = reducer(s, { type: 'add', item: item(`I${i}`) });
  expect(s.items).toHaveLength(8);
});
test('remove by index', () => {
  let s = reducer(empty, { type: 'add', item: item('A') });
  s = reducer(s, { type: 'add', item: item('B') });
  s = reducer(s, { type: 'remove', index: 0 });
  expect(s.items.map((i) => i.kind === 'custom' && i.name)).toEqual(['B']);
});
test('load replaces items and missing', () => {
  const s = reducer(empty, { type: 'load', items: [item('X')], missing: ['ghost'] });
  expect(s.items).toHaveLength(1);
  expect(s.missing).toEqual(['ghost']);
});
test('dismissMissing clears notices', () => {
  const s = reducer({ ...empty, missing: ['x'] }, { type: 'dismissMissing' });
  expect(s.missing).toEqual([]);
});
test('setView / setUnits', () => {
  expect(reducer(empty, { type: 'setView', view: 'top' }).view).toBe('top');
  expect(reducer(empty, { type: 'setUnits', units: 'imperial' }).units).toBe('imperial');
});
test('setLayout switches to stack', () =>
  expect(reducer(empty, { type: 'setLayout', mode: 'stack' }).layoutMode).toBe('stack'));
test('setLayout switches back to row', () => {
  const stacked = reducer(empty, { type: 'setLayout', mode: 'stack' });
  expect(reducer(stacked, { type: 'setLayout', mode: 'row' }).layoutMode).toBe('row');
});
test('layoutMode survives unrelated actions', () => {
  const stacked = reducer(empty, { type: 'setLayout', mode: 'stack' });
  expect(reducer(stacked, { type: 'setView', view: 'top' }).layoutMode).toBe('stack');
});

// `hovered` is an index into `items`, and the reducer keeps items volume-sorted, so any mutation can
// move a different item into that slot. Stale indices would highlight the wrong row and the wrong box.
test('every mutation clears the hovered index, which addresses a slot rather than an item', () => {
  const two = reducer(reducer(empty, { type: 'add', item: item('A') }), {
    type: 'add',
    item: item('B'),
  });
  const hovered = reducer(two, { type: 'setHover', index: 1 });
  expect(hovered.hovered).toBe(1);

  // A bigger item sorts to the end and pushes the others down a slot.
  const big: ComparisonItem = { kind: 'custom', name: 'Big', h: 99, w: 99, d: 99 };
  expect(reducer(hovered, { type: 'add', item: big }).hovered).toBeNull();
  expect(reducer(hovered, { type: 'remove', index: 0 }).hovered).toBeNull();
  expect(reducer(hovered, { type: 'update', index: 0, item: big }).hovered).toBeNull();
  expect(reducer(hovered, { type: 'clear' }).hovered).toBeNull();
  expect(reducer(hovered, { type: 'load', items: [item('C')], missing: [] }).hovered).toBeNull();
});

test('setting the same hover twice returns the identical state, so React can skip the render', () => {
  const hovered = reducer(empty, { type: 'setHover', index: 2 });
  expect(reducer(hovered, { type: 'setHover', index: 2 })).toBe(hovered);
  expect(reducer(hovered, { type: 'setHover', index: null }).hovered).toBeNull();
});
