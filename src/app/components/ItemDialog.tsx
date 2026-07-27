import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { parseDimensions } from '../../shared/dimensions';
import { MAX_ITEMS } from '../../shared/types';
import { addMyItem } from '../localStore';
import { useComparison } from '../store';

// What the dialog is doing: adding a brand-new custom item (name seeded from the search query) or
// editing an existing item at `index` (name + a pre-formatted dimension string).
export type DialogState =
  | { mode: 'add'; name: string }
  | { mode: 'edit'; index: number; name: string; dims: string };

const DIMS_HELP = 'Use height × width × depth, e.g. 85×64×12mm or 5×3×2in';

export default function ItemDialog({
  state,
  onClose,
}: {
  state: DialogState | null;
  onClose: () => void;
}) {
  const { state: comparison, dispatch } = useComparison();
  const [name, setName] = useState('');
  const [dims, setDims] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dimsRef = useRef<HTMLInputElement>(null);

  // Reseed the fields each time a dialog opens; focus the dimensions field when the name is already
  // provided (the common case — seeded from the search query or an edited item).
  useEffect(() => {
    if (!state) return;
    setName(state.name);
    setDims(state.mode === 'edit' ? state.dims : '');
    setError(null);
    const t = setTimeout(() => (state.name.trim() ? dimsRef : nameRef).current?.focus(), 0);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  if (!state) return null;

  const unit = comparison.units === 'imperial' ? 'in' : 'mm';

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give it a name');
      return;
    }
    // Interpret bare numbers in the current unit; an explicit unit in the text still wins.
    const parsed = parseDimensions(/[a-z]/i.test(dims) ? dims : `${dims}${unit}`);
    if (!parsed) {
      setError(DIMS_HELP);
      return;
    }
    if (state.mode === 'add' && comparison.items.length >= MAX_ITEMS) {
      setError(`Comparison is full (${MAX_ITEMS} items)`);
      return;
    }
    const item = { name: trimmed, ...parsed };
    if (state.mode === 'edit') {
      dispatch({ type: 'update', index: state.index, item: { kind: 'custom', ...item } });
    } else {
      dispatch({ type: 'add', item: { kind: 'custom', ...item } });
    }
    addMyItem(item);
    onClose();
  };

  const searchGoogle = () => {
    const q = encodeURIComponent(`${name.trim() || 'object'} dimensions`);
    window.open(`https://www.google.com/search?q=${q}`, '_blank', 'noopener,noreferrer');
  };

  const onEnter = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* The click-away backdrop is a real button rather than a click handler on a bare div, so it
          carries its own role and label. It precedes the panel, so the panel paints over it. Being
          its own element also means a drag that starts inside the panel and ends out here won't
          close the dialog. Kept out of the tab order — Escape and the Cancel button are the
          keyboard paths, and a focusable backdrop would just be a dead stop between them. */}
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onMouseDown={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === 'edit' ? 'Edit item' : 'Add item'}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-stone-900"
      >
        <label htmlFor="dlg-name" className="block text-[13px] font-medium text-stone-500">
          {state.mode === 'edit' ? 'Edit item' : 'Add an item'}
        </label>
        <input
          id="dlg-name"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          placeholder="Name"
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className="mt-1 w-full border-b border-stone-300 bg-transparent py-2 text-[16px] outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />

        <div className="mt-4 flex items-baseline justify-between gap-2">
          <label htmlFor="dlg-dims" className="text-[13px] font-medium text-stone-500">
            Dimensions <span className="text-stone-400">{unit}</span>
          </label>
          <button
            type="button"
            onClick={searchGoogle}
            className="text-[13px] text-blue-600 hover:underline dark:text-blue-400"
          >
            search Google ↗
          </button>
        </div>
        <input
          id="dlg-dims"
          ref={dimsRef}
          value={dims}
          onChange={(e) => {
            setDims(e.target.value);
            setError(null);
          }}
          onKeyDown={onEnter}
          placeholder={unit === 'in' ? '3.3×2.5×0.5' : '85×64×12'}
          className="mt-1 w-full border-b border-stone-300 bg-transparent py-2 text-[16px] outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />
        {error && (
          <p className="mt-2 text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-stone-900 px-4 py-1.5 text-[13px] font-medium text-white dark:bg-stone-100 dark:text-stone-900"
          >
            {state.mode === 'edit' ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
