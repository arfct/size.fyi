import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

// Reads the local file headers the way a zip reader does, so we assert on the bytes actually served
// rather than on our own writer's bookkeeping.
function entries(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const out: { name: string; offset: number; size: number; method: number }[] = [];
  let p = 0;
  while (p + 4 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const offset = p + 30 + nameLen + extraLen;
    out.push({ name, offset, size, method });
    p = offset + size;
  }
  return out;
}

const text = (buf: ArrayBuffer, e: { offset: number; size: number }) =>
  new TextDecoder().decode(new Uint8Array(buf, e.offset, e.size));

const AR = 'https://size.fyi/ar/iphone-13-mini-vs-credit-card.usdz';

describe('/ar/<comparison>.usdz', () => {
  test('composes a comparison nobody pre-generated', async () => {
    const res = await SELF.fetch(AR);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/vnd.usdz+zip');
    expect(res.headers.get('etag')).toBeTruthy();
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  test('serves a valid package: root layer first, stored, 64-byte aligned', async () => {
    const buf = await (await SELF.fetch(AR)).arrayBuffer();
    const es = entries(buf);
    expect(es.length).toBeGreaterThanOrEqual(2);
    expect(es[0]!.name).toBe('model.usda');
    for (const e of es) {
      // Both are silent failures in AR Quick Look, so they're worth asserting on every response.
      expect(e.method).toBe(0);
      expect(e.offset % 64).toBe(0);
    }
  });

  test('references each item geometry and binds a material per prim', async () => {
    const buf = await (await SELF.fetch(AR)).arrayBuffer();
    const es = entries(buf);
    const root = text(buf, es[0]!);
    expect(root).toContain('prepend references = @./geometries/iphone-13-mini.usda@</Body>');
    // The iPhone has a screen; the credit card does not.
    expect(root).toContain('</Screen>');
    expect(root).toContain('def Xform "Item_0"');
    expect(root).toContain('def Xform "Item_1"');
    expect(root).toContain('token preliminary:anchoring:type = "plane"');
  });

  test('carries real geometry, not an HTML error page', async () => {
    // The asset layer used to answer a miss with index.html and a 200, which would have been embedded
    // as a geometry layer and shipped as a broken model.
    const buf = await (await SELF.fetch(AR)).arrayBuffer();
    const geo = entries(buf).filter((e) => e.name.startsWith('geometries/'));
    expect(geo.length).toBeGreaterThan(0);
    for (const e of geo) {
      const usda = text(buf, e);
      expect(usda.startsWith('#usda 1.0')).toBe(true);
      expect(usda).not.toContain('<!doctype');
      expect(usda).toContain('uniform token subdivisionScheme = "none"');
    }
  });

  test('generates geometry inline for a custom item, which can have no pre-built layer', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/iphone-13-mini-vs-my_box~200x300x100.usdz');
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    const es = entries(buf);
    expect(es.some((e) => e.name.includes('custom'))).toBe(true);
    for (const e of es) expect(e.offset % 64).toBe(0);
  });

  test('is byte-identical across requests so the URL can be cached hard', async () => {
    const a = new Uint8Array(await (await SELF.fetch(AR)).arrayBuffer());
    const b = new Uint8Array(await (await SELF.fetch(AR)).arrayBuffer());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test('resolves a foldable state to that state, not the default', async () => {
    const closed = await SELF.fetch('https://size.fyi/ar/galaxy-z-fold8-closed.usdz');
    const open = await SELF.fetch('https://size.fyi/ar/galaxy-z-fold8-open.usdz');
    expect(closed.status).toBe(200);
    expect(open.status).toBe(200);
    const cRoot = text(await closed.clone().arrayBuffer(), entries(await closed.arrayBuffer())[0]!);
    expect(cRoot).toContain('galaxy-z-fold8-closed.usda');
    expect(cRoot).not.toContain('galaxy-z-fold8-open.usda');
  });

  test('layout mode changes the model', async () => {
    const row = await (await SELF.fetch(AR)).arrayBuffer();
    const stack = await (await SELF.fetch(`${AR}?layout=stack`)).arrayBuffer();
    const rowRoot = text(row, entries(row)[0]!);
    const stackRoot = text(stack, entries(stack)[0]!);
    expect(rowRoot).not.toBe(stackRoot);
  });

  test('404s an unknown slug rather than serving an empty model', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/not-a-real-device.usdz');
    expect(res.status).toBe(404);
  });
});

describe('missing assets', () => {
  // Regression: not_found_handling was "single-page-application", so any miss returned the app shell
  // with a 200. AR Quick Look then reported a corrupt file with nothing to explain it.
  test('a missing model 404s instead of returning the app shell', async () => {
    const res = await SELF.fetch('https://size.fyi/models/does-not-exist.usdz');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').not.toContain('text/html');
  });

  test('a missing image 404s too', async () => {
    expect((await SELF.fetch('https://size.fyi/nope.png')).status).toBe(404);
  });

  test('app routes still serve the shell', async () => {
    const res = await SELF.fetch('https://size.fyi/iphone-13-mini-vs-credit-card');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>');
  });
});

// Reads the GLB container the way Scene Viewer's parser would.
function glbParse(buf: ArrayBuffer) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  expect(view.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binLen = view.getUint32(20 + jsonLen, true);
  return { json, binLen, total: view.getUint32(8, true) };
}

const GLB = 'https://size.fyi/ar/iphone-13-mini-vs-credit-card.glb';

describe('/ar/<comparison>.glb', () => {
  test('composes a GLB for Android off the same path', async () => {
    const res = await SELF.fetch(GLB);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('etag')).toBeTruthy();
  });

  test('is a well-formed container: version 2, declared length, aligned chunks', async () => {
    const buf = await (await SELF.fetch(GLB)).arrayBuffer();
    const { json, total, binLen } = glbParse(buf);
    expect(total).toBe(buf.byteLength);
    expect(buf.byteLength % 4).toBe(0);
    expect(json.asset.version).toBe('2.0');
    expect(json.buffers[0].byteLength).toBeLessThanOrEqual(binLen);
  });

  test('every bufferView stays inside the BIN chunk and 4-aligned', async () => {
    const buf = await (await SELF.fetch(GLB)).arrayBuffer();
    const { json, binLen } = glbParse(buf);
    expect(json.bufferViews.length).toBeGreaterThan(0);
    for (const v of json.bufferViews) {
      // An offset past the chunk, or misaligned, is garbled geometry on the phone rather than an error.
      expect(v.byteOffset % 4).toBe(0);
      expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(binLen);
    }
  });

  test('POSITION accessors carry the min/max the spec requires', async () => {
    const buf = await (await SELF.fetch(GLB)).arrayBuffer();
    const { json } = glbParse(buf);
    const positions = json.meshes.map(
      (m: { primitives: { attributes: { POSITION: number } }[] }) =>
        json.accessors[m.primitives[0]!.attributes.POSITION],
    );
    expect(positions.length).toBeGreaterThan(0);
    for (const a of positions) {
      expect(a.min).toHaveLength(3);
      expect(a.max).toHaveLength(3);
      expect(a.min.every((n: number) => Number.isFinite(n))).toBe(true);
    }
  });

  test('lays items out identically to the USDZ route', async () => {
    // Both formats go through the same resolve(), so the two models must agree on placement.
    const glb = glbParse(await (await SELF.fetch(GLB)).arrayBuffer());
    // GLB is authored in metres so its accessor bounds read as real size on their own; USD stays in
    // millimetres with the scale on its Content transform. Convert before comparing.
    const translations = (glb.json.scenes[0].nodes as number[]).map((i) =>
      (glb.json.nodes[i].translation as number[]).map((v) => v * 1000),
    );
    const usdz = await (await SELF.fetch(AR)).arrayBuffer();
    const rootLayer = text(usdz, entries(usdz)[0]!);
    // The USD matrix puts translation in the last row. Compared numerically, not as text: the USD
    // writer trims to micron precision, glTF keeps full float precision, and the metre round-trip adds
    // its own rounding — so the two agree on position without agreeing on digits.
    const usdTranslations = [
      ...rootLayer.matchAll(/\(([-\d.e]+), ([-\d.e]+), ([-\d.e]+), 1\)/g),
    ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(translations.length).toBeGreaterThan(0);
    for (const t of translations) {
      const match = usdTranslations.find(
        (u) =>
          Math.abs(u[0]! - t[0]!) < 0.01 &&
          Math.abs(u[1]! - t[1]!) < 0.01 &&
          Math.abs(u[2]! - t[2]!) < 0.01,
      );
      expect(match, `no USD placement matches GLB translation ${t.join(', ')}`).toBeDefined();
    }
  });

  // Regression: real-world scale used to ride on a parent node's scale, so anything sizing the model
  // from POSITION bounds alone saw metres as millimetres — 440 m instead of 0.44 m — and Scene Viewer
  // rendered it in 3D but refused to place it in a room.
  test('reads as a room-sized object from accessor bounds alone, with no transform applied', async () => {
    const { json } = glbParse(await (await SELF.fetch(GLB)).arrayBuffer());
    for (const n of json.nodes) expect(n.scale).toBeUndefined();
    for (const m of json.meshes) {
      const a = json.accessors[m.primitives[0].attributes.POSITION];
      for (const v of [...a.min, ...a.max]) {
        // A phone-or-tablet mesh, in metres. Anything past a couple of metres means units slipped.
        expect(Math.abs(v)).toBeLessThan(2);
      }
    }
  });

  test('generates a box inline for a custom item here too', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/my_box~200x300x100-vs-credit-card.glb');
    expect(res.status).toBe(200);
    const { json } = glbParse(await res.arrayBuffer());
    expect(json.meshes.length).toBe(2);
  });

  test('is byte-identical across requests', async () => {
    const a = new Uint8Array(await (await SELF.fetch(GLB)).arrayBuffer());
    const b = new Uint8Array(await (await SELF.fetch(GLB)).arrayBuffer());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test('redirects an implicit state to the explicit one, keeping the format', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/galaxy-z-fold8.glb', { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toContain('/ar/galaxy-z-fold8-closed.glb');
  });

  test('404s an unknown slug', async () => {
    expect((await SELF.fetch('https://size.fyi/ar/not-a-device.glb')).status).toBe(404);
  });
});

// Regression: the route caches immutably, so the generator version travels in the URL. A redirect that
// dropped it would land the client on a URL whose cached copy predates the current generator — which is
// how a fixed GLB kept being served broken.
describe('generator version', () => {
  test('is preserved across the canonicalising redirect', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/galaxy-z-fold8.glb?v=3', {
      redirect: 'manual',
    });
    expect(res.status).toBe(301);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/ar/galaxy-z-fold8-closed.glb');
    expect(loc).toContain('v=3');
  });

  test('keeps the layout alongside it', async () => {
    const res = await SELF.fetch('https://size.fyi/ar/galaxy-z-fold8.glb?layout=stack&v=3', {
      redirect: 'manual',
    });
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('layout=stack');
    expect(loc).toContain('v=3');
  });

  test('an unknown version still serves a model rather than failing', async () => {
    // The Worker doesn't interpret `v`; it only widens the cache key.
    const res = await SELF.fetch(`${GLB}?v=999`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
  });
});
