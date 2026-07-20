import { useEffect, useRef, useState } from 'react';
import type { View } from '../../shared/types';
import { useComparison } from '../store';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: '3d', label: '3D' }, { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' }, { id: 'top', label: 'Top' },
];

// Compact dropdown replacement for the segmented view control — used in the mobile top toolbar
// where horizontal space is tight. Self-contained dropdown (mousedown-outside + Escape close).
export default function ViewMenu() {
  const { state, dispatch } = useComparison();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = VIEWS.find((v) => v.id === state.view) ?? VIEWS[0]!;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`View: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1 rounded-full border border-stone-300 px-3 text-[13px] dark:border-stone-700"
      >
        {current.label} <span aria-hidden className="text-[10px] text-stone-400">▼</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-28 rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={state.view === v.id}
              onClick={() => { setOpen(false); dispatch({ type: 'setView', view: v.id }); }}
              className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800 ${state.view === v.id ? 'font-semibold' : ''}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
