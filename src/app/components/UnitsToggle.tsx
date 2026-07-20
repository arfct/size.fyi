import { setStoredUnits } from '../localStore';
import { useComparison } from '../store';

// Round mm/in toggle. Used in the desktop sidebar header and the mobile top toolbar.
export default function UnitsToggle() {
  const { state, dispatch } = useComparison();
  return (
    <button
      type="button"
      onClick={() => {
        const next = state.units === 'metric' ? 'imperial' : 'metric';
        setStoredUnits(next);
        dispatch({ type: 'setUnits', units: next });
      }}
      aria-label={`Units: ${state.units === 'metric' ? 'millimeters' : 'inches'}`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-300 text-[13px] dark:border-stone-700"
    >
      {state.units === 'metric' ? 'mm' : 'in'}
    </button>
  );
}
