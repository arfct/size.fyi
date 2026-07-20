import { SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

describe('/api/devices', () => {
  test('returns catalog with cache headers', async () => {
    const res = await SELF.fetch('https://size.fyi/api/devices');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = await res.json() as { version: number; devices: unknown[] };
    expect(body.version).toBe(1);
    expect(body.devices.length).toBeGreaterThan(10);
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
