// Mobile AR launch. iOS/iPadOS: AR Quick Look via a `rel="ar"` anchor to a USDZ. Android: Scene
// Viewer via an intent URL to a GLB. Assets are opaque and real-scale (AR Quick Look culls
// geometry inside transparent models), pre-generated per device — see scripts/build-ar.mjs.

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

export function launchAR({ usdzUrl, glbUrl, title }: ARTarget): void {
  if (supportsQuickLook()) {
    const a = document.createElement('a');
    a.rel = 'ar';
    a.href = usdzUrl;
    a.appendChild(document.createElement('img')); // Quick Look requires a child element
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else if (isAndroid()) {
    window.location.href = sceneViewerUrl(glbUrl, title, window.location.href);
  }
}
