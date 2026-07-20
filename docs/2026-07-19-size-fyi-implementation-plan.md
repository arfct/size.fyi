# size.fyi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build size.fyi per the approved spec ([docs/2026-07-19-size-fyi-design.md](2026-07-19-size-fyi-design.md)): a 3D size-comparison app with a curated device catalog, localStorage history, URL-encoded sharing, and a thin Cloudflare Worker.

**Architecture:** Vite-built React SPA served as Cloudflare Worker static assets; isomorphic `src/shared/` modules (dimension parser, URL codec, types) used by both the client and a ~100-line Worker that serves `/api/devices` and injects OG tags for comparison URLs. No database, no server state.

**Tech Stack:** React 19, TypeScript (strict), Tailwind CSS v4, Base UI (`@base-ui-components/react`), three.js, Vite 6, vitest (+ `@cloudflare/vitest-pool-workers`), wrangler 4.

## Global Constraints

- **No copying from reference sites.** The ONLY imported content is sizeasy's 17 preset objects (names + mm dimensions, listed in Task 4). All copy, UI, and code must be original. Never mention or reference comparesizes.com anywhere in code, comments, or docs.
- Dimensions are always **mm**, ordered **height × width × depth** (`h`, `w`, `d`).
- Zero server-side state: no KV, no D1, no writes. The Worker only reads assets.
- Hosting must stay in Cloudflare's free tier; keep bundles lean (three.js is the only heavy dep).
- Docs live in `docs/` directly (never `docs/superpowers/`).
- TypeScript `strict: true`; all new code typed, no `any` except where a lib forces it.
- Deployed via existing `wrangler.jsonc` zone routes (`size.fyi/*`, `www.size.fyi/*`) on the Artifact account — do not change `account_id` or `routes`.
- URL grammar (from spec): device slugs joined by `-vs-`; custom items `name~HxWxD` in mm; max 8 items; slugs must match `^[a-z0-9]+(-[a-z0-9]+)*$`, may not contain `~` or the `-vs-` sequence.
- Commit after every green test cycle. Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
size.fyi/
├── index.html                      # Vite entry (replaces public/index.html placeholder)
├── package.json                    # scripts: dev, build, test, test:worker, validate, deploy
├── vite.config.ts                  # react + tailwind plugins, build to dist/
├── tsconfig.json                   # strict, bundler resolution
├── vitest.config.ts                # jsdom env for src/{shared,app}
├── vitest.workers.config.ts        # workers pool for src/worker
├── wrangler.jsonc                  # + main: worker, assets binding (dist/)
├── data/devices/
│   ├── everyday.json               # 17 sizeasy presets (everyday + paper)
│   └── devices.json                # curated starter devices
├── scripts/build-catalog.mjs       # validate + compile data/ → public/devices.json
├── public/                         # Vite static dir (favicon; generated devices.json)
├── src/shared/
│   ├── types.ts                    # Device, ComparisonItem, Category, View, Units
│   ├── dimensions.ts               # parseDimensions, formatDims, MM conversions
│   ├── urlCodec.ts                 # encodeComparison, decodeComparison, comparisonTitle
│   └── search.ts                   # searchDevices (scored fuzzy match)
├── src/three/scene.ts              # createScene(container) → {setItems,setView,dispose}
├── src/app/
│   ├── main.tsx                    # React root, styles import
│   ├── App.tsx                     # layout: header, panel, viewer
│   ├── styles.css                  # @import "tailwindcss"
│   ├── store.tsx                   # ComparisonProvider, reducer, useComparison
│   ├── localStore.ts               # myItems + recentComparisons (try/catch wrapped)
│   ├── palette.ts                  # Okabe–Ito colorblind-safe palette
│   ├── useCatalog.ts               # lazy catalog fetch hook
│   └── components/
│       ├── AddItemPanel.tsx        # Base UI combobox + custom dimension form
│       ├── ItemList.tsx            # chips with colors, dims, remove
│       ├── Viewer.tsx              # canvas host, binds store → scene
│       ├── ViewTabs.tsx            # 3d | front | side | top
│       ├── ShareButton.tsx         # copy / native share
│       └── EmptyState.tsx          # intro + recent comparisons
├── src/worker/index.ts             # /api/devices + OG injection + asset fallthrough
└── tests mirror sources: src/**/__tests__/*.test.ts
```

Deletions: `public/index.html` placeholder moves to `index.html` (Vite root) rewritten as the app shell.

---

### Task 1: Toolchain scaffold (Vite + React + TS + Tailwind + vitest)

**Files:**
- Create: `index.html`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/app/main.tsx`, `src/app/App.tsx`, `src/app/styles.css`, `src/app/__tests__/App.test.tsx`
- Modify: `package.json`, `.gitignore`
- Delete: `public/index.html` (placeholder — the deployed site keeps working because deploys now build first; do not deploy mid-task)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: working `npm run dev` / `npm run build` (→ `dist/`) / `npm test`; `App` component that later tasks fill in.

- [ ] **Step 1: Install dependencies**

```bash
npm install react react-dom three
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite \
  @types/react @types/react-dom @types/three vitest jsdom @testing-library/react \
  @testing-library/jest-dom @base-ui-components/react
```

- [ ] **Step 2: Write configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "scripts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/{app,shared,three}/**/*.test.{ts,tsx}'],
  },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>size.fyi — compare the size of anything</title>
    <meta name="description" content="Compare the size of devices and everyday objects in 3D." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

`src/app/styles.css`:
```css
@import "tailwindcss";
```

`src/app/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/app/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h1 className="text-lg font-semibold tracking-tight">size.fyi</h1>
      </header>
      <main id="app-main" className="p-4">Loading…</main>
    </div>
  );
}
```

Update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "node scripts/build-catalog.mjs && vite build",
    "test": "vitest run",
    "validate": "node scripts/build-catalog.mjs --check",
    "typecheck": "tsc --noEmit",
    "deploy": "npm run build && wrangler deploy"
  }
}
```
(`scripts/build-catalog.mjs` arrives in Task 4; until then run `vite build` directly if needed.)

Append to `.gitignore`: `dist/` and `public/devices.json` (generated).

- [ ] **Step 3: Write smoke test**

`src/app/__tests__/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import App from '../App';

test('renders the wordmark', () => {
  render(<App />);
  expect(screen.getByText('size.fyi')).toBeInTheDocument();
});
```
Add `import '@testing-library/jest-dom/vitest';` via a `src/app/__tests__/setup.ts` and reference it in `vitest.config.ts` (`test.setupFiles: ['src/app/__tests__/setup.ts']`).

- [ ] **Step 4: Run test + typecheck + build; verify all pass**

Run: `npm test && npm run typecheck && npx vite build`
Expected: 1 test passes; tsc clean; `dist/index.html` exists.

- [ ] **Step 5: Delete placeholder, verify dev server in browser, commit**

```bash
rm public/index.html
git add -A && git commit -m "feat: scaffold Vite+React+TS+Tailwind app shell"
```

---

### Task 2: Shared types + dimension parser

**Files:**
- Create: `src/shared/types.ts`, `src/shared/dimensions.ts`, `src/shared/__tests__/dimensions.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
// types.ts
export type Category = 'everyday' | 'paper' | 'phone' | 'tablet' | 'laptop'
  | 'console' | 'pc-case' | 'audio' | 'camera';
export interface Device {
  slug: string; name: string; category: Category;
  h: number; w: number; d: number;            // mm
  brand?: string; year?: number; aliases?: string[]; source?: string;
}
export interface Catalog { version: number; devices: Device[]; }
export type ComparisonItem =
  | { kind: 'device'; device: Device }
  | { kind: 'custom'; name: string; h: number; w: number; d: number };
export type View = '3d' | 'front' | 'side' | 'top';
export type Units = 'metric' | 'imperial';
export const MAX_ITEMS = 8;

// dimensions.ts
export function parseDimensions(input: string): { h: number; w: number; d: number } | null;
export function formatDims(item: {h:number;w:number;d:number}, units: Units): string;
export function formatLength(mm: number, units: Units): string;
```

- [ ] **Step 1: Write failing tests**

`src/shared/__tests__/dimensions.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { parseDimensions, formatDims, formatLength } from '../dimensions';

