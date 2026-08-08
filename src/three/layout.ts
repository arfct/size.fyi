// Layout: where each item sits in the comparison, and the bounds that follow. Pure — no renderer, no
// DOM, and deliberately no three.js either — so the AR exporters place items exactly where the viewer
// does. Kept out of scene.ts for the same reason as geometry.ts: a build script or Worker can't import
// the renderer.
//
// Positions are plain {x,y,z} rather than THREE.Vector3 so the Worker can compose an AR scene without
// bundling three for two vector classes. Vector3.copy/lerpVectors/equals all read .x/.y/.z, so the
// renderer consumes these unchanged.
//
// LayoutMode is imported as a type only, which Node's type stripping erases outright — scene.ts can't
// be imported outside a bundler because its value imports omit file extensions.
import type { LayoutMode } from '../shared/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// The layout-relevant subset of LayoutItem, structural so this module needn't import from scene.ts.
export interface LayoutItem {
  name: string;
  h: number;
  w: number;
  d: number;
  // What to sort by, when that shouldn't be the volume the item currently occupies. A foldable's
  // volume changes with its state — sometimes downward — so ordering by it made toggling open/closed
  // shuffle everything else. Callers pass the device's nominal volume (see sortVolume in shared/types)
  // and the order then depends only on which devices are present. Defaults to h*w*d for anything with
  // no separate identity to appeal to, which is every non-device item.
  sortVolume?: number;
  screen?: { h: number; w: number; radius?: number };
  seam?: boolean;
  mesh?: 'banana';
}

export interface LayoutTarget {
  pos: Vec3;
  renderOrder: number;
}

function itemKey(item: LayoutItem): string {
  return `${item.name}|${item.h}x${item.w}x${item.d}|${item.mesh ?? ''}|${item.seam ? 'seam' : ''}`;
}

// Disambiguates duplicate items (same name+dims+mesh added more than once) by suffixing an
// occurrence index, so the diff in createScene never collides two distinct items onto one
// handle. Pure and side-effect-free — exported for direct unit testing.
export function computeKeys(items: LayoutItem[]): string[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const base = itemKey(item);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

const volumeOf = (i: LayoutItem) => i.sortVolume ?? i.h * i.w * i.d;
const minDimOf = (i: LayoutItem) => Math.min(i.h, i.w, i.d);
const MAX_STACK_GAP = 10; // mm (1 cm) — ceiling on the depth gap between stacked items
const ROW_CM = 10; // mm — row items snap their left edge to this grid so front-left corners sit on cm lines

// Items are sorted by volume. Row = sequential along +x smallest→largest, all front-aligned to the
// z=0 plane and extending back (nearest face at z=0, so the ruler along the front reads cleanly).
// Each row item's left edge snaps to the next whole-centimetre line past its predecessor, leaving a
// 1–2 cm gap, so every front-left corner sits on a grid mark. Stack = sequential along +z with the
// LARGEST at the back (z=0) and the smallest at the front (nearest the camera), so the size
// progression reads front-to-back small→large and the largest doesn't occlude the rest; stacked
// items share a bottom-left corner (left edge at x=0) so their origins line up. Either way each item
// sits with its bottom on the ground (y=h/2); the stack gap is the smaller of the two neighbours'
// smallest dimensions, capped at 1 cm. Stack renderOrder increases along z
// (nearer items drawn later) so the translucent items blend front-to-back correctly (paired with
// depthWrite:false on the transparent materials in createScene). Pure — exported for direct testing.
export function computeTargets(
  items: LayoutItem[],
  keys: string[],
  mode: LayoutMode,
): Map<string, LayoutTarget> {
  const targets = new Map<string, LayoutTarget>();
  const order = items
    .map((item, i) => ({ item, key: keys[i]! }))
    .sort((a, b) => volumeOf(a.item) - volumeOf(b.item));
  const gapBetween = (seq: typeof order, idx: number) => {
    const next = seq[idx + 1];
    return next ? Math.min(minDimOf(seq[idx]!.item), minDimOf(next.item)) : 0;
  };
  if (mode === 'stack') {
    const seq = [...order].reverse(); // largest first (back), smallest last (front)
    let z = 0;
    seq.forEach(({ item, key }, idx) => {
      // Left edge at x=0 (center at w/2) so items align at the bottom-left corner, not centered.
      targets.set(key, {
        pos: { x: item.w / 2, y: item.h / 2, z: z + item.d / 2 },
        renderOrder: idx,
      });
      z += item.d + Math.min(gapBetween(seq, idx), MAX_STACK_GAP); // cap the stack gap at 1 cm
    });
  } else {
    let x = 0; // left edge; kept on a whole-centimetre line so each front-left corner lands on a grid mark
    order.forEach(({ item, key }) => {
      targets.set(key, {
        pos: { x: x + item.w / 2, y: item.h / 2, z: -item.d / 2 },
        renderOrder: 0,
      });
      x = Math.ceil((x + item.w) / ROW_CM) * ROW_CM + ROW_CM; // next corner on a cm line, 1–2 cm gap
    });
  }
  return targets;
}

// Bounds from TARGET positions/dims (not the live, possibly mid-tween, group) — used for the camera
// refit, the grid recompute, and the AR exporters' placement check. Pure — exported for direct unit
// testing. Screened items get a little extra depth so the camera fit clears the proud screen face.
export function computeTargetBounds(
  items: LayoutItem[],
  keys: string[],
  targets: Map<string, LayoutTarget>,
): { min: Vec3; max: Vec3 } {
  if (items.length === 0) {
    return { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 100, z: 100 } };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const expand = (p: Vec3) => {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  };
  items.forEach((item, i) => {
    const t = targets.get(keys[i]!)!;
    expand({ x: t.pos.x - item.w / 2, y: t.pos.y - item.h / 2, z: t.pos.z - item.d / 2 });
    expand({ x: t.pos.x + item.w / 2, y: t.pos.y + item.h / 2, z: t.pos.z + item.d / 2 });
    if (item.screen) expand({ x: t.pos.x, y: t.pos.y, z: t.pos.z + item.d / 2 + 0.5 });
  });
  return { min, max };
}
