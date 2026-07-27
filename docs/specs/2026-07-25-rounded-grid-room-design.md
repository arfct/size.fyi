# Rounded grid room — design

## Summary

Replace the six flat reference grids (xz floor/ceiling + xy/zy walls) with a single
**rounded rectangular box** that the objects sit inside. Only the box's inner faces are
visible — the viewer looks in from outside through the near, open-facing side. The cm grid
is preserved as continuous ruling that **wraps around the rounded corner fillets**, built
from three orthogonal stacks of rounded-rectangle line rings.

## Goals

- One rounded box instead of six planes: a cube whose side is twice the content's largest dimension,
  centred on the content (so a flat object still gets a room with depth).
- Corner rounding with a configurable radius (default 7 units), wide enough to read as a curve.
- Grid ruling stays continuous across every rounded edge (lines wrap the fillets).
- Only inner faces visible: near-facing walls fade out, far (inner) walls draw.
- Preserve the existing integer-cm alignment — grid lines pass through object corners.
- Snap the outer box to whole units so fillet tangents fall on grid lines and corners read clean.
- In ortho views the face perpendicular to the view reads square (a byproduct of ortho +
  facing fade); roundedness on the parallel side walls is fine.

## Non-goals

- No toggle/coexistence with the old flat grids; this replaces them entirely.
- No solid/shaded wall surfaces — the box reads from its ruling alone, as today.
- No change to layout, camera refit, labels, or `gridSpec` (units + spacing).

## Key insight

A grid wrapping a rounded box equals **three stacks of concentric rounded-rectangle rings**,
one stack per axis:

- constant-x rings lie in YZ planes,
- constant-y rings lie in XZ planes,
- constant-z rings lie in XY planes.

On any flat face the two in-plane families cross to form a normal grid. Every rounded
edge-fillet is parallel to exactly one axis and is wrapped by that axis's ring family, so the
ruling is continuous over each edge. The 8 sphere-corners (where three fillets meet) get
slightly busy converging lines — accepted. Each ring is a rounded-rectangle polyline built
with the same corner construction already used by `roundedRectShape`.

## Geometry

Constants:

- `GRID_PAD_SCALE` — padding per side as a fraction of the content's **largest** dimension. `0.5`,
  so the room's side is twice that dimension.
- `GRID_RADIUS` — corner fillet radius. `7 * unitMM` (7 units). A whole number of units, so the fillet
  tangents land on grid lines in either unit system. Wide enough that the fillet spans several grid
  columns and the ruling visibly compresses as the surface turns away; a tight radius reads as a crease.

**The room is a CUBE, sized from the largest content dimension.** Padding proportional to each axis
separately would give a flat object (a tablet 5 mm deep) a room with almost no depth, so all three
axes take the same side length:

```
maxSize = max(contentSize.x, contentSize.y, contentSize.z)
side    = ceil(max(maxSize * (1 + 2*GRID_PAD_SCALE), maxSize + 2*r) / unitMM) * unitMM
```

The `maxSize + 2*r` term is a floor guaranteeing the rounding always fits (it only binds for content
smaller than the radius). `side` is a whole number of units.

**Faces snap to the lattice.** Object sizes are not whole cm, so a raw `content ± pad` box would put
the faces — and therefore the fillet tangents — off the grid, and the ruling running along a tangent
would not coincide with the flat/curve boundary. Instead centre each axis on the content and snap the
low face onto the lattice; `side` being a whole number of units carries the high face with it:

- `boxMin[A] = round((contentMid[A] - side/2) / unitMM) * unitMM`
- `boxMax[A] = boxMin[A] + side`

All six faces then sit on grid lines, and since `r` is a whole number of units every fillet tangent
`boxMin[A] + r` / `boxMax[A] - r` does too — the corner rounding starts and ends exactly on the
ruling. The snap can shift the room up to half a unit off the content centre, which is far inside the
padding, so the content always stays enclosed.

For a ring family along axis A, each ring is a rounded rectangle in the plane perpendicular to A,
placed at each `unitMM` step along A across the full span `[boxMin[A], boxMax[A]]`. Across the
flat core band `[boxMin[A] + r, boxMax[A] − r]` the ring is full-size (corner radius `r = GRID_RADIUS`,
outer bounds `[boxMin, boxMax]` in the other two axes); through the caps its radius shrinks so the
corner arcs trace the corner spheres (see "Full-span rings" below).

Because both the box faces and the ring coordinates are on the `unitMM` lattice, lines still
pass through the first object's corner at the world origin (the current alignment fix), and the
fillet tangents fall on grid lines for clean corners.

Each ring is emitted as a closed polyline (`LineLoop` or `LineSegments`). Per vertex, store
the box's **outward surface normal**: the constant face normal along the straight runs, and
the radial (outward-from-fillet-axis) direction along the corner arcs.

