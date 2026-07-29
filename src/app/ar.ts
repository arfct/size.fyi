// Mobile AR launch. iOS/iPadOS: AR Quick Look via a `rel="ar"` anchor to a USDZ. Android: Scene
// Viewer via an intent URL to a GLB. Assets are opaque and real-scale (AR Quick Look culls
// geometry inside transparent models), pre-generated per device — see scripts/build-ar.mjs.
import type { ComparisonItem, LayoutMode } from '../shared/types';
import { encodeComparison } from '../shared/urlCodec';

export interface ARTarget {
  usdzUrl: string;
  glbUrl: string;
  title: string;
}

export function isAndroid(ua: string = navigator.userAgent): boolean {
  return /android/i.test(ua);
}

// iOS/macOS Safari advertise AR Quick Look through the anchor relList.
export function supportsQuickLook(): boolean {
  const a = document.createElement('a');
  return !!a.relList?.supports?.('ar');
}

// Only offer AR on a touch device that can actually place it (avoids showing it on desktop Safari,
// which advertises Quick Look but has no camera AR).
export function canLaunchAR(): boolean {
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return touch && (supportsQuickLook() || isAndroid());
}

// Android Scene Viewer intent. `file` must be an absolute https URL; falls back to reopening the
// page if Scene Viewer / the Google app isn't available.
export function sceneViewerUrl(glbUrl: string, title: string, fallbackUrl: string): string {
  const file = encodeURIComponent(new URL(glbUrl, location.href).href);
  const fb = encodeURIComponent(fallbackUrl);
  return (
    `intent://arvr.google.com/scene-viewer/1.0?file=${file}&mode=ar_preferred&title=${encodeURIComponent(title)}` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${fb};end;`
  );
}

// Hands a USDZ to AR Quick Look. Synthesizing the anchor is the only way in — there's no JS API.
export function launchQuickLook(usdzUrl: string): void {
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = usdzUrl;
  a.appendChild(document.createElement('img')); // Quick Look requires a child element
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function launchAR({ usdzUrl, glbUrl, title }: ARTarget): void {
  if (supportsQuickLook()) {
    launchQuickLook(usdzUrl);
  } else if (isAndroid()) {
    window.location.href = sceneViewerUrl(glbUrl, title, window.location.href);
  }
}

// The whole-comparison model is USDZ-only: the Worker composes it by referencing per-item USD layers,
// and glTF has no equivalent composition arc, so there's no Android counterpart yet (A-151). Gate the
// comparison AR affordance on this rather than canLaunchAR, which also passes on Android.
export function canLaunchComparisonAR(): boolean {
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return touch && supportsQuickLook();
}

// The Worker route for a comparison — generated on request, so any set of items resolves. The path is
// the same grammar as the shareable URL, and `encodeComparison` is already canonical (explicit device
// states), so this never triggers the route's normalizing redirect.
//
// Layout rides along because a stack and a row are genuinely different models: `?layout=stack` for
// stacked, omitted for side-by-side since that's the route's default.
export function comparisonArUrl(items: ComparisonItem[], layoutMode: LayoutMode): string {
  const query = layoutMode === 'stack' ? '?layout=stack' : '';
  return `/ar${encodeComparison(items)}.usdz${query}`;
}
