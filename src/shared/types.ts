export type Category =
  | 'everyday'
  | 'paper'
  | 'phone'
  | 'tablet'
  | 'laptop'
  | 'console'
  | 'pc-case'
  | 'audio'
  | 'camera'
  | 'watch';
export type RadiusAxis = 'x' | 'y' | 'z';
// Which edge of the rounded cross-section the hinge runs along, for a folding device whose hinge-side
// corners are tighter than its outer ones. Named in the cross-section's own frame, so for the usual
// radiusAxis 'z' it is the front face as drawn.
export type HingeEdge = 'left' | 'right' | 'top' | 'bottom';
export interface Screen {
  h: number;
  w: number;
  radius?: number;
  px?: { w: number; h: number };
  pixelRatio?: number;
}

// One selectable configuration of a multi-state device (e.g. a foldable's "closed" / "open").
// Carries the geometry that varies between states; the toggle in the item list switches between them.
export interface DeviceState {
  label: string; // short lowercase id shown on the toggle, e.g. "closed" / "open"
  h: number;
  w: number;
  d: number; // mm, for this state
  radius?: number;
  radiusAxis?: RadiusAxis;
  // A fold's hinge-side corners are tighter than its outer ones. Set this and the two corners on
  // `hinge` use it instead of `radius`. Only meaningful with a radiusAxis.
  radiusInner?: number;
  hinge?: HingeEdge; // default 'left'
  screen?: Screen;
  seam?: boolean; // draw a fold parting-line around the mid-thickness outline in 3D
}

export interface Device {
  slug: string;
  name: string;
  category: Category;
  h: number;
  w: number;
  d: number; // mm — the default state's dims for multi-state devices
  make?: string; // manufacturer, e.g. "Apple"
  model?: string; // model designation, e.g. "iPhone 17 Pro Max"
  rank?: number; // suggestion weight; higher surfaces sooner (default 0)
  url?: string; // optional link to the product / info page
  year?: number;
  aliases?: string[];
  source?: string;
  radius?: number; // mm; fillets edges parallel to radiusAxis
  radiusAxis?: RadiusAxis; // x=width, y=height, z=depth
  radiusInner?: number; // mm; the two corners on `hinge` (see DeviceState.radiusInner)
  hinge?: HingeEdge; // default 'left'
  screen?: Screen; // mm; inset rect on the +z front face
  mesh?: 'banana'; // procedural mesh override; always renders yellow wireframe
  // Optional real 3D model (glTF/GLB under /models). Rendered fit to this device's w×h×d in place
  // of the box; `rotation` (degrees XYZ) aligns the model's axes to our h=height/w=width/d=depth.
  model3d?: { url: string; rotation?: [number, number, number] };
  // Multi-state devices (foldables): each state has its own geometry. Top-level h/w/d/screen/radius
  // mirror the default state (filled in by the catalog build) so single-state consumers keep working.
  states?: DeviceState[];
  defaultState?: string; // label of the state used when none is chosen; defaults to states[0]
}
export interface Catalog {
  version: number;
  devices: Device[];
}
export type ComparisonItem =
  | { kind: 'device'; device: Device; state?: string } // state = active DeviceState label (foldables)
  | { kind: 'custom'; name: string; h: number; w: number; d: number };
export type View = '3d' | 'front' | 'side' | 'top';
// How the 3D view projects. The flat views are always orthographic regardless.
export type Projection = 'perspective' | 'orthographic';
export type Units = 'metric' | 'imperial';
export type LayoutMode = 'row' | 'stack';
export const MAX_ITEMS = 8;

// Geometry resolved for a device's active state (or its flat dims when it has no states).
export interface ResolvedDims {
  h: number;
  w: number;
  d: number;
  radius?: number;
  radiusAxis?: RadiusAxis;
  radiusInner?: number;
  hinge?: HingeEdge;
  screen?: Screen;
  seam?: boolean;
}

export function defaultStateLabel(device: Device): string | undefined {
  return device.defaultState ?? device.states?.[0]?.label;
}

// The state after `state`, wrapping at the end. Undefined for a device with nothing to cycle through,
// which is what callers test to decide whether the gesture means anything for this item.
export function nextStateLabel(device: Device, state?: string): string | undefined {
  const states = device.states;
  if (!states || states.length < 2) return undefined;
  const at = states.findIndex((s) => s.label === (state ?? defaultStateLabel(device)));
  return states[(at + 1) % states.length]!.label;
}

export function activeState(device: Device, state?: string): DeviceState | undefined {
  if (!device.states || device.states.length === 0) return undefined;
  const label = state ?? defaultStateLabel(device);
  return device.states.find((s) => s.label === label) ?? device.states[0];
}

export function deviceDims(device: Device, state?: string): ResolvedDims {
  const s = activeState(device, state);
  if (s)
    return {
      h: s.h,
      w: s.w,
      d: s.d,
      radius: s.radius,
      radiusAxis: s.radiusAxis,
      radiusInner: s.radiusInner,
      hinge: s.hinge,
      screen: s.screen,
      seam: s.seam,
    };
  return {
    h: device.h,
    w: device.w,
    d: device.d,
    radius: device.radius,
    radiusAxis: device.radiusAxis,
    radiusInner: device.radiusInner,
    hinge: device.hinge,
    screen: device.screen,
  };
}

export function itemDims(item: ComparisonItem): ResolvedDims {
  return item.kind === 'device'
    ? deviceDims(item.device, item.state)
    : { h: item.h, w: item.w, d: item.d };
}
