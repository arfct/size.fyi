import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ComparisonItem, Units, View } from '../shared/types';
import { MAX_ITEMS } from '../shared/types';
import { getStoredUnits } from './localStore';

export interface ComparisonState { items: ComparisonItem[]; view: View; units: Units; missing: string[]; }
export type Action =
  | { type: 'add'; item: ComparisonItem }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'setView'; view: View }
  | { type: 'setUnits'; units: Units }
  | { type: 'load'; items: ComparisonItem[]; missing: string[] }
  | { type: 'dismissMissing' };

export function reducer(state: ComparisonState, action: Action): ComparisonState {
  switch (action.type) {
    case 'add':
      if (state.items.length >= MAX_ITEMS) return state;
      return { ...state, items: [...state.items, action.item] };
    case 'remove':
      return { ...state, items: state.items.filter((_, i) => i !== action.index) };
    case 'clear':
      return { ...state, items: [], missing: [] };
    case 'setView':
      return { ...state, view: action.view };
    case 'setUnits':
      return { ...state, units: action.units };
    case 'load':
      return { ...state, items: action.items.slice(0, MAX_ITEMS), missing: action.missing };
    case 'dismissMissing':
      return { ...state, missing: [] };
  }
}

const Ctx = createContext<{ state: ComparisonState; dispatch: Dispatch<Action> } | null>(null);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    items: [], view: '3d' as View, units: getStoredUnits() ?? 'metric', missing: [],
  }));
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useComparison() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useComparison outside ComparisonProvider');
  return ctx;
}
