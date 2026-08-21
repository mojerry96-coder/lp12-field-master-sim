"""
Export the low-poly Awolowo Way environment to GLB, and render the delivery set.

Kept separate from the build so the export can be re-run against a .blend that
has been touched by hand without rebuilding it from scratch.

Run:
    blender --background --python export_awolowo_env.py
"""

import math
import os

import bpy

COLLECTION_ORDER = [
    "ENV_Ground", "ENV_Roads", "ENV_Buildings_Main", "ENV_Buildings_Secondary",
    "ENV_Pavements", "ENV_StreetFurniture", "ENV_Vegetation", "ENV_Vehicles",
    "ENV_Pedestrians",
]

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, ".."))
BLEND_PATH = os.path.join(OUT, "awolowo_lowpoly_env.blend")
GLB_PATH = os.path.join(OUT, "awolowo_lowpoly_env.glb")
RENDER_DIR = os.path.join(OUT, "env_lowpoly_renders")

# Empties the application reads by name. glTF has no concept of an "empty", so
# these arrive as nodes with no mesh — which is exactly what is wanted, but it
# does mean the exporter must be told not to drop them.
REQUIRED_NODES = ("LP12_INSTALL_ANCHOR", "NETWORK_DOME_ORIGIN")


def apply_transforms():
    """Scale and rotation applied, per the brief.

    Instanced objects share mesh data, so applying a transform to one applies it
    to every sibling. Anything with multiple users is left alone: the instances
    are placed by their object transforms and that is the whole point of them.
    """
    bpy.ops.object.select_all(action="DESELECT")
    done = 0
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or ob.data.users > 1:
            continue
        if tuple(ob.scale) == (1.0, 1.0, 1.0) and tuple(ob.rotation_euler) == (0.0, 0.0, 0.0):
            continue
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        ob.select_set(False)
        done += 1
    print(f"  transforms applied on {done} single-user meshes")


def purge_orphans():
    before = len(bpy.data.materials) + len(bpy.data.meshes)
    bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True,
                                   do_recursive=True)
    after = len(bpy.data.materials) + len(bpy.data.meshes)
    print(f"  purged {before - after} orphaned datablocks")


def hide_prototypes():
    """The instancing source objects are hidden from render but still exist.

    They must not reach the GLB — each is a duplicate of geometry already
    present, sitting at the origin where it would read as a pile of debris in
    the middle of the junction.
    """
    n = 0
    for ob in list(bpy.context.scene.objects):
        if ob.name.endswith("_src"):
            bpy.data.objects.remove(ob, do_unlink=True)
            n += 1
    print(f"  removed {n} prototype objects")


def merge_for_realtime():
    """Collapse each collection into a single mesh before export.

    The scene is authored as ~4,000 individual objects because that is the only
    sane way to lay a city out parametrically. Shipping them that way is a
    different matter: every object is its own draw call, and 4,000 of them
    alongside the LP12 is enough to lose the WebGL context outright — which is
    exactly what happened the first time this GLB was loaded in the browser.

    Joining within each collection takes it to one mesh per collection, split by
    the exporter into one primitive per material. Draw calls drop by two orders
    of magnitude and the grouping the brief asks for survives, because the
    collections are still the nodes: roads, buildings, vegetation and vehicles
    can each still be shown, hidden or highlighted.

    What is lost is per-object addressing — no picking one car out of the
    traffic. Nothing in the simulation does that, and the .blend keeps every
    object for anyone who needs to edit the layout.
    """
    deps = bpy.context.evaluated_depsgraph_get()
    total_before = total_after = 0

    for name in list(COLLECTION_ORDER):
        coll = bpy.data.collections.get(name)
        if coll is None:
            continue
        meshes = [o for o in coll.objects if o.type == "MESH" and not o.hide_render]
        total_before += len(meshes)
        if len(meshes) < 2:
            total_after += len(meshes)
            continue

        # Modifiers have to be real geometry before the join: joining objects
        # with different modifier stacks silently drops all but the target's.
        for ob in meshes:
            if not ob.modifiers:
                continue
            ev = ob.evaluated_get(deps)
            ob.data = bpy.data.meshes.new_from_object(ev)
            ob.modifiers.clear()

        target = meshes[0]
        with bpy.context.temp_override(active_object=target,
                                       selected_editable_objects=meshes):
            bpy.ops.object.join()
        target.name = f"{name}_merged"
        total_after += 1

    print(f"  merged {total_before} meshes into {total_after} "
          f"({total_before / max(total_after, 1):.0f}x fewer draw calls)")


