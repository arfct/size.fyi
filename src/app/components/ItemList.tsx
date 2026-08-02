import { Check, Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDims } from '../../shared/dimensions';
import type { ComparisonItem, Device } from '../../shared/types';
import { defaultStateLabel, itemDims } from '../../shared/types';
import { type ARTarget, canLaunchAR, comparisonArUrl, launchAR } from '../ar';
import { deviceIcon, MY_ITEM_ICON } from '../categoryIcon';
import { itemColor } from '../palette';
import { useComparison } from '../store';
import { HOTKEYS, hotkeyLabel } from '../useHotkeys';

const volumeOf = (item: ComparisonItem) => {
  const d = itemDims(item);
  return d.h * d.w * d.d;
};

// A neutral ellipsis menu trigger on the right of each row (the item's swatch color now lives on
// the leading category icon). Self-contained dropdown: a ref-scoped mousedown-outside listener
// and Escape close it; the trigger and menu live inside the ref so clicking them never counts as
// "outside".
//
// The trigger is invisible until the row is hovered or something inside it is focused, and always
// visible on a coarse pointer, where there is no hover to reveal it. Opacity rather than display, so
// the row's layout doesn't shift as it appears — and so the button stays in the tab order, with
// group-focus-within bringing it into view when a keyboard reaches it. It also stays visible while its
// own menu is open, or the menu would be left floating under an invisible trigger.
function ItemMenu({
  name,
  ar,
  states,
  activeState,
  onSelectState,
  onEdit,
  onRemove,
}: {
  name: string;
  ar: ARTarget;
  states?: Device['states'];
  activeState?: string;
  onSelectState: (label: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
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
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 w-6 items-center justify-center rounded-full outline-none transition-opacity hover:bg-stone-200 focus-visible:bg-stone-200 pointer-coarse:opacity-100 dark:hover:bg-stone-700 dark:focus-visible:bg-stone-700 ${open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
      >
        <Ellipsis size={18} className="text-stone-400 dark:text-stone-500" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-32 rounded-md border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {/* Open/closed (etc.) for a multi-state device. It lives here rather than on the row so the
              list stays one line of type per item; picking a state re-dispatches the item with the new
              label, which re-sorts by volume since the size class changes. */}
          {states && states.length > 1 && (
            <>
              {states.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.label === activeState}
                  onClick={() => {
                    setOpen(false);
                    if (s.label !== activeState) onSelectState(s.label);
                  }}
                  className={`flex w-full items-center gap-1.5 py-1.5 pl-2 pr-3 text-left text-[13px] capitalize hover:bg-stone-100 dark:hover:bg-stone-800 ${s.label === activeState ? 'font-semibold' : ''}`}
                >
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {s.label === activeState && (
                      <Check size={14} aria-hidden className="text-stone-500 dark:text-stone-400" />
                    )}
                  </span>
                  {s.label}
                </button>
              ))}
              <hr className="my-1 border-t border-stone-200 dark:border-stone-800" />
            </>
          )}
          {canLaunchAR() && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                launchAR(ar);
              }}
              className="block w-full py-1.5 pl-7 pr-3 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              View in AR
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full py-1.5 pl-7 pr-3 text-left text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            // The same key works on the row itself without opening this menu; the hint is here because
            // this is where someone looks for what they can do to an item.
            aria-keyshortcuts={HOTKEYS.remove}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
            className="flex w-full items-center justify-between gap-4 py-1.5 pl-7 pr-3 text-left text-[13px] text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Remove
            <kbd aria-hidden className="font-sans text-[11px] text-stone-400 dark:text-stone-500">
              {hotkeyLabel(HOTKEYS.remove)}
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ItemList({
  onEdit,
}: {
  onEdit: (index: number, name: string, dims: string) => void;
}) {
  const { state, dispatch } = useComparison();
  if (state.items.length === 0) return null;
  // Display smallest-to-largest by volume; keep each item's original index for its (stable) color
  // and for the remove dispatch, which indexes into the unsorted state.
  const ordered = state.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => volumeOf(a.item) - volumeOf(b.item));
  return (
    <ul aria-label="Items">
      {ordered.map(({ item, i }) => {
        const name = item.kind === 'device' ? item.device.name : item.name;
        const dims = itemDims(item);
        const url = item.kind === 'device' ? item.device.url : undefined;
        const states = item.kind === 'device' ? item.device.states : undefined;
        const activeState =
          item.kind === 'device' ? (item.state ?? defaultStateLabel(item.device)) : undefined;
        // One item is just a one-item comparison, so the Worker route serves it the same way it serves
        // the whole set — including foldable states and custom items, which have no file anywhere. This
        // used to point at a pre-built /models file, which only two of the catalog's devices have; the
        // other 97, and everything a user typed in themselves, had no AR at all.
        const ar: ARTarget = {
          usdzUrl: comparisonArUrl([item], 'row', 'usdz'),
          glbUrl: comparisonArUrl([item], 'row', 'glb'),
          title: name,
        };
        const Icon = item.kind === 'device' ? deviceIcon(item.device) : MY_ITEM_ICON;
        const color = itemColor(item, i);
        return (
          <li
            key={`${name}-${i}`}
            // Hover is React state rather than a CSS :hover, because the same signal drives the 3D
            // highlight and the tint is per-item so it can't be a static class. Focus counts too, so a
            // keyboard walking the rows lights up the same item a pointer would.
            onMouseEnter={() => dispatch({ type: 'setHover', index: i })}
            onMouseLeave={() => dispatch({ type: 'setHover', index: null })}
            onFocus={() => dispatch({ type: 'setHover', index: i })}
            onBlur={() => dispatch({ type: 'setHover', index: null })}
            // Double-click cycles a foldable's state — the same gesture works on the item in the 3D
            // view. A no-op for anything with nothing to cycle, which the reducer decides. Harmless on
            // the name link and the menu, where a double-click is already doing something else.
            onDoubleClick={() => dispatch({ type: 'cycleState', index: i })}
            // The row tints with the item's own colour at low alpha, so the highlight names which item
            // it belongs to instead of being a generic grey. `20` is the alpha byte — ~12%, enough to
            // read as a wash without fighting the text on either theme.
            style={{ backgroundColor: state.hovered === i ? `${color}20` : undefined }}
            className="group flex items-center gap-2.5 rounded-md px-4 py-2 transition-colors"
          >
            <Icon size={18} style={{ color }} className="shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-[16px] font-medium hover:underline"
                  >
                    {name}
                  </a>
                ) : (
                  <p className="min-w-0 truncate text-[16px] font-medium">{name}</p>
                )}
                <ItemMenu
                  name={name}
                  ar={ar}
                  states={states}
                  activeState={activeState}
                  onSelectState={(label) => {
                    // Only devices have states, and only devices pass any in — the narrow is for the
                    // type checker, which can't see that from here.
                    if (item.kind === 'device')
                      dispatch({ type: 'update', index: i, item: { ...item, state: label } });
                  }}
                  onEdit={() => onEdit(i, name, `${dims.h}×${dims.w}×${dims.d}`)}
                  onRemove={() => dispatch({ type: 'remove', index: i })}
                />
              </div>
              <p className="text-[13px] text-stone-500">{formatDims(dims, state.units)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
