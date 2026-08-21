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
from mathutils import Euler, Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, ".."))
BLEND_PATH = os.path.join(OUT, "awolowo_lowpoly_env.blend")
GLB_PATH = os.path.join(OUT, "awolowo_lowpoly_env.glb")
RENDER_DIR = os.path.join(OUT, "env_lowpoly_renders")
LP12_GLB = os.path.abspath(os.path.join(
    HERE, "..", "..", "field-master-sim", "public", "models", "lp12_v2.glb"))

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

LP12_ANCHOR_X = 18.0        # along the boulevard, opposite the BOI entrance
MEDIAN_COLUMN_H = 12.5      # matches the LP12 host pole at 12.755 m

COLLECTIONS = [
    "ENV_Ground", "ENV_Roads", "ENV_Buildings_Main", "ENV_Buildings_Secondary",
    "ENV_Pavements", "ENV_StreetFurniture", "ENV_Vegetation", "ENV_Vehicles",
    "ENV_Pedestrians", "ENV_LP12_Anchor", "ENV_Lighting", "ENV_Cameras",
    "LP12_POLE",
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
            # A mullion splitting the bay, and a sill projecting from its foot.
            # Both are what stop a window reading as a painted rectangle: the
            # mullion gives the opening a scale to be read against, the sill
            # catches a highlight and casts the small shadow that says the wall
            # has thickness.
            my0, my1 = sorted((y_face - out * 0.32, y_face - out * 0.06))
            box(f"{name}_Mull_{s}_{b}", cx - 0.045, cx + 0.045, my0, my1,
                z0 + 0.05, z1 - 0.05, "ENV_Building_Hi", coll)
            sy0, sy1 = sorted((y_face - out * 0.34, y_face + out * 0.10))
            box(f"{name}_Sill_{s}_{b}", bx0 - 0.08, bx1 + 0.08, sy0, sy1,
                z0 - 0.10, z0 + 0.02, "ENV_Building_Hi", coll)


def floor_bands(name, x0, x1, y0, y1, storeys, base_z, storey_h, coll):
    """Slab bands expressed on the facade between window rows.

    Horizontal expression is half of how a building is read at distance; with
    only vertical bays the mass looks like a punched card. The band projects a
    few centimetres so it carries its own shadow line.
    """
    for s in range(1, storeys):
        z = base_z + s * storey_h
        box(f"{name}_Band_{s}", x0 - 0.12, x1 + 0.12, y0 - 0.12, y1 + 0.12,
            z - 0.16, z + 0.10, "ENV_Building_Hi", coll, bevel=0.03)


def roofscape(name, cx, cy, w, d, roof_z, coll, cores=1, tanks=2, railing=True):
    """What actually sits on a flat roof: a stair core, water tanks, a railing
    and an aerial. Modelled because from a 58-degree camera the roof is one of
    the largest visible surfaces on every building in the scene."""
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - d / 2, cy + d / 2

    if railing:
        # Four thin rails set in from the parapet.
        r_in = 1.1
        for tag, (rx0, rx1, ry0, ry1) in (
                ("N", (x0 + r_in, x1 - r_in, y1 - r_in - 0.08, y1 - r_in)),
                ("S", (x0 + r_in, x1 - r_in, y0 + r_in, y0 + r_in + 0.08)),
                ("E", (x1 - r_in - 0.08, x1 - r_in, y0 + r_in, y1 - r_in)),
                ("W", (x0 + r_in, x0 + r_in + 0.08, y0 + r_in, y1 - r_in))):
            box(f"{name}_Rail_{tag}", rx0, rx1, ry0, ry1,
                roof_z + 0.95, roof_z + 1.05, "ENV_Metal", coll)

    for c in range(cores):
        sx = cx - w / 4 + c * (w / 2)
        box(f"{name}_Core_{c}", sx - 2.6, sx + 2.6, cy - 2.2, cy + 2.2,
            roof_z, roof_z + 3.0, "ENV_Building", coll, bevel=0.05)
        box(f"{name}_Core_Cap_{c}", sx - 2.9, sx + 2.9, cy - 2.5, cy + 2.5,
            roof_z + 3.0, roof_z + 3.25, "ENV_Building_Hi", coll, bevel=0.04)

    for t in range(tanks):
        tx = x0 + w * (0.22 + 0.42 * t)
        ty = y1 - d * 0.26
        # Tank on a short cradle, so it stands off the roof deck.
        for i in (-1, 1):
            box(f"{name}_Tank_Leg_{t}_{i}", tx + i * 0.75 - 0.10, tx + i * 0.75 + 0.10,
                ty - 0.10, ty + 0.10, roof_z, roof_z + 0.75, "ENV_Metal", coll)
        box(f"{name}_Tank_{t}", tx - 1.0, tx + 1.0, ty - 0.85, ty + 0.85,
            roof_z + 0.75, roof_z + 2.05, "ENV_Building_Hi", coll, bevel=0.12)

    # Aerial mast with two cross-arms.
    ax, ay = x1 - w * 0.14, y0 + d * 0.24
    box(f"{name}_Mast", ax - 0.06, ax + 0.06, ay - 0.06, ay + 0.06,
        roof_z, roof_z + 4.2, "ENV_Metal", coll)
    for k, zz in enumerate((roof_z + 3.1, roof_z + 3.7)):
        arm = 0.85 - k * 0.25
        box(f"{name}_Mast_Arm_{k}", ax - arm, ax + arm, ay - 0.05, ay + 0.05,
            zz, zz + 0.08, "ENV_Metal", coll)


def shopfront(name, x0, x1, y_face, out, coll, head=3.6, recess=0.9):
    """A recessed ground floor with a canopy over it.

    A flat box stuck on the wall is not an entrance. Pulling the glass back and
    oversailing it with a canopy gives the base of the building a shadow, which
    is what separates it from the pavement it stands on.
    """
    gy = y_face - out * recess
    gy0, gy1 = sorted((gy, gy + out * 0.18))
    box(f"{name}_Shop_Glass", x0, x1, gy0, gy1, 0.15, head, "ENV_Glass_Dark", coll)
    # Reveal walls at each end of the recess.
    for i, ex in enumerate((x0, x1)):
        ry0, ry1 = sorted((y_face, gy))
        box(f"{name}_Shop_Reveal_{i}", ex - 0.18, ex + 0.18, ry0, ry1,
            0.0, head + 0.25, "ENV_Building", coll)
    cy0, cy1 = sorted((y_face + out * 1.05, gy))
    box(f"{name}_Shop_Canopy", x0 - 0.5, x1 + 0.5, cy0, cy1,
        head, head + 0.26, "ENV_Building_Hi", coll, bevel=0.05)
    for k in range(max(2, int((x1 - x0) / 5.0))):
        px = x0 + 0.6 + k * ((x1 - x0 - 1.2) / max(1, int((x1 - x0) / 5.0) - 1)) \
            if int((x1 - x0) / 5.0) > 1 else (x0 + x1) / 2
        py0, py1 = sorted((y_face + out * 0.95, y_face + out * 0.85))
        box(f"{name}_Shop_Post_{k}", px - 0.09, px + 0.09, py0, py1,
            0.0, head, "ENV_Building_Hi", coll)


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
    floor_bands("BOI", x0, x1, y0, y1, storeys, 0.0, storey_h, "ENV_Buildings_Main")

    # Stepped upper mass. A seven-storey slab of one section is the single
    # biggest reason a block reads as an extrusion; setting the top floors back
    # gives the landmark a profile from every direction.
    sb = 3.2
    step_z = storey_h * 5
    box("BOI_Upper_Mass", x0 + sb, x1 - sb, y0 + sb, y1 - sb, step_z, h + 2.6,
        "ENV_Building", "ENV_Buildings_Main", bevel=0.08)
    box("BOI_Upper_Coping", x0 + sb - 0.4, x1 - sb + 0.4, y0 + sb - 0.4, y1 - sb + 0.4,
        h + 2.6, h + 3.0, "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.05)
    storey_windows("BOI_Up", x0 + sb + 2, x1 - sb - 2, y0 + sb, -1.0, 2,
                   step_z, storey_h, "ENV_Buildings_Main")

    roofscape("BOI", cx, cy, w, d, h + 1.1, "ENV_Buildings_Main", cores=2, tanks=3)
    roofscape("BOI_Up", cx, cy, w - 2 * sb, d - 2 * sb, h + 3.0,
              "ENV_Buildings_Main", cores=0, tanks=1, railing=False)

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
        shopfront(f"NS_{tag}", x0 + 2.5, x1 - 2.5, fy, out,
                  "ENV_Buildings_Main", head=5.4, recess=1.3)
        storey_windows(f"NS_Upper_{tag}", x0 + 3, x1 - 3, fy, out, 1, 7.0, 3.4,
                       "ENV_Buildings_Main")
        # Blank sign panel — kept untextured so the application supplies the
        # identification rather than the mesh baking it in.
        box(f"NS_Sign_Panel_{tag}", cx - 12, cx + 12,
            fy + 0.06 * out, fy + 0.22 * out, 7.6, 9.0,
            "ENV_Building_Hi", "ENV_Buildings_Main", bevel=0.03)

    floor_bands("NS", x0, x1, y0, y1, 3, 0.0, h / 3.0, "ENV_Buildings_Main")
    roofscape("NS", cx, cy, w, d, h + 0.9, "ENV_Buildings_Main", cores=1, tanks=2)
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
    ("Sec_S_E",     4.0, -58.0, 24.0, 15.0, 6.5, 2),
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


# The studio camera anchors, expressed in this scene's frame. CAM_01 and CAM_09
# stand 30 and 33 m out from the median — past the 20.2 m pavement edge and into
# the plots — so a building placed on the frontage there ends up with the camera
# inside its parapet, which renders as a flat grey wall and nothing else.
#
# The anchors are not negotiable: they are authored in Blender and the
# simulation's camera moves are built on them. The buildings move instead.
CAMERA_ANCHORS_XY = [
    (6.8, -29.8),      # CAM_01_FULL_POLE
    (5.6, -33.0),      # CAM_09_COMPLETE
]
POLE_XY = (LP12_ANCHOR_X, 0.0)
CAMERA_CLEARANCE = 9.0


def _segment_hits_rect(p0, p1, rect, pad):
    """Does the sight line from camera to pole cross this footprint?"""
    x0, x1, y0, y1 = rect[0] - pad, rect[1] + pad, rect[2] - pad, rect[3] + pad
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, p0[0] - x0), (dx, x1 - p0[0]),
                 (-dy, p0[1] - y0), (dy, y1 - p0[1])):
        if p == 0:
            if q < 0:
                return False
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return False
            t0 = max(t0, r)
        else:
            if r < t0:
                return False
            t1 = min(t1, r)
    return t0 <= t1