describe('parseDimensions', () => {
  test('bare numbers default to mm', () =>
    expect(parseDimensions('85x64x12')).toEqual({ h: 85, w: 64, d: 12 }));
  test('mm suffix', () =>
    expect(parseDimensions('85x64x12mm')).toEqual({ h: 85, w: 64, d: 12 }));
  test('inches convert', () =>
    expect(parseDimensions('5x3x2in')).toEqual({ h: 127, w: 76.2, d: 50.8 }));
  test('cm converts', () =>
    expect(parseDimensions('29.7x21x0.1cm')).toEqual({ h: 297, w: 210, d: 1 }));
  test('m and ft convert', () => {
    expect(parseDimensions('2x1x0.5m')).toEqual({ h: 2000, w: 1000, d: 500 });
    expect(parseDimensions('6x3x1ft')).toEqual({ h: 1828.8, w: 914.4, d: 304.8 });
  });
  test('spaces, ×, and case tolerated', () =>
    expect(parseDimensions(' 85 × 64 X 12 MM ')).toEqual({ h: 85, w: 64, d: 12 }));
  test('rejects garbage', () => {
    expect(parseDimensions('')).toBeNull();
    expect(parseDimensions('85x64')).toBeNull();          // 3 dims required
    expect(parseDimensions('85x64x12x9')).toBeNull();
    expect(parseDimensions('axbxc')).toBeNull();
    expect(parseDimensions('85x64x12km')).toBeNull();     // unsupported unit
    expect(parseDimensions('0x10x10')).toBeNull();        // below 0.1mm floor
    expect(parseDimensions('-5x3x2')).toBeNull();
    expect(parseDimensions('200000x1x1')).toBeNull();     // above 100m ceiling
  });
});

