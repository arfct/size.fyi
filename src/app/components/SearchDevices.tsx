import { useMemo, useRef, useState } from 'react';
import { searchDevices, suggestDevices } from '../../shared/search';
import type { Device } from '../../shared/types';
import { MAX_ITEMS } from '../../shared/types';
import { useCatalog } from '../useCatalog';
import { useComparison } from '../store';
import { useIsDesktop } from '../useIsDesktop';
import { getMyItems } from '../localStore';

type MyItem = ReturnType<typeof getMyItems>[number];
type ResultRow = { kind: 'device'; device: Device } | { kind: 'mine'; item: MyItem };

// How many ranked suggestions to show when the query is empty.
const SUGGESTION_COUNT = 4;

export default function SearchDevices({ onAddCustom }: { onAddCustom: (name: string) => void }) {
  const { devices, status, retry } = useCatalog();
  const { state, dispatch } = useComparison();
  const isDesktop = useIsDesktop();
  const sectionRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const full = state.items.length >= MAX_ITEMS;
  const trimmed = query.trim();

  // On mobile the search box sits below the 3D view; bring it (and its results) to the top of the
  // viewport when the user starts searching, so the results aren't hidden under the fold/keyboard.
  const revealOnMobile = () => {
    if (!isDesktop) sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Categories (size class / type) and slugs already in the comparison — the former narrows
  // empty-query suggestions to peers, the latter drops anything already added.
  const activeCategories = useMemo(
    () => new Set(state.items.flatMap((it) => (it.kind === 'device' ? [it.device.category] : []))),
    [state.items],
  );
  const addedSlugs = useMemo(
    () => new Set(state.items.flatMap((it) => (it.kind === 'device' ? [it.device.slug] : []))),
    [state.items],
  );

  const results = useMemo(() => searchDevices(devices, query), [devices, query]);
  const myMatches = useMemo(() => {
    if (!trimmed) return [];
    const q = trimmed.toLowerCase();
    return getMyItems().filter((i) => i.name.toLowerCase().includes(q)).slice(0, 3);
  }, [trimmed]);
  const suggestions = useMemo(
    () => suggestDevices(devices, activeCategories, addedSlugs, SUGGESTION_COUNT),
    [devices, activeCategories, addedSlugs],
  );

  // Query drives full search (catalog first, then any matching custom items appended at the end);
  // empty query shows ranked suggestions.
  const rows: ResultRow[] = useMemo(() => {
    if (!trimmed) return suggestions.map((device): ResultRow => ({ kind: 'device', device }));
    return [
      ...results.map((device): ResultRow => ({ kind: 'device', device })),
      ...myMatches.map((item): ResultRow => ({ kind: 'mine', item })),
    ];
  }, [trimmed, suggestions, myMatches, results]);

  const addRow = (row: ResultRow) => {
    if (full) return;
    if (row.kind === 'device') dispatch({ type: 'add', item: { kind: 'device', device: row.device } });
    else dispatch({ type: 'add', item: { kind: 'custom', ...row.item } });
    setQuery('');
  };

  return (
    <section ref={sectionRef} aria-label="Search devices" className="space-y-2">
      <label htmlFor="device-search" className="block text-[16px] font-medium">Search devices</label>
      {status === 'error' ? (
        <button onClick={retry} className="text-[13px] text-red-600 underline">
          Catalog failed to load — retry
        </button>
      ) : (
        <>
          <input
            id="device-search"
            type="text"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="device-results"
            value={query}
            disabled={full}
            onChange={(e) => { setQuery(e.target.value); revealOnMobile(); }}
            onFocus={(e) => { e.currentTarget.select(); revealOnMobile(); }}
            placeholder={status === 'loading' ? 'Loading catalog…' : 'iPhone 16, A4 paper…'}
            className="w-full border-b border-stone-300 bg-transparent py-2 text-[16px] outline-none focus:border-stone-500 disabled:opacity-40 dark:border-stone-700 dark:focus:border-stone-400"
          />
          {rows.length === 0 ? (
            <p className="py-1.5 text-[13px] text-stone-500">{trimmed ? 'No matches.' : 'No suggestions.'}</p>
          ) : (
            <ul id="device-results" role="listbox" aria-label="Results" className="space-y-0.5">
              {rows.map((row) => (
                <li key={row.kind === 'device' ? `d-${row.device.slug}` : `m-${row.item.name}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={full}
                    onClick={() => addRow(row)}
                    className="block w-full truncate rounded-md py-1.5 text-left text-[16px] hover:bg-stone-200/60 disabled:opacity-40 dark:hover:bg-stone-800/60"
                  >
                    {row.kind === 'mine' ? (
                      <>
                        {row.item.name} <span className="text-[13px] text-stone-400">(my item)</span>
                      </>
                    ) : (
                      <>
                        {row.device.name}
                        {row.device.make ? <span className="text-[13px] text-stone-400"> — {row.device.make}</span> : null}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={full}
            onClick={() => onAddCustom(trimmed)}
            className="mt-1 block w-full truncate rounded-md py-1.5 text-left text-[16px] text-blue-600 hover:bg-stone-200/60 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-stone-800/60"
          >
            {trimmed ? `Add “${trimmed}”…` : 'Add a custom item…'}
          </button>
        </>
      )}
    </section>
  );
}
