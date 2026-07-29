// USDZ authoring with no dependencies, so a Worker can compose one per request.
//
// A USDZ is a zip with three constraints Apple enforces and AR Quick Look fails *silently* on: every
// entry is STORED (never deflated), each entry's file data begins on a 64-byte boundary, and the first
// entry is the root layer. Padding to that boundary goes in the local header's extra field.
//
// Output is deterministic — fixed mtime, stable ordering — so the same comparison always produces
// identical bytes and can be cached and ETagged by URL.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Bytes of padding to insert as an extra field so `base + extraLen` lands on 64. An extra field can't
// be 1-3 bytes: it needs its own 4-byte id+size header, so anything short of that borrows a full block.
function padFor(base: number): number {
  let need = (64 - (base % 64)) % 64;
  if (need > 0 && need < 4) need += 64;
  return need;
}

const PAD_EXTRA_ID = 0x1986; // arbitrary; readers skip unknown extra fields
const DOS_TIME = 0; // fixed so output is byte-stable across builds and requests
const DOS_DATE = 0x21; // 1980-01-01

export function zipStored(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const named = entries.map((e) => ({ ...e, nameBytes: enc.encode(e.name) }));

  // Pass one: size everything so we can allocate exactly and know each entry's offset.
  let total = 0;
  const plan = named.map((e) => {
    const local = total;
    const extraLen = padFor(local + 30 + e.nameBytes.length);
    total += 30 + e.nameBytes.length + extraLen + e.data.length;
    return { ...e, local, extraLen, crc: crc32(e.data) };
  });
  const cdStart = total;
  for (const e of plan) total += 46 + e.nameBytes.length;
  const out = new Uint8Array(total + 22);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v: number) => {
    view.setUint16(p, v, true);
    p += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(p, v, true);
    p += 4;
  };
  const bytes = (b: Uint8Array) => {
    out.set(b, p);
    p += b.length;
  };

  for (const e of plan) {
    u32(0x04034b50);
    u16(20); // version needed
    u16(0); // flags
    u16(0); // method 0 = stored
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(e.crc);
    u32(e.data.length); // compressed == uncompressed
    u32(e.data.length);
    u16(e.nameBytes.length);
    u16(e.extraLen);
    bytes(e.nameBytes);
    if (e.extraLen) {
      u16(PAD_EXTRA_ID);
      u16(e.extraLen - 4);
      p += e.extraLen - 4; // already zero-filled
    }
    bytes(e.data);
  }

  for (const e of plan) {
    u32(0x02014b50);
    u16(20); // version made by
    u16(20); // version needed
    u16(0);
    u16(0);
    u16(DOS_TIME);
    u16(DOS_DATE);
    u32(e.crc);
    u32(e.data.length);
    u32(e.data.length);
    u16(e.nameBytes.length);
    u16(0); // no extra in the central directory
    u16(0); // no comment
    u16(0); // disk
    u16(0); // internal attrs
    u32(0); // external attrs
    u32(e.local);
    bytes(e.nameBytes);
  }

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(plan.length);
  u16(plan.length);
  u32(total - cdStart);
  u32(cdStart);
  u16(0);
  return out;
}

// ---------------------------------------------------------------------------
// USD text
// ---------------------------------------------------------------------------

export interface UsdMesh {
  name: string;
  positions: ArrayLike<number>; // xyz triples
  normals?: ArrayLike<number>;
  // Triangle indices. Omitted means the positions are already a triangle soup.
  indices?: ArrayLike<number>;
}

// Trims float noise: USD ASCII is ~110 bytes/vertex at full precision, and geometry authored in
// millimetres doesn't need more than micron resolution.
const num = (v: number) => {
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};

function triples(a: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i < a.length; i += 3) {
    parts.push(`(${num(a[i]!)}, ${num(a[i + 1]!)}, ${num(a[i + 2]!)})`);
  }
  return parts.join(', ');
}

// One mesh prim, wrapped in a same-named scope so the root layer can reference `</Name>` and pick up
// the mesh beneath it — the shape three's exporter emits and Quick Look is known to accept.
function meshPrim(m: UsdMesh): string {
  if (m.positions.length % 3 !== 0) {
    throw new Error(`${m.name}: positions must be xyz triples, got ${m.positions.length}`);
  }
  const count = m.positions.length / 3;
  const idx = m.indices ? Array.from(m.indices) : Array.from({ length: count }, (_, i) => i);
  if (idx.length % 3 !== 0) {
    throw new Error(`${m.name}: needs whole triangles, got ${idx.length} indices`);
  }
  if (m.normals && m.normals.length !== m.positions.length) {
    throw new Error(`${m.name}: ${m.normals.length} normals for ${m.positions.length} positions`);
  }
  const faces = new Array(idx.length / 3).fill(3);
  const normals = m.normals
    ? `\n\t\tnormal3f[] normals = [${triples(m.normals)}] (\n\t\t\tinterpolation = "vertex"\n\t\t)`
    : '';
  return `def "${m.name}"
{
	def Mesh "${m.name}"
	{
		int[] faceVertexCounts = [${faces.join(', ')}]
		int[] faceVertexIndices = [${idx.join(', ')}]${normals}
		point3f[] points = [${triples(m.positions)}]
		uniform token subdivisionScheme = "none"
	}
}`;
}

