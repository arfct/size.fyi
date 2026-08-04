// Procedural item geometry, shared by the WebGL viewer and the AR exporters. Kept out of scene.ts so
// a build-time script can produce exactly the shape the viewer draws without pulling in the renderer
// — if these ever diverge, an AR model stops matching the comparison it came from.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The geometry-relevant subset of SceneItem, declared structurally so this module doesn't import
// from scene.ts (which imports this one). A SceneItem satisfies it as-is.
export interface SolidSpec {
  h: number;
  w: number;
  d: number;
  radius?: number;
  radiusAxis?: 'x' | 'y' | 'z';
  radiusInner?: number;
  hinge?: HingeEdge;
  screen?: { h: number; w: number; radius?: number };
  mesh?: 'banana';
}

// Corner smoothing (Apple/Figma "squircle"): 0 = plain circular arc, ~0.6 = iOS, 1 = maximum. The
// corner keeps a REAL circular arc of the exact radius (so perceived roundedness always equals the
// radius, no scaling needed) and eases the curvature into the straight edges with cubic Béziers.
// Ported from Figma's construction — figma.com/blog/desperately-seeking-squircles, via the formulas
// in github.com/phamfoo/figma-squircle (getPathParamsForCorner).
const CORNER_SMOOTHING = 0.6;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function sampleCubic(
  out: THREE.Vector2[],
  p0: THREE.Vector2,
  c1: THREE.Vector2,
  c2: THREE.Vector2,
  p3: THREE.Vector2,
  seg: number,
) {
  for (let k = 1; k <= seg; k++) {
    const t = k / seg,
      mt = 1 - t;
    const w0 = mt * mt * mt,
      w1 = 3 * mt * mt * t,
      w2 = 3 * mt * t * t,
      w3 = t * t * t;
    out.push(
      new THREE.Vector2(
        w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
        w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y,
      ),
    );
  }
}

