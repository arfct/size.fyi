# Shared mesh helpers for the device model scripts in this directory.
#
# AUTHORING FRAME, which every script here follows. Blender is Z-up and the glTF exporter maps
# (x, y, z) to (x, z, -y), so a device is built standing up: width on X, height on Z, depth on Y with
# the screen facing -Y. That lands width on glTF X, height on Y, and the front face on the model's
# MAXIMUM Z — which is what `model3d.fit: "uniform"` anchors to +d/2 so the app's screen rect sits
# flush on the glass and anything on the back stands proud of the quoted depth.
#
# Nothing may overhang the device's width: "uniform" takes its scale from X, so a model even a
# fraction too wide silently shrinks every other dimension to compensate.
import bmesh
import bpy


def rounded_box(w, h, d, radius, name, segments=12, inner_radius=None, hinge="left"):
    """A box with its four upright (Z-parallel) edges rounded. w on X, h on Z, d on Y.

    `inner_radius` rounds the two edges on `hinge` more tightly than the rest, the way a fold's
    hinge-side corners are tighter than its outer ones — matching the catalog's radiusInner.

    The front and back perimeters are deliberately left sharp. Rounding them read better, but
    bevelling a closed face loop pushes the silhouette wider than the real device, and under the
    "uniform" fit that shrinks every other dimension.
    """
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h

    def upright():
        return [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]

    def on_hinge(e):
        if hinge in ("left", "right"):
            want = -w / 2 if hinge == "left" else w / 2
            return all(abs(v.co.x - want) < 1e-6 for v in e.verts)
        want = -h / 2 if hinge == "bottom" else h / 2
        return all(abs(v.co.z - want) < 1e-6 for v in e.verts)

    if inner_radius is None:
        bmesh.ops.bevel(
            bm, geom=upright(), offset=radius, segments=segments, profile=0.5, affect="EDGES"
        )
    else:
        # Two passes, because the hinge pair and the outer pair take different radii. Outer first:
        # bevelling changes the edge set, so the hinge edges are re-found afterwards.
        bmesh.ops.bevel(
            bm,
            geom=[e for e in upright() if not on_hinge(e)],
            offset=radius,
            segments=segments,
            profile=0.5,
            affect="EDGES",
        )
        bmesh.ops.bevel(
            bm,
            geom=[e for e in upright() if on_hinge(e)],
            offset=inner_radius,
            segments=max(3, segments // 3),
            profile=0.5,
            affect="EDGES",
        )

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def join_and_export(parts, out_path):
    """Join every part into one mesh and write a GLB, returning (width, height, depth) in mm.

    One mesh because the loader merges everything into a single geometry with one material anyway,
    and joining first stops the decimate step treating the parts as separate triangle budgets.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    whole = parts[0]
    bpy.ops.object.shade_smooth()
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)

    co = [whole.matrix_world @ v.co for v in whole.data.vertices]
    return (
        max(v.x for v in co) - min(v.x for v in co),
        max(v.z for v in co) - min(v.z for v in co),
        max(v.y for v in co) - min(v.y for v in co),
    )
