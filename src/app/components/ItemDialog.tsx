import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

export default function ItemDialog({ state, onClose }: { state: DialogState | null; onClose: () => void }) {
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, onClose]);

  if (!state) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give it a name'); return; }
    const parsed = parseDimensions(dims);
    if (!parsed) { setError(DIMS_HELP); return; }
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

  const onEnter = (e: ReactKeyboardEvent) => { if (e.key === 'Enter') submit(); };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === 'edit' ? 'Edit item' : 'Add item'}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-stone-900"
      >
        <h2 className="text-[16px] font-semibold">{state.mode === 'edit' ? 'Edit item' : 'Add item'}</h2>

        <label htmlFor="dlg-name" className="mt-4 block text-[13px] font-medium text-stone-500">Name</label>
        <input
          id="dlg-name"
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          placeholder="Name"
          className="mt-1 w-full border-b border-stone-300 bg-transparent py-2 text-[16px] outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />
        <button type="button" onClick={searchGoogle} className="mt-2 text-[13px] text-blue-600 hover:underline dark:text-blue-400">
          Search Google for dimensions ↗
        </button>

        <label htmlFor="dlg-dims" className="mt-4 block text-[13px] font-medium text-stone-500">Dimensions (height × width × depth)</label>
        <input
          id="dlg-dims"
          ref={dimsRef}
          value={dims}
          onChange={(e) => { setDims(e.target.value); setError(null); }}
          onKeyDown={onEnter}
          placeholder="85×64×12 or 5×3×2in"
          className="mt-1 w-full border-b border-stone-300 bg-transparent py-2 text-[16px] outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />
        {error && <p className="mt-2 text-[13px] text-red-600" role="alert">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] hover:bg-stone-100 dark:hover:bg-stone-800">
            Cancel
          </button>
          <button type="button" onClick={submit} className="rounded-md bg-stone-900 px-4 py-1.5 text-[13px] font-medium text-white dark:bg-stone-100 dark:text-stone-900">
            {state.mode === 'edit' ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
