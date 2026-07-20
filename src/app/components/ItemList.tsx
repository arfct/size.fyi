import { formatDims } from '../../shared/dimensions';
import { itemColor } from '../palette';
import { useComparison } from '../store';

export default function ItemList() {
  const { state, dispatch } = useComparison();
  if (state.items.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Items">
      {state.items.map((item, i) => {
        const name = item.kind === 'device' ? item.device.name : item.name;
        const dims = item.kind === 'device' ? item.device : item;
        return (
          <li key={`${name}-${i}`} className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-stone-200/60 dark:hover:bg-stone-800/60">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[16px] font-medium">{name}</p>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: itemColor(item, i) }} />
              </div>
              <p className="text-[13px] text-stone-500">{formatDims(dims, state.units)}</p>
            </div>
            <button onClick={() => dispatch({ type: 'remove', index: i })} aria-label={`Remove ${name}`}
              className="text-stone-400 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 hover:text-stone-700 dark:hover:text-stone-200">✕</button>
          </li>
        );
      })}
    </ul>
  );
}
