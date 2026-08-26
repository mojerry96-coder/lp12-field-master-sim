"""
build_lp12.py — deterministic Blender build script for the LP12 interactive assembly.

Run headless:
    blender --background --python build_lp12.py

Authoring convention (spec section 6):
    Z up, 1 Blender unit = 1 metre, antenna front face points +Y,
    pole centre at ground level = world origin, positive UI downtilt = negative
    local X rotation on Tilt_Rig.
"""

import bpy
import bmesh
import json
import math
import os
import random
from mathutils import Vector, Matrix, noise

# ----------------------------------------------------------------------------
# SCENE CONFIGURATION BLOCK  (spec section 7 — provisional working dimensions)
# Every dimension is editable here; nothing below hard-codes a measurement.
# ----------------------------------------------------------------------------
CFG = {
    # --- pole ---
    "pole_height":            12.5,
    # 260 mm, matched to the reference photograph: the shaft is clearly
    # narrower than the radio enclosure bolted to it. At 580 they were the
    # same width and it read as a concrete column, not a street pole.
    #
    # NOTE: build_lp12_v2.py carries its own copy of this table and both
    # have to agree — the shaft is built here, everything bolted to it is
    # placed there, and a mismatch floats the bands off the pole.
    "pole_dia_at_mount":      0.26,     # diameter at the mounting zone
    "pole_taper":             0.055,    # total diameter loss base->top
    "pole_segments":          128,
    # --- antenna enclosure ---
    "ant_height":             1.15,
    "ant_width":              0.42,
    "ant_depth":              0.24,
    # --- mounting rail ---
    "rail_height":            0.82,
    "rail_width":             0.28,
    "plate_thickness":        0.025,
    "bracket_projection":     0.32,     # forward extent measured from rail rear face
    # --- bands ---
    "band_width":             0.075,
    "band_thickness":         0.006,
    "band_spread":            0.70,     # vertical centre-to-centre distance
    "band_wrap_deg":          334.0,    # open strap, not a closed ring
    # --- rig ---
    "mount_height_default":   7.5,
    "mount_height_min":       4.0,
    "mount_height_max":       12.0,
    "mount_height_step":      0.5,
    "mount_height_ok_min":    7.0,
    "mount_height_ok_max":    8.0,
    "downtilt_min":           0.0,
    "downtilt_max":           10.0,
    "downtilt_correct":       5.0,
    # --- detail ---
    "fin_count":              38,
    # --- close-up detail density (spec phase 11) ---
    "seg_curve":              40,     # bolts, collars, hubs
    "seg_fine":               56,     # knurled / high-curvature parts
    "pole_rings":             128,
    "band_segments":          128,
    "bevel_segments":         4,
    "fin_thickness":          0.008,
    "cable_count":            3,
    "bevel_width":            0.0035,
}

OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLLECTIONS = ["REFERENCE", "MODEL", "RIG", "LIGHTING", "VALIDATION"]


def pole_radius_at(z):
    """Radius of the tapered concrete shaft at world height z."""
    r_mount = CFG["pole_dia_at_mount"] / 2.0
    taper_r = CFG["pole_taper"] / 2.0
    frac = CFG["mount_height_default"] / CFG["pole_height"]
    r_base = r_mount + taper_r * frac
    return r_base - taper_r * (z / CFG["pole_height"])


# ----------------------------------------------------------------------------
# Scene / collection helpers
# ----------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.system = 'METRIC'
    scn.unit_settings.scale_length = 1.0
    scn.unit_settings.length_unit = 'METERS'
    for name in COLLECTIONS:
        col = bpy.data.collections.new(name)
        scn.collection.children.link(col)


def link_to(obj, collection_name):
    for col in obj.users_collection:
        col.objects.unlink(obj)
    bpy.data.collections[collection_name].objects.link(obj)


def new_mesh_obj(name, bm, collection="MODEL"):
    """Create an object from a bmesh, free the bmesh, link into a collection.

    Face normals are recalculated first: faces built by hand here do not share
    a consistent winding, which forced every material to export as doubleSided.
    That doubles fragment cost and prevents back-face-culled effects (such as an
    inverted-hull highlight) from working at runtime.
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    link_to(obj, collection)
    return obj


def set_origin(obj, world_point):
    """Move the object's origin to a world point without moving its geometry."""
    offset = Vector(world_point)
    obj.data.transform(Matrix.Translation(-offset))
    obj.matrix_world = Matrix.Translation(offset) @ obj.matrix_world


def bevel_obj(obj, width=None, segments=None, angle=50.0):
    m = obj.modifiers.new("Bevel", 'BEVEL')
    m.width = width if width is not None else CFG["bevel_width"]
    m.segments = segments if segments is not None else CFG["bevel_segments"]
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError:
            obj.modifiers.remove(m)


