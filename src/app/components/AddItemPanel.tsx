import { useMemo, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { searchDevices } from '../../shared/search';
import { parseDimensions } from '../../shared/dimensions';
import type { Device } from '../../shared/types';
import { MAX_ITEMS } from '../../shared/types';
import { useCatalog } from '../useCatalog';
import { useComparison } from '../store';
import { addMyItem, getMyItems } from '../localStore';

type MyItem = ReturnType<typeof getMyItems>[number];
type ComboItem = { kind: 'device'; device: Device } | { kind: 'mine'; item: MyItem };

const itemLabel = (ci: ComboItem): string => (ci.kind === 'device' ? ci.device.name : ci.item.name);
const itemKey = (ci: ComboItem): string =>
  ci.kind === 'device' ? `device-${ci.device.slug}` : `mine-${ci.item.name}`;

export default function AddItemPanel() {
  const { devices, status, retry } = useCatalog();
  const { state, dispatch } = useComparison();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [dims, setDims] = useState('');
  const [dimsError, setDimsError] = useState<string | null>(null);
  const full = state.items.length >= MAX_ITEMS;

  const trimmedQuery = query.trim();
  const results = useMemo(() => searchDevices(devices, query), [devices, query]);
  const myMatches = useMemo(() => {
    if (!trimmedQuery) return [];
    const q = trimmedQuery.toLowerCase();
    return getMyItems()
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 3);
  }, [trimmedQuery]);

  const comboItems: ComboItem[] = useMemo(
    () => [
      ...myMatches.map((item): ComboItem => ({ kind: 'mine', item })),
      ...results.map((device): ComboItem => ({ kind: 'device', device })),
    ],
    [myMatches, results],
  );

  const addCustom = () => {
    const parsed = parseDimensions(dims);
    if (!parsed) {
      setDimsError('Use height x width x depth, e.g. 85x64x12mm or 5x3x2in');
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

  return (
    <section className="space-y-4" aria-label="Add items">
      <div>
        <label className="mb-1 block text-sm font-medium">Search devices</label>
        {status === 'error' ? (
          <button onClick={retry} className="text-sm text-red-600 underline">
            Catalog failed to load — retry
          </button>
        ) : (
          <Combobox.Root
            items={comboItems}
            filter={null}
            inputValue={query}
            onInputValueChange={(value) => setQuery(value)}
            itemToStringLabel={itemLabel}
            disabled={full}
            onValueChange={(ci) => {
              if (!ci) return;
              if (ci.kind === 'device') {
                dispatch({ type: 'add', item: { kind: 'device', device: ci.device } });
              } else {
                dispatch({ type: 'add', item: { kind: 'custom', ...ci.item } });
              }
              // Root's single-selection mode fills the (controlled) input with the
              // selected item's label right after this callback returns, so a
              // synchronous setQuery('') here would just be overwritten. Deferring
              // to a microtask lets our reset run after that internal fill-in.
              queueMicrotask(() => setQuery(''));
            }}
          >
            <Combobox.Input
              placeholder={status === 'loading' ? 'Loading catalog…' : 'iPhone 16, A4 paper…'}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
            <Combobox.Portal>
              <Combobox.Positioner sideOffset={4} className="outline-none">
                <Combobox.Popup className="max-h-72 w-[var(--anchor-width)] overflow-auto rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
                  <Combobox.Empty className="px-3 py-2 text-sm text-stone-500">
                    No matches.
                  </Combobox.Empty>
                  <Combobox.List>
                    {(ci: ComboItem) => (
                      <Combobox.Item
                        key={itemKey(ci)}
                        value={ci}
                        className="cursor-pointer px-3 py-2 text-sm data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800"
                      >
                        {ci.kind === 'mine' ? (
                          <>
                            {ci.item.name} <span className="text-stone-400">(my item)</span>
                          </>
                        ) : (
                          <>
                            {ci.device.name}
                            {ci.device.brand ? <span className="text-stone-400"> — {ci.device.brand}</span> : null}
                          </>
                        )}
                      </Combobox.Item>
                    )}
                  </Combobox.List>
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-800">
        <p className="text-sm font-medium">Or add your own</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          disabled={full}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
        <input
          value={dims}
          onChange={(e) => {
            setDims(e.target.value);
            setDimsError(null);
          }}
          placeholder="85x64x12mm or 5x3x2in"
          disabled={full}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
        {dimsError && (
          <p className="text-sm text-red-600" role="alert">
            {dimsError}
          </p>
        )}
        <button
          onClick={addCustom}
          disabled={full}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
        >
          Add item
        </button>
        {full && <p className="text-xs text-stone-500">Comparison is full ({MAX_ITEMS} items)</p>}
      </div>
    </section>
  );
}
