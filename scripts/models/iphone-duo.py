# Builds the iPhone Duo's two states — folded and open — as separate GLBs.
#
#   blender --background --python scripts/models/iphone-duo.py -- <out-dir>
#
# Then run scripts/build-models.mjs on that directory. Two models because a fold is genuinely two
# objects: 84.1 mm across and 11.3 mm thick shut, 164.6 mm across and 5.2 mm thick open. That is why
# model3d lives on the state rather than the device.
#
# WHERE THE NUMBERS COME FROM
#
# Both bodies, their corner radii and the tighter hinge-side corners are Apple's, via the catalog
# entry (apple.com/iphone-duo/specs). Apple publishes nothing about the camera plateau and no
# measured teardown exists yet, so unlike the iPhone 18 Pro — whose plateau came from measured dummy
# units — these two numbers are ESTIMATES, read off product imagery against the known body:
#
#   PLATEAU_PROUD  2.0 mm    ESTIMATE
#   LENS_PROUD     1.6 mm    ESTIMATE
#
# The footprint and the two-lens layout are likewise from imagery. Revisit once a teardown lands; the
# body is exact either way, and the plateau only affects what stands behind it.
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import join_and_export, rounded_box  # noqa: E402

CLOSED = dict(w=84.1, h=117.8, d=11.3, radius=11.0, inner=2.0)
OPEN = dict(w=164.6, h=117.8, d=5.2, radius=9.0, inner=None)

PLATEAU_PROUD = 2.0
PLATEAU_W, PLATEAU_H = 56.0, 42.0
PLATEAU_RADIUS = 12.0
PLATEAU_CZ = 30.0  # centre height, toward the top of the back

LENS_PROUD = 1.6
LENS_RADIUS = 11.0
LENS_OFFSET = (-11.0, 20.0)  # x from the plateau centre, and the gap between the two lenses


def camera(cx, back_y, parts):
    """The plateau and its two lenses, centred on x=cx and standing off the back face at back_y."""
    plateau = rounded_box(
        PLATEAU_W, PLATEAU_H, PLATEAU_PROUD, PLATEAU_RADIUS, "Plateau", segments=10
    )
    plateau.location = (cx, back_y + PLATEAU_PROUD / 2, PLATEAU_CZ)
    parts.append(plateau)
    for i in (0, 1):
        z = PLATEAU_CZ + LENS_OFFSET[1] / 2 - i * LENS_OFFSET[1]
        bpy.ops.mesh.primitive_cylinder_add(
            radius=LENS_RADIUS,
            depth=LENS_PROUD,
            vertices=32,
            rotation=(math.pi / 2, 0, 0),
            location=(cx + LENS_OFFSET[0], back_y + PLATEAU_PROUD + LENS_PROUD / 2, z),
        )
        lens = bpy.context.active_object
        lens.name = f"Lens{i}"
        parts.append(lens)


def build(spec, camera_cx, out_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = rounded_box(
        spec["w"],
        spec["h"],
        spec["d"],
        spec["radius"],
        "Body",
        inner_radius=spec["inner"],
        hinge="left",
    )
    parts = [body]
    camera(camera_cx, spec["d"] / 2, parts)
    return join_and_export(parts, out_path)


def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    # Shut, the visible back IS the camera half, so the plateau sits on its centre line. Open, that
    # same half is the left one, so the plateau keeps its place within it rather than moving.
    for name, spec, cx in (
        ("iphone-duo-closed", CLOSED, 0.0),
        ("iphone-duo-open", OPEN, -OPEN["w"] / 4),
    ):
        w, h, d = build(spec, cx, os.path.join(out_dir, f"{name}.glb"))
        print(f"BOUNDS {name}: w {w:.2f}  h {h:.2f}  d {d:.2f}  (body d {spec['d']})")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("usage: blender -b -P iphone-duo.py -- <out-dir>")
    main(args[0])