def shade_smooth_angle(obj, angle=35.0):
    """Blender 4.x replacement for the removed mesh.use_auto_smooth."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except (AttributeError, RuntimeError):
        pass


# ----------------------------------------------------------------------------
# bmesh primitive helpers
# ----------------------------------------------------------------------------
def bm_box(bm, center, size, mat_index=0):
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    verts = [bm.verts.new((cx + x * sx, cy + y * sy, cz + z * sz))
             for x, y, z in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                             (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    for f in faces:
        face = bm.faces.new([verts[i] for i in f])
        face.material_index = mat_index
    return verts


def bm_cylinder(bm, center, radius, depth, segments=24, axis='Z', mat_index=0):
    geom = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth)
    verts = geom["verts"]
    if axis == 'X':
        rot = Matrix.Rotation(math.radians(90), 4, 'Y')
    elif axis == 'Y':
        rot = Matrix.Rotation(math.radians(90), 4, 'X')
    else:
        rot = Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=rot, verts=verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=verts)
    for v in verts:
        for f in v.link_faces:
            f.material_index = mat_index
    return verts


def bm_cone(bm, center, r1, r2, depth, segments=16, axis='Z', mat_index=0):
    geom = bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=r1, radius2=r2, depth=depth)
    verts = geom["verts"]
    if axis == 'X':
        rot = Matrix.Rotation(math.radians(90), 4, 'Y')
    elif axis == 'Y':
        rot = Matrix.Rotation(math.radians(90), 4, 'X')
    else:
        rot = Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=rot, verts=verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=verts)
    for v in verts:
        for f in v.link_faces:
            f.material_index = mat_index
    return verts


def bm_ring(bm, center, r_out, r_in, thickness, axis='Z', segments=None,
            mat_index=0):
    """Annulus solid — used for washers, rubber seals and lifting-lug eyes."""
    segments = segments or CFG["seg_curve"]
    ax = {'X': (1, 2, 0), 'Y': (2, 0, 1), 'Z': (0, 1, 2)}[axis]
    rings = []
    for h in (-thickness / 2.0, thickness / 2.0):
        for r in (r_in, r_out):
            ring = []
            for i in range(segments):
                a = 2 * math.pi * i / segments
                c = [0.0, 0.0, 0.0]
                c[ax[0]] = r * math.cos(a)
                c[ax[1]] = r * math.sin(a)
                c[ax[2]] = h
                ring.append(bm.verts.new((center[0] + c[0], center[1] + c[1],
                                          center[2] + c[2])))
            rings.append(ring)
    lo_in, lo_out, hi_in, hi_out = rings
    for i in range(segments):
        j = (i + 1) % segments
        for a_, b_ in ((lo_in, lo_out), (hi_out, hi_in),
                       (lo_out, hi_out), (hi_in, lo_in)):
            f = bm.faces.new([a_[i], a_[j], b_[j], b_[i]])
            f.material_index = mat_index
    return rings


def bm_knurled_collar(bm, center, radius, height, teeth=None, depth=0.0016,
                      axis='Z', mat_index=0):
    """Weather-sealed threaded collar with a knurled grip, as on the
    connector-bank reference sheet."""
    teeth = teeth or CFG["seg_fine"]
    ax = {'X': (1, 2, 0), 'Y': (2, 0, 1), 'Z': (0, 1, 2)}[axis]
    rings = []
    for h in (-height / 2.0, height / 2.0):
        ring = []
        for i in range(teeth):
            a = 2 * math.pi * i / teeth
            r = radius + (depth if i % 2 == 0 else -depth)
            c = [0.0, 0.0, 0.0]
            c[ax[0]] = r * math.cos(a)
            c[ax[1]] = r * math.sin(a)
            c[ax[2]] = h
            ring.append(bm.verts.new((center[0] + c[0], center[1] + c[1],
                                      center[2] + c[2])))
        rings.append(ring)
    lo, hi = rings
    for i in range(teeth):
        j = (i + 1) % teeth
        bm.faces.new([lo[i], lo[j], hi[j], hi[i]]).material_index = mat_index
    bm.faces.new(list(reversed(lo))).material_index = mat_index
    bm.faces.new(hi).material_index = mat_index
    return rings


def bm_hex_bolt(bm, center, radius, head_h, shaft_len=0.0, axis='Y', mat_index=0,
                washer=True):
    """Hex head plus optional shaft, used for every visible fastener."""
    bm_cylinder(bm, center, radius, head_h, segments=6, axis=axis, mat_index=mat_index)
    if washer:
        off = {'X': (-head_h * 0.62, 0, 0), 'Y': (0, -head_h * 0.62, 0),
               'Z': (0, 0, -head_h * 0.62)}[axis]
        bm_ring(bm, (center[0] + off[0], center[1] + off[1], center[2] + off[2]),
                radius * 1.30, radius * 0.62, head_h * 0.30, axis=axis,
                segments=CFG["seg_curve"], mat_index=mat_index)
    if shaft_len > 0:
        off = {'X': (-shaft_len / 2 - head_h / 2, 0, 0),
               'Y': (0, -shaft_len / 2 - head_h / 2, 0),
               'Z': (0, 0, -shaft_len / 2 - head_h / 2)}[axis]
        c = (center[0] + off[0], center[1] + off[1], center[2] + off[2])
        bm_cylinder(bm, c, radius * 0.55, shaft_len, segments=10, axis=axis,
                    mat_index=mat_index)


# ----------------------------------------------------------------------------
# Phase 3 — Concrete pole shaft
# ----------------------------------------------------------------------------
def build_pole():
    """Broad tapered concrete utility pole. Solid capped cylinder, never a
    hollow tube (spec 3 / phase 3.6). Slight surface irregularity is added as
    restrained vertex noise; fine detail lives in the material bump."""
    bm = bmesh.new()
    segs = CFG["pole_segments"]
    rings = CFG["pole_rings"]
    h = CFG["pole_height"]
    grid = []
    for i in range(rings + 1):
        z = h * i / rings
        r = pole_radius_at(z)
        ring = []
        for s in range(segs):
            a = 2 * math.pi * s / segs
            # restrained irregularity: low-frequency lean + fine surface wobble
            n = noise.noise(Vector((math.cos(a) * 2.0, math.sin(a) * 2.0, z * 1.4)))
            rr = r * (1.0 + 0.010 * n)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        grid.append(ring)
    for i in range(rings):
        for s in range(segs):
            s2 = (s + 1) % segs
            bm.faces.new([grid[i][s], grid[i][s2], grid[i + 1][s2], grid[i + 1][s]])
    bm.faces.new(list(reversed(grid[0])))
    bm.faces.new(grid[rings])

    obj = new_mesh_obj("Pole_Shaft", bm)

    # Small utility holes near the base, as seen in the flow close-ups.
    for (z, ang) in [(1.05, 0.0), (2.30, 0.25)]:
        cut = bmesh.new()
        r = pole_radius_at(z)
        a = ang
        bm_cylinder(cut, (math.cos(a) * r * 0.6, math.sin(a) * r * 0.6, z),
                    0.035, r * 3.0, segments=12, axis='Y')
        cutter = new_mesh_obj("__hole_cut", cut, collection="MODEL")
        cutter.rotation_euler[2] = a
        bpy.context.view_layer.update()
        m = obj.modifiers.new("Hole", 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.object = cutter
        m.solver = 'EXACT'
        apply_modifiers(obj)
        bpy.data.objects.remove(cutter, do_unlink=True)

    set_origin(obj, (0, 0, 0))
    shade_smooth_angle(obj, 30)
    return obj


# ----------------------------------------------------------------------------
# Phase 4 — Pole fastening bands
# ----------------------------------------------------------------------------
def build_band(name, z):
    """Open stainless strap with overlapping ends, tightening block and bolt.
    Hardware sits on the -Y side so it never fouls the +Y mounting rail."""
    bm = bmesh.new()
    r = pole_radius_at(z) + CFG["band_thickness"] * 0.5
    w = CFG["band_width"]
    t = CFG["band_thickness"]
    wrap = math.radians(CFG["band_wrap_deg"])
    segs = CFG["band_segments"]
    start = math.radians(90) - wrap / 2.0   # centred on +Y, gap at -Y

    inner, outer = [], []
    for i in range(segs + 1):
        a = start + wrap * i / segs
        for arr, rad in ((inner, r - t / 2), (outer, r + t / 2)):
            arr.append((bm.verts.new((rad * math.cos(a), rad * math.sin(a), z - w / 2)),
                        bm.verts.new((rad * math.cos(a), rad * math.sin(a), z + w / 2))))
    for i in range(segs):
        i0, i1 = inner[i], inner[i + 1]
        o0, o1 = outer[i], outer[i + 1]
        bm.faces.new([i0[0], i1[0], i1[1], i0[1]])          # inner wall
        bm.faces.new([o0[1], o1[1], o1[0], o0[0]])          # outer wall
        bm.faces.new([i0[1], i1[1], o1[1], o0[1]])          # top edge
        bm.faces.new([o0[0], o1[0], i1[0], i0[0]])          # bottom edge
    bm.faces.new([inner[0][0], inner[0][1], outer[0][1], outer[0][0]])
    bm.faces.new([outer[-1][0], outer[-1][1], inner[-1][1], inner[-1][0]])

    # Overlapping strap tail + tightening block + bolt at the rear gap.
    ang_gap = start + wrap + math.radians(6)
    gx, gy = (r + t * 1.6) * math.cos(ang_gap), (r + t * 1.6) * math.sin(ang_gap)
    nx, ny = math.cos(ang_gap), math.sin(ang_gap)
    bm_box(bm, (gx + nx * 0.016, gy + ny * 0.016, z), (0.070, 0.070, w * 1.45))
    bm_hex_bolt(bm, (gx + nx * 0.062, gy + ny * 0.062, z), 0.017, 0.020,
                shaft_len=0.036, axis='Y')
    # keeper buckle further round the strap
    ang_k = ang_gap - math.radians(17)
    kx, ky = (r + t * 1.4) * math.cos(ang_k), (r + t * 1.4) * math.sin(ang_k)
    bm_box(bm, (kx, ky, z), (0.040, 0.040, w * 1.35))
    # folded-over strap tail, visible in the twin-band reference sheet
    ang_tail = ang_gap + math.radians(13)
    tx, ty = (r + t * 2.2) * math.cos(ang_tail), (r + t * 2.2) * math.sin(ang_tail)
    bm_box(bm, (tx, ty, z), (0.052, 0.010, w * 0.92))

    obj = new_mesh_obj(name, bm)
    bevel_obj(obj, 0.0018, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 40)
    return obj


# ----------------------------------------------------------------------------
# Phase 5 — Vertical mounting rail
# ----------------------------------------------------------------------------
def rail_faces():
    """Y coordinates of the rail's rear face and front face."""
    y0 = pole_radius_at(CFG["mount_height_default"]) + CFG["band_thickness"]
    y1 = y0 + 0.095
    return y0, y1


