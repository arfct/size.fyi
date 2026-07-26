// Generate per-device AR assets: an opaque, real-scale USDZ for each catalog device that has a
// 3D model, for iOS AR Quick Look. (Android Scene Viewer reuses the device's GLB.) USDZ must be
// OPAQUE — AR Quick Look frustum-culls geometry inside transparent models — and authored in metres.
//
// Runs headless with three's GLTFLoader.parse + USDZExporter (both work in Node for untextured
// models). Reads public/devices.json (so it must run after build-catalog) and public/models/*.glb.
// Usage: node scripts/build-ar.mjs
import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const MM_TO_M = 0.001;
const loader = new GLTFLoader();

const catalog = JSON.parse(await readFile('public/devices.json', 'utf8'));
const withModels = catalog.devices.filter((d) => d.model3d);

for (const d of withModels) {
  const buf = await readFile(`public/models/${d.model3d.url}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));

  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);

  if (d.model3d.rotation) {
    const [rx, ry, rz] = d.model3d.rotation;
    geo.rotateX((rx * Math.PI) / 180);
    geo.rotateY((ry * Math.PI) / 180);
    geo.rotateZ((rz * Math.PI) / 180);
  }
  // Fit to the device's canonical size (mm) so AR shows the honest dimensions, then to metres.
  geo.computeBoundingBox();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const center = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -center.y, -center.z);
  geo.scale(
    (d.w / (size.x || 1)) * MM_TO_M,
    (d.h / (size.y || 1)) * MM_TO_M,
    (d.d / (size.z || 1)) * MM_TO_M,
  );
  geo.computeVertexNormals();

  const scene = new THREE.Scene();
  scene.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.1, roughness: 0.55 }),
    ),
  );
  const usdz = await new USDZExporter().parseAsync(scene);
  const out = `public/models/${d.slug}.usdz`;
  await writeFile(out, Buffer.from(usdz));
  console.log(`${out}: ${(usdz.byteLength / 1024).toFixed(0)} KB (${d.w}×${d.h}×${d.d} mm)`);
}
console.log(`Wrote ${withModels.length} USDZ file(s).`);
