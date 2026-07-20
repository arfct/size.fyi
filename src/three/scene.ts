import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LayoutMode, Units } from '../shared/types';

export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem {
  name: string; h: number; w: number; d: number; color: string;
  radius?: number; radiusAxis?: 'x' | 'y' | 'z';
  screen?: { h: number; w: number; radius?: number };
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
// center (per-fragment, by world distance) plus numeric tick labels along the +x/+z axes. Built
// fresh whenever the content bounds or unit system change.
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

  // Bare numeric labels (no unit): metric shows the distance in mm, imperial in whole inches.
  const stride = Math.max(1, Math.ceil(majorCount / 8));
  for (let k = stride; k <= majorCount; k += stride) {
    const dist = k * unitMM;
    const opacity = Math.max(0, 1 - dist / halfExtent) ** 2 * 0.9;
    if (opacity < 0.05) continue;
    const labelValue = units === 'imperial' ? k : Math.round(dist);
    for (const [lx, lz] of [[dist, 0], [0, dist]] as const) {
      const el = document.createElement('div');
      el.textContent = `${labelValue}`;
      el.style.cssText =
        `font:11px ui-sans-serif,system-ui;color:#8a8a8a;pointer-events:none;white-space:nowrap;opacity:${opacity.toFixed(3)}`;
      const label = new CSS2DObject(el);
      label.position.set(lx, 0, lz);
      g.add(label);
    }
  }
  return g;
}

