import { Check, Share } from 'lucide-react';
import { useState } from 'react';
import { comparisonTitle, encodeComparison } from '../../shared/urlCodec';
import { useComparison } from '../store';

export default function ShareButton() {
  const { state } = useComparison();
  const [copied, setCopied] = useState(false);
  if (state.items.length === 0) return null;

  const share = async () => {
    const url = location.origin + encodeComparison(state.items);
    const title = comparisonTitle(state.items);
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* cancelled */
      }
      return; // never fall through to clipboard after attempting the native share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable or permission denied; fail silently */
    }
  };

  // Icon only: no label, and no border until hover (transparent border keeps the layout from shifting).
  // Copied feedback swaps the icon to a check rather than showing text.
  return (
    <button
      onClick={share}
      aria-label={copied ? 'Copied' : 'Share'}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent hover:border-stone-300 dark:hover:border-stone-700"
    >
      {copied ? <Check size={16} aria-hidden /> : <Share size={16} aria-hidden />}
    </button>
  );
}