const LAYER_HEADER = `#usda 1.0
(
	defaultPrim = "Root"
	metersPerUnit = 1
	upAxis = "Y"
)
`;

// A geometry-only layer, referenced by a root layer inside the same package. Prim names are ours
// (not counter-generated), so the root can reference them by a stable path.
export function usdGeometryLayer(meshes: UsdMesh[]): string {
  return `${LAYER_HEADER}\n${meshes.map(meshPrim).join('\n\n')}\n`;
}

export interface UsdPlacement {
  // Prim name for this instance; must be unique within the scene.
  name: string;
  // Package-relative layer path and the prim inside it, e.g. 'geometries/x.usda' + 'Body'.
  layer: string;
  prim: string;
  // Translation in the scene's own units (millimetres here).
  translate: { x: number; y: number; z: number };
  // '#rrggbb'.
  color: string;
  opacity?: number;
}

function srgbTriple(hex: string): string {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  // UsdPreviewSurface diffuseColor is linear; the palette is sRGB.
  const lin = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return `(${lin.map(num).join(', ')})`;
}

// Row-major matrix4d with the translation in the last row, which is USD's convention.
function matrix(t: { x: number; y: number; z: number }, scale = 1): string {
  return `( (${num(scale)}, 0, 0, 0), (0, ${num(scale)}, 0, 0), (0, 0, ${num(scale)}, 0), (${num(t.x)}, ${num(t.y)}, ${num(t.z)}, 1) )`;
}

// The root layer: an anchored scene of placements, each referencing a geometry layer in the package
// and binding its own material. `unitScale` converts the placements' units to metres, which is what AR
// reads real-world size from.
export function usdRootLayer(placements: UsdPlacement[], unitScale: number): string {
  const items = placements
    .map(
      (p) => `			def Xform "${p.name}" (
				prepend references = @./${p.layer}@</${p.prim}>
				prepend apiSchemas = ["MaterialBindingAPI"]
			)
			{
				matrix4d xformOp:transform = ${matrix(p.translate)}
				uniform token[] xformOpOrder = ["xformOp:transform"]
				rel material:binding = </Materials/${p.name}_mat>
			}`,
    )
    .join('\n');
  const materials = placements
    .map(
      (p) => `	def Material "${p.name}_mat"
	{
		token outputs:surface.connect = </Materials/${p.name}_mat/PreviewSurface.outputs:surface>

		def Shader "PreviewSurface"
		{
			uniform token info:id = "UsdPreviewSurface"
			color3f inputs:diffuseColor = ${srgbTriple(p.color)}
			float inputs:roughness = 0.6
			float inputs:metallic = 0.05
			float inputs:opacity = ${num(p.opacity ?? 1)}
			int inputs:useSpecularWorkflow = 0
			token outputs:surface
		}
	}`,
    )
    .join('\n');

  return `${LAYER_HEADER}
def Xform "Root"
{
	def Scope "Scenes" (
		kind = "sceneLibrary"
	)
	{
		def Xform "Scene" (
			customData = {
				bool preliminary_collidesWithEnvironment = 0
				string sceneName = "Comparison"
			}
			sceneName = "Comparison"
		)
		{
			token preliminary:anchoring:type = "plane"
			token preliminary:planeAnchoring:alignment = "horizontal"

			def Xform "Content"
			{
				matrix4d xformOp:transform = ${matrix({ x: 0, y: 0, z: 0 }, unitScale)}
				uniform token[] xformOpOrder = ["xformOp:transform"]

${items.replace(/^/gm, '\t')}
			}
		}
	}
}

def "Materials"
{
${materials}
}
`;
}

// A centred box, four vertices per face so each face gets a flat normal. Custom items carry arbitrary
// dimensions, so no pre-built layer can exist for them — but a box needs no extruder, so the Worker
// generates these itself rather than failing.
export function boxMesh(name: string, w: number, h: number, d: number): UsdMesh {
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
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach((f, i) => {
    for (const v of f.q) {
      positions.push(...v);
      normals.push(...f.n);
    }
    const b = i * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { name, positions, normals, indices };
}

// Assembles the package. The root layer must be first.
export function buildUsdz(root: string, layers: Map<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [{ name: 'model.usda', data: enc.encode(root) }];
  for (const [name, text] of layers) entries.push({ name, data: enc.encode(text) });
  return zipStored(entries);
}
