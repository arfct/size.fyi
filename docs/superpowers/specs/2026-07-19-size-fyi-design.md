# size.fyi — Design

**Date:** 2026-07-19
**Status:** Approved pending final review

A modern, fast size-comparison tool in the spirit of sizeasy (2006–2017):
enter or pick objects, see them side by side in 3D, share a link. Hosted on
Cloudflare at effectively zero cost, no ads, no accounts, no server-side state.

## Goals

- Compare the physical size of devices and everyday objects in 3D (three.js).
- Curated device catalog, searchable instantly.
- Remember a user's own items locally (localStorage — no accounts).
- Share a comparison as a pretty, self-contained URL.
- Hosting stays in Cloudflare's free tier; nothing to moderate, nothing to leak.

## Non-goals (v1)

- No user accounts, no server-stored comparisons, no public "latest
  comparisons" feed (the old sizeasy feed was mostly junk).
- No user-submitted catalog entries (catalog grows via git commits/PRs).
- No non-box shapes (cylinders, meshes) — everything renders as a box.

## Architecture

One repo, one Worker, no state anywhere.

```
size.fyi/
├── src/
│   ├── app/          # React + TS + Tailwind 4 + Base UI (Vite)
│   ├── shared/       # isomorphic: URL codec, dimension parser, device types
│   ├── three/        # vanilla three.js scene module (no react-three-fiber)
│   └── worker/       # thin Worker: /api/devices + OG tag injection
├── data/devices/     # source of truth: per-category JSON, validated by script
└── public/           # favicons, static bits
```

- Vite builds the client app.
- A build step compiles `data/devices/*.json` into one minified, content-hashed
  `devices.<hash>.json` asset.
- Wrangler deploys the Worker with the built assets; zone routes for
  `size.fyi/*` and `www.size.fyi/*` are already configured in `wrangler.jsonc`.
- `src/shared/` is the future-proofing layer: the same URL/device code runs in
  client and Worker, so swapping JSON→D1 later touches one module.

**Stack:** React 19 + TypeScript + Tailwind v4 + Base UI (headless components;
its Combobox powers device search) + three.js (vanilla, in its own module).

## URL scheme

Sharing is 100% URL-encoded — the link *is* the comparison.

- Catalog devices by slug, joined with `-vs-`:
  `size.fyi/iphone-16-pro-vs-paper-a4`
- Custom items inline as `name~HxWxD` (mm):
  `size.fyi/shoebox~350x250x130-vs-drinks-can`
- Up to 8 items per comparison.
- Reserved path prefixes: `/api/`, `/assets/`.
- Slugs may not contain the `-vs-` sequence or `~` (enforced by catalog
  validation).
- Unknown slug: the app loads, shows a dismissible "couldn't find *foo*"
  notice, and renders the remaining items.
- Unparseable path: app loads empty (fails open). Same rule in the Worker: any
  parse error serves the untouched app HTML.

The Worker parses the same path server-side to inject `<title>`, OG, and
Twitter-card tags via HTMLRewriter, so shared links unfurl as e.g.
"iPhone 16 Pro vs Paper: A4 — size.fyi". Generated OG images are a possible
later addition (deliberately out of v1).

## Device catalog

```json
{
  "slug": "iphone-16-pro",
  "name": "iPhone 16 Pro",
  "brand": "Apple",
  "category": "phone",
  "h": 149.6, "w": 71.5, "d": 8.25,
  "year": 2024,
  "aliases": ["iphone 16 pro"],
  "source": "apple.com"
}
```

