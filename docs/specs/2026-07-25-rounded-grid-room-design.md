# Rounded grid room — design

## Summary

Replace the six flat reference grids (xz floor/ceiling + xy/zy walls) with a single
**rounded rectangular box** that the objects sit inside. Only the box's inner faces are
visible — the viewer looks in from outside through the near, open-facing side. The cm grid
is preserved as continuous ruling that **wraps around the rounded corner fillets**, built
from three orthogonal stacks of rounded-rectangle line rings.

## Goals

- One rounded box instead of six planes, sized to the content bounds + padding on all sides.
- Corner rounding with a configurable radius (default 2 cm metric / 1 in imperial).
- Grid ruling stays continuous across every rounded edge (lines wrap the fillets).
- Only inner faces visible: near-facing walls fade out, far (inner) walls draw.
- Preserve the existing integer-cm alignment — grid lines pass through object corners.

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

Constants (both tunable independently, in mm):

- `GRID_PAD` — padding added on all sides. Default `2 cm` metric / `1 in` imperial.
- `GRID_RADIUS` — corner fillet radius. Default `2 cm` metric / `1 in` imperial.

Defaults are "2 cm metric / 1 in imperial", which resolve to a fixed mm value per unit system,
not a multiple of `unitMM`: `pad = units === 'imperial' ? 25.4 : 20` (mm), and likewise
`radius = units === 'imperial' ? 25.4 : 20`. They are two separate values so they can diverge
later.

Outer box half-extent per axis: `Ho = Hc + P` (P = `GRID_PAD`).

For a ring family along axis A, each ring is a rounded rectangle in the plane perpendicular
to A, with:

- half-extents `(Hc[other1] + P, Hc[other2] + P)`,
- corner radius `r = GRID_RADIUS`,
- placed at each integer-cm coordinate along A within the core band
  `|a| <= Hc[A] + P - r` (the flat-face span; beyond it the surface curves to the ±A face,
  which is ruled by the other two families).

Ring positions snap to integer world-cm (multiples of `unitMM`) so a line passes through the
first object's corner at the world origin, exactly as the current alignment fix does. The box
center itself may be non-integer; the rings are placed on the integer lattice, not centered.

Each ring is emitted as a closed polyline (`LineLoop` or `LineSegments`). Per vertex, store
the box's **outward surface normal**: the constant face normal along the straight runs, and
the radial (outward-from-fillet-axis) direction along the corner arcs.

## Rendering / visibility

A single `ShaderMaterial` for all rings (transparent, `depthWrite: false`, like today).

- Vertex shader passes the surface normal and world position to the fragment shader.
- Fragment shader fades by facing: `f = smoothstep(edge0, edge1, dot(N, dir))` where `dir`
  is the normalized camera→fragment direction and `N` the outward surface normal. Far-facing
  inner walls (`dot > 0`) draw; near-facing walls fade to zero; a soft band at the silhouette
  gives a vignette. Multiply by the base line opacity (major vs minor as today).
- A `uCameraPos` uniform is updated every frame (replacing the per-plane opacity writes).

This is the per-fragment analogue of today's `updateGridOpacity`, so the render loop still
calls one update per frame — it sets `uCameraPos` instead of six `uViewOpacity` values.

Occlusion is unchanged in spirit: objects are translucent with `depthWrite: false`, so far-wall
lines show through them (as the flat grids do now); near-wall lines are removed by the facing
fade rather than by geometry.

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

- `roundedGridRingSpecs(Hc, pad, radius, unitMM)` returns, per family, the list of ring
  coordinates and the shared rounded-rect (half-extents, radius). Assertable: ring counts per
  axis, 1-unit spacing, integer-cm alignment, half-extents = `Hc + pad`, radius = `radius`.

## Testing

- Keep existing `gridSpec` tests unchanged.
- Add unit tests for `roundedGridRingSpecs`: for a known bounds and units, assert per-axis ring
  count and spacing, that ring coordinates fall on the `unitMM` lattice (integer-cm alignment),
  and that the rounded-rect half-extents and radius match `Hc + pad` and `radius`.

## Risks / open points

- Busy convergence at the 8 sphere-corners — accepted; revisit only if it reads poorly.
- Line-count budget: three stacks over the content span at 1 cm spacing. For large content the
  ring count grows with span; reuse `gridSpec`'s `majorCount` clamp so it stays bounded.
- Facing-fade `smoothstep` thresholds (`edge0`, `edge1`) need tuning for a pleasant silhouette
  vignette; start near `dot` in `[0.0, 0.15]`.