describe('formatting', () => {
  test('metric mm', () => expect(formatLength(85, 'metric')).toBe('85 mm'));
  test('metric rounds to 1dp', () => expect(formatLength(8.25, 'metric')).toBe('8.3 mm'));
  test('metric switches to m at 1000', () => expect(formatLength(1905, 'metric')).toBe('1.91 m'));
  test('imperial inches', () => expect(formatLength(85, 'imperial')).toBe('3.3 in'));
  test('imperial ft+in at 3ft', () => expect(formatLength(1905, 'imperial')).toBe('6 ft 3 in'));
  test('formatDims joins h×w×d', () =>
    expect(formatDims({ h: 297, w: 210, d: 1 }, 'metric')).toBe('297 × 210 × 1 mm'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared`
Expected: FAIL — module `../dimensions` not found.

- [ ] **Step 3: Implement**

`src/shared/types.ts`: exactly the interface block above.

`src/shared/dimensions.ts`:
```ts
import type { Units } from './types';

const UNIT_TO_MM: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
};
const MIN_MM = 0.1;
const MAX_MM = 100_000; // 100 m

const round1 = (n: number) => Math.round(n * 10) / 10;

export function parseDimensions(input: string): { h: number; w: number; d: number } | null {
  const cleaned = input.trim().toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  const m = cleaned.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|cm|m|in|ft)?$/);
  if (!m) return null;
  const factor = UNIT_TO_MM[m[4] ?? 'mm'];
  if (factor === undefined) return null;
  const [h, w, d] = [m[1]!, m[2]!, m[3]!].map((s) => round1(parseFloat(s) * factor));
  if ([h, w, d].some((v) => !Number.isFinite(v) || v < MIN_MM || v > MAX_MM)) return null;
  return { h: h!, w: w!, d: d! };
}

export function formatLength(mm: number, units: Units): string {
  if (units === 'metric') {
    if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
    const r = round1(mm);
    return `${Number.isInteger(r) ? r : r.toFixed(1)} mm`;
  }
  const inches = mm / 25.4;
  if (inches >= 36) {
    const ft = Math.floor(inches / 12);
    const rest = Math.round(inches - ft * 12);
    return `${ft} ft ${rest} in`;
  }
  return `${round1(inches).toFixed(1)} in`;
}

export function formatDims(item: { h: number; w: number; d: number }, units: Units): string {
  if (units === 'metric' && [item.h, item.w, item.d].every((v) => v < 1000)) {
    const f = (v: number) => { const r = round1(v); return Number.isInteger(r) ? String(r) : r.toFixed(1); };
    return `${f(item.h)} × ${f(item.w)} × ${f(item.d)} mm`;
  }
  return `${formatLength(item.h, units)} × ${formatLength(item.w, units)} × ${formatLength(item.d, units)}`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/shared` — Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/shared && git commit -m "feat: shared types and dimension parser"
```

---

### Task 3: URL codec

**Files:**
- Create: `src/shared/urlCodec.ts`, `src/shared/__tests__/urlCodec.test.ts`

**Interfaces:**
- Consumes: `Device`, `ComparisonItem`, `MAX_ITEMS` from `./types`.
- Produces:

```ts
export function encodeComparison(items: ComparisonItem[]): string; // '/a-vs-b' or '/' for empty
export function decodeComparison(path: string, bySlug: Map<string, Device>):
  { items: ComparisonItem[]; missing: string[] };   // never throws
export function comparisonTitle(items: ComparisonItem[]): string; // 'A vs B'
export function slugify(name: string): string;
export const RESERVED_PREFIXES: string[]; // ['api', 'assets']
```

Token grammar: path = `/` + token(`-vs-`token)*; device token = slug; custom token = `slugifiedName~HxWxD` (mm, ≤1 decimal). Custom display name = token name with dashes→spaces, title-cased.

- [ ] **Step 1: Write failing tests**

`src/shared/__tests__/urlCodec.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { encodeComparison, decodeComparison, comparisonTitle, slugify } from '../urlCodec';
import type { Device, ComparisonItem } from '../types';

const iphone: Device = { slug: 'iphone-16-pro', name: 'iPhone 16 Pro', category: 'phone', h: 149.6, w: 71.5, d: 8.25 };
const a4: Device = { slug: 'paper-a4', name: 'Paper: A4', category: 'paper', h: 297, w: 210, d: 1 };
const bySlug = new Map([[iphone.slug, iphone], [a4.slug, a4]]);
const dev = (device: Device): ComparisonItem => ({ kind: 'device', device });
const custom: ComparisonItem = { kind: 'custom', name: 'Shoebox', h: 350, w: 250, d: 130 };

test('encodes devices with -vs-', () =>
  expect(encodeComparison([dev(iphone), dev(a4)])).toBe('/iphone-16-pro-vs-paper-a4'));
test('encodes custom items with ~', () =>
  expect(encodeComparison([custom, dev(a4)])).toBe('/shoebox~350x250x130-vs-paper-a4'));
test('empty encodes to /', () => expect(encodeComparison([])).toBe('/'));

test('decode round-trips devices and customs', () => {
  const r = decodeComparison('/shoebox~350x250x130-vs-paper-a4', bySlug);
  expect(r.missing).toEqual([]);
  expect(r.items).toEqual([
    { kind: 'custom', name: 'Shoebox', h: 350, w: 250, d: 130 },
    dev(a4),
  ]);
});
test('decimal dims round-trip', () => {
  const c: ComparisonItem = { kind: 'custom', name: 'Thing', h: 8.3, w: 71.5, d: 149.6 };
  const r = decodeComparison(encodeComparison([c]), bySlug);
  expect(r.items).toEqual([c]);
});
test('unknown slugs reported as missing, rest kept', () => {
  const r = decodeComparison('/nokia-3310-vs-paper-a4', bySlug);
  expect(r.missing).toEqual(['nokia-3310']);
  expect(r.items).toEqual([dev(a4)]);
});
test('hostile input never throws, yields empty', () => {
  for (const p of ['/', '', '/api/devices', '/%2e%2e/etc', '/a~bxcxd', '/x~1x2', '/x~-1x2x3', '/-vs--vs-', '/a'.repeat(500)]) {
    const r = decodeComparison(p, bySlug);
    expect(Array.isArray(r.items)).toBe(true);
  }
});
test('caps at 8 items', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `t${i}~10x10x10`).join('-vs-');
  expect(decodeComparison('/' + nine, bySlug).items).toHaveLength(8);
});
test('title', () =>
  expect(comparisonTitle([dev(iphone), custom])).toBe('iPhone 16 Pro vs Shoebox'));
test('slugify', () => {
  expect(slugify('Paper: A4')).toBe('paper-a4');
  expect(slugify('  Böxy thing!! ')).toBe('boxy-thing');
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/shared` → FAIL (module not found).

- [ ] **Step 3: Implement**

`src/shared/urlCodec.ts`:
```ts
import type { ComparisonItem, Device } from './types';
import { MAX_ITEMS } from './types';

export const RESERVED_PREFIXES = ['api', 'assets'];
const SEP = '-vs-';
const CUSTOM_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)~(\d+(?:\.\d)?)x(\d+(?:\.\d)?)x(\d+(?:\.\d)?)$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);

function encodeItem(item: ComparisonItem): string {
  if (item.kind === 'device') return item.device.slug;
  return `${slugify(item.name)}~${fmt(item.h)}x${fmt(item.w)}x${fmt(item.d)}`;
}

export function encodeComparison(items: ComparisonItem[]): string {
  if (items.length === 0) return '/';
  return '/' + items.slice(0, MAX_ITEMS).map(encodeItem).join(SEP);
}

function titleCase(slug: string): string {
  return slug.split('-').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

export function decodeComparison(
  path: string,
  bySlug: Map<string, Device>,
): { items: ComparisonItem[]; missing: string[] } {
  const items: ComparisonItem[] = [];
  const missing: string[] = [];
  try {
    const raw = decodeURIComponent(path).replace(/^\/+|\/+$/g, '');
    if (!raw || raw.includes('/')) return { items, missing };
    const first = raw.split('/')[0] ?? '';
    if (RESERVED_PREFIXES.includes(first)) return { items, missing };
    for (const token of raw.split(SEP)) {
      if (items.length >= MAX_ITEMS) break;
      const m = token.match(CUSTOM_RE);
      if (m) {
        const [h, w, d] = [m[2]!, m[3]!, m[4]!].map(Number);
        if ([h, w, d].every((v) => v! >= 0.1 && v! <= 100_000)) {
          items.push({ kind: 'custom', name: titleCase(m[1]!), h: h!, w: w!, d: d! });
          continue;
        }
      }
      if (SLUG_RE.test(token)) {
        const device = bySlug.get(token);
        if (device) items.push({ kind: 'device', device });
        else missing.push(token);
      }
    }
  } catch {
    /* malformed URI etc. — fail open with what we have */
  }
  return { items, missing };
}

export function comparisonTitle(items: ComparisonItem[]): string {
  return items.map((i) => (i.kind === 'device' ? i.device.name : i.name)).join(' vs ');
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/shared` → PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/shared && git commit -m "feat: URL codec for shareable comparison paths"`

---

### Task 4: Device catalog — data, validation/build script, search

**Files:**
- Create: `data/devices/everyday.json`, `data/devices/devices.json`, `scripts/build-catalog.mjs`, `src/shared/search.ts`, `src/shared/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `Device`, `Catalog` types (validation mirrors them in JS).
- Produces: `public/devices.json` (`{version:1, devices:[...]}`, sorted by slug, minified) generated at build; `npm run validate` exits non-zero on bad data; `searchDevices(devices: Device[], query: string, limit?: number): Device[]`.

- [ ] **Step 1: Author seed data**

`data/devices/everyday.json` — the 17 sizeasy presets with verbatim dimensions (the ONLY externally sourced content, per Global Constraints), plus one original addition: **Banana** (~190 mm average, lying flat — a "banana for scale" nod, findable via that alias):
```json
[
  { "slug": "box-of-matches", "name": "Box of Matches", "category": "everyday", "h": 36, "w": 53, "d": 15 },
  { "slug": "credit-card", "name": "Credit Card", "category": "everyday", "h": 54, "w": 85, "d": 1 },
  { "slug": "playing-cards", "name": "Pack of Playing Cards", "category": "everyday", "h": 90, "w": 58, "d": 20 },
  { "slug": "drinks-can", "name": "Drinks Can", "category": "everyday", "h": 115, "w": 65, "d": 65 },
  { "slug": "cd-case", "name": "CD Case", "category": "everyday", "h": 124, "w": 142, "d": 10 },
  { "slug": "wine-bottle", "name": "Wine Bottle", "category": "everyday", "h": 295, "w": 70, "d": 70 },
  { "slug": "banana", "name": "Banana", "category": "everyday", "h": 35, "w": 190, "d": 35, "aliases": ["banana for scale"] },
  { "slug": "19in-monitor", "name": "19″ TFT Monitor", "category": "everyday", "h": 360, "w": 425, "d": 50 },
  { "slug": "32in-tv", "name": "32″ Widescreen TV", "category": "everyday", "h": 550, "w": 790, "d": 90 },
  { "slug": "internal-door", "name": "Internal Door", "category": "everyday", "h": 1982, "w": 838, "d": 33 },
  { "slug": "double-mattress", "name": "Double/Full Mattress", "category": "everyday", "h": 1905, "w": 1371.6, "d": 200 },
  { "slug": "paper-letter", "name": "Paper: Letter", "category": "paper", "h": 279.4, "w": 215.9, "d": 1 },
  { "slug": "paper-ledger", "name": "Paper: Ledger/Tabloid", "category": "paper", "h": 431.8, "w": 279.4, "d": 1 },
  { "slug": "paper-a1", "name": "Paper: A1", "category": "paper", "h": 841, "w": 594, "d": 1 },
  { "slug": "paper-a2", "name": "Paper: A2", "category": "paper", "h": 594, "w": 420, "d": 1 },
  { "slug": "paper-a3", "name": "Paper: A3", "category": "paper", "h": 420, "w": 297, "d": 1 },
  { "slug": "paper-a4", "name": "Paper: A4", "category": "paper", "h": 297, "w": 210, "d": 1 },
  { "slug": "paper-a5", "name": "Paper: A5", "category": "paper", "h": 210, "w": 148, "d": 1 }
]
```

`data/devices/devices.json` — starter modern devices. **Every entry must be verified against the manufacturer's published spec (use web search during execution); do not trust the values below without checking.** Include at minimum, each with `brand`, `year`, `source` (manufacturer domain), and dimensions in mm H×W×D:
iPhone 16 / 16 Pro / 16 Pro Max / SE 3, Samsung Galaxy S24 / S24 Ultra, Google Pixel 9 / 9 Pro, iPad (10th gen) / iPad Pro 11″ (M4), iPad mini (A17 Pro), MacBook Air 13″ (M3) / MacBook Pro 14″ (M4), Nintendo Switch / Switch 2, PlayStation 5 / PS5 Slim, Xbox Series X / Series S, Steam Deck OLED, AirPods Pro 2 case. Example entry shape:
```json
{ "slug": "iphone-16-pro", "name": "iPhone 16 Pro", "brand": "Apple", "category": "phone",
  "h": 149.6, "w": 71.5, "d": 8.25, "year": 2024, "aliases": ["16 pro"], "source": "apple.com" }
```

- [ ] **Step 2: Write the build/validation script**

`scripts/build-catalog.mjs`:
```js
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = 'data/devices';
const OUT = 'public/devices.json';
const CATEGORIES = ['everyday', 'paper', 'phone', 'tablet', 'laptop', 'console', 'pc-case', 'audio', 'camera'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const checkOnly = process.argv.includes('--check');

const errors = [];
const devices = [];
const seen = new Set();

for (const file of (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json')).sort()) {
  const list = JSON.parse(await readFile(path.join(DATA_DIR, file), 'utf8'));
  if (!Array.isArray(list)) { errors.push(`${file}: not an array`); continue; }
  for (const d of list) {
    const id = `${file}:${d.slug ?? '?'}`;
    if (typeof d.slug !== 'string' || !SLUG_RE.test(d.slug)) errors.push(`${id}: bad slug`);
    if (d.slug?.includes('-vs-') || d.slug?.includes('~')) errors.push(`${id}: slug collides with URL grammar`);
    if (seen.has(d.slug)) errors.push(`${id}: duplicate slug`);
    seen.add(d.slug);
    if (typeof d.name !== 'string' || !d.name.trim()) errors.push(`${id}: missing name`);
    if (!CATEGORIES.includes(d.category)) errors.push(`${id}: bad category ${d.category}`);
    for (const k of ['h', 'w', 'd']) {
      const v = d[k];
      if (typeof v !== 'number' || v < 0.1 || v > 100_000) errors.push(`${id}: ${k}=${v} out of range`);
    }
    const allowed = new Set(['slug', 'name', 'category', 'h', 'w', 'd', 'brand', 'year', 'aliases', 'source']);
    for (const k of Object.keys(d)) if (!allowed.has(k)) errors.push(`${id}: unknown key ${k}`);
    devices.push(d);
  }
}

if (errors.length) {
  console.error(`Catalog validation failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
devices.sort((a, b) => a.slug.localeCompare(b.slug));
console.log(`Catalog OK: ${devices.length} devices`);
if (!checkOnly) {
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ version: 1, devices }));
  console.log(`Wrote ${OUT}`);
}
```

- [ ] **Step 3: Run validation, verify it catches errors and passes on good data**

Run: `npm run validate` → `Catalog OK: N devices`.
Then temporarily duplicate a slug in `everyday.json`, run again → exit 1 with `duplicate slug`; revert.

- [ ] **Step 4: Write failing search tests**

`src/shared/__tests__/search.test.ts`:
```ts
import { expect, test } from 'vitest';
import { searchDevices } from '../search';
import type { Device } from '../types';

