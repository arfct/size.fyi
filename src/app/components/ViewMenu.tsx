import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { View } from '../../shared/types';
import { setStoredUnits } from '../localStore';
import { useComparison } from '../store';
import { HOTKEYS, hotkeyLabel } from '../useHotkeys';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: '3d', label: '3D' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'top', label: 'Top' },
];
// Projection and layout are each one of two things, so they're single checkable rows rather than a pair
// of radios: "Perspective" off means orthographic, "Stack" off means side-by-side. One row states the
// setting and its opposite at once, and there's no section heading worth writing above a single item.
const UNITS: Array<{ units: 'metric' | 'imperial'; label: string }> = [
  { units: 'metric', label: 'Metric' },
  { units: 'imperial', label: 'Imperial' },
];

// Single dropdown that owns every display SETTING — view (3D/front/side/top), layout (side-by-side vs
// stack), and units (metric/imperial). Actions live outside it: see ArButton, which sits beside the
// trigger. Used identically on both breakpoints: inline in the mobile top toolbar and floating over the
// canvas (top-right) on desktop. Self-contained dropdown (mousedown-outside + Escape close).
export default function ViewMenu() {
  const { state, dispatch } = useComparison();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = VIEWS.find((v) => v.id === state.view) ?? VIEWS[0]!;

  const itemClass = (active: boolean) =>
    `flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800 ${active ? 'font-semibold' : ''}`;
  // The right-hand side of a row: the shortcut hint, then a fixed-width slot for the check so every
  // check in the menu lines up whether or not its neighbours are ticked. The hint is aria-hidden and
  // the binding is announced with aria-keyshortcuts instead, which keeps each item's accessible name
  // the plain label.
  const trailing = (active: boolean, key?: string) => (
    <span className="flex items-center gap-2">
      {key && (
        <kbd aria-hidden className="font-sans text-[11px] text-stone-400 dark:text-stone-500">
          {hotkeyLabel(key)}
        </kbd>
      )}
      <span className="flex w-3.5 justify-end">
        {active && <Check size={14} aria-hidden className="text-stone-500 dark:text-stone-400" />}
      </span>
    </span>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1 rounded-full border border-transparent bg-white/70 px-3 text-[13px] backdrop-blur hover:border-stone-300 dark:bg-stone-900/70 dark:hover:border-stone-700"
      >
        {current.label} <ChevronDown size={14} aria-hidden className="text-stone-400" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          <p
            role="presentation"
            className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400"
          >
            View
          </p>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={state.view === v.id}
              aria-keyshortcuts={HOTKEYS[v.id]}
              onClick={() => {
                setOpen(false);
                dispatch({ type: 'setView', view: v.id });
              }}
              className={itemClass(state.view === v.id)}
            >
              {v.label}
              {trailing(state.view === v.id, HOTKEYS[v.id])}
            </button>
          ))}

          <hr className="my-1 border-t border-stone-200 dark:border-stone-800" />

          {/* Only 3D projects; the flat views are orthographic by definition, so the choice would be
              inert there. Shown conditionally rather than disabled — a control that can't do anything
              is better absent than greyed out. */}
          {state.view === '3d' && (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={state.projection === 'perspective'}
                aria-keyshortcuts={HOTKEYS.perspective}
                onClick={() => {
                  setOpen(false);
                  dispatch({
                    type: 'setProjection',
                    projection: state.projection === 'perspective' ? 'orthographic' : 'perspective',
                  });
                }}
                className={itemClass(state.projection === 'perspective')}
              >
                Perspective
                {trailing(state.projection === 'perspective', HOTKEYS.perspective)}
              </button>
              <hr className="my-1 border-t border-stone-200 dark:border-stone-800" />
            </>
          )}

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={state.layoutMode === 'stack'}
            aria-keyshortcuts={HOTKEYS.stack}
            onClick={() => {
              setOpen(false);
              dispatch({ type: 'setLayout', mode: state.layoutMode === 'stack' ? 'row' : 'stack' });
            }}
            className={itemClass(state.layoutMode === 'stack')}
          >
            Stack
            {trailing(state.layoutMode === 'stack', HOTKEYS.stack)}
          </button>

          <hr className="my-1 border-t border-stone-200 dark:border-stone-800" />
          <p
            role="presentation"
            className="px-3 pt-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400"
          >
            Units
          </p>
          {UNITS.map((u) => (
            <button
              key={u.units}
              type="button"
              role="menuitemradio"
              aria-checked={state.units === u.units}
              onClick={() => {
                setOpen(false);
                setStoredUnits(u.units);
                dispatch({ type: 'setUnits', units: u.units });
              }}
              className={itemClass(state.units === u.units)}
            >
              {u.label}
              {trailing(state.units === u.units)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
