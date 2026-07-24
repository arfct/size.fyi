import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LayoutMode, Units } from '../shared/types';
import { formatLengthValue } from '../shared/dimensions';

export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem {
  name: string; h: number; w: number; d: number; color: string;
  radius?: number; radiusAxis?: 'x' | 'y' | 'z';
  screen?: { h: number; w: number; radius?: number };
  seam?: boolean; // draw a fold parting-line around the mid-thickness (z=0) outline
  mesh?: 'banana';
  model3d?: { url: string; rotation?: [number, number, number] };
}

// Loads a GLB and returns one BufferGeometry fit to the given w×h×d box, centred on the origin so
// it drops in wherever the procedural box would sit. Cached per url (dims are constant per device);
// callers clone the result so per-handle disposal is safe. Normals are recomputed since the
// optimized models ship without them (see scripts/build-models.mjs).
const gltfLoader = new GLTFLoader();
const modelGeometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
function loadModelGeometry(
  model: { url: string; rotation?: [number, number, number] },
  w: number, h: number, d: number,
): Promise<THREE.BufferGeometry> {
  let pending = modelGeometryCache.get(model.url);
  if (!pending) {
    pending = gltfLoader.loadAsync(`/models/${model.url}`).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const g = mesh.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
        g.applyMatrix4(mesh.matrixWorld);
        parts.push(g);
      });
      const geo = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false)!;
      if (model.rotation) {
        const [rx, ry, rz] = model.rotation;
        geo.rotateX((rx * Math.PI) / 180);
        geo.rotateY((ry * Math.PI) / 180);
        geo.rotateZ((rz * Math.PI) / 180);
      }
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      geo.translate(-center.x, -center.y, -center.z);
      geo.scale(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1));
      geo.computeVertexNormals();
      return geo;
    });
    modelGeometryCache.set(model.url, pending);
  }
  return pending.then((geo) => geo.clone());
}
export interface SizeScene {
  setItems(items: SceneItem[]): void;
  setView(view: ViewName): void;
  setLayout(mode: LayoutMode): void;
  setInset(px: number, top?: number): void;
  setUnits(units: Units): void;
  resize(): void;
  dispose(): void;
}

// Safe-area frame math shared by both cameras. The "virtual" frame the camera is fit to should
// match what it'd be if the canvas were only the right-hand column (width - insetLeft); the
// actual rendered region is the full canvas, reached via a negative-offset setViewOffset (see
// applyViewOffset below). Exported as a pure function so it's cheaply unit-testable without
// spinning up WebGL/DOM.
export function safeAreaFrame(width: number, height: number, insetLeft: number, insetTop = 0) {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const safeW = Math.max(w - Math.max(insetLeft, 0), 1);
  const safeH = Math.max(h - Math.max(insetTop, 0), 1);
  return { width: w, height: h, safeW, safeH, aspect: safeW / safeH };
}

// Extends the rendered region beyond the safe-area virtual frame so the sidebar area is still
// rendered into (and slides under the frosted sidebar), while framing/fit stays identical to
// what it'd be if the canvas were only the safe area. `cam.aspect`/ortho left-right-top-bottom
// must already be set from `frame.aspect` before calling this; call `updateProjectionMatrix()`
// after. Exported (rather than kept as a createScene closure) so the exact wiring used in
// production — argument order and all — is directly testable.
export function applyViewOffset(
  cam: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  frame: ReturnType<typeof safeAreaFrame>,
  insetLeft: number,
  insetTop = 0,
) {
  if (insetLeft > 0 || insetTop > 0) {
    cam.setViewOffset(frame.safeW, frame.safeH, -insetLeft, -insetTop, frame.width, frame.height);
  } else {
    cam.clearViewOffset();
  }
}

// Grid geometry parameters for the current unit system and content span. Major squares are 1 cm
// (metric) or 1 in (imperial); minor lines subdivide each square in half. The half-extent (how far
// the grid reaches from center) tracks the content but is clamped so a very large object doesn't
// spawn thousands of lines. Pure — exported for direct unit testing.
export function gridSpec(units: Units, span: number) {
  const unitMM = units === 'imperial' ? 25.4 : 10;
  const minorMM = unitMM / 2;
  const majorCount = Math.min(40, Math.max(6, Math.round(Math.max(span * 0.65, 6 * unitMM) / unitMM)));
  return { unitMM, minorMM, majorCount, halfExtent: majorCount * unitMM };
}

// A ground grid centered under the content: major + minor lines that fade out radially from the
// center (per-fragment, by world distance). Dimensions are annotated per-device (see createHandle),
// not on the grid. Built fresh whenever the content bounds or unit system change.
function buildGrid(center: THREE.Vector3, units: Units, span: number): THREE.Group {
  const { unitMM, minorMM, majorCount, halfExtent } = gridSpec(units, span);
  const g = new THREE.Group();
  g.position.set(center.x, 0, center.z);

  const lineMaterial = (baseOpacity: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x8a8a8a) },
        uOpacity: { value: baseOpacity },
        uCenter: { value: new THREE.Vector2(center.x, center.z) },
        uExtent: { value: halfExtent },
      },
      vertexShader:
        'varying vec3 vWorld;\n' +
        'void main() {\n' +
        '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;\n' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
        '}',
      fragmentShader:
        'uniform vec3 uColor; uniform float uOpacity; uniform vec2 uCenter; uniform float uExtent;\n' +
        'varying vec3 vWorld;\n' +
        'void main() {\n' +
        '  float r = distance(vWorld.xz, uCenter);\n' +
        '  float a = clamp(1.0 - r / uExtent, 0.0, 1.0);\n' +
        '  gl_FragColor = vec4(uColor, a * a * uOpacity);\n' +
        '}',
    });

  // Minor lines only in imperial (half-inch); metric shows just the 1 cm major squares.
  const showMinor = units === 'imperial';
  const majorPos: number[] = [];
  const minorPos: number[] = [];
  const steps = Math.round(halfExtent / minorMM);
  for (let i = -steps; i <= steps; i++) {
    const p = i * minorMM;
    const isMajor = Math.abs(Math.round(p / unitMM) * unitMM - p) < 1e-6;
    if (!isMajor && !showMinor) continue;
    const arr = isMajor ? majorPos : minorPos;
    arr.push(-halfExtent, 0, p, halfExtent, 0, p); // parallel to X
    arr.push(p, 0, -halfExtent, p, 0, halfExtent); // parallel to Z
  }
  for (const [pos, opacity] of [[majorPos, 0.55], [minorPos, 0.22]] as const) {
    if (pos.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.add(new THREE.LineSegments(geo, lineMaterial(opacity)));
  }

  return g;
}