// Samples the minor circular arc from s→e of radius r. Of the two possible centres, picks the one
// nearer `inside` (the rect centre) so the arc bulges outward like a corner should.
function sampleArc(
  out: THREE.Vector2[],
  s: THREE.Vector2,
  e: THREE.Vector2,
  r: number,
  inside: THREE.Vector2,
  seg: number,
) {
  const mx = (s.x + e.x) / 2,
    my = (s.y + e.y) / 2;
  const dx = e.x - s.x,
    dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const h = Math.sqrt(Math.max(0, r * r - (len / 2) ** 2));
  const px = -dy / len,
    py = dx / len; // unit perpendicular to the chord
  const c1 = new THREE.Vector2(mx + px * h, my + py * h);
  const c2 = new THREE.Vector2(mx - px * h, my - py * h);
  const c = c1.distanceTo(inside) <= c2.distanceTo(inside) ? c1 : c2;
  const a0 = Math.atan2(s.y - c.y, s.x - c.x);
  let da = Math.atan2(e.y - c.y, e.x - c.x) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  for (let k = 1; k <= seg; k++) {
    const a = a0 + da * (k / seg);
    out.push(new THREE.Vector2(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
}

// Per-corner radii, clockwise from top-left in the rect's own frame — the same order and winding as
// CSS border-radius. `cornerRadii` builds one of these from a device's radius/radiusInner/hinge.
export type CornerRadii = [tl: number, tr: number, br: number, bl: number];

// Which edge of the rect the hinge runs along, in the rect's own frame — for the usual radiusAxis 'z'
// that is the face you are looking at, so 'left' means the device's left side as drawn.
export type HingeEdge = 'left' | 'right' | 'top' | 'bottom';

// A fold's corners aren't four independent numbers: the two on the hinge side are tight and the two on
// the free side are the device's normal radius. Describing it that way keeps the catalog honest about
// what it knows (one outer radius, one inner) and leaves picking the corners to the geometry, where
// the winding order lives.
//
// Returns the plain number when there's no inner radius, so every non-folding device stays on exactly
// the code path it was on before per-corner radii existed.
export function cornerRadii(
  outer: number,
  inner: number | undefined,
  hinge: HingeEdge = 'left',
): number | CornerRadii {
  if (inner === undefined) return outer;
  switch (hinge) {
    case 'left':
      return [inner, outer, outer, inner];
    case 'right':
      return [outer, inner, inner, outer];
    case 'top':
      return [inner, inner, outer, outer];
    case 'bottom':
      return [outer, outer, inner, inner];
  }
}

// The path parameters for one corner. `p` is how far along each adjacent edge the corner reaches, and
// it is capped at `budget` — which is what keeps two corners on the same edge from ever colliding,
// since each is at most half the shorter side and one edge holds two of them.
function cornerParams(R: number, budget: number) {
  const s = Math.min(CORNER_SMOOTHING, Math.max(0, budget / R - 1));
  const p = Math.min((1 + s) * R, budget);
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(toRad(arcMeasure / 2)) * R * Math.SQRT2;
  const angleAlpha = (90 - arcMeasure) / 2;
  const p3p4 = R * Math.tan(toRad(angleAlpha / 2));
  const cc = p3p4 * Math.cos(toRad(45 * s));
  const cd = cc * Math.tan(toRad(45 * s));
  const cb = (p - arc - cc - cd) / 3;
  return { R, p, arc, cc, cd, cb, ca: 2 * cb };
}

// A rounded rect with Figma-style smoothed corners, each corner independently radiused. Built in an
// SVG-like top-left/y-down frame (as Figma's formulas assume), sampled to points, then flipped into
// our centred, y-up shape space.
//
// One parameterised corner block, walked clockwise from the top edge, where the four corners used to
// be written out longhand. Each is the same cubic → arc → cubic expressed in that corner's own basis:
// `u` is the direction of the edge arriving at it, `v` the edge leaving. A square corner (R <= 0)
// contributes only its vertex.
export function roundedRectShape(a: number, b: number, r: number | CornerRadii): THREE.Shape {
  const W = a,
    H = b;
  const shape = new THREE.Shape();
  const budget = Math.min(W, H) / 2; // each corner gets at most half the shorter side
  const radii = (typeof r === 'number' ? [r, r, r, r] : r).map((v) =>
    Math.min(Math.max(v, 0), budget),
  ) as CornerRadii;
  if (radii.every((v) => v <= 0)) {
    shape.setFromPoints([
      new THREE.Vector2(-W / 2, -H / 2),
      new THREE.Vector2(W / 2, -H / 2),
      new THREE.Vector2(W / 2, H / 2),
      new THREE.Vector2(-W / 2, H / 2),
    ]);
    return shape;
  }

  // Clockwise in the y-down frame: the path starts on the top edge and turns at TR, BR, BL, TL. `i`
  // indexes into `radii`, which is in CSS order (TL first).
  interface Corner {
    at: THREE.Vector2;
    u: [number, number];
    v: [number, number];
    i: number;
  }
  const corners: Corner[] = [
    { at: new THREE.Vector2(W, 0), u: [1, 0], v: [0, 1], i: 1 },
    { at: new THREE.Vector2(W, H), u: [0, 1], v: [-1, 0], i: 2 },
    { at: new THREE.Vector2(0, H), u: [-1, 0], v: [0, -1], i: 3 },
    { at: new THREE.Vector2(0, 0), u: [0, -1], v: [1, 0], i: 0 },
  ];

  const inside = new THREE.Vector2(W / 2, H / 2);
  const pts: THREE.Vector2[] = [];
  const pen = new THREE.Vector2();
  // A point offset from `pen` by ku along the incoming edge and kv along the outgoing one.
  const off = (u: [number, number], v: [number, number], ku: number, kv: number) =>
    new THREE.Vector2(pen.x + u[0] * ku + v[0] * kv, pen.y + u[1] * ku + v[1] * kv);
  // Where a corner's path begins: p back along its incoming edge from its vertex.
  const entry = (c: Corner) => {
    const r = radii[c.i]!;
    const back = r > 0 ? cornerParams(r, budget).p : 0;
    return new THREE.Vector2(c.at.x - c.u[0] * back, c.at.y - c.u[1] * back);
  };

  pen.copy(entry(corners[0]!));
  pts.push(pen.clone());

  for (let n = 0; n < 4; n++) {
    const c = corners[n]!;
    const { u, v } = c;
    if (radii[c.i]! > 0) {
      const { R, arc, ca, cb, cc, cd } = cornerParams(radii[c.i]!, budget);
      let e = off(u, v, ca + cb + cc, cd);
      sampleCubic(pts, pen.clone(), off(u, v, ca, 0), off(u, v, ca + cb, 0), e, 16);
      pen.copy(e);
      e = off(u, v, arc, arc);
      sampleArc(pts, pen.clone(), e, R, inside, 20);
      pen.copy(e);
      e = off(u, v, cd, ca + cb + cc);
      sampleCubic(pts, pen.clone(), off(u, v, cd, cc), off(u, v, cd, cb + cc), e, 16);
      pen.copy(e);
    } else {
      pen.copy(c.at); // square: straight into the vertex and straight out
      pts.push(pen.clone());
    }
    if (n < 3) {
      pen.copy(entry(corners[n + 1]!));
      pts.push(pen.clone());
    }
  }

  shape.setFromPoints(pts.map((v) => new THREE.Vector2(v.x - W / 2, H / 2 - v.y)));
  return shape;
}

// A closed foldable is two panels stacked in depth; this traces the w×h device outline at the
// mid-thickness plane (local z=0) as line segments — the clamshell "parting line" that reads as
// "this opens". Added as a child of the mesh so it inherits position/scale/fade like the edges.
export function buildSeamGeometry(
  w: number,
  h: number,
  radius: number | CornerRadii = 0,
): THREE.BufferGeometry {
  const pts = roundedRectShape(w, h, radius).getPoints(48);
  const positions: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    positions.push(a.x, a.y, 0, b.x, b.y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

// Sweeps circular cross-section rings along a planar curved spine (bending upward through
// ~110°) with a tapered radius profile, then rescales the result so its bounding box is
// exactly w×h×d — matching how box/rounded geometry sits on the ground at those dimensions.
export function buildBananaGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const N = 24; // rings along the spine
  const M = 12; // radial segments per ring
  const arcHalf = 1.3; // half-sweep, radians (~150° total) — enough curl that the fat middle doesn't flatten the concave (top) side
  const R = 1; // arbitrary spine arc radius; shape is rescaled to w×h×d below
  const rMax = 0.5; // arbitrary cross-section scale; rescaled below too

  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const theta = (t - 0.5) * arcHalf * 2;
    const center = new THREE.Vector3(R * Math.sin(theta), R * (1 - Math.cos(theta)), 0);
    const n1 = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0); // in-plane normal
    const n2 = new THREE.Vector3(0, 0, 1); // binormal (spine is planar in XY)
    const r = rMax * (0.3 + 0.7 * Math.sin(Math.PI * t) ** 0.6);

    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < M; j++) {
      const phi = (j / M) * Math.PI * 2;
      ring.push(
        center
          .clone()
          .addScaledVector(n1, Math.cos(phi) * r)
          .addScaledVector(n2, Math.sin(phi) * r),
      );
    }
    rings.push(ring);
  }

  // spine endpoints, used to cap the tube with triangle fans
  const startSpine = new THREE.Vector3(R * Math.sin(-arcHalf), R * (1 - Math.cos(-arcHalf)), 0);
  const endSpine = new THREE.Vector3(R * Math.sin(arcHalf), R * (1 - Math.cos(arcHalf)), 0);

  const positions: number[] = [];
  for (const ring of rings) for (const v of ring) positions.push(v.x, v.y, v.z);
  const startCenterIdx = N * M;
  const endCenterIdx = N * M + 1;
  positions.push(startSpine.x, startSpine.y, startSpine.z);
  positions.push(endSpine.x, endSpine.y, endSpine.z);

  const indices: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M; j++) {
      const jNext = (j + 1) % M;
      const a = i * M + j,
        b = i * M + jNext,
        c = (i + 1) * M + j,
        dIdx = (i + 1) * M + jNext;
      indices.push(a, c, b, b, c, dIdx);
    }
  }
  for (let j = 0; j < M; j++) {
    const jNext = (j + 1) % M;
    indices.push(startCenterIdx, j, jNext); // start cap
    const base = (N - 1) * M;
    indices.push(endCenterIdx, base + jNext, base + j); // end cap
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);

  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  geo.scale(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

export function buildGeometry(item: SolidSpec): THREE.BufferGeometry {
  if (item.mesh === 'banana') return buildBananaGeometry(item.w, item.h, item.d);
  if (!item.radius) return new THREE.BoxGeometry(item.w, item.h, item.d);
  // radius without an axis rounds every edge (e.g. AirPods cases). Clamp just under half the
  // smallest side so the fillets never overrun the box.
  if (!item.radiusAxis) {
    const r = Math.min(item.radius, Math.min(item.w, item.h, item.d) / 2 - 0.01);
    return new RoundedBoxGeometry(item.w, item.h, item.d, 4, r);
  }
  const opts = { bevelEnabled: false, curveSegments: 12 };
  const corners = cornerRadii(item.radius, item.radiusInner, item.hinge);
  let geo: THREE.BufferGeometry;
  if (item.radiusAxis === 'z') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.h, corners), {
      ...opts,
      depth: item.d,
    });
  } else if (item.radiusAxis === 'y') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.d, corners), {
      ...opts,
      depth: item.h,
    });
    geo.rotateX(-Math.PI / 2);
  } else {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.d, item.h, corners), {
      ...opts,
      depth: item.w,
    });
    geo.rotateY(Math.PI / 2);
  }
  geo.center(); // extrusion spans [0, depth] along its axis; recenter like BoxGeometry
  return geo;
}

// The screen face: a filled rounded rect sitting just proud of the front face, returned as geometry
// only so the viewer and the AR exporter can each apply their own material. Null for screenless items.
//
// Concentric corners: screen radius = body radius − bezel inset, so the bezel gap stays uniform
// through the corner (mirrors the body's rounding). Floored at the device's own stored screen radius
// so devices with a small/absent body radius don't regress to square.
//
// The inner corners of a fold get no such floor. The stored screen radius describes the outer corners
// — it was authored when every corner was the same — so applying it to a corner whose body radius is
// 2 mm would leave the screen rounder than the body it sits in. They follow the body alone, and go
// square when the bezel is wider than the body's inner radius.
export function screenGeometry(item: SolidSpec): THREE.BufferGeometry | null {
  if (!item.screen) return null;
  const inset = (item.w - item.screen.w) / 2;
  const outer = Math.max(item.screen.radius ?? 0, item.radius ? item.radius - inset : 0);
  const inner = item.radiusInner === undefined ? undefined : Math.max(0, item.radiusInner - inset);
  return new THREE.ShapeGeometry(
    roundedRectShape(item.screen.w, item.screen.h, cornerRadii(outer, inner, item.hinge)),
  );
}
