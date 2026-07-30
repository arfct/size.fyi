import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SCREEN_PROUD_MM } from '../shared/ar';
// NOTE: GLTFLoader and BufferGeometryUtils are deliberately NOT imported here — see
// loadModelGeometry below, which pulls them in on demand.
import { formatLengthValue } from '../shared/dimensions';
import type { LayoutMode, Units } from '../shared/types';
import { buildGeometry, buildSeamGeometry, screenGeometry } from './geometry';
import {
  computeKeys,
  computeTargetBounds,
  computeTargets,
  type LayoutTarget,
  type Vec3 as LayoutVec3,
} from './layout';

// Re-exported so callers keep reaching for the scene's public surface in one place.
export { computeKeys, computeTargetBounds, computeTargets, type LayoutTarget };

export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem {
  name: string;
  h: number;
  w: number;
  d: number;
  color: string;
  radius?: number;
  radiusAxis?: 'x' | 'y' | 'z';
  screen?: { h: number; w: number; radius?: number };
  seam?: boolean; // draw a fold parting-line around the mid-thickness (z=0) outline
  mesh?: 'banana';
  model3d?: { url: string; rotation?: [number, number, number] };
}

// Loads a GLB and returns one BufferGeometry fit to the given w×h×d box, centred on the origin so
// it drops in wherever the procedural box would sit. Cached per url (dims are constant per device);
// callers clone the result so per-handle disposal is safe. Normals are recomputed since the
// optimized models ship without them (see scripts/build-models.mjs).
// GLTFLoader and the geometry-merge helper are ~a third of the 3D payload but only matter for the
// few devices that ship a `model3d`, so they load on demand instead of riding along in the scene
// chunk for every visitor. Both are cached by the module registry after the first call.
const modelGeometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
function loadModelGeometry(
  model: { url: string; rotation?: [number, number, number] },
  w: number,
  h: number,
  d: number,
): Promise<THREE.BufferGeometry> {
  let pending = modelGeometryCache.get(model.url);
  if (!pending) {
    pending = (async () => {
      const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/BufferGeometryUtils.js'),
      ]);
      const gltf = await new GLTFLoader().loadAsync(`/models/${model.url}`);
      gltf.scene.updateMatrixWorld(true);
      const parts: THREE.BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const g = mesh.geometry.clone();
        for (const name of Object.keys(g.attributes))
          if (name !== 'position') g.deleteAttribute(name);
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
    })();
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
  const majorCount = Math.min(
    40,
    Math.max(6, Math.round(Math.max(span * 0.65, 6 * unitMM) / unitMM)),
  );
  return { unitMM, minorMM, majorCount, halfExtent: majorCount * unitMM };
}

