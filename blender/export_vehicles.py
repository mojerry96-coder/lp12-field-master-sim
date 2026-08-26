"""
Per-vehicle GLB export, brief section 20.

Each vehicle ships as its own file so the application loads it once and clones
it per instance. That is the opposite of what the environment does — the
environment merges everything because none of it repeats, while the vehicles
repeat constantly and merging them would bake 36 copies of the same geometry
into one mesh.

LOD0, LOD1 and LOD2 go into the same file as sibling nodes. One request per
vehicle type rather than three, and the application picks a level by distance
without a second fetch.

Run:
    blender --background awolowo_lowpoly_env.blend --python export_vehicles.py
"""

import json
import os
import re
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, ".."))
VEH_DIR = os.path.join(OUT, "vehicles_glb")

FILENAMES = {
    "VEH_BUS_CITY_01": "veh_bus_city_01",
    "VEH_TRUCK_SEMI_01": "veh_truck_semi_01",
    "VEH_TRUCK_BOX_01": "veh_truck_box_01",
    "VEH_TRUCK_PANEL_01": "veh_truck_panel_01",
    "VEH_VAN_CARGO_01": "veh_van_cargo_01",
    "VEH_CAR_SEDAN_01": "veh_car_sedan_01",
    "VEH_CAR_COMPACT_01": "veh_car_compact_01",
    "VEH_CAR_COUPE_01": "veh_car_coupe_01",
    "VEH_SCOOTER_01": "veh_scooter_01",
    "VEH_E_SCOOTER_01": "veh_e_scooter_01",
}


def export_one(base, filename):
    """Export LOD0/1/2 for one vehicle type into a single GLB."""
    wanted = {f"{base}_ROOT", f"{base}_LOD1", f"{base}_LOD2"}
    objs = [o for o in bpy.data.objects if o.name in wanted]
    if not objs:
        print(f"  MISSING {base}")
        return None

    for o in bpy.data.objects:
        o.select_set(False)
    for o in objs:
        # Hidden objects are skipped by use_visible, and the library is hidden
        # by design, so every export would silently write an empty file.
        o.hide_set(False)
        o.hide_render = False
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    path = os.path.join(VEH_DIR, filename + ".glb")
    kwargs = dict(
        filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT",
        export_cameras=False, export_lights=False,     # recreated in the app
        export_yup=True, export_animations=False,
    )
    try:
        bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True,
                                  export_draco_mesh_compression_level=6, **kwargs)
    except (TypeError, RuntimeError):
        bpy.ops.export_scene.gltf(**kwargs)

    size = os.path.getsize(path) / 1024
    return {"file": filename + ".glb", "kb": round(size, 1),
            "nodes": sorted(o.name for o in objs)}


def main():
    os.makedirs(VEH_DIR, exist_ok=True)
    manifest = {}
    for base, filename in FILENAMES.items():
        info = export_one(base, filename)
        if info:
            manifest[base] = info
            print(f"  {filename + '.glb':28} {info['kb']:7.1f} KB  "
                  f"{len(info['nodes'])} LOD nodes")

    # Placement data, so the application can reproduce the Blender scene without
    # the vehicles being baked into the environment GLB.
    anchor = bpy.data.objects.get("LP12_INSTALL_ANCHOR")
    inv = anchor.matrix_world.inverted() if anchor else None
    placements = []
    coll = bpy.data.collections.get("ENV_Vehicles")
    for ob in (coll.objects if coll else []):
        if ob.name.endswith("_src"):
            continue
        # Blender suffixes duplicate datablocks with .001, .002 and so on, and
        # new_from_object() makes duplicates by definition. Strip it or the
        # application looks up an asset key that does not exist.
        base = re.sub(r"\.\d{3}$", "", ob.data.name)
        base = base.replace("_mesh", "").replace("_ROOT", "")
        m = (inv @ ob.matrix_world) if inv else ob.matrix_world
        loc, rot, _ = m.decompose()
        slot = ob.material_slots[0] if ob.material_slots else None
        placements.append({
            "type": base,
            # glTF is Y-up: Blender (x, y, z) becomes (x, z, -y).
            "position": [round(loc.x, 3), round(loc.z, 3), round(-loc.y, 3)],
            "rotationY": round(rot.to_euler().z, 4),
            "variant": slot.material.name if slot and slot.link == "OBJECT"
                       and slot.material else None,
        })
    out = {"vehicles": manifest, "placements": placements}
    mpath = os.path.join(VEH_DIR, "vehicle_placements.json")
    with open(mpath, "w") as f:
        json.dump(out, f, indent=1)
    print(f"  {len(placements)} placements -> {mpath}")


if __name__ == "__main__":
    main()
