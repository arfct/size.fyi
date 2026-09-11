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
// Which way a device turns to reach its rotated alternate — a quarter turn about the depth axis, seen
// from the front. Authored per geometry, because it's a matter of how the thing is actually held: an
// iPhone goes to landscape counter-clockwise, the iPhone Duo turns clockwise in both states.
export type Rotation = 'cw' | 'ccw';
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
  rotation?: Rotation; // present when this state has a rotated alternate
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
  slugAliases?: string[]; // former slugs of a renamed device; old URLs keep resolving
  source?: string;
  radius?: number; // mm; fillets edges parallel to radiusAxis
  radiusAxis?: RadiusAxis; // x=width, y=height, z=depth
  radiusInner?: number; // mm; the two corners on `hinge` (see DeviceState.radiusInner)
  hinge?: HingeEdge; // default 'left'
  screen?: Screen; // mm; inset rect on the +z front face
  rotation?: Rotation; // present when the base geometry has a rotated alternate
  mesh?: 'banana' | 'bottle'; // procedural mesh override, in place of the box/rounded-box primitives
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
  // state = active DeviceState label (foldables); rotated = showing that geometry's rotated alternate
  | { kind: 'device'; device: Device; state?: string; rotated?: boolean }
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

// The geometry a device presents in `state` — the state itself, or the device's own fields when it has
// no states (or none match).
function baseGeometry(device: Device, state?: string): Device | DeviceState {
  return activeState(device, state) ?? device;
}

export function rotationOf(device: Device, state?: string): Rotation | undefined {
  return baseGeometry(device, state).rotation;
}

// Where an edge ends up after a quarter turn seen from the front.
const TURNED: Record<Rotation, Record<HingeEdge, HingeEdge>> = {
  cw: { left: 'top', top: 'right', right: 'bottom', bottom: 'left' },
  ccw: { left: 'bottom', bottom: 'right', right: 'top', top: 'left' },
};

// A quarter turn about the depth axis: height and width trade places, the screen with them, and the
// hinge moves to the edge it was turned onto. Radius is symmetric, so it stays. The hinge defaults to
// 'left' everywhere it's read, so an unset one is turned explicitly or it would stay on the left.
function turned(g: ResolvedDims, rotation: Rotation): ResolvedDims {
  const screen = g.screen && {
    ...g.screen,
    h: g.screen.w,
    w: g.screen.h,
    px: g.screen.px && { w: g.screen.px.h, h: g.screen.px.w },
  };
  return { ...g, h: g.w, w: g.h, hinge: TURNED[rotation][g.hinge ?? 'left'], screen };
}

export function deviceDims(device: Device, state?: string, rotated?: boolean): ResolvedDims {
  const g = baseGeometry(device, state);
  const dims: ResolvedDims = {
    h: g.h,
    w: g.w,
    d: g.d,
    radius: g.radius,
    radiusAxis: g.radiusAxis,
    radiusInner: g.radiusInner,
    hinge: g.hinge,
    screen: g.screen,
    seam: 'seam' in g ? g.seam : undefined,
  };
  return rotated && g.rotation ? turned(dims, g.rotation) : dims;
}

export type Orientation = 'portrait' | 'landscape';
// Named from the shape, never authored: a device is portrait when it stands taller than it is wide.
export function orientation(dims: { h: number; w: number }): Orientation {
  return dims.h >= dims.w ? 'portrait' : 'landscape';
}

// The volume an item is SORTED by, which is deliberately not the volume it currently occupies.
//
// A foldable's volume changes with its state, and not always the way you'd guess: opening a Z Fold8
// takes it from 98,430 to 89,989 mm3, because it thins faster than it widens. An iPhone 16 Pro is
// 88,245, so unfolding one made it cross the iPhone and the two swapped places in the list, the row and
// the AR scene. Toggling a state should change that item's shape, not everything's position.
//
// So sorting uses the device's nominal size — its top-level h/w/d, which the catalog build fills in
// from the default state — and ignores which state is selected. The order then depends only on WHICH
// devices are in the comparison, which is also what keeps one set of devices to one canonical URL.
export function sortVolume(item: ComparisonItem): number {
  const d = item.kind === 'device' ? item.device : item;
  return d.h * d.w * d.d;
}

export function itemDims(item: ComparisonItem): ResolvedDims {
  return item.kind === 'device'
    ? deviceDims(item.device, item.state, item.rotated)
    : { h: item.h, w: item.w, d: item.d };
}
