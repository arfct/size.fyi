import { describe, expect, test } from 'vitest';
import { boxGlb, buildGlb, type GlbPlacement } from '../glb';

// Parses the container the way a reader does, so the assertions are about the emitted bytes rather
// than our own bookkeeping.
function parse(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  expect(view.getUint32(4, true)).toBe(2);
  const total = view.getUint32(8, true);
  const jsonLen = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a); // 'JSON'
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const binLen = view.getUint32(20 + jsonLen, true);
  expect(view.getUint32(24 + jsonLen, true)).toBe(0x004e4942); // 'BIN'
  const bin = glb.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  return { total, json, bin, jsonLen };
}

const place = (over: Partial<GlbPlacement> = {}): GlbPlacement => {
  const { part } = boxGlb(10, 20, 30);
  return {
    name: 'Item_0',
    blob: 0,
    part,
    translate: { x: 1, y: 2, z: 3 },
    color: '#0072B2',
    ...over,
  };
};

describe('boxGlb', () => {
  test('emits 24 vertices and 36 indices, one quad per face', () => {
    const { blob, part } = boxGlb(10, 20, 30);
    expect(part.position.count).toBe(24);
    expect(part.normal?.count).toBe(24);
    expect(part.index?.count).toBe(36);
    // Indices are uint16, so 2 bytes each; the blob is positions + normals + indices.
    expect(blob.length).toBe(24 * 12 + 24 * 12 + 36 * 2);
  });

  test('reports bounds matching the requested dimensions', () => {
    const { part } = boxGlb(10, 20, 30);
    expect(part.min).toEqual([-5, -10, -15]);
    expect(part.max).toEqual([5, 10, 15]);
  });

  test('is a whole number of 4-byte words, so it can be concatenated safely', () => {
    for (const d of [1, 7, 13.5, 100]) expect(boxGlb(d, d, d).blob.length % 4).toBe(0);
  });
});