// Corner smoothing (Apple/Figma "squircle"): 0 = plain circular arc, ~0.6 = iOS, 1 = maximum. The
// corner keeps a REAL circular arc of the exact radius (so perceived roundedness always equals the
// radius, no scaling needed) and eases the curvature into the straight edges with cubic Béziers.
// Ported from Figma's construction — figma.com/blog/desperately-seeking-squircles, via the formulas
// in github.com/phamfoo/figma-squircle (getPathParamsForCorner).
const CORNER_SMOOTHING = 0.6;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function sampleCubic(
  out: THREE.Vector2[], p0: THREE.Vector2, c1: THREE.Vector2, c2: THREE.Vector2, p3: THREE.Vector2, seg: number,
) {
  for (let k = 1; k <= seg; k++) {
    const t = k / seg, mt = 1 - t;
    const w0 = mt * mt * mt, w1 = 3 * mt * mt * t, w2 = 3 * mt * t * t, w3 = t * t * t;
    out.push(new THREE.Vector2(
      w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
      w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y,
    ));
  }
}

// Samples the minor circular arc from s→e of radius r. Of the two possible centres, picks the one
// nearer `inside` (the rect centre) so the arc bulges outward like a corner should.
function sampleArc(out: THREE.Vector2[], s: THREE.Vector2, e: THREE.Vector2, r: number, inside: THREE.Vector2, seg: number) {
  const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2;
  const dx = e.x - s.x, dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const h = Math.sqrt(Math.max(0, r * r - (len / 2) ** 2));
  const px = -dy / len, py = dx / len; // unit perpendicular to the chord
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

// A rounded rect with Figma-style smoothed corners. Built in an SVG-like top-left/y-down frame (as
// Figma's formulas assume), sampled to points, then flipped into our centred, y-up shape space.
function roundedRectShape(a: number, b: number, r: number): THREE.Shape {
  const W = a, H = b;
  const shape = new THREE.Shape();
  const budget = Math.min(W, H) / 2; // symmetric equal corners: each gets half the shorter side
  const R = Math.min(r, budget);
  if (R <= 0) {
    shape.setFromPoints([
      new THREE.Vector2(-W / 2, -H / 2), new THREE.Vector2(W / 2, -H / 2),
      new THREE.Vector2(W / 2, H / 2), new THREE.Vector2(-W / 2, H / 2),
    ]);
    return shape;
  }
  let s = Math.min(CORNER_SMOOTHING, Math.max(0, budget / R - 1));
  const p = Math.min((1 + s) * R, budget);
  const arcMeasure = 90 * (1 - s);
  const arc = Math.sin(toRad(arcMeasure / 2)) * R * Math.SQRT2;
  const angleAlpha = (90 - arcMeasure) / 2;
  const p3p4 = R * Math.tan(toRad(angleAlpha / 2));
  const cc = p3p4 * Math.cos(toRad(45 * s));
  const cd = cc * Math.tan(toRad(45 * s));
  const cb = (p - arc - cc - cd) / 3;
  const ca = 2 * cb;

  const inside = new THREE.Vector2(W / 2, H / 2);
  const pts: THREE.Vector2[] = [];
  const pen = new THREE.Vector2(W - p, 0);
  pts.push(pen.clone());
  const at = (dx: number, dy: number) => new THREE.Vector2(pen.x + dx, pen.y + dy);
  const cubic = (d1x: number, d1y: number, d2x: number, d2y: number, ex: number, ey: number) => {
    const e = at(ex, ey);
    sampleCubic(pts, pen.clone(), at(d1x, d1y), at(d2x, d2y), e, 16);
    pen.copy(e);
  };
  const arcTo = (dx: number, dy: number) => {
    const e = at(dx, dy);
    sampleArc(pts, pen.clone(), e, R, inside, 20);
    pen.copy(e);
  };
  const lineTo = (x: number, y: number) => { pen.set(x, y); pts.push(pen.clone()); };

  cubic(ca, 0, ca + cb, 0, ca + cb + cc, cd);
  arcTo(arc, arc);
  cubic(cd, cc, cd, cb + cc, cd, ca + cb + cc);
  lineTo(W, H - p);
  cubic(0, ca, 0, ca + cb, -cd, ca + cb + cc);
  arcTo(-arc, arc);
  cubic(-cc, cd, -(cb + cc), cd, -(ca + cb + cc), cd);
  lineTo(p, H);
  cubic(-ca, 0, -(ca + cb), 0, -(ca + cb + cc), -cd);
  arcTo(-arc, -arc);
  cubic(-cd, -cc, -cd, -(cb + cc), -cd, -(ca + cb + cc));
  lineTo(0, p);
  cubic(0, -ca, 0, -(ca + cb), cd, -(ca + cb + cc));
  arcTo(arc, -arc);
  cubic(cc, -cd, cb + cc, -cd, ca + cb + cc, -cd);

  shape.setFromPoints(pts.map((v) => new THREE.Vector2(v.x - W / 2, H / 2 - v.y)));
  return shape;
}

// Mixes a colour toward white / black by `amount` (0 = unchanged, 1 = white/black).
function tintToWhite(hex: string, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), amount);
}
function tintToBlack(hex: string, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(0x000000), amount);
}