// Reference room: a cube whose side comes from the content's largest dimension, padded by this fraction
// of it per side (0.5 → the side is twice that dimension). Corners are square — the room had a corner
// fillet through several iterations, and the machinery for it is gone; see the design spec for why.
const GRID_PAD_SCALE = 0.5;
// Minimum clearance between the content and each wall, so a very small object still gets a room with
// room in it. Its own constant on purpose: it used to be passed the fillet radius, which quietly tied
// the size of the room to the shape of its corners, so changing the corners resized small rooms.
const GRID_MIN_PAD_UNITS = 1;
const GRID_MAX_UNITS_PER_AXIS = 48; // coarsen the ring spacing past this so huge objects stay bounded
// The room is a backdrop, so it must draw before every item. Nothing in the scene writes depth (see
// LABEL_ORDER_BIAS), and the room's bounding sphere is centred on the devices, so leaving this at the
// default 0 lets the distance tiebreak flip as the camera moves — the grid then paints over the device
// screens and they look transparent. Items start at renderOrder 0, so stay below that.
const GRID_RENDER_ORDER = -1;
// Fade shaping. Visibility is a screen-space "flashlight": a radial gradient centred on the room, full
// inside GRID_LIGHT_INNER and gone by GRID_LIGHT_OUTER, measured in NDC radius (1 = viewport edge, so
// the pool conforms to the canvas). GRID_FACING_CULL is only wide enough to drop the near-facing walls
// without a jagged terminator — the *look* comes from the flashlight, not the surface angle. The
// near-fade band is view-axis depth normalized to the box (-1 = nearest point, +1 = farthest) and keeps
// geometry very close to the camera from blaring through the middle of the light.
const GRID_LIGHT_INNER = 0.0;
const GRID_LIGHT_OUTER = 0.7;
const GRID_FACING_CULL = 0.1;
const GRID_NEAR_FADE_START = -0.95;
const GRID_NEAR_FADE_END = -0.1;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// A CUBE room centred on the content: one side length, derived from the content's largest dimension
// grown by `padScale` per side (0.5 → twice that dimension) and at least `minPad` clear of it, so a flat
// or thin object still gets a room with depth.
//
// The side is a whole number of grid units, and every face sits half a unit off the lattice — so each
// face is a whole number of units across and carries a half-unit margin at each of its edges, and the
// two margins meeting at an edge form one full cell wrapping it. Pure — for testing.
//
// `minPad` is a minimum clearance, deliberately not tied to anything about the room's shape.
export function gridBox(
  min: Vec3,
  max: Vec3,
  padScale: number,
  minPad: number,
  snap: number,
): { min: Vec3; max: Vec3 } {
  const maxSize = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
  // Both the side and every face are whole multiples of `snap`, which is the ruling step (see gridStep).
  // That's what makes the walls line up: a ring lands exactly ON each face, so every face is ruled edge
  // to edge in whole cells and the two faces meeting at an edge agree there to the millimetre.
  //
  // Earlier attempts got this wrong in both directions. Snapping to the unit while ruling by a finer or
  // coarser step left the last cell short. Offsetting the faces half a unit put the edge mid-cell, so
  // each wall's ruling simply stopped at a different place and the edges read as ragged.
  const side =
    Math.ceil(Math.max(maxSize * (1 + 2 * padScale), maxSize + 2 * minPad) / snap) * snap;
  const lowFace = (lo: number, hi: number) => Math.round(((lo + hi) / 2 - side / 2) / snap) * snap;
  const x0 = lowFace(min.x, max.x),
    y0 = lowFace(min.y, max.y),
    z0 = lowFace(min.z, max.z);
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x0 + side, y: y0 + side, z: z0 + side } };
}

// The ruling step for the current unit system and content span, and the lattice the room snaps to.
//
// `fine` is the line spacing: 1 cm in metric, half an inch in imperial, coarsened by a whole multiple
// of the unit once the content would otherwise need more than GRID_MAX_UNITS_PER_AXIS lines.
//
// `snap` is what the room's faces and side are rounded to. It has to be a common multiple of the unit
// and the ruling step so that faces land on a ruling line (they get stroked, and adjacent walls agree at
// the edge) AND on a whole unit (so those strokes are major lines, not half-unit ones). Since either
// `fine` divides the unit or the unit divides `fine`, the larger of the two is that common multiple.
//
// The step is derived from the content span rather than the finished room, so it can be known before the
// box is snapped to it. The room is close to twice the span, which is what the estimate below uses.
export function gridStep(units: Units, span: number, minPad: number) {
  const { unitMM, minorMM } = gridSpec(units, span);
  const approxSide = Math.max(span * (1 + 2 * GRID_PAD_SCALE), span + 2 * minPad);
  const stepMul = Math.max(1, Math.ceil(approxSide / unitMM / GRID_MAX_UNITS_PER_AXIS));
  const showMinor = units === 'imperial' && stepMul === 1; // half-unit lines only when not coarsened
  const fine = showMinor ? minorMM : unitMM * stepMul;
  return { unitMM, fine, snap: Math.max(unitMM, fine) };
}

// One ring in a family: where it sits along the axis, and whether it's a major (whole-unit) line.
export interface RingSpec {
  coord: number;
  major: boolean;
}

// One family of rings, perpendicular to `axis`, centred at (cu, cv) with half-extents (halfU, halfV) in
// the other two axes. Each ring is a rectangle in that plane. The room's grid is three such families,
// one per axis: on any face the two in-plane families cross to form a normal grid, so the ruling is
// continuous around the box. Pure — exported for unit testing.
export interface RingFamily {
  axis: 'x' | 'y' | 'z';
  cu: number;
  cv: number;
  halfU: number;
  halfV: number;
  rings: RingSpec[];
}