def build_rail(zc):
    """Dark steel back rail with a shallow front channel, bolted to the bands."""
    bm = bmesh.new()
    y0, y1 = rail_faces()
    h, w, t = CFG["rail_height"], CFG["rail_width"], CFG["plate_thickness"]

    # rear strap plate, spans between the two bands
    bm_box(bm, (0, y0 + t / 2, zc), (w, t, h))
    # two vertical channel webs
    for sx in (-1, 1):
        bm_box(bm, (sx * (w / 2 - 0.035), (y0 + y1) / 2, zc), (0.045, y1 - y0, h * 0.97))
    # front mounting plate
    bm_box(bm, (0, y1 - t / 2, zc), (w * 0.86, t, h * 0.9))

    # band bolts: pass through the rear plate at each band height
    for dz in (-CFG["band_spread"] / 2, CFG["band_spread"] / 2):
        for sx in (-1, 1):
            bm_hex_bolt(bm, (sx * w * 0.33, y0 - 0.006, zc + dz), 0.013, 0.014,
                        shaft_len=0.0, axis='Y')
    # front plate fastener holes -> represented as recessed bolt heads
    for dz in (-0.28, -0.14, 0.0, 0.14, 0.28):
        bm_hex_bolt(bm, (0, y1 + 0.004, zc + dz), 0.012, 0.012, axis='Y')
    # restrained weld seams where the webs meet the rear plate
    for sx in (-1, 1):
        bm_box(bm, (sx * (w / 2 - 0.058), y0 + t + 0.004, zc),
               (0.010, 0.010, h * 0.94))

    obj = new_mesh_obj("Mounting_Rail", bm)
    bevel_obj(obj, 0.002, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 40)
    return obj


# ----------------------------------------------------------------------------
# Phase 6 — Pivot: fixed interface + moving triangular bracket
# ----------------------------------------------------------------------------
def hinge_point(zc):
    """World location of the true downtilt hinge axis centre."""
    y0, _ = rail_faces()
    return (0.0, y0 + CFG["bracket_projection"] * 0.86, zc)


def build_pivot_fixed(zc):
    """Stationary plate between rail and moving bracket. Carries the paired
    ears that the hinge bolt passes through."""
    bm = bmesh.new()
    y0, y1 = rail_faces()
    hy = hinge_point(zc)[1]
    t = CFG["plate_thickness"]

    bm_box(bm, (0, y1 + t / 2, zc), (0.20, t, 0.42))          # vertical flange
    for sx in (-1, 1):                                        # paired forward ears
        bm_box(bm, (sx * 0.055, (y1 + hy) / 2 + 0.01, zc),
               (0.022, hy - y1 + 0.06, 0.17))
    obj = new_mesh_obj("Pivot_Fixed", bm)
    bevel_obj(obj, 0.0022, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 40)
    return obj


def build_pivot_bracket(zc):
    """Moving triangular bracket pair — the part that actually carries the
    antenna and rotates about the hinge."""
    bm = bmesh.new()
    hx, hy, hz = hinge_point(zc)
    rear_y = hy + 0.012          # where the antenna rear sits
    t = 0.020

    for sx in (-1, 1):
        x = sx * 0.085
        # triangular plate: apex at the hinge, wide edge against the antenna
        pts = [(hy - 0.055, hz + 0.02), (rear_y + 0.055, hz + 0.135),
               (rear_y + 0.055, hz - 0.315)]
        vs_lo = [bm.verts.new((x - t / 2, p[0], p[1])) for p in pts]
        vs_hi = [bm.verts.new((x + t / 2, p[0], p[1])) for p in pts]
        bm.faces.new(vs_lo)
        bm.faces.new(list(reversed(vs_hi)))
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new([vs_lo[i], vs_lo[j], vs_hi[j], vs_hi[i]])
    # vertical spine plate joining the two triangles against the antenna rear.
    # Kept low so the upper-rear heatsink comb stays visible, as in the refs.
    bm_box(bm, (0, rear_y + 0.055, hz - 0.115), (0.19, t, 0.40))
    obj = new_mesh_obj("Pivot_Bracket", bm)
    bevel_obj(obj, 0.0022, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 40)
    return obj


def build_pivot_hardware(zc):
    """Hub, through-bolt, washers, spacers and nut on the hinge axis."""
    bm = bmesh.new()
    hx, hy, hz = hinge_point(zc)
    bm_cylinder(bm, (0, hy, hz), 0.052, 0.150, segments=CFG["seg_fine"], axis='X')   # hub boss
    for sx in (-1, 1):
        bm_ring(bm, (sx * 0.088, hy, hz), 0.034, 0.016, 0.010, axis='X',
                segments=CFG["seg_curve"])           # washer
        bm_ring(bm, (sx * 0.100, hy, hz), 0.026, 0.015, 0.012, axis='X',
                segments=CFG["seg_curve"])           # spacer
    bm_cylinder(bm, (0, hy, hz), 0.014, 0.230, segments=CFG["seg_curve"], axis='X')
    bm_hex_bolt(bm, (0.112, hy, hz), 0.024, 0.018, axis='X')
    bm_hex_bolt(bm, (-0.112, hy, hz), 0.024, 0.018, axis='X')
    obj = new_mesh_obj("Pivot_Hardware", bm)
    bevel_obj(obj, 0.0015, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 45)
    return obj


# ----------------------------------------------------------------------------
# Phase 7 — n78 antenna enclosure
# ----------------------------------------------------------------------------
def antenna_center(zc):
    hx, hy, hz = hinge_point(zc)
    return (0.0, hy + 0.012 + 0.075 + CFG["ant_depth"] / 2.0, hz)


def build_antenna_body(zc):
    """Tall off-white enclosure: clean front radome, deeper rear casing,
    soft corner chamfers, restrained seams, top lifting lugs."""
    bm = bmesh.new()
    cx, cy, cz = antenna_center(zc)
    w, d, h = CFG["ant_width"], CFG["ant_depth"], CFG["ant_height"]

    bm_box(bm, (cx, cy, cz), (w, d, h))
    # Front radome: the reference face is clean, so the panel is flush and only
    # its perimeter seam catches light. No proud "picture frame".
    bm_box(bm, (cx, cy + d / 2 - 0.0015, cz + 0.02), (w * 0.955, 0.004, h * 0.955))
    # lower access-panel seam
    bm_box(bm, (cx, cy + d / 2 - 0.0015, cz - h * 0.335), (w * 0.86, 0.004, h * 0.235))
    # rear casing step (the deeper half that carries the heatsink)
    bm_box(bm, (cx, cy - d / 2 - 0.016, cz + h * 0.12), (w * 0.94, 0.032, h * 0.70))
    # top lifting lugs, with a real through-eye rather than a solid nub
    for sx in (-1, 1):
        bm_box(bm, (cx + sx * w * 0.30, cy - 0.02, cz + h / 2 + 0.016),
               (0.046, 0.056, 0.032))
        bm_ring(bm, (cx + sx * w * 0.30, cy - 0.02, cz + h / 2 + 0.034),
                0.019, 0.009, 0.016, axis='X', segments=CFG["seg_curve"])
    # countersunk casing screws: recess ring plus a seated head
    for sx in (-1, 1):
        for sz in (-1, 1):
            sc = (cx + sx * w * 0.40, cy + d / 2 + 0.001, cz + sz * h * 0.42)
            bm_ring(bm, sc, 0.011, 0.006, 0.004, axis='Y',
                    segments=CFG["seg_curve"])
            bm_cylinder(bm, (sc[0], sc[1] - 0.002, sc[2]), 0.0058, 0.004,
                        segments=CFG["seg_curve"], axis='Y')
    # side casing seams, restrained (spec phase 7.5: do not exaggerate)
    for sx in (-1, 1):
        bm_box(bm, (cx + sx * (w / 2 - 0.001), cy + 0.012, cz + 0.02),
               (0.004, 0.006, h * 0.90))
    obj = new_mesh_obj("Antenna_Body", bm)
    bevel_obj(obj, 0.011, 6)          # soft chamfers per reference silhouette
    apply_modifiers(obj)
    shade_smooth_angle(obj, 35)
    return obj