// Face-aligned text label: text rasterized (white) onto a canvas and mapped onto a plane sized in
// world mm, so it lies flat on the device's front face and rotates/foreshortens with the scene
// rather than billboarding toward the camera. White text tinted by material.color lets the colour
// tween like the mesh/edges. worldH sets the text's world-space height (mm).
const LABEL_FONT_PX = 96;
const labelFont = (weight: number) => `${weight} ${LABEL_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
const LABEL_PAD = LABEL_FONT_PX * 0.25;

// Canvas pixel size of a rendered label (text width + symmetric padding). Sets the text ctx.font so
// the returned width matches what makeLabelPlane will draw.
function measureLabelPx(ctx: CanvasRenderingContext2D, text: string, weight: number) {
  ctx.font = labelFont(weight);
  return {
    w: Math.max(1, Math.ceil(ctx.measureText(text).width + LABEL_PAD * 2)),
    h: Math.ceil(LABEL_FONT_PX + LABEL_PAD * 2),
  };
}

// Width/height ratio of a rendered string, so a caller can pick a worldH that makes the string span
// a target world width (worldW = worldH * aspect). Returns 0 if a 2d context isn't available (jsdom).
function labelAspect(text: string, weight: number): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  const { w, h } = measureLabelPx(ctx, text, weight);
  return w / h;
}

function makeLabelPlane(text: string, worldH: number, weight: number, color: THREE.ColorRepresentation): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const { w, h } = measureLabelPx(ctx, text, weight);
  canvas.width = w;
  canvas.height = h;
  ctx.font = labelFont(weight); // resizing the canvas resets the 2d context
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff'; // drawn white; the material colour tints it so it can tween/re-theme
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
  mat.color.set(color);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(worldH * (w / h), worldH), mat);
  return plane;
}

// Positions a label plane so a chosen corner sits at (x, y, z) in the mesh's local space.
// ax: 0 = plane's left edge at x, 1 = right edge. ay: 0 = top edge at y, 1 = bottom edge.
function placeCorner(plane: THREE.Mesh, x: number, y: number, z: number, ax: number, ay: number) {
  const { width, height } = (plane.geometry as THREE.PlaneGeometry).parameters;
  plane.position.set(x + (0.5 - ax) * width, y - (0.5 - ay) * height, z);
}

const labelFrontZ = (item: SceneItem) => item.d / 2 + 1.5; // sit a little off the front face
// Nothing in the scene writes depth (every material is depthWrite:false), so the translucent draw
// order is decided by renderOrder then camera distance. Labels get a small renderOrder bias over
// their device's box/screen/edges so they always draw on top of their own face — otherwise tilting
// the camera reorders them behind the 55%-opaque box and they appear to fade.
const LABEL_ORDER_BIAS = 0.5;
const labelGap = (item: SceneItem) => Math.max(item.w, item.h) * 0.03; // clearance from the box edge

// Label text is one constant world height for the whole scene (not per-item). It's sized so that a
// row of ~LABEL_CHARS characters spans the narrowest device's width — enough for the "w × h" line to
// fit on even the smallest face, and scaled up in proportion on wider devices. Recomputed whenever
// the set of devices changes. Higher = smaller text (more chars fit across the same width).
const LABEL_CHARS = 14;

// A closed foldable is two panels stacked in depth; this traces the w×h device outline at the
// mid-thickness plane (local z=0) as line segments — the clamshell "parting line" that reads as
// "this opens". Added as a child of the mesh so it inherits position/scale/fade like the edges.
function buildSeamGeometry(w: number, h: number, radius = 0): THREE.BufferGeometry {
  const pts = roundedRectShape(w, h, radius).getPoints(48);
  const positions: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
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
  const arcHalf = 0.96; // half-sweep, radians (~110° total)
  const R = 1; // arbitrary spine arc radius; shape is rescaled to w×h×d below
  const rMax = 0.5; // arbitrary cross-section scale; rescaled below too

  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const theta = (t - 0.5) * arcHalf * 2;
    const center = new THREE.Vector3(R * Math.sin(theta), R * (1 - Math.cos(theta)), 0);
    const n1 = new THREE.Vector3(-Math.sin(theta), Math.cos(theta), 0); // in-plane normal
    const n2 = new THREE.Vector3(0, 0, 1); // binormal (spine is planar in XY)
    const r = rMax * (0.30 + 0.70 * Math.sin(Math.PI * t) ** 0.6);

    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < M; j++) {
      const phi = (j / M) * Math.PI * 2;
      ring.push(center.clone()
        .addScaledVector(n1, Math.cos(phi) * r)
        .addScaledVector(n2, Math.sin(phi) * r));
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
      const a = i * M + j, b = i * M + jNext, c = (i + 1) * M + j, dIdx = (i + 1) * M + jNext;
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

function buildGeometry(item: SceneItem): THREE.BufferGeometry {
  if (item.mesh === 'banana') return buildBananaGeometry(item.w, item.h, item.d);
  if (!item.radius) return new THREE.BoxGeometry(item.w, item.h, item.d);
  // radius without an axis rounds every edge (e.g. AirPods cases). Clamp just under half the
  // smallest side so the fillets never overrun the box.
  if (!item.radiusAxis) {
    const r = Math.min(item.radius, Math.min(item.w, item.h, item.d) / 2 - 0.01);
    return new RoundedBoxGeometry(item.w, item.h, item.d, 4, r);
  }
  const opts = { bevelEnabled: false, curveSegments: 12 };
  let geo: THREE.BufferGeometry;
  if (item.radiusAxis === 'z') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.h, item.radius), { ...opts, depth: item.d });
  } else if (item.radiusAxis === 'y') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.d, item.radius), { ...opts, depth: item.h });
    geo.rotateX(-Math.PI / 2);
  } else {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.d, item.h, item.radius), { ...opts, depth: item.w });
    geo.rotateY(Math.PI / 2);
  }
  geo.center(); // extrusion spans [0, depth] along its axis; recenter like BoxGeometry
  return geo;
}

export interface LayoutTarget { pos: THREE.Vector3; renderOrder: number }

function itemKey(item: SceneItem): string {
  return `${item.name}|${item.h}x${item.w}x${item.d}|${item.mesh ?? ''}|${item.seam ? 'seam' : ''}`;
}

// Disambiguates duplicate items (same name+dims+mesh added more than once) by suffixing an
// occurrence index, so the diff in createScene never collides two distinct items onto one
// handle. Pure and side-effect-free — exported for direct unit testing.
export function computeKeys(items: SceneItem[]): string[] {
  const counts = new Map<string, number>();
  return items.map((item) => {
    const base = itemKey(item);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
}

const volumeOf = (i: SceneItem) => i.h * i.w * i.d;
const minDimOf = (i: SceneItem) => Math.min(i.h, i.w, i.d);
const MAX_STACK_GAP = 10; // mm (1 cm) — ceiling on the depth gap between stacked items

// Items are sorted by volume. Row = sequential along +x smallest→largest, all front-aligned to the
// z=0 plane and extending back (nearest face at z=0, so the ruler along the front reads cleanly).
// Stack = sequential along +z with the LARGEST at the back (z=0) and the smallest at the front
// (nearest the camera), so the size progression reads front-to-back small→large and the largest
// doesn't occlude the rest; stacked items share a bottom-left corner (left edge at x=0) so their
// origins line up. Either way each item sits with its bottom on the ground (y=h/2) and the
// gap between two neighbours equals the smaller of their smallest dimensions. Stack renderOrder increases along z
// (nearer items drawn later) so the translucent items blend front-to-back correctly (paired with
// depthWrite:false on the transparent materials in createScene). Pure — exported for direct testing.
export function computeTargets(items: SceneItem[], keys: string[], mode: LayoutMode): Map<string, LayoutTarget> {
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
      targets.set(key, { pos: new THREE.Vector3(item.w / 2, item.h / 2, z + item.d / 2), renderOrder: idx });
      z += item.d + Math.min(gapBetween(seq, idx), MAX_STACK_GAP); // cap the stack gap at 1 cm
    });
  } else {
    let x = 0;
    order.forEach(({ item, key }, idx) => {
      targets.set(key, { pos: new THREE.Vector3(x + item.w / 2, item.h / 2, -item.d / 2), renderOrder: 0 });
      x += item.w + gapBetween(order, idx);
    });
  }
  return targets;
}

// Builds a Box3 from TARGET positions/dims (not the live, possibly mid-tween, group) — used both
// for the camera refit and the grid recompute. Pure — exported for direct unit testing.
export function computeTargetBounds(
  items: SceneItem[],
  keys: string[],
  targets: Map<string, LayoutTarget>,
): THREE.Box3 {
  if (items.length === 0) {
    return new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));
  }
  const box = new THREE.Box3();
  items.forEach((item, i) => {
    const t = targets.get(keys[i]!)!;
    const half = new THREE.Vector3(item.w / 2, item.h / 2, item.d / 2);
    box.expandByPoint(t.pos.clone().sub(half));
    box.expandByPoint(t.pos.clone().add(half));
    if (item.screen) box.expandByPoint(t.pos.clone().add(new THREE.Vector3(0, 0, item.d / 2 + 0.5)));
  });
  return box;
}

export function createScene(container: HTMLElement): SizeScene {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  const persp = new THREE.PerspectiveCamera(40, 1, 1, 1e6);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e6);
  let camera: THREE.Camera = persp;
  let view: ViewName = '3d';
  let inset = 0; // left inset (px) reserved for the floating sidebar; 0 on mobile
  let insetTop = 0; // top inset (px) reserved for the overlapping segmented control; used on mobile

  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener('change', requestRender);

  // Don't let the canvas steal wheel/trackpad scroll unless the page is scrolled to the very top:
  // once the user has scrolled down, wheel events pass through to scroll the page instead of zooming.
  // A capture-phase listener on the container runs before OrbitControls' own (canvas) wheel handler,
  // so stopping propagation there both bypasses the zoom and leaves the default page scroll intact.
  function onContainerWheel(e: WheelEvent) {
    const scrolled = window.scrollY || document.documentElement.scrollTop || 0;
    if (scrolled > 0) e.stopPropagation();
  }
  container.addEventListener('wheel', onContainerWheel, { capture: true, passive: true });

  // Honor prefers-reduced-motion: collapse camera/item animation durations to ~instant (guarded for
  // jsdom, which lacks matchMedia). Read once at construction — the setting rarely toggles mid-visit.
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Follows the app's theme (Tailwind's default dark: = prefers-color-scheme). The screen face tints
  // toward white in light mode (paler than the body) and toward black in dark mode (darker than it),
  // so it always reads as a distinct panel against the background. Live-updated on theme change.
  const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let darkMode = darkQuery?.matches ?? false;
  const screenColor = (hex: string) => darkMode ? tintToBlack(hex, SCREEN_TINT_DARK) : tintToWhite(hex, SCREEN_TINT_LIGHT);
  // Label text ink, theme-aware: dark mode keeps the name in the device colour and the dims white
  // (readable on the dark face); light mode uses the device colour darkened for both, so they read
  // against the pale face/background. Both live-update on a theme change.
  const LABEL_DARKEN = 0.4;
  const nameInk = (hex: string) => darkMode ? new THREE.Color(hex) : tintToBlack(hex, LABEL_DARKEN);
  const dimInk = (hex: string) => darkMode ? new THREE.Color(0xffffff) : tintToBlack(hex, LABEL_DARKEN);

  // --- view transition state ---
  interface CameraPose { position: THREE.Vector3; quaternion: THREE.Quaternion; projectionMatrix: THREE.Matrix4 }
  interface ViewEndState extends CameraPose { controlsTarget: THREE.Vector3 }
  const TRANSITION_MS = reducedMotion ? 0 : 450;
  const scratchProjection = new THREE.Matrix4();
  let firstView = true; // initial mount jumps instead of animating
  let animating = false;
  let animRaf = 0;
  let animStart = 0;
  let animFromView: ViewName = '3d';
  let animToView: ViewName = '3d';
  let animFrom: CameraPose | null = null;
  let animTo: ViewEndState | null = null;

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  function lerpMatrix4(target: THREE.Matrix4, a: THREE.Matrix4, b: THREE.Matrix4, t: number) {
    const ae = a.elements, be = b.elements, te = target.elements;
    for (let i = 0; i < 16; i++) te[i] = (ae[i] ?? 0) + ((be[i] ?? 0) - (ae[i] ?? 0)) * t;
  }

  const group = new THREE.Group();
  scene.add(group);
  let grid: THREE.Group | null = null;
  let units: Units = 'metric';
  let bounds = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));
  // Width/height ratio of a LABEL_CHARS-long dim string; labelWorldH = minDeviceWidth / this makes
  // that many characters span the narrowest device. Measured once (fallback for jsdom in tests).
  const labelRowAspect = labelAspect('0'.repeat(LABEL_CHARS), 500) || 3.65;
  let labelWorldH = 20; // recomputed from the device set in applyDiff

  let renderQueued = false;
  let rafHandle = 0;
  let disposed = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    rafHandle = requestAnimationFrame(() => {
      if (disposed) return;
      renderQueued = false;
      if (view === '3d') controls.update();
      updateGroundVisibility(view);
      renderer.render(scene, camera);
    });
  }

  // The grid is hidden in the flat front/side views, and also whenever the camera drops below the
  // ground plane (orbiting underneath) so its underside isn't shown. Re-evaluated every frame since
  // it depends on the live camera position during an orbit.
  function updateGroundVisibility(effectiveView: ViewName) {
    if (!grid) return;
    const inView = effectiveView !== 'front' && effectiveView !== 'side';
    grid.visible = inView && camera.position.y >= grid.position.y;
  }

  // Meshes include label planes, whose material carries a CanvasTexture map that also needs freeing.
  function disposeObject(o: THREE.Object3D) {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mat = o.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    }
  }

  function clearGroup() {
    group.traverse(disposeObject);
    group.clear();
  }

  function removeGrid() {
    if (!grid) return;
    grid.traverse(disposeObject);
    scene.remove(grid);
    grid = null;
  }

  // Rebuilds the ground grid for the current bounds + unit system, preserving current visibility.
  function rebuildGrid() {
    removeGrid();
    const c = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1);
    grid = buildGrid(c, units, span);
    // Devices sit on y=0 with the name label ("title") just below it; drop the ground plane to twice
    // the device-bottom→title distance so the title sits midway between the devices and the floor.
    const maxGap = Math.max(0, ...lastItems.map(labelGap));
    const titleDist = maxGap + labelWorldH / 2; // bottom (y=0) → title centre
    grid.position.y = -2 * titleDist;
    scene.add(grid);
    updateGroundVisibility(view);
  }

  // --- item tween ticker ---------------------------------------------------------------
  // A single rAF loop drives every in-flight item tween (position/color/scale/opacity). Tweens
  // are keyed by an id so re-triggering the same kind of tween on the same item (e.g. a second
  // setItems() call arriving mid-animation) *retargets* it — capturing the live current value as
  // the new "from" — rather than stacking a competing animation on top.
  const TWEEN_MS = reducedMotion ? 0 : 350;
  interface ActiveTween { id: string; start: number; dur: number; update: (k: number) => void; done?: () => void }
  let activeTweens: ActiveTween[] = [];
  let tweenRaf = 0;

  function addTween(id: string, dur: number, update: (k: number) => void, done?: () => void) {
    activeTweens = activeTweens.filter((t) => t.id !== id);
    activeTweens.push({ id, start: performance.now(), dur, update, done });
    if (!tweenRaf) tweenRaf = requestAnimationFrame(tickTweens);
  }

  // Drops every tween belonging to a given item (id prefix `${key}:`) without invoking their
  // `done` callbacks — used right before disposal so nothing keeps mutating a mesh that's about
  // to be (or just got) removed from the scene and dispose()d.
  function cancelTweensFor(keyId: string) {
    const prefix = `${keyId}:`;
    activeTweens = activeTweens.filter((t) => !t.id.startsWith(prefix));
  }

  function tickTweens(now: number) {
    tweenRaf = 0;
    if (disposed) return;
    const finished: ActiveTween[] = [];
    activeTweens = activeTweens.filter((t) => {
      const k = t.dur > 0 ? Math.min(1, (now - t.start) / t.dur) : 1; // dur 0 (reduced motion) → instant
      t.update(easeInOutCubic(k));
      if (k >= 1) { finished.push(t); return false; }
      return true;
    });
    requestRender();
    for (const t of finished) t.done?.();
    if (activeTweens.length) tweenRaf = requestAnimationFrame(tickTweens);
  }

  // --- item handles ---------------------------------------------------------------------
  // mesh is the sole child of `group`; edges/screenMesh/labels all hang off mesh as children (in
  // its local, geometry-centered space) so a single mesh.position/scale tween carries all of them
  // along for free. clearGroup()'s traverse() still finds and disposes every descendant.
  const MESH_OPACITY = 0.65; // MeshLambertMaterial "solid" items
  const WIREFRAME_OPACITY = 1; // banana/wireframe mesh — transparent is turned on unconditionally
  // (rather than only while fading) so an opacity tween works uniformly across mesh kinds; at
  // opacity 1 a transparent material renders identically to an opaque one.
  const SCREEN_OPACITY = 1; // opaque, so the tinted screen reads cleanly against the body
  const SCREEN_TINT_LIGHT = 0.6; // mix toward white in light mode → paler than the body
  const SCREEN_TINT_DARK = 0.8; // mix toward black in dark mode → clearly darker than the body

  interface ItemHandle {
    keyId: string;
    mesh: THREE.Mesh;
    edges: THREE.LineSegments | null;
    seam: THREE.LineSegments | null;
    screenMesh: THREE.Mesh | null;
    nameLabel: THREE.Mesh;   // centered below the box (device colour)
    widthLabel: THREE.Mesh;  // bottom-left, on the face (white, unitless)
    sepLabel: THREE.Mesh;    // "×" centered between width and height (white)
    heightLabel: THREE.Mesh; // bottom-right, on the face (white, unitless)
    item: SceneItem;
    meshBaseOpacity: number;
    fading: boolean; // true while a fade-out (pending removal) is in flight
  }
  type Target = LayoutTarget;

  const handles = new Map<string, ItemHandle>();
  let lastItems: SceneItem[] = [];
  let layoutMode: LayoutMode = 'row';
  let firstItems = true;

  function labelsOf(handle: ItemHandle): THREE.Mesh[] {
    return [handle.nameLabel, handle.widthLabel, handle.sepLabel, handle.heightLabel];
  }

  function applyOpacityFactor(handle: ItemHandle, factor: number) {
    (handle.mesh.material as THREE.Material).opacity = handle.meshBaseOpacity * factor;
    if (handle.edges) (handle.edges.material as THREE.Material).opacity = factor;
    if (handle.seam) (handle.seam.material as THREE.Material).opacity = factor;
    if (handle.screenMesh) (handle.screenMesh.material as THREE.Material).opacity = SCREEN_OPACITY * factor;
    for (const l of labelsOf(handle)) (l.material as THREE.Material).opacity = factor;
  }

  function currentOpacityFactor(handle: ItemHandle): number {
    return (handle.mesh.material as THREE.Material).opacity / (handle.meshBaseOpacity || 1);
  }

  // Tweens opacity from wherever it currently is (live value, so a fade interrupted mid-flight —
  // e.g. an item removed then re-added before its fade-out finished — reverses smoothly instead
  // of snapping back to full/zero first).
  function tweenFadeTo(handle: ItemHandle, targetFactor: number, done?: () => void) {
    const from = currentOpacityFactor(handle);
    if (Math.abs(from - targetFactor) < 0.001) { done?.(); return; } // already there — still finish
    addTween(`${handle.keyId}:fade`, TWEEN_MS, (k) => {
      applyOpacityFactor(handle, from + (targetFactor - from) * k);
    }, done);
  }

  function tweenPosition(handle: ItemHandle, target: THREE.Vector3) {
    const from = handle.mesh.position.clone();
    if (from.equals(target)) return;
    addTween(`${handle.keyId}:pos`, TWEEN_MS, (k) => {
      handle.mesh.position.lerpVectors(from, target, k);
    });
  }

  function tweenColor(handle: ItemHandle, fromColorHex: string, toColorHex: string) {
    if (fromColorHex === toColorHex) return;
    const meshMat = handle.mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
    const fromMesh = meshMat.color.clone();
    const toMesh = new THREE.Color(toColorHex);
    const edgesMat = handle.edges?.material as THREE.LineBasicMaterial | undefined;
    const fromEdges = edgesMat?.color.clone();
    const toEdges = new THREE.Color(toColorHex);
    const seamMat = handle.seam?.material as THREE.LineBasicMaterial | undefined;
    const fromSeam = seamMat?.color.clone();
    const screenMat = handle.screenMesh?.material as THREE.MeshBasicMaterial | undefined;
    const fromScreen = screenMat?.color.clone();
    const toScreen = screenColor(toColorHex); // matches the current-theme screen face
    // Labels are white text tinted by material colour, so they tween like the mesh/edges. Name uses
    // nameInk, the three dim labels use dimInk (both theme-aware).
    const nameMat = handle.nameLabel.material as THREE.MeshBasicMaterial;
    const fromName = nameMat.color.clone();
    const toName = nameInk(toColorHex);
    const dimMats = [handle.widthLabel, handle.sepLabel, handle.heightLabel].map((l) => l.material as THREE.MeshBasicMaterial);
    const fromDims = dimMats.map((m) => m.color.clone());
    const toDim = dimInk(toColorHex);
    addTween(`${handle.keyId}:color`, TWEEN_MS, (k) => {
      meshMat.color.copy(fromMesh).lerp(toMesh, k);
      if (edgesMat && fromEdges) edgesMat.color.copy(fromEdges).lerp(toEdges, k);
      if (seamMat && fromSeam) seamMat.color.copy(fromSeam).lerp(toEdges, k);
      if (screenMat && fromScreen) screenMat.color.copy(fromScreen).lerp(toScreen, k);
      nameMat.color.copy(fromName).lerp(toName, k);
      dimMats.forEach((m, i) => m.color.copy(fromDims[i]!).lerp(toDim, k));
    });
  }

  function disposeLabel(label: THREE.Mesh) {
    label.geometry.dispose();
    const mat = label.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    label.removeFromParent();
  }

  function disposeHandle(handle: ItemHandle) {
    cancelTweensFor(handle.keyId);
    handle.mesh.geometry.dispose();
    (handle.mesh.material as THREE.Material).dispose();
    if (handle.edges) { handle.edges.geometry.dispose(); (handle.edges.material as THREE.Material).dispose(); }
    if (handle.seam) { handle.seam.geometry.dispose(); (handle.seam.material as THREE.Material).dispose(); }
    if (handle.screenMesh) { handle.screenMesh.geometry.dispose(); (handle.screenMesh.material as THREE.Material).dispose(); }
    for (const l of labelsOf(handle)) disposeLabel(l);
    handle.mesh.removeFromParent();
  }

  // Builds one dimension label (width or height) for the current units, inset just inside the front
  // face at a bottom corner: width bottom-left, height bottom-right.
  function makeDimLabel(item: SceneItem, which: 'w' | 'h'): THREE.Mesh {
    const mm = which === 'w' ? item.w : item.h;
    const inset = labelGap(item);
    const plane = makeLabelPlane(formatLengthValue(mm, units), labelWorldH, 500, dimInk(item.color));
    if (which === 'w') placeCorner(plane, -item.w / 2 + inset, -item.h / 2 + inset, labelFrontZ(item), 0, 1);
    else placeCorner(plane, item.w / 2 - inset, -item.h / 2 + inset, labelFrontZ(item), 1, 1);
    return plane;
  }

  // Builds the three labels for an item (name centered below; width/height in the bottom face
  // corners), parents them to the mesh, and biases their render order so they draw over the face.
  // Colours come from nameInk/dimInk (theme-aware). Reused on create and on rebuilds.
  function buildLabels(mesh: THREE.Mesh, item: SceneItem, renderOrder: number) {
    const nameLabel = makeLabelPlane(item.name, labelWorldH, 600, nameInk(item.color));
    placeCorner(nameLabel, 0, -item.h / 2 - labelGap(item), labelFrontZ(item), 0.5, 0);
    const widthLabel = makeDimLabel(item, 'w');
    const heightLabel = makeDimLabel(item, 'h');
    // "×" centered along the bottom between the width and height numbers → reads "71.9 × 150".
    const sepLabel = makeLabelPlane('×', labelWorldH, 500, dimInk(item.color));
    placeCorner(sepLabel, 0, -item.h / 2 + labelGap(item), labelFrontZ(item), 0.5, 1);
    for (const l of [nameLabel, widthLabel, sepLabel, heightLabel]) {
      l.renderOrder = renderOrder + LABEL_ORDER_BIAS;
      mesh.add(l);
    }
    return { nameLabel, widthLabel, sepLabel, heightLabel };
  }

  // Rebuilds a handle's three labels in place (after a unit switch or a content-size change that
  // moved labelWorldH), preserving the item's current fade opacity.
  function rebuildLabels(handle: ItemHandle) {
    const factor = currentOpacityFactor(handle);
    for (const l of labelsOf(handle)) disposeLabel(l);
    const built = buildLabels(handle.mesh, handle.item, handle.mesh.renderOrder);
    Object.assign(handle, built);
    for (const l of labelsOf(handle)) (l.material as THREE.Material).opacity = factor;
  }

  function createHandle(item: SceneItem, keyId: string, target: Target): ItemHandle {
    const isModel = item.model3d != null;
    // Model items start as a box placeholder (fit to w×h×d) and swap to the loaded geometry when
    // it arrives, keeping the box as the fallback if the load fails.
    const geo = isModel ? new THREE.BoxGeometry(item.w, item.h, item.d) : buildGeometry(item);
    const isWireframe = item.mesh != null;
    const meshBaseOpacity = isWireframe ? WIREFRAME_OPACITY : MESH_OPACITY;
    // depthWrite: false — renderOrder alone only sequences the transparent-object render queue; the
    // depth *test* still runs against whatever's already in the depth buffer, so without this a
    // nearer item drawn first would occlude one behind it in stack mode, where items line up in
    // depth and overlap heavily on screen (visible head-on in front/side views). With depthWrite
    // off, translucent items never write depth, so renderOrder is the sole arbiter of draw/blend
    // order. In row mode items don't overlap on screen, so this is inert there; the opaque grid
    // still writes/tests depth normally since it's a separate (non-transparent) draw.
    const mat = isWireframe
      ? new THREE.MeshBasicMaterial({ color: item.color, wireframe: true, transparent: true, opacity: 0, depthWrite: false })
      : new THREE.MeshLambertMaterial({ color: item.color, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(target.pos);
    mesh.renderOrder = target.renderOrder;
    mesh.scale.setScalar(0.01);

    // Per-device annotations lying on the front face (local +z, the world z=0 plane the devices are
    // front-aligned to) so they foreshorten and rotate with the box rather than billboarding.
    const { nameLabel, widthLabel, sepLabel, heightLabel } = buildLabels(mesh, item, target.renderOrder);

    let edges: THREE.LineSegments | null = null;
    if (!isWireframe && !isModel) {
      edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color: item.color, transparent: true, opacity: 0, depthWrite: false }),
      );
      edges.renderOrder = target.renderOrder;
      mesh.add(edges);
    }

    let seam: THREE.LineSegments | null = null;
    if (item.seam && !isWireframe && !isModel) {
      const seamRadius = item.radiusAxis === 'z' ? (item.radius ?? 0) : 0;
      seam = new THREE.LineSegments(
        buildSeamGeometry(item.w, item.h, seamRadius),
        new THREE.LineBasicMaterial({ color: item.color, transparent: true, opacity: 0, depthWrite: false }),
      );
      seam.renderOrder = target.renderOrder;
      mesh.add(seam); // child at local z=0 — the mid-thickness plane
    }

    let screenMesh: THREE.Mesh | null = null;
    if (item.screen && !isModel) {
      // Concentric corners: screen radius = body radius − bezel inset, so the bezel gap stays
      // uniform through the corner (mirrors the body's rounding). Floored at the device's own
      // stored screen radius so devices with a small/absent body radius don't regress to square.
      const inset = (item.w - item.screen.w) / 2;
      const screenR = Math.max(item.screen.radius ?? 0, item.radius ? item.radius - inset : 0);
      const screenGeo = new THREE.ShapeGeometry(roundedRectShape(item.screen.w, item.screen.h, screenR));
      const screenMat = new THREE.MeshBasicMaterial({
        color: screenColor(item.color), // paler than the body (light mode) / darker (dark mode)
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      screenMesh = new THREE.Mesh(screenGeo, screenMat);
      screenMesh.position.set(0, 0, item.d / 2 + 0.4); // local offset — moves with mesh
      screenMesh.renderOrder = target.renderOrder;
      mesh.add(screenMesh);
    }

    group.add(mesh);

    if (isModel) {
      // Swap the placeholder box for the real geometry once loaded; skip if the handle was
      // removed meanwhile (mesh detached), and keep the box on failure.
      loadModelGeometry(item.model3d!, item.w, item.h, item.d)
        .then((g) => {
          if (!mesh.parent) { g.dispose(); return; }
          mesh.geometry.dispose();
          mesh.geometry = g;
          requestRender();
        })
        .catch(() => { /* fall back to the box placeholder */ });
    }

    return { keyId, mesh, edges, seam, screenMesh, nameLabel, widthLabel, sepLabel, heightLabel, item, meshBaseOpacity, fading: false };
  }

  function applyDiff(items: SceneItem[]) {
    lastItems = items;
    const keys = computeKeys(items);
    const targets = computeTargets(items, keys, layoutMode);
    bounds = computeTargetBounds(items, keys, targets);
    // Label height is derived from the narrowest device (so ~LABEL_CHARS chars span its width);
    // recompute before building handles so new labels get the right size and existing ones rebuild
    // if it changed.
    const prevLabelH = labelWorldH;
    const minWidth = items.length ? Math.min(...items.map((i) => i.w)) : 100;
    labelWorldH = minWidth / labelRowAspect;
    const labelSizeChanged = Math.abs(labelWorldH - prevLabelH) > 1e-6;
    const newKeySet = new Set(keys);

    // Removals: fade out anything no longer present (unless it's already fading). Collect first —
    // tweenFadeTo can invoke its done callback synchronously (when the item is already invisible,
    // e.g. added then removed within the same tick), which deletes from `handles`.
    const removing = [...handles].filter(([key, h]) => !newKeySet.has(key) && !h.fading);
    for (const [key, handle] of removing) {
      handle.fading = true;
      tweenFadeTo(handle, 0, () => {
        disposeHandle(handle);
        handles.delete(key);
      });
    }

    // Kept / new / resurrected (an item removed then re-added before its fade-out finished).
    items.forEach((item, i) => {
      const key = keys[i]!;
      const target = targets.get(key)!;
      const existing = handles.get(key);
      if (!existing) {
        const handle = createHandle(item, key, target);
        handles.set(key, handle);
        if (firstItems) {
          // Initial paint is instant (like the camera's firstItems/firstView jump) — no fade/scale
          // tween, so the meshes are visible on the very first frame regardless of when the scene
          // (now lazy-loaded) mounts relative to the render loop.
          applyOpacityFactor(handle, 1);
          handle.mesh.scale.setScalar(1);
        } else {
          tweenFadeTo(handle, 1);
          addTween(`${key}:scale`, TWEEN_MS, (k) => handle.mesh.scale.setScalar(0.01 + 0.99 * k));
        }
        return;
      }
      existing.fading = false;
      tweenPosition(existing, target.pos);
      tweenColor(existing, existing.item.color, item.color);
      existing.mesh.renderOrder = target.renderOrder;
      if (existing.edges) existing.edges.renderOrder = target.renderOrder;
      if (existing.seam) existing.seam.renderOrder = target.renderOrder;
      if (existing.screenMesh) existing.screenMesh.renderOrder = target.renderOrder;
      for (const l of labelsOf(existing)) l.renderOrder = target.renderOrder + LABEL_ORDER_BIAS;
      existing.item = item;
      if (labelSizeChanged) rebuildLabels(existing); // fit changed → resize labels to stay ~13px
      if (currentOpacityFactor(existing) < 0.999) tweenFadeTo(existing, 1);
    });

    rebuildGrid();

    // The very first item placement (initial mount) jumps instantly, like setView's firstView
    // guard; every subsequent change (add/remove/recolor/layout switch) animates the refit.
    if (firstItems) {
      firstItems = false;
      applyInstant(view);
    } else {
      beginTransition(view);
    }
  }

  function setLayout(mode: LayoutMode) {
    if (layoutMode === mode) return;
    layoutMode = mode;
    applyDiff(lastItems);
  }

  // Computes the target camera pose for `next` (mutating the real persp/ortho camera objects,
  // exactly as the old instant setView did) and returns cloned pose data safe to keep around
  // while persp continues to be repurposed as the in-flight transition camera.
  function computeEnd(next: ViewName): ViewEndState {
    const c = bounds.getCenter(new THREE.Vector3());
    const s = bounds.getSize(new THREE.Vector3());
    const { width, height } = container.getBoundingClientRect();
    const frame = safeAreaFrame(width, height, inset, insetTop);
    const aspect = frame.aspect;
    let targetCam: THREE.Camera;
    if (next === '3d') {
      persp.aspect = aspect;
      const radius = Math.max(s.x, s.y, s.z, 1);
      persp.position.set(c.x + radius * 1.2, c.y + radius * 0.9, c.z + radius * 1.6);
      persp.lookAt(c);
      applyViewOffset(persp, frame, inset, insetTop);
      persp.updateProjectionMatrix();
      targetCam = persp;
    } else {
      const fit = (fw: number, fh: number) => {
        const m = 1.1;
        const half = Math.max(fw / aspect, fh) * m / 2 * Math.max(aspect, 1);
        ortho.left = -half * (aspect >= 1 ? 1 : aspect);
        ortho.right = -ortho.left;
        ortho.top = ortho.right / aspect;
        ortho.bottom = -ortho.top;
      };
      const far = Math.max(s.x, s.y, s.z) * 4 + 1000;
      // Front view is fit tightly to the geometry; the name label sits just below each box, so leave
      // room for its overhang (label height + gap) or it clips at the bottom edge.
      const labelPad = 2 * (labelWorldH + Math.max(0, ...lastItems.map((i) => labelGap(i))));
      if (next === 'front') { fit(s.x + labelPad, s.y + labelPad); ortho.position.set(c.x, c.y, c.z + far / 2); }
      if (next === 'side') { fit(s.z, s.y); ortho.position.set(c.x + far / 2, c.y, c.z); }
      if (next === 'top') { fit(s.x, s.z); ortho.position.set(c.x, c.y + far / 2, c.z); }
      ortho.lookAt(c);
      applyViewOffset(ortho, frame, inset, insetTop);
      ortho.updateProjectionMatrix();
      targetCam = ortho;
    }
    return {
      position: targetCam.position.clone(),
      quaternion: targetCam.quaternion.clone(),
      projectionMatrix: targetCam.projectionMatrix.clone(),
      controlsTarget: c.clone(),
    };
  }

  // Current pose to transition *from*: the live interpolated persp pose mid-flight, or the
  // settled active camera's pose otherwise.
  function currentPose(): CameraPose {
    const src: THREE.Camera = animating ? persp : camera;
    return {
      position: src.position.clone(),
      quaternion: src.quaternion.clone(),
      projectionMatrix: src.projectionMatrix.clone(),
    };
  }

  function cancelAnimation() {
    if (animRaf) cancelAnimationFrame(animRaf);
    animRaf = 0;
    animating = false;
    animFrom = null;
    animTo = null;
  }

  // Instant camera placement — no animation. Used for the very first setView after mount,
  // the setItems refit, and resize (which cancels any in-flight transition and jumps).
  function applyInstant(next: ViewName) {
    cancelAnimation();
    const end = computeEnd(next);
    view = next;
    if (next === '3d') {
      camera = persp;
      controls.target.copy(end.controlsTarget);
      controls.enabled = true;
    } else {
      camera = ortho;
      controls.enabled = false;
    }
    updateGroundVisibility(next);
    requestRender();
  }

  function finalizeTransition() {
    const next = animToView;
    const end = animTo!;
    animFrom = null;
    animTo = null;
    animRaf = 0;
    animating = false;
    if (next === '3d') {
      camera = persp;
      persp.position.copy(end.position);
      persp.quaternion.copy(end.quaternion);
      const { width, height } = container.getBoundingClientRect();
      const frame = safeAreaFrame(width, height, inset, insetTop);
      persp.aspect = frame.aspect;
      applyViewOffset(persp, frame, inset, insetTop);
      persp.updateProjectionMatrix(); // restore auto (non-lerped) projection
      controls.target.copy(end.controlsTarget);
      controls.enabled = true;
    } else {
      camera = ortho; // ortho's real position/quaternion/projectionMatrix were set by computeEnd
      controls.enabled = false;
    }
    updateGroundVisibility(next);
    requestRender();
  }

  function tick(now: number) {
    if (disposed || !animating || !animFrom || !animTo) return;
    const t = TRANSITION_MS > 0 ? Math.min(1, (now - animStart) / TRANSITION_MS) : 1; // reduced motion → jump
    const e = easeInOutCubic(t);
    persp.position.lerpVectors(animFrom.position, animTo.position, e);
    persp.quaternion.slerpQuaternions(animFrom.quaternion, animTo.quaternion, e);
    lerpMatrix4(scratchProjection, animFrom.projectionMatrix, animTo.projectionMatrix, e);
    persp.projectionMatrix.copy(scratchProjection);
    persp.projectionMatrixInverse.copy(persp.projectionMatrix).invert();
    camera = persp;
    updateGroundVisibility(t >= 0.5 ? animToView : animFromView);
    renderer.render(scene, camera);
    if (t >= 1) {
      finalizeTransition();
    } else {
      animRaf = requestAnimationFrame(tick);
    }
  }

  function beginTransition(next: ViewName) {
    const from = currentPose();
    const fromView = view;
    cancelAnimation();
    const end = computeEnd(next);
    view = next;
    animFromView = fromView;
    animToView = next;
    animFrom = from;
    animTo = end;
    animStart = performance.now();
    animating = true;
    controls.enabled = false;
    camera = persp;
    animRaf = requestAnimationFrame(tick);
  }

  function setView(next: ViewName) {
    if (firstView) {
      firstView = false;
      applyInstant(next);
      return;
    }
    beginTransition(next);
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height);
    // Cancel-and-jump: a resize mid-flight recomputes the end state for the new size and
    // snaps to it rather than continuing to animate through a resized viewport.
    applyInstant(view);
  }

  // Cancel-and-jump, same as resize(): an inset change mid-transition recomputes the end
  // state for the new safe area and snaps to it rather than animating through a moving frame.
  function setInset(px: number, top = 0) {
    const nextLeft = Math.max(0, px);
    const nextTop = Math.max(0, top);
    if (nextLeft === inset && nextTop === insetTop) return;
    inset = nextLeft;
    insetTop = nextTop;
    applyInstant(view);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Re-colour every live screen face and label when the OS/app theme flips (no rebuild — just colour).
  function onThemeChange(e: MediaQueryListEvent) {
    darkMode = e.matches;
    for (const h of handles.values()) {
      if (h.screenMesh) (h.screenMesh.material as THREE.MeshBasicMaterial).color.copy(screenColor(h.item.color));
      (h.nameLabel.material as THREE.MeshBasicMaterial).color.copy(nameInk(h.item.color));
      for (const l of [h.widthLabel, h.sepLabel, h.heightLabel]) (l.material as THREE.MeshBasicMaterial).color.copy(dimInk(h.item.color));
    }
    requestRender();
  }
  darkQuery?.addEventListener('change', onThemeChange);

  return {
    setItems: (items) => { applyDiff(items); },
    setView,
    setLayout,
    setInset,
    setUnits(next: Units) {
      if (next === units) return;
      units = next;
      // Label text is baked into a texture, so a unit switch rebuilds each handle's labels in place.
      for (const h of handles.values()) rebuildLabels(h);
      rebuildGrid();
      requestRender();
    },
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      cancelAnimationFrame(animRaf);
      cancelAnimationFrame(tweenRaf);
      activeTweens = [];
      handles.clear();
      ro.disconnect();
      darkQuery?.removeEventListener('change', onThemeChange);
      container.removeEventListener('wheel', onContainerWheel, { capture: true });
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      clearGroup();
      removeGrid();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