const D = (slug: string, name: string, extra: Partial<Device> = {}): Device =>
  ({ slug, name, category: 'phone', h: 1, w: 1, d: 1, ...extra });

const devices = [
  D('iphone-16', 'iPhone 16', { brand: 'Apple' }),
  D('iphone-16-pro', 'iPhone 16 Pro', { brand: 'Apple' }),
  D('galaxy-s24', 'Galaxy S24', { brand: 'Samsung', aliases: ['s24'] }),
  D('paper-a4', 'Paper: A4', { category: 'paper' }),
];

test('prefix beats substring', () => {
  const r = searchDevices(devices, 'iphone');
  expect(r[0]!.slug).toBe('iphone-16');
  expect(r.map((d) => d.slug)).toContain('iphone-16-pro');
});
test('matches brand and aliases', () => {
  expect(searchDevices(devices, 'samsung')[0]!.slug).toBe('galaxy-s24');
  expect(searchDevices(devices, 's24')[0]!.slug).toBe('galaxy-s24');
});
test('multi-token requires all tokens', () =>
  expect(searchDevices(devices, '16 pro')[0]!.slug).toBe('iphone-16-pro'));
test('no match → empty; empty query → empty', () => {
  expect(searchDevices(devices, 'zzz')).toEqual([]);
  expect(searchDevices(devices, '  ')).toEqual([]);
});
test('respects limit', () =>
  expect(searchDevices(devices, 'a', 2)).toHaveLength(2));
```

- [ ] **Step 5: Run to verify failure** — `npx vitest run src/shared/__tests__/search.test.ts` → FAIL.

- [ ] **Step 6: Implement search**

`src/shared/search.ts`:
```ts
import type { Device } from './types';

function haystack(d: Device): string {
  return [d.name, d.brand ?? '', ...(d.aliases ?? [])].join(' ').toLowerCase();
}

export function searchDevices(devices: Device[], query: string, limit = 10): Device[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: Array<{ d: Device; score: number }> = [];
  for (const d of devices) {
    const hay = haystack(d);
    let score = 0;
    for (const t of tokens) {
      const idx = hay.indexOf(t);
      if (idx === -1) { score = -1; break; }
      score += idx === 0 ? 3 : hay[idx - 1] === ' ' ? 2 : 1; // prefix > word-start > substring
    }
    if (score > 0) scored.push({ d, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.d.name.length - b.d.name.length || a.d.name.localeCompare(b.d.name))
    .slice(0, limit)
    .map((s) => s.d);
}
```

- [ ] **Step 7: Run tests + validate + typecheck** — all green.

- [ ] **Step 8: Commit** — `git add data scripts src/shared && git commit -m "feat: device catalog with validation and client search"`

---

### Task 5: Comparison store + localStorage

**Files:**
- Create: `src/app/store.tsx`, `src/app/localStore.ts`, `src/app/palette.ts`, `src/app/__tests__/store.test.ts`, `src/app/__tests__/localStore.test.ts`

**Interfaces:**
- Consumes: `ComparisonItem`, `View`, `Units`, `MAX_ITEMS`, `encodeComparison`.
- Produces:

```ts
// store.tsx
export interface ComparisonState { items: ComparisonItem[]; view: View; units: Units; missing: string[]; }
export type Action =
  | { type: 'add'; item: ComparisonItem }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'setView'; view: View }
  | { type: 'setUnits'; units: Units }
  | { type: 'load'; items: ComparisonItem[]; missing: string[] }
  | { type: 'dismissMissing' };
export function reducer(state: ComparisonState, action: Action): ComparisonState;
export function ComparisonProvider(props: { children: ReactNode }): JSX.Element; // useReducer + context
export function useComparison(): { state: ComparisonState; dispatch: Dispatch<Action> };

// localStore.ts  (every function try/catch — never throws)
export function getMyItems(): Array<{ name: string; h: number; w: number; d: number }>;
export function addMyItem(item: { name: string; h: number; w: number; d: number }): void; // dedupe by name, cap 50
export function getRecents(): Array<{ path: string; title: string; ts: number }>;
export function addRecent(path: string, title: string): void; // dedupe by path, cap 20, newest first
export function getStoredUnits(): Units | null;
export function setStoredUnits(u: Units): void;

// palette.ts
export const PALETTE: string[]; // 8 Okabe–Ito hex colors
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]!;
```

- [ ] **Step 1: Write failing tests**

`src/app/__tests__/store.test.ts`:
```ts
import { expect, test } from 'vitest';
import { reducer, type ComparisonState } from '../store';
import type { ComparisonItem } from '../../shared/types';

const empty: ComparisonState = { items: [], view: '3d', units: 'metric', missing: [] };
const item = (name: string): ComparisonItem => ({ kind: 'custom', name, h: 10, w: 10, d: 10 });

test('add appends', () =>
  expect(reducer(empty, { type: 'add', item: item('A') }).items).toHaveLength(1));
test('add caps at 8', () => {
  let s = empty;
  for (let i = 0; i < 10; i++) s = reducer(s, { type: 'add', item: item(`I${i}`) });
  expect(s.items).toHaveLength(8);
});
test('remove by index', () => {
  let s = reducer(empty, { type: 'add', item: item('A') });
  s = reducer(s, { type: 'add', item: item('B') });
  s = reducer(s, { type: 'remove', index: 0 });
  expect(s.items.map((i) => i.kind === 'custom' && i.name)).toEqual(['B']);
});
test('load replaces items and missing', () => {
  const s = reducer(empty, { type: 'load', items: [item('X')], missing: ['ghost'] });
  expect(s.items).toHaveLength(1);
  expect(s.missing).toEqual(['ghost']);
});
test('dismissMissing clears notices', () => {
  const s = reducer({ ...empty, missing: ['x'] }, { type: 'dismissMissing' });
  expect(s.missing).toEqual([]);
});
test('setView / setUnits', () => {
  expect(reducer(empty, { type: 'setView', view: 'top' }).view).toBe('top');
  expect(reducer(empty, { type: 'setUnits', units: 'imperial' }).units).toBe('imperial');
});
```

`src/app/__tests__/localStore.test.ts`:
```ts
import { beforeEach, expect, test, vi } from 'vitest';
import { addMyItem, getMyItems, addRecent, getRecents } from '../localStore';

beforeEach(() => localStorage.clear());

