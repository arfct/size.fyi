// Builds ONE AR asset for a whole comparison — every item in its laid-out position — rather than one
// asset per item. This is the probe for A-149 (aggregate view in AR).
//
//   node --experimental-strip-types scripts/build-comparison-ar.ts [--stack] <slug[:state]>...
//   e.g. ... build-comparison-ar.ts iphone-13-mini galaxy-z-fold8:closed
//
// Positions come from the viewer's own computeTargets(), so the AR object is the same arrangement the
// on-screen comparison shows. Colors come from the app's palette, because A-149 needs the items
// visually separable: AR Quick Look frustum-culls geometry inside transparent models, so the
// translucent on-screen treatment can't carry over and distinct opaque colors do that job instead.
//
// Note this leans on USDZExporter to compose the package. A-149's server-side design generates the
// root layer by hand and references pre-built per-item layers; this probe answers the prior question
// of whether Quick Look renders a multi-item scene at all.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { colorFor } from '../src/app/palette.ts';
import { SCREEN_PROUD_MM } from '../src/shared/ar.ts';
import { type Device, deviceDims } from '../src/shared/types.ts';
import { buildGeometry, screenGeometry } from '../src/three/geometry.ts';
import { computeKeys, computeTargetBounds, computeTargets } from '../src/three/layout.ts';

const MM_TO_M = 0.001;
const DATA = 'data/devices';

const argv = process.argv.slice(2);
const mode = argv.includes('--stack') ? 'stack' : 'row';
const specs = argv.filter((a) => !a.startsWith('--'));
if (specs.length < 2) {
  console.error('usage: build-comparison-ar.ts [--stack] <slug[:state]> <slug[:state]>...');
  process.exit(1);
}

async function findItem(want: string): Promise<Device | null> {
  for (const cat of await readdir(DATA, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of await readdir(`${DATA}/${cat.name}`)) {
      if (f === `${want}.json`)
        return JSON.parse(await readFile(`${DATA}/${cat.name}/${f}`, 'utf8'));
    }
  }
  return null;
}

// Resolve every spec up front so a typo fails before anything is exported. An unknown state is an
// error rather than a fallback — activeState() would quietly substitute states[0].
const resolved = [];
for (const spec of specs) {
  const [slug, state] = spec.split(':');
  const device = slug ? await findItem(slug) : null;
  if (!device) {
    console.error(`no catalog item "${slug}" under ${DATA}/`);
    process.exit(1);
  }
  if (state && !device.states?.some((s) => s.label === state)) {
    console.error(
      `"${slug}" has no state "${state}" (states: ${device.states?.map((s) => s.label).join(', ') ?? 'none'})`,
    );
    process.exit(1);
  }
  if (!state && device.states?.length) {
    console.error(
      `"${slug}" needs a state — one of ${device.states.map((s) => s.label).join(', ')}`,
    );
    process.exit(1);
  }
  resolved.push({ slug: slug!, state, device, dims: deviceDims(device, state) });
}

// computeTargets keys items the way the scene does, so build the same shape it expects.
const layoutItems = resolved.map((r) => ({
  name: r.device.name,
  h: r.dims.h,
  w: r.dims.w,
  d: r.dims.d,
  screen: r.dims.screen,
  seam: r.dims.seam,
  mesh: r.device.mesh,
}));
const keys = computeKeys(layoutItems);
const targets = computeTargets(layoutItems, keys, mode);

const root = new THREE.Group();
let verts = 0;
resolved.forEach((r, i) => {
  const target = targets.get(keys[i]!)!;
  const group = new THREE.Group();
  const color = new THREE.Color(colorFor(i));

  const body = buildGeometry({ ...r.dims, mesh: r.device.mesh });
  body.computeVertexNormals();
  verts += body.attributes.position?.count ?? 0;
  group.add(
    new THREE.Mesh(
      body,
      new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.6 }),
    ),
  );

  const screen = screenGeometry({ ...r.dims, mesh: r.device.mesh });
  if (screen) {
    screen.computeVertexNormals();
    verts += screen.attributes.position?.count ?? 0;
    const mesh = new THREE.Mesh(
      screen,
      // Darkened body color rather than one shared black, so each screen still reads as part of its item.
      new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.35),
        metalness: 0,
        roughness: 0.4,
      }),
    );
    mesh.position.set(0, 0, r.dims.d / 2 + SCREEN_PROUD_MM);
    group.add(mesh);
  }
  group.position.copy(target.pos);
  root.add(group);
});

// Re-centre for AR. computeTargets runs the row from x=0 rightward with the ground at y=0; Quick Look
// anchors to a horizontal plane, so keep the bottom on y=0 (it should sit on the table, not float or
// sink) but centre x and z about the anchor rather than starting the row at the user's tap point.
root.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(root);
const centre = bounds.getCenter(new THREE.Vector3());
root.position.set(-centre.x, -bounds.min.y, -centre.z);

const scene = new THREE.Scene();
scene.add(root);
// Author in metres — AR reads real-world scale off the file, and our geometry is millimetres.
root.scale.setScalar(MM_TO_M);
root.position.multiplyScalar(MM_TO_M);
scene.updateMatrixWorld(true);

const usdz = await new USDZExporter().parseAsync(scene);
// Named like the share slug it will eventually be served under: <a>-vs-<b>.
const name = resolved.map((r) => (r.state ? `${r.slug}-${r.state}` : r.slug)).join('-vs-');
const out = `${process.env.OUT_DIR ?? 'public/models'}/${name}-ar.usdz`;
await writeFile(out, Buffer.from(usdz));

// The layout's own bounds are the reference: if the exported object doesn't match them, items have
// drifted out of the arrangement the comparison shows.
const eb = computeTargetBounds(layoutItems, keys, targets);
const expected = { x: eb.max.x - eb.min.x, y: eb.max.y - eb.min.y, z: eb.max.z - eb.min.z };
const actual = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
const mm = (v: number) => v / MM_TO_M;
console.log(`${name}  (${mode})`);
for (const r of resolved) {
  console.log(
    `  ${r.device.name}${r.state ? ` (${r.state})` : ''}: ${r.dims.w} × ${r.dims.h} × ${r.dims.d} mm`,
  );
}
console.log(`  usdz      ${(usdz.byteLength / 1024).toFixed(1)} kB, ${verts} verts → ${out}`);
console.log(
  `  layout    ${expected.x.toFixed(1)} × ${expected.y.toFixed(1)} × ${expected.z.toFixed(1)} mm (computeTargetBounds)`,
);
console.log(
  `  exported  ${mm(actual.x).toFixed(1)} × ${mm(actual.y).toFixed(1)} × ${mm(actual.z).toFixed(1)} mm`,
);
// Width and height must match the layout exactly. Depth is allowed to come in under it:
// computeTargetBounds pads screened items by d/2 + 0.5 for the camera fit, while the real screen sits
// at SCREEN_PROUD_MM.
const dx = Math.abs(mm(actual.x) - expected.x);
const dy = Math.abs(mm(actual.y) - expected.y);
if (dx > 0.01 || dy > 0.01) {
  console.error(`  FAIL      w/h off the layout by ${dx.toFixed(3)} / ${dy.toFixed(3)} mm`);
  process.exit(1);
}
console.log('  layout    ✓ matches computeTargets');
