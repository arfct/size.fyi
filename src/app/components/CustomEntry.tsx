import { useState, type KeyboardEvent } from 'react';
import { parseDimensions } from '../../shared/dimensions';
import { MAX_ITEMS } from '../../shared/types';
import { useComparison } from '../store';
import { addMyItem } from '../localStore';

export default function CustomEntry() {
  const { state, dispatch } = useComparison();
  const [name, setName] = useState('');
  const [dims, setDims] = useState('');
  const [dimsError, setDimsError] = useState<string | null>(null);
  const full = state.items.length >= MAX_ITEMS;

  const addCustom = () => {
    const parsed = parseDimensions(dims);
    if (!parsed) {
      setDimsError('Use height × width × depth, e.g. 85×64×12mm or 5×3×2in');
      return;
    }
    if (!name.trim()) {
      setDimsError('Give it a name');
      return;
    }
    const item = { name: name.trim(), ...parsed };
    dispatch({ type: 'add', item: { kind: 'custom', ...item } });
    addMyItem(item);
    setName('');
    setDims('');
    setDimsError(null);
  };

  const onCustomKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') addCustom();
  };

  return (
    <section className="space-y-2" aria-label="Add your own">
      <p className="text-sm font-medium">Or add your own</p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onCustomKeyDown}
          placeholder="Name"
          disabled={full}
          className="min-w-0 flex-[2] border-b border-stone-300 bg-transparent px-1 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />
        <input
          value={dims}
          onChange={(e) => {
            setDims(e.target.value);
            setDimsError(null);
          }}
          onKeyDown={onCustomKeyDown}
          placeholder="85×64×12 or 5×3×2in"
          disabled={full}
          className="min-w-0 flex-1 border-b border-stone-300 bg-transparent px-1 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
        />
      </div>
      {dimsError && (
        <p className="text-sm text-red-600" role="alert">
          {dimsError}
        </p>
      )}
      {full && <p className="text-xs text-stone-500">Comparison is full ({MAX_ITEMS} items)</p>}
    </section>
  );
}
