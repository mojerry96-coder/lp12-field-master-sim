"""
Low-poly Awolowo Way environment for the LP12 simulation.

Layout comes from background.png; the look comes from the white-and-blue
low-poly references. The two pull in different directions and the brief
resolves it explicitly: keep the road network, the building massing and the
landmark positions recognisable, and throw away everything photographic.

The whole scene is authored parametrically from the plan below rather than
modelled by hand, because the corridor has to stay dimensionally honest — the
LP12 anchor sits on a real pavement at a real distance from a real kerb, and
the simulation reads those positions. Nudging a building in the viewport would
quietly break that.

Geometry is built with bmesh instead of bpy.ops: operators depend on context,
selection and an active object, none of which mean anything in a background
run, and they are an order of magnitude slower for a few hundred objects.

Run:
    blender --background --python build_awolowo_env.py
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, ".."))
BLEND_PATH = os.path.join(OUT, "awolowo_lowpoly_env.blend")
GLB_PATH = os.path.join(OUT, "awolowo_lowpoly_env.glb")
RENDER_DIR = os.path.join(OUT, "env_lowpoly_renders")

# --------------------------------------------------------------- palette

PALETTE = {
    "road_primary":    "#2F6EDB",
    "road_secondary":  "#3E7BE2",
    "road_marking":    "#EAF1FF",
    "building":        "#F2F0E9",
    "building_hi":     "#FAF9F5",
    "building_shadow": "#DDE1E5",
    "ground":          "#EEF1F4",
    "pavement":        "#E5E8EC",
    "window":          "#B9C8D8",
    "window_dark":     "#53677D",
    "metal":           "#AEB7C1",
    "vegetation":      "#91AD8C",
    "network_green":   "#63BF70",
    "accent_blue":     "#194FAF",
}


def srgb_to_linear(c):
    """Blender stores colours in linear; the brief's hexes are sRGB."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(srgb_to_linear(c) for c in rgb) + (alpha,)


# ------------------------------------------------------------ plan (metres)
#
# The boulevard runs along +X with the median on y = 0. The Bank of Industry
# sits on the +Y side and Native Supply on the -Y side, which is what puts them
# upper-right and mid-left once the isometric camera is swung round.

ROAD_LEN = 280.0            # runs well past frame at both ends
LANE = 3.65
LANES = 3
MEDIAN_HW = 2.25            # half-width of the central median
CARRIAGE = LANES * LANE
KERB_Y = MEDIAN_HW + CARRIAGE          # 13.2 m from centreline to kerb
PAVE_W = 7.0
ROAD_T = 0.16               # road slab thickness, per the brief
KERB_H = 0.30
MARK_Z = 0.008              # markings float above the slab, never z-fight

COLLECTIONS = [
    "ENV_Ground", "ENV_Roads", "ENV_Buildings_Main", "ENV_Buildings_Secondary",
    "ENV_Pavements", "ENV_StreetFurniture", "ENV_Vegetation", "ENV_Vehicles",
    "ENV_Pedestrians", "ENV_LP12_Anchor", "ENV_Lighting", "ENV_Cameras",
]


# ------------------------------------------------------------------ setup

def wipe():
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                  bpy.data.lights, bpy.data.curves):
        for item in list(block):
            block.remove(item)


def make_collections():
    out = {}
    for name in COLLECTIONS:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
        out[name] = coll
    return out


COLL = {}


def link(ob, coll_name):
    COLL[coll_name].objects.link(ob)
    return ob


# -------------------------------------------------------------- materials

MATS = {}


