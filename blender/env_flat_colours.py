"""
env_flat_colours.py — flat-colour treatment for the environment's buildings.

Replaces the image-texture pass (`env_building_textures`) with the thing the
low-poly style actually wants: flat colour, and a different flat colour for each
part of a building that a person would name separately.

Three things in the scene make this less trivial than "set some base colours":

* **There is no roof object.** Every building is a stack of boxes and the
  surface you read as its roof is the *top face* of the parapet or coping box.
  So the roof colour is assigned per polygon, by normal, into a second material
  slot -- no new geometry, and the walls of the same box keep their own colour.

* **There are no doors.** `shopfront()` builds a recessed glazed bay and calls
  it an entrance. A door has to be created before it can be coloured, so this
  adds one panel per shopfront, sized and placed off the glazing it sits in.

* **Windows already exist** as `ENV_Glass` / `ENV_Glass_Dark`, but pitched so
  close to the wall colour that they read as the same material. They are pushed
  apart here rather than left nominally distinct.

Walls also get gentle per-building variation. A single cream across forty blocks
is what makes a flat-shaded city read as untextured; four tints, picked
deterministically from the building's name, is what "flat colour" looks like
when it is doing the job a texture was doing.
"""

import re

import bpy


# ------------------------------------------------------------------ palette
#
# sRGB hex, converted on the way in. Kept in one table so the whole scheme can
# be read at a glance and changed in one place.

COLOURS = {
    # walls -- the base cream is the scene's existing building colour, and the
    # variants sit within a few points of it so the street still reads as one
    # material in one light, not as a colour-blocked toy town.
    "ENV_Building":         "#F2F0E9",
    "ENV_Building_Hi":      "#FAF9F5",
    "ENV_Building_Shadow":  "#DDE1E5",

    # windows -- clearly glass, not pale wall
    "ENV_Glass":            "#7C9AC2",
    "ENV_Glass_Dark":       "#3D5A7D",

    # new parts
    "ENV_Roof":             "#94A8BC",
    "ENV_Door":             "#194FAF",
}

# Per-building wall tints. Deliberately narrow: these are the same cream walked
# slightly warm and slightly cool, not four different colours.
WALL_TINTS = [
    ("ENV_Building_T0", "#F2F0E9"),   # the base cream
    ("ENV_Building_T1", "#EDE7DC"),   # warmer, sand
    ("ENV_Building_T2", "#E8EAEC"),   # cooler, grey
    ("ENV_Building_T3", "#F5F1E4"),   # warmer, lighter
]

ROOF_MAT = "ENV_Roof"
DOOR_MAT = "ENV_Door"

# Which boxes present a roof plane. Their up-facing polygons get ROOF_MAT; every
# other face on the same object keeps the colour it already had.
ROOF_SUFFIXES = ("_Parapet", "_Coping", "_Upper", "_Core_Cap_", "_Plant_", "_Tank_")

BUILDING_COLLECTIONS = ("ENV_Buildings_Main", "ENV_Buildings_Secondary")

DOOR_H = 2.45          # head height
DOOR_W = 2.60          # leaf pair
DOOR_PROUD = 0.07      # stands off the glazing so it never z-fights
DOOR_TAG = "env_flat_door"   # marks doors this module owns, so cleanup
                             # never has to guess from a name


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(_srgb_to_linear(c) for c in rgb) + (alpha,)


# ------------------------------------------------------------- flattening

def strip_textures(verbose=True):
    """Remove the image-texture chain, returning the materials to flat colour.

    Only touches nodes this project added (`EnvTex_*`), so a material that was
    never textured is left exactly as it is.
    """
    stripped = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        doomed = [n for n in nt.nodes if n.name.startswith("EnvTex_")]
        if not doomed:
            continue
        for n in doomed:
            nt.nodes.remove(n)
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is not None:
            # the roughness the material had before it was textured
            if "env_tex_base_roughness" in mat:
                bsdf.inputs["Roughness"].default_value = float(mat["env_tex_base_roughness"])
            for key in ("env_tex_base_roughness", "env_tex_tile_m"):
                if key in mat:
                    del mat[key]
        stripped += 1
        if verbose:
            print("  flattened %s" % mat.name)
    return stripped