test('myItems round-trip, dedupe by name, newest first', () => {
  addMyItem({ name: 'Box', h: 1, w: 2, d: 3 });
  addMyItem({ name: 'Tin', h: 4, w: 5, d: 6 });
  addMyItem({ name: 'Box', h: 9, w: 9, d: 9 });
  expect(getMyItems().map((i) => i.name)).toEqual(['Box', 'Tin']);
  expect(getMyItems()[0]!.h).toBe(9);
});
test('recents dedupe by path and cap at 20', () => {
  for (let i = 0; i < 25; i++) addRecent(`/p${i}`, `T${i}`);
  addRecent('/p24', 'T24 again');
  const r = getRecents();
  expect(r).toHaveLength(20);
  expect(r[0]!.path).toBe('/p24');
});
test('survives broken storage', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota'); });
  expect(getMyItems()).toEqual([]);
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/app` → FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/app/palette.ts`:
```ts
// Okabe–Ito colorblind-safe palette
export const PALETTE = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#999999'];
export const colorFor = (index: number) => PALETTE[index % PALETTE.length]!;
```

`src/app/localStore.ts`:
```ts
import type { Units } from '../shared/types';

const read = <T>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
};
const write = (key: string, value: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota */ }
};

type MyItem = { name: string; h: number; w: number; d: number };
type Recent = { path: string; title: string; ts: number };

export const getMyItems = (): MyItem[] => read<MyItem[]>('myItems', []);
export function addMyItem(item: MyItem): void {
  const rest = getMyItems().filter((i) => i.name !== item.name);
  write('myItems', [item, ...rest].slice(0, 50));
}
export const getRecents = (): Recent[] => read<Recent[]>('recentComparisons', []);
export function addRecent(path: string, title: string): void {
  const rest = getRecents().filter((r) => r.path !== path);
  write('recentComparisons', [{ path, title, ts: Date.now() }, ...rest].slice(0, 20));
}
export const getStoredUnits = (): Units | null => read<Units | null>('units', null);
export const setStoredUnits = (u: Units): void => write('units', u);
```

`src/app/store.tsx`:
```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ComparisonItem, Units, View } from '../shared/types';
import { MAX_ITEMS } from '../shared/types';
import { getStoredUnits, setStoredUnits } from './localStore';

export interface ComparisonState { items: ComparisonItem[]; view: View; units: Units; missing: string[]; }
export type Action =
  | { type: 'add'; item: ComparisonItem }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  | { type: 'setView'; view: View }
  | { type: 'setUnits'; units: Units }
  | { type: 'load'; items: ComparisonItem[]; missing: string[] }
  | { type: 'dismissMissing' };

export function reducer(state: ComparisonState, action: Action): ComparisonState {
  switch (action.type) {
    case 'add':
      if (state.items.length >= MAX_ITEMS) return state;
      return { ...state, items: [...state.items, action.item] };
    case 'remove':
      return { ...state, items: state.items.filter((_, i) => i !== action.index) };
    case 'clear':
      return { ...state, items: [], missing: [] };
    case 'setView':
      return { ...state, view: action.view };
    case 'setUnits':
      setStoredUnits(action.units);
      return { ...state, units: action.units };
    case 'load':
      return { ...state, items: action.items.slice(0, MAX_ITEMS), missing: action.missing };
    case 'dismissMissing':
      return { ...state, missing: [] };
  }
}

const Ctx = createContext<{ state: ComparisonState; dispatch: Dispatch<Action> } | null>(null);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    items: [], view: '3d' as View, units: getStoredUnits() ?? 'metric', missing: [],
  }));
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useComparison() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useComparison outside ComparisonProvider');
  return ctx;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/app` → PASS; typecheck clean.

- [ ] **Step 5: Commit** — `git add src/app && git commit -m "feat: comparison store and localStorage persistence"`

---

### Task 6: three.js scene module

**Files:**
- Create: `src/three/scene.ts`, `src/three/demo.html` (temporary manual harness, deleted in Task 8)

**Interfaces:**
- Consumes: nothing from app (deliberately framework-free).
- Produces:

```ts
export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem { name: string; h: number; w: number; d: number; color: string; } // mm
export interface SizeScene {
  setItems(items: SceneItem[]): void;
  setView(view: ViewName): void;
  resize(): void;
  dispose(): void;
}
export function createScene(container: HTMLElement): SizeScene;
```

Behavior: items sit on a ground grid, lined up along X with a gap of 8% of the largest dimension; translucent colored boxes (opacity 0.55) + solid edge lines; a CSS2D label above each box; `3d` = perspective camera + OrbitControls (damped), `front/side/top` = orthographic cameras fitted to the bounding box with 10% margin; renders only on demand (state change or control interaction); grid sized to ~2× the bounding footprint, in 10/100/1000mm steps.

- [ ] **Step 1: Implement the module**

`src/three/scene.ts`:
```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type ViewName = '3d' | 'front' | 'side' | 'top';
export interface SceneItem { name: string; h: number; w: number; d: number; color: string; }
export interface SizeScene {
  setItems(items: SceneItem[]): void;
  setView(view: ViewName): void;
  resize(): void;
  dispose(): void;
}

export function createScene(container: HTMLElement): SizeScene {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  container.appendChild(labelRenderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  const persp = new THREE.PerspectiveCamera(40, 1, 1, 1e6);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e6);
  let camera: THREE.Camera = persp;
  let view: ViewName = '3d';

  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener('change', requestRender);

  const group = new THREE.Group();
  scene.add(group);
  let grid: THREE.GridHelper | null = null;
  let bounds = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (view === '3d') controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    });
  }

  function clearGroup() {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      if (o instanceof THREE.LineSegments) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    group.clear();
  }

  function setItems(items: SceneItem[]) {
    clearGroup();
    const maxDim = Math.max(1, ...items.flatMap((i) => [i.h, i.w, i.d]));
    const gap = maxDim * 0.08;
    let x = 0;
    for (const item of items) {
      const geo = new THREE.BoxGeometry(item.w, item.h, item.d);
      const mat = new THREE.MeshLambertMaterial({ color: item.color, transparent: true, opacity: 0.55 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + item.w / 2, item.h / 2, 0);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: item.color }),
      );
      edges.position.copy(mesh.position);
      const labelEl = document.createElement('div');
      labelEl.textContent = item.name;
      labelEl.style.cssText =
        `font:12px ui-sans-serif,system-ui;padding:1px 6px;border-radius:4px;color:#fff;background:${item.color}cc`;
      const label = new CSS2DObject(labelEl);
      label.position.set(0, item.h / 2 + maxDim * 0.04, 0);
      mesh.add(label);
      group.add(mesh, edges);
      x += item.w + gap;
    }
    bounds = new THREE.Box3().setFromObject(group);
    if (items.length === 0) bounds.set(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));

    if (grid) { scene.remove(grid); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); }
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 1);
    const step = 10 ** Math.max(1, Math.ceil(Math.log10(span / 20)));
    const size = Math.ceil((span * 2) / step) * step;
    grid = new THREE.GridHelper(size, size / step, 0x999999, 0xdddddd);
    const c = bounds.getCenter(new THREE.Vector3());
    grid.position.set(c.x, 0, c.z);
    scene.add(grid);
    setView(view); // refit cameras
  }

  function setView(next: ViewName) {
    view = next;
    const c = bounds.getCenter(new THREE.Vector3());
    const s = bounds.getSize(new THREE.Vector3());
    const { width, height } = container.getBoundingClientRect();
    const aspect = Math.max(width, 1) / Math.max(height, 1);
    if (next === '3d') {
      camera = persp;
      persp.aspect = aspect;
      const radius = Math.max(s.x, s.y, s.z, 1);
      persp.position.set(c.x + radius * 1.2, c.y + radius * 0.9, c.z + radius * 1.6);
      persp.lookAt(c);
      persp.updateProjectionMatrix();
      controls.target.copy(c);
      controls.enabled = true;
    } else {
      camera = ortho;
      controls.enabled = false;
      const fit = (fw: number, fh: number) => {
        const m = 1.1;
        const half = Math.max(fw / aspect, fh) * m / 2 * Math.max(aspect, 1);
        ortho.left = -half * (aspect >= 1 ? 1 : aspect);
        ortho.right = -ortho.left;
        ortho.top = ortho.right / aspect;
        ortho.bottom = -ortho.top;
      };
      const far = Math.max(s.x, s.y, s.z) * 4 + 1000;
      if (next === 'front') { fit(s.x, s.y); ortho.position.set(c.x, c.y, c.z + far / 2); }
      if (next === 'side') { fit(s.z, s.y); ortho.position.set(c.x + far / 2, c.y, c.z); }
      if (next === 'top') { fit(s.x, s.z); ortho.position.set(c.x, c.y + far / 2, c.z); }
      ortho.lookAt(c);
      ortho.updateProjectionMatrix();
    }
    if (grid) grid.visible = next !== 'front' && next !== 'side';
    requestRender();
  }

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    setView(view);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    setItems: (items) => { setItems(items); },
    setView,
    resize,
    dispose() {
      ro.disconnect();
      controls.dispose();
      clearGroup();
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
```

- [ ] **Step 2: Manual harness + browser verification**

`src/three/demo.html`:
```html
<!doctype html>
<div id="stage" style="width:100vw;height:100vh;position:relative"></div>
<script type="module">
  import { createScene } from './scene.ts';
  const s = createScene(document.getElementById('stage'));
  s.setItems([
    { name: 'iPhone 16 Pro', h: 149.6, w: 71.5, d: 8.25, color: '#E69F00' },
    { name: 'Paper: A4', h: 297, w: 210, d: 1, color: '#56B4E9' },
    { name: 'Drinks Can', h: 115, w: 65, d: 65, color: '#009E73' },
  ]);
  window.scene = s; // poke s.setView('front') etc. from console
</script>
```

Run: `npx vite` and open `http://localhost:5173/src/three/demo.html` in the browser.
Verify: three labeled translucent boxes on a grid; orbit works; `scene.setView('front'|'side'|'top')` produce sensible orthographic fits; no console errors; `npm run typecheck` clean.

- [ ] **Step 3: Commit** — `git add src/three && git commit -m "feat: three.js comparison scene module"`

---

### Task 6b: Per-axis corner radius (cylinders, rounded phones)

Added mid-execution at the user's request (2026-07-19). Catalog devices may
declare a corner radius on one axis; the scene renders an extruded
rounded-rect instead of a box. Custom items remain plain boxes (v1).

**Files:**
- Modify: `src/shared/types.ts` (Device + radius fields), `src/three/scene.ts`
  (geometry builder), `scripts/build-catalog.mjs` (validation),
  `data/devices/everyday.json`, `data/devices/devices.json` (radius data),
  `src/three/demo.html` (radius examples for visual verification)

**Interfaces:**
- Consumes: existing `SceneItem`, `Device`, build-catalog validation loop.
- Produces: `Device` and `SceneItem` gain `radius?: number` and
  `radiusAxis?: 'x' | 'y' | 'z'` (x=width, y=height, z=depth; fillets the four
  box edges parallel to that axis). Task 8's Viewer must pass both fields
  through when mapping items → SceneItems.

- [ ] **Step 1: Extend types**

In `src/shared/types.ts`, add to `Device` (and export the axis type):
```ts
export type RadiusAxis = 'x' | 'y' | 'z';
// in Device:
  radius?: number;            // mm; fillets edges parallel to radiusAxis
  radiusAxis?: RadiusAxis;    // x=width, y=height, z=depth
```
Add the same two optional fields to `SceneItem` in `src/three/scene.ts`.

- [ ] **Step 2: Validation (build-catalog.mjs)**

Add `radius`, `radiusAxis` to the `allowed` key set, and after the h/w/d loop:
```js
if (d.radius !== undefined || d.radiusAxis !== undefined) {
  const cross = { x: ['h', 'd'], y: ['w', 'd'], z: ['h', 'w'] }[d.radiusAxis];
  if (!cross) errors.push(`${id}: radiusAxis must be x|y|z when radius present`);
  else if (typeof d.radius !== 'number' || d.radius <= 0
    || d.radius > Math.min(d[cross[0]], d[cross[1]]) / 2 + 0.01)
    errors.push(`${id}: radius out of range for its cross-section`);
}
```
Verify: `npm run validate` passes; a temporary entry with radius 40 on a
65mm-wide can (max 32.51) fails; revert.

- [ ] **Step 3: Geometry builder (scene.ts)**

Replace the `BoxGeometry` construction in `setItems` with `buildGeometry(item)`:
```ts
function roundedRectShape(a: number, b: number, r: number): THREE.Shape {
  const hx = a / 2, hy = b / 2, rr = Math.min(r, hx, hy);
  const s = new THREE.Shape();
  s.moveTo(-hx + rr, -hy);
  s.lineTo(hx - rr, -hy); s.absarc(hx - rr, -hy + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(hx, hy - rr);  s.absarc(hx - rr, hy - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-hx + rr, hy); s.absarc(-hx + rr, hy - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hy + rr); s.absarc(-hx + rr, -hy + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

function buildGeometry(item: SceneItem): THREE.BufferGeometry {
  if (!item.radius || !item.radiusAxis)
    return new THREE.BoxGeometry(item.w, item.h, item.d);
  const opts = { bevelEnabled: false, curveSegments: 12 };
  let geo: THREE.BufferGeometry;
  if (item.radiusAxis === 'z') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.h, item.radius), { ...opts, depth: item.d });
  } else if (item.radiusAxis === 'y') {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.w, item.d, item.radius), { ...opts, depth: item.h });
    geo.rotateX(-Math.PI / 2);
  } else {
    geo = new THREE.ExtrudeGeometry(roundedRectShape(item.d, item.h, item.radius), { ...opts, depth: item.w });
    geo.rotateY(Math.PI / 2);
  }
  geo.center(); // extrusion spans [0, depth] along its axis; recenter like BoxGeometry
  return geo;
}
```
Change the edge-lines construction to a 30° threshold so curve tessellation
doesn't render as wireframe noise (box edges are 90°, unaffected):
`new THREE.EdgesGeometry(geo, 30)`.

- [ ] **Step 4: Radius data**

Approximate visual values (cylinders exact; phone corners are visual
approximations, not manufacturer claims):
- `drinks-can`: `"radius": 32.5, "radiusAxis": "y"` (cylinder)
- `wine-bottle`: `"radius": 35, "radiusAxis": "y"` (cylinder)
- `banana`: `"radius": 17.5, "radiusAxis": "x"` (cylinder along length)
- every `category: "phone"` device: `"radius": 11, "radiusAxis": "z"`
- every `category: "tablet"` device: `"radius": 9, "radiusAxis": "z"`
- `airpods-pro-2-case`: `"radius": 20, "radiusAxis": "z"`

Run `node scripts/build-catalog.mjs` to regenerate `public/devices.json`.

- [ ] **Step 5: Demo + checks**

Update `src/three/demo.html` items to include a radius cylinder and a rounded
phone (copy dims/radius from the data above). Run `npm run validate && npm
test && npm run typecheck && npx vite build` — all green. Controller performs
browser verification (can renders as cylinder; phone corners rounded in front
view; no console errors).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: per-axis corner radius for catalog devices"
```

---

### Task 7: Catalog hook + AddItemPanel (search combobox + custom form)

**Files:**
- Create: `src/app/useCatalog.ts`, `src/app/components/AddItemPanel.tsx`
- Modify: `src/app/App.tsx` (mount provider + panel)

**Interfaces:**
- Consumes: `searchDevices`, `parseDimensions`, store `dispatch({type:'add'})`, `getMyItems`/`addMyItem`.
- Produces: `useCatalog(): { devices: Device[]; bySlug: Map<string, Device>; status: 'loading'|'ready'|'error'; retry(): void }`; `<AddItemPanel />` adds items to the store.

- [ ] **Step 1: Implement `useCatalog`**

`src/app/useCatalog.ts`:
```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Catalog, Device } from '../shared/types';

