import type { Units } from '../shared/types';

const read = <T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return valid && !valid(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
};

type MyItem = { name: string; h: number; w: number; d: number };
type Recent = { path: string; title: string; ts: number };

export const getMyItems = (): MyItem[] => read<MyItem[]>('myItems', [], Array.isArray);
export function addMyItem(item: MyItem): void {
  const rest = getMyItems().filter((i) => i.name !== item.name);
  write('myItems', [item, ...rest].slice(0, 50));
}
export const getRecents = (): Recent[] => read<Recent[]>('recentComparisons', [], Array.isArray);
export function addRecent(path: string, title: string): void {
  const rest = getRecents().filter((r) => r.path !== path);
  write('recentComparisons', [{ path, title, ts: Date.now() }, ...rest].slice(0, 20));
}
export const getStoredUnits = (): Units | null => read<Units | null>('units', null, (v) => v === 'metric' || v === 'imperial');
export const setStoredUnits = (u: Units): void => write('units', u);
