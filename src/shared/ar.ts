// Bits the AR pipeline needs on both sides of the build: the deploy-time script that writes per-item
// geometry layers, and the Worker that composes them per request. Deliberately free of three and of
// the DOM so every consumer can import it — including plain `node`, which is why nothing here reaches
// for an extensionless relative import.
// Explicit .ts extension: build scripts import this module under bare node, which can't resolve
// extensionless specifiers the way a bundler does.
import { type Device, defaultStateLabel } from './types.ts';

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