# ----------------------------------------------------------------------------
# Phase 8 — Cooling fins
# ----------------------------------------------------------------------------
def build_cooling_fins(zc):
    """Deep-louvred charcoal heatsink on the rear upper section. Horizontal
    fins stacked in Z (side-view comb in the reference), driven by an Array
    modifier for consistent spacing."""
    cx, cy, cz = antenna_center(zc)
    w, d, h = CFG["ant_width"], CFG["ant_depth"], CFG["ant_height"]
    n = CFG["fin_count"]
    span = h * 0.44                      # upper rear only, clear of the bracket
    pitch = span / (n - 1)
    y_back = cy - d / 2 - 0.032
    z_top = cz + h * 0.455

    bm = bmesh.new()
    bm_box(bm, (cx, y_back - 0.052, z_top), (w * 0.90, 0.104, CFG["fin_thickness"]))
    obj = new_mesh_obj("Cooling_Fins", bm)

    arr = obj.modifiers.new("FinArray", 'ARRAY')
    arr.count = n
    arr.use_relative_offset = False
    arr.use_constant_offset = True
    arr.constant_offset_displace = (0, 0, -pitch)
    apply_modifiers(obj)

    # cast backing plate that ties the fin stack together
    bm2 = bmesh.new()
    bm_box(bm2, (cx, y_back - 0.006, z_top - span / 2),
           (w * 0.92, 0.016, span + 0.055))
    for sx in (-1, 1):        # vertical side ribs seen in the rear view
        bm_box(bm2, (cx + sx * w * 0.445, y_back - 0.052, z_top - span / 2),
               (0.016, 0.104, span + 0.055))
    back = new_mesh_obj("__fin_back", bm2)
    bpy.ops.object.select_all(action='DESELECT')
    back.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()
    obj.name = "Cooling_Fins"
    obj.data.name = "Cooling_Fins"
    bevel_obj(obj, 0.0012, 2)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 40)
    return obj


# ----------------------------------------------------------------------------
# Phase 9 — Connector bank
# ----------------------------------------------------------------------------
# Reference conflict (spec 3): the dedicated connector sheet shows nine
# conceptual ports; the complete-assembly sheet and the antenna-installation
# flow image — which outrank it — show five populated ports on the underside.
# Five is therefore modelled, and only three carry cables.
PORTS = [
    (-0.150, 0.030, "rf"),
    (-0.075, 0.030, "rf"),
    ( 0.000, 0.000, "gland"),
    ( 0.078, 0.030, "rf"),
    ( 0.152, 0.030, "rf"),
]


def build_connector_bank(zc, mats):
    """Underside cast plate with weather-sealed threaded collars, hex nuts,
    rubber seals and one larger dark power/data gland."""
    bm = bmesh.new()
    cx, cy, cz = antenna_center(zc)
    w, d, h = CFG["ant_width"], CFG["ant_depth"], CFG["ant_height"]
    z_plate = cz - h / 2 - 0.010

    bm_box(bm, (cx, cy, z_plate), (w * 0.92, d * 0.86, 0.020))
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm_cylinder(bm, (cx + sx * w * 0.40, cy + sy * d * 0.36, z_plate),
                        0.008, 0.024, segments=CFG["seg_curve"], axis='Z')
    for (px, py, kind) in PORTS:
        x, y = cx + px, cy + py
        if kind == "gland":
            bm_ring(bm, (x, y, z_plate - 0.011), 0.034, 0.026, 0.006,
                    axis='Z', segments=CFG["seg_curve"])          # seal face
            bm_knurled_collar(bm, (x, y, z_plate - 0.032), 0.030, 0.048)
            bm_cylinder(bm, (x, y, z_plate - 0.064), 0.024, 0.028,
                        segments=CFG["seg_curve"], axis='Z')
            bm_ring(bm, (x, y, z_plate - 0.080), 0.023, 0.014, 0.008,
                    axis='Z', segments=CFG["seg_curve"])          # rubber boot
        else:
            bm_ring(bm, (x, y, z_plate - 0.008), 0.022, 0.017, 0.005,
                    axis='Z', segments=CFG["seg_curve"])          # seal washer
            bm_knurled_collar(bm, (x, y, z_plate - 0.020), 0.019, 0.026)
            bm_cylinder(bm, (x, y, z_plate - 0.037), 0.016, 0.014,
                        segments=6, axis='Z')                     # hex nut
            bm_ring(bm, (x, y, z_plate - 0.046), 0.015, 0.010, 0.004,
                    axis='Z', segments=CFG["seg_curve"])
            # brass contact pin (material slot 1)
            bm_cylinder(bm, (x, y, z_plate - 0.056), 0.011, 0.018,
                        segments=CFG["seg_curve"], axis='Z', mat_index=1)
    obj = new_mesh_obj("Connector_Bank", bm)
    bevel_obj(obj, 0.0012, 1)
    apply_modifiers(obj)
    shade_smooth_angle(obj, 45)

    # Material slots must exist before per-face indices mean anything: on
    # bmesh.to_mesh() any material_index is clamped to the slot count, so
    # indices written during construction collapse to 0. Assign the slots
    # first, then tag the brass contact pins by position.
    obj.data.materials.append(mats["MAT_Connector_Steel"])
    obj.data.materials.append(mats["MAT_Connector_Brass"])
    pins = [(cx + px, cy + py) for (px, py, kind) in PORTS if kind == "rf"]
    tagged = 0
    for poly in obj.data.polygons:
        c = poly.center
        if c.z > z_plate - 0.042:
            continue
        for (ax, ay) in pins:
            if (c.x - ax) ** 2 + (c.y - ay) ** 2 < 0.0135 ** 2:
                poly.material_index = 1
                tagged += 1
                break
    print(f"    connector bank: {tagged} brass contact faces tagged")
    return obj