let cache: Device[] | null = null;

export function useCatalog() {
  const [devices, setDevices] = useState<Device[]>(cache ?? []);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(cache ? 'ready' : 'loading');

  const load = useCallback(() => {
    setStatus('loading');
    fetch('/api/devices')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Catalog>; })
      .then((c) => { cache = c.devices; setDevices(c.devices); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => { if (!cache) load(); }, [load]);
  const bySlug = useMemo(() => new Map(devices.map((d) => [d.slug, d])), [devices]);
  return { devices, bySlug, status, retry: load };
}
```
Dev note: in `vite.config.ts` add a dev-server alias so `/api/devices` works locally:
```ts
server: { proxy: {} }, // no proxy needed; instead:
```
Actually serve it directly — add to `vite.config.ts` a tiny middleware plugin:
```ts
const devApi = () => ({
  name: 'dev-api-devices',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/api/devices', async (_req, res) => {
      const { readFile } = await import('node:fs/promises');
      res.setHeader('content-type', 'application/json');
      res.end(await readFile('public/devices.json'));
    });
  },
});
// plugins: [react(), tailwindcss(), devApi()]
```
(Run `npm run validate` once without `--check` — i.e. `node scripts/build-catalog.mjs` — so `public/devices.json` exists for dev.)

- [ ] **Step 2: Implement `AddItemPanel`**

Check the installed Base UI version's Combobox API first: `ls node_modules/@base-ui-components/react/` and read its `.d.ts` — adjust part names if they differ from below.

`src/app/components/AddItemPanel.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { Combobox } from '@base-ui-components/react/combobox';
import { searchDevices } from '../../shared/search';
import { parseDimensions } from '../../shared/dimensions';
import type { Device } from '../../shared/types';
import { useCatalog } from '../useCatalog';
import { useComparison } from '../store';
import { addMyItem, getMyItems } from '../localStore';