- Dimensions in mm, height × width × depth (sizeasy's convention).
- `brand`, `year`, `aliases`, `source` optional; everything else required.
- Categories (initial): `everyday`, `paper`, `phone`, `tablet`, `laptop`,
  `console`, `pc-case`, `audio`, `camera`.

**Seed content:**

1. The 17 original sizeasy presets, extracted verbatim from the archived site
   (mm, H×W×D):

   | Item | H×W×D | Item | H×W×D |
   |---|---|---|---|
   | Box of Matches | 36×53×15 | Internal Door | 1982×838×33 |
   | Credit Card | 54×85×1 | Double/Full Mattress | 1905×1371.6×200 |
   | Pack of Playing Cards | 90×58×20 | Paper: Letter | 279.4×215.9×1 |
   | Drinks Can | 115×65×65 | Paper: Ledger/Tabloid | 431.8×279.4×1 |
   | CD Case | 124×142×10 | Paper: A1 | 841×594×1 |
   | Wine Bottle | 295×70×70 | Paper: A2 | 594×420×1 |
   | 19″ TFT Monitor | 360×425×50 | Paper: A3 | 420×297×1 |
   | 32″ Widescreen TV | 550×790×90 | Paper: A4 | 297×210×1 |
   | | | Paper: A5 | 210×148×1 |

2. A curated ~150–200 popular devices: recent iPhones / Pixels / Galaxys,
   iPads, MacBooks, game consoles, common SFF PC cases — each with a `source`.

**Size budget:** a minified entry is ~150–200 bytes; 200 devices ≈ 35 KB raw
≈ 10 KB brotli — negligible (three.js alone is ~150 KB gzipped). The client
always fetches the catalog from `/api/devices`, lazily (after first paint or
on first search focus), never on the critical path. Past a few thousand
entries, `/api/devices` becomes a D1-backed search endpoint with the client
contract unchanged — that is the deliberate seam.

**Validation:** a script (run in CI and pre-deploy) enforces schema, slug
uniqueness, URL-grammar safety, and sane dimensions (0.1 mm – 100 m).

## Client app

- **State:** a single comparison store (items, per-item colors, active view,
  unit preference) synced bidirectionally with the URL via the shared codec.
  React context + reducer; no state library.
- **Item entry:**
  - Base UI Combobox searching the catalog client-side (simple scored
    substring/prefix fuzzy match over name+brand+aliases; instant at this scale).
  - Custom entry: name + dimension string. Parser accepts `85x64x12mm`,
    `5x3x2in`, `29.7x21cm`, bare numbers (default mm), and per-entry unit
    override. Canonical unit is mm.
- **Display:** item chips with assigned colors (colorblind-safe palette),
  dimensions shown in metric or imperial (toggle, persisted).
- **Views:** tabs for 3D (perspective + orbit controls) and front / side / top
  (orthographic). Translucent colored boxes on a ground grid, CSS2D labels.
- **3D module contract:** `createScene(canvas)` returns
  `{ setItems(items), setView(view), dispose() }`. React drives it from an
  effect; the module knows nothing about React. Renders on demand only
  (dirty-flag + on-interaction), so idle GPU cost is zero.
- **localStorage:**
  - `myItems` — custom items the user has entered; surfaced in search results
    under "My items".
  - `recentComparisons` — last 20, shown on the empty/home state.
  - Both wrapped in try/catch (private-mode quota); the app works fine with
    localStorage unavailable.
- **Share:** button copies the canonical URL; uses the native share sheet on
  mobile (`navigator.share`).

## Worker

~100 lines, stateless:

1. `GET /api/devices` — serves the built catalog JSON via an internal asset
   fetch, with a strong ETag and `Cache-Control: max-age=3600,
   stale-while-revalidate=86400` (stable URL, cheap revalidation — keeps the
   client contract stable for the D1 swap).
2. Comparison paths — HTMLRewriter injects title/OG/Twitter tags into the app
   HTML. Fails open on any error.
3. Everything else — falls through to static assets (SPA fallback already
   configured).

No writes, no state, no rate limiting needed. Free tier: 100k req/day.

## Error handling summary

| Failure | Behavior |
|---|---|
| Bad dimension input | inline field error, add blocked |
| Unknown slug in URL | notice + render rest of comparison |
| Unparseable URL path | app loads empty |
| Worker OG parse error | serves untouched HTML |
| Catalog fetch fails | custom entry still works; search shows retry |
| localStorage unavailable | feature silently disabled |
| WebGL unavailable | message + dimension table still shown |

## Testing

- **vitest**: dimension parser and URL codec — round-trip properties plus
  adversarial cases (these two handle all untrusted input). Comparison-store
  reducer unit tests.
- **Catalog validation** in CI (schema, slug grammar, duplicates, dimension
  sanity).
- **Worker**: vitest + Workers pool (miniflare) for /api/devices and OG
  injection.
- **3D scene**: verified visually in the browser; not pixel-tested.
- **CI:** GitHub Actions — typecheck, test, validate on push. Deploys stay
  manual (`npm run deploy`).

## Cost model

Static assets + one stateless Worker + no database = $0/mo on the Workers free
tier (~100k req/day). First paid tier is $5/mo. No ads required — that is a
design constraint, not an aspiration.
