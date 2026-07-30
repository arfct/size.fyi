import { Scan } from 'lucide-react';
import { comparisonTitle } from '../../shared/urlCodec';
import { canLaunchAR, launchComparisonAR } from '../ar';
import { useComparison } from '../store';

// Sits beside the view pulldown rather than inside it: launching AR is an action, not a display setting,
// and it doesn't belong in a menu of radio groups. Styled like ShareButton — icon only, no border until
// hover (a transparent border keeps the layout from shifting).
//
// Hidden unless the device can actually place it, and unless there's something in the comparison to
// place. That means it's absent on desktop entirely, which is why the pulldown can't rely on it existing.
export default function ArButton() {
  const { state } = useComparison();
  if (state.items.length === 0 || !canLaunchAR()) return null;

  return (
    <button
      type="button"
      // The current layout rides along — a stack and a row are different models. The title is only read
      // by Android's Scene Viewer, which shows it in its own UI.
      onClick={() =>
        launchComparisonAR(state.items, state.layoutMode, comparisonTitle(state.items))
      }
      aria-label="View in AR"
      className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent hover:border-stone-300 dark:hover:border-stone-700"
    >
      <Scan size={16} aria-hidden />
    </button>
  );
}
