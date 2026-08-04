// Bits the AR pipeline needs on both sides of the build: the deploy-time script that writes per-item
// geometry layers, and the Worker that composes them per request. Deliberately free of three and of
// the DOM so every consumer can import it — including plain `node`, which is why nothing here reaches
// for an extensionless relative import.
// Explicit .ts extension: build scripts import this module under bare node, which can't resolve
// extensionless specifiers the way a bundler does.
import { type ComparisonItem, type Device, defaultStateLabel, itemDims } from './types.ts';

// Generator version, carried in the AR model URL as `?v=`.
//
// The route answers with `cache-control: immutable`, which is true of the bytes for a given generator
// and false across a change to one. Shipping the uint16/bufferView-target fix proved it the hard way:
// every already-requested URL kept serving the old broken model from the edge, with a year to run and
// no way to purge from code.
//
// So the version is part of the resource identity — but only for changes to the GENERATOR: the code
// that turns dimensions into bytes. What a device measures rides on `?g=` instead (see
// geometryFingerprint), because bumping this invalidates all 99 devices at once and a single corrected
// radius has no business doing that. Versions 4 to 6 were exactly that mistake, three days running.
//
// 1: initial USDZ + GLB routes
// 2: GLB uint16 indices, bufferView targets, explicit primitive mode
// 3: GLB authored in metres with no scale node — a node transform did not carry real-world size into
//    Scene Viewer's AR placement, which read POSITION bounds directly
// 4: fold hinge-side corner radii (catalog data — would now be a `g` change, not a bump)
// 5: Mac mini footprint radius (likewise)
// 6: Mac Studio footprint radius (likewise)
export const AR_MODEL_VERSION = 6;

// How far proud of its front face a screen sits, in millimetres. Lives here rather than beside the
// geometry because every consumer applies it as a placement offset — the renderer, the AR exporters,
// and the Worker — and two copies of this number would drift into a z-fighting or wrong-depth bug.
//
// Large enough that no renderer or AR viewer z-fights it against the body, small enough to disappear
// at true scale. Note it does make an exported item this much deeper than its real depth.
export const SCREEN_PROUD_MM = 0.4;

// Names the geometry layer for a device variant. The Worker looks layers up by this name and the build
// script writes them under it, so they share one definition: a mismatch would be a 500 per item.
//
// A stateful device with no state requested resolves to the same default deviceDims() would pick, so
// the layer always matches the dimensions being laid out.
export function geometryKey(device: Device, state?: string): string {
  const label = device.states?.length ? (state ?? defaultStateLabel(device)) : undefined;
  return label ? `${device.slug}-${label}` : device.slug;
}

// FNV-1a, 32 bits, base36. Not a security hash and it doesn't need to be — it only has to change when
// the geometry changes and stay put when it doesn't.
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Fingerprints the geometry the AR route will build for these items, for the URL's `?g=`.
//
// The path already names the items and their states, but not what those items MEASURE — that lives in
// the catalog and can change under a URL the edge is caching for a year. So the numbers that determine
// the mesh go into the identity of the resource. Correct a radius and only the comparisons containing
// that device get new URLs; every other model keeps its warm cache.
//
// Custom items are here too, though their dimensions are already in the path: they cost nothing and it
// keeps the rule "everything the mesh depends on is in the fingerprint" true without exceptions.
export function geometryFingerprint(items: ComparisonItem[]): string {
  return fnv1a(
    items
      .map((item) => {
        const d = itemDims(item);
        const device = item.kind === 'device' ? item.device : undefined;
        return [
          d.h,
          d.w,
          d.d,
          d.radius ?? '',
          d.radiusAxis ?? '',
          d.radiusInner ?? '',
          d.hinge ?? '',
          d.screen ? `${d.screen.h}x${d.screen.w}r${d.screen.radius ?? ''}` : '',
          d.seam ? 'seam' : '',
          device?.mesh ?? '',
          device?.model3d
            ? `${device.model3d.url}@${(device.model3d.rotation ?? []).join(',')}`
            : '',
        ].join('|');
      })
      .join(';'),
  );
}