def material(name, hex_colour, roughness=0.72, specular=0.28,
             alpha=1.0, transmission=0.0):
    if name in MATS:
        return MATS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_rgba(hex_colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    for key in ("Specular IOR Level", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = specular
            break
    if transmission:
        for key in ("Transmission Weight", "Transmission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = transmission
                break
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else mat.blend_method
    MATS[name] = mat
    return mat


def build_materials():
    material("ENV_Road_Primary", PALETTE["road_primary"], 0.68, 0.22)
    material("ENV_Road_Secondary", PALETTE["road_secondary"], 0.70, 0.22)
    material("ENV_Road_Marking", PALETTE["road_marking"], 0.60, 0.25)
    material("ENV_Building", PALETTE["building"], 0.72, 0.30)
    material("ENV_Building_Hi", PALETTE["building_hi"], 0.70, 0.32)
    material("ENV_Building_Shadow", PALETTE["building_shadow"], 0.74, 0.26)
    material("ENV_Ground", PALETTE["ground"], 0.80, 0.20)
    material("ENV_Pavement", PALETTE["pavement"], 0.78, 0.22)
    material("ENV_Glass", PALETTE["window"], 0.28, 0.35, alpha=0.88, transmission=0.10)
    material("ENV_Glass_Dark", PALETTE["window_dark"], 0.32, 0.35)
    material("ENV_Metal", PALETTE["metal"], 0.42, 0.40)
    material("ENV_Vegetation", PALETTE["vegetation"], 0.80, 0.18)
    material("ENV_Accent_Blue", PALETTE["accent_blue"], 0.60, 0.30)
    material("ENV_Network_Green", PALETTE["network_green"], 0.62, 0.28)


# ---------------------------------------------------------------- helpers

def _finish(ob, mat, coll, bevel=None, smooth_angle=40.0):
    if mat:
        ob.data.materials.append(MATS[mat])
    link(ob, coll)
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(35.0)
        # harden_normals only has something to harden if the surface is smooth,
        # and since 4.1 there is no mesh-level auto-smooth flag to set — the
        # per-face flag plus the bevel's own angle limit is the whole contract.
        mod.harden_normals = True
        ob.data.shade_smooth()
    return ob


def box(name, x0, x1, y0, y1, z0, z1, mat=None, coll="ENV_Ground", bevel=None):
    """Axis-aligned box from explicit extents — the clearest way to lay a city out."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((x1 - x0, y1 - y0, z1 - z0)), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return _finish(ob, mat, coll, bevel)


def prism(name, verts2d, z0, z1, mat=None, coll="ENV_Ground", bevel=None,
          loc=(0.0, 0.0, 0.0)):
    """Extruded polygon — used for anything the grid cannot describe."""
    bm = bmesh.new()
    base = [bm.verts.new((x, y, z0)) for x, y in verts2d]
    bm.faces.new(base)
    bm.normal_update()
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, z1 - z0)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    return _finish(ob, mat, coll, bevel)


def arc_slab(name, cx, cy, r_in, r_out, a0, a1, z0, z1, segs=24,
             mat=None, coll="ENV_Roads", bevel=None):
    """Annular sector with thickness — junction curves and ramp bends."""
    a0, a1 = math.radians(a0), math.radians(a1)
    pts = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        pts.append((cx + r_out * math.cos(a), cy + r_out * math.sin(a)))
    for i in range(segs, -1, -1):
        a = a0 + (a1 - a0) * i / segs
        pts.append((cx + r_in * math.cos(a), cy + r_in * math.sin(a)))
    return prism(name, pts, z0, z1, mat, coll, bevel)


def instance(name, source_ob, loc, rot_z=0.0, coll=None, scale=1.0):
    """A linked copy: new object, same mesh data. No geometry is duplicated."""
    ob = bpy.data.objects.new(name, source_ob.data)
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    ob.scale = (scale, scale, scale)
    link(ob, coll or "ENV_StreetFurniture")
    return ob


# ------------------------------------------------------------------ ground

# The cutting the slip road runs through. Declared here because the ground has
# to be built around it, not over it.
TRENCH_X = (-23.0, -10.0)
TRENCH_Y = (-52.0, 34.0)
TRENCH_Z = -5.0


def build_ground():
    gx0, gx1, gy0, gy1 = -220.0, 220.0, -170.0, 170.0
    tx0, tx1 = TRENCH_X
    ty0, ty1 = TRENCH_Y
    # Four slabs leaving a rectangular void for the cutting. A boolean would
    # work too, but four boxes cost four objects and no modifier evaluation,
    # and the void is a plain rectangle.
    box("Ground_West", gx0, tx0, gy0, gy1, -0.30, 0.0, "ENV_Ground", "ENV_Ground")
    box("Ground_East", tx1, gx1, gy0, gy1, -0.30, 0.0, "ENV_Ground", "ENV_Ground")
    box("Ground_South", tx0, tx1, gy0, ty0, -0.30, 0.0, "ENV_Ground", "ENV_Ground")
    box("Ground_North", tx0, tx1, ty1, gy1, -0.30, 0.0, "ENV_Ground", "ENV_Ground")
    box("Trench_Floor", tx0, tx1, ty0, ty1, TRENCH_Z - 0.30, TRENCH_Z,
        "ENV_Ground", "ENV_Ground")


# ------------------------------------------------------------------- roads

def build_roads():
    half = ROAD_LEN / 2

    # Two carriageways, kept as separate slabs so the median reads as a real
    # object between them rather than a stripe painted on one wide plane.
    for sign, tag in ((1, "North"), (-1, "South")):
        y0, y1 = sorted((sign * MEDIAN_HW, sign * KERB_Y))
        box(f"Road_Carriageway_{tag}", -half, half, y0, y1, 0.0, ROAD_T,
            "ENV_Road_Primary", "ENV_Roads")

    # Raised median with its planting strip.
    box("Road_Median", -half, half, -MEDIAN_HW, MEDIAN_HW, 0.0, ROAD_T + KERB_H,
        "ENV_Pavement", "ENV_Roads", bevel=0.05)
    box("Road_Median_Planting", -half + 6, half - 6, -MEDIAN_HW + 0.5, MEDIAN_HW - 0.5,
        ROAD_T + KERB_H, ROAD_T + KERB_H + 0.55,
        "ENV_Vegetation", "ENV_Vegetation", bevel=0.06)

    # Junction sweeping off the north carriageway, upper-left in frame.
    #
    # The arc is struck from a centre one radius clear of the kerb, so its
    # 270-degree point lands exactly on the kerb line and the slip road grows
    # out of the carriageway instead of hovering beside it. Sweeping backwards
    # from 270 is what carries it away up-left; a symmetric sweep either side of
    # 270 only kisses the kerb and comes straight back, which is what the first
    # attempt did.
    slip_w = 2 * LANE
    jc_x, jc_r = -100.0, 32.0
    jc_y = KERB_Y + jc_r
    a_end = 200.0
    arc_slab("Road_Junction_Curve", cx=jc_x, cy=jc_y, r_in=jc_r, r_out=jc_r + slip_w,
             a0=270.0, a1=a_end, z0=0.0, z1=ROAD_T, segs=30,
             mat="ENV_Road_Secondary", coll="ENV_Roads")

    # Straight leg continuing along the arc's tangent, so the two meet without a
    # kink. Traversing the circle with decreasing angle makes the tangent
    # (sin a, -cos a).
    ar = math.radians(a_end)
    tan = Vector((math.sin(ar), -math.cos(ar), 0.0)).normalized()
    p_in = Vector((jc_x + jc_r * math.cos(ar), jc_y + jc_r * math.sin(ar), 0.0))
    p_out = Vector((jc_x + (jc_r + slip_w) * math.cos(ar),
                    jc_y + (jc_r + slip_w) * math.sin(ar), 0.0))
    leg = 62.0
    prism("Road_Junction_Leg",
          [(p_in.x, p_in.y), (p_out.x, p_out.y),
           (p_out.x + tan.x * leg, p_out.y + tan.y * leg),
           (p_in.x + tan.x * leg, p_in.y + tan.y * leg)],
          0.0, ROAD_T, "ENV_Road_Secondary", "ENV_Roads")

    # Access ramp on the south side that dives under the boulevard. The
    # reference has one; it is what breaks the corridor's symmetry and gives the
    # lower-middle of the frame something to read.
    build_underpass()


def ramp_strip(name, x0, x1, profile, thickness, mat, coll):
    """A strip running along Y whose height follows an explicit profile.

    A four-corner prism cannot describe a grade: lifting its end vertices lifts
    the whole slab, which is how the first cutting ended up as a flat blue pool
    at ground level. The profile is sampled into real rows so the descent,
    the level section under the deck and the climb out are all geometry.
    """
    bm = bmesh.new()
    rows = []
    for y, z in profile:
        rows.append((bm.verts.new((x0, y, z)), bm.verts.new((x1, y, z))))
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    bm.normal_update()
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, thickness)), verts=moved)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    return _finish(ob, mat, coll, None)


def underpass_profile():
    """Grade down, run level beneath the boulevard, climb back out."""
    y0, y1 = TRENCH_Y
    run = 22.0
    flat0, flat1 = y0 + run, y1 - run
    pts = []
    steps = 8
    for i in range(steps + 1):                      # descent
        t = i / steps
        pts.append((y0 + (flat0 - y0) * t, -TRENCH_Z * 0 + TRENCH_Z * t))
    for i in range(1, 5):                           # level under the deck
        pts.append((flat0 + (flat1 - flat0) * i / 4, TRENCH_Z))
    for i in range(1, steps + 1):                   # climb out
        t = i / steps
        pts.append((flat1 + (y1 - flat1) * t, TRENCH_Z * (1 - t)))
    return pts


def build_underpass():
    """A slip road in a cutting that passes beneath the boulevard.

    The ground is built in four pieces around this trench rather than as one
    sheet, so the cutting is a genuine void; the boulevard's own slab becomes
    the deck bridging it.
    """
    x0, x1 = TRENCH_X
    y0, y1 = TRENCH_Y
    prof = underpass_profile()

    ramp_strip("Road_Underpass_Deck", x0 + 0.7, x1 - 0.7, prof, ROAD_T,
               "ENV_Road_Secondary", "ENV_Roads")

    # Retaining walls, full depth, capped at pavement level.
    for i, x in enumerate((x0, x1 - 0.7)):
        box(f"Underpass_Wall_{i}", x, x + 0.7, y0, y1, TRENCH_Z - 0.3,
            ROAD_T + KERB_H, "ENV_Pavement", "ENV_Pavements", bevel=0.05)

    # Deck soffit, so the boulevard reads as a structure crossing a void rather
    # than a sheet of paper over a hole.
    box("Underpass_Deck_Soffit", x0 - 1.2, x1 + 1.2, -KERB_Y - PAVE_W - 1.5,
        KERB_Y + PAVE_W + 1.5, -1.1, 0.0,
        "ENV_Building_Shadow", "ENV_Pavements", bevel=0.06)

    for tag, y in (("S", -KERB_Y - PAVE_W - 2.6), ("N", KERB_Y + PAVE_W + 1.9)):
        box(f"Underpass_Portal_{tag}", x0 - 1.4, x1 + 1.4, y, y + 0.8,
            -1.1, ROAD_T + KERB_H + 0.6,
            "ENV_Pavement", "ENV_Pavements", bevel=0.07)

    # Guard rail along both lips so the drop reads from above.
    for i, x in enumerate((x0 - 0.35, x1 + 0.35 - 0.12)):
        box(f"Underpass_Rail_{i}", x, x + 0.12, y0, y1,
            ROAD_T + KERB_H + 0.75, ROAD_T + KERB_H + 0.9,
            "ENV_Metal", "ENV_StreetFurniture")


def build_markings():
    half = ROAD_LEN / 2
    z0, z1 = ROAD_T, ROAD_T + MARK_Z

    # Dashed lane dividers. Separate geometry, floated clear of the slab —
    # a texture decal would shimmer once this is running in the browser.
    dash, gap, w = 3.0, 6.0, 0.16
    for sign in (1, -1):
        for lane_i in range(1, LANES):
            y = sign * (MEDIAN_HW + lane_i * LANE)
            x = -half + 4
            idx = 0
            while x < half - 4:
                box(f"Mark_Dash_{sign}_{lane_i}_{idx}", x, x + dash, y - w / 2, y + w / 2,
                    z0, z1, "ENV_Road_Marking", "ENV_Roads")
                x += dash + gap
                idx += 1

    # Pedestrian crossings. Present in the reference and worth the triangles:
    # they are the clearest cue that the corridor is a street people cross
    # rather than a strip of blue.
    for ci, cx in enumerate((-62.0, 4.0, 70.0)):
        for sign in (1, -1):
            y0, y1 = sorted((sign * MEDIAN_HW, sign * KERB_Y))
            for b in range(7):
                x = cx - 3.15 + b * 0.9
                box(f"Mark_Zebra_{ci}_{sign}_{b}", x, x + 0.5, y0 + 0.3, y1 - 0.3,
                    z0, z1, "ENV_Road_Marking", "ENV_Roads")

    # Solid edge lines against the kerb.
    for sign in (1, -1):
        y = sign * (KERB_Y - 0.45)
        box(f"Mark_Edge_{sign}", -half + 4, half - 4, y - 0.09, y + 0.09,
            z0, z1, "ENV_Road_Marking", "ENV_Roads")


def build_pavements():
    half = ROAD_LEN / 2
    for sign, tag in ((1, "North"), (-1, "South")):
        y_k = sign * KERB_Y
        y_out = sign * (KERB_Y + PAVE_W)
        y0, y1 = sorted((y_k, y_out))
        box(f"Pavement_{tag}", -half, half, y0, y1, 0.0, ROAD_T + KERB_H,
            "ENV_Pavement", "ENV_Pavements", bevel=0.05)
        # Kerb face, bevelled so the studio key light catches a highlight along
        # the whole corridor. That edge is most of what reads as "modelled".
        ky0, ky1 = sorted((y_k, y_k + sign * 0.35))
        box(f"Kerb_{tag}", -half, half, ky0, ky1, ROAD_T, ROAD_T + KERB_H + 0.02,
            "ENV_Building_Shadow", "ENV_Pavements", bevel=0.04)


# --------------------------------------------------------------- buildings

def storey_windows(name, x0, x1, y_face, out, storeys, base_z, storey_h, coll,
                   mat="ENV_Glass", pitch_target=4.2):
    """Windows bay by bay, each set into a shadowed reveal.

    The first version drew one continuous strip per storey. It costs almost
    nothing, but a facade of unbroken horizontal bands reads as a striped
    extrusion rather than a building — there is no bay rhythm and no depth for
    the key light to find. Splitting the strip into bays and setting each one
    back behind a reveal is where the triangle budget earns its keep.

    `out` is +1 when the face points along +Y and -1 when it points along -Y, so
    the reveal is cut INTO the mass rather than pushed out of it.
    """
    span = x1 - x0
    bays = max(3, int(round(span / pitch_target)))
    pitch = span / bays
    win_w = pitch * 0.66
    for s in range(storeys):
        z0 = base_z + s * storey_h + storey_h * 0.30
        z1 = z0 + storey_h * 0.42
        for b in range(bays):
            cx = x0 + pitch * (b + 0.5)
            bx0, bx1 = cx - win_w / 2, cx + win_w / 2
            # Reveal: a shadow-toned pocket driven back into the wall.
            ry0, ry1 = sorted((y_face - out * 0.38, y_face + out * 0.03))
            box(f"{name}_Reveal_{s}_{b}", bx0, bx1, ry0, ry1, z0, z1,
                "ENV_Building_Shadow", coll)
            # Glazing sitting inside the pocket.
            gy0, gy1 = sorted((y_face - out * 0.30, y_face - out * 0.14))
            box(f"{name}_Win_{s}_{b}", bx0 + 0.05, bx1 - 0.05, gy0, gy1,
                z0 + 0.05, z1 - 0.05, mat, coll)


def build_bank_of_industry():
    """The dominant landmark. Tallest mass, deepest plot, own forecourt."""
    cx, cy = 30.0, 46.0
    w, d = 70.0, 30.0
    storeys, storey_h = 7, 3.6
    h = storeys * storey_h
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - d / 2, cy + d / 2

    box("BOI_Mass", x0, x1, y0, y1, 0.0, h, "ENV_Building",
        "ENV_Buildings_Main", bevel=0.08)
    box("BOI_Parapet", x0 - 0.4, x1 + 0.4, y0 - 0.4, y1 + 0.4, h, h + 1.1,
        "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.06)

    storey_windows("BOI", x0 + 3, x1 - 3, y0, -1.0, storeys, 0.0, storey_h,
                   "ENV_Buildings_Main")
    storey_windows("BOI_Rear", x0 + 3, x1 - 3, y1, 1.0, storeys, 0.0, storey_h,
                   "ENV_Buildings_Main")

    # Projecting entrance canopy and steps.
    box("BOI_Canopy", cx - 11, cx + 11, y0 - 7.5, y0 + 0.5, 5.4, 6.2,
        "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.07)
    for i in range(4):
        box(f"BOI_Step_{i}", cx - 12 + i * 0.5, cx + 12 - i * 0.5,
            y0 - 7.0 + i * 0.55, y0 - 1.0, i * 0.22, (i + 1) * 0.22,
            "ENV_Pavement", "ENV_Buildings_Main", bevel=0.03)
    for i in range(6):
        x = cx - 9.5 + i * 3.8
        box(f"BOI_Column_{i}", x - 0.35, x + 0.35, y0 - 6.6, y0 - 5.9, 0.9, 5.4,
            "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.04)

    # Blank sign panel. Deliberately untextured — the brief wants the
    # identification added by the application, not baked into the mesh.
    box("BOI_Sign_Panel", cx + 6, cx + 30, y0 - 0.35, y0 - 0.05, h - 5.0, h - 1.6,
        "ENV_Network_Green", "ENV_Buildings_Main", bevel=0.03)

    # Vertical fins between the window bands. The reference facade is read as a
    # rhythm of piers, not a stack of stripes, and the fins are what catch the
    # key light and give the mass its depth.
    for i in range(15):
        fx = x0 + 3.0 + i * 4.6
        for fy, tag in ((y0, "F"), (y1, "R")):
            box(f"BOI_Fin_{tag}_{i}", fx - 0.30, fx + 0.30,
                fy - 0.34, fy + 0.34, 0.9, h - 0.4,
                "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.04)
    box("BOI_Base_Course", x0 - 0.5, x1 + 0.5, y0 - 0.5, y1 + 0.5, 0.0, 1.2,
        "ENV_Building_Shadow", "ENV_Buildings_Main", bevel=0.05)
    # Roof plant, so the skyline is not a clean rectangle.
    for i, (dx, dw, dd) in enumerate(((-22, 9, 8), (-6, 6, 7), (12, 11, 9), (28, 7, 6))):
        box(f"BOI_Roof_Plant_{i}", cx + dx - dw / 2, cx + dx + dw / 2,
            cy - dd / 2, cy + dd / 2, h + 1.1, h + 1.1 + 1.6 + (i % 2) * 0.9,
            "ENV_Building_Shadow", "ENV_Buildings_Main", bevel=0.05)

    box("BOI_Forecourt", x0 - 4, x1 + 4, KERB_Y + PAVE_W, y0, 0.0, ROAD_T + KERB_H,
        "ENV_Pavement", "ENV_Pavements", bevel=0.04)

    # Perimeter fence and gate along the frontage.
    fy = KERB_Y + PAVE_W + 0.4
    box("BOI_Fence_Plinth", x0 - 4, x1 + 4, fy, fy + 0.4, ROAD_T + KERB_H,
        ROAD_T + KERB_H + 0.45, "ENV_Pavement", "ENV_StreetFurniture", bevel=0.03)
    rail = box("BOI_Fence_Rail", x0 - 4, x1 + 4, fy + 0.12, fy + 0.28,
               ROAD_T + KERB_H + 1.85, ROAD_T + KERB_H + 2.0,
               "ENV_Metal", "ENV_StreetFurniture")
    post_src = box("BOI_Fence_Post_src", -0.05, 0.05, -0.05, 0.05,
                   0, 1.65, "ENV_Metal", "ENV_StreetFurniture")
    post_src.hide_render = True
    post_src.hide_viewport = True
    n = int((x1 + 4 - (x0 - 4)) / 1.9)
    for i in range(n):
        x = x0 - 4 + i * 1.9
        if cx - 5 < x < cx + 5:
            continue                      # gate opening on the entrance axis
        instance(f"BOI_Fence_Post_{i}", post_src,
                 (x, fy + 0.2, ROAD_T + KERB_H + 0.4), coll="ENV_StreetFurniture")
    return rail


def build_native_supply():
    """Lower, broader commercial block with a dark glass storefront."""
    cx, cy = -52.0, -38.0
    w, d, h = 42.0, 26.0, 11.5
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - d / 2, cy + d / 2

    box("NS_Mass", x0, x1, y0, y1, 0.0, h, "ENV_Building",
        "ENV_Buildings_Main", bevel=0.08)
    box("NS_Parapet", x0 - 0.35, x1 + 0.35, y0 - 0.35, y1 + 0.35, h, h + 0.9,
        "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.05)

    # Storefront: restrained blue-grey glass, recessed behind a frame.
    #
    # Both long faces get it. An orthographic camera looking across a straight
    # road can only ever see the road-facing facade of one side of it — with the
    # swing this scene uses that is the Bank of Industry, which would leave this
    # building a blank slab in the hero shot. Glazing both faces is also simply
    # true of a commercial unit with frontage and a service yard.
    for tag, fy, out in (("Front", y1, 1.0), ("Rear", y0, -1.0)):
        box(f"NS_Storefront_{tag}", x0 + 2.5, x1 - 2.5,
            fy - 0.30 * out, fy + 0.02 * out, 0.4, 6.4,
            "ENV_Glass_Dark", "ENV_Buildings_Main")
        for i in range(7):
            x = x0 + 3.5 + i * 5.2
            box(f"NS_Mullion_{tag}_{i}", x - 0.12, x + 0.12,
                fy - 0.32 * out, fy + 0.10 * out, 0.4, 6.6,
                "ENV_Building_Hi", "ENV_Buildings_Main")
        storey_windows(f"NS_Upper_{tag}", x0 + 3, x1 - 3, fy, out, 1, 7.0, 3.4,
                       "ENV_Buildings_Main")
        # Blank sign panel — kept untextured so the application supplies the
        # identification rather than the mesh baking it in.
        box(f"NS_Sign_Panel_{tag}", cx - 12, cx + 12,
            fy + 0.06 * out, fy + 0.22 * out, 7.6, 9.0,
            "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.03)
    box("NS_Base_Course", x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, 0.0, 0.9,
        "ENV_Building_Shadow", "ENV_Buildings_Main", bevel=0.04)

    # Rooftop plant, simplified to three volumes.
    for i, (dx, dw) in enumerate(((-11, 6), (0, 5), (10, 7))):
        box(f"NS_Roof_Plant_{i}", cx + dx - dw / 2, cx + dx + dw / 2,
            cy - 5, cy + 4, h + 0.9, h + 2.6,
            "ENV_Building_Shadow", "ENV_Buildings_Main", bevel=0.05)

    box("NS_Plaza", x0 - 3, x1 + 8, y1, -KERB_Y - PAVE_W, 0.0, ROAD_T + KERB_H,
        "ENV_Pavement", "ENV_Pavements", bevel=0.04)


SECONDARY = [
    # (name, cx, cy, w, d, h, storeys)
    # South-west frontage: a run of small commercial units facing the boulevard,
    # which is what fills the lower-left of the isometric in the reference.
    ("Sec_SW_A", -104.0, -34.0, 26.0, 18.0, 8.0, 2),
    ("Sec_SW_B",  -76.0, -66.0, 30.0, 22.0, 9.0, 2),
    # Kept clear of the cutting at x -24..-9: a plot pad dropped over it buries
    # the slip road, which is exactly what happened to the first layout.
    ("Sec_SW_C",  -48.0, -34.0, 26.0, 16.0, 7.0, 2),
    ("Sec_SW_D",  -46.0, -64.0, 30.0, 20.0, 10.0, 3),
    ("Sec_S_E",    12.0, -36.0, 24.0, 15.0, 6.5, 2),
    ("Sec_S_F",    22.0, -66.0, 32.0, 24.0, 12.0, 3),
    ("Sec_S_G",    72.0, -40.0, 36.0, 22.0, 9.5, 2),
    ("Sec_S_H",    64.0, -76.0, 30.0, 20.0, 11.0, 3),
    # North side, behind and beside the landmark.
    ("Sec_NE_I",  -34.0,  58.0, 32.0, 22.0, 10.5, 3),
    ("Sec_NE_J",   -2.0,  76.0, 36.0, 24.0, 8.0, 2),
    ("Sec_NE_K",   84.0,  54.0, 40.0, 26.0, 14.0, 4),
    # Clear of the junction arc, which sweeps x -100..-132 on the north side.
    ("Sec_NW_L", -152.0,  62.0, 26.0, 20.0, 9.5, 2),
    ("Sec_NW_M",  -66.0,  44.0, 24.0, 18.0, 7.5, 2),
]


def build_plots():
    """Ground articulation: forecourts, parking bays, planting beds and plot
    edging. Without it every building sits on one unbroken white plane, which is
    what makes a low-poly scene read as unfinished blocks rather than a modelled
    site — the reference style leans heavily on these flat divisions."""
    z = ROAD_T + KERB_H

    # Plot pads under the secondary buildings, slightly proud of the ground.
    for name, cx, cy, w, d, _h, _s in SECONDARY:
        pad_w, pad_d = w + 11.0, d + 9.0
        box(f"Plot_{name}", cx - pad_w / 2, cx + pad_w / 2,
            cy - pad_d / 2, cy + pad_d / 2, 0.0, z * 0.72,
            "ENV_Pavement", "ENV_Pavements", bevel=0.04)

    # Parking bays: a pad plus painted bay dividers, on the frontage side.
    def parking(tag, cx, cy, bays, along_x=True):
        bay_w, bay_d = 2.6, 5.2
        span = bays * bay_w
        if along_x:
            box(f"Park_{tag}", cx - span / 2, cx + span / 2, cy - bay_d / 2, cy + bay_d / 2,
                0.0, z * 0.76, "ENV_Building_Shadow", "ENV_Pavements", bevel=0.03)
            for i in range(bays + 1):
                x = cx - span / 2 + i * bay_w
                box(f"Park_{tag}_Line_{i}", x - 0.06, x + 0.06,
                    cy - bay_d / 2, cy + bay_d / 2, z * 0.76, z * 0.76 + MARK_Z,
                    "ENV_Road_Marking", "ENV_Pavements")
        else:
            box(f"Park_{tag}", cx - bay_d / 2, cx + bay_d / 2, cy - span / 2, cy + span / 2,
                0.0, z * 0.76, "ENV_Building_Shadow", "ENV_Pavements", bevel=0.03)
            for i in range(bays + 1):
                y = cy - span / 2 + i * bay_w
                box(f"Park_{tag}_Line_{i}", cx - bay_d / 2, cx + bay_d / 2,
                    y - 0.06, y + 0.06, z * 0.76, z * 0.76 + MARK_Z,
                    "ENV_Road_Marking", "ENV_Pavements")

    parking("NS", -58.0, -(KERB_Y + PAVE_W + 4.2), 12)
    parking("BOI_West", -46.0, KERB_Y + PAVE_W + 5.0, 10)
    parking("BOI_East", 78.0, KERB_Y + PAVE_W + 5.0, 8)
    parking("SW", -104.0, -(KERB_Y + PAVE_W + 4.0), 8)

    # Planting beds between the pavement and the plot lines.
    beds = [(-92.0, KERB_Y + PAVE_W + 2.2, 22.0), (44.0, KERB_Y + PAVE_W + 2.2, 26.0),
            (-44.0, -(KERB_Y + PAVE_W + 2.2), 24.0), (40.0, -(KERB_Y + PAVE_W + 2.2), 20.0),
            (96.0, -(KERB_Y + PAVE_W + 2.2), 22.0)]
    for i, (cx, cy, w) in enumerate(beds):
        box(f"Planting_Bed_{i}", cx - w / 2, cx + w / 2, cy - 2.0, cy + 2.0,
            0.0, z + 0.20, "ENV_Vegetation", "ENV_Vegetation", bevel=0.05)

    # The LAGOS billboard on the south-west plot — a landmark in the reference
    # and a useful vertical in an otherwise low corner.
    bx, by = -118.0, -52.0
    for i in (-1, 1):
        box(f"Billboard_Leg_{i}", bx + i * 5.0 - 0.22, bx + i * 5.0 + 0.22,
            by - 0.22, by + 0.22, 0.0, 7.0, "ENV_Metal", "ENV_StreetFurniture")
    box("Billboard_Panel", bx - 7.5, bx + 7.5, by - 0.30, by + 0.30, 7.0, 11.6,
        "ENV_Building_Hi", "ENV_StreetFurniture", bevel=0.06)
    box("Billboard_Band", bx - 7.5, bx - 2.0, by - 0.42, by - 0.32, 7.6, 9.2,
        "ENV_Accent_Blue", "ENV_StreetFurniture", bevel=0.03)


def build_secondary():
    for name, cx, cy, w, d, h, storeys in SECONDARY:
        x0, x1 = cx - w / 2, cx + w / 2
        y0, y1 = cy - d / 2, cy + d / 2
        box(f"{name}_Mass", x0, x1, y0, y1, 0.0, h, "ENV_Building",
            "ENV_Buildings_Secondary", bevel=0.07)
        box(f"{name}_Parapet", x0 - 0.3, x1 + 0.3, y0 - 0.3, y1 + 0.3, h, h + 0.8,
            "ENV_Building_Hi", "ENV_Buildings_Secondary", bevel=0.05)
        # Both faces the isometric can see get glazing; one-sided banding leaves
        # half the massing blank from this angle.
        for face_y, face_out in ((y0, -1.0), (y1, 1.0)):
            storey_windows(f"{name}_{'S' if face_out < 0 else 'N'}",
                           x0 + 2.5, x1 - 2.5, face_y, face_out, storeys, 0.0,
                           h / max(storeys, 1), "ENV_Buildings_Secondary")
        # Shadow-toned base course, which is what stops the mass reading as a
        # single flat extrusion.
        box(f"{name}_Base", x0 - 0.25, x1 + 0.25, y0 - 0.25, y1 + 0.25, 0.0, 0.9,
            "ENV_Building_Shadow", "ENV_Buildings_Secondary", bevel=0.04)
        face_y = y0 if cy > 0 else y1
        # Parapet coping and rooftop plant, so the skyline is not a row of
        # identical clean rectangles.
        box(f"{name}_Coping", x0 - 0.45, x1 + 0.45, y0 - 0.45, y1 + 0.45,
            h + 0.8, h + 1.0, "ENV_Building_Shadow", "ENV_Buildings_Secondary",
            bevel=0.03)
        n_plant = 2 + (int(abs(cx)) % 2)
        for k in range(n_plant):
            pw = 4.5 + (k % 2) * 2.5
            px = cx - w / 4 + k * (w / max(n_plant, 1)) * 0.8
            box(f"{name}_Plant_{k}", px - pw / 2, px + pw / 2,
                cy - 3.2, cy + 2.6, h + 1.0, h + 1.0 + 1.3 + (k % 2) * 0.7,
                "ENV_Building_Hi", "ENV_Buildings_Secondary", bevel=0.05)

        box(f"{name}_Entrance", cx - 2.2, cx + 2.2,
            face_y - 1.6 if cy > 0 else face_y - 0.1,
            face_y + 0.1 if cy > 0 else face_y + 1.6,
            0.0, 3.2, "ENV_Building_Shadow", "ENV_Buildings_Secondary", bevel=0.04)


# -------------------------------------------------------------- vegetation

def palm_prototype():
    """One palm, reused everywhere as a linked instance.

    Two material slots on a single mesh rather than two parented objects: the
    trunk is not the same colour as the foliage, and a palm rendered entirely in
    leaf-green reads as a green post. One mesh keeps the instance a single
    object, which matters when there are eighty of them.

    The crown is a dozen narrow, steeply arching fronds in two tiers. The first
    version used eight wide, near-horizontal blades and read as a flat star from
    the steep isometric this scene is actually viewed from.
    """
    bm = bmesh.new()

    # Tapered trunk, 8 sides.
    trunk_h = 6.2
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=8,
                                radius1=0.21, radius2=0.13, depth=trunk_h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, trunk_h / 2)), verts=bm.verts)
    trunk_faces = set(f.index for f in bm.faces)

    # Crown boss, so the fronds spring from a mass rather than a point.
    bmesh.ops.create_icosphere(
        bm, subdivisions=1, radius=0.30,
        matrix=Matrix.Translation((0, 0, trunk_h + 0.05)))

    for tier, (count, reach, lift, droop, phase, half_w) in enumerate((
            (7, 2.55, 0.05, 1.75, 0.00, 0.19),
            (5, 1.65, 0.62, 0.95, 0.45, 0.15))):
        for i in range(count):
            a = (i / count) * math.tau + phase
            ca, sa = math.cos(a), math.sin(a)
            root = Vector((ca * 0.22, sa * 0.22, trunk_h + lift))
            tip = Vector((ca * reach, sa * reach, trunk_h + lift - droop))
            side = Vector((-sa * half_w, ca * half_w, 0))
            # Arch: the midpoint rides above the straight root-to-tip chord.
            mid = (root + tip) / 2 + Vector((0, 0, 0.46))
            spine = Vector((0, 0, 0.13))
            r_c, m_c, t_c = (bm.verts.new(root + spine * 0.3),
                             bm.verts.new(mid + spine),
                             bm.verts.new(tip))
            r_l, m_l = bm.verts.new(root + side * 0.45), bm.verts.new(mid + side)
            r_r, m_r = bm.verts.new(root - side * 0.45), bm.verts.new(mid - side)
            bm.faces.new((r_c, m_c, m_l, r_l))
            bm.faces.new((m_c, t_c, m_l))
            bm.faces.new((r_r, m_r, m_c, r_c))
            bm.faces.new((m_r, t_c, m_c))

    bm.normal_update()
    me = bpy.data.meshes.new("Palm_src")
    bm.to_mesh(me)
    bm.free()

    me.materials.append(MATS["ENV_Building_Shadow"])   # slot 0: trunk
    me.materials.append(MATS["ENV_Vegetation"])        # slot 1: fronds
    for poly in me.polygons:
        poly.material_index = 0 if poly.index in trunk_faces else 1

    ob = bpy.data.objects.new("Palm_src", me)
    link(ob, "ENV_Vegetation")
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def shrub_prototype():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.9)
    for v in bm.verts:
        v.co.z = max(v.co.z * 0.62, -0.1)
    me = bpy.data.meshes.new("Shrub_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Shrub_src", me)
    ob.data.materials.append(MATS["ENV_Vegetation"])
    link(ob, "ENV_Vegetation")
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def build_vegetation():
    palm = palm_prototype()
    shrub = shrub_prototype()
    z = ROAD_T + KERB_H
    idx = 0

    # Palms along both pavements and the median, spacing varied enough that the
    # rhythm does not read as a stamped array.
    for sign in (1, -1):
        y = sign * (KERB_Y + 2.6)
        x = -ROAD_LEN / 2 + 14
        while x < ROAD_LEN / 2 - 14:
            instance(f"Palm_{idx}", palm, (x, y, z), rot_z=(idx * 1.13) % math.tau,
                     coll="ENV_Vegetation", scale=0.88 + 0.22 * ((idx * 7) % 5) / 5)
            x += 17.0 + 4.0 * ((idx * 3) % 3)
            idx += 1

    for i in range(14):
        x = -ROAD_LEN / 2 + 22 + i * 18.0
        instance(f"Palm_Med_{i}", palm, (x, 0.0, ROAD_T + KERB_H + 0.5),
                 rot_z=(i * 0.7) % math.tau, coll="ENV_Vegetation", scale=0.7)

    # Palms on the building plots, so planting is not confined to the kerb line.
    for i, (name, cx, cy, w, d, _h, _s) in enumerate(SECONDARY):
        for k in range(3):
            px = cx - w / 2 - 3.5 + k * ((w + 7.0) / 2)
            py = cy + (d / 2 + 3.4) * (1 if cy < 0 else -1)
            instance(f"Palm_Plot_{i}_{k}", palm, (px, py, z),
                     rot_z=(i * 0.9 + k) % math.tau, coll="ENV_Vegetation",
                     scale=0.78 + 0.12 * (k % 2))

    for i in range(78):
        ang = (i * 2.399)
        r = 40 + (i % 7) * 12
        x = math.cos(ang) * r * 1.6
        y = math.sin(ang) * r
        if abs(y) < KERB_Y + PAVE_W + 2:
            continue
        if TRENCH_X[0] - 3 < x < TRENCH_X[1] + 3 and TRENCH_Y[0] < y < TRENCH_Y[1]:
            continue                       # never scatter into the cutting
        instance(f"Shrub_{i}", shrub, (x, y, z), rot_z=ang,
                 coll="ENV_Vegetation", scale=0.8 + (i % 4) * 0.25)


# ---------------------------------------------------- street furniture

def streetlight_prototype():
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.11,
                          radius2=0.08, depth=8.0)
    bmesh.ops.translate(bm, vec=Vector((0, 0, 4.0)), verts=bm.verts)
    me = bpy.data.meshes.new("Streetlight_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Streetlight_src", me)
    ob.data.materials.append(MATS["ENV_Metal"])
    link(ob, "ENV_StreetFurniture")

    arm = box("Streetlight_Arm_src", -0.06, 1.5, -0.06, 0.06, 7.8, 7.94,
              "ENV_Metal", "ENV_StreetFurniture")
    head = box("Streetlight_Head_src", 1.3, 2.1, -0.22, 0.22, 7.62, 7.84,
               "ENV_Building_Hi", "ENV_StreetFurniture")
    for child in (arm, head):
        child.parent = ob
    for o in (ob, arm, head):
        o.hide_render = True
        o.hide_viewport = True
    return ob, arm, head


def build_street_furniture():
    pole, arm, head = streetlight_prototype()
    z = ROAD_T + KERB_H
    for i in range(16):
        x = -ROAD_LEN / 2 + 18 + i * 17.5
        for sign in (1, -1):
            lamp = instance(f"Streetlight_{i}_{sign}", pole,
                            (x, sign * (KERB_Y + 1.2), z),
                            rot_z=0 if sign > 0 else math.pi)
            for src, tag in ((arm, "Arm"), (head, "Head")):
                child = instance(f"Streetlight_{tag}_{i}_{sign}", src, (0, 0, 0))
                child.parent = lamp
                child.matrix_parent_inverse = lamp.matrix_world.inverted()

    # Bollards along the Bank of Industry frontage.
    bollard = box("Bollard_src", -0.09, 0.09, -0.09, 0.09, 0, 0.95,
                  "ENV_Metal", "ENV_StreetFurniture")
    bollard.hide_render = bollard.hide_viewport = True
    for i in range(22):
        instance(f"Bollard_{i}", bollard,
                 (-30 + i * 4.0, KERB_Y + 1.0, z))

    # Bus shelter on the south pavement.
    sx, sy = -78.0, -(KERB_Y + 3.2)
    box("Shelter_Roof", sx - 4.0, sx + 4.0, sy - 1.5, sy + 1.5, 2.85, 3.0,
        "ENV_Accent_Blue", "ENV_StreetFurniture", bevel=0.05)
    box("Shelter_Back", sx - 4.0, sx + 4.0, sy - 1.5, sy - 1.35, 0.0, 2.85,
        "ENV_Glass", "ENV_StreetFurniture")
    for i in (-1, 1):
        box(f"Shelter_Post_{i}", sx + i * 3.85, sx + i * 3.95, sy + 1.35, sy + 1.45,
            0.0, 2.9, "ENV_Metal", "ENV_StreetFurniture")

    # Traffic signals at each crossing. They are in the reference, they explain
    # why the crossings are where they are, and they give the corridor the only
    # vertical punctuation it has between the streetlights.
    sig_pole = box("Signal_Pole_src", -0.08, 0.08, -0.08, 0.08, 0, 3.4,
                   "ENV_Metal", "ENV_StreetFurniture")
    sig_head = box("Signal_Head_src", -0.17, 0.17, -0.14, 0.14, 3.4, 4.25,
                   "ENV_Building_Shadow", "ENV_StreetFurniture", bevel=0.04)
    sig_lens = box("Signal_Lens_src", -0.10, 0.10, -0.16, -0.12, 3.52, 3.72,
                   "ENV_Network_Green", "ENV_StreetFurniture")
    for o in (sig_pole, sig_head, sig_lens):
        o.hide_render = o.hide_viewport = True
    for ci, cx in enumerate((-62.0, 4.0, 70.0)):
        for sign in (1, -1):
            for dx in (-4.6, 4.6):
                base = instance(f"Signal_{ci}_{sign}_{dx:+.0f}", sig_pole,
                                (cx + dx, sign * (KERB_Y + 0.9), z),
                                rot_z=0.0 if sign > 0 else math.pi)
                for src, tag in ((sig_head, "Head"), (sig_lens, "Lens")):
                    child = instance(f"Signal_{tag}_{ci}_{sign}_{dx:+.0f}", src, (0, 0, 0))
                    child.parent = base
                    child.matrix_parent_inverse = base.matrix_world.inverted()

    # Road signs.
    sign_post = box("Sign_Post_src", -0.06, 0.06, -0.06, 0.06, 0, 2.6,
                    "ENV_Metal", "ENV_StreetFurniture")
    sign_face = box("Sign_Face_src", -0.7, 0.7, -0.04, 0.04, 2.6, 3.5,
                    "ENV_Accent_Blue", "ENV_StreetFurniture", bevel=0.03)
    sign_post.hide_render = sign_post.hide_viewport = True
    sign_face.hide_render = sign_face.hide_viewport = True
    for i, (x, sign) in enumerate(((-60, 1), (10, -1), (62, 1), (-20, -1))):
        base = instance(f"Sign_Post_{i}", sign_post, (x, sign * (KERB_Y + 1.6), z))
        face = instance(f"Sign_Face_{i}", sign_face, (0, 0, 0))
        face.parent = base
        face.matrix_parent_inverse = base.matrix_world.inverted()


# ----------------------------------------------------------------- vehicles

# --- vehicles -------------------------------------------------------------
#
# Everything below builds ONE mesh per vehicle type with four material slots,
# rather than a parented pile of boxes. That matters twice over: the wheels and
# glass come along for free on every instance, and each vehicle in the scene is
# a single object instead of three or four.

VEH_BODY, VEH_GLASS, VEH_TYRE, VEH_ACCENT = 0, 1, 2, 3


def _prism_y(bm, profile_xz, y0, y1, mat_index):
    """Extrude an X-Z silhouette along Y and tag every face it creates."""
    verts = [bm.verts.new((x, y0, z)) for x, z in profile_xz]
    face = bm.faces.new(verts)
    bm.normal_update()
    ret = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0.0, y1 - y0, 0.0)), verts=moved)
    for f in bm.faces:
        if f.material_index == 0 and f not in ():
            pass
    made = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMFace)] + [face]
    for f in made:
        f.material_index = mat_index
    return made


def _wheel(bm, x, y, r, w, segments=10):
    before = set(bm.faces)
    bmesh.ops.create_cone(
        bm, cap_ends=True, segments=segments, radius1=r, radius2=r, depth=w,
        matrix=Matrix.Translation((x, y, r)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    for f in set(bm.faces) - before:
        f.material_index = VEH_TYRE


def _taper(verts, z_above, factor):
    """Pull the upper section in along Y so the roof is narrower than the sills.

    A car whose body is the same width top and bottom reads as an extruded
    rectangle from any angle. This is the cheapest possible fix — no extra
    geometry, and it is what gives the silhouette its shoulder.
    """
    for v in verts:
        if v.co.z > z_above:
            v.co.y *= factor


def vehicle_prototype(name, half_w, sections, wheel_x, wheel_r=0.36,
                      wheel_w=0.26, body_mat="ENV_Building_Hi"):
    """Build one vehicle mesh from a stack of extruded side profiles.

    Each section carries its own X extent, width fraction, material and taper,
    which is what lets a van be a white cab with a blue cargo box, and a bus be
    a skirt, a window band and a solid roof, without any of them becoming a
    separate object. One mesh per vehicle type; every instance in the scene is
    a single object that already has its wheels and glazing.
    """
    bm = bmesh.new()
    for profile, width_frac, mat_index, taper_above, taper_factor in sections:
        hw = half_w * width_frac
        faces = _prism_y(bm, profile, -hw, hw, mat_index)
        if taper_factor < 1.0:
            _taper({v for f in faces for v in f.verts}, taper_above, taper_factor)

    # Tuck the wheels under the bodywork. Centring them on the body edge leaves
    # half of each wheel sticking out past the flank, which reads as a fault
    # rather than a wheel.
    inset = half_w - wheel_w / 2 - 0.03
    for wx in wheel_x:
        for wy in (-inset, inset):
            _wheel(bm, wx, wy, wheel_r, wheel_w)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(f"{name}_src")
    bm.to_mesh(me)
    bm.free()

    for slot in (body_mat, "ENV_Glass", "ENV_Glass_Dark", "ENV_Accent_Blue"):
        me.materials.append(MATS[slot])

    ob = bpy.data.objects.new(f"{name}_src", me)
    link(ob, "ENV_Vehicles")
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def car_sections(length):
    """Saloon: dropped nose and tail, raked screens, roof over the middle."""
    hl = length / 2
    belt, roof = 0.94, 1.44
    lower = [
        (hl - 0.26, 0.42), (hl - 0.02, 0.60), (hl, belt - 0.14),
        (hl - 0.62, belt), (-hl + 0.66, belt), (-hl + 0.02, belt - 0.10),
        (-hl + 0.02, 0.58), (-hl + 0.28, 0.42),
    ]
    green = [
        (hl - 1.24, belt - 0.02), (hl - 1.78, roof),
        (-hl + 1.46, roof), (-hl + 1.00, belt - 0.02),
    ]
    return [(lower, 1.00, VEH_BODY, 0.78, 0.93),
            (green, 0.87, VEH_GLASS, 1.24, 0.90)]


def van_sections(length):
    """Panel van: white cab with a glazed screen, blue cargo box behind it."""
    hl = length / 2
    deck = 1.12
    skirt = [
        (hl - 0.24, 0.46), (hl, 0.68), (hl, deck),
        (-hl + 0.02, deck), (-hl + 0.02, 0.66), (-hl + 0.26, 0.46),
    ]
    cab = [(hl - 0.10, deck), (hl - 0.62, 1.98), (hl - 1.55, 1.98), (hl - 1.45, deck)]
    cargo = [(hl - 1.62, deck), (hl - 1.62, 2.24),
             (-hl + 0.06, 2.24), (-hl + 0.06, deck)]
    return [(skirt, 1.00, VEH_BODY, 0.80, 0.94),
            (cab, 0.92, VEH_GLASS, 1.60, 0.92),
            (cargo, 0.98, VEH_ACCENT, 2.00, 0.97)]


def bus_sections(length):
    """Bus: skirt, a continuous window band, then a solid roof.

    Glazing the whole upper body — which the first pass did — turns it into a
    wedge of glass with a sliver of paint underneath. Real buses read as a band.
    """
    hl = length / 2
    sill, head, roof = 1.18, 2.14, 2.62
    skirt = [
        (hl - 0.30, 0.46), (hl, 0.74), (hl, sill),
        (-hl + 0.02, sill), (-hl + 0.02, 0.72), (-hl + 0.32, 0.46),
    ]
    band = [(hl - 0.04, sill), (hl - 0.34, head),
            (-hl + 0.28, head), (-hl + 0.04, sill)]
    top = [(hl - 0.36, head), (hl - 0.86, roof),
           (-hl + 0.78, roof), (-hl + 0.30, head)]
    # Blue on the skirt, white above. An all-white bus of this size is a loaf —
    # at hero scale the window band alone is too close in value to the body to
    # separate it, and the accent is what makes it read as a vehicle in traffic.
    return [(skirt, 1.00, VEH_ACCENT, 0.80, 0.94),
            (band, 1.01, VEH_GLASS, 3.00, 1.0),
            (top, 0.96, VEH_BODY, 3.00, 1.0)]


def build_vehicles():
    car_l, van_l, bus_l = 4.5, 5.9, 10.6
    car = vehicle_prototype("Car", 0.90, car_sections(car_l),
                            wheel_x=(car_l / 2 - 1.05, -car_l / 2 + 1.05))
    van = vehicle_prototype("Van", 1.05, van_sections(van_l),
                            wheel_x=(van_l / 2 - 1.20, -van_l / 2 + 1.40),
                            wheel_r=0.42, wheel_w=0.30)
    bus = vehicle_prototype("Bus", 1.26, bus_sections(bus_l),
                            wheel_x=(bus_l / 2 - 1.7, -bus_l / 2 + 2.5),
                            wheel_r=0.50, wheel_w=0.34)

    z = ROAD_T
    placements = []
    for sign in (1, -1):
        for lane_i in range(LANES):
            y = sign * (MEDIAN_HW + LANE * (lane_i + 0.5))
            for k in range(9):
                x = -128 + k * 27 + lane_i * 9 + (0 if sign > 0 else 13)
                placements.append((x, y, 0.0 if sign > 0 else math.pi))

    car_blue = vehicle_prototype("CarBlue", 0.90, car_sections(car_l),
                                 wheel_x=(car_l / 2 - 1.05, -car_l / 2 + 1.05),
                                 body_mat="ENV_Accent_Blue")

    protos = [car, car, van, car_blue, car, bus, car, car_blue]
    for i, (x, y, rz) in enumerate(placements):
        instance(f"Vehicle_{i}", protos[i % len(protos)], (x, y, z),
                 rot_z=rz, coll="ENV_Vehicles")

    for i in range(8):
        instance(f"Vehicle_Parked_{i}", car,
                 (-70 + i * 4.6, -(KERB_Y + PAVE_W + 4.0), ROAD_T + KERB_H),
                 rot_z=math.pi / 2, coll="ENV_Vehicles")


# -------------------------------------------------------------- pedestrians

def pedestrian_prototype():
    """Deliberately abstract: a capsule and a head. At this scale anything more
    detailed reads as clutter and costs triangles the browser has to carry."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.20,
                          radius2=0.15, depth=1.25)
    bmesh.ops.translate(bm, vec=Vector((0, 0, 0.63)), verts=bm.verts)
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.135,
                               matrix=Matrix.Translation((0, 0, 1.42)))
    me = bpy.data.meshes.new("Pedestrian_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Pedestrian_src", me)
    ob.data.materials.append(MATS["ENV_Building_Shadow"])
    link(ob, "ENV_Pedestrians")
    ob.hide_render = ob.hide_viewport = True
    return ob


def build_pedestrians():
    src = pedestrian_prototype()
    z = ROAD_T + KERB_H
    spots = []
    for i in range(34):
        spots.append((-104 + i * 6.2, KERB_Y + 2.0 + (i % 4) * 1.5))
    for i in range(30):
        spots.append((-110 + i * 7.0, -(KERB_Y + 2.2 + (i % 4) * 1.4)))
    for i, (x, y) in enumerate(spots):
        instance(f"Pedestrian_{i}", src, (x, y, z),
                 rot_z=(i * 1.7) % math.tau, coll="ENV_Pedestrians")


# ------------------------------------------------------------- LP12 anchors

def build_anchors():
    """The LP12 is never merged into the environment — the application shows,
    hides, highlights or replaces it independently, so it only gets a frame to
    stand in."""
    anchor = bpy.data.objects.new("LP12_INSTALL_ANCHOR", None)
    anchor.empty_display_type = "ARROWS"
    anchor.empty_display_size = 3.0
    # On the pavement in front of the Bank of Industry, clear of the fence line.
    anchor.location = (18.0, KERB_Y + 2.2, ROAD_T + KERB_H)
    # +Y is the antenna's intended front: it faces across the carriageway,
    # which is the direction the coverage has to reach.
    anchor.rotation_euler = (0.0, 0.0, math.pi)
    link(anchor, "ENV_LP12_Anchor")

    dome = bpy.data.objects.new("NETWORK_DOME_ORIGIN", None)
    dome.empty_display_type = "SPHERE"
    dome.empty_display_size = 6.0
    # At the antenna's working height, so the application can centre a sphere
    # on it directly. Never a cone.
    dome.location = (18.0, KERB_Y + 2.2, ROAD_T + KERB_H + 7.5)
    link(dome, "ENV_LP12_Anchor")
    return anchor, dome


# ----------------------------------------------------------------- cameras

def build_cameras(dome_origin):
    cam_data = bpy.data.cameras.new("CAM_ENV_ISOMETRIC")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 190.0
    cam_data.clip_start = 1.0
    cam_data.clip_end = 900.0
    cam = bpy.data.objects.new("CAM_ENV_ISOMETRIC", cam_data)
    # Elevation and swing from the brief. The swing is what puts the boulevard
    # on the upper-left to lower-right diagonal of the reference.
    rot_x, rot_z = math.radians(58.0), math.radians(45.0)
    cam.rotation_euler = (rot_x, 0.0, rot_z)

    # Blender composes XYZ euler as Rz@Ry@Rx and the camera looks down its local
    # -Z, so the view direction is (-sin z sin x, cos z sin x, -cos x). Standing
    # the camera off along the negative of that is what puts the target in the
    # middle of frame; getting the first component's sign wrong aims it at empty
    # sky behind the scene, which is silent — the render is simply blank.
    aim = Vector((0.0, 6.0, 6.0))
    view = Vector((
        -math.sin(rot_z) * math.sin(rot_x),
        math.cos(rot_z) * math.sin(rot_x),
        -math.cos(rot_x),
    ))
    cam.location = aim - view * 260.0
    link(cam, "ENV_Cameras")

    ctx_data = bpy.data.cameras.new("CAM_LP12_CONTEXT")
    ctx_data.lens = 42.0
    ctx_data.clip_start = 0.1
    ctx_data.clip_end = 600.0
    ctx = bpy.data.objects.new("CAM_LP12_CONTEXT", ctx_data)
    # Far enough back and high enough that the boulevard, the anchor's pavement
    # and the landmark all sit in frame. Closer than this and the building
    # facade simply fills it, which is what the first placement did.
    ctx.location = (-30.0, -52.0, 30.0)
    link(ctx, "ENV_Cameras")
    track = ctx.constraints.new("TRACK_TO")
    track.target = dome_origin        # antenna height: the pole reads full length
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    bpy.context.scene.camera = cam
    return cam, ctx


# ---------------------------------------------------------------- lighting

def build_lighting():
    world = bpy.data.worlds.new("ENV_World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = hex_rgba("#E9EDF3")
    bg.inputs["Strength"].default_value = 0.75
    bpy.context.scene.world = world

    sun_data = bpy.data.lights.new("ENV_Key_Sun", "SUN")
    sun_data.energy = 1.9
    sun_data.angle = math.radians(8.0)
    sun_data.color = hex_rgba("#FFF7EA")[:3]
    sun = bpy.data.objects.new("ENV_Key_Sun", sun_data)
    sun.rotation_euler = (math.radians(25.0), math.radians(-20.0), math.radians(135.0))
    sun.location = (0, 0, 90)
    link(sun, "ENV_Lighting")

    fill_data = bpy.data.lights.new("ENV_Fill_Area", "AREA")
    fill_data.shape = "SQUARE"
    fill_data.size = 26.0
    fill_data.energy = 900.0
    fill_data.color = hex_rgba("#E6F0FF")[:3]
    fill = bpy.data.objects.new("ENV_Fill_Area", fill_data)
    fill.location = (95.0, -95.0, 58.0)
    fill.rotation_euler = (math.radians(52.0), 0.0, math.radians(-135.0 + 180))
    link(fill, "ENV_Lighting")

    # Soft rim so the landmark's silhouette separates from the pale world.
    rim_data = bpy.data.lights.new("ENV_Rim_Area", "AREA")
    rim_data.shape = "RECTANGLE"
    rim_data.size, rim_data.size_y = 70.0, 26.0
    rim_data.energy = 480.0
    rim_data.color = hex_rgba("#FFFFFF")[:3]
    rim = bpy.data.objects.new("ENV_Rim_Area", rim_data)
    rim.location = (30.0, 96.0, 34.0)
    rim.rotation_euler = (math.radians(74.0), 0.0, math.radians(180.0))
    link(rim, "ENV_Lighting")


# --------------------------------------------------------- render settings

def configure_render():
    scn = bpy.context.scene
    # This build exposes EEVEE under a version-dependent id, so pick whichever
    # of the known names the enum actually offers rather than guessing.
    engines = scn.bl_rna.properties["render"].fixed_type.properties["engine"].enum_items.keys() \
        if False else None
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scn.render.engine = candidate
            break
        except (TypeError, ValueError):
            continue
    print("  engine:", scn.render.engine)

    ee = scn.eevee
    for attr, value in (("use_gtao", True), ("gtao_distance", 1.4),
                        ("use_shadows", True), ("use_soft_shadows", True),
                        ("use_raytracing", True), ("use_bloom", False),
                        ("use_motion_blur", False), ("taa_render_samples", 96),
                        ("shadow_ray_count", 2), ("shadow_step_count", 6)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, value)
            except (TypeError, ValueError):
                pass

    scn.render.use_motion_blur = False
    scn.render.film_transparent = False
    scn.render.resolution_x = 1920
    scn.render.resolution_y = 1080
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = "PNG"

    scn.view_settings.view_transform = "AgX"
    for look in ("AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            scn.view_settings.look = look
            break
        except (TypeError, ValueError):
            continue
    scn.view_settings.exposure = 0.2
    print("  view transform:", scn.view_settings.view_transform,
          "| look:", scn.view_settings.look)

    # Contact shadows on every light, which is most of what makes the objects
    # sit on the ground rather than float above it.
    for ob in bpy.data.objects:
        if ob.type == "LIGHT" and hasattr(ob.data, "use_shadow_jitter"):
            pass
        if ob.type == "LIGHT":
            for attr in ("use_contact_shadow", "use_shadow"):
                if hasattr(ob.data, attr):
                    try:
                        setattr(ob.data, attr, True)
                    except (TypeError, ValueError):
                        pass


# ------------------------------------------------------------------- report

def triangle_count():
    deps = bpy.context.evaluated_depsgraph_get()
    total = 0
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH" or ob.hide_render:
            continue
        eval_ob = ob.evaluated_get(deps)
        me = eval_ob.to_mesh()
        if me is None:
            continue
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        eval_ob.to_mesh_clear()
    return total


def report():
    print("\n--- scene report ---")
    for name in COLLECTIONS:
        coll = bpy.data.collections.get(name)
        print(f"  {name:26} {len(coll.objects):4d} objects")
    tris = triangle_count()
    print(f"  triangles (render-visible)  {tris:,}")
    print(f"  materials                   {len(bpy.data.materials)}")
    print(f"  meshes (unique data)        {len(bpy.data.meshes)}")
    return tris


# --------------------------------------------------------------------- main

def main():
    global COLL
    wipe()
    COLL = make_collections()
    build_materials()

    build_ground()
    build_roads()
    build_markings()
    build_pavements()
    build_bank_of_industry()
    build_native_supply()
    build_secondary()
    build_plots()
    build_vegetation()
    build_street_furniture()
    build_vehicles()
    build_pedestrians()
    _, dome = build_anchors()
    build_cameras(dome)
    build_lighting()
    configure_render()

    tris = report()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("saved:", BLEND_PATH)
    return tris


if __name__ == "__main__":
    main()
