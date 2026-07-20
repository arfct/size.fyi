import { useRef, useState } from 'react';
import ItemDialog, { type DialogState } from './components/ItemDialog';
import ItemList from './components/ItemList';
import RecentComparisons from './components/RecentComparisons';
import SearchDevices from './components/SearchDevices';
import ShareButton from './components/ShareButton';
import ViewMenu from './components/ViewMenu';
import Viewer from './components/Viewer';
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
      {/* Mobile top toolbar (md:hidden): sticks to the top and holds the logo, the display menu
          (view / layout / units), and Share. On desktop those controls float over the canvas
          (menu, top-right) and live in the sidebar header (Share). */}
      <div className="sticky top-0 z-40 order-first flex items-center justify-between gap-2 border-b border-stone-200 bg-white/85 px-4 py-2 backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/85">
        <a href="/" className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
          <img src="/logo.svg" alt="" className="h-5 w-5" />
          size.fyi
        </a>
        <div className="flex items-center gap-2">
          <ViewMenu />
          <ShareButton />
        </div>
      </div>
      <div
        ref={asideRef}
        className="relative z-10 order-2 w-full space-y-4 p-4 md:order-1 md:h-screen md:w-80 md:shrink-0 md:overflow-y-auto"
      >
        <header className="hidden items-center justify-between border-b border-stone-200 pb-3 md:flex dark:border-stone-800">
          <a href="/" className="flex items-center gap-2 text-[16px] font-semibold tracking-tight">
            <img src="/logo.svg" alt="" className="h-5 w-5" />
            size.fyi
          </a>
          <ShareButton />
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
        {/* Desktop-only floating display menu (top-right). Opts back into pointer events since the
            section is md:pointer-events-none so orbit drags reach the canvas behind it. */}
        <div className="pointer-events-auto absolute right-3 top-3 z-10 hidden md:block">
          <ViewMenu />
        </div>
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
