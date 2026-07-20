# Mobile AR preview (Apple AR Quick Look + Google Scene Viewer) — plan

**Goal:** on a phone, let the user drop the comparison into their real space at true scale — the
most visceral version of "how big is this?". Uses the OS-native viewers, no app install:

- **iOS / iPadOS (Safari):** AR Quick Look, launched by an `<a rel="ar" href="…usdz">` link to a
  **USDZ** file.
- **Android (Chrome):** Scene Viewer, launched via an `intent://arvr.google.com/scene-viewer/…`
  URL pointing at a **GLB** file (`mode=ar_preferred`).

Both viewers fetch a real, hosted model file over https and read real-world scale from it (USDZ in
metres; GLB size interpreted in metres). They cannot take an in-memory blob — the model must live
at a URL. That single constraint drives the phased approach below.

## Approach: native links, no `<model-viewer>`

`<model-viewer>` would abstract both platforms but bundles its own copy of three.js and is heavy —
against the low-cost/lightweight ethos, and redundant with our existing vanilla three scene. So
build the launch ourselves:

- Feature-detect iOS Quick Look: `document.createElement('a').relList.supports('ar')`.
- Otherwise, on Android, use the Scene Viewer intent URL (with a plain-https fallback link in the
  intent's `S.browser_fallback_url`).
- Show the **"View in AR"** button only on a supported mobile browser; hide on desktop (optionally
  later: show a QR code that opens the current comparison URL on a phone).

Units: our scene is millimetres; AR is metres. Author USDZ at ×0.001 and set the GLB/Scene-Viewer
scale so 1 unit = 1 mm resolves to real size.

## Phase 1 (MVP): single-device AR from pre-generated assets

Ties directly to the [device 3D models plan](2026-07-20-device-3d-models-plan.md). Any device that
has a `model3d` also gets a sibling `.usdz`. In the item menu (next to Edit/Remove) or on the item
row, add **"View in AR"** for such devices:

- iOS: `<a rel="ar" href="/models/<slug>.usdz"><img …></a>`.
- Android: Scene Viewer intent with `file=https://size.fyi/models/<slug>.glb`.

This is static-file only (no backend), covers the common "see this one object at real size" case,
and is shippable as soon as the model pipeline emits USDZ. It does **not** compose multiple items.

## Phase 2: whole-comparison AR (composed model)

To AR an arbitrary comparison (N boxes + device models, in row/stack), we must produce one model of
the current scene and host it at a URL:

- **Generate client-side from the live scene.** three ships both exporters we need:
  `GLTFExporter` (→ GLB, Android) and `USDZExporter` (→ USDZ, iOS). Export the scene group, scaled
  mm→m.
- **Host it to get a URL.** AR Quick Look and Scene Viewer both reject `blob:`/object URLs, so the
  exported bytes must be uploaded and served. Add a small Worker + R2 (or KV) endpoint:
  `POST /ar` stores the GLB/USDZ and returns a short-lived URL (`/ar/<hash>.usdz|glb`); the AR
  button uploads on tap, then launches with the returned URL. Content-address by hash so identical
  comparisons dedupe and can be cached. Expire objects after N days.
- Alternative considered: compose server-side from the shareable slug (`/ar/<comparison>.usdz`).
  Rejected for MVP — USDZ authoring in a Worker is complex; client-side exporters are already
  available and keep the Worker to a dumb blob store.

## Fidelity / risks

- **Translucency & materials:** our comparison uses transparent boxes; AR Quick Look handling of
  transparency and render order differs from our WebGL scene. Likely author AR models as solid,
  lightly-tinted, or with distinct opaque colors so overlapping items stay legible in AR. Validate
  early on device.
- **USDZ correctness:** the fiddliest artifact. Verify on a real iPhone (scale, materials, no
  z-fighting) before relying on `USDZExporter`; keep Apple's Reality Converter as a fallback path.
- **Scale bugs** are the scariest failure (an AR tool that lies about size is worse than none) —
  add an explicit on-device check that a known object (e.g. a credit card) measures correctly.
- **Hosting cost/abuse** for Phase 2 uploads: cap size, rate-limit, expire; content-addressing
  bounds storage.
- Android intent quirks and the `browser_fallback_url`; iOS requiring the `<img>` child inside the
  `rel="ar"` anchor to be tappable.

## USDZ generation — findings (2026-07-20 spike)

- **three ships `USDZExporter`** (`three/examples/jsm/exporters/USDZExporter.js`, confirmed in our
  installed three 0.185.1): `await new USDZExporter().parseAsync(scene, { maxTextureSize })` →
  USDZ bytes, **client-side, no server tooling**. Limits: no animations, PBR-metallic-roughness
  only, textures re-encoded. Fine for our simple box/model geometry.
- **Build-time glTF→USDZ options** (for pre-generated per-device assets): Google
  [`usd_from_gltf`](https://github.com/google/usd_from_gltf) (CLI/Docker, purpose-built for Quick
  Look, lossy — doubles geometry for double-sided), Apple **Reality Converter** (macOS GUI) or
  `usdzconvert` (needs Xcode + USD Python tools). **None are installed here** (no Xcode/Docker
  image), so a build-time USDZ step would add a real toolchain dependency.
- **Recommendation change:** because `USDZExporter` works in-browser and needs no toolchain,
  generate **both** GLB (`GLTFExporter`) **and** USDZ (`USDZExporter`) client-side on the AR tap,
  upload to the Worker/R2 blob store, and launch with the returned URL. This collapses Phase 1 and
  Phase 2 into one path and avoids installing/maintaining `usd_from_gltf`. Per-device static USDZ
  becomes an optional optimization, not a prerequisite.
- **⚠️ Transparency is the blocker, not the format.** AR Quick Look (iOS 16+) frustum-culls
  geometry *inside* transparent models — our translucent, overlapping comparison boxes would
  literally disappear in AR. So the **AR export must use opaque materials** (distinct solid colors
  per item), diverging from the on-screen translucent look. Bake an opaque-material variant of the
  scene specifically for export. Validate on a real device early.
- **Scale:** author USDZ in metres — export the scene scaled ×0.001 (our units are mm).

## Task outline

**Phase 1**
1. Model pipeline emits `<slug>.usdz` alongside `<slug>.glb` (in the 3D-models plan).
2. `arLaunch(platform, {glbUrl, usdzUrl})` helper + platform detection (unit-tested detection).
3. "View in AR" affordance on device items that have a model; hidden on desktop.
4. On-device verification (iOS + Android) incl. a real-scale sanity check.

**Phase 2**
5. Client-side `GLTFExporter`/`USDZExporter` of the scene group (mm→m), solid-material variant.
6. Worker + R2 blob store: `POST /ar` → content-addressed short-lived `/ar/<hash>.{glb,usdz}`.
7. AR button for the whole comparison: export → upload → launch; loading/error states.
8. Caching, expiry, size caps; on-device verification of a multi-item scene.
