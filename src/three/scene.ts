import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem {
  name: string; h: number; w: number; d: number; color: string;
  radius?: number; radiusAxis?: 'x' | 'y' | 'z';
  screen?: { h: number; w: number; radius?: number };
  mesh?: 'banana';
}
export interface SizeScene {
  setItems(items: SceneItem[]): void;
  setView(view: ViewName): void;
  resize(): void;
  dispose(): void;
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

  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener('change', requestRender);

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
  let grid: THREE.GridHelper | null = null;
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
    if (grid) { scene.remove(grid); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); grid = null; }
  }

  function setItems(items: SceneItem[]) {
    clearGroup();
    const maxDim = Math.max(1, ...items.flatMap((i) => [i.h, i.w, i.d]));
    const gap = maxDim * 0.08;
    let x = 0;
    for (const item of items) {
      const geo = buildGeometry(item);
      const isWireframe = item.mesh != null;
      const mat = isWireframe
        ? new THREE.MeshBasicMaterial({ color: item.color, wireframe: true })
        : new THREE.MeshLambertMaterial({ color: item.color, transparent: true, opacity: 0.55 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + item.w / 2, item.h / 2, 0);
      const labelEl = document.createElement('div');
      labelEl.textContent = item.name;
      labelEl.style.cssText =
        `font:12px ui-sans-serif,system-ui;padding:1px 6px;border-radius:4px;color:#fff;background:${item.color}cc`;
      const label = new CSS2DObject(labelEl);
      label.position.set(0, item.h / 2 + maxDim * 0.04, 0);
      mesh.add(label);
      group.add(mesh);
      if (!isWireframe) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo, 30),
          new THREE.LineBasicMaterial({ color: item.color }),
        );
        edges.position.copy(mesh.position);
        group.add(edges);
      }
      if (item.screen) {
        const screenGeo = new THREE.ShapeGeometry(
          roundedRectShape(item.screen.w, item.screen.h, item.screen.radius ?? 0),
          12,
        );
        const screenMat = new THREE.MeshBasicMaterial({
          color: darken(item.color, 0.35),
          transparent: true,
          opacity: 0.5,
        });
        const screenMesh = new THREE.Mesh(screenGeo, screenMat);
        screenMesh.position.set(mesh.position.x, mesh.position.y, item.d / 2 + 0.4);
        group.add(screenMesh);
      }
      x += item.w + gap;
    }
    bounds = new THREE.Box3().setFromObject(group);
    if (items.length === 0) bounds.set(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));

    removeGrid();
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1);
    const step = 10 ** Math.max(1, Math.ceil(Math.log10(span / 20)));
    const size = Math.ceil((span * 2) / step) * step;
    grid = new THREE.GridHelper(size, size / step, 0x999999, 0xdddddd);
    const c = bounds.getCenter(new THREE.Vector3());
    grid.position.set(c.x, 0, c.z);
    scene.add(grid);
    // Refit is always instant (never animated), even mid-flight: cancel any transition and jump.
    applyInstant(view);
  }

  // Computes the target camera pose for `next` (mutating the real persp/ortho camera objects,
  // exactly as the old instant setView did) and returns cloned pose data safe to keep around
  // while persp continues to be repurposed as the in-flight transition camera.
  function computeEnd(next: ViewName): ViewEndState {
    const c = bounds.getCenter(new THREE.Vector3());
    const s = bounds.getSize(new THREE.Vector3());
    const { width, height } = container.getBoundingClientRect();
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    let targetCam: THREE.Camera;
    if (next === '3d') {
      persp.aspect = aspect;
      const radius = Math.max(s.x, s.y, s.z, 1);
      persp.position.set(c.x + radius * 1.2, c.y + radius * 0.9, c.z + radius * 1.6);
      persp.lookAt(c);
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
      persp.aspect = Math.max(width, 1) / Math.max(height, 1);
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

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    setItems: (items) => { setItems(items); },
    setView,
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      cancelAnimationFrame(animRaf);
      ro.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      clearGroup();
      removeGrid();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
