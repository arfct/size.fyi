import CustomEntry from './components/CustomEntry';
import EmptyState from './components/EmptyState';
import ItemList from './components/ItemList';
import SearchDevices from './components/SearchDevices';
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
    <div className="flex min-h-screen flex-col bg-white text-stone-900 dark:bg-stone-900 dark:text-stone-100 md:flex-row">
      <div className="w-full space-y-4 p-4 md:h-screen md:w-80 md:shrink-0 md:overflow-y-auto">
        <header className="flex items-center justify-between border-b border-stone-200 pb-3 dark:border-stone-800">
          <a href="/" className="text-lg font-semibold tracking-tight">size.fyi</a>
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
        </header>
        {state.missing.length > 0 && (
          <div className="flex items-center justify-between rounded-md bg-amber-100 px-4 py-2 text-sm text-amber-900" role="status">
            <span>Couldn’t find: {state.missing.join(', ')}</span>
            <button onClick={() => dispatch({ type: 'dismissMissing' })} aria-label="Dismiss">✕</button>
          </div>
        )}
        <ItemList />
        <CustomEntry />
        <SearchDevices />
      </div>
      <section className="relative min-h-[360px] flex-1 overflow-hidden md:h-screen">
        <ViewTabs />
        {state.items.length === 0 ? <EmptyState /> : <Viewer />}
      </section>
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
