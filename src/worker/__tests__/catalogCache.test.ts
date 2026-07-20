import { env, SELF } from 'cloudflare:test';
import { expect, test, vi } from 'vitest';

// Regression test for the loadCatalog cache: a transient non-ok response
// from ASSETS.fetch('/devices.json') must not poison catalogCache with an
// empty Map for the isolate's remaining lifetime. Must run in isolation
// (its own file) — env.ASSETS.fetch is mocked module-wide here, and
// catalogCache is a module-level singleton that would otherwise carry a
// real, already-resolved catalog over from any other test that hit a
// comparison path first.
test('a non-ok devices.json fetch does not poison the cache forever', async () => {
  const real = env.ASSETS.fetch.bind(env.ASSETS);
  const spy = vi.spyOn(env.ASSETS, 'fetch').mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/devices.json')) return new Response('nope', { status: 500 });
    return real(input, init);
  });

  const failed = await SELF.fetch('https://size.fyi/drinks-can-vs-paper-a4');
  expect(await failed.text()).not.toContain('Drinks Can vs Paper: A4');

  spy.mockRestore(); // devices.json now resolves normally again

  const recovered = await SELF.fetch('https://size.fyi/drinks-can-vs-paper-a4');
  expect(await recovered.text()).toContain('Drinks Can vs Paper: A4');
});
