import { useMemo, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { searchDevices } from '../../shared/search';
import type { Device } from '../../shared/types';
import { MAX_ITEMS } from '../../shared/types';
import { useCatalog } from '../useCatalog';
import { useComparison } from '../store';
import { getMyItems } from '../localStore';

type MyItem = ReturnType<typeof getMyItems>[number];
type ComboItem = { kind: 'device'; device: Device } | { kind: 'mine'; item: MyItem };

const itemLabel = (ci: ComboItem): string => (ci.kind === 'device' ? ci.device.name : ci.item.name);
const itemKey = (ci: ComboItem): string =>
  ci.kind === 'device' ? `device-${ci.device.slug}` : `mine-${ci.item.name}`;

// Curated slugs shown as defaults when the popup opens with an empty query,
// in priority order. Filtered to whatever's actually in the loaded catalog
// and capped at 8.
const DEFAULT_SLUGS = [
  'iphone-16-pro', 'galaxy-s24-ultra', 'ipad-pro-11-m4', 'macbook-air-13-m3',
  'ps5', 'nintendo-switch-2', 'drinks-can', 'banana', 'paper-a4', 'credit-card',
];
const MAX_DEFAULTS = 8;

export default function SearchDevices() {
  const { devices, status, retry } = useCatalog();
  const { state, dispatch } = useComparison();
  const [query, setQuery] = useState('');
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

  const defaultDevices = useMemo(() => {
    const bySlug = new Map(devices.map((d) => [d.slug, d]));
    const found: Device[] = [];
    for (const slug of DEFAULT_SLUGS) {
      const d = bySlug.get(slug);
      if (d) found.push(d);
      if (found.length >= MAX_DEFAULTS) break;
    }
    return found;
  }, [devices]);

  const comboItems: ComboItem[] = useMemo(() => {
    if (!trimmedQuery) {
      return defaultDevices.map((device): ComboItem => ({ kind: 'device', device }));
    }
    return [
      ...myMatches.map((item): ComboItem => ({ kind: 'mine', item })),
      ...results.map((device): ComboItem => ({ kind: 'device', device })),
    ];
  }, [trimmedQuery, defaultDevices, myMatches, results]);

  return (
    <section aria-label="Search devices">
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
            className="w-full border-b border-stone-300 bg-transparent px-1 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:focus:border-stone-400"
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
    </section>
  );
}