**Full-span rings grid the fillets AND corners.** Rings run the *entire* axis span `[min, max]`,
not just the flat core band. Each ring is a coordinate-plane cross-section of the rounded box: in the
core it is a full rounded rect of radius `radius`; through the caps the perpendicular radius shrinks as
`w = radius·cos φ` (at axial offset `dAxis = radius·sin φ` past the tangent) and the ring's corner arcs
trace the corner spheres. Result:

- flat faces: the two in-plane families cross to a normal grid (core rings);
- fillets: wrapped by the parallel family's core-ring arcs, and ruled lengthwise by the other two
  families' cap rings — so the curved strips read as a grid in both directions;
- corner spheres: the three families' cap-ring corner arcs (constant-x/y/z curves) form a spherical
  grid, continuous with the fillets.

**Cap rings step by equal ARC, not equal coordinate.** Each fillet is ruled by two families whose
longitudinal lines there are geometrically *coincident*. Stepping cap rings by axis coordinate makes the
two sets interleave unevenly — near-duplicate lines a fraction of a unit apart in the middle of the arc,
wide gaps elsewhere. Stepping by arc (`Δφ = fine / radius`) puts both families on the same angles, so
the fillet ruling is evenly spaced and matches the faces; the builder then drops one family's copy (keep
the lower-ordered axis's, see below). Cap rings therefore do not sit on the unit lattice — acceptable,
since the caps are padding rather than measured space. `major` follows arc distance from the tangent, so
corners stay as bright as the faces. The ring at `φ = 0` would repeat the tangent ring and the one at
`φ = 90°` is a degenerate pole; both are skipped.

**Duplicate-line dedupe.** A cap ring is entirely curved geometry: its four corner arcs lie on corner
spheres (all three families needed — they are different curves), but its four straight runs lie on
fillets, where the other family sharing that fillet emits the same line. Keep only the copy whose family
axis is lower in `x < y < z` order; otherwise the fillet ruling is drawn twice and reads as darker
corners. Core-ring straight runs lie on the flat faces and are always kept.

**Cap-ring normals.** A cap ring's outward normal tilts toward the face: axial component
`dAxis/radius`, in-plane component scaled by `w/radius` (together unit length). This keeps the
facing fade correct across the caps and corners.

## Rendering / visibility

A single `ShaderMaterial` for all rings (transparent, `depthWrite: false`, like today).

- Vertex shader passes the surface normal and world position to the fragment shader.
- Fragment shader multiplies the base line opacity (major vs minor as today) by three terms:
  - **Flashlight** (the look) — a screen-space radial gradient,
    `1 - smoothstep(GRID_LIGHT_INNER, GRID_LIGHT_OUTER, length(ndc - uLightCenter))`, so only the grid
    near the middle of the view is visible and it falls to nothing toward the edges. `ndc` comes from
    `gl_FragCoord / uResolution`, which is exact per pixel — interpolating a clip-space varying would
    skew under perspective. `uLightCenter` is the room's centre projected each frame, so the light sits
    on the composition rather than the raw canvas centre (the sidebar inset separates the two).
    Radius is measured in NDC, so the pool conforms to the viewport.
  - **Facing cull** — `smoothstep(0, GRID_FACING_CULL, dot(N, dir))`, wide enough only to avoid a
    jagged terminator. This is not a gradation: its job is to drop the near-facing walls, without which
    the wall between camera and content draws its grid over the devices.
  - **Near-depth fade** — `smoothstep(START, END, dot(worldPos − boxCenter, viewDir) / boxRadius)`,
    i.e. view-axis depth normalized to the box (−1 at its nearest point, +1 farthest). Keeps geometry
    right in front of the camera from cutting through the middle of the light.
- All are alpha multipliers in this material, deliberately *not* `THREE.Fog`: scene fog mixes
  fragment *color* toward a fog color (wrong on a transparent canvas, and wrong in both light and
  dark themes) and would apply to the device meshes too.
- **`renderOrder = GRID_RENDER_ORDER` (-1) on each `LineSegments`.** Nothing in the scene writes depth,
  so draw order is `renderOrder` then camera distance; the room's bounding sphere is centred on the
  devices, so at the default 0 the distance tiebreak flips as the camera moves and the grid paints over
  the device screens (they appear to go transparent at some angles). Items start at 0, so the room sits
  below them. `renderOrder` is sorted per object, so it must be set on the children, not the group.
- **`dir` is projection-dependent** (a `uOrtho` flag selects): perspective uses the true
  per-fragment ray `normalize(worldPos - uCameraPos)`, so every far wall shows even at grazing
  angles; ortho uses the single parallel view direction `uViewDir`, so silhouette fillets
  collapse and the perpendicular face reads square (a uniform ray would fade grazing walls in
  perspective; a per-fragment ray would leave a crisp rounded border in ortho — hence the split).
- `uCameraPos`, `uViewDir`, and `uOrtho` are refreshed every frame (replacing the per-plane
  opacity writes).

This is the per-fragment analogue of today's `updateGridOpacity`, so the render loop still
calls one update per frame — it sets `uCameraPos` instead of six `uViewOpacity` values.

