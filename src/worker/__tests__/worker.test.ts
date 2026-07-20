import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

describe('/api/devices', () => {
  test('returns catalog with cache headers', async () => {
    const res = await SELF.fetch('https://size.fyi/api/devices');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = await res.json() as { version: number; devices: unknown[] };
    expect(body.version).toBe(1);
    expect(body.devices.length).toBeGreaterThan(10);
  });

  test('cache-control is exactly the documented contract', async () => {
    const res = await SELF.fetch('https://size.fyi/api/devices');
    // Temporarily no-cache (revalidate every load) while the catalog stabilizes.
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  test('etag is stable across requests', async () => {
    const first = await SELF.fetch('https://size.fyi/api/devices');
    const second = await SELF.fetch('https://size.fyi/api/devices');
    expect(first.headers.get('etag')).toBe(second.headers.get('etag'));
  });

  test('other /api/* paths 404', async () => {
    const res = await SELF.fetch('https://size.fyi/api/other-thing');
    expect(res.status).toBe(404);
  });
});

describe('OG injection', () => {
  test('comparison path gets og tags', async () => {
    const res = await SELF.fetch('https://size.fyi/drinks-can-vs-paper-a4');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<title>Drinks Can vs Paper: A4 — size.fyi</title>');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('https://size.fyi/drinks-can-vs-paper-a4');
  });
  test('the HTML document is served no-cache so app updates land on next load', async () => {
    const withOg = await SELF.fetch('https://size.fyi/drinks-can-vs-paper-a4');
    expect(withOg.headers.get('cache-control')).toBe('no-cache');
    const plain = await SELF.fetch('https://size.fyi/totally-unknown-thing');
    expect(plain.headers.get('cache-control')).toBe('no-cache');
  });
  test('custom tokens work without catalog hits', async () => {
    const res = await SELF.fetch('https://size.fyi/shoebox~350x250x130-vs-drinks-can');
    expect(await res.text()).toContain('Shoebox vs Drinks Can');
  });
  test('unknown-only path serves untouched app html', async () => {
    const res = await SELF.fetch('https://size.fyi/totally-unknown-thing');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('size.fyi — compare the size of anything');
  });
});

describe('OG injection security', () => {
  test('a hostile custom-token payload is dropped, not reflected', async () => {
    const res = await SELF.fetch('https://size.fyi/x%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E~10x10x10');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('<script>alert');
  });

  test('a hostile token alongside a valid one cannot break out of an og: meta attribute', async () => {
    const res = await SELF.fetch('https://size.fyi/foo%22onmouseover%3dalert(1)~10x10x10-vs-drinks-can');
    expect(res.status).toBe(200);
    const html = await res.text();
    const ogTags = html.match(/<meta[^>]*property="og:[^>]*>/g) ?? [];
    expect(ogTags.length).toBeGreaterThan(0);
    // The hostile token fails both the custom-dimension and slug grammars,
    // so it's dropped during decode; only "drinks-can" survives. Each og:
    // tag must stay a single well-formed `content="..."` attribute — no
    // unescaped `"` that could break out and turn `onmouseover=...` into a
    // live attribute (og:url's `%22`/`%3d` stay percent-encoded by the URL
    // parser and are additionally escAttr()-escaped, so this can't happen).
    for (const tag of ogTags) {
      expect(tag).toMatch(/^<meta property="og:[a-z]+" content="[^"]*">$/);
    }
    // og:title/og:description are built solely from catalog device names,
    // so the payload text must never surface there at all.
    const titleTag = ogTags.find((t) => t.includes('og:title'));
    const descTag = ogTags.find((t) => t.includes('og:description'));
    expect(titleTag).not.toContain('onmouseover');
    expect(descTag).not.toContain('onmouseover');
  });
});
