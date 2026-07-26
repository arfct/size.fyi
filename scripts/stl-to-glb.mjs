// Minimal STL -> GLB converter. Uses three's STLLoader (handles ASCII + binary STL, computes
// normals) for parsing, then writes a self-contained binary glTF by hand — no browser-only
// exporter shims, no extra deps. Non-indexed POSITION + NORMAL, one default PBR material.
//
// Usage: node scripts/stl-to-glb.mjs <in.stl> <out.glb> [--scale N]
// Coordinates are passed through unchanged (STL is typically millimeters); scale with --scale
// (e.g. 0.001 for mm->m) when a consumer needs metres.

import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const [, , inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: stl-to-glb.mjs <in.stl> <out.glb> [--scale N]');
  process.exit(1);
}
const scaleIdx = rest.indexOf('--scale');
const scale = scaleIdx >= 0 ? Number(rest[scaleIdx + 1]) : 1;

const buf = await readFile(inPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const geo = new STLLoader().parse(ab);
if (!geo.attributes.normal) geo.computeVertexNormals();

const position = Float32Array.from(geo.attributes.position.array, (v) => v * scale);
const normal = Float32Array.from(geo.attributes.normal.array);
const count = position.length / 3;

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < position.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    const v = position[i + a];
    if (v < min[a]) min[a] = v;
    if (v > max[a]) max[a] = v;
  }
}

const pad4 = (n) => (n + 3) & ~3;
const posBytes = position.byteLength;
const normOffset = pad4(posBytes);
const binLength = pad4(normOffset + normal.byteLength);
const bin = Buffer.alloc(binLength);
Buffer.from(position.buffer, position.byteOffset, posBytes).copy(bin, 0);
Buffer.from(normal.buffer, normal.byteOffset, normal.byteLength).copy(bin, normOffset);

const gltf = {
  asset: { version: '2.0', generator: 'size.fyi stl-to-glb' },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
  materials: [
    {
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.8, 0.82, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.6,
      },
      name: 'default',
    },
  ],
  buffers: [{ byteLength: binLength }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
    { buffer: 0, byteOffset: normOffset, byteLength: normal.byteLength, target: 34962 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
  ],
};

const jsonChunk = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadded = Buffer.alloc(pad4(jsonChunk.length), 0x20); // pad with spaces
jsonChunk.copy(jsonPadded);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

await writeFile(outPath, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]));
const dim = (i) => (max[i] - min[i]).toFixed(1);
console.log(
  `${outPath}: ${count.toLocaleString()} verts, bbox ${dim(0)} × ${dim(1)} × ${dim(2)} (units), ${(binLength / 1e6).toFixed(2)} MB`,
);
