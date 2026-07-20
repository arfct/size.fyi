import { useComparison } from '../store';

// Floating pill sharing the same top-center overlay strip as ViewTabs (see App.tsx's safe-area
// section: md:pointer-events-none with children opting back in via pointer-events-auto). Sits to
// the right of the view tabs rather than as a segmented control since it's a single boolean
// toggle, not a multi-way tab group.
export default function LayoutToggle() {
  const { state, dispatch } = useComparison();
  const isStack = state.layoutMode === 'stack';
  return (
    <button
      type="button"
      aria-pressed={isStack}
      onClick={() => dispatch({ type: 'setLayout', mode: isStack ? 'row' : 'stack' })}
      className="pointer-events-auto absolute right-3 top-3 z-10 rounded-full border border-stone-200/70 bg-white/70 px-3 py-1 text-sm text-stone-600 shadow-sm backdrop-blur dark:border-stone-800/70 dark:bg-stone-900/70 dark:text-stone-300"
    >
      {isStack ? 'Row' : 'Stack'}
    </button>
  );
}
