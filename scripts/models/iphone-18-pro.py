# Builds the iPhone 18 Pro body and camera plateau as a GLB.
#
#   blender --background --python scripts/models/iphone-18-pro.py -- <out.glb>
#
# Then run scripts/build-models.mjs on the output directory to weld, decimate and quantize it into
# public/models/. Committed as a script rather than a hand-authored binary so the numbers below stay
# reviewable — a .glb in a diff tells you nothing.
#
# WHERE THE NUMBERS COME FROM
#
# Body 150 x 71.9 x 8.75 mm and the 11 mm corner radius are Apple's, via the catalog entry
# (apple.com/iphone-18-pro/specs). Apple publishes NOTHING about the camera plateau, so everything
# below it is an estimate, and deliberately visible here rather than buried in vertex data:
#
#   PLATEAU_PROUD  2.79 mm   measured 11.54 mm total on 18 Pro Max dummies, less the 8.75 mm body
#   LENS_PROUD     2.23 mm   measured 13.77 mm at the lens tips, less the 11.54 mm plateau
#
# Those two come from accessory-maker dummy units measured pre-launch (Vadim Yuryev, reported by
# MacRumors and AppleInsider, April 2026) and describe the Pro Max; the Pro shares its body depth and
# plateau design. The plateau's footprint and the lens cluster geometry are read off product imagery,
# not measured — full device width, a little over a quarter of the height, flush to the top edge.
#
# See _common.py for the authoring frame (Blender Z-up, front face on the model's maximum Z).
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import join_and_export, rounded_box  # noqa: E402

W, H, D = 71.9, 150.0, 8.75
RADIUS = 11.0

PLATEAU_PROUD = 2.79
PLATEAU_H = 38.0
PLATEAU_RADIUS = 11.0

LENS_PROUD = 2.23
LENS_RADIUS = 9.5
# Centres in (x, z). Three cameras in Apple's triangle, sitting on the left of the plateau.
LENS_AT = [(-20.5, 63.0), (-20.5, 45.0), (-3.0, 54.0)]


def main(out_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = rounded_box(W, H, D, RADIUS, "Body")
    parts = [body]

    # The plateau sits against the back of the body and runs to the top and both side edges, so its
    # upper corners have to carry the body's own radius or they would not meet the rails.
    plateau = rounded_box(W, PLATEAU_H, PLATEAU_PROUD, PLATEAU_RADIUS, "Plateau", segments=10)
    plateau.location = (0, D / 2 + PLATEAU_PROUD / 2, H / 2 - PLATEAU_H / 2)
    parts.append(plateau)

    for i, (x, z) in enumerate(LENS_AT):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=LENS_RADIUS,
            depth=LENS_PROUD,
            vertices=32,
            rotation=(math.pi / 2, 0, 0),
            location=(x, D / 2 + PLATEAU_PROUD + LENS_PROUD / 2, z),
        )
        lens = bpy.context.active_object
        lens.name = f"Lens{i}"
        parts.append(lens)

    w, h, d = join_and_export(parts, out_path)
    print(f"BOUNDS mm  w {w:.2f}  h {h:.2f}  d {d:.2f}")


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("usage: blender -b -P iphone-18-pro.py -- <out.glb>")
    main(args[0])