# ----------------------------------------------------------------------------
# Phase 10 — Cables
# ----------------------------------------------------------------------------
def build_cables(zc):
    """Only the runs visible in the canonical references: three black cables
    leaving the connector bank with a gravity-driven slack loop, then turning
    back toward the pole. Authored as bevelled curves, converted to mesh."""
    cx, cy, cz = antenna_center(zc)
    h = CFG["ant_height"]
    z_plate = cz - h / 2 - 0.010
    y0, _ = rail_faces()

    curve = bpy.data.curves.new("Antenna_Cables", 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.011
    curve.bevel_resolution = 8
    curve.resolution_u = 12

    feeds = [PORTS[0], PORTS[2], PORTS[4]][:CFG["cable_count"]]
    for i, (px, py, kind) in enumerate(feeds):
        x, y = cx + px, cy + py
        drop = 0.26 + i * 0.035
        # Monotonic descent: leave the gland, belly outward under gravity,
        # then lean back toward the pole while still dropping.
        pts = [
            (x, y, z_plate - 0.050),
            (x * 1.02, y + 0.020, z_plate - 0.050 - drop * 0.42),
            (x * 0.88, y - 0.010, z_plate - 0.050 - drop * 0.88),   # slack belly
            (x * 0.58, (y + y0) * 0.5, z_plate - 0.050 - drop * 1.28),
            (x * 0.30, y0 + 0.055, z_plate - 0.050 - drop * 1.72),
            (x * 0.18, y0 + 0.015, z_plate - 0.050 - drop * 2.20),
        ]
        spl = curve.splines.new('BEZIER')
        spl.bezier_points.add(len(pts) - 1)
        for bp, p in zip(spl.bezier_points, pts):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'

    obj = bpy.data.objects.new("Antenna_Cables", curve)
    bpy.context.scene.collection.objects.link(obj)
    link_to(obj, "MODEL")
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.view_layer.objects.active
    obj.name = "Antenna_Cables"
    obj.data.name = "Antenna_Cables"
    shade_smooth_angle(obj, 60)
    return obj


# ----------------------------------------------------------------------------
# Phase 12 — Materials
# ----------------------------------------------------------------------------
def _pbr(name, base, metallic, roughness, bump=None, variation=None):
    """Principled PBR material. `bump` = (noise_scale, strength) adds surface
    micro-relief; `variation` = (scale, amount) mottles the base colour.
    All detail is procedural at authoring time and baked before GLB export."""
    mat = bpy.data.materials.new(name)
    # Export single-sided: glTF marks a material doubleSided unless backface
    # culling is on. DoubleSided doubles fragment cost and prevents the
    # runtime inverted-hull highlight from working.
    mat.use_backface_culling = True
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness

    tex_co = nt.nodes.new("ShaderNodeTexCoord")
    tex_co.location = (-1100, 0)

    if variation:
        scale, amount = variation
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.location = (-900, 250)
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = 8.0
        nz.inputs["Roughness"].default_value = 0.55
        nt.links.new(tex_co.outputs["Object"], nz.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.location = (-700, 250)
        lo = tuple(max(0.0, c * (1.0 - amount)) for c in base)
        hi = tuple(min(1.0, c * (1.0 + amount * 0.6)) for c in base)
        ramp.color_ramp.elements[0].position = 0.32
        ramp.color_ramp.elements[0].color = (*lo, 1.0)
        ramp.color_ramp.elements[1].position = 0.70
        ramp.color_ramp.elements[1].color = (*hi, 1.0)
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

        rmix = nt.nodes.new("ShaderNodeMapRange")
        rmix.location = (-500, 60)
        rmix.inputs["To Min"].default_value = max(0.0, roughness - 0.07)
        rmix.inputs["To Max"].default_value = min(1.0, roughness + 0.07)
        nt.links.new(nz.outputs["Fac"], rmix.inputs["Value"])
        nt.links.new(rmix.outputs["Result"], bsdf.inputs["Roughness"])

    if bump:
        scale, strength = bump
        bn = nt.nodes.new("ShaderNodeTexNoise")
        bn.location = (-900, -300)
        bn.inputs["Scale"].default_value = scale
        bn.inputs["Detail"].default_value = 10.0
        nt.links.new(tex_co.outputs["Object"], bn.inputs["Vector"])
        bp = nt.nodes.new("ShaderNodeBump")
        bp.location = (-500, -300)
        bp.inputs["Strength"].default_value = strength
        bp.inputs["Distance"].default_value = 0.006
        nt.links.new(bn.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def make_materials():
    """The eight exact material names required by spec phase 12."""
    return {
        "MAT_Concrete_Pole":     _pbr("MAT_Concrete_Pole", (0.232, 0.222, 0.203),
                                      0.0, 0.86, bump=(190.0, 0.85), variation=(16.0, 0.42)),
        "MAT_Steel_Brushed":     _pbr("MAT_Steel_Brushed", (0.268, 0.266, 0.258),
                                      0.92, 0.43, bump=(240.0, 0.22), variation=(30.0, 0.26)),
        "MAT_Steel_Dark":        _pbr("MAT_Steel_Dark", (0.055, 0.055, 0.058),
                                      0.76, 0.57, bump=(150.0, 0.20), variation=(20.0, 0.26)),
        "MAT_Antenna_OffWhite":  _pbr("MAT_Antenna_OffWhite", (0.760, 0.752, 0.722),
                                      0.0, 0.55, bump=(320.0, 0.05), variation=(14.0, 0.05)),
        "MAT_HeatSink_Charcoal": _pbr("MAT_HeatSink_Charcoal", (0.062, 0.062, 0.064),
                                      0.72, 0.56, bump=(210.0, 0.16), variation=(22.0, 0.18)),
        "MAT_Rubber_Black":      _pbr("MAT_Rubber_Black", (0.030, 0.030, 0.032),
                                      0.0, 0.78, bump=(260.0, 0.10)),
        "MAT_Connector_Steel":   _pbr("MAT_Connector_Steel", (0.455, 0.455, 0.448),
                                      0.96, 0.33, variation=(40.0, 0.10)),
        "MAT_Connector_Brass":   _pbr("MAT_Connector_Brass", (0.585, 0.448, 0.196),
                                      0.95, 0.30, variation=(40.0, 0.10)),
    }


def assign(obj, *mats_in):
    """Assign one or more materials; slot order matches the mat_index values
    baked into the geometry."""
    obj.data.materials.clear()
    for m in mats_in:
        obj.data.materials.append(m)


# ----------------------------------------------------------------------------
# Phase 13 — Rig, hierarchy and interaction anchors
# ----------------------------------------------------------------------------
def new_empty(name, location, collection="RIG", kind='PLAIN_AXES', size=0.12):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind
    e.empty_display_size = size
    e.location = location
    bpy.context.scene.collection.objects.link(e)
    link_to(e, collection)
    return e


def parent_keep(child, parent):
    """Parent without moving the child. The depsgraph must be flushed first:
    matrix_world is lazily evaluated, and a stale (identity) parent matrix
    would make every level of the rig double-apply its own offset."""
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def center_origins(objs):
    """Put every component's origin at its own geometric centre.

    Meshes are authored in world coordinates, so without this each object's
    origin sits at its parent's zero rather than on the part itself. That is
    invisible at rest but makes per-component animation (an install fly-in,
    a highlight pulse, an exploded view) rotate and scale about a point far
    from the part. Geometry does not move; only the pivot does.
    """
    for name, ob in objs.items():
        if ob.type != 'MESH' or name == "Pole_Shaft":
            continue          # the pole's origin is deliberately at its base
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    bpy.context.view_layer.update()


def build_rig(objs, zc):
    hx, hy, hz = hinge_point(zc)
    acx, acy, acz = antenna_center(zc)

    root = new_empty("LP12_ROOT", (0, 0, 0), kind='ARROWS', size=0.6)
    height_rig = new_empty("Height_Rig", (0, 0, zc), kind='SPHERE', size=0.22)
    tilt_rig = new_empty("Tilt_Rig", (0, hy, hz), kind='CIRCLE', size=0.16)
    anchors = new_empty("Interaction_Anchors", (0, 0, 0), kind='PLAIN_AXES', size=0.2)

    # Pole is fixed and must never inherit height or tilt.
    parent_keep(objs["Pole_Shaft"], root)
    parent_keep(height_rig, root)
    parent_keep(anchors, root)
    parent_keep(tilt_rig, height_rig)

    for n in ("Band_Top", "Band_Bottom", "Mounting_Rail", "Pivot_Fixed"):
        parent_keep(objs[n], height_rig)
    for n in ("Pivot_Bracket", "Pivot_Hardware", "Antenna_Body",
              "Cooling_Fins", "Connector_Bank", "Antenna_Cables"):
        parent_keep(objs[n], tilt_rig)

    # --- interaction anchors -------------------------------------------------
    # Reference/spec conflict (reported): the section 8 tree lists every anchor
    # under Interaction_Anchors, but the section 8 parenting rules require
    # Beam_Origin to inherit height AND downtilt, and Camera_Focus to sit at
    # the installed assembly centre. Functional parenting wins; names are
    # preserved exactly.
    beam = new_empty("Beam_Origin", (0, acy + CFG["ant_depth"] / 2 + 0.06, acz),
                     kind='ARROWS', size=0.35)
    # Identity rotation: local +Y already is the antenna face normal, and it
    # inherits height and downtilt through Tilt_Rig.
    beam.rotation_euler = (0.0, 0.0, 0.0)
    parent_keep(beam, tilt_rig)

    cam_focus = new_empty("Camera_Focus", (0, acy, acz), kind='SPHERE', size=0.14)
    parent_keep(cam_focus, height_rig)

    statics = {
        "Install_Target":   (0, acy, acz),
        "Height_Min":       (0, 0, CFG["mount_height_min"]),
        "Height_Max":       (0, 0, CFG["mount_height_max"]),
        "Height_Reference": (0, 0, CFG["mount_height_default"]),
        "Coverage_Target":  (0, 26.0, 0.0),
    }
    for n, loc in statics.items():
        parent_keep(new_empty(n, loc), anchors)

    # --- custom properties (spec phase 13.8) --------------------------------
    for k, v in [("mount_height_min", CFG["mount_height_min"]),
                 ("mount_height_max", CFG["mount_height_max"]),
                 ("mount_height_step", CFG["mount_height_step"]),
                 ("mount_height_correct_min", CFG["mount_height_ok_min"]),
                 ("mount_height_correct_max", CFG["mount_height_ok_max"]),
                 ("mount_height_ideal", CFG["mount_height_default"]),
                 ("downtilt_min", CFG["downtilt_min"]),
                 ("downtilt_max", CFG["downtilt_max"]),
                 ("downtilt_correct", CFG["downtilt_correct"])]:
        root[k] = float(v)
    return root, height_rig, tilt_rig


def set_downtilt(tilt_rig, degrees):
    """Positive UI downtilt -> negative local X rotation (spec section 6)."""
    tilt_rig.rotation_euler = (math.radians(-degrees), 0.0, 0.0)


def set_height(height_rig, metres):
    height_rig.location.z = metres


# ----------------------------------------------------------------------------
# Phase 1/15 — Studio lighting, validation cameras, renders
# ----------------------------------------------------------------------------
def build_lighting():
    world = bpy.data.worlds.new("LP12_World")
    bpy.context.scene.world = world
    if bpy.app.version < (5, 0, 0):
        world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.62, 0.62, 0.63, 1.0)
    bg.inputs["Strength"].default_value = 1.05

    specs = [("Key", (4.2, -5.0, 10.4), 900, 5.0),
             ("Fill", (-5.4, -3.4, 8.6), 320, 6.5),
             ("Rim", (-1.6, 6.2, 10.2), 420, 4.5)]
    for name, loc, power, size in specs:
        data = bpy.data.lights.new(f"LGT_{name}", 'AREA')
        data.energy = power
        data.size = size
        obj = bpy.data.objects.new(f"LGT_{name}", data)
        obj.location = loc
        bpy.context.scene.collection.objects.link(obj)
        link_to(obj, "LIGHTING")
        d = Vector((0, 0, CFG["mount_height_default"])) - Vector(loc)
        obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def make_camera(name, loc, target, ortho_scale=None, lens=85.0):
    data = bpy.data.cameras.new(name)
    if ortho_scale:
        data.type = 'ORTHO'
        data.ortho_scale = ortho_scale
    else:
        data.lens = lens
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    link_to(obj, "VALIDATION")
    d = Vector(target) - Vector(loc)
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return obj


def build_cameras(zc):
    acx, acy, acz = antenna_center(zc)
    t = (0, acy * 0.45, zc)
    return {
        "front":   make_camera("CAM_Front", (0, 9.0, zc), t, ortho_scale=2.4),
        "side":    make_camera("CAM_Side", (9.0, acy * 0.45, zc), t, ortho_scale=2.4),
        # Rear view is offset into a quarter so the shaft does not occlude the
        # heatsink; a true -Y ortho shows nothing but the pole.
        "rear":    make_camera("CAM_Rear", (-6.4, -6.4, zc + 0.55),
                               (0, acy * 0.9, zc), ortho_scale=2.1),
        "quarter": make_camera("CAM_Quarter", (3.1, 4.0, zc + 0.85), t, lens=80),
        "mount":   make_camera("CAM_Mount", (1.75, 2.45, zc + 0.22),
                               (0, 0.34, zc), lens=62),
        "wide":    make_camera("CAM_Wide", (5.2, 6.6, zc + 1.2),
                               (0, 0, zc - 0.4), lens=52),
        "exploded": make_camera("CAM_Exploded", (4.6, 5.6, zc + 0.6), t, lens=58),
    }


def pick_engine():
    """Realtime engine id differs across versions: 4.2 uses BLENDER_EEVEE_NEXT,
    5.x renamed it back to BLENDER_EEVEE. Read the enum rather than guessing."""
    ids = {i.identifier for i in
           bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
    for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        if cand in ids:
            return cand
    return 'CYCLES'


def setup_render(res=(1400, 1750)):
    scn = bpy.context.scene
    scn.render.engine = pick_engine()
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    scn.render.film_transparent = False
    try:
        scn.eevee.taa_render_samples = 96
        scn.eevee.use_raytracing = True
    except AttributeError:
        pass
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Base Contrast'
    except TypeError:
        pass


def render_to(cam, path, res=(1400, 1750)):
    scn = bpy.context.scene
    scn.camera = cam
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"  rendered {os.path.basename(path)}")


# ----------------------------------------------------------------------------
# Export + manifest
# ----------------------------------------------------------------------------
def hierarchy_objects(root):
    out = []
    stack = [root]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def check_names(root):
    """Fail loudly on `.001` duplicates, generic names or negative scale."""
    problems = []
    for o in hierarchy_objects(root):
        if "." in o.name and o.name.split(".")[-1].isdigit():
            problems.append(f"duplicate-suffixed name: {o.name}")
        if o.name in {"Cube", "Sphere", "Cylinder", "Plane", "Empty"}:
            problems.append(f"generic name: {o.name}")
        if any(s < 0 for s in o.scale):
            problems.append(f"negative scale: {o.name}")
        if o.type == 'MESH' and any(abs(s - 1.0) > 1e-5 for s in o.scale):
            problems.append(f"unapplied scale: {o.name} {tuple(o.scale)}")
    return problems


def triangle_count(root):
    total = 0
    dg = bpy.context.evaluated_depsgraph_get()
    for o in hierarchy_objects(root):
        if o.type != 'MESH':
            continue
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return total


def export_glb(root, path, meshopt=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in hierarchy_objects(root):
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,          # carries LP12_ROOT custom properties
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_meshopt_compression_enable=meshopt,
    )


def write_manifest(path):
    manifest = {
        "model": "lp12_interactive_assembly.glb",
        "optimizedModel": {
            "file": "lp12_interactive_assembly_meshopt.glb",
            "extension": "EXT_meshopt_compression",
            "requiresRuntimeDecoder": "MeshoptDecoder",
            "note": ("Geometry-compressed variant. Node names, hierarchy, "
                     "transforms and extras are byte-identical to the master; "
                     "textures are not yet KTX2."),
        },
        "coordinateSystem": {
            "authoringUp": "Z",
            "antennaForward": "+Y",
            "downtiltAxis": "localX",
            "positiveUiDowntiltMapsTo": "negativeLocalXRotation",
            "_comment": ("Authoring frame is Blender Z-up. The glTF exporter "
                         "converts to Y-up, so see runtimeFrame for the axes "
                         "a glTF/three.js consumer actually sees."),
        },
        "runtimeFrame": {
            "up": "+Y",
            "antennaForward": "-Z",
            "heightAxis": "Height_Rig.position.y",
            "downtiltAxis": "Tilt_Rig.rotation.x",
            "positiveUiDowntiltMapsTo": "negativeXRotation",
            "beamOriginForward": "-Z",
            "hingeWorldAtDefault": [0.0, 7.5, -0.5712],
        },
        "height": {
            "minMetres": CFG["mount_height_min"],
            "maxMetres": CFG["mount_height_max"],
            "stepMetres": CFG["mount_height_step"],
            "correctMinMetres": CFG["mount_height_ok_min"],
            "correctMaxMetres": CFG["mount_height_ok_max"],
            "idealMetres": CFG["mount_height_default"],
            "rigNode": "Height_Rig",
        },
        "downtilt": {
            "allowedDegrees": [0, 2, 5, 8, 10],
            "correctDegrees": CFG["downtilt_correct"],
            "rigNode": "Tilt_Rig",
        },
        "nodes": {
            "root": "LP12_ROOT",
            "pole": "Pole_Shaft",
            "installTarget": "Install_Target",
            "beamOrigin": "Beam_Origin",
            "cameraFocus": "Camera_Focus",
            "coverageTarget": "Coverage_Target",
        },
    }
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest


# ----------------------------------------------------------------------------
# Phase 14 — UVs and texture baking
# ----------------------------------------------------------------------------
# The GLB may not carry Blender-only procedural nodes (spec section 10), so
# every procedural material is unwrapped, baked to PNG image maps and rewired
# to use only those images. One atlas per material: all objects sharing a
# material are packed into a single non-overlapping UV layout and baked
# together, which keeps the production texture count low.

# material -> (resolution, deliverables/textures subfolder)
TEXTURE_SETS = {
    "MAT_Concrete_Pole":     (1024, "concrete"),
    "MAT_Antenna_OffWhite":  (2048, "antenna"),
    "MAT_HeatSink_Charcoal": (1024, "antenna"),
    "MAT_Rubber_Black":      (512,  "antenna"),
    "MAT_Connector_Steel":   (1024, "antenna"),
    "MAT_Connector_Brass":   (512,  "antenna"),
    "MAT_Steel_Brushed":     (1024, "mounting_hardware"),
    "MAT_Steel_Dark":        (2048, "mounting_hardware"),
}


def unwrap_group(objects):
    """Unwrap a material group into one shared atlas using multi-object edit
    mode, so the whole material bakes to a single image."""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    if len(objects) == 1 and objects[0].name == "Pole_Shaft":
        # A cylinder projects to one near-rectangular island that fills the
        # atlas; smart-project scattered it across ~17% of the map.
        bpy.ops.uv.cylinder_project(direction='ALIGN_TO_OBJECT',
                                    scale_to_bounds=True)
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66),
                                 island_margin=0.006)
    bpy.ops.uv.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(margin=0.006)
    except RuntimeError:
        pass
    bpy.ops.object.mode_set(mode='OBJECT')