export default function AddItemPanel() {
  const { devices, status, retry } = useCatalog();
  const { state, dispatch } = useComparison();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [dims, setDims] = useState('');
  const [dimsError, setDimsError] = useState<string | null>(null);
  const full = state.items.length >= 8;

  const myItems = getMyItems();
  const results = useMemo(() => searchDevices(devices, query), [devices, query]);
  const myMatches = useMemo(
    () => myItems.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 3),
    [myItems, query],
  );

  const addDevice = (d: Device) => { dispatch({ type: 'add', item: { kind: 'device', device: d } }); setQuery(''); };

  const addCustom = () => {
    const parsed = parseDimensions(dims);
    if (!parsed) { setDimsError('Use height x width x depth, e.g. 85x64x12mm or 5x3x2in'); return; }
    if (!name.trim()) { setDimsError('Give it a name'); return; }
    const item = { name: name.trim(), ...parsed };
    dispatch({ type: 'add', item: { kind: 'custom', ...item } });
    addMyItem(item);
    setName(''); setDims(''); setDimsError(null);
  };

  return (
    <section className="space-y-4" aria-label="Add items">
      <div>
        <label className="mb-1 block text-sm font-medium">Search devices</label>
        {status === 'error' ? (
          <button onClick={retry} className="text-sm text-red-600 underline">Catalog failed to load — retry</button>
        ) : (
          <Combobox.Root items={results} onValueChange={(d) => d && addDevice(d as Device)}>
            <Combobox.Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={status === 'loading' ? 'Loading catalog…' : 'iPhone 16, A4 paper…'}
              disabled={full}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
            <Combobox.Portal>
              <Combobox.Positioner sideOffset={4}>
                <Combobox.Popup className="max-h-72 w-[var(--anchor-width)] overflow-auto rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
                  <Combobox.List>
                    {myMatches.map((i) => (
                      <Combobox.Item
                        key={`mine-${i.name}`}
                        value={i}
                        onClick={() => dispatch({ type: 'add', item: { kind: 'custom', ...i } })}
                        className="cursor-pointer px-3 py-2 text-sm data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800"
                      >
                        {i.name} <span className="text-stone-400">(my item)</span>
                      </Combobox.Item>
                    ))}
                    {results.map((d) => (
                      <Combobox.Item
                        key={d.slug}
                        value={d}
                        className="cursor-pointer px-3 py-2 text-sm data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800"
                      >
                        {d.name}{d.brand ? <span className="text-stone-400"> — {d.brand}</span> : null}
                      </Combobox.Item>
                    ))}
                  </Combobox.List>
                </Combobox.Popup>
              </Combobox.Positioner>
            </Combobox.Portal>
          </Combobox.Root>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-800">
        <p className="text-sm font-medium">Or add your own</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
          disabled={full}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900" />
        <input value={dims} onChange={(e) => { setDims(e.target.value); setDimsError(null); }}
          placeholder="85x64x12mm or 5x3x2in" disabled={full}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900" />
        {dimsError && <p className="text-sm text-red-600" role="alert">{dimsError}</p>}
        <button onClick={addCustom} disabled={full}
          className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
          Add item
        </button>
        {full && <p className="text-xs text-stone-500">Comparison is full (8 items)</p>}
      </div>
    </section>
  );
}
```

Update `App.tsx` to wrap in `ComparisonProvider` and render `<AddItemPanel />` in a left column (layout finalized in Task 8).

- [ ] **Step 3: Verify in browser**

Run: `node scripts/build-catalog.mjs && npx vite`, open the app.
Verify: typing "iph" lists iPhones; selecting adds nothing visible yet (viewer comes in Task 8) but React DevTools/state shows the item; custom form rejects `foo` with the inline error and accepts `85x64x12mm`; added custom items appear under "(my item)" on next search. `npm test` + typecheck stay green.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: catalog hook and add-item panel"`

---

### Task 8: Comparison UI — viewer, chips, tabs, share, URL sync, empty state

**Files:**
- Create: `src/app/components/Viewer.tsx`, `ItemList.tsx`, `ViewTabs.tsx`, `ShareButton.tsx`, `EmptyState.tsx`, `src/app/useUrlSync.ts`
- Modify: `src/app/App.tsx`
- Delete: `src/three/demo.html`

**Interfaces:**
- Consumes: `createScene`/`SizeScene`, store, `encodeComparison`/`decodeComparison`/`comparisonTitle`, `colorFor`, `formatDims`, `addRecent`/`getRecents`, `useCatalog`.
- Produces: the complete v1 UI.

- [ ] **Step 1: URL sync hook**

`src/app/useUrlSync.ts`:
```ts
import { useEffect, useRef } from 'react';
import { decodeComparison, encodeComparison, comparisonTitle } from '../shared/urlCodec';
import { addRecent } from './localStore';
import { useComparison } from './store';
import { useCatalog } from './useCatalog';

export function useUrlSync() {
  const { state, dispatch } = useComparison();
  const { bySlug, status } = useCatalog();
  const hydrated = useRef(false);

  // hydrate from URL once catalog is ready (custom-only URLs don't need it)
  useEffect(() => {
    if (hydrated.current) return;
    const path = location.pathname;
    if (path === '/') { hydrated.current = true; return; }
    const hasSlug = /(?:^|\/|-vs-)(?![^-]*~)/.test(path); // cheap check; just wait for catalog when unsure
    if (status !== 'ready' && hasSlug) return;
    const { items, missing } = decodeComparison(path, bySlug);
    dispatch({ type: 'load', items, missing });
    hydrated.current = true;
  }, [status, bySlug, dispatch]);

  // reflect state → URL + document.title + recents
  useEffect(() => {
    if (!hydrated.current) return;
    const path = encodeComparison(state.items);
    if (path !== location.pathname) history.replaceState(null, '', path);
    const title = comparisonTitle(state.items);
    document.title = title ? `${title} — size.fyi` : 'size.fyi — compare the size of anything';
    if (state.items.length >= 2) addRecent(path, title);
  }, [state.items]);

  // back/forward
  useEffect(() => {
    const onPop = () => {
      const { items, missing } = decodeComparison(location.pathname, bySlug);
      dispatch({ type: 'load', items, missing });
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, [bySlug, dispatch]);
}
```

- [ ] **Step 2: Components**

`src/app/components/Viewer.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { createScene, type SizeScene } from '../../three/scene';
import { colorFor } from '../palette';
import { useComparison } from '../store';

export default function Viewer() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SizeScene | null>(null);
  const { state } = useComparison();

  useEffect(() => {
    if (!ref.current) return;
    try { sceneRef.current = createScene(ref.current); }
    catch { sceneRef.current = null; /* WebGL unavailable; table remains */ }
    return () => sceneRef.current?.dispose();
  }, []);

  useEffect(() => {
    sceneRef.current?.setItems(state.items.map((item, i) => ({
      name: item.kind === 'device' ? item.device.name : item.name,
      h: item.kind === 'device' ? item.device.h : item.h,
      w: item.kind === 'device' ? item.device.w : item.w,
      d: item.kind === 'device' ? item.device.d : item.d,
      radius: item.kind === 'device' ? item.device.radius : undefined,
      radiusAxis: item.kind === 'device' ? item.device.radiusAxis : undefined,
      color: colorFor(i),
    })));
  }, [state.items]);

  useEffect(() => { sceneRef.current?.setView(state.view); }, [state.view]);

  return <div ref={ref} className="relative h-full min-h-[320px] w-full" data-testid="viewer" />;
}
```

`src/app/components/ItemList.tsx`:
```tsx
import { formatDims } from '../../shared/dimensions';
import { colorFor } from '../palette';
import { useComparison } from '../store';

export default function ItemList() {
  const { state, dispatch } = useComparison();
  if (state.items.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Items">
      {state.items.map((item, i) => {
        const name = item.kind === 'device' ? item.device.name : item.name;
        const dims = item.kind === 'device' ? item.device : item;
        return (
          <li key={`${name}-${i}`} className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-stone-500">{formatDims(dims, state.units)}</p>
            </div>
            <button onClick={() => dispatch({ type: 'remove', index: i })} aria-label={`Remove ${name}`}
              className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200">✕</button>
          </li>
        );
      })}
    </ul>
  );
}
```

`src/app/components/ViewTabs.tsx`:
```tsx
import type { View } from '../../shared/types';
import { useComparison } from '../store';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: '3d', label: '3D' }, { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' }, { id: 'top', label: 'Top' },
];

export default function ViewTabs() {
  const { state, dispatch } = useComparison();
  return (
    <div role="tablist" aria-label="View" className="inline-flex rounded-md border border-stone-200 p-0.5 dark:border-stone-800">
      {VIEWS.map((v) => (
        <button key={v.id} role="tab" aria-selected={state.view === v.id}
          onClick={() => dispatch({ type: 'setView', view: v.id })}
          className={`rounded px-3 py-1 text-sm ${state.view === v.id ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 dark:text-stone-300'}`}>
          {v.label}
        </button>
      ))}
    </div>
  );
}
```

`src/app/components/ShareButton.tsx`:
```tsx
import { useState } from 'react';
import { comparisonTitle, encodeComparison } from '../../shared/urlCodec';
import { useComparison } from '../store';

