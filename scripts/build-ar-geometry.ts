// Emits one USD geometry layer per catalog item (and per state) into public/ar/, for the Worker's
// /ar/*.usdz route to reference. The Worker composes a root layer and zips; it never generates
// geometry, because the rounded profiles need three's extruder and the Worker shouldn't carry three.
//
//   node --experimental-strip-types scripts/build-ar-geometry.ts
//
// Each layer holds up to two prims — Body and Screen — both centred on the origin. The root layer
// applies each item's placement, including the screen's offset off the front face, so the same layer
// serves any comparison the item appears in.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type * as THREE from 'three';
// Keys come from the same function the Worker looks them up with, so a layer is never written under a
// name the route won't find.
import { geometryKey } from '../src/shared/ar.ts';
import type { Catalog, Device } from '../src/shared/types.ts';
import { deviceDims } from '../src/shared/types.ts';
import { type UsdMesh, usdGeometryLayer } from '../src/shared/usdz.ts';
import { buildGeometry, screenGeometry } from '../src/three/geometry.ts';

const OUT = process.env.OUT_DIR ?? 'public/ar';

function mesh(name: string, geo: THREE.BufferGeometry): UsdMesh {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  if (!pos) throw new Error(`${name}: geometry has no position attribute`);
  return {
    name,
    positions: pos.array as ArrayLike<number>,
    normals: nor ? (nor.array as ArrayLike<number>) : undefined,
    indices: geo.index ? (geo.index.array as ArrayLike<number>) : undefined,
  };
}

const catalog: Catalog = JSON.parse(await readFile('public/devices.json', 'utf8'));
await mkdir(OUT, { recursive: true });

// A device contributes one layer per state, or a single layer when it has none.
type Variant = { device: Device; state?: string };
const variants: Variant[] = catalog.devices.flatMap((device): Variant[] =>
  device.states?.length ? device.states.map((s) => ({ device, state: s.label })) : [{ device }],
);

let bytes = 0;
let withScreen = 0;
for (const { device, state } of variants) {
  const dims = deviceDims(device, state);
  const spec = { ...dims, mesh: device.mesh };

  const body = buildGeometry(spec);
  body.computeVertexNormals();
  const meshes: UsdMesh[] = [mesh('Body', body)];

  const screen = screenGeometry(spec);
  if (screen) {
    screen.computeVertexNormals();
    meshes.push(mesh('Screen', screen));
    withScreen++;
  }

  const key = geometryKey(device, state);
  const text = usdGeometryLayer(meshes);
  await writeFile(`${OUT}/${key}.usda`, text);
  bytes += text.length;
}

console.log(
  `Wrote ${variants.length} geometry layers (${withScreen} with a screen) to ${OUT}/ — ` +
    `${(bytes / 1024 / 1024).toFixed(2)} MB total, ${(bytes / variants.length / 1024).toFixed(0)} kB avg`,
);
