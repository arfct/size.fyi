# Optional per-device 3D models — plan

**Goal:** let a catalog device optionally carry a real 3D model (glTF/GLB) that renders in the
viewer in place of the procedural box, and doubles as the asset source for mobile AR
([mobile AR plan](2026-07-20-mobile-ar-plan.md)). Devices without a model keep rendering as
today (box / rounded box / screen inset / banana mesh).

## Principles

- **Dimensions stay canonical.** `h/w/d` remain the source of truth for size. A model is fit
  *into* that bounding box — it never overrides the measured size. This keeps sorting, gaps,
  grid, labels, and the whole comparison honest even if a model is slightly off.
- **Opt-in and lazy.** Only devices that declare a model load one, and only when added to a
  comparison. Everything degrades to the box on error or on WebGL/perf limits.
- **Cheap hosting.** Models are static assets; keep them small (see pipeline) and serve from the
  Worker's asset bucket, moving to R2 only if the catalog of models grows large.

## Schema

Add one optional field to `Device` (`src/shared/types.ts`). Note the existing `model` field is
the *model-name string* (e.g. "Pebble Time 2"); the 3D asset needs a different name — use
`model3d`.

```ts
model3d?: {
  url: string;              // relative path served under /models, e.g. "pebble-time-2.glb"
  rotation?: [number, number, number]; // optional degrees XYZ applied before bbox-fit
};
```

- `build-catalog.mjs`: validate that `model3d.url` matches `^[a-z0-9-]+\.glb$`, that the file
  exists in `public/models/`, and warn if it exceeds a size budget (e.g. 500 KB). `rotation`, if
  present, is three finite numbers.
- URL grammar and everything else are unaffected (models are a rendering detail, not part of the
  shareable slug).

## Rendering (`src/three/scene.ts`)

- A module-level `GLTFLoader` (+ `DRACOLoader`/`meshopt` decoder for compressed models) loads
  `${'/models/'}${url}` on demand, cached by url.
- On load: apply `rotation`, then compute the model's bounding box and **scale uniformly-per-axis
  so its bbox equals the device `w × h × d`** (same normalization the banana mesh already uses in
  `buildBananaGeometry`), and center it on the ground like other items. This makes the model
  interchangeable with the box in `computeTargets` (row/stack positions, gaps, renderOrder all use
  `h/w/d`, unchanged).
- While loading (or on error), show the box placeholder; swap to the model when ready. Reuse the
  existing add/remove/relayout tweens.
- Dispose loaded geometries/materials on item removal and on `dispose()`, matching the current
  handle cleanup.
- **Orientation reality:** CAD/STL axes rarely match our `h=height, w=width, d=depth` convention
  (the Pebble spike below had the long "lug" axis where we call height). `rotation` is the manual
  fix; bbox-fit handles scale. Auto-guessing axis assignment from bbox magnitudes is unreliable
  when two dims are close, so keep it explicit per model.

## Asset pipeline

STL/STEP CAD → optimized GLB (+ USDZ for iOS AR). Steps:

1. **Parse + to GLB** — `scripts/stl-to-glb.mjs` (already written; three `STLLoader` + a hand-rolled
   GLB writer, no extra deps).
2. **Decimate + compress** — the raw CAD solids are far too heavy for web (see spike: 7–14 MB).
   Add a step using `@gltf-transform/cli` (or Blender headless): `weld`, `simplify` to a triangle
   budget (~20–40k), then Draco or meshopt compression. Target < 500 KB/model.
3. **USDZ** — generate per-model USDZ for iOS AR Quick Look (Apple `usdzconvert`/Reality Converter,
   or three `USDZExporter` in a headless step). Real-world scale (metres): USDZ is authored in
   metres, so scale mm → m (×0.001).
4. Output `public/models/<slug>.glb` (+ `.usdz`). A `scripts/build-models.mjs` wraps 1–3 so it's
   reproducible; document tool prerequisites in the README.

## Spike already done (2026-07-20)

Pulled the official Core Devices solid models from `github.com/coredevices/hardware` and converted
them with `scripts/stl-to-glb.mjs` → `public/models/`:

| Model | Verts | bbox (mm) | GLB size |
|---|---|---|---|
| pebble-2-duo | 299k | 32.6 × 47.6 × 10.5 | 7.2 MB |
| pebble-round-2 | 35k | 43.2 × 44.2 × 10.2 | 0.85 MB |
| pebble-time-2 | 592k | 37.1 × 46.6 × 12.4 | 14.2 MB |

These are valid glTF 2.0 (verified) and geometrically correct, but **unoptimized** — they prove
the parse/convert path works and are the test fixtures for the renderer, not shippable as-is. Step
2 (decimate + Draco) is required before wiring them into the catalog. bbox axes confirm the
orientation caveat above (long axis ≈ 46–48 mm sits where we store width, not height).

## Task outline

1. Schema + `build-catalog` validation for `model3d`.
2. `build-models.mjs`: decimate/compress the three Pebble GLBs to < 500 KB; emit USDZ.
3. Scene: on-demand GLTF load, rotation + bbox-fit normalization, placeholder/fallback, disposal.
4. Wire `model3d` for `pebble-time-2`, `pebble-2-duo`, and add `pebble-round-2` to the catalog.
5. Tests: bbox-fit math (pure), validation rules; browser-verify a model renders at box scale and
   falls back on error.
6. Revisit hosting (R2) only if total model weight warrants it.
