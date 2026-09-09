"""
env_landmarks.py — bring the office and hospital models into the environment.

These two are bought assets (FBX + a single baked diffuse atlas each), not
parametric geometry like the rest of the scene, so this module's job is to make
them behave like everything else the build produces:

  * **metric.** FBX carries its own unit scale and these two do not agree with
    each other. Each model is measured on import and scaled to a stated real
    height in metres, so a storey in the office is the same size as a storey in
    the Bank of Industry next to it.
  * **grounded.** Origin moved to the base centre and dropped to z = 0, which is
    where every other building in this scene starts.
  * **placed by site, not by eye.** `SITES` holds the plan position, and the
    caller can validate it the same way `check_camera_sightlines()` validates
    the parametric blocks.

The models are photographic-looking next to a flat-shaded low-poly city. That is
a deliberate accepted mismatch — see the note in SITES — not an oversight.
"""

import os
import math

import bpy
from mathutils import Vector, Matrix


def assets_root(start=None):
    """assets/landmarks/ lives at the project root, above whichever copy of the
    build scripts is running."""
    here = start or os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        cand = os.path.join(here, "assets", "landmarks")
        if os.path.isdir(cand):
            return cand
        here = os.path.dirname(here)
    raise RuntimeError("could not locate assets/landmarks from %r" % (start,))


# Target heights are set against the scene's own storey rhythm: the Bank of
# Industry is 7 storeys at 3.6 m. The office reads as 4 storeys over a raised
# ground floor, the hospital as 4 over a penthouse core.
LANDMARKS = {
    "Office": dict(
        fbx="office/office.fbx",
        texture="office/office_diffuse.jpg",
        height=18.5,
    ),
    "Hospital": dict(
        fbx="hospital/hospital.fbx",
        texture="hospital/hospital_diffuse.jpg",
        height=17.0,
    ),
}

# Plan positions: (x, y, rot_z_degrees).
#
# Every site inside the isometric camera's ground diamond is already occupied --
# the parametric city is built out to fill the frame exactly -- so a landmark
# that appears in the hero shot has to displace a secondary block. Scanning the
# whole frontage on a 2 m grid at 1.5 m clearance returned no clear in-frame
# site for either footprint, which is a property of the plan, not a search
# failure: SECONDARY is authored to fill the frame.
#
# So each landmark takes over a secondary plot instead. The pairing is by
# footprint, not by convenience -- the hospital measures 36.5 x 22.2 m against
# Sec_S_G's 36 x 22, so it drops onto that plot almost exactly, and the office
# takes Sec_NE_K, the largest block on the north frontage.
SITES = {
    "Office":   (84.0, 54.0, 180.0),
    "Hospital": (72.0, -40.0, 0.0),
}

# Landmark -> the SECONDARY block it replaces. Every object whose name starts
# with the prefix goes, including the plot pad build_plots() lays under it.
REPLACES = {
    "Office":   "Sec_NE_K",
    "Hospital": "Sec_S_G",
}

COLLECTION = "ENV_Buildings_Main"


# ---------------------------------------------------------------- import