def _emit_setup(mat):
    """Temporarily drive Material Output from an Emission shader fed by the
    material's base colour, so an EMIT bake captures true albedo for metals."""
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    orig = None
    for l in nt.links:
        if l.to_node is out and l.to_socket.name == 'Surface':
            orig = l.from_socket
            break
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.location = (-200, 500)
    bc = bsdf.inputs["Base Color"]
    if bc.is_linked:
        nt.links.new(bc.links[0].from_socket, emit.inputs["Color"])
    else:
        emit.inputs["Color"].default_value = bc.default_value
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    return emit.name, out.name, (orig.node.name if orig else None)


def _emit_restore(mat, state):
    """Restore Surface from node *names*: socket references captured before a
    nodes.remove() go stale, which silently leaves the output unlinked."""
    emit_name, out_name, src_name = state
    nt = mat.node_tree
    if emit_name in nt.nodes:
        nt.nodes.remove(nt.nodes[emit_name])
    if src_name and src_name in nt.nodes and out_name in nt.nodes:
        nt.links.new(nt.nodes[src_name].outputs[0],
                     nt.nodes[out_name].inputs["Surface"])


def _new_image(name, res, is_data):
    img = bpy.data.images.new(name, res, res, alpha=False,
                              float_buffer=False, is_data=is_data)
    return img


