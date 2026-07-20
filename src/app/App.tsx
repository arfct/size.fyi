import { useRef, useState } from 'react';
import ItemDialog, { type DialogState } from './components/ItemDialog';
import ItemList from './components/ItemList';
import LayoutToggle from './components/LayoutToggle';
import RecentComparisons from './components/RecentComparisons';
import SearchDevices from './components/SearchDevices';
import ShareButton from './components/ShareButton';
import ViewTabs from './components/ViewTabs';
import Viewer from './components/Viewer';
import { setStoredUnits } from './localStore';
import { ComparisonProvider, useComparison } from './store';
import { useIsDesktop } from './useIsDesktop';
import { useUrlSync } from './useUrlSync';

function Shell() {
  useUrlSync();
  const { state, dispatch } = useComparison();
  const asideRef = useRef<HTMLDivElement>(null);
  const isDesktop = useIsDesktop();
  const showViewer = state.items.length > 0;
  const [dialog, setDialog] = useState<DialogState | null>(null);

  return (
    <div className="relative flex min-h-screen flex-col bg-white text-stone-900 dark:bg-stone-900 dark:text-stone-100 md:flex-row">
      {/* Full-bleed canvas (md+): spans the whole row, behind the floating aside. Mounted only
          on desktop so the scene isn't created twice — the mobile viewer below is the other
          (mutually exclusive) mount point. Always mounted (even when empty) so it can show the
          placeholder cubes. */}
      {isDesktop && (
        <div className="absolute inset-0 hidden md:block">
          <Viewer asideRef={asideRef} />
        </div>
      )}
      <div
        ref={asideRef}
        className="relative z-10 order-2 w-full space-y-4 p-4 md:order-1 md:h-screen md:w-80 md:shrink-0 md:overflow-y-auto"
      >
        <header className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
          <a href="/" className="text-[16px] font-semibold tracking-tight">size.fyi</a>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const next = state.units === 'metric' ? 'imperial' : 'metric';
              setStoredUnits(next);
              dispatch({ type: 'setUnits', units: next });
            }}
              aria-label={`Units: ${state.units === 'metric' ? 'millimeters' : 'inches'}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 text-[13px] dark:border-stone-700">
              {state.units === 'metric' ? 'mm' : 'in'}
            </button>
            <ShareButton />
          </div>
        </header>
        {state.missing.length > 0 && (
          <div className="flex items-center justify-between rounded-md bg-amber-100 px-4 py-2 text-[13px] text-amber-900" role="status">
            <span>Couldn’t find: {state.missing.join(', ')}</span>
            <button onClick={() => dispatch({ type: 'dismissMissing' })} aria-label="Dismiss">✕</button>
          </div>
        )}
        <ItemList onEdit={(index, name, dims) => setDialog({ mode: 'edit', index, name, dims })} />
        {!showViewer && <RecentComparisons />}
        <SearchDevices onAddCustom={(name) => setDialog({ mode: 'add', name })} />
      </div>
      {/* Safe area: the pill and empty state stay centered here, not in the full-bleed canvas.
          On desktop the section itself must be transparent to pointer events (md:pointer-events-none)
          so orbit drags reach the canvas behind it; its interactive children opt back in with
          pointer-events-auto. Mobile is untouched (no md: prefix) since the contained Viewer
          lives directly in this section there and needs normal event flow. */}
      <section className="relative z-0 order-1 h-[48vh] shrink-0 overflow-hidden md:order-2 md:h-screen md:flex-1 md:shrink md:pointer-events-none">
        <ViewTabs />
        <LayoutToggle />
        {!isDesktop && <Viewer />}
      </section>
      <ItemDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

export default function App() {
  return (
    <ComparisonProvider>
      <Shell />
    </ComparisonProvider>
  );
}
