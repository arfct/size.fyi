import { ComparisonProvider } from './store';
import AddItemPanel from './components/AddItemPanel';

export default function App() {
  return (
    <ComparisonProvider>
      <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <header className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <h1 className="text-lg font-semibold tracking-tight">size.fyi</h1>
        </header>
        <main id="app-main" className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[20rem_1fr]">
          <aside>
            <AddItemPanel />
          </aside>
          <div>{/* comparison viewer arrives in Task 8 */}</div>
        </main>
      </div>
    </ComparisonProvider>
  );
}
