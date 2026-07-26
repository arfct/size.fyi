// Optimize raw device GLBs (converted from CAD via stl-to-glb.mjs) into small, web-ready models:
// weld → decimate to a triangle budget → prune/dedup → quantize (KHR_mesh_quantization, decoded
// natively by three, no separate decoder to host). Output lands in public/models/.
//
// Usage: node scripts/build-models.mjs <src-dir>
// Regenerating sources: fetch the Core Devices solid models from github.com/coredevices/hardware
// and run scripts/stl-to-glb.mjs on them first.
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('usage: build-models.mjs <src-dir>');
  process.exit(1);
}
const OUT = 'public/models';
const TRI_BUDGET = 8000; // plenty for a device at comparison scale

await MeshoptSimplifier.ready;
await mkdir(OUT, { recursive: true });
const io = new NodeIO();

const triCount = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce(
      (n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3,
      0,
    );

for (const file of (await readdir(srcDir)).filter((f) => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(srcDir, file));
  // Drop the STL's per-face normals: they'd otherwise keep coincident vertices distinct so nothing
  // welds and simplify can't collapse anything. three recomputes vertex normals when the model is
  // loaded, so shipping without normals is both smaller and correct for our shading.
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
  const before = triCount(doc);
  const ratio = Math.min(1, TRI_BUDGET / before);
  // No quantization: positions stay plain float32 so the scene can merge/transform the geometry
  // on the CPU without dequantization gymnastics.
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
    prune(),
    dedup(),
  );
  const outPath = path.join(OUT, file);
  await io.write(outPath, doc);
  const { size } = await import('node:fs').then((fs) => fs.promises.stat(outPath));
  console.log(
    `${file}: ${Math.round(before / 1000)}k → ${Math.round(triCount(doc) / 1000)}k tris, ${(size / 1024).toFixed(0)} KB`,
  );
}
