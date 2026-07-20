import { beforeEach, expect, test, vi } from 'vitest';
import { addMyItem, getMyItems, addRecent, getRecents } from '../localStore';

beforeEach(() => localStorage.clear());

test('myItems round-trip, dedupe by name, newest first', () => {
  addMyItem({ name: 'Box', h: 1, w: 2, d: 3 });
  addMyItem({ name: 'Tin', h: 4, w: 5, d: 6 });
  addMyItem({ name: 'Box', h: 9, w: 9, d: 9 });
  expect(getMyItems().map((i) => i.name)).toEqual(['Box', 'Tin']);
  expect(getMyItems()[0]!.h).toBe(9);
});
test('recents dedupe by path and cap at 20', () => {
  for (let i = 0; i < 25; i++) addRecent(`/p${i}`, `T${i}`);
  addRecent('/p24', 'T24 again');
  const r = getRecents();
  expect(r).toHaveLength(20);
  expect(r[0]!.path).toBe('/p24');
});
test('survives broken storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota'); });
  expect(getMyItems()).toEqual([]);
  vi.restoreAllMocks();
});
