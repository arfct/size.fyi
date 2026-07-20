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
    setView(view); // refit cameras
  }

  function setView(next: ViewName) {
    view = next;
    const c = bounds.getCenter(new THREE.Vector3());
    const s = bounds.getSize(new THREE.Vector3());
    const { width, height } = container.getBoundingClientRect();
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    if (next === '3d') {
      camera = persp;
      persp.aspect = aspect;
      const radius = Math.max(s.x, s.y, s.z, 1);
      persp.position.set(c.x + radius * 1.2, c.y + radius * 0.9, c.z + radius * 1.6);
      persp.lookAt(c);
      persp.updateProjectionMatrix();
      controls.target.copy(c);
      controls.enabled = true;
    } else {
      camera = ortho;
      controls.enabled = false;
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
    }
    if (grid) grid.visible = next !== 'front' && next !== 'side';
    requestRender();
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    setView(view);
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