def bake_materials(objs, mats):
    """Bake base colour, roughness and normal for every material, then rewire
    the graph so nothing procedural survives into the export."""
    scn = bpy.context.scene
    prev_engine = scn.render.engine
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.bake.use_selected_to_active = False
    scn.render.bake.margin = 8

    tex_root = os.path.join(OUT_DIR, "textures")
    written = []

    # One unwrap pass, grouped by each object's primary material, so every
    # object has a stable UV layout for the whole bake. Objects sharing an
    # atlas are packed together and therefore never overlap.
    groups = {}
    for ob in objs.values():
        if ob.type == 'MESH' and ob.data.materials and ob.data.materials[0]:
            groups.setdefault(ob.data.materials[0].name, []).append(ob)
    for gname, members in groups.items():
        unwrap_group(members)
        print(f"    unwrapped {gname} ({len(members)} object(s))")

    for mat_name, (res, folder) in TEXTURE_SETS.items():
        mat = mats[mat_name]
        users = [ob for ob in objs.values()
                 if ob.type == 'MESH'
                 and any(m is mat for m in ob.data.materials)]
        if not users:
            continue

        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        out_dir = os.path.join(tex_root, folder)
        os.makedirs(out_dir, exist_ok=True)
        short = mat_name.replace("MAT_", "").lower()

        # A single image node is reused as the bake target for each pass; it
        # must be the active node on the material while that pass runs.
        slot_mats = []
        for ob in users:
            for m in ob.data.materials:
                if m is not None and m not in slot_mats:
                    slot_mats.append(m)
        targets = {}
        for m in slot_mats:
            tn = m.node_tree.nodes.new("ShaderNodeTexImage")
            tn.location = (-1500, -700)
            targets[m.name] = tn
        target = targets[mat_name]

        baked = {}
        passes = [("base_color", 'EMIT', False),
                  ("roughness", 'ROUGHNESS', True),
                  ("normal", 'NORMAL', True)]
        for suffix, bake_type, is_data in passes:
            img = _new_image(f"{short}_{suffix}", res, is_data)
            for m in slot_mats:
                targets[m.name].image = img
                m.node_tree.nodes.active = targets[m.name]
            bpy.ops.object.select_all(action='DESELECT')
            for ob in users:
                ob.select_set(True)
            bpy.context.view_layer.objects.active = users[0]

            emit_state = []
            if bake_type == 'EMIT':
                for m in slot_mats:
                    emit_state.append((m, _emit_setup(m)))
            bpy.ops.object.bake(type=bake_type, use_clear=True)
            for m, st in emit_state:
                _emit_restore(m, st)

            path = os.path.join(out_dir, f"{short}_{suffix}.png")
            img.filepath_raw = path
            img.file_format = 'PNG'
            img.save()
            baked[suffix] = img
            written.append(os.path.relpath(path, OUT_DIR))
            print(f"    baked {short}_{suffix} ({res}px)")

        # --- rewire: procedural chain out, baked images in -------------------
        for m in slot_mats:            # drop the temporary bake targets
            tn = targets[m.name]
            if tn.name in m.node_tree.nodes:
                m.node_tree.nodes.remove(tn)
        for n in list(nt.nodes):
            if n.type in {'TEX_NOISE', 'VALTORGB', 'BUMP', 'MAP_RANGE',
                          'TEX_COORD'}:
                nt.nodes.remove(n)

        c = nt.nodes.new("ShaderNodeTexImage")
        c.image = baked["base_color"]
        c.location = (-800, 300)
        nt.links.new(c.outputs["Color"], bsdf.inputs["Base Color"])

        r = nt.nodes.new("ShaderNodeTexImage")
        r.image = baked["roughness"]
        r.image.colorspace_settings.name = 'Non-Color'
        r.location = (-800, 0)
        nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])

        nrm = nt.nodes.new("ShaderNodeTexImage")
        nrm.image = baked["normal"]
        nrm.image.colorspace_settings.name = 'Non-Color'
        nrm.location = (-800, -300)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-500, -300)
        nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    scn.render.engine = prev_engine
    return written


