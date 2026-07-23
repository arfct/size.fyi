import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComparisonItem, Device } from '../../shared/types';
import { defaultStateLabel, itemDims } from '../../shared/types';
import { formatDims } from '../../shared/dimensions';
import { type ARTarget, canLaunchAR, launchAR } from '../ar';
import { MY_ITEM_ICON, deviceIcon } from '../categoryIcon';
import { itemColor } from '../palette';
import { useComparison } from '../store';

const volumeOf = (item: ComparisonItem) => {
  const d = itemDims(item);
  return d.h * d.w * d.d;
};

// Segmented open/closed (etc.) switch for multi-state devices; selecting a state re-dispatches the
// item with the new label (which re-sorts by volume since the size class changes).
function StateToggle({ device, active, onSelect }: { device: Device; active: string; onSelect: (label: string) => void }) {
  return (
    <div role="group" aria-label="State" className="mt-1 inline-flex rounded-md border border-stone-300 p-0.5 dark:border-stone-700">
      {device.states!.map((s) => {
        const on = s.label === active;
        return (
          <button
            key={s.label}
            type="button"
            aria-pressed={on}
            onClick={() => { if (!on) onSelect(s.label); }}
            className={`rounded px-2 py-0.5 text-[12px] capitalize ${on ? 'bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// A neutral ellipsis menu trigger on the right of each row (the item's swatch color now lives on
// the leading category icon). Self-contained dropdown: a ref-scoped mousedown-outside listener
// and Escape close it; the trigger and menu live inside the ref so clicking them never counts as
// "outside".
function ItemMenu({ name, ar, onEdit, onRemove }: { name: string; ar?: ARTarget; onEdit: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-6 items-center justify-center rounded-full outline-none hover:bg-stone-200 focus-visible:bg-stone-200 dark:hover:bg-stone-700 dark:focus-visible:bg-stone-700"
      >
        <Ellipsis size={18} className="text-stone-400 dark:text-stone-500" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-32 rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {ar && canLaunchAR() && (
            <button
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); launchAR(ar); }}
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              View in AR
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onEdit(); }}
            className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onRemove(); }}
            className="block w-full px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

export default function ItemList({ onEdit }: { onEdit: (index: number, name: string, dims: string) => void }) {
  const { state, dispatch } = useComparison();
  if (state.items.length === 0) return null;
  // Display smallest-to-largest by volume; keep each item's original index for its (stable) color
  // and for the remove dispatch, which indexes into the unsorted state.
  const ordered = state.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => volumeOf(a.item) - volumeOf(b.item));
  return (
    <ul className="space-y-2" aria-label="Items">
      {ordered.map(({ item, i }) => {
        const name = item.kind === 'device' ? item.device.name : item.name;
        const dims = itemDims(item);
        const url = item.kind === 'device' ? item.device.url : undefined;
        const states = item.kind === 'device' ? item.device.states : undefined;
        const activeState = item.kind === 'device' ? (item.state ?? defaultStateLabel(item.device)) : undefined;
        const ar: ARTarget | undefined = item.kind === 'device' && item.device.model3d
          ? { usdzUrl: `/models/${item.device.slug}.usdz`, glbUrl: `/models/${item.device.model3d.url}`, title: name }
          : undefined;
        const Icon = item.kind === 'device' ? deviceIcon(item.device) : MY_ITEM_ICON;
        return (
          <li key={`${name}-${i}`} className="flex items-center gap-2.5 rounded-md px-4 py-2 hover:bg-stone-200/60 dark:hover:bg-stone-800/60">
            <Icon size={18} style={{ color: itemColor(item, i) }} className="shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    className="min-w-0 truncate text-[16px] font-medium hover:underline">{name}</a>
                ) : (
                  <p className="min-w-0 truncate text-[16px] font-medium">{name}</p>
                )}
                <ItemMenu
                  name={name}
                  ar={ar}
                  onEdit={() => onEdit(i, name, `${dims.h}×${dims.w}×${dims.d}`)}
                  onRemove={() => dispatch({ type: 'remove', index: i })}
                />
              </div>
              <p className="text-[13px] text-stone-500">{formatDims(dims, state.units)}</p>
              {states && states.length > 1 && item.kind === 'device' && (
                <StateToggle
                  device={item.device}
                  active={activeState!}
                  onSelect={(label) => dispatch({ type: 'update', index: i, item: { ...item, state: label } })}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
