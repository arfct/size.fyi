import type { View } from '../../shared/types';
import { useComparison } from '../store';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: '3d', label: '3D' }, { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' }, { id: 'top', label: 'Top' },
];

export default function ViewTabs() {
  const { state, dispatch } = useComparison();
  return (
    <div
      role="tablist"
      aria-label="View"
      className="pointer-events-auto absolute left-1/2 top-3 z-10 hidden -translate-x-1/2 rounded-full bg-white/70 p-0.5 shadow-sm backdrop-blur md:inline-flex dark:bg-stone-900/70"
    >
      {VIEWS.map((v) => (
        <button key={v.id} role="tab" aria-selected={state.view === v.id}
          onClick={() => dispatch({ type: 'setView', view: v.id })}
          className={`rounded-full px-3 py-1 text-sm ${state.view === v.id ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}
