// Builds one catalog item's AR asset from the viewer's own procedural geometry — rounded squircle
// body plus screen overlay, two prims with a material each — rather than from a `model3d` GLB the
// way build-ar.mjs does. This is the probe for A-148 (AR for every item, not just the two modelled
// ones); the full pipeline will fold it into build-ar.mjs once the open questions below are settled.
//
// TypeScript rather than .mjs because it imports src/three/geometry.ts, so it runs under Node's type
// stripping: node --experimental-strip-types scripts/build-item-ar.ts <slug>
//
// Two things deliberately NOT decided here:
//   - The screen sits SCREEN_PROUD_MM off the front face, a figure chosen for the WebGL renderer's
//     draw order. It makes the exported depth exceed the device's real depth (see the printout).
//   - Corner tessellation is the viewer's, which is dense: ~2.5k verts and ~240 kB per phone body.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { buildGeometry, SCREEN_PROUD_MM, screenGeometry } from '../src/three/geometry.ts';

const MM_TO_M = 0.001;
const DATA = 'data/devices';
const slug = process.argv[2];
if (!slug) {
  console.error('usage: node --experimental-strip-types scripts/build-item-ar.ts <slug>');
  process.exit(1);
}

// One JSON file per item, filed under a category directory — find it without hardcoding which.
async function findItem(want: string) {
  for (const cat of await readdir(DATA, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of await readdir(`${DATA}/${cat.name}`)) {
      if (f === `${want}.json`)
        return JSON.parse(await readFile(`${DATA}/${cat.name}/${f}`, 'utf8'));
    }
  }
  return null;
}

const item = await findItem(slug);
if (!item) {
  console.error(`no catalog item "${slug}" under ${DATA}/`);
  process.exit(1);
}

// Opaque materials: AR Quick Look frustum-culls geometry inside transparent models, so the
// translucent on-screen look can't carry over (see docs/2026-07-20-mobile-ar-plan.md).
const body = buildGeometry(item);
body.computeVertexNormals();
const screen = screenGeometry(item);
screen?.computeVertexNormals();

const root = new THREE.Group();
root.add(
  new THREE.Mesh(
    body,
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.1, roughness: 0.55 }),
  ),
);
if (screen) {
  const screenMesh = new THREE.Mesh(
    screen,
    new THREE.MeshStandardMaterial({ color: 0x1c1f22, metalness: 0, roughness: 0.35 }),
  );
  screenMesh.position.set(0, 0, item.d / 2 + SCREEN_PROUD_MM);
  root.add(screenMesh);
}
// Author in metres — AR reads real-world scale off the file, and our geometry is millimetres.
root.scale.setScalar(MM_TO_M);

const scene = new THREE.Scene();
scene.add(root);
scene.updateMatrixWorld(true);

const usdz = await new USDZExporter().parseAsync(scene);
const out = `${process.env.OUT_DIR ?? 'public/models'}/${slug}-ar.usdz`;
await writeFile(out, Buffer.from(usdz));

// Dimensional honesty check — the whole feature is worthless if AR lies about size. Width and height
// must match the catalog exactly; depth is expected to exceed it by SCREEN_PROUD_MM on screened items.
const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
const mm = (v: number) => v / MM_TO_M;
const expectedD = item.d + (screen ? SCREEN_PROUD_MM : 0);
const off = [
  Math.abs(mm(size.x) - item.w),
  Math.abs(mm(size.y) - item.h),
  Math.abs(mm(size.z) - expectedD),
];
const verts = (g: THREE.BufferGeometry | null) => g?.attributes.position?.count ?? 0;
console.log(`${item.name} → ${out}  (${(usdz.byteLength / 1024).toFixed(1)} kB)`);
console.log(`  verts     body ${verts(body)}, screen ${verts(screen)}`);
console.log(`  catalog   ${item.w} × ${item.h} × ${item.d} mm`);
console.log(
  `  exported  ${mm(size.x).toFixed(3)} × ${mm(size.y).toFixed(3)} × ${mm(size.z).toFixed(3)} mm`,
);
if (screen) {
  console.log(
    `  note      depth is ${SCREEN_PROUD_MM} mm over the real ${item.d} mm — the screen floats proud of the face`,
  );
}
if (off.some((d) => d > 0.001)) {
  console.error(`  FAIL      w/h/d off by ${off.map((d) => d.toFixed(4)).join(' / ')} mm`);
  process.exit(1);
}
console.log('  scale     ✓ matches the catalog');
