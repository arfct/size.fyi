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
      try { await navigator.share({ title, url }); } catch { /* cancelled */ }
      return; // never fall through to clipboard after attempting the native share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable or permission denied; fail silently */ }
  };

  return (
    <button onClick={share}
      className="rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}