Occlusion is unchanged in spirit: objects are translucent with `depthWrite: false`, so far-wall
lines show through them (as the flat grids do now); near-wall lines are removed by the facing
fade rather than by geometry.

## Orthographic views: perpendicular face reads square (verified property)

Requirement: in the orthographic axis views (`front`/`side`/`top`), the face **perpendicular
to the view** must show a clean rectangular grid with no roundedness. Roundedness on the walls
**parallel** to the view is acceptable.

This holds as a byproduct of orthographic projection + the facing fade — no view-dependent
geometry or radius switching is needed:

- An orthographic camera has a single constant view direction for every fragment. On the flat
  perpendicular face the surface normal is exactly ±view axis, so `dot(N, dir)` is uniform (= 1)
  across the whole face → the grid renders at full, even opacity, crisp, with no vignette.
- That flat face is a sharp-cornered rectangle spanning `[boxMin+r, boxMax−r]` per in-plane
  axis. The rounding lives entirely on the fillets/corner-spheres that transition to the
  parallel walls — geometry that is *not* on the perpendicular face.
- Those fillets face perpendicular to the ortho view (`dot(N, dir) → 0`), so they fade out; any
  residual roundedness that bleeds through the `smoothstep` band is on the parallel-side
  transitions, which the requirement permits.

In perspective 3D the view direction varies per fragment, so the same rings produce the soft
vignetted rounded-room look. Same geometry, two reads.

Note the angular gradation preserves this: on the flat perpendicular face `dot` is exactly 1, so
`pow(1, k) = 1` — full opacity, square and crisp — while the fillets fade off as they turn parallel,
which also softens the rounded frame the old hard-band fade left around the ortho views.

Implementation check: after building, switch to the `front` ortho view and confirm the far-wall grid
is square and crisp at full strength (no arc across the perpendicular face). Tune
`GRID_FACING_POWER` and the near-fade band for a pleasant 3D falloff.

## Replacement / removal

Remove from `src/three/scene.ts`:

- the `grids` object and its six members (`floor`, `ceiling`, `front`, `back`, `side`,
  `otherSide`), the plane rotations/positions in `rebuildGrid`,
- `setGridViewOpacity` and the six-plane `updateGridOpacity` body (replace with the
  `uCameraPos` update),
- `groundY` / `ceilingY` computation (nothing else depends on them; name-label placement is
  item-relative via `labelGap`).

Keep:

- `gridSpec` (units → `unitMM`, spacing, extent) and its tests,
- `GRID_REACH` only if still useful for the base line-opacity falloff; otherwise drop it since
  the box is finite and no radial extent fade is needed.

`rebuildGrid` becomes: compute content bounds → resolve `pad`/`radius`/`unitMM` → build the
three ring stacks into one group → add to scene. `removeGrid` disposes the single group.

## New pure helper (testable)

`buildRoundedGridRings(bounds, units): THREE.Group` (or a lower-level pure function returning
ring specs) — generates the three ring families. Factor the ring math so a pure function can be
unit-tested without a GL context:

- `roundedGridBox(min, max, pad, unitMM)` returns the snapped `min`/`max` corners.
- `roundedGridRingSpecs(min, max, radius, unitMM, fine)` returns, per family, its `axis`, centre
  `(cu, cv)`, core half-extents, and a `rings[]` list — each `{coord, major, w, dAxis}` (radius `w`,
  full in the core, shrinking through the caps). Assertable: core rings span tangent to tangent on the
  `fine` lattice and carry `w = radius`; cap rings step by arc, sit strictly inside the faces (the
  tangent-repeat and pole rings dropped), and shrink as `sqrt(radius² − dAxis²)`; core majors sit on the
  unit lattice while cap majors count whole units of arc from the tangent.

## Testing

- Keep existing `gridSpec` tests unchanged.
- Add unit tests for `roundedGridBox`: box faces land on the `unitMM` lattice and padding is in
  `[pad, pad + unitMM)`; both fillet tangents (`min + r`, `max - r`) are on the lattice.
- Add unit tests for `roundedGridRingSpecs`: core ring coords on the lattice with `w = radius`,
  arc-stepped cap rings and their shrink profile, centre/core-half-extents, and the core and cap
  major/minor splits (imperial).
- Visual check (manual): in the `front` ortho view the device-bearing perpendicular grid is square
  and crisp; in 3D the faces, fillets, and corner spheres all read as one continuous rounded grid.

## Risks / open points

- Busy convergence at the 8 sphere-corners — accepted; revisit only if it reads poorly.
- Line-count budget: three stacks over the content span at 1 unit spacing. For large content the
  ring count grows with span; reuse `gridSpec`'s `majorCount` clamp so it stays bounded.
- Fade shaping is taste: the flashlight band `[GRID_LIGHT_INNER, GRID_LIGHT_OUTER]` = `[0.0, 0.7]` sets
  how tight the lit pool is, and the near-fade band (`[-0.95, -0.1]` in normalized view depth) how much
  of the near rim dissolves. Widening either shows more grid but makes the room read busier.
