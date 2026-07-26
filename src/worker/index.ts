import { formatDims } from '../shared/dimensions';
import type { Catalog, Device } from '../shared/types';
import { itemDims } from '../shared/types';
import { comparisonTitle, decodeComparison } from '../shared/urlCodec';
import { OG_HEIGHT, OG_WIDTH, type OgFont, renderOgImage } from './og';

interface Env {
  ASSETS: Fetcher;
}

// Self-hosted OG fonts, fetched once per isolate via the ASSETS binding (no external font CDN).
let fontsCache: Promise<OgFont[]> | null = null;
function loadOgFonts(env: Env, origin: string): Promise<OgFont[]> {
  fontsCache ??= Promise.all([
    env.ASSETS.fetch(`${origin}/fonts/Inter-Regular.ttf`).then((r) => r.arrayBuffer()),
    env.ASSETS.fetch(`${origin}/fonts/Inter-SemiBold.ttf`).then((r) => r.arrayBuffer()),
  ])
    .then(([regular, semibold]): OgFont[] => [
      { name: 'Inter', data: regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
    ])
    .catch((e) => {
      fontsCache = null;
      throw e;
    });
  return fontsCache;
}

// Serve the HTML shell with `no-cache` (revalidate every navigation) so app updates land on the
// next load while we stabilize. Hashed /assets/* files keep their immutable caching — they're
// served by the static-asset layer, not this handler. Reinstate a max-age once things settle.
function htmlNoCache(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

let catalogCache: Promise<Map<string, Device>> | null = null;

function loadCatalog(env: Env, origin: string): Promise<Map<string, Device>> {
  catalogCache ??= env.ASSETS.fetch(`${origin}/devices.json`)
    .then((r) => {
      if (r.ok) return r.json() as Promise<Catalog>;
      catalogCache = null; // don't cache a transient failure for the isolate's lifetime
      return { version: 1, devices: [] };
    })
    .then((c) => new Map(c.devices.map((d) => [d.slug, d])))
    .catch(() => {
      catalogCache = null;
      return new Map();
    });
  return catalogCache;
}

// Renders (or serves from the edge cache) the OG share image for a comparison. The path after
// /api/og/ is the same comparison grammar as a normal URL. Deterministic per comparison, so it's
// cached immutably — a given comparison rasterizes at most once per edge location.
async function apiOg(
  request: Request,
  env: Env,
  origin: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const spec = new URL(request.url).pathname.slice('/api/og/'.length);
  const bySlug = await loadCatalog(env, origin);
  const { items } = decodeComparison(`/${spec}`, bySlug);
  if (items.length === 0) return new Response('not found', { status: 404 });
  try {
    const fonts = await loadOgFonts(env, origin);
    // Materialize the PNG (forces full rasterization; surfaces render errors instead of streaming an
    // empty body) so both the response and the cached copy carry the complete bytes.
    const png = await renderOgImage(items, 'metric', fonts).arrayBuffer();
    if (png.byteLength === 0) throw new Error('empty image');
    const res = new Response(png, {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch {
    return new Response('image unavailable', { status: 500 });
  }
}

// Sets ETag/Cache-Control here; conditional-request handling (If-None-Match
// → 304) is left to Cloudflare's edge cache in front of the Worker rather
// than implemented locally. Cache-control is `no-cache` for now (revalidate
// every load via the ETag) so catalog changes appear immediately while we
// stabilize; reinstate a max-age once the catalog settles.
async function apiDevices(env: Env, origin: string): Promise<Response> {
  const res = await env.ASSETS.fetch(`${origin}/devices.json`);
  if (!res.ok) return new Response('catalog unavailable', { status: 503 });
  const body = await res.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-1', body);
  const etag = `"${[...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)}"`;
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-cache',
      etag,
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/devices') return apiDevices(env, url.origin);
    if (url.pathname.startsWith('/api/og/')) return apiOg(request, env, url.origin, ctx);
    if (url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });

    // Everything else: serve the app shell with OG tags — comparison-specific when the path decodes,
    // site defaults otherwise (so the homepage unfurls too). Owning all OG here avoids duplicate
    // tags from index.html.
    const assetRes = await env.ASSETS.fetch(new Request(`${url.origin}/`, request));
    try {
      const bySlug = await loadCatalog(env, url.origin);
      const { items } = decodeComparison(url.pathname, bySlug);
      const HERO = '/iphone-17-pro-vs-galaxy-z-fold8-open'; // default homepage card
      const title = items.length
        ? `${comparisonTitle(items)} — size.fyi`
        : 'size.fyi — compare the size of anything';
      const desc = items.length
        ? `Compare sizes in 3D: ${items
            .map(
              (i) =>
                `${i.kind === 'device' ? i.device.name : i.name} (${formatDims(itemDims(i), 'metric')})`,
            )
            .join(' vs ')}`
        : 'Compare the size of devices and everyday objects in 3D.';
      const ogPath = items.length ? url.pathname : HERO;
      const canonical = `https://size.fyi${url.pathname}`;
      const transformed = new HTMLRewriter()
        .on('title', {
          element(e) {
            e.setInnerContent(title);
          },
        })
        .on('head', {
          element(e) {
            const meta = (attrs: string) => e.append(`<meta ${attrs}>`, { html: true });
            // For interpolation into double-quoted HTML attribute values only.
            const escAttr = (s: string) =>
              s
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/'/g, '&#39;');
            const ogImage = `https://size.fyi/api/og${ogPath}`;
            meta(`property="og:title" content="${escAttr(title)}"`);
            meta(`property="og:description" content="${escAttr(desc)}"`);
            meta(`property="og:url" content="${escAttr(canonical)}"`);
            meta(`property="og:type" content="website"`);
            meta(`property="og:image" content="${escAttr(ogImage)}"`);
            meta(`property="og:image:width" content="${OG_WIDTH}"`);
            meta(`property="og:image:height" content="${OG_HEIGHT}"`);
            meta(`name="twitter:card" content="summary_large_image"`);
            meta(`name="twitter:image" content="${escAttr(ogImage)}"`);
          },
        })
        .transform(assetRes);
      return htmlNoCache(transformed);
    } catch {
      return htmlNoCache(assetRes); // fail open
    }
  },
} satisfies ExportedHandler<Env>;
