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
import type { GlbGeometry, GlbPart, GlbRange } from '../src/shared/glb.ts';
import type { Catalog, Device } from '../src/shared/types.ts';
import { deviceDims } from '../src/shared/types.ts';
import { type UsdMesh, usdGeometryLayer } from '../src/shared/usdz.ts';
import { buildGeometry, screenGeometry } from '../src/three/geometry.ts';

const OUT = process.env.OUT_DIR ?? 'public/ar';
// GLB blobs are authored in metres; the USD layers stay in millimetres, where a scale on the root
// Xform is honoured and already verified on-device.
const MM_TO_M = 0.001;

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

// Packs one geometry into the item's binary blob. Everything is Float32 or Uint32, so each range lands
// 4-aligned on its own — which is what glTF requires of a bufferView offset.
function packPart(
  chunks: Uint8Array[],
  geo: THREE.BufferGeometry,
  at: { offset: number },
): GlbPart {
  const pos = geo.attributes.position;
  if (!pos) throw new Error('geometry has no position attribute');
  type Packable = Float32Array | Uint32Array | Uint16Array | Uint8Array;
  const push = (data: Packable, count: number): GlbRange => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const range = { byteOffset: at.offset, byteLength: bytes.length, count };
    chunks.push(bytes);
    at.offset += bytes.length;
    return range;
  };

  // Metres, baked into the vertex data rather than left to a node scale.
  //
  // Scene Viewer rendered a mm-authored model fine in its 3D view but refused AR with "unable to view
  // in your space", because a size estimate taken from POSITION accessor bounds — without walking the
  // node hierarchy — read a 0.44 m comparison as 440 m, which is not placeable in a room. Node
  // transforms are not a reliable carrier of real-world scale; the geometry has to be right.
  const posArr = new Float32Array(pos.array as ArrayLike<number>);
  for (let i = 0; i < posArr.length; i++) posArr[i] = posArr[i]! * MM_TO_M;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posArr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = posArr[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }

  const part: GlbPart = { position: push(posArr, pos.count), min, max };
  const nor = geo.attributes.normal;
  if (nor) part.normal = push(new Float32Array(nor.array as ArrayLike<number>), nor.count);

  // Uint16 wherever it fits, which is everywhere in this catalog — the largest body is ~2.5k vertices.
  // Uint32 indices are legal glTF but the thing every mobile renderer is least likely to accept, and
  // Scene Viewer rejected them. Uint32 stays available in case an imported model ever needs it.
  if (geo.index) {
    const src = geo.index.array as ArrayLike<number>;
    let maxIndex = 0;
    for (let i = 0; i < src.length; i++) if (src[i]! > maxIndex) maxIndex = src[i]!;
    if (maxIndex < 65536) {
      part.index = push(new Uint16Array(src), geo.index.count);
      part.indexComponentType = 5123;
      // Uint16 data can end on a 2-byte boundary; pad with real bytes so the next part's float ranges
      // stay 4-aligned. Bumping the offset alone would desync it from the assembled blob.
      const pad = (4 - (at.offset % 4)) % 4;
      if (pad) push(new Uint8Array(pad), 0);
    } else {
      part.index = push(new Uint32Array(src), geo.index.count);
      part.indexComponentType = 5125;
    }
  }
  return part;
}

let usdBytes = 0;
let binBytes = 0;
let withScreen = 0;
const manifest: Record<string, GlbGeometry> = {};

for (const { device, state } of variants) {
  const dims = deviceDims(device, state);
  const spec = { ...dims, mesh: device.mesh };
  const key = geometryKey(device, state);

  const body = buildGeometry(spec);
  body.computeVertexNormals();
  const meshes: UsdMesh[] = [mesh('Body', body)];
  const screen = screenGeometry(spec);
  if (screen) {
    screen.computeVertexNormals();
    meshes.push(mesh('Screen', screen));
    withScreen++;
  }

  // iOS: a USD layer the Worker references by path.
  const text = usdGeometryLayer(meshes);
  await writeFile(`${OUT}/${key}.usda`, text);
  usdBytes += text.length;

  // Android: raw vertex data the Worker concatenates into a GLB's BIN chunk. Body and screen share one
  // blob so a comparison costs one fetch per item, not per mesh.
  const chunks: Uint8Array[] = [];
  const at = { offset: 0 };
  const entry: GlbGeometry = { byteLength: 0, body: packPart(chunks, body, at) };
  if (screen) entry.screen = packPart(chunks, screen, at);
  entry.byteLength = at.offset;
  const blob = new Uint8Array(at.offset);
  let o = 0;
  for (const c of chunks) {
    blob.set(c, o);
    o += c.length;
  }
  await writeFile(`${OUT}/${key}.bin`, blob);
  binBytes += blob.length;
  manifest[key] = entry;
}

// One manifest for every item, so the Worker learns offsets and accessor bounds in a single fetch it
// can cache for the isolate's lifetime.
await writeFile(`${OUT}/geometry.json`, JSON.stringify(manifest));

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log(
  `Wrote ${variants.length} items (${withScreen} with a screen) to ${OUT}/ — ` +
    `USD ${mb(usdBytes)} MB, GLB blobs ${mb(binBytes)} MB`,
);
