import { useEffect, useRef } from 'react';
import { decodeComparison, encodeComparison, comparisonTitle } from '../shared/urlCodec';
import { addRecent } from './localStore';
import { useComparison } from './store';
import { useCatalog } from './useCatalog';

/**
 * True when every `-vs-` token in the path is a custom item (contains `~`),
 * meaning decoding needs no catalog lookups and can happen immediately
 * instead of waiting for `status === 'ready'`.
 */
export function isCustomOnlyPath(path: string): boolean {
  const raw = path.replace(/^\/+|\/+$/g, '');
  return raw.split('-vs-').every((token) => token.includes('~'));
}

export function useUrlSync() {
  const { state, dispatch } = useComparison();
  const { bySlug, status } = useCatalog();
  const hydrated = useRef(false);

  // hydrate from URL once catalog is ready (custom-only URLs don't need it)
  useEffect(() => {
    if (hydrated.current) return;
    const path = location.pathname;
    if (path === '/') { hydrated.current = true; return; }
    if (status !== 'ready' && !isCustomOnlyPath(path)) return;
    const { items, missing } = decodeComparison(path, bySlug);
    dispatch({ type: 'load', items, missing });
    hydrated.current = true;
  }, [status, bySlug, dispatch]);

  // reflect state → URL + document.title + recents
  useEffect(() => {
    if (!hydrated.current) return;
    const path = encodeComparison(state.items);
    if (path !== location.pathname) history.replaceState(null, '', path);
    const title = comparisonTitle(state.items);
    document.title = title ? `${title} — size.fyi` : 'size.fyi — compare the size of anything';
    if (state.items.length >= 2) addRecent(path, title);
  }, [state.items]);

  // back/forward
  useEffect(() => {
    const onPop = () => {
      const { items, missing } = decodeComparison(location.pathname, bySlug);
      dispatch({ type: 'load', items, missing });
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [bySlug, dispatch]);
}