// Rings step by `fine` across the full axis span, starting exactly ON the low face and ending exactly on
// the high face — gridBox snaps both to a multiple of the ruling step, so the first and last rings are
// the faces themselves. Those two rings are what stroke the room's edges: a ring lying on a face is a
// rectangle whose four sides run along four of the box's twelve edges. Pure.
export function gridRingSpecs(min: Vec3, max: Vec3, unitMM: number, fine: number): RingFamily[] {
  const onUnit = (v: number) => Math.abs(Math.round(v / unitMM) * unitMM - v) < 1e-6;
  const family = (
    axis: 'x' | 'y' | 'z',
    a0: number,
    a1: number,
    uMin: number,
    uMax: number,
    vMin: number,
    vMax: number,
  ): RingFamily => {
    const rings: RingSpec[] = [];
    for (let c = Math.ceil(a0 / fine - 1e-6) * fine; c <= a1 + 1e-6; c += fine) {
      rings.push({ coord: c, major: onUnit(c) });
    }
    return {
      axis,
      rings,
      cu: (uMin + uMax) / 2,
      cv: (vMin + vMax) / 2,
      halfU: (uMax - uMin) / 2,
      halfV: (vMax - vMin) / 2,
    };
  };
  return [
    family('x', min.x, max.x, min.y, max.y, min.z, max.z),
    family('y', min.y, max.y, min.x, max.x, min.z, max.z),
    family('z', min.z, max.z, min.x, max.x, min.y, max.y),
  ];
}