def material(name, hex_colour, roughness=0.72, specular=0.28):
    """Get or create a flat Principled material."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        for n in list(nt.nodes):
            if n.type != "OUTPUT_MATERIAL":
                nt.nodes.remove(n)
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.name = "Principled BSDF"
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = hex_rgba(hex_colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = specular
            break

    # Opaque, always. The build gives ENV_Glass alpha 0.88 and a little
    # transmission, which is right for a glass shader and wrong for a flat one:
    # a translucent window over a bright sky washes out to near-white, so the
    # colour set here never actually reaches the render. Flat colour means the
    # colour you set is the colour you get.
    bsdf.inputs["Alpha"].default_value = 1.0
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
            break
    try:
        mat.blend_method = "OPAQUE"
    except (AttributeError, TypeError):
        pass
    return mat


def recolour(verbose=True):
    """Push the palette onto the existing materials and create the new ones."""
    for name, hexc in COLOURS.items():
        rough = 0.30 if "Glass" in name else 0.72
        spec = 0.42 if "Glass" in name else 0.28
        material(name, hexc, rough, spec)
        if verbose:
            print("  colour %-20s %s" % (name, hexc))
    for name, hexc in WALL_TINTS:
        material(name, hexc, 0.72, 0.28)
    return True


# ------------------------------------------------------------------- roofs

def _up_faces(me, tol=0.85):
    return [p for p in me.polygons if p.normal.z > tol]


def assign_roofs(verbose=True):
    """Give every roof plane its own colour, per polygon."""
    roof = bpy.data.materials[ROOF_MAT]
    touched = 0
    seen = set()
    for coll_name in BUILDING_COLLECTIONS:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            continue
        for ob in coll.objects:
            if ob.type != "MESH" or ob.data.name in seen:
                continue
            if not any(s in ob.name for s in ROOF_SUFFIXES):
                continue
            me = ob.data
            names = [m.name if m else "" for m in me.materials]
            if ROOF_MAT in names:
                idx = names.index(ROOF_MAT)
            else:
                me.materials.append(roof)
                idx = len(me.materials) - 1
            ups = _up_faces(me)
            if not ups:
                continue
            for p in ups:
                p.material_index = idx
            me.update()
            seen.add(me.name)
            touched += 1
    if verbose:
        print("  roof colour on %d objects" % touched)
    return touched


# ----------------------------------------------------------------- windows

def assign_windows(verbose=True):
    """Make the windows actually wear the window colour.

    `storey_windows()` builds each opening as a solid `_Reveal_` box driven into
    the wall, then places the `_Win_` glass pane *inside* that box: the reveal
    spans y_face-0.38 .. y_face+0.03 and the pane y_face-0.30 .. y_face-0.14,
    strictly within it. The pane is therefore sealed inside a solid and never
    renders. What reads as a window on every facade in this scene is the front
    face of the reveal, wearing ENV_Building_Shadow -- which is why setting
    ENV_Glass had no visible effect at all.

    Rather than move the panes (a geometry change to inherited build output),
    the reveal is given the window colour. Every face of it except the front is
    buried in the wall, so recolouring the whole object is safe, and the sill and
    mullion still provide the depth cues.
    """
    glass = bpy.data.materials["ENV_Glass"]
    shadow = bpy.data.materials.get("ENV_Building_Shadow")
    done = 0
    for coll_name in BUILDING_COLLECTIONS:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            continue
        for ob in coll.objects:
            if ob.type != "MESH":
                continue
            # `_Shop_Reveal_` is the side wall of a shopfront recess and is
            # genuinely visible as wall -- leave it alone.
            if "_Reveal_" not in ob.name or "_Shop_Reveal_" in ob.name:
                continue
            me = ob.data
            for i, slot in enumerate(me.materials):
                if slot is shadow or slot is None:
                    me.materials[i] = glass
                    done += 1
    if verbose:
        print("  window colour on %d reveals" % done)
    return done


# ------------------------------------------------------------------- doors

def _world_bounds(ob):
    from mathutils import Vector
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return (min(p.x for p in pts), max(p.x for p in pts),
            min(p.y for p in pts), max(p.y for p in pts),
            min(p.z for p in pts), max(p.z for p in pts))


def add_doors(verbose=True):
    """Put an actual door in every shopfront.

    `shopfront()` glazes the whole recessed bay, so the entrance is implied
    rather than modelled. The panel is sized off the glazing it stands in and
    centred on it, which keeps it correct for every bay width in the scene
    without a table of positions.
    """
    import bmesh
    door = bpy.data.materials[DOOR_MAT]

    # Clear doors from a previous run.
    #
    # Identify them by a tag this function set, never by name. Matching
    # `endswith("_Door")` deleted `Pole_Hatch_Door` -- a part of the LP12 pole
    # that has nothing to do with shopfronts and simply happened to be named
    # the same way. Also drop the mesh, or the next run's datablock collides
    # with the orphan and every door comes back named "..._Door.001".
    stale = [o for o in bpy.data.objects
             if o.get(DOOR_TAG) or (o.type == "MESH" and o.data.materials
                                    and any(m and m.name == DOOR_MAT
                                            for m in o.data.materials))]
    for ob in stale:
        me = ob.data if ob.type == "MESH" else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)

    made = 0
    glass = [o for o in bpy.data.objects
             if o.type == "MESH" and o.name.endswith("_Shop_Glass")]
    for g in glass:
        x0, x1, y0, y1, z0, z1 = _world_bounds(g)
        cx = (x0 + x1) / 2.0
        w = min(DOOR_W, (x1 - x0) * 0.5)
        if w < 0.6:
            continue

        # Where the facade actually is.
        #
        # shopfront() sets its glazing `recess` metres BEHIND the wall plane but
        # never cuts an opening, so the glass sits inside the solid mass and does
        # not render -- a door left on that plane is invisible for the same
        # reason. The canopy is the one sibling that reaches outside the wall
        # (y_face + out*1.05), so it gives both the outward direction and the
        # wall plane, without parsing names to find the building mass.
        canopy = bpy.data.objects.get(g.name.replace("_Shop_Glass", "_Shop_Canopy"))
        if canopy is None:
            continue
        c_y0, c_y1 = _world_bounds(canopy)[2:4]
        g_mid = (y0 + y1) / 2.0
        out = 1.0 if (c_y1 - g_mid) > (g_mid - c_y0) else -1.0
        y_face = (c_y1 if out > 0 else c_y0) - out * 1.05

        # sit the leaf on the wall, standing proud of it
        dy0, dy1 = sorted((y_face - out * 0.02, y_face + out * (DOOR_PROUD + 0.02)))

        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(w, dy1 - dy0, DOOR_H - z0), verts=bm.verts)
        me = bpy.data.meshes.new(g.name.replace("_Shop_Glass", "") + "_Entrance")
        bm.to_mesh(me)
        bm.free()

        ob = bpy.data.objects.new(me.name, me)
        ob[DOOR_TAG] = True
        ob.location = (cx, (dy0 + dy1) / 2.0, z0 + (DOOR_H - z0) / 2.0)
        me.materials.append(door)
        for c in g.users_collection:
            c.objects.link(ob)
        made += 1

    if verbose:
        print("  doors added: %d" % made)
    return made


# ------------------------------------------------------------------- walls

def vary_walls(verbose=True):
    """Give each building one of the wall tints, deterministically by name."""
    mats = [bpy.data.materials[n] for n, _ in WALL_TINTS]
    base = bpy.data.materials.get("ENV_Building")
    if base is None:
        return 0

    def key_of(ob):
        # group every part of one building under the same tint
        m = re.match(r"(Sec_[A-Z]+_[A-Z]|BOI|NS)", ob.name)
        return m.group(1) if m else ob.name

    swapped = 0
    for coll_name in BUILDING_COLLECTIONS:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            continue
        for ob in coll.objects:
            if ob.type != "MESH":
                continue
            me = ob.data
            hit = False
            for i, slot in enumerate(me.materials):
                if slot is base:
                    me.materials[i] = mats[hash(key_of(ob)) % len(mats)]
                    hit = True
            if hit:
                swapped += 1
    if verbose:
        print("  wall tint applied to %d objects" % swapped)
    return swapped


# ------------------------------------------------------------------ driver

def apply(verbose=True):
    strip_textures(verbose=verbose)
    recolour(verbose=verbose)
    assign_roofs(verbose=verbose)
    assign_windows(verbose=verbose)
    add_doors(verbose=verbose)
    vary_walls(verbose=verbose)
    return True


if __name__ == "__main__":
    apply()
