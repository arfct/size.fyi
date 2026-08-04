// Mobile AR launch. iOS/iPadOS: AR Quick Look via a `rel="ar"` anchor to a USDZ. Android: Scene
// Viewer via an intent URL to a GLB. Assets are opaque and real-scale (AR Quick Look culls
// geometry inside transparent models), pre-generated per device — see scripts/build-ar.mjs.
import { AR_MODEL_VERSION, geometryFingerprint } from '../shared/ar';
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

// The Worker route for a comparison — generated on request, so any set of items resolves. The path is
// the same grammar as the shareable URL, and `encodeComparison` is already canonical (explicit device
// states), so this never triggers the route's normalizing redirect.
//
// Two formats off one path, because the viewers disagree: Quick Look takes USDZ, Scene Viewer takes
// GLB. Layout rides along either way, since a stack and a row are genuinely different models —
// `?layout=stack` for stacked, omitted for side-by-side because that's the route's default.
// Two cache-identity params, because the route caches immutably and a stale model can't be purged from
// code. `v` is the generator version — the code that turns dimensions into bytes. `g` fingerprints what
// these particular items measure, which the path doesn't say: a device's radius lives in the catalog and
// can change under a URL that's already cached. Splitting them means correcting one device's geometry
// gives new URLs only to comparisons containing it, instead of cold-starting all 99.
export function comparisonArUrl(
  items: ComparisonItem[],
  layoutMode: LayoutMode,
  format: 'usdz' | 'glb',
): string {
  const params = new URLSearchParams();
  if (layoutMode === 'stack') params.set('layout', 'stack');
  params.set('v', String(AR_MODEL_VERSION));
  params.set('g', geometryFingerprint(items));
  return `/ar${encodeComparison(items)}.${format}?${params}`;
}

// Launches the comparison on whichever viewer this device has. Both platforms are served now, so the
// availability test is just canLaunchAR().
export function launchComparisonAR(
  items: ComparisonItem[],
  layoutMode: LayoutMode,
  title: string,
): void {
  if (supportsQuickLook()) {
    launchQuickLook(comparisonArUrl(items, layoutMode, 'usdz'));
  } else if (isAndroid()) {
    window.location.href = sceneViewerUrl(
      comparisonArUrl(items, layoutMode, 'glb'),
      title,
      window.location.href,
    );
  }
}