def drop_lp12():
    """Strip the LP12 out before export.

    It belongs in the .blend — the brief asks for it in its own collection, and
    the scene is unreadable without it — but the application loads lp12_v2.glb
    itself. Exporting it inside the environment too would stand two poles in the
    same spot, and the app could no longer show, hide or replace the antenna
    independently, which is the whole reason they are separate assets.
    """
    coll = bpy.data.collections.get("LP12_POLE")
    if coll is None:
        return
    n = len(coll.objects)
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.collections.remove(coll)
    print(f"  dropped {n} LP12 objects (the app loads that model itself)")


def recentre_on_anchor():
    """Move the whole scene so LP12_INSTALL_ANCHOR is the origin.

    The .blend keeps the site's own frame — the boulevard on y = 0, buildings
    at real coordinates — because that is what makes the layout editable. The
    GLB does not need any of that: its only consumer is the simulation, which
    already has the LP12 standing at its own origin and wants the street built
    around it.

    Baking the offset here rather than applying it in the application is
    deliberate. The alternative is to hand the app a translation and a rotation
    and ask it to invert them across a Z-up to Y-up conversion, which is exactly
    the kind of sign error that produces a city sitting a hundred metres from
    the pole with nothing obviously wrong in the code.
    """
    anchor = bpy.data.objects.get("LP12_INSTALL_ANCHOR")
    if anchor is None:
        print("  no anchor found — exporting in site coordinates")
        return
    inv = anchor.matrix_world.inverted()
    for ob in bpy.context.scene.objects:
        if ob.parent is None:
            ob.matrix_world = inv @ ob.matrix_world
    bpy.context.view_layer.update()
    print("  recentred on LP12_INSTALL_ANCHOR; anchor now at",
          [round(v, 3) for v in anchor.matrix_world.translation])


def export_glb():
    for name in REQUIRED_NODES:
        if name not in bpy.data.objects:
            raise SystemExit(f"missing required node: {name}")

    kwargs = dict(
        filepath=GLB_PATH,
        export_format="GLB",
        export_apply=True,          # modifiers, including every Bevel
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,      # nothing here uses a normal map
        export_materials="EXPORT",
        export_cameras=True,
        export_lights=True,
        export_yup=True,
        use_visible=False,
        export_animations=False,
        # Without this the exporter flattens everything into one list and the
        # collection structure the brief asks for — roads, buildings, vegetation,
        # vehicles, street furniture, the anchors — is lost. The application
        # needs those groups to show, hide and highlight parts of the scene.
        export_hierarchy_full_collections=True,
    )
    # Draco keeps the payload small, but it is a build-time option and not every
    # Blender ships it. Fall back rather than failing the export.
    try:
        bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True,
                                  export_draco_mesh_compression_level=6, **kwargs)
        print("  exported with Draco compression")
    except (TypeError, RuntimeError) as exc:
        print(f"  Draco unavailable ({exc.__class__.__name__}); exporting uncompressed")
        bpy.ops.export_scene.gltf(**kwargs)

    size = os.path.getsize(GLB_PATH) / 1024 / 1024
    print(f"  {GLB_PATH}  {size:.2f} MB")


def render_set():
    os.makedirs(RENDER_DIR, exist_ok=True)
    scn = bpy.context.scene
    scn.render.resolution_percentage = 100
    for cam_name, tag in (("CAM_ENV_ISOMETRIC", "01_isometric"),
                          ("CAM_LP12_CONTEXT", "02_lp12_context")):
        scn.camera = bpy.data.objects[cam_name]
        scn.render.filepath = os.path.join(RENDER_DIR, tag + ".png")
        bpy.ops.render.render(write_still=True)
        print("  rendered", tag)


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
    print("export pass")
    render_set()
    hide_prototypes()
    drop_lp12()
    merge_for_realtime()
    recentre_on_anchor()
    apply_transforms()
    purge_orphans()
    export_glb()
    # Deliberately not saved back over the .blend: the export pass destroys the
    # instancing prototypes, and a build that has lost them cannot be rebuilt
    # incrementally. The .blend stays authoritative, the GLB is derived.
    print("done")


if __name__ == "__main__":
    main()