def _dist_point_segment(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def blocks_camera(x, y, pad):
    """Would something standing here get between a wide anchor and the pole?

    The buildings were the obvious offenders, but a 10 m street tree on the
    verge sits squarely across the CAM_01 sight line and hides the very pole the
    learner is being shown. Anything tall enough to matter has to ask this
    before it is placed.
    """
    for cam in CAMERA_ANCHORS_XY:
        if _dist_point_segment(x, y, cam, POLE_XY) < pad:
            return True
    return False


def check_camera_sightlines():
    """Fail the build if a building stands in a camera or blocks its view.

    This is a guard, not a fix. Moving one block by hand solves it today; the
    next time the plot table is edited nobody will remember that two of the ten
    anchors sit outside the road corridor, and the failure mode is silent — the
    simulation just renders a flat grey wall.
    """
    problems = []
    for name, cx, cy, w, d, _h, _s in SECONDARY:
        rect = (cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2)
        for i, cam in enumerate(CAMERA_ANCHORS_XY):
            inside = (rect[0] - CAMERA_CLEARANCE <= cam[0] <= rect[1] + CAMERA_CLEARANCE
                      and rect[2] - CAMERA_CLEARANCE <= cam[1] <= rect[3] + CAMERA_CLEARANCE)
            if inside:
                problems.append(f"{name} contains camera anchor {i}")
            elif _segment_hits_rect(cam, POLE_XY, rect, 1.0):
                problems.append(f"{name} blocks the view from camera anchor {i}")
    if problems:
        raise SystemExit("camera sight-line check failed:\n  " + "\n  ".join(problems))
    print(f"  camera sight-lines clear for {len(CAMERA_ANCHORS_XY)} wide anchors")


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
        floor_bands(name, x0, x1, y0, y1, storeys, 0.0, h / max(storeys, 1),
                    "ENV_Buildings_Secondary")
        if storeys >= 3:
            sb = 2.2
            box(f"{name}_Upper", x0 + sb, x1 - sb, y0 + sb, y1 - sb,
                h * 0.62, h + 1.9, "ENV_Building", "ENV_Buildings_Secondary",
                bevel=0.06)
        roofscape(name, cx, cy, w, d, h + 0.8, "ENV_Buildings_Secondary",
                  cores=1 if storeys >= 3 else 0, tanks=1 + (storeys >= 3),
                  railing=storeys >= 2)
        front_y, front_out = (y0, -1.0) if cy > 0 else (y1, 1.0)
        shopfront(name, x0 + 2.0, x1 - 2.0, front_y, front_out,
                  "ENV_Buildings_Secondary", head=3.4, recess=0.85)

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




# -------------------------------------------------------------- vegetation

def _tapered_trunk(bm, height, r_base, r_top, sides, lean, mat_index=0):
    """A trunk built from stacked rings rather than one cone.

    Rings let the trunk lean and bow as it rises, which is most of what makes a
    trunk read as grown rather than extruded. A single cone cannot bend.
    """
    rings = 5
    prev = None
    for i in range(rings + 1):
        t = i / rings
        z = height * t
        r = r_base + (r_top - r_base) * t
        # Bow out then back, plus a steady lean, so no two rings share an axis.
        off_x = lean * (t ** 1.5) + 0.10 * math.sin(t * math.pi)
        ring = []
        for k in range(sides):
            a = (k / sides) * math.tau
            ring.append(bm.verts.new((off_x + r * math.cos(a), r * math.sin(a), z)))
        if prev:
            for k in range(sides):
                bm.faces.new((prev[k], prev[(k + 1) % sides],
                              ring[(k + 1) % sides], ring[k]))
        prev = ring
    bm.faces.new(prev)                       # cap the crown
    return (lean + 0.10 * math.sin(math.pi), 0.0, height)


def _rng(seed):
    """Deterministic noise. A tree that rebuilds differently every run makes the
    scene impossible to review against a previous render."""
    state = seed * 2654435761 % 4294967296

    def nxt():
        nonlocal state
        state = (state * 1664525 + 1013904223) % 4294967296
        return state / 4294967296
    return nxt


def _leaf(bm, pos, size, yaw, pitch, roll):
    """One flat leaf card."""
    m = (Matrix.Translation(pos)
         @ Euler((pitch, roll, yaw), "XYZ").to_matrix().to_4x4())
    hw, hl = size * 0.46, size * 0.62
    quad = [bm.verts.new(m @ Vector(p)) for p in
            ((-hw, -hl, 0.0), (hw, -hl, 0.0), (hw, hl, 0.0), (-hw, hl, 0.0))]
    bm.faces.new(quad)


def broadleaf_prototype(name="Tree", height=10.7, leaves=560, seed=0):
    """A tall, narrow street tree whose canopy is built from scattered leaf cards.

    The previous version stacked a few icospheres, which from any distance is a
    green blob on a stick — it has a silhouette but no texture, and it cannot
    catch light unevenly because every normal points outward from one centre.

    Scattering flat cards fixes both at once. Each leaf faces its own way, so a
    single directional light produces the light-and-dark mottling across the
    canopy on its own, with no second material and no departure from the locked
    palette. It also gives the crown a broken edge instead of a clean arc, which
    is what stops a row of these reading as lollipops.

    The form is deliberately columnar rather than round: a spreading crown over
    a 26 m carriageway would swallow the road in the isometric, and the street
    trees along a boulevard like this one are pruned upright anyway.
    """
    rnd = _rng(seed + 17)
    bm = bmesh.new()

    # Trunk carries on up through the canopy as a central leader rather than
    # stopping where the leaves start — the reference shows it clearly.
    _tapered_trunk(bm, height * 0.97, r_base=0.15, r_top=0.022, sides=7,
                   lean=0.16 + 0.10 * rnd())

    canopy_base = height * 0.33
    canopy_top = height * 1.0
    span = canopy_top - canopy_base
    max_r = height * 0.128

    for _ in range(leaves):
        # Bias t toward the middle so the crown is dense at the waist and
        # thins toward the tip, like the reference.
        t = (rnd() + rnd() + rnd()) / 3.0
        z = canopy_base + span * t
        # Spindle: widest a little below halfway, tapering to a point.
        prof = math.sin(math.pi * min(t ** 0.78, 1.0)) ** 0.85
        r_here = max_r * prof
        # Cluster toward the leader, with a few leaves flung out to break the
        # silhouette.
        rr = r_here * (rnd() ** 0.55) * (1.0 + 0.35 * (rnd() > 0.88))
        a = rnd() * math.tau
        pos = Vector((math.cos(a) * rr + 0.16 * (z / height) ** 1.5,
                      math.sin(a) * rr,
                      z + (rnd() - 0.5) * 0.25))
        # Leaves hang outward and down rather than sitting at fully random
        # angles: a canopy of evenly-random cards has no gravity in it.
        _leaf(bm, pos,
              size=0.20 + rnd() * 0.15,
              yaw=rnd() * math.tau,
              pitch=-0.55 + (rnd() - 0.5) * 1.9,
              roll=(rnd() - 0.5) * 2.0)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(f"{name}_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(f"{name}_src", me)
    ob.data.materials.append(MATS["ENV_Vegetation"])
    link(ob, "ENV_Vegetation")
    ob.hide_render = ob.hide_viewport = True
    return ob


def shrub_prototype():
    """Three overlapping lobes, not one squashed sphere — a shrub has a
    silhouette, and a single ellipsoid reads as a pebble."""
    bm = bmesh.new()
    for dx, dy, dz, r in ((0.0, 0.0, 0.0, 0.88), (0.62, 0.22, -0.16, 0.62),
                          (-0.48, -0.34, -0.20, 0.55)):
        bmesh.ops.create_icosphere(
            bm, subdivisions=1, radius=r,
            matrix=Matrix.Translation((dx, dy, dz)))
    for v in bm.verts:
        v.co.z = max(v.co.z * 0.62, -0.05)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("Shrub_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Shrub_src", me)
    ob.data.materials.append(MATS["ENV_Vegetation"])
    link(ob, "ENV_Vegetation")
    ob.hide_render = ob.hide_viewport = True
    return ob


def tree_pit_prototype():
    """The square grate a street tree stands in. Small, but without it every
    trunk pierces the paving with no transition."""
    z = ROAD_T + KERB_H
    ob = box("Tree_Pit_src", -0.85, 0.85, -0.85, 0.85, z - 0.06, z + 0.02,
             "ENV_Building_Shadow", "ENV_Vegetation", bevel=0.03)
    ob.hide_render = ob.hide_viewport = True
    return ob


def build_vegetation():
    """Every tree in the scene is now the leaf-card type.

    Five variants rather than three, because the palms they replace were on the
    verge, the median and the plots — three assets stamped along 280 m of
    boulevard would read as a repeating pattern where the palms, being wider
    apart and more irregular, did not.

    The median gets the two short variants. A 12 m crown on a 4.5 m median would
    close over the carriageway and hide the traffic the scene exists to show.
    """
    trees = [
        broadleaf_prototype("Tree_A", height=10.7, leaves=560, seed=0),
        broadleaf_prototype("Tree_B", height=8.9, leaves=430, seed=1),
        broadleaf_prototype("Tree_C", height=12.2, leaves=650, seed=2),
        broadleaf_prototype("Tree_D", height=9.8, leaves=490, seed=3),
        broadleaf_prototype("Tree_E", height=7.6, leaves=360, seed=4),
    ]
    short = [trees[4], trees[1]]
    shrub = shrub_prototype()
    pit = tree_pit_prototype()
    z = ROAD_T + KERB_H
    idx = 0

    # Street trees along both pavements, spacing varied enough that the rhythm
    # does not read as a stamped array.
    for sign in (1, -1):
        y = sign * (KERB_Y + 2.6)
        x = -ROAD_LEN / 2 + 14
        while x < ROAD_LEN / 2 - 14:
            # A canopy this size across the CAM_01 sight line hides the pole.
            if not blocks_camera(x, y, 6.0):
                instance(f"Street_Tree_{idx}", trees[idx % 5], (x, y, z),
                         rot_z=(idx * 1.13) % math.tau, coll="ENV_Vegetation",
                         scale=0.92 + 0.16 * ((idx * 7) % 5) / 5)
                instance(f"Street_Tree_Pit_{idx}", pit, (x, y, 0.0),
                         coll="ENV_Vegetation")
            x += 17.0 + 4.0 * ((idx * 3) % 3)
            idx += 1

    # Median planting, deliberately the small variants and cut back in scale.
    for i in range(14):
        x = -ROAD_LEN / 2 + 22 + i * 18.0
        # Keep clear of the LP12 host pole and its reserved bay: a tree growing
        # through the antenna is not something the isometric would forgive.
        if abs(x - LP12_ANCHOR_X) < 12.0:
            continue
        instance(f"Median_Tree_{i}", short[i % 2], (x, 0.0, ROAD_T + KERB_H + 0.5),
                 rot_z=(i * 0.7) % math.tau, coll="ENV_Vegetation", scale=0.62)

    # Trees on the building plots, so planting is not confined to the kerb line.
    for i, (name, cx, cy, w, d, _h, _s) in enumerate(SECONDARY):
        for k in range(3):
            px = cx - w / 2 - 3.5 + k * ((w + 7.0) / 2)
            py = cy + (d / 2 + 3.4) * (1 if cy < 0 else -1)
            if blocks_camera(px, py, 6.0):
                continue
            instance(f"Plot_Tree_{i}_{k}", trees[(i * 3 + k) % 5], (px, py, z),
                     rot_z=(i * 0.9 + k) % math.tau, coll="ENV_Vegetation",
                     scale=0.80 + 0.18 * (k % 2))
            instance(f"Plot_Tree_Pit_{i}_{k}", pit, (px, py, 0.0),
                     coll="ENV_Vegetation")

    for i in range(78):
        ang = (i * 2.399)
        r = 40 + (i % 7) * 12
        x = math.cos(ang) * r * 1.6
        y = math.sin(ang) * r
        if abs(y) < KERB_Y + PAVE_W + 2:
            continue
        if TRENCH_X[0] - 3 < x < TRENCH_X[1] + 3 and TRENCH_Y[0] < y < TRENCH_Y[1]:
            continue                       # never scatter into the cutting
        if blocks_camera(x, y, 3.0):
            continue
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


def median_column_prototype():
    """The tall twin-arm lighting column that runs down the central median.

    This is the pole the LP12 is mounted on in background.png: planted in the
    median hedge, one lamp reaching out over each carriageway. The kerbside
    lights stay at 8 m, which gives the corridor a lighting hierarchy — and
    more to the point, an 8 m kerbside lamp was the tallest pole in the scene,
    so the 12.755 m LP12 stood a head and shoulders above everything around it
    and read as the wrong scale.
    """
    bm = bmesh.new()
    _tapered_trunk(bm, MEDIAN_COLUMN_H, r_base=0.22, r_top=0.11, sides=8, lean=0.0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("Median_Column_src")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Median_Column_src", me)
    ob.data.materials.append(MATS["ENV_Metal"])
    link(ob, "ENV_StreetFurniture")

    # Two arms and two heads, one over each carriageway.
    parts = []
    for i, sign in enumerate((1, -1)):
        arm = box(f"Median_Arm_{i}_src", -0.07, 0.07, min(0, sign * 2.6),
                  max(0, sign * 2.6), MEDIAN_COLUMN_H - 0.55, MEDIAN_COLUMN_H - 0.41,
                  "ENV_Metal", "ENV_StreetFurniture")
        head = box(f"Median_Head_{i}_src", -0.22, 0.22,
                   min(sign * 2.35, sign * 3.15), max(sign * 2.35, sign * 3.15),
                   MEDIAN_COLUMN_H - 0.72, MEDIAN_COLUMN_H - 0.50,
                   "ENV_Building_Hi", "ENV_StreetFurniture", bevel=0.03)
        parts += [arm, head]
    for o in [ob] + parts:
        o.hide_render = o.hide_viewport = True
    return ob, parts


def build_street_furniture():
    pole, arm, head = streetlight_prototype()
    z = ROAD_T + KERB_H
    for i in range(16):
        x = -ROAD_LEN / 2 + 18 + i * 17.5
        for sign in (1, -1):
            if blocks_camera(x, sign * (KERB_Y + 1.2), 3.0):
                continue
            lamp = instance(f"Streetlight_{i}_{sign}", pole,
                            (x, sign * (KERB_Y + 1.2), z),
                            rot_z=0 if sign > 0 else math.pi)
            for src, tag in ((arm, "Arm"), (head, "Head")):
                child = instance(f"Streetlight_{tag}_{i}_{sign}", src, (0, 0, 0))
                child.parent = lamp
                child.matrix_parent_inverse = lamp.matrix_world.inverted()

    # Twin-arm columns down the median. One position is deliberately left empty:
    # the LP12 is mounted on the column that would stand there, and two poles in
    # the same spot is the sort of thing nobody notices until it is rendered.
    col, col_parts = median_column_prototype()
    med_z = ROAD_T + KERB_H
    for i in range(9):
        x = -ROAD_LEN / 2 + 26 + i * 32.0
        if abs(x - LP12_ANCHOR_X) < 16.0:
            continue                       # reserved for the LP12 host pole
        base = instance(f"Median_Column_{i}", col, (x, 0.0, med_z))
        for j, src in enumerate(col_parts):
            child = instance(f"Median_Column_{i}_p{j}", src, (0, 0, 0))
            child.parent = base
            child.matrix_parent_inverse = base.matrix_world.inverted()

    # Bollards along the Bank of Industry frontage.
    bollard = box("Bollard_src", -0.09, 0.09, -0.09, 0.09, 0, 0.95,
                  "ENV_Metal", "ENV_StreetFurniture")
    bollard.hide_render = bollard.hide_viewport = True
    for i in range(22):
        bx_, by_ = -30 + i * 4.0, KERB_Y + 1.0
        if blocks_camera(bx_, by_, 1.6):
            continue
        instance(f"Bollard_{i}", bollard, (bx_, by_, z))

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
                if blocks_camera(cx + dx, sign * (KERB_Y + 0.9), 2.6):
                    continue
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
    # On the central median, in the planted strip — which is where the host pole
    # actually stands in background.png. The written brief said "on the
    # pavement", but the photograph it points at shows a twin-arm column planted
    # in the median hedge with a lamp over each carriageway, and the photograph
    # is what the layout has to match.
    anchor.location = (LP12_ANCHOR_X, 0.0, ROAD_T + KERB_H)
    # +Y is the antenna's intended front: it faces across the carriageway,
    # which is the direction the coverage has to reach.
    anchor.rotation_euler = (0.0, 0.0, math.pi)
    link(anchor, "ENV_LP12_Anchor")

    dome = bpy.data.objects.new("NETWORK_DOME_ORIGIN", None)
    dome.empty_display_type = "SPHERE"
    dome.empty_display_size = 6.0
    # At the antenna's working height, so the application can centre a sphere
    # on it directly. Never a cone.
    dome.location = (LP12_ANCHOR_X, 0.0, ROAD_T + KERB_H + 7.5)
    link(dome, "ENV_LP12_Anchor")
    return anchor, dome


# ----------------------------------------------------------------- cameras

def place_lp12(anchor):
    """Bring the LP12 into the scene, in its own collection, standing at the anchor.

    The brief says not to merge the LP12 into the environment — and also to keep
    it in its own collection, which only makes sense if it is present. It is
    imported, never joined: nothing is parented to the road, the median or a
    building, so the collection can be hidden, isolated or swapped for a
    different antenna without touching anything else.

    It is NOT written into the exported GLB. The application already loads
    lp12_v2.glb on its own, and shipping a second copy inside the environment
    would put two poles in the same place.

    No clips are evaluated on import. The GLB's rest pose already IS the
    assembled pose — the install wrappers sit at identity and the six clips
    animate them FROM an offset back to it — so "snapping the clips" drives
    parts away from where they belong rather than into place.
    """
    if not os.path.exists(LP12_GLB):
        print(f"  LP12 not found at {LP12_GLB} — anchor left empty")
        return None

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=LP12_GLB)
    imported = [o for o in bpy.data.objects if o not in before]
    if not imported:
        return None

    for ob in imported:
        for coll in list(ob.users_collection):
            coll.objects.unlink(ob)
        COLL["LP12_POLE"].objects.link(ob)

    roots = [o for o in imported if o.parent is None]
    for root in roots:
        root.matrix_world = anchor.matrix_world.copy()

    # The importer leaves its own empty collection behind.
    for coll in list(bpy.data.collections):
        if not coll.objects and not coll.children and coll.name not in COLLECTIONS:
            bpy.data.collections.remove(coll)

    print(f"  LP12 placed: {len(imported)} objects at "
          f"{[round(v, 2) for v in anchor.matrix_world.translation]}")
    return roots[0] if roots else None


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
    check_camera_sightlines()
    build_plots()
    build_vegetation()
    build_street_furniture()
    build_vehicles()
    build_pedestrians()
    anchor, dome = build_anchors()
    place_lp12(anchor)
    build_cameras(dome)
    build_lighting()
    configure_render()

    tris = report()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("saved:", BLEND_PATH)
    return tris


if __name__ == "__main__":
    main()
