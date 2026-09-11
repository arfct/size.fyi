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
# AUTHORING FRAME. Blender is Z-up and the glTF exporter maps (x, y, z) to (x, z, -y), so this builds
# the phone standing up — width on X, height on Z, depth on Y with the screen facing -Y. That lands
# width on glTF X, height on Y, and the front face on the model's MAXIMUM Z, which is what the
# "uniform" fit anchors to +d/2 so the app's screen rect sits flush on the glass.
import math
import sys

import bmesh
import bpy

W, H, D = 71.9, 150.0, 8.75
RADIUS = 11.0
# The front and back perimeters are left sharp on purpose. Rounding them read better, but bevelling a
# closed face loop pushed the silhouette out to 72.45 mm — and since the "uniform" fit takes its scale
# from width, a model 0.55 mm too wide shrinks every other dimension to compensate. On a site whose
# subject is size, an exact 71.9 mm beats a softer edge.

PLATEAU_PROUD = 2.79
PLATEAU_H = 38.0
PLATEAU_RADIUS = 11.0

LENS_PROUD = 2.23
LENS_RADIUS = 9.5
# Centres in (x, z). Three cameras in Apple's triangle, sitting on the left of the plateau.
LENS_AT = [(-20.5, 63.0), (-20.5, 45.0), (-3.0, 54.0)]


def rounded_box(w, h, d, radius, name, segments=12):
    """A box with its four upright (Z-parallel) edges rounded to `radius`, w on X, h on Z, d on Y."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    upright = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
    bmesh.ops.bevel(bm, geom=upright, offset=radius, segments=segments, profile=0.5, affect="EDGES")
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def main(out_path):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    body = rounded_box(W, H, D, RADIUS, "Body")

    # The plateau sits against the back of the body and runs to the top and both side edges, so its
    # upper corners have to carry the body's own radius or they would not meet the rails.
    plateau = rounded_box(W, PLATEAU_H, PLATEAU_PROUD, PLATEAU_RADIUS, "Plateau", segments=10)
    plateau.location = (0, D / 2 + PLATEAU_PROUD / 2, H / 2 - PLATEAU_H / 2)

    lenses = []
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
        lenses.append(lens)

    # One mesh: the loader merges everything into a single geometry with one material anyway, so
    # joining here keeps the decimate step from treating the parts as separate budgets.
    bpy.ops.object.select_all(action="DESELECT")
    for o in [body, plateau, *lenses]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    bpy.ops.object.shade_smooth()

    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)

    bb = [body.matrix_world @ v.co for v in body.data.vertices]
    print(
        "BOUNDS mm  x %.2f  z(height) %.2f  y(depth) %.2f  tris %d"
        % (
            max(v.x for v in bb) - min(v.x for v in bb),
            max(v.z for v in bb) - min(v.z for v in bb),
            max(v.y for v in bb) - min(v.y for v in bb),
            len(body.data.loop_triangles) or len(body.data.polygons),
        )
    )


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not args:
        raise SystemExit("usage: blender -b -P iphone-18-pro.py -- <out.glb>")
    main(args[0])