// Builds the reference room as line rings for a snapped box: three families of concentric rectangle
// rings, one per axis, so the ruling runs continuously around the box. A single shader fades each
// fragment by how much its outward surface normal faces away from the camera, so only the far (inner)
// walls draw — replacing the old six-plane angle fade. Spacing coarsens for very large content.
// Exported for testing: a NaN in the vertex normals removes the whole room from the shader without any
// error, so a test that just asserts finite output is worth more than it looks.
export function buildGridRings(
  box: { min: Vec3; max: Vec3 },
  unitMM: number,
  fine: number,
): THREE.Group {
  const families = gridRingSpecs(box.min, box.max, unitMM, fine);

  const majorPos: number[] = [],
    majorNorm: number[] = [];
  const minorPos: number[] = [],
    minorNorm: number[] = [];
  // Each ring is a rectangle in its perpendicular plane, emitted as its four edges. An edge is its own
  // LineSegments pair carrying that wall's outward normal at both ends — which is why the rectangle isn't
  // a shared-vertex loop: the two edges meeting at a corner lie on different walls and need different
  // normals for the facing fade, and a corner vertex can only hold one.
  //
  // (du, dv) is the edge's midpoint direction from the ring centre, which is also its outward normal.
  const EDGES = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const fam of families) {
    for (const ring of fam.rings) {
      const pos = ring.major ? majorPos : minorPos,
        norm = ring.major ? majorNorm : minorNorm;
      for (const [du, dv] of EDGES) {
        // The edge runs along whichever of u/v the normal is perpendicular to.
        const alongU = du === 0;
        for (const end of [-1, 1]) {
          const u = fam.cu + (alongU ? end * fam.halfU : du * fam.halfU);
          const v = fam.cv + (alongU ? dv * fam.halfV : end * fam.halfV);
          if (fam.axis === 'x') {
            pos.push(ring.coord, u, v);
            norm.push(0, du, dv);
          } else if (fam.axis === 'y') {
            pos.push(u, ring.coord, v);
            norm.push(du, 0, dv);
          } else {
            pos.push(u, v, ring.coord);
            norm.push(du, dv, 0);
          }
        }
      }
    }
  }

  const boxCenter = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    (box.min.z + box.max.z) / 2,
  );
  const boxRadius =
    0.5 * Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
  const lineMaterial = (baseOpacity: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0x8a8a8a) },
        uOpacity: { value: baseOpacity },
        uCameraPos: { value: new THREE.Vector3() },
        uViewDir: { value: new THREE.Vector3(0, 0, -1) },
        uOrtho: { value: 0 },
        uBoxCenter: { value: boxCenter },
        uBoxRadius: { value: boxRadius },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLightCenter: { value: new THREE.Vector2() },
      },
      vertexShader:
        'varying vec3 vN; varying vec3 vW;\n' +
        'void main() {\n' +
        '  vN = normalize(mat3(modelMatrix) * normal);\n' +
        '  vW = (modelMatrix * vec4(position, 1.0)).xyz;\n' +
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n' +
        '}',
      fragmentShader:
        'uniform vec3 uColor; uniform float uOpacity; uniform vec3 uCameraPos; uniform vec3 uViewDir; uniform float uOrtho;\n' +
        'uniform vec3 uBoxCenter; uniform float uBoxRadius; uniform vec2 uResolution; uniform vec2 uLightCenter;\n' +
        'varying vec3 vN; varying vec3 vW;\n' +
        'void main() {\n' +
        // A face is inner (far) when its outward normal points along the eye ray. Perspective uses the
        // true per-fragment ray (so every far wall shows, even at grazing angles); ortho uses the single
        // parallel view direction, so silhouette fillets collapse and the perpendicular face reads square.
        '  vec3 dir = uOrtho > 0.5 ? uViewDir : normalize(vW - uCameraPos);\n' +
        // Cull the near-facing walls only — without this the wall between camera and content would draw
        // its grid over the devices. Just wide enough to keep the terminator from aliasing.
        `  float facing = smoothstep(0.0, ${GRID_FACING_CULL.toFixed(2)}, dot(vN, dir));\n` +
        // Flashlight: a screen-space radial gradient, so only the grid near the middle of the view shows
        // and it falls off to nothing toward the edges. gl_FragCoord is exact per pixel (interpolating a
        // clip-space varying would skew under perspective), and the centre tracks the projected room.
        '  vec2 ndc = (gl_FragCoord.xy / uResolution) * 2.0 - 1.0;\n' +
        `  float light = 1.0 - smoothstep(${GRID_LIGHT_INNER.toFixed(2)}, ${GRID_LIGHT_OUTER.toFixed(2)}, length(ndc - uLightCenter));\n` +
        // Depth along the view axis, normalized against the box (-1 at its nearest point, +1 farthest):
        // keeps geometry right in front of the camera from cutting through the middle of the light.
        '  float depth = dot(vW - uBoxCenter, uViewDir) / uBoxRadius;\n' +
        `  float near = smoothstep(${GRID_NEAR_FADE_START.toFixed(2)}, ${GRID_NEAR_FADE_END.toFixed(2)}, depth);\n` +
        '  gl_FragColor = vec4(uColor, facing * light * near * uOpacity);\n' +
        '}',
    });

  const g = new THREE.Group();
  g.userData.center = boxCenter; // projected each frame to aim the flashlight
  for (const [pos, norm, opacity] of [
    [majorPos, majorNorm, 0.55],
    [minorPos, minorNorm, 0.22],
  ] as const) {
    if (pos.length === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    const lines = new THREE.LineSegments(geo, lineMaterial(opacity));
    lines.renderOrder = GRID_RENDER_ORDER; // sorted per object, so set it here rather than on the group
    g.add(lines);
  }
  return g;
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
const labelFont = (weight: number) =>
  `${weight} ${LABEL_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
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

function makeLabelPlane(
  text: string,
  worldH: number,
  weight: number,
  color: THREE.ColorRepresentation,
): THREE.Mesh {
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
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
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
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Follows the app's theme (Tailwind's default dark: = prefers-color-scheme). The screen face tints
  // toward white in light mode (paler than the body) and toward black in dark mode (darker than it),
  // so it always reads as a distinct panel against the background. Live-updated on theme change.
  const darkQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let darkMode = darkQuery?.matches ?? false;
  const screenColor = (hex: string) =>
    darkMode ? tintToBlack(hex, SCREEN_TINT_DARK) : tintToWhite(hex, SCREEN_TINT_LIGHT);
  // Label text ink, theme-aware: dark mode keeps the name in the device colour and the dims white
  // (readable on the dark face); light mode uses the device colour darkened for both, so they read
  // against the pale face/background. Both live-update on a theme change.
  const LABEL_DARKEN = 0.4;
  const nameInk = (hex: string) =>
    darkMode ? new THREE.Color(hex) : tintToBlack(hex, LABEL_DARKEN);
  // Measurement labels are darker than the name in light mode: the same darkened device colour, then
  // halved again (50% darker) for stronger contrast on the pale screen. Dark mode keeps them white.
  const dimInk = (hex: string) =>
    darkMode ? new THREE.Color(0xffffff) : tintToBlack(hex, LABEL_DARKEN).multiplyScalar(0.5);

  // --- view transition state ---
  interface CameraPose {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    projectionMatrix: THREE.Matrix4;
  }
  interface ViewEndState extends CameraPose {
    controlsTarget: THREE.Vector3;
  }
  const TRANSITION_MS = reducedMotion ? 0 : 450;
  const scratchProjection = new THREE.Matrix4();
  let firstView = true; // initial mount jumps instead of animating
  let animating = false;
  let animRaf = 0;
  let animStart = 0;
  let animToView: ViewName = '3d';
  let animFrom: CameraPose | null = null;
  let animTo: ViewEndState | null = null;

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  function lerpMatrix4(target: THREE.Matrix4, a: THREE.Matrix4, b: THREE.Matrix4, t: number) {
    const ae = a.elements,
      be = b.elements,
      te = target.elements;
    for (let i = 0; i < 16; i++) te[i] = (ae[i] ?? 0) + ((be[i] ?? 0) - (ae[i] ?? 0)) * t;
  }

  const group = new THREE.Group();
  scene.add(group);
  // The rounded reference room (line rings). Only its inner faces show — the shader fades each fragment
  // by how much its surface normal faces the view direction — so `uViewDir` is refreshed per frame.
  let grids: THREE.Group | null = null;
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
      updateGridCamera();
      renderer.render(scene, camera);
    });
  }

  // Feed the room shader the per-frame camera state: eye position and view direction for the near-wall
  // cull (perspective uses the per-fragment ray, ortho the parallel direction), the drawing-buffer size
  // to turn gl_FragCoord into NDC, and the room's centre projected to screen so the flashlight sits on
  // the composition rather than the raw canvas centre (the sidebar inset shifts the two apart).
  const _camPos = new THREE.Vector3();
  const _viewDir = new THREE.Vector3();
  const _lightCenter = new THREE.Vector3();
  const _bufferSize = new THREE.Vector2();
  function updateGridCamera() {
    if (!grids) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_viewDir);
    renderer.getDrawingBufferSize(_bufferSize);
    _lightCenter.copy(grids.userData.center as THREE.Vector3).project(camera);
    const isOrtho = (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    grids.traverse((o) => {
      const u = ((o as THREE.LineSegments).material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (!u) return;
      u.uCameraPos?.value.copy(_camPos);
      u.uViewDir?.value.copy(_viewDir);
      u.uResolution?.value.copy(_bufferSize);
      u.uLightCenter?.value.set(_lightCenter.x, _lightCenter.y);
      if (u.uOrtho) u.uOrtho.value = isOrtho;
    });
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
    if (!grids) return;
    grids.traverse(disposeObject);
    scene.remove(grids);
    grids = null;
  }

  // Rebuild the reference room for the current content bounds + unit system: snap an outer box around
  // the content, then build the three ring families inside it. Rings step from the grid lattice, so the
  // ruling stays aligned to object corners.
  function rebuildGrid() {
    removeGrid();
    const s = bounds.getSize(new THREE.Vector3());
    const span = Math.max(s.x, s.y, s.z, 1);
    const { unitMM } = gridSpec(units, span);
    const minPad = GRID_MIN_PAD_UNITS * unitMM;
    // The ruling step comes first: the room snaps to it, so the walls land on ruling lines.
    const { fine, snap } = gridStep(units, span, minPad);
    const box = gridBox(bounds.min, bounds.max, GRID_PAD_SCALE, minPad, snap);
    grids = buildGridRings(box, unitMM, fine);
    scene.add(grids);
    updateGridCamera();
  }

  // --- item tween ticker ---------------------------------------------------------------
  // A single rAF loop drives every in-flight item tween (position/color/scale/opacity). Tweens
  // are keyed by an id so re-triggering the same kind of tween on the same item (e.g. a second
  // setItems() call arriving mid-animation) *retargets* it — capturing the live current value as
  // the new "from" — rather than stacking a competing animation on top.
  const TWEEN_MS = reducedMotion ? 0 : 350;
  interface ActiveTween {
    id: string;
    start: number;
    dur: number;
    update: (k: number) => void;
    done?: () => void;
  }
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
      if (k >= 1) {
        finished.push(t);
        return false;
      }
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
    nameLabel: THREE.Mesh; // centered below the box (device colour)
    widthLabel: THREE.Mesh; // bottom-left, on the face (white, unitless)
    sepLabel: THREE.Mesh; // "×" centered between width and height (white)
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
    if (handle.screenMesh)
      (handle.screenMesh.material as THREE.Material).opacity = SCREEN_OPACITY * factor;
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
    if (Math.abs(from - targetFactor) < 0.001) {
      done?.();
      return;
    } // already there — still finish
    addTween(
      `${handle.keyId}:fade`,
      TWEEN_MS,
      (k) => {
        applyOpacityFactor(handle, from + (targetFactor - from) * k);
      },
      done,
    );
  }

  // Takes a plain vector: layout is three-free, and Vector3.equals/lerpVectors only read x/y/z.
  function tweenPosition(handle: ItemHandle, target: LayoutVec3) {
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
    const dimMats = [handle.widthLabel, handle.sepLabel, handle.heightLabel].map(
      (l) => l.material as THREE.MeshBasicMaterial,
    );
    const fromDims = dimMats.map((m) => m.color.clone());
    const toDim = dimInk(toColorHex);
    addTween(`${handle.keyId}:color`, TWEEN_MS, (k) => {
      meshMat.color.copy(fromMesh).lerp(toMesh, k);
      if (edgesMat && fromEdges) edgesMat.color.copy(fromEdges).lerp(toEdges, k);
      if (seamMat && fromSeam) seamMat.color.copy(fromSeam).lerp(toEdges, k);
      if (screenMat && fromScreen) screenMat.color.copy(fromScreen).lerp(toScreen, k);
      nameMat.color.copy(fromName).lerp(toName, k);
      dimMats.forEach((m, i) => {
        m.color.copy(fromDims[i]!).lerp(toDim, k);
      });
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
    if (handle.edges) {
      handle.edges.geometry.dispose();
      (handle.edges.material as THREE.Material).dispose();
    }
    if (handle.seam) {
      handle.seam.geometry.dispose();
      (handle.seam.material as THREE.Material).dispose();
    }
    if (handle.screenMesh) {
      handle.screenMesh.geometry.dispose();
      (handle.screenMesh.material as THREE.Material).dispose();
    }
    for (const l of labelsOf(handle)) disposeLabel(l);
    handle.mesh.removeFromParent();
  }

  // Builds one dimension label (width or height) for the current units, inset just inside the front
  // face at a bottom corner: width bottom-left, height bottom-right.
  function makeDimLabel(item: SceneItem, which: 'w' | 'h'): THREE.Mesh {
    const mm = which === 'w' ? item.w : item.h;
    const inset = labelGap(item);
    const plane = makeLabelPlane(
      formatLengthValue(mm, units),
      labelWorldH,
      500,
      dimInk(item.color),
    );
    if (which === 'w')
      placeCorner(plane, -item.w / 2 + inset, -item.h / 2 + inset, labelFrontZ(item), 0, 1);
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
      ? new THREE.MeshBasicMaterial({
          color: item.color,
          wireframe: true,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      : new THREE.MeshLambertMaterial({
          color: item.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(target.pos);
    mesh.renderOrder = target.renderOrder;
    mesh.scale.setScalar(0.01);

    // Per-device annotations lying on the front face (local +z, the world z=0 plane the devices are
    // front-aligned to) so they foreshorten and rotate with the box rather than billboarding.
    const { nameLabel, widthLabel, sepLabel, heightLabel } = buildLabels(
      mesh,
      item,
      target.renderOrder,
    );

    let edges: THREE.LineSegments | null = null;
    if (!isWireframe && !isModel) {
      edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 30),
        new THREE.LineBasicMaterial({
          color: item.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      edges.renderOrder = target.renderOrder;
      mesh.add(edges);
    }

    let seam: THREE.LineSegments | null = null;
    if (item.seam && !isWireframe && !isModel) {
      const seamRadius = item.radiusAxis === 'z' ? (item.radius ?? 0) : 0;
      seam = new THREE.LineSegments(
        buildSeamGeometry(item.w, item.h, seamRadius),
        new THREE.LineBasicMaterial({
          color: item.color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      seam.renderOrder = target.renderOrder;
      mesh.add(seam); // child at local z=0 — the mid-thickness plane
    }

    let screenMesh: THREE.Mesh | null = null;
    const screenGeo = isModel ? null : screenGeometry(item);
    if (screenGeo) {
      const screenMat = new THREE.MeshBasicMaterial({
        color: screenColor(item.color), // paler than the body (light mode) / darker (dark mode)
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      screenMesh = new THREE.Mesh(screenGeo, screenMat);
      screenMesh.position.set(0, 0, item.d / 2 + SCREEN_PROUD_MM); // local offset — moves with mesh
      screenMesh.renderOrder = target.renderOrder;
      mesh.add(screenMesh);
    }

    group.add(mesh);

    if (isModel) {
      // Swap the placeholder box for the real geometry once loaded; skip if the handle was
      // removed meanwhile (mesh detached), and keep the box on failure.
      loadModelGeometry(item.model3d!, item.w, item.h, item.d)
        .then((g) => {
          if (!mesh.parent) {
            g.dispose();
            return;
          }
          mesh.geometry.dispose();
          mesh.geometry = g;
          requestRender();
        })
        .catch(() => {
          /* fall back to the box placeholder */
        });
    }

    return {
      keyId,
      mesh,
      edges,
      seam,
      screenMesh,
      nameLabel,
      widthLabel,
      sepLabel,
      heightLabel,
      item,
      meshBaseOpacity,
      fading: false,
    };
  }

  function applyDiff(items: SceneItem[]) {
    lastItems = items;
    const keys = computeKeys(items);
    const targets = computeTargets(items, keys, layoutMode);
    // Layout returns plain vectors (it stays three-free so the Worker can use it); the renderer wants
    // a Box3 for the camera fit and the grid.
    const b = computeTargetBounds(items, keys, targets);
    bounds = new THREE.Box3(
      new THREE.Vector3(b.min.x, b.min.y, b.min.z),
      new THREE.Vector3(b.max.x, b.max.y, b.max.z),
    );
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
        const half = ((Math.max(fw / aspect, fh) * m) / 2) * Math.max(aspect, 1);
        ortho.left = -half * (aspect >= 1 ? 1 : aspect);
        ortho.right = -ortho.left;
        ortho.top = ortho.right / aspect;
        ortho.bottom = -ortho.top;
      };
      const far = Math.max(s.x, s.y, s.z) * 4 + 1000;
      // Front view is fit tightly to the geometry; the name label sits just below each box, so leave
      // room for its overhang (label height + gap) or it clips at the bottom edge.
      const labelPad = 2 * (labelWorldH + Math.max(0, ...lastItems.map((i) => labelGap(i))));
      if (next === 'front') {
        fit(s.x + labelPad, s.y + labelPad);
        ortho.position.set(c.x, c.y, c.z + far / 2);
      }
      if (next === 'side') {
        fit(s.z, s.y);
        ortho.position.set(c.x + far / 2, c.y, c.z);
      }
      if (next === 'top') {
        fit(s.x, s.z);
        ortho.position.set(c.x, c.y + far / 2, c.z);
      }
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
    updateGridCamera();
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
    updateGridCamera();
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
    updateGridCamera();
    renderer.render(scene, camera);
    if (t >= 1) {
      finalizeTransition();
    } else {
      animRaf = requestAnimationFrame(tick);
    }
  }

  function beginTransition(next: ViewName) {
    const from = currentPose();
    cancelAnimation();
    const end = computeEnd(next);
    view = next;
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
      if (h.screenMesh)
        (h.screenMesh.material as THREE.MeshBasicMaterial).color.copy(screenColor(h.item.color));
      (h.nameLabel.material as THREE.MeshBasicMaterial).color.copy(nameInk(h.item.color));
      for (const l of [h.widthLabel, h.sepLabel, h.heightLabel])
        (l.material as THREE.MeshBasicMaterial).color.copy(dimInk(h.item.color));
    }
    requestRender();
  }
  darkQuery?.addEventListener('change', onThemeChange);

  return {
    setItems: (items) => {
      applyDiff(items);
    },
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
