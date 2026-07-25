# Rounded grid room — design

## Summary

Replace the six flat reference grids (xz floor/ceiling + xy/zy walls) with a single
**rounded rectangular box** that the objects sit inside. Only the box's inner faces are
visible — the viewer looks in from outside through the near, open-facing side. The cm grid
is preserved as continuous ruling that **wraps around the rounded corner fillets**, built
from three orthogonal stacks of rounded-rectangle line rings.

## Goals

- One rounded box instead of six planes, sized to the content bounds + 3 units padding per side.
- Corner rounding with a configurable radius (default 2 units: 2 cm metric / 2 in imperial).
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

Let the content (target) bounds have half-extents `Hc = (Hx, Hy, Hz)`.

Constants (both tunable independently, as whole multiples of `unitMM`):

- `GRID_PAD` — padding added on all sides. `3 * unitMM` (3 units: 3 cm metric / 3 in imperial).
- `GRID_RADIUS` — corner fillet radius. `2 * unitMM` (2 units: 2 cm metric / 2 in imperial).

Expressing both in whole units keeps everything on the grid lattice in either unit system: the
outer faces snap to units, and because `r` is a whole number of units the fillet tangents
`face ∓ r` also fall on grid lines. They are two separate values so they can diverge later.

**Outer box snaps to the integer-cm (unit) lattice.** Object widths are not whole cm, so a raw
`content + P` box would put the outer faces — and therefore the fillet tangent points — off the
grid, and the ruling that runs along a tangent would not coincide with the flat/curve boundary.
Instead, per axis, expand the content bounds by at least `P` and round each face outward to the
nearest `unitMM`:

- `boxMin[A] = floor((contentMin[A] - P) / unitMM) * unitMM`
- `boxMax[A] = ceil((contentMax[A] + P) / unitMM) * unitMM`

Both faces then sit on grid lines, actual padding is in `[P, P + unitMM)`, and since `r` is a
whole number of units (2 cm = 2 units metric; 1 in = 1 unit imperial), every fillet tangent
`boxMin[A] + r` and `boxMax[A] - r` also lands on a grid line — so the corner rounding starts
and ends exactly on the ruling. The box is described by its `boxMin`/`boxMax` corners, not a
symmetric centre + half-extent; it may be asymmetric about the content.

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
not just the flat core band. A grid line is a curve of constant world-coordinate on the surface,
so each ring is that coordinate-plane's cross-section of the rounded box: in the core it is a full
rounded rect of radius `radius`; through the caps (`|dAxis| < radius` from the core face) the
perpendicular radius shrinks as `w = sqrt(radius² − dAxis²)` and the ring's corner arcs trace the
corner spheres. Result:

- flat faces: the two in-plane families cross to a normal grid (core rings);
- fillets: wrapped by the parallel family's core-ring arcs, and ruled lengthwise by the other two
  families' cap rings — so the curved strips read as a grid in both directions;
- corner spheres: the three families' cap-ring corner arcs (constant-x/y/z curves) form a spherical
  grid, continuous with the fillets.

The degenerate near-zero rings at the very faces are dropped (that boundary is already drawn by the
other two families).

**Cap-ring normals.** A cap ring's outward normal tilts toward the face: axial component
`dAxis/radius`, in-plane component scaled by `w/radius` (together unit length). This keeps the
facing fade correct across the caps and corners.

## Rendering / visibility

A single `ShaderMaterial` for all rings (transparent, `depthWrite: false`, like today).

- Vertex shader passes the surface normal and world position to the fragment shader.
- Fragment shader fades by facing: `f = smoothstep(0.0, 0.2, dot(N, dir))` where `N` is the
  outward surface normal and `dir` the eye ray. Far-facing inner walls (`dot > 0`) draw;
  near-facing walls fade to zero; a soft band at the silhouette gives a vignette. Multiply by
  the base line opacity (major vs minor as today).
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

Implementation check: after building, switch to the `front` ortho view and confirm the far-wall
grid corners are square and crisp (no arc on the perpendicular face). Tune the `smoothstep`
thresholds (`edge0`, `edge1`) so the perpendicular face stays full-opacity and only the fillets
fade.

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
  full in the core, shrinking through the caps). Assertable: full-span coords on the lattice with the
  degenerate face rings dropped; core rings carry `w = radius`; cap rings shrink as
  `sqrt(radius² − dAxis²)`; majors sit on the unit lattice.

## Testing

- Keep existing `gridSpec` tests unchanged.
- Add unit tests for `roundedGridBox`: box faces land on the `unitMM` lattice and padding is in
  `[pad, pad + unitMM)`; both fillet tangents (`min + r`, `max - r`) are on the lattice.
- Add unit tests for `roundedGridRingSpecs`: full-span ring coords on the lattice, core `w = radius`,
  cap-ring shrink profile, centre/core-half-extents, and major/minor split (imperial).
- Visual check (manual): in the `front` ortho view the device-bearing perpendicular grid is square
  and crisp; in 3D the faces, fillets, and corner spheres all read as one continuous rounded grid.

## Risks / open points

- Busy convergence at the 8 sphere-corners — accepted; revisit only if it reads poorly.
- Line-count budget: three stacks over the content span at 1 unit spacing. For large content the
  ring count grows with span; reuse `gridSpec`'s `majorCount` clamp so it stays bounded.
- Facing-fade `smoothstep` thresholds (`edge0`, `edge1`) need tuning: tight enough that the
  perpendicular face stays full-opacity in ortho (see Orthographic-views section), loose enough
  for a pleasant silhouette vignette in 3D; start near `dot` in `[0.0, 0.15]`.