export default function ShareButton() {
  const { state } = useComparison();
  const [copied, setCopied] = useState(false);
  if (state.items.length === 0) return null;

  const share = async () => {
    const url = location.origin + encodeComparison(state.items);
    const title = comparisonTitle(state.items);
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button onClick={share}
      className="rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}
```

`src/app/components/EmptyState.tsx`:
```tsx
import { getRecents } from '../localStore';

export default function EmptyState() {
  const recents = getRecents();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <h2 className="text-xl font-semibold">Compare the size of anything</h2>
        <p className="mt-1 text-sm text-stone-500">
          Search for a device or enter dimensions, and see them side by side in 3D.
        </p>
      </div>
      {recents.length > 0 && (
        <div className="w-full max-w-md text-left">
          <h3 className="mb-2 text-sm font-medium text-stone-500">Recent comparisons</h3>
          <ul className="space-y-1">
            {recents.slice(0, 8).map((r) => (
              <li key={r.path}>
                <a href={r.path} className="text-sm text-blue-600 hover:underline dark:text-blue-400">{r.title}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

`src/app/App.tsx` (final layout):
```tsx
import AddItemPanel from './components/AddItemPanel';
import EmptyState from './components/EmptyState';
import ItemList from './components/ItemList';
import ShareButton from './components/ShareButton';
import ViewTabs from './components/ViewTabs';
import Viewer from './components/Viewer';
import { ComparisonProvider, useComparison } from './store';
import { useUrlSync } from './useUrlSync';

function Shell() {
  useUrlSync();
  const { state, dispatch } = useComparison();
  return (
    <div className="flex min-h-screen flex-col bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <a href="/" className="text-lg font-semibold tracking-tight">size.fyi</a>
        <div className="flex items-center gap-2">
          <button onClick={() => dispatch({ type: 'setUnits', units: state.units === 'metric' ? 'imperial' : 'metric' })}
            className="rounded-md border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">
            {state.units === 'metric' ? 'mm' : 'in'}
          </button>
          <ShareButton />
        </div>
      </header>
      {state.missing.length > 0 && (
        <div className="flex items-center justify-between bg-amber-100 px-4 py-2 text-sm text-amber-900" role="status">
          <span>Couldn’t find: {state.missing.join(', ')}</span>
          <button onClick={() => dispatch({ type: 'dismissMissing' })} aria-label="Dismiss">✕</button>
        </div>
      )}
      <main className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
        <aside className="w-full space-y-4 md:w-80 md:shrink-0">
          <AddItemPanel />
          <ItemList />
        </aside>
        <section className="flex flex-1 flex-col gap-3">
          <ViewTabs />
          <div className="relative flex-1 overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            {state.items.length === 0 ? <EmptyState /> : <Viewer />}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ComparisonProvider>
      <Shell />
    </ComparisonProvider>
  );
}
```

- [ ] **Step 3: Update the App smoke test** — it should still pass (wordmark renders). Add a reducer-level regression already covered in Task 5; UI behavior is verified in-browser.

- [ ] **Step 4: Browser verification (use the dev server + Browser pane)**

Checklist:
- Add two devices + one custom item → three colored boxes with labels; URL becomes `/iphone-16-vs-…`; document title updates.
- Reload that URL → comparison restores; unknown slug URL (`/nokia-9999-vs-paper-a4`) → amber notice, A4 still renders.
- View tabs switch cameras; unit toggle flips chip dimensions; Share copies the URL; remove works; empty state shows recents after clearing.
- Mobile width (375px): panel stacks above viewer.

- [ ] **Step 5: Delete demo, commit**

```bash
rm src/three/demo.html
git add -A && git commit -m "feat: complete comparison UI with URL sync and sharing"
```

---

### Task 9: Worker — /api/devices + OG injection

**Files:**
- Create: `src/worker/index.ts`, `src/worker/__tests__/worker.test.ts`, `vitest.workers.config.ts`
- Modify: `wrangler.jsonc`, `package.json` (test:worker script), `vitest.config.ts` (exclude worker tests)

**Interfaces:**
- Consumes: `decodeComparison`, `comparisonTitle`, `Catalog` from `src/shared/` (isomorphic — no DOM/node APIs there).
- Produces: deployed Worker behavior:
  - `GET /api/devices` → catalog JSON, `ETag`, `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
  - `GET /<comparison-path>` → app HTML with injected `<title>`, `og:title`, `og:description`, `og:url`, `twitter:card`.
  - anything else → static assets (SPA fallback).

- [ ] **Step 1: Install workers test tooling**

```bash
npm install -D @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

`vitest.workers.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/worker/**/*.test.ts'],
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
});
```
Add script: `"test:worker": "npm run build && vitest run -c vitest.workers.config.ts"` (build first so `dist/` assets exist). Exclude `src/worker` from `vitest.config.ts` include globs (already scoped to `src/{app,shared,three}`).

- [ ] **Step 2: Update `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "size-fyi",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-07-19",
  "account_id": "c0912e10eadeaa117b0067ab29b55da6",
  "routes": [
    { "pattern": "size.fyi/*", "zone_id": "97d61ea9647d82b9472d12d85a675f9b" },
    { "pattern": "www.size.fyi/*", "zone_id": "97d61ea9647d82b9472d12d85a675f9b" }
  ],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"
  }
}
```
(Asset-matching paths are served before the Worker by default; non-asset paths — comparison URLs, `/api/*` — reach the Worker. That is exactly what we want.)

- [ ] **Step 3: Write failing worker tests**

`src/worker/__tests__/worker.test.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify failure** — `npm run test:worker` → FAIL (no worker module).

- [ ] **Step 5: Implement worker**

`src/worker/index.ts`:
```ts
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
            const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            meta(`property="og:title" content="${esc(title)}"`);
            meta(`property="og:description" content="${esc(desc)}"`);
            meta(`property="og:url" content="${esc(canonical)}"`);
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
```

Note: `env.ASSETS.fetch('/')` returns `index.html`; SPA fallback covers deep links when the Worker isn't first, but comparison paths never match assets so they always come through here.

Add `"types": ["vite/client", "@cloudflare/workers-types"]` to a `tsconfig` override for `src/worker` (create `src/worker/tsconfig.json` extending root with that `types` array) so `HTMLRewriter`/`Fetcher` typecheck.

- [ ] **Step 6: Run worker tests** — `npm run test:worker` → PASS. Also `npm test` and `npm run typecheck` stay green.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: worker api and og tag injection"`

---

### Task 10: CI, README, deploy, live verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: CI on push; the live site at https://size.fyi running the real app.

- [ ] **Step 1: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run validate
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: npx vitest run -c vitest.workers.config.ts
```

- [ ] **Step 2: Rewrite README**

Cover: what the site is (one paragraph, original copy), stack summary, `npm run dev` / `test` / `validate` / `deploy`, how to add catalog devices (edit `data/devices/*.json`, dimensions in mm H×W×D from the manufacturer's spec, run `npm run validate`), URL grammar reference, and the D1 seam note. Do not reference other comparison sites.

- [ ] **Step 3: Full local check**

Run: `npm run validate && npm run typecheck && npm test && npm run build && npm run test:worker`
Expected: everything green.

- [ ] **Step 4: Deploy and verify live**

```bash
npm run deploy
```
Then verify (curl + Browser pane):
- `https://size.fyi/` loads the app (200, HTML contains the app root).
- `https://size.fyi/api/devices` returns the catalog with cache headers.
- `https://size.fyi/drinks-can-vs-paper-a4` → view-source shows injected OG title; the page renders the comparison.
- Interactive smoke in Browser pane: add items, switch views, share, reload.

- [ ] **Step 5: Commit + push**

```bash
git add -A && git commit -m "feat: ci workflow and launch readme"
git push
```

---

## Self-Review Notes

- **Spec coverage:** URL scheme (T3), catalog+validation+lazy load (T4, T7), localStorage myItems/recents/units (T5, T7, T8), three.js views + on-demand render (T6), combobox search + custom entry + errors (T7), share + native share (T8), missing-slug notice + fail-open (T3, T8, T9), Worker /api/devices + OG + SPA fallback (T9), CI + manual deploy (T10), WebGL-unavailable fallback (T8 Viewer try/catch; dimension chips always render). Covered.
- **Type consistency:** `SizeScene`/`SceneItem` (T6) match Viewer usage (T8); `decodeComparison(path, bySlug)` signature identical in app (T8) and Worker (T9); `Catalog {version, devices}` matches build script output (T4), useCatalog (T7), and worker (T9).
- **Known judgment calls for the executor:** Base UI Combobox part names must be checked against the installed version (step called out in T7); starter device dimensions must be web-verified against manufacturer specs before committing (called out in T4); the `useUrlSync` hydration guard should be simplified if the catalog is ready before first paint in practice.
