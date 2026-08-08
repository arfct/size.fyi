import { createContext, type Dispatch, type ReactNode, useContext, useReducer } from 'react';
import type { ComparisonItem, LayoutMode, Projection, Units, View } from '../shared/types';
import { MAX_ITEMS, nextStateLabel, sortVolume } from '../shared/types';
import { getStoredUnits } from './localStore';

export interface ComparisonState {
  items: ComparisonItem[];
  view: View;
  units: Units;
  missing: string[];
  layoutMode: LayoutMode;
  projection: Projection;
  // Index into `items` of the row the pointer (or keyboard focus) is on, or null. Lives here rather
  // than inside ItemList because the 3D view highlights the same item, and both need one answer.
  hovered: number | null;
}
export type Action =
  | { type: 'add'; item: ComparisonItem }
  | { type: 'update'; index: number; item: ComparisonItem }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'setView'; view: View }
  | { type: 'setUnits'; units: Units }
  | { type: 'setLayout'; mode: LayoutMode }
  | { type: 'setProjection'; projection: Projection }
  | { type: 'setHover'; index: number | null }
  | { type: 'cycleState'; index: number }
  | { type: 'load'; items: ComparisonItem[]; missing: string[] }
  | { type: 'dismissMissing' };

// Items are always kept sorted smallest-to-largest by volume, so a given set of devices produces
// one canonical order (and one canonical URL) regardless of the order they were added — which is
// what keeps recent comparisons free of add-order "inversion" duplicates.
const byVolume = (items: ComparisonItem[]) =>
  [...items].sort((a, b) => sortVolume(a) - sortVolume(b));

export function reducer(state: ComparisonState, action: Action): ComparisonState {
  switch (action.type) {
    // `hovered` is an index into `items`, and items are kept volume-sorted — so every mutation can
    // move an item out from under it. Each one clears it rather than leaving it pointing at whatever
    // slid into that slot, which would highlight the wrong item.
    case 'add':
      if (state.items.length >= MAX_ITEMS) return state;
      return { ...state, items: byVolume([...state.items, action.item]), hovered: null };
    case 'update':
      return {
        ...state,
        items: byVolume(state.items.map((it, i) => (i === action.index ? action.item : it))),
        hovered: null,
      };
    case 'remove':
      return {
        ...state,
        items: state.items.filter((_, i) => i !== action.index),
        hovered: null,
      };
    case 'clear':
      return { ...state, items: [], missing: [], hovered: null };
    case 'setView':
      return { ...state, view: action.view };
    case 'setUnits':
      return { ...state, units: action.units };
    case 'setLayout':
      return { ...state, layoutMode: action.mode };
    case 'setProjection':
      return { ...state, projection: action.projection };
    // Advances a multi-state device to its next state — the double-tap gesture, from either the list or
    // the 3D view. A no-op for anything without states to cycle, so the callers don't each have to test.
    // Re-sorts like any other mutation, since a fold changes the size class.
    case 'cycleState': {
      const item = state.items[action.index];
      if (item?.kind !== 'device') return state;
      const next = nextStateLabel(item.device, item.state);
      if (!next) return state;
      return {
        ...state,
        items: byVolume(
          state.items.map((it, i) => (i === action.index ? { ...item, state: next } : it)),
        ),
        hovered: null,
      };
    }
    case 'setHover':
      return state.hovered === action.index ? state : { ...state, hovered: action.index };
    case 'load':
      return {
        ...state,
        hovered: null,
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
    projection: 'orthographic' as Projection,
    hovered: null,
  }));
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useComparison() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useComparison outside ComparisonProvider');
  return ctx;
}
