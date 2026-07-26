import { createContext, type Dispatch, type ReactNode, useContext, useReducer } from 'react';
import type { ComparisonItem, LayoutMode, Units, View } from '../shared/types';
import { itemDims, MAX_ITEMS } from '../shared/types';
import { getStoredUnits } from './localStore';

export interface ComparisonState {
  items: ComparisonItem[];
  view: View;
  units: Units;
  missing: string[];
  layoutMode: LayoutMode;
}
export type Action =
  | { type: 'add'; item: ComparisonItem }
  | { type: 'update'; index: number; item: ComparisonItem }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'setView'; view: View }
  | { type: 'setUnits'; units: Units }
  | { type: 'setLayout'; mode: LayoutMode }
  | { type: 'load'; items: ComparisonItem[]; missing: string[] }
  | { type: 'dismissMissing' };

// Items are always kept sorted smallest-to-largest by volume, so a given set of devices produces
// one canonical order (and one canonical URL) regardless of the order they were added — which is
// what keeps recent comparisons free of add-order "inversion" duplicates.
const volumeOf = (item: ComparisonItem) => {
  const d = itemDims(item);
  return d.h * d.w * d.d;
};
const byVolume = (items: ComparisonItem[]) => [...items].sort((a, b) => volumeOf(a) - volumeOf(b));

export function reducer(state: ComparisonState, action: Action): ComparisonState {
  switch (action.type) {
    case 'add':
      if (state.items.length >= MAX_ITEMS) return state;
      return { ...state, items: byVolume([...state.items, action.item]) };
    case 'update':
      return {
        ...state,
        items: byVolume(state.items.map((it, i) => (i === action.index ? action.item : it))),
      };
    case 'remove':
      return { ...state, items: state.items.filter((_, i) => i !== action.index) };
    case 'clear':
      return { ...state, items: [], missing: [] };
    case 'setView':
      return { ...state, view: action.view };
    case 'setUnits':
      return { ...state, units: action.units };
    case 'setLayout':
      return { ...state, layoutMode: action.mode };
    case 'load':
      return {
        ...state,
        items: byVolume(action.items.slice(0, MAX_ITEMS)),
        missing: action.missing,
      };
    case 'dismissMissing':
      return { ...state, missing: [] };
  }
}

const Ctx = createContext<{ state: ComparisonState; dispatch: Dispatch<Action> } | null>(null);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    items: [],
    view: '3d' as View,
    units: getStoredUnits() ?? 'metric',
    missing: [],
    layoutMode: 'row' as LayoutMode,
  }));
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useComparison() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useComparison outside ComparisonProvider');
  return ctx;
}
