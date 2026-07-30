// GLB authoring with no dependencies, so a Worker can compose one per request — the Android half of
// the AR route. Scene Viewer wants a glTF binary; USD's reference-a-layer trick has no glTF
// equivalent, so instead of composing documents we concatenate pre-built vertex blobs and generate a
// glTF JSON whose bufferViews point into the result. That's offset arithmetic rather than binary
// surgery, because each item's blob is self-contained and copied verbatim.
//
// A GLB is: a 12-byte header, then a JSON chunk, then a BIN chunk. Both chunks are 4-byte aligned —
// JSON padded with spaces, BIN with zeros — and every bufferView offset must be aligned to its
// component size, which is 4 for the float and uint32 data used here.
//
// EVERYTHING HERE IS IN METRES, in the vertex data itself — no scale node. Scene Viewer rendered a
// millimetre-authored model in its 3D view but refused AR, because a size estimate read from POSITION
// accessor bounds without walking the node hierarchy saw a 0.44 m comparison as 440 m. Real-world scale
// has to live in the geometry, not in a transform.

export interface GlbRange {
  byteOffset: number;
  byteLength: number;
  count: number;
}

// One drawable mesh within an item's blob — a body or a screen. Offsets are relative to the blob, so
// the manifest is independent of how the blobs end up laid out in any particular GLB.
export interface GlbPart {
  position: GlbRange;
  normal?: GlbRange;
  index?: GlbRange; // absent for non-indexed geometry, which is valid glTF
  // UNSIGNED_SHORT (5123) or UNSIGNED_INT (5125). Prefer the former: it's what every mobile renderer
  // handles without an extension, and no item here comes close to 65536 vertices.
  indexComponentType?: 5123 | 5125;
  // Required by the glTF spec for POSITION accessors.
  min: [number, number, number];
  max: [number, number, number];
}

// An item's manifest entry. Body and screen live in the same blob, so it's fetched once and copied
// once however many meshes reference it.
export interface GlbGeometry {
  byteLength: number; // whole blob, a multiple of 4
  body: GlbPart;
  screen?: GlbPart;
}

export interface GlbPlacement {
  name: string;
  blob: number; // index into the blobs array passed to buildGlb
  part: GlbPart;
  translate: { x: number; y: number; z: number };
  color: string; // '#rrggbb'
}

// A centred box as a self-contained blob plus its description — the Android counterpart to boxMesh().
// Custom items carry arbitrary dimensions, so no pre-built blob can exist for them, but a box needs no
// extruder. Four vertices per face so each face gets a flat normal. Dimensions are METRES, like every
// other coordinate in this module.
export function boxGlb(w: number, h: number, d: number): { blob: Uint8Array; part: GlbPart } {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const faces: { n: [number, number, number]; q: [number, number, number][] }[] = [
    {
      n: [0, 0, 1],
      q: [
        [-x, -y, z],
        [x, -y, z],
        [x, y, z],
        [-x, y, z],
      ],
    },
    {
      n: [0, 0, -1],
      q: [
        [x, -y, -z],
        [-x, -y, -z],
        [-x, y, -z],
        [x, y, -z],
      ],
    },
    {
      n: [1, 0, 0],
      q: [
        [x, -y, z],
        [x, -y, -z],
        [x, y, -z],
        [x, y, z],
      ],
    },
    {
      n: [-1, 0, 0],
      q: [
        [-x, -y, -z],
        [-x, -y, z],
        [-x, y, z],
        [-x, y, -z],
      ],
    },
    {
      n: [0, 1, 0],
      q: [
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
        [-x, y, -z],
      ],
    },
    {
      n: [0, -1, 0],
      q: [
        [-x, -y, -z],
        [x, -y, -z],
        [x, -y, z],
        [-x, -y, z],
      ],
    },
  ];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);
  faces.forEach((f, i) => {
    f.q.forEach((v, k) => {
      positions.set(v, (i * 4 + k) * 3);
      normals.set(f.n, (i * 4 + k) * 3);
    });
    const b = i * 4;
    indices.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  });

  // Indices go last, and uint16 data can end on a 2-byte boundary (any index count not a multiple of
  // two). Round the blob up so it stays a whole number of 4-byte words, which is what keeps every
  // float accessor's offset 4-aligned once blobs are concatenated. A no-op at 36 indices.
  const idxPadded = indices.byteLength + ((4 - (indices.byteLength % 4)) % 4);
  const blob = new Uint8Array(positions.byteLength + normals.byteLength + idxPadded);
  blob.set(new Uint8Array(positions.buffer), 0);
  blob.set(new Uint8Array(normals.buffer), positions.byteLength);
  blob.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);
  return {
    blob,
    part: {
      position: { byteOffset: 0, byteLength: positions.byteLength, count: 24 },
      normal: { byteOffset: positions.byteLength, byteLength: normals.byteLength, count: 24 },
      index: {
        byteOffset: positions.byteLength + normals.byteLength,
        byteLength: indices.byteLength,
        count: 36,
      },
      indexComponentType: UNSIGNED_SHORT,
      min: [-x, -y, -z],
      max: [x, y, z],
    },
  };
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
// bufferView.target. Optional per spec, but every GLB that Scene Viewer is known to accept sets it,
// and omitting it was one of only three structural differences from a working reference file.
const ARRAY_BUFFER = 34962; // vertex attributes
const ELEMENT_ARRAY_BUFFER = 34963; // indices
const TRIANGLES = 4;

function linearRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    // glTF baseColorFactor is linear; the palette is sRGB.
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

// Builds the whole GLB. Placements carry metre translations and the blobs hold metre coordinates, so
// the scene needs no scale anywhere — which is the point: a transform is not a reliable carrier of
// real-world size.
export function buildGlb(blobs: Uint8Array[], placements: GlbPlacement[]): Uint8Array {
  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];

  // Lay the blobs out back to back, once each however many meshes reference them. Every blob length is
  // a multiple of 4, so each base — and therefore every bufferView offset — stays 4-aligned, which the
  // float and uint32 accessors require.
  let binLength = 0;
  const bases = blobs.map((b) => {
    const base = binLength;
    binLength += b.length + pad4(b.length);
    return base;
  });

  placements.forEach((p) => {
    const base = bases[p.blob]!;
    const view = (r: { byteOffset: number; byteLength: number }, target: number) => {
      bufferViews.push({
        buffer: 0,
        byteOffset: base + r.byteOffset,
        byteLength: r.byteLength,
        target,
      });
      return bufferViews.length - 1;
    };
    const attributes: Record<string, number> = {};

    accessors.push({
      bufferView: view(p.part.position, ARRAY_BUFFER),
      componentType: FLOAT,
      count: p.part.position.count,
      type: 'VEC3',
      min: p.part.min,
      max: p.part.max,
    });
    attributes.POSITION = accessors.length - 1;

    if (p.part.normal) {
      accessors.push({
        bufferView: view(p.part.normal, ARRAY_BUFFER),
        componentType: FLOAT,
        count: p.part.normal.count,
        type: 'VEC3',
      });
      attributes.NORMAL = accessors.length - 1;
    }

    let indices: number | undefined;
    if (p.part.index) {
      accessors.push({
        bufferView: view(p.part.index, ELEMENT_ARRAY_BUFFER),
        componentType: p.part.indexComponentType ?? UNSIGNED_SHORT,
        count: p.part.index.count,
        type: 'SCALAR',
      });
      indices = accessors.length - 1;
    }

    materials.push({
      name: `${p.name}_mat`,
      pbrMetallicRoughness: {
        baseColorFactor: [...linearRgb(p.color), 1],
        metallicFactor: 0.05,
        roughnessFactor: 0.6,
      },
      doubleSided: true,
    });
    meshes.push({
      name: p.name,
      primitives: [
        {
          attributes,
          ...(indices === undefined ? {} : { indices }),
          mode: TRIANGLES,
          material: materials.length - 1,
        },
      ],
    });
    nodes.push({
      name: p.name,
      mesh: meshes.length - 1,
      translation: [p.translate.x, p.translate.y, p.translate.z],
    });
  });

  const gltf = {
    asset: { version: '2.0', generator: 'size.fyi' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  const enc = new TextEncoder();
  let json = enc.encode(JSON.stringify(gltf));
  const jsonPad = pad4(json.length);
  if (jsonPad) {
    // Spaces, not zeros — the JSON chunk must stay parseable text.
    const padded = new Uint8Array(json.length + jsonPad).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const binPad = pad4(binLength);

  const total = 12 + 8 + json.length + 8 + binLength + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  const u32 = (v: number) => {
    view.setUint32(p, v, true);
    p += 4;
  };

  u32(GLB_MAGIC);
  u32(2); // version
  u32(total);
  u32(json.length);
  u32(JSON_CHUNK);
  out.set(json, p);
  p += json.length;
  u32(binLength + binPad);
  u32(BIN_CHUNK);
  blobs.forEach((b, i) => {
    out.set(b, p + bases[i]!);
  });
  return out;
}
