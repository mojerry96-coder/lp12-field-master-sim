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
    apply_transforms()
    purge_orphans()
    export_glb()
    # Deliberately not saved back over the .blend: the export pass destroys the
    # instancing prototypes, and a build that has lost them cannot be rebuilt
    # incrementally. The .blend stays authoritative, the GLB is derived.
    print("done")


if __name__ == "__main__":
    main()
