import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchDevices, suggestDevices } from '../../shared/search';
import type { Device } from '../../shared/types';
import { MAX_ITEMS } from '../../shared/types';
import { CATEGORY_ICON, MY_ITEM_ICON } from '../categoryIcon';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const didFocus = useRef(false);
  const [query, setQuery] = useState('');

  // Focus the search box on desktop load (skipped on mobile to avoid popping the keyboard).
  useEffect(() => {
    if (isDesktop && !didFocus.current && inputRef.current) {
      inputRef.current.focus();
      didFocus.current = true;
    }
  }, [isDesktop]);
  const full = state.items.length >= MAX_ITEMS;
  const trimmed = query.trim();

  // On mobile the search box sits below the 3D view; bring it (and its results) to the top of the
  // viewport when the user starts searching, so the results aren't hidden under the fold/keyboard.
  const revealOnMobile = () => {
    if (!isDesktop) sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // The on-screen keyboard appearing shrinks the visual viewport after focus fires, so re-scroll
  // the search to the top of the now-smaller view whenever it resizes while the box is focused.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (isDesktop || !vv) return;
    const onResize = () => {
      if (document.activeElement === inputRef.current) {
        sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [isDesktop]);

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
      {status === 'error' ? (
        <button onClick={retry} className="px-4 text-[13px] text-red-600 underline">
          Catalog failed to load — retry
        </button>
      ) : (
        <>
          <input
            ref={inputRef}
            id="device-search"
            type="text"
            role="combobox"
            aria-label="Search devices"
            aria-expanded={rows.length > 0}
            aria-controls="device-results"
            value={query}
            disabled={full}
            onChange={(e) => { setQuery(e.target.value); revealOnMobile(); }}
            onFocus={(e) => { e.currentTarget.select(); revealOnMobile(); }}
            placeholder={status === 'loading' ? 'Loading catalog…' : 'Search'}
            className="w-full rounded-full border border-stone-300 bg-transparent px-4 py-2 text-[16px] outline-none focus:border-stone-500 disabled:opacity-40 dark:border-stone-700 dark:focus:border-stone-400"
          />
          {rows.length === 0 && (
            <p className="px-4 py-1.5 text-[13px] text-stone-500">{trimmed ? 'No matches.' : 'No suggestions.'}</p>
          )}
          <ul id="device-results" role="listbox" aria-label="Results" className="space-y-0.5">
            {rows.map((row) => {
              const { Icon, color } = row.kind === 'device' ? CATEGORY_ICON[row.device.category] : MY_ITEM_ICON;
              return (
                <li key={row.kind === 'device' ? `d-${row.device.slug}` : `m-${row.item.name}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={full}
                    onClick={() => addRow(row)}
                    className="flex w-full items-center gap-2.5 rounded-md px-4 py-1.5 text-left text-[16px] hover:bg-stone-200/60 disabled:opacity-40 dark:hover:bg-stone-800/60"
                  >
                    <Icon size={18} style={{ color }} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
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
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                disabled={full}
                onClick={() => onAddCustom(trimmed)}
                className="flex w-full items-center gap-2.5 rounded-md px-4 py-1.5 text-left text-[16px] hover:bg-stone-200/60 disabled:opacity-40 dark:hover:bg-stone-800/60"
              >
                <Plus size={18} aria-hidden className="shrink-0 text-stone-400" />
                <span className="min-w-0 flex-1 truncate">{trimmed ? `Add “${trimmed}”…` : 'Add a custom item…'}</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
