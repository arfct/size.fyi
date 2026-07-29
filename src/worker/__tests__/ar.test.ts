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
