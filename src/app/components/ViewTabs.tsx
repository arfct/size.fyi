import type { View } from '../../shared/types';
import { useComparison } from '../store';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: '3d', label: '3D' }, { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' }, { id: 'top', label: 'Top' },
];

export default function ViewTabs() {
  const { state, dispatch } = useComparison();
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-md border border-stone-200 p-0.5 dark:border-stone-800">
      {VIEWS.map((v) => (
        <button key={v.id} role="tab" aria-selected={state.view === v.id}
          onClick={() => dispatch({ type: 'setView', view: v.id })}
          className={`rounded px-3 py-1 text-sm ${state.view === v.id ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}
