import { describe, expect, test } from 'vitest';
import { buildUsdz, crc32, usdGeometryLayer, usdRootLayer, zipStored } from '../usdz';

const enc = new TextEncoder();
const entry = (name: string, text: string) => ({ name, data: enc.encode(text) });

// Walks the local file headers the way a reader does, returning where each entry's data begins.
function dataOffsets(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: { name: string; offset: number; size: number; method: number }[] = [];
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(zip.subarray(p + 30, p + 30 + nameLen));
    const offset = p + 30 + nameLen + extraLen;
    out.push({ name, offset, size, method });
    p = offset + size;
  }
  return out;
}

describe('crc32', () => {
  // The canonical check value from the CRC-32 spec.
  test('matches the known value for "123456789"', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  test('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStored', () => {
  test('every entry starts its data on a 64-byte boundary', () => {
    // Names of varying length so the padding has to do real work in each case.
    const zip = zipStored([
      entry('model.usda', 'a'),
      entry('g/x.usda', 'b'.repeat(100)),
      entry('geometries/some-long-name.usda', 'c'.repeat(7)),
      entry('q.usda', 'd'.repeat(64)),
    ]);
    const offsets = dataOffsets(zip);
    expect(offsets).toHaveLength(4);
    for (const e of offsets) expect(e.offset % 64).toBe(0);
  });

  test('stays aligned across name lengths that stress the sub-4-byte pad case', () => {
    // An extra field can't be 1-3 bytes, so a base landing 1-3 short of 64 must borrow a whole block.
    for (let n = 1; n <= 80; n++) {
      const zip = zipStored([entry('a'.repeat(n), 'x')]);
      expect(dataOffsets(zip)[0]!.offset % 64).toBe(0);
    }
  });

  test('stores rather than deflates, and round-trips the bytes', () => {
    const text = 'hello usdz'.repeat(50);
    const zip = zipStored([entry('model.usda', text)]);
    const [e] = dataOffsets(zip);
    expect(e!.method).toBe(0);
    expect(e!.size).toBe(enc.encode(text).length);
    expect(new TextDecoder().decode(zip.subarray(e!.offset, e!.offset + e!.size))).toBe(text);
  });

  test('is byte-identical across calls, so a comparison can be cached by URL', () => {
    const make = () => zipStored([entry('model.usda', 'x'), entry('g.usda', 'y')]);
    expect(Array.from(make())).toEqual(Array.from(make()));
  });

  test('records a central directory entry per file', () => {
    const zip = zipStored([entry('a.usda', '1'), entry('b.usda', '2'), entry('c.usda', '3')]);
    const view = new DataView(zip.buffer);
    // End-of-central-directory is the last 22 bytes for an empty comment.
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(3);
  });
});

describe('usdGeometryLayer', () => {
  const tri = {
    name: 'Body',
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  };

  test('emits a referenceable prim with subdivision disabled', () => {
    const usda = usdGeometryLayer([tri]);
    expect(usda).toContain('#usda 1.0');
    // Without this, Quick Look smooths the mesh and the item stops matching its stated dimensions.
    expect(usda).toContain('uniform token subdivisionScheme = "none"');
    expect(usda).toContain('def "Body"');
    expect(usda).toContain('def Mesh "Body"');
  });

  test('derives triangle faces and implicit indices from the positions', () => {
    const usda = usdGeometryLayer([tri]);
    expect(usda).toContain('int[] faceVertexCounts = [3]');
    expect(usda).toContain('int[] faceVertexIndices = [0, 1, 2]');
  });

  test('keeps explicit indices when given', () => {
    const usda = usdGeometryLayer([{ ...tri, indices: [2, 1, 0] }]);
    expect(usda).toContain('int[] faceVertexIndices = [2, 1, 0]');
  });

  test('omits normals rather than emitting an empty array', () => {
    const usda = usdGeometryLayer([{ name: 'B', positions: tri.positions }]);
    expect(usda).not.toContain('normals');
  });

  test('carries several prims so one layer can hold a body and its screen', () => {
    const usda = usdGeometryLayer([tri, { ...tri, name: 'Screen' }]);
    expect(usda).toContain('def "Body"');
    expect(usda).toContain('def "Screen"');
  });
});

describe('usdRootLayer', () => {
  const place = {
    name: 'Item_0',
    layer: 'geometries/x.usda',
    prim: 'Body',
    translate: { x: 1.5, y: 2, z: -3 },
    color: '#0072B2',
  };

  test('references the layer prim and binds a per-item material', () => {
    const usda = usdRootLayer([place], 0.001);
    expect(usda).toContain('prepend references = @./geometries/x.usda@</Body>');
    expect(usda).toContain('rel material:binding = </Materials/Item_0_mat>');
    expect(usda).toContain('def Material "Item_0_mat"');
  });

  test('anchors to a horizontal plane so AR places it on a table', () => {
    const usda = usdRootLayer([place], 0.001);
    expect(usda).toContain('token preliminary:anchoring:type = "plane"');
    expect(usda).toContain('token preliminary:planeAnchoring:alignment = "horizontal"');
  });

  test('puts translation in the last matrix row, USD-style', () => {
    const usda = usdRootLayer([place], 0.001);
    expect(usda).toContain('(1.5, 2, -3, 1)');
  });

  test('carries the unit scale on the content transform, not on each item', () => {
    const usda = usdRootLayer([place], 0.001);
    expect(usda).toContain('(0.001, 0, 0, 0)');
  });

  test('converts sRGB palette colors to linear for UsdPreviewSurface', () => {
    // #0072B2 is sRGB (0, 0.447, 0.698); linear is (0, 0.1683, 0.4452) — materially darker, so
    // skipping the conversion would show up as washed-out items in AR.
    const usda = usdRootLayer([place], 0.001);
    const m = usda.match(/inputs:diffuseColor = \(([^)]+)\)/);
    expect(m).not.toBeNull();
    const [r, g, b] = m![1]!.split(',').map((s) => Number.parseFloat(s));
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0.1683, 3);
    expect(b).toBeCloseTo(0.4452, 3);
  });

  test('names every placement uniquely so prims do not collide', () => {
    const usda = usdRootLayer([place, { ...place, name: 'Item_1' }], 0.001);
    expect(usda).toContain('def Xform "Item_0"');
    expect(usda).toContain('def Xform "Item_1"');
  });
});

describe('buildUsdz', () => {
  test('puts the root layer first, as the format requires', () => {
    const zip = buildUsdz('#usda 1.0\n', new Map([['geometries/a.usda', '#usda 1.0\n']]));
    const names = dataOffsets(zip).map((e) => e.name);
    expect(names[0]).toBe('model.usda');
    expect(names).toEqual(['model.usda', 'geometries/a.usda']);
  });

  test('aligns a realistic multi-layer package', () => {
    const layers = new Map([
      [
        'geometries/iphone-13-mini.usda',
        usdGeometryLayer([{ name: 'Body', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }]),
      ],
      [
        'geometries/galaxy-z-fold8-closed.usda',
        usdGeometryLayer([{ name: 'Body', positions: [1, 1, 1, 2, 1, 1, 1, 2, 1] }]),
      ],
    ]);
    const root = usdRootLayer(
      [
        {
          name: 'Item_0',
          layer: 'geometries/iphone-13-mini.usda',
          prim: 'Body',
          translate: { x: 0, y: 0, z: 0 },
          color: '#0072B2',
        },
      ],
      0.001,
    );
    for (const e of dataOffsets(buildUsdz(root, layers))) expect(e.offset % 64).toBe(0);
  });
});
