import type { Units } from '../shared/types';

const read = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
};
const write = (key: string, value: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
};

type MyItem = { name: string; h: number; w: number; d: number };
type Recent = { path: string; title: string; ts: number };

export const getMyItems = (): MyItem[] => read<MyItem[]>('myItems', []);
export function addMyItem(item: MyItem): void {
  const rest = getMyItems().filter((i) => i.name !== item.name);
  write('myItems', [item, ...rest].slice(0, 50));
}
export const getRecents = (): Recent[] => read<Recent[]>('recentComparisons', []);
export function addRecent(path: string, title: string): void {
  const rest = getRecents().filter((r) => r.path !== path);
  write('recentComparisons', [{ path, title, ts: Date.now() }, ...rest].slice(0, 20));
}
export const getStoredUnits = (): Units | null => read<Units | null>('units', null);
export const setStoredUnits = (u: Units): void => write('units', u);
