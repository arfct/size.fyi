import type { Catalog, Device } from '../shared/types';
import { comparisonTitle, decodeComparison } from '../shared/urlCodec';
import { formatDims } from '../shared/dimensions';

interface Env { ASSETS: Fetcher }

let catalogCache: Promise<Map<string, Device>> | null = null;

function loadCatalog(env: Env, origin: string): Promise<Map<string, Device>> {
  catalogCache ??= env.ASSETS.fetch(`${origin}/devices.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : { version: 1, devices: [] }))
    .then((c) => new Map(c.devices.map((d) => [d.slug, d])))
    .catch(() => { catalogCache = null; return new Map(); });
  return catalogCache;
}

// Sets ETag/Cache-Control here; conditional-request handling (If-None-Match
// → 304) is left to Cloudflare's edge cache in front of the Worker rather
// than implemented locally.
async function apiDevices(env: Env, origin: string): Promise<Response> {
  const res = await env.ASSETS.fetch(`${origin}/devices.json`);
  if (!res.ok) return new Response('catalog unavailable', { status: 503 });
  const body = await res.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', body);
  const etag = `"${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)}"`;
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      etag,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/devices') return apiDevices(env, url.origin);
    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });

    // Everything else: serve the app shell, with OG injection when the path decodes.
    const assetRes = await env.ASSETS.fetch(new Request(`${url.origin}/`, request));
    try {
      const bySlug = await loadCatalog(env, url.origin);
      const { items } = decodeComparison(url.pathname, bySlug);
      if (items.length === 0) return assetRes;
      const title = `${comparisonTitle(items)} — size.fyi`;
      const desc = `Compare sizes in 3D: ${items
        .map((i) => `${i.kind === 'device' ? i.device.name : i.name} (${formatDims(i.kind === 'device' ? i.device : i, 'metric')})`)
        .join(' vs ')}`;
      const canonical = `https://size.fyi${url.pathname}`;
      return new HTMLRewriter()
        .on('title', { element(e) { e.setInnerContent(title); } })
        .on('head', {
          element(e) {
            const meta = (attrs: string) => e.append(`<meta ${attrs}>`, { html: true });
            // For interpolation into double-quoted HTML attribute values only.
            const escAttr = (s: string) => s
              .replace(/&/g, '&amp;')
              .replace(/"/g, '&quot;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/'/g, '&#39;');
            meta(`property="og:title" content="${escAttr(title)}"`);
            meta(`property="og:description" content="${escAttr(desc)}"`);
            meta(`property="og:url" content="${escAttr(canonical)}"`);
            meta(`property="og:type" content="website"`);
            meta(`name="twitter:card" content="summary"`);
          },
        })
        .transform(assetRes);
    } catch {
      return assetRes; // fail open
    }
  },
} satisfies ExportedHandler<Env>;