def _import_fbx(path):
    """Import and return the imported mesh objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in set(bpy.data.objects) - before if o.type == "MESH"]


def _join(objs, name):
    """Collapse the import into a single object so it behaves like one building."""
    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def _bounds(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def normalise(ob, target_height):
    """Scale to a real height, then put the origin at the base centre.

    The object is moved to the world origin *before* anything is measured. The
    mesh edit at the end (`data.transform`) is a local-space operation, so
    measuring in world space while the FBX still carries its own import offset
    subtracts that offset twice -- which is what put the office's base 10 m
    below its own origin and left it hanging in the air once placed.
    """
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

    ob.location = (0.0, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()

    lo, hi = _bounds(ob)                    # object at origin: world == local
    native_h = hi.z - lo.z
    if native_h <= 1e-6:
        raise RuntimeError("%s imported with zero height" % ob.name)
    k = target_height / native_h
    ob.scale = (k, k, k)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()

    lo, hi = _bounds(ob)
    centre = Matrix.Translation(
        -Vector(((lo.x + hi.x) / 2.0, (lo.y + hi.y) / 2.0, lo.z)))
    ob.data.transform(centre)
    ob.data.update()
    bpy.context.view_layer.update()

    lb = [Vector(c) for c in ob.bound_box]
    base = min(v.z for v in lb)
    if abs(base) > 1e-4:
        raise RuntimeError("%s base is at local z %.4f, not 0" % (ob.name, base))
    return native_h, k


# -------------------------------------------------------------- material

def make_material(name, texture_path):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-260, 0)
    # These atlases bake their own shading. Keeping roughness high and specular
    # low stops the model reading as plastic beside the matte parametric blocks.
    bsdf.inputs["Roughness"].default_value = 0.62
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.25
            break

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "Landmark_Albedo"
    tex.location = (-640, 0)
    img = bpy.data.images.get(os.path.basename(texture_path))
    if img is None:
        img = bpy.data.images.load(texture_path, check_existing=True)
    tex.image = img

    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------- driver

def ground_z(ob, x, y, half_w, half_d, samples=5):
    """Find the surface the building actually has to stand on.

    z = 0 is the *nominal* ground, but a landmark lands on a plot pad, a
    pavement or a forecourt, each a few hundred mm proud of it, and a model
    dropped to 0 sinks into whatever it is standing on. So cast rays down over
    the footprint and take the highest thing hit -- the model itself is lifted
    out of the way first, or every ray would hit its own roof.
    """
    scn = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    parked = ob.location.z
    ob.location.z = 10000.0
    bpy.context.view_layer.update()

    hits = []
    try:
        for i in range(samples):
            for j in range(samples):
                px = x + half_w * (2.0 * i / (samples - 1) - 1.0) * 0.8
                py = y + half_d * (2.0 * j / (samples - 1) - 1.0) * 0.8
                hit, loc, _n, _idx, obj, _m = scn.ray_cast(
                    deps, (px, py, 500.0), (0.0, 0.0, -1.0))
                if hit and obj is not ob:
                    hits.append(loc.z)
    finally:
        ob.location.z = parked

    # Only ground-like hits count. A footprint this size can overlap a
    # neighbour's roofscape -- the office site clips a Bank of Industry water
    # tank at 28 m -- and taking the highest hit would stand the building on
    # that tank. Ground, kerb and plot pads all sit under MAX_PAD.
    MAX_PAD = 2.5
    ground = [z for z in hits if z <= MAX_PAD]
    return max(ground) if ground else 0.0


def build_one(key, site=None, root=None, collection=COLLECTION, verbose=True):
    cfg = LANDMARKS[key]
    root = root or assets_root()
    x, y, rot = site or SITES[key]

    existing = bpy.data.objects.get(key)
    if existing:
        bpy.data.objects.remove(existing, do_unlink=True)

    objs = _import_fbx(os.path.join(root, cfg["fbx"]))
    if not objs:
        raise RuntimeError("no meshes imported from %s" % cfg["fbx"])
    ob = _join(objs, key)

    native_h, k = normalise(ob, cfg["height"])

    mat = make_material("ENV_%s" % key, os.path.join(root, cfg["texture"]))
    ob.data.materials.clear()
    ob.data.materials.append(mat)

    ob.location = (x, y, 0.0)
    ob.rotation_euler = (0.0, 0.0, math.radians(rot))
    bpy.context.view_layer.update()

    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    target = bpy.data.collections.get(collection)
    if target is None:
        target = bpy.data.collections.new(collection)
        bpy.context.scene.collection.children.link(target)
    target.objects.link(ob)

    # Sit it on whatever is actually under it, then confirm rather than assume.
    lo, hi = _bounds(ob)
    gz = ground_z(ob, x, y, (hi.x - lo.x) / 2.0, (hi.y - lo.y) / 2.0)
    ob.location.z = gz
    bpy.context.view_layer.update()

    lo, hi = _bounds(ob)
    if abs(lo.z - gz) > 1e-3:
        raise RuntimeError("%s base at %.3f, expected %.3f" % (key, lo.z, gz))
    if verbose:
        print("  %-9s native %.2f -> x%.4f  footprint %.1f x %.1f m  height %.1f m  "
              "at (%.0f, %.0f)  base z %.3f"
              % (key, native_h, k, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, x, y, lo.z))
    return ob


def clear_replaced(key, verbose=True):
    """Delete the secondary block this landmark stands in for."""
    prefix = REPLACES.get(key)
    if not prefix:
        return 0
    doomed = [o for o in bpy.data.objects
              if o.name.startswith(prefix) or o.name.startswith("Plot_" + prefix)]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    if verbose and doomed:
        print("  %-9s replaces %s (%d objects removed)" % (key, prefix, len(doomed)))
    return len(doomed)


def apply(sites=None, verbose=True):
    sites = sites or {}
    out = {}
    for key in LANDMARKS:
        clear_replaced(key, verbose=verbose)
        out[key] = build_one(key, site=sites.get(key), verbose=verbose)
    return out


if __name__ == "__main__":
    apply()
