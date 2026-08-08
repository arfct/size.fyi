// GET /ar/<comparison>.usdz — iOS, AR Quick Look
// GET /ar/<comparison>.glb  — Android, Scene Viewer
//
// Both compose the whole comparison per request. Pre-generating is not an option: 2-8 items drawn from
// ~100, times two layout modes, is ~375 billion combinations before custom items (which take arbitrary
// dimensions) make the space infinite.
//
// Neither format touches geometry, so there's no three.js here. scripts/build-ar-geometry.ts emits, per
// catalog item and state, a USD layer for iOS and a raw vertex blob for Android. This module only
// assembles: for USDZ, a root layer that references the layers by path, zipped; for GLB, a glTF JSON
// whose bufferViews point into the concatenated blobs. Same placements, same layout, two containers.
import { itemColor } from '../app/palette';
import { geometryKey, SCREEN_PROUD_MM } from '../shared/ar';
import { boxGlb, buildGlb, type GlbGeometry, type GlbPlacement } from '../shared/glb';
import {
  type ComparisonItem,
  type Device,
  itemDims,
  type LayoutMode,
  sortVolume,
} from '../shared/types';
import { decodeComparison, encodeComparison } from '../shared/urlCodec';
import {
  boxMesh,
  buildUsdz,
  type UsdPlacement,
  usdGeometryLayer,
  usdRootLayer,
} from '../shared/usdz';
import { computeKeys, computeTargetBounds, computeTargets } from '../three/layout';

const MM_TO_M = 0.001;