function roundedRectShape(a: number, b: number, r: number): THREE.Shape {
  const hx = a / 2, hy = b / 2, rr = Math.min(r, hx, hy);
  const s = new THREE.Shape();
  s.moveTo(-hx + rr, -hy);
  s.lineTo(hx - rr, -hy); s.absarc(hx - rr, -hy + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(hx, hy - rr);  s.absarc(hx - rr, hy - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-hx + rr, hy); s.absarc(-hx + rr, hy - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hy + rr); s.absarc(-hx + rr, -hy + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

function darken(hex: string, amount: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(1 - amount);
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
  if (!item.radius || !item.radiusAxis)
    return new THREE.BoxGeometry(item.w, item.h, item.d);
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
  return `${item.name}|${item.h}x${item.w}x${item.d}|${item.mesh ?? ''}`;
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

// Items are sorted by volume. Row = sequential along +x smallest→largest (all at z=0). Stack =
// sequential along +z with the LARGEST at the back (z=0) and the smallest at the front (nearest the
// camera), so the size progression reads front-to-back small→large and the largest doesn't occlude
// the rest. Either way each item sits with its bottom on the ground (y=h/2) and the gap between two
// neighbours equals the smaller of their smallest dimensions. Stack renderOrder increases along z
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
      targets.set(key, { pos: new THREE.Vector3(0, item.h / 2, z + item.d / 2), renderOrder: idx });
      z += item.d + gapBetween(seq, idx);
    });
  } else {
    let x = 0;
    order.forEach(({ item, key }, idx) => {
      targets.set(key, { pos: new THREE.Vector3(x + item.w / 2, item.h / 2, 0), renderOrder: 0 });
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

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  container.appendChild(labelRenderer.domElement);

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
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // --- view transition state ---
  interface CameraPose { position: THREE.Vector3; quaternion: THREE.Quaternion; projectionMatrix: THREE.Matrix4 }
  interface ViewEndState extends CameraPose { controlsTarget: THREE.Vector3 }
  const TRANSITION_MS = 450;
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
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    });
  }

  function clearGroup() {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      if (o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    group.clear();
  }

  function removeGrid() {
    if (!grid) return;
    grid.traverse((o) => {
      if (o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      if (o instanceof CSS2DObject) o.element.remove();
    });
    scene.remove(grid);
    grid = null;
  }

  // Rebuilds the ground grid for the current bounds + unit system, preserving current visibility.
  function rebuildGrid() {
    removeGrid();
    const c = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1);
    grid = buildGrid(c, units, span);
    grid.visible = view !== 'front' && view !== 'side';
    scene.add(grid);
  }

  // --- item tween ticker ---------------------------------------------------------------
  // A single rAF loop drives every in-flight item tween (position/color/scale/opacity). Tweens
  // are keyed by an id so re-triggering the same kind of tween on the same item (e.g. a second
  // setItems() call arriving mid-animation) *retargets* it — capturing the live current value as
  // the new "from" — rather than stacking a competing animation on top.
  const TWEEN_MS = 350;
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
      const k = Math.min(1, (now - t.start) / t.dur);
      t.update(easeInOutCubic(k));
      if (k >= 1) { finished.push(t); return false; }
      return true;
    });
    requestRender();
    for (const t of finished) t.done?.();
    if (activeTweens.length) tweenRaf = requestAnimationFrame(tickTweens);
  }

  // --- item handles ---------------------------------------------------------------------
  // mesh is the sole child of `group`; edges/screenMesh/label all hang off mesh as children (in
  // its local, geometry-centered space) so a single mesh.position/scale tween carries all of them
  // along for free. clearGroup()'s traverse() still finds and disposes every descendant.
  const MESH_OPACITY = 0.55; // MeshLambertMaterial "solid" items
  const WIREFRAME_OPACITY = 1; // banana/wireframe mesh — transparent is turned on unconditionally
  // (rather than only while fading) so an opacity tween works uniformly across mesh kinds; at
  // opacity 1 a transparent material renders identically to an opaque one.
  const SCREEN_OPACITY = 0.5;

  interface ItemHandle {
    keyId: string;
    mesh: THREE.Mesh;
    edges: THREE.LineSegments | null;
    screenMesh: THREE.Mesh | null;
    label: CSS2DObject;
    item: SceneItem;
    meshBaseOpacity: number;
    fading: boolean; // true while a fade-out (pending removal) is in flight
  }
  type Target = LayoutTarget;

  const handles = new Map<string, ItemHandle>();
  let lastItems: SceneItem[] = [];
  let layoutMode: LayoutMode = 'row';
  let firstItems = true;

  // Selection: name labels are hidden until an item is tapped. A tap raycasts against the item
  // meshes; hitting a new item selects it (shows only its label), tapping it again or tapping empty
  // space deselects. Drags (orbit) are ignored via a small movement threshold.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selectedKey: string | null = null;
  let downX = 0, downY = 0;

  function refreshLabels() {
    for (const [key, h] of handles) h.label.visible = key === selectedKey;
  }
  function onPointerDown(e: PointerEvent) { downX = e.clientX; downY = e.clientY; }
  function onPointerUp(e: PointerEvent) {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // a drag, not a tap
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    let hitKey: string | null = null;
    for (const hit of raycaster.intersectObjects(group.children, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (typeof o.userData.key === 'string') { hitKey = o.userData.key; break; }
      }
      if (hitKey) break;
    }
    const next = hitKey && hitKey !== selectedKey ? hitKey : null;
    if (next !== selectedKey) { selectedKey = next; refreshLabels(); requestRender(); }
  }

  function applyOpacityFactor(handle: ItemHandle, factor: number) {
    (handle.mesh.material as THREE.Material).opacity = handle.meshBaseOpacity * factor;
    if (handle.edges) (handle.edges.material as THREE.Material).opacity = factor;
    if (handle.screenMesh) (handle.screenMesh.material as THREE.Material).opacity = SCREEN_OPACITY * factor;
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
    const screenMat = handle.screenMesh?.material as THREE.MeshBasicMaterial | undefined;
    const fromScreen = screenMat?.color.clone();
    const toScreen = darken(toColorHex, 0.35);
    addTween(`${handle.keyId}:color`, TWEEN_MS, (k) => {
      meshMat.color.copy(fromMesh).lerp(toMesh, k);
      if (edgesMat && fromEdges) edgesMat.color.copy(fromEdges).lerp(toEdges, k);
      if (screenMat && fromScreen) screenMat.color.copy(fromScreen).lerp(toScreen, k);
    }, () => {
      // Label background isn't tweened frame-by-frame (a CSS color string, not a THREE.Color) —
      // it swaps once the material tween settles.
      handle.label.element.style.background = `${toColorHex}cc`;
    });
  }

  function disposeHandle(handle: ItemHandle) {
    if (selectedKey === handle.keyId) selectedKey = null;
    cancelTweensFor(handle.keyId);
    handle.mesh.geometry.dispose();
    (handle.mesh.material as THREE.Material).dispose();
    if (handle.edges) { handle.edges.geometry.dispose(); (handle.edges.material as THREE.Material).dispose(); }
    if (handle.screenMesh) { handle.screenMesh.geometry.dispose(); (handle.screenMesh.material as THREE.Material).dispose(); }
    handle.label.element.remove();
    handle.mesh.removeFromParent();
  }

  function createHandle(item: SceneItem, keyId: string, target: Target, maxDim: number): ItemHandle {
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
    mesh.userData.key = keyId; // for tap-to-select raycasting

    const labelEl = document.createElement('div');
    labelEl.textContent = item.name;
    labelEl.style.cssText =
      `font:12px ui-sans-serif,system-ui;padding:1px 6px;border-radius:4px;color:#fff;background:${item.color}cc`;
    const label = new CSS2DObject(labelEl);
    label.position.set(0, item.h / 2 + maxDim * 0.04, 0);
    label.visible = keyId === selectedKey; // hidden unless this item is selected
    mesh.add(label);

    let edges: THREE.LineSegments | null = null;
    if (!isWireframe && !isModel) {
      edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({ color: item.color, transparent: true, opacity: 0, depthWrite: false }),
      );
      edges.renderOrder = target.renderOrder;
      mesh.add(edges);
    }

    let screenMesh: THREE.Mesh | null = null;
    if (item.screen && !isModel) {
      const screenGeo = new THREE.ShapeGeometry(
        roundedRectShape(item.screen.w, item.screen.h, item.screen.radius ?? 0),
        12,
      );
      const screenMat = new THREE.MeshBasicMaterial({
        color: darken(item.color, 0.35),
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

    return { keyId, mesh, edges, screenMesh, label, item, meshBaseOpacity, fading: false };
  }

  function applyDiff(items: SceneItem[]) {
    lastItems = items;
    const keys = computeKeys(items);
    const maxDim = Math.max(1, ...items.flatMap((i) => [i.h, i.w, i.d]));
    const targets = computeTargets(items, keys, layoutMode);
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
        const handle = createHandle(item, key, target, maxDim);
        handles.set(key, handle);
        tweenFadeTo(handle, 1);
        addTween(`${key}:scale`, TWEEN_MS, (k) => handle.mesh.scale.setScalar(0.01 + 0.99 * k));
        return;
      }
      existing.fading = false;
      tweenPosition(existing, target.pos);
      tweenColor(existing, existing.item.color, item.color);
      existing.mesh.renderOrder = target.renderOrder;
      if (existing.edges) existing.edges.renderOrder = target.renderOrder;
      if (existing.screenMesh) existing.screenMesh.renderOrder = target.renderOrder;
      existing.item = item;
      if (currentOpacityFactor(existing) < 0.999) tweenFadeTo(existing, 1);
    });

    bounds = computeTargetBounds(items, keys, targets);

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
      if (next === 'front') { fit(s.x, s.y); ortho.position.set(c.x, c.y, c.z + far / 2); }
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
    if (grid) grid.visible = next !== 'front' && next !== 'side';
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
    if (grid) grid.visible = next !== 'front' && next !== 'side';
    requestRender();
  }

  function tick(now: number) {
    if (disposed || !animating || !animFrom || !animTo) return;
    const t = Math.min(1, (now - animStart) / TRANSITION_MS);
    const e = easeInOutCubic(t);
    persp.position.lerpVectors(animFrom.position, animTo.position, e);
    persp.quaternion.slerpQuaternions(animFrom.quaternion, animTo.quaternion, e);
    lerpMatrix4(scratchProjection, animFrom.projectionMatrix, animTo.projectionMatrix, e);
    persp.projectionMatrix.copy(scratchProjection);
    persp.projectionMatrixInverse.copy(persp.projectionMatrix).invert();
    if (grid) {
      const gridView = t >= 0.5 ? animToView : animFromView;
      grid.visible = gridView !== 'front' && gridView !== 'side';
    }
    camera = persp;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
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
    labelRenderer.setSize(width, height);
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

  return {
    setItems: (items) => { applyDiff(items); },
    setView,
    setLayout,
    setInset,
    setUnits(next: Units) {
      if (next === units) return;
      units = next;
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
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      clearGroup();
      removeGrid();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