def ensure_surface_links(mats):
    """Acceptance gate: every material must still drive its output surface."""
    fixed = []
    for name, mat in mats.items():
        nt = mat.node_tree
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        bsdf = nt.nodes.get("Principled BSDF")
        if not out or not bsdf:
            continue
        if not out.inputs["Surface"].is_linked:
            nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
            fixed.append(name)
    return fixed


def assert_no_procedurals(mats):
    """Acceptance gate: nothing Blender-only may reach the GLB."""
    banned = {'TEX_NOISE', 'TEX_MUSGRAVE', 'TEX_VORONOI', 'BUMP',
              'VALTORGB', 'MAP_RANGE', 'TEX_COORD'}
    bad = []
    for name, mat in mats.items():
        for n in mat.node_tree.nodes:
            if n.type in banned:
                bad.append(f"{name}:{n.type}")
    return bad


# ----------------------------------------------------------------------------
# Phase 6.6 — rotation clearance test
# ----------------------------------------------------------------------------
def world_bbox(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def clearance_report(objs, tilt_rig):
    """Confirm the antenna never intersects the rail across the allowed range."""
    rows = []
    rail = objs["Mounting_Rail"]
    for deg in (0, 2, 5, 8, 10):
        set_downtilt(tilt_rig, deg)
        bpy.context.view_layer.update()
        rlo, rhi = world_bbox(rail)
        gap = 1e9
        for name in ("Antenna_Body", "Pivot_Bracket", "Cooling_Fins"):
            o = objs[name]
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                if rlo.z <= w.z <= rhi.z:          # only where the rail exists
                    gap = min(gap, w.y - rhi.y)
        rows.append((deg, gap))
    set_downtilt(tilt_rig, CFG["downtilt_correct"])
    bpy.context.view_layer.update()
    return rows


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    random.seed(12)
    zc = CFG["mount_height_default"]
    reset_scene()
    mats = make_materials()

    print("[phase 3] concrete pole shaft")
    objs = {"Pole_Shaft": build_pole()}

    print("[phase 4] pole fastening bands")
    objs["Band_Top"] = build_band("Band_Top", zc + CFG["band_spread"] / 2)
    objs["Band_Bottom"] = build_band("Band_Bottom", zc - CFG["band_spread"] / 2)

    print("[phase 5] mounting rail + fixed pivot")
    objs["Mounting_Rail"] = build_rail(zc)
    objs["Pivot_Fixed"] = build_pivot_fixed(zc)

    print("[phase 6] downtilt bracket + hardware")
    objs["Pivot_Bracket"] = build_pivot_bracket(zc)
    objs["Pivot_Hardware"] = build_pivot_hardware(zc)

    print("[phase 7-10] antenna, fins, connectors, cables")
    objs["Antenna_Body"] = build_antenna_body(zc)
    objs["Cooling_Fins"] = build_cooling_fins(zc)
    objs["Connector_Bank"] = build_connector_bank(zc, mats)
    objs["Antenna_Cables"] = build_cables(zc)

    print("[phase 12] materials")
    for entry in [("Pole_Shaft", "MAT_Concrete_Pole"),
                      ("Band_Top", "MAT_Steel_Brushed"),
                      ("Band_Bottom", "MAT_Steel_Brushed"),
                      ("Mounting_Rail", "MAT_Steel_Dark"),
                      ("Pivot_Fixed", "MAT_Steel_Dark"),
                      ("Pivot_Bracket", "MAT_Steel_Dark"),
                      ("Pivot_Hardware", "MAT_Connector_Steel"),
                      ("Antenna_Body", "MAT_Antenna_OffWhite"),
                      ("Cooling_Fins", "MAT_HeatSink_Charcoal"),
                      ("Antenna_Cables", "MAT_Rubber_Black")]:
        assign(objs[entry[0]], *[mats[m] for m in entry[1:]])

    print("[phase 13] component origins + rig + anchors")
    center_origins(objs)
    root, height_rig, tilt_rig = build_rig(objs, zc)
    set_height(height_rig, zc)
    set_downtilt(tilt_rig, CFG["downtilt_correct"])
    bpy.context.view_layer.update()

    print("[phase 6.6] clearance test")
    for deg, gap in clearance_report(objs, tilt_rig):
        print(f"    downtilt {deg:>2}deg -> clearance to rail front {gap:.3f} m")

    build_lighting()
    cams = build_cameras(zc)
    setup_render()

    tris = triangle_count(root)
    print(f"[budget] visible model triangles: {tris}")
    problems = check_names(root)
    print(f"[names] issues: {problems if problems else 'none'}")

    print("[phase 14] UV unwrap + texture bake")
    written = bake_materials(objs, mats)
    relinked = ensure_surface_links(mats)
    if relinked:
        print(f"[phase 14] reconnected surface output on: {relinked}")
    leftovers = assert_no_procedurals(mats)
    print(f"[phase 14] {len(written)} maps written; procedural leftovers: "
          f"{leftovers if leftovers else 'none'}")

    rdir = os.path.join(OUT_DIR, "validation_renders")
    os.makedirs(rdir, exist_ok=True)

    ant_group = ["Antenna_Body", "Cooling_Fins", "Connector_Bank",
                 "Antenna_Cables", "Pivot_Bracket", "Pivot_Hardware"]

    set_downtilt(tilt_rig, CFG["downtilt_correct"])
    render_to(cams["front"], os.path.join(rdir, "01_front.png"))
    render_to(cams["side"], os.path.join(rdir, "02_side.png"))
    render_to(cams["rear"], os.path.join(rdir, "03_rear.png"))
    render_to(cams["quarter"], os.path.join(rdir, "04_three_quarter.png"))

    for n in ant_group:                      # mounting point, unobstructed
        objs[n].hide_render = True
    render_to(cams["mount"], os.path.join(rdir, "05_mounting_point.png"), (1500, 1200))
    for n in ant_group:
        objs[n].hide_render = False

    render_to(cams["wide"], os.path.join(rdir, "06_height_7_5m.png"), (1300, 1800))
    set_downtilt(tilt_rig, 0.0)
    render_to(cams["quarter"], os.path.join(rdir, "07_downtilt_0deg.png"))
    set_downtilt(tilt_rig, CFG["downtilt_correct"])
    render_to(cams["quarter"], os.path.join(rdir, "08_downtilt_5deg.png"))

    # exploded overview — offsets are temporary and reverted before export
    offsets = {"Band_Top": (0, -0.55, 0.30), "Band_Bottom": (0, -0.55, -0.30),
               "Mounting_Rail": (0, 0.10, 0), "Pivot_Fixed": (0, 0.42, 0),
               "Pivot_Bracket": (0, 0.78, 0), "Pivot_Hardware": (0.55, 0.78, 0),
               "Antenna_Body": (0, 1.40, 0), "Cooling_Fins": (0, 1.05, 0.45),
               "Connector_Bank": (0, 1.40, -0.62), "Antenna_Cables": (0, 1.85, -0.55)}
    for n, off in offsets.items():
        objs[n].delta_location = off
    bpy.context.view_layer.update()
    render_to(cams["exploded"], os.path.join(rdir, "09_exploded.png"), (1900, 1400))
    for n in offsets:
        objs[n].delta_location = (0, 0, 0)
    set_downtilt(tilt_rig, CFG["downtilt_correct"])
    bpy.context.view_layer.update()

    print("[export] glb + manifest + blend")
    export_glb(root, os.path.join(OUT_DIR, "lp12_interactive_assembly.glb"))
    export_glb(root, os.path.join(OUT_DIR,
               "lp12_interactive_assembly_meshopt.glb"), meshopt=True)
    write_manifest(os.path.join(OUT_DIR, "lp12_model_manifest.json"))
    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(OUT_DIR, "lp12_interactive_master.blend"))

    print(f"[done] triangles={tris} name_issues={len(problems)}")


if __name__ == "__main__":
    main()