describe('buildGlb', () => {
  test('emits a valid container with 4-byte-aligned chunks', () => {
    const { blob } = boxGlb(10, 20, 30);
    const glb = buildGlb([blob], [place()], 0.001);
    const { total, jsonLen } = parse(glb);
    expect(total).toBe(glb.length);
    expect(jsonLen % 4).toBe(0);
    expect(glb.length % 4).toBe(0);
  });

  test('pads the JSON chunk with spaces so it stays parseable', () => {
    // A name of awkward length forces padding; JSON.parse would throw on NUL bytes.
    const { blob } = boxGlb(1, 1, 1);
    const glb = buildGlb([blob], [place({ name: 'x' })], 0.001);
    expect(() => parse(glb)).not.toThrow();
  });

  test('aligns every bufferView offset to 4, as float and uint32 accessors require', () => {
    const a = boxGlb(1, 2, 3);
    const b = boxGlb(4, 5, 6);
    const glb = buildGlb(
      [a.blob, b.blob],
      [place({ part: a.part, blob: 0 }), place({ name: 'Item_1', part: b.part, blob: 1 })],
      0.001,
    );
    const { json } = parse(glb);
    expect(json.bufferViews.length).toBe(6); // position + normal + index, twice
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  test('copies a shared blob once however many meshes reference it', () => {
    // A body and its screen live in one blob; copying it twice would double the payload.
    const { blob, part } = boxGlb(10, 20, 30);
    const one = buildGlb([blob], [place()], 0.001);
    const two = buildGlb([blob], [place(), place({ name: 'Item_0_screen', part })], 0.001);
    const binOf = (g: Uint8Array) => parse(g).bin.length;
    expect(binOf(two)).toBe(binOf(one));
    expect(parse(two).json.meshes.length).toBe(2);
  });

  test('puts the unit scale on a parent node, keeping item translations in authoring units', () => {
    const { blob } = boxGlb(10, 20, 30);
    const { json } = parse(buildGlb([blob], [place()], 0.001));
    const root = json.nodes[json.scenes[0].nodes[0]];
    expect(root.scale).toEqual([0.001, 0.001, 0.001]);
    expect(json.nodes[root.children[0]].translation).toEqual([1, 2, 3]);
  });

  test('declares a buffer whose length matches the BIN chunk', () => {
    const { blob } = boxGlb(10, 20, 30);
    const glb = buildGlb([blob], [place()], 0.001);
    const { json, bin } = parse(glb);
    // The chunk may carry trailing pad; the declared buffer must not exceed it.
    expect(json.buffers[0].byteLength).toBeLessThanOrEqual(bin.length);
    expect(json.buffers[0].byteLength).toBe(blob.length);
  });

  test('converts sRGB palette colours to linear for baseColorFactor', () => {
    const { blob } = boxGlb(1, 1, 1);
    const { json } = parse(buildGlb([blob], [place({ color: '#0072B2' })], 0.001));
    const [r, g, b, a] = json.materials[0].pbrMetallicRoughness.baseColorFactor;
    expect(r).toBeCloseTo(0, 3);
    expect(g).toBeCloseTo(0.1683, 3);
    expect(b).toBeCloseTo(0.4452, 3);
    expect(a).toBe(1);
  });

  test('gives each placement its own material and mesh', () => {
    const { blob } = boxGlb(1, 1, 1);
    const { json } = parse(
      buildGlb([blob], [place(), place({ name: 'Item_1', color: '#D55E00' })], 0.001),
    );
    expect(json.meshes.map((m: { name: string }) => m.name)).toEqual(['Item_0', 'Item_1']);
    expect(json.materials.length).toBe(2);
    expect(json.meshes[1].primitives[0].material).toBe(1);
  });

  test('omits indices for non-indexed geometry rather than emitting an empty accessor', () => {
    const { blob, part } = boxGlb(1, 1, 1);
    const noIndex = { ...part, index: undefined };
    const { json } = parse(buildGlb([blob], [place({ part: noIndex })], 0.001));
    expect(json.meshes[0].primitives[0].indices).toBeUndefined();
    expect(json.accessors.length).toBe(2); // position + normal only
  });
});

// Regression: Scene Viewer answered "Unable to view in your space" for a GLB that three and
// gltf-transform both read happily. Three structural differences from a GLB known to work on Android
// explained it — these lock in all three.
describe('Scene Viewer compatibility', () => {
  test('uses UNSIGNED_SHORT indices, not UNSIGNED_INT', () => {
    const { blob, part } = boxGlb(10, 20, 30);
    expect(part.indexComponentType).toBe(5123);
    const { json } = parse(buildGlb([blob], [place()], 0.001));
    const idx = json.accessors[json.meshes[0].primitives[0].indices];
    expect(idx.componentType).toBe(5123);
  });

  test('declares bufferView targets', () => {
    const { blob } = boxGlb(10, 20, 30);
    const { json } = parse(buildGlb([blob], [place()], 0.001));
    const targets = json.bufferViews.map((v: { target: number }) => v.target);
    expect(targets).toContain(34962); // ARRAY_BUFFER, for attributes
    expect(targets).toContain(34963); // ELEMENT_ARRAY_BUFFER, for indices
    for (const v of json.bufferViews) expect(v.target).toBeDefined();
  });

  test('states the primitive mode rather than relying on the default', () => {
    const { blob } = boxGlb(10, 20, 30);
    const { json } = parse(buildGlb([blob], [place()], 0.001));
    expect(json.meshes[0].primitives[0].mode).toBe(4); // TRIANGLES
  });

  // Plumbing only — the declared component type follows the part, for geometry that ever needs the
  // wider index type.
  test('honours an explicit UNSIGNED_INT part', () => {
    const { blob, part } = boxGlb(1, 1, 1);
    const wide = { ...part, indexComponentType: 5125 as const };
    const { json } = parse(buildGlb([blob], [place({ part: wide })], 0.001));
    expect(json.accessors[json.meshes[0].primitives[0].indices].componentType).toBe(5125);
  });

  test('index byteOffset stays aligned to its component size', () => {
    const { blob, part } = boxGlb(10, 20, 30);
    const { json } = parse(buildGlb([blob], [place()], 0.001));
    const idxAccessor = json.accessors[json.meshes[0].primitives[0].indices];
    const view = json.bufferViews[idxAccessor.bufferView];
    expect(view.byteOffset % 2).toBe(0);
    expect(part.index!.byteLength).toBe(36 * 2);
  });
});
