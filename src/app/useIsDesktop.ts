import { useEffect, useState } from 'react';

// Mirrors Tailwind's `md` breakpoint — the point at which the layout switches from a stacked
// mobile column to the aside+canvas row.
const QUERY = '(min-width: 768px)';

// jsdom (used in tests) doesn't implement matchMedia; fall back to a static list that never
// matches rather than throwing, so components using this hook don't need to know about tests.
function getMediaQueryList(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;
}

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => getMediaQueryList()?.matches ?? false);

  useEffect(() => {
    const mql = getMediaQueryList();
    if (!mql) return;
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