// Darkens a hex colour toward black, for the screen face against its body.
function darken(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const parts = [0, 2, 4].map((i) =>
    Math.round(Number.parseInt(h.slice(i, i + 2), 16) * factor)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${parts.join('')}`;
}

// The GLB manifest is one fetch for the whole catalog, so hold it for the isolate's lifetime.
let manifestCache: Promise<Record<string, GlbGeometry>> | null = null;
function loadManifest(assets: Fetcher, origin: string): Promise<Record<string, GlbGeometry>> {
  manifestCache ??= assets
    .fetch(`${origin}/ar/geometry.json`)
    .then((r) => {
      if (r.ok) return r.json() as Promise<Record<string, GlbGeometry>>;
      manifestCache = null; // don't cache a transient failure
      return {};
    })
    .catch(() => {
      manifestCache = null;
      return {};
    });
  return manifestCache;
}

// Where each item sits, and what it's called — shared by both formats so an Android model is the same
// arrangement as the iOS one.
interface Resolved {
  items: ComparisonItem[];
  dims: ReturnType<typeof itemDims>[];
  at: { x: number; y: number; z: number }[];
  mode: LayoutMode;
}

function resolve(items: ComparisonItem[], mode: LayoutMode): Resolved {
  const dims = items.map(itemDims);
  const layoutItems = items.map((item, i) => ({
    name: item.kind === 'device' ? item.device.name : item.name,
    h: dims[i]!.h,
    w: dims[i]!.w,
    d: dims[i]!.d,
    screen: dims[i]!.screen,
    seam: dims[i]!.seam,
    mesh: item.kind === 'device' ? item.device.mesh : undefined,
    sortVolume: sortVolume(item),
  }));
  const keys = computeKeys(layoutItems);
  const targets = computeTargets(layoutItems, keys, mode);

  // Re-centre for AR: both viewers anchor to a horizontal plane, and the layout runs the row rightward
  // from x=0. Keep the base on y=0 so it rests on the surface; centre x and z on the anchor.
  const b = computeTargetBounds(layoutItems, keys, targets);
  const shift = { x: -(b.min.x + b.max.x) / 2, y: -b.min.y, z: -(b.min.z + b.max.z) / 2 };
  const at = items.map((_, i) => {
    const pos = targets.get(keys[i]!)!.pos;
    return { x: pos.x + shift.x, y: pos.y + shift.y, z: pos.z + shift.z };
  });
  return { items, dims, at, mode };
}

async function usdzBody(
  r: Resolved,
  assets: Fetcher,
  origin: string,
): Promise<Uint8Array | Response> {
  const layers = new Map<string, string>();
  const placements: UsdPlacement[] = [];
  for (let i = 0; i < r.items.length; i++) {
    const item = r.items[i]!;
    const d = r.dims[i]!;
    const at = r.at[i]!;
    const color = itemColor(item, i);

    let layer: string;
    if (item.kind === 'device') {
      const key = geometryKey(item.device, item.state);
      layer = `geometries/${key}.usda`;
      if (!layers.has(layer)) {
        const res = await assets.fetch(`${origin}/ar/${key}.usda`);
        if (!res.ok) return new Response(`missing geometry for ${key}`, { status: 500 });
        // Decoded rather than .text() because the asset layer labels .usda as model/vnd.usda, and
        // reading a non-text content-type as text logs a warning on every request.
        layers.set(layer, new TextDecoder().decode(await res.arrayBuffer()));
      }
    } else {
      // Custom items have arbitrary dimensions, so there is no pre-built layer — generate the box.
      layer = `geometries/custom-${i}.usda`;
      layers.set(layer, usdGeometryLayer([boxMesh('Body', d.w, d.h, d.d)]));
    }

    placements.push({ name: `Item_${i}`, layer, prim: 'Body', translate: at, color });
    // The screen is its own prim with its own material, offset off the front face. USD has no
    // draw-order equivalent to the renderer's, so the separation has to be physical.
    if (d.screen && item.kind === 'device') {
      placements.push({
        name: `Item_${i}_screen`,
        layer,
        prim: 'Screen',
        translate: { x: at.x, y: at.y, z: at.z + d.d / 2 + SCREEN_PROUD_MM },
        color: darken(color, 0.35),
      });
    }
  }
  return buildUsdz(usdRootLayer(placements, MM_TO_M), layers);
}

async function glbBody(
  r: Resolved,
  assets: Fetcher,
  origin: string,
): Promise<Uint8Array | Response> {
  const manifest = await loadManifest(assets, origin);
  const blobs: Uint8Array[] = [];
  const blobIndex = new Map<string, number>();
  const placements: GlbPlacement[] = [];

  for (let i = 0; i < r.items.length; i++) {
    const item = r.items[i]!;
    const d = r.dims[i]!;
    const at = r.at[i]!;
    const color = itemColor(item, i);

    // GLB coordinates are metres (see src/shared/glb.ts); the layout works in millimetres.
    const atM = { x: at.x * MM_TO_M, y: at.y * MM_TO_M, z: at.z * MM_TO_M };

    if (item.kind === 'device') {
      const key = geometryKey(item.device, item.state);
      const entry = manifest[key];
      if (!entry) return new Response(`missing geometry for ${key}`, { status: 500 });
      let blob = blobIndex.get(key);
      if (blob === undefined) {
        const res = await assets.fetch(`${origin}/ar/${key}.bin`);
        if (!res.ok) return new Response(`missing geometry for ${key}`, { status: 500 });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length !== entry.byteLength) {
          // The manifest and the blob are written together, so a mismatch means a stale deploy rather
          // than a bad request — and would otherwise surface as garbled geometry on the phone.
          return new Response(`geometry for ${key} does not match the manifest`, { status: 500 });
        }
        blob = blobs.push(bytes) - 1;
        blobIndex.set(key, blob);
      }
      placements.push({ name: `Item_${i}`, blob, part: entry.body, translate: atM, color });
      if (entry.screen) {
        placements.push({
          name: `Item_${i}_screen`,
          blob,
          part: entry.screen,
          translate: {
            x: atM.x,
            y: atM.y,
            z: atM.z + (d.d / 2 + SCREEN_PROUD_MM) * MM_TO_M,
          },
          color: darken(color, 0.35),
        });
      }
    } else {
      // No pre-built blob can exist for arbitrary dimensions, so build the box's vertex data here —
      // in metres, like the pre-built ones.
      const { blob, part } = boxGlb(d.w * MM_TO_M, d.h * MM_TO_M, d.d * MM_TO_M);
      placements.push({
        name: `Item_${i}`,
        blob: blobs.push(blob) - 1,
        part,
        translate: atM,
        color,
      });
    }
  }
  return buildGlb(blobs, placements);
}

export async function arModel(
  request: Request,
  assets: Fetcher,
  origin: string,
  bySlug: Map<string, Device>,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const glb = url.pathname.endsWith('.glb');
  const ext = glb ? '.glb' : '.usdz';
  const spec = url.pathname.slice('/ar/'.length).slice(0, -ext.length);
  if (!spec) return new Response('not found', { status: 404 });

  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const { items } = decodeComparison(`/${spec}`, bySlug);
  if (items.length === 0) return new Response('not found', { status: 404 });

  // One canonical URL per distinct model, so the edge cache doesn't hold the same bytes twice. Mostly
  // this normalizes an implicit state to an explicit one: /ar/galaxy-z-fold8 and
  // /ar/galaxy-z-fold8-closed are the same object, because closed is that device's default.
  //
  // It deliberately does NOT reorder items. Item order looks redundant — the layout sorts by volume, so
  // it doesn't move anything — but palette colour is assigned by index, so a-vs-b and b-vs-a really are
  // different models. Sorting them together would silently recolour one of them.
  const mode: LayoutMode = url.searchParams.get('layout') === 'stack' ? 'stack' : 'row';
  const canonical = encodeComparison(items);
  if (canonical !== `/${spec}`) {
    // Carry the query across verbatim: it holds the layout and the generator version, and dropping the
    // latter would land the client on a URL whose cached copy predates the current generator.
    const to = new URL(`/ar${canonical}${ext}${url.search}`, url.origin);
    return Response.redirect(to.toString(), 301);
  }

  const resolved = resolve(items, mode);
  const body = glb
    ? await glbBody(resolved, assets, origin)
    : await usdzBody(resolved, assets, origin);
  if (body instanceof Response) return body;

  const etag = `"${[...new Uint8Array(await crypto.subtle.digest('SHA-1', body.buffer))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)}"`;
  const res = new Response(body, {
    headers: {
      'content-type': glb ? 'model/gltf-binary' : 'model/vnd.usdz+zip',
      // Deterministic for a given comparison, so it can be cached hard.
      'cache-control': 'public, max-age=31536000, immutable',
      etag,
    },
  });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}
