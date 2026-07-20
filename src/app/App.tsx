import AddItemPanel from './components/AddItemPanel';
import EmptyState from './components/EmptyState';
import ItemList from './components/ItemList';
import ShareButton from './components/ShareButton';
import ViewTabs from './components/ViewTabs';
import Viewer from './components/Viewer';
import { setStoredUnits } from './localStore';
import { ComparisonProvider, useComparison } from './store';
import { useUrlSync } from './useUrlSync';

function Shell() {
  useUrlSync();
  const { state, dispatch } = useComparison();
  return (
    <div className="flex min-h-screen flex-col bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex items-center border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <a href="/" className="text-lg font-semibold tracking-tight">size.fyi</a>
      </header>
      {state.missing.length > 0 && (
        <div className="flex items-center justify-between bg-amber-100 px-4 py-2 text-sm text-amber-900" role="status">
          <span>Couldn’t find: {state.missing.join(', ')}</span>
          <button onClick={() => dispatch({ type: 'dismissMissing' })} aria-label="Dismiss">✕</button>
        </div>
      )}
      <main className="flex flex-1 flex-col md:flex-row">
        <aside className="w-full space-y-4 p-4 md:w-80 md:shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const next = state.units === 'metric' ? 'imperial' : 'metric';
              setStoredUnits(next);
              dispatch({ type: 'setUnits', units: next });
            }}
              className="rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">
              {state.units === 'metric' ? 'mm' : 'in'}
            </button>
            <ShareButton />
          </div>
          <AddItemPanel />
          <ItemList />
        </aside>
        <section className="relative min-h-[360px] flex-1 overflow-hidden bg-white dark:bg-stone-900">
          <ViewTabs />
          {state.items.length === 0 ? <EmptyState /> : <Viewer />}
        </section>
      </main>
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
