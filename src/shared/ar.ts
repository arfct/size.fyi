// Bits the AR pipeline needs on both sides of the build: the deploy-time script that writes per-item
// geometry layers, and the Worker that composes them per request. Deliberately free of three and of
// the DOM so every consumer can import it — including plain `node`, which is why nothing here reaches
// for an extensionless relative import.
// Explicit .ts extension: build scripts import this module under bare node, which can't resolve
// extensionless specifiers the way a bundler does.
import { type Device, defaultStateLabel } from './types.ts';

// Generator version, carried in the AR model URL as `?v=`.
//
// The route answers with `cache-control: immutable`, which is true of the bytes for a given generator
// and false across a change to one. Shipping the uint16/bufferView-target fix proved it the hard way:
// every already-requested URL kept serving the old broken model from the edge, with a year to run and
// no way to purge from code.
//
// So the version is part of the resource identity. Bump it whenever the emitted USDZ or GLB changes in
// a way that matters — a geometry change, a container fix, a material change — and every URL becomes a
// new one that cannot hit a stale entry. Immutable then means what it says.
//
// 1: initial USDZ + GLB routes
// 2: GLB uint16 indices, bufferView targets, explicit primitive mode (Scene Viewer compatibility)
export const AR_MODEL_VERSION = 2;

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
