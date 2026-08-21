"""
build_lp12_v2.py — add mechanical assembly animation to the LP12 model.

Run headless:
    blender --background --python build_lp12_v2.py

Starts from lp12_interactive_master.blend so all baked textures and materials
are reused, then:
  * replaces each solid band with front/back halves plus two bolts,
  * adds separately-animatable rail bolts, pivot bolts and antenna fasteners,
  * inserts the install wrapper rigs required by spec section 6,
  * sets the unassembled rest state (section 9),
  * authors the six clips of section 10 as NLA tracks,
  * exports lp12_interactive_assembly_v2.glb with independent clips.

Design rule from section 9: every install wrapper's ASSEMBLED pose is identity
(loc 0, rot 0, scale 1). Rest state is an offset on the wrapper, so each clip is
simply "animate wrapper from its rest offset back to identity". That keeps final
transforms exact and stops install clips fighting the height/downtilt rigs.
"""

import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix

SRC = "/Users/mosesjeremiah/blender/deliverables/lp12_interactive_master.blend"
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30

# --- geometry constants, matched to the existing model ----------------------
CFG = {
    "band_width": 0.075, "band_thickness": 0.006, "band_segments": 96,
    "mount_z": 7.5, "band_spread": 0.70,
    "pole_dia_at_mount": 0.58, "pole_taper": 0.12, "pole_height": 12.5,
    "kerb": 0.0,
}

CLIPS = {
    "ANIM_01_Bands_Attach":      75,
    "ANIM_02_Rail_Attach":       60,
    "ANIM_03_Pivot_Attach":      54,
    "ANIM_04_Antenna_Mount":     81,
    "ANIM_05_Antenna_Secure":    54,
    "ANIM_06_Connectors_Attach": 60,
}


def pole_radius_at(z):
    r_mount = CFG["pole_dia_at_mount"] / 2.0
    taper_r = CFG["pole_taper"] / 2.0
    frac = CFG["mount_z"] / CFG["pole_height"]
    r_base = r_mount + taper_r * frac
    return r_base - taper_r * (z / CFG["pole_height"])


# ---------------------------------------------------------------- helpers
def link(obj, coll="MODEL"):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    (bpy.data.collections.get(coll) or bpy.context.scene.collection).objects.link(obj)


# Every map on this model is a UV-ISLAND BAKE, not a tiling material. A mesh
# without a TEXCOORD_0 attribute therefore samples the atlas at uv (0, 0),
# which lands in the unbaked background - and that is why the rebuilt pole
# bands rendered black. regrade_textures.py floods that background with the
# island mean so the failure is no longer catastrophic, but a mesh still needs
# real UVs to pick up any surface detail at all.
#
# These are the largest artifact-free windows inside each graded atlas - no
# island edge, no baked outline - as glTF-convention rects (x, y, size) with
# the origin top-left. Projected UVs are remapped into them, so a procedural
# part reads as its material instead of as a slice of somebody else's bake.
ATLAS_PATCH = {
    "MAT_Steel_Brushed":     (0.619, 0.194, 0.139),
    "MAT_Steel_Dark":        (0.002, 0.540, 0.451),
    "MAT_Connector_Steel":   (0.004, 0.603, 0.394),
    "MAT_Connector_Brass":   (0.008, 0.604, 0.389),
    "MAT_HeatSink_Charcoal": (0.389, 0.240, 0.589),
    "MAT_Antenna_OffWhite":  (0.002, 0.478, 0.514),
    "MAT_Concrete_Pole":     (0.004, 0.846, 0.150),
    "MAT_Rubber_Black":      (0.051, 0.434, 0.156),
}


def box_uv(ob, mat_name):
    """Planar-project each face along its dominant normal axis, normalise by
    the object bounds, then remap into the material's clean atlas patch.

    Bounds-normalising rather than tiling by a fixed texel density is
    deliberate: it guarantees every loop lands inside the patch whatever the
    part's size, and the bakes are near-uniform noise, so the density it gives
    up is not visible while an excursion into a neighbouring island would be.
    """
    me = ob.data
    if not me.polygons:
        return
    px, py, ps = ATLAS_PATCH.get(mat_name, (0.25, 0.25, 0.5))
    lo = [min(v.co[i] for v in me.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in me.vertices) for i in range(3)]
    span = max(max(h - l for l, h in zip(lo, hi)), 1e-6)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != axis]
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (co[a] - lo[a]) / span
            v = (co[b] - lo[b]) / span
            # authored in glTF space (origin top-left); Blender's V is flipped
            # and the exporter flips it back.
            uv.data[li].uv = (px + u * ps, 1.0 - (py + v * ps))


def new_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob); link(ob)
    if mat:
        me.materials.append(mat)
        box_uv(ob, mat.name)
    return ob


def new_empty(name, loc=(0, 0, 0), kind='PLAIN_AXES', size=0.1, coll="RIG"):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = kind; e.empty_display_size = size
    e.location = loc
    bpy.context.scene.collection.objects.link(e); link(e, coll)
    return e


def rig_at_parent(name, parent, kind='PLAIN_AXES', size=0.12):
    """Create an install wrapper whose LOCAL identity is the assembled pose.

    The wrapper must be born at its parent's world position: then its local
    transform is (0,0,0) and "animate back to identity" genuinely means
    "return to the mounted pose". Creating it at the component's own position
    instead makes identity mean the world origin, which drags the part to the
    ground the moment the clip seats.
    """
    bpy.context.view_layer.update()
    e = new_empty(name, tuple(parent.matrix_world.translation), kind, size)
    reparent(e, parent)
    e.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    return e


def reparent(child, parent):
    """Parent without moving. matrix_world is lazy — flush before reading it."""
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw


def bm_box(bm, c, s, mi=0):
    cx, cy, cz = c; sx, sy, sz = (v / 2 for v in s)
    v = [bm.verts.new((cx + x * sx, cy + y * sy, cz + z * sz))
         for x, y, z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
                         (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    for f in [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]:
        bm.faces.new([v[i] for i in f]).material_index = mi


def bm_cyl(bm, c, r, d, seg=16, axis='Z', mi=0):
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r, depth=d)
    rot = {'X': Matrix.Rotation(math.radians(90), 4, 'Y'),
           'Y': Matrix.Rotation(math.radians(90), 4, 'X'),
           'Z': Matrix.Identity(4)}[axis]
    bmesh.ops.transform(bm, matrix=rot, verts=g["verts"])
    bmesh.ops.translate(bm, vec=Vector(c), verts=g["verts"])
    for vv in g["verts"]:
        for f in vv.link_faces:
            f.material_index = mi


def band_half(name, z, a0, a1, mat):
    """One half of a circular clamp: an arc strap with a bolt lug at each end.
    Built at the world position it occupies when closed; the rig empty carries
    the open/closed motion."""
    bm = bmesh.new()
    r = pole_radius_at(z) + CFG["band_thickness"] * 0.5
    w, t = CFG["band_width"], CFG["band_thickness"]
    segs = CFG["band_segments"] // 2
    inner, outer = [], []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        for arr, rad in ((inner, r - t / 2), (outer, r + t / 2)):
            arr.append((bm.verts.new((rad*math.cos(a), rad*math.sin(a), z - w/2)),
                        bm.verts.new((rad*math.cos(a), rad*math.sin(a), z + w/2))))
    for i in range(segs):
        i0, i1, o0, o1 = inner[i], inner[i+1], outer[i], outer[i+1]
        bm.faces.new([i0[0], i1[0], i1[1], i0[1]])
        bm.faces.new([o0[1], o1[1], o1[0], o0[0]])
        bm.faces.new([i0[1], i1[1], o1[1], o0[1]])
        bm.faces.new([o0[0], o1[0], i1[0], i0[0]])
    bm.faces.new([inner[0][0], inner[0][1], outer[0][1], outer[0][0]])
    bm.faces.new([outer[-1][0], outer[-1][1], inner[-1][1], inner[-1][0]])
    # bolt lugs at both ends of the arc
    for a in (a0, a1):
        lx, ly = (r + 0.020) * math.cos(a), (r + 0.020) * math.sin(a)
        bm_box(bm, (lx, ly, z), (0.040, 0.040, w * 1.30))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, mat)
    # origin at the pole axis so the half swings/translates cleanly
    ob.data.transform(Matrix.Translation(-Vector((0, 0, z))))
    ob.location = (0, 0, z)
    return ob


def make_bolt(name, loc, radius, length, axis, mat):
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, 0), radius, radius * 1.15, seg=6, axis=axis)          # head
    off = {'X': (-length/2 - radius*0.6, 0, 0), 'Y': (0, -length/2 - radius*0.6, 0),
           'Z': (0, 0, -length/2 - radius*0.6)}[axis]
    bm_cyl(bm, off, radius * 0.52, length, seg=12, axis=axis)               # shaft
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, mat)
    ob.location = loc
    return ob


def enhance_pole(mats):
    """Add the real pole furniture: cast footing with gusset fins and anchor
    bolts, a capping collar with two lifting eyes, and paired step studs up the
    shaft. The base model was a bare tapered cylinder, which read as a prop
    rather than a cast concrete utility pole.

    Built as separate objects so none of it inherits the mount rigs — the pole
    and its furniture stay fixed while Height_Rig and Tilt_Rig move.
    """
    conc = mats.get("MAT_Concrete_Pole")
    steel = mats.get("MAT_Connector_Steel") or mats.get("MAT_Steel_Brushed")
    made = []

    # --- footing: plinth, chamfer course, four gusset fins ------------------
    bm = bmesh.new()
    bm_box(bm, (0, 0, 0.14), (1.46, 1.46, 0.28))            # plinth
    bm_box(bm, (0, 0, 0.34), (1.10, 1.10, 0.14))            # chamfer course
    r0 = pole_radius_at(0.0)
    for k in range(4):
        a = math.pi / 2 * k + math.pi / 4
        dx, dy = math.cos(a), math.sin(a)
        # tapered fin: wide at the plinth, dying into the shaft ~1.1 m up
        pts = [(0.0, 0.42), (0.62, 0.42), (0.0, 1.32)]
        for i in range(len(pts) - 1):
            pass
        vs_out, vs_in = [], []
        for (rr, zz) in ((r0 * 0.92, 0.41), (0.70, 0.41), (r0 * 0.82, 1.34)):
            vs_out.append(bm.verts.new((dx * rr - dy * 0.075, dy * rr + dx * 0.075, zz)))
            vs_in.append(bm.verts.new((dx * rr + dy * 0.075, dy * rr - dx * 0.075, zz)))
        bm.faces.new(vs_out)
        bm.faces.new(list(reversed(vs_in)))
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new([vs_out[i], vs_out[j], vs_in[j], vs_in[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Base", bm, conc))

    # --- anchor bolts on the plinth ----------------------------------------
    bm = bmesh.new()
    for k in range(4):
        a = math.pi / 2 * k + math.pi / 4
        bx, by = math.cos(a) * 0.60, math.sin(a) * 0.60
        bm_cyl(bm, (bx, by, 0.32), 0.024, 0.10, seg=12, axis='Z')
        bm_cyl(bm, (bx, by, 0.385), 0.034, 0.030, seg=6, axis='Z')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Anchor_Bolts", bm, steel))

    # --- cap collar with two lifting eyes ----------------------------------
    top = CFG["pole_height"]
    rt = pole_radius_at(top)
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, top + 0.03), rt + 0.030, 0.16, seg=40, axis='Z')
    bm_cyl(bm, (0, 0, top + 0.12), rt + 0.010, 0.06, seg=40, axis='Z')
    for sx in (-1, 1):
        # eye: a ring standing proud of the cap
        cx = sx * (rt * 0.55)
        segs = 20
        for i in range(segs):
            a0 = 2 * math.pi * i / segs
            a1 = 2 * math.pi * (i + 1) / segs
            for (aa, ab) in ((a0, a1),):
                p0 = (cx + 0.055 * math.cos(aa), 0.018, top + 0.20 + 0.055 * math.sin(aa))
                p1 = (cx + 0.055 * math.cos(ab), 0.018, top + 0.20 + 0.055 * math.sin(ab))
                q0 = (cx + 0.055 * math.cos(aa), -0.018, top + 0.20 + 0.055 * math.sin(aa))
                q1 = (cx + 0.055 * math.cos(ab), -0.018, top + 0.20 + 0.055 * math.sin(ab))
                i0 = (cx + 0.032 * math.cos(aa), 0.018, top + 0.20 + 0.032 * math.sin(aa))
                i1 = (cx + 0.032 * math.cos(ab), 0.018, top + 0.20 + 0.032 * math.sin(ab))
                j0 = (cx + 0.032 * math.cos(aa), -0.018, top + 0.20 + 0.032 * math.sin(aa))
                j1 = (cx + 0.032 * math.cos(ab), -0.018, top + 0.20 + 0.032 * math.sin(ab))
                V = [bm.verts.new(v) for v in (p0, p1, q1, q0, i0, i1, j1, j0)]
                bm.faces.new([V[0], V[1], V[2], V[3]])      # outer
                bm.faces.new([V[7], V[6], V[5], V[4]])      # inner
                bm.faces.new([V[0], V[4], V[5], V[1]])      # front rim
                bm.faces.new([V[3], V[2], V[6], V[7]])      # back rim
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Cap", bm, steel))

    # --- paired step studs, kept clear of the 7.0-8.0 m mounting zone -------
    bm = bmesh.new()
    for z in (2.20, 4.60, 6.10, 9.60, 10.80):
        r = pole_radius_at(z)
        for sx in (-1, 1):
            bm_cyl(bm, (sx * (r + 0.085), 0, z), 0.017, 0.17, seg=10, axis='X')
            bm_cyl(bm, (sx * (r + 0.168), 0, z), 0.026, 0.020, seg=10, axis='X')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Step_Studs", bm, steel))
    return made


# ---------------------------------------------------------------- rebuild
def rebuild_bands(mats):
    """Replace each solid strap with front half + back half + 2 bolts, so the
    learner sees the clamp close around the pole (spec 7: never animate a
    closed ring through the shaft)."""
    made = {}
    for label, dz in (("Top", +CFG["band_spread"] / 2), ("Bottom", -CFG["band_spread"] / 2)):
        z = CFG["mount_z"] + dz
        old = bpy.data.objects.get(f"Band_{label}")
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        steel = mats.get("MAT_Steel_Brushed")
        conn = mats.get("MAT_Connector_Steel", steel)
        front = band_half(f"Band_{label}_Front", z, math.radians(-78), math.radians(78), steel)
        back = band_half(f"Band_{label}_Back", z, math.radians(102), math.radians(258), steel)
        r = pole_radius_at(z) + 0.030
        bl = make_bolt(f"Band_{label}_Bolt_L", (-r * 0.99, 0.0, z), 0.016, 0.055, 'X', conn)
        br = make_bolt(f"Band_{label}_Bolt_R", (r * 0.99, 0.0, z), 0.016, 0.055, 'X', conn)
        bl.rotation_euler = (0, 0, math.radians(180))
        made[label] = (front, back, bl, br)
    return made


def add_fasteners(mats):
    """Rail bolts, pivot bolts and antenna fasteners as independent objects —
    section 7 requires every visibly rotating bolt to be separately keyable."""
    conn = mats.get("MAT_Connector_Steel") or mats.get("MAT_Steel_Brushed")
    zc = CFG["mount_z"]
    y0 = pole_radius_at(zc) + 0.006
    y_front = y0 + 0.095

    rail_bolts = []
    for i, dz in enumerate((-0.28, -0.10, 0.10, 0.28)):
        rail_bolts.append(make_bolt(f"Rail_Bolt_{i+1:02d}",
                                    (0.0, y_front + 0.012, zc + dz), 0.013, 0.045, 'Y', conn))

    hy = y0 + 0.32 * 0.86
    pivot_bolts = []
    for i, sx in enumerate((-1, 1)):
        b = make_bolt(f"Pivot_Bolt_{i+1:02d}", (sx * 0.112, hy, zc), 0.024, 0.060, 'X', conn)
        if sx < 0:
            b.rotation_euler = (0, 0, math.radians(180))
        pivot_bolts.append(b)

    acy = hy + 0.207
    fasteners = []
    for i, (sx, sz) in enumerate(((-1, 1), (1, 1), (-1, -1), (1, -1))):
        fasteners.append(make_bolt(f"Antenna_Fastener_{i+1:02d}",
                                   (sx * 0.085, acy - 0.02, zc + sz * 0.22),
                                   0.011, 0.038, 'Y', conn))
    return rail_bolts, pivot_bolts, fasteners


def build_rig(bands, rail_bolts, pivot_bolts, fasteners):
    """Insert the install wrappers of section 6 without disturbing the working
    Height_Rig / Tilt_Rig chain."""
    D = bpy.data.objects
    root = D["LP12_ROOT"]
    height_rig = D["Height_Rig"]
    tilt_rig = D["Tilt_Rig"]

    # Mount_System hangs off Height_Rig, NOT the root.
    #
    # The bands and rail are what physically clamp the assembly to the pole, so
    # raising the mount height has to carry them with it. Parented to the root
    # they stayed put while the bracket and antenna rose, which reads as the
    # antenna sliding up a stationary set of bands. The pivot block below
    # already had this right ("so height still carries everything"); the mount
    # system was the one branch that missed it.
    #
    # reparent() preserves world position, and the exporter bakes the parent
    # inverse into the child's local transform, so the authored pose is
    # unchanged - only what moves with the rig changes.
    mount = new_empty("Mount_System", (0, 0, 0), 'PLAIN_AXES', 0.3)
    reparent(mount, height_rig)

    rigs = {}
    for label in ("Top", "Bottom"):
        z = CFG["mount_z"] + (CFG["band_spread"] / 2 if label == "Top" else -CFG["band_spread"] / 2)
        rig = new_empty(f"Band_{label}_Rig", (0, 0, z), 'SPHERE', 0.12)
        reparent(rig, mount)
        for ob in bands[label]:
            reparent(ob, rig)
        rigs[f"Band_{label}_Rig"] = rig

    zc = CFG["mount_z"]
    rail_rig = rig_at_parent("Rail_Install_Rig", mount, 'CUBE')
    reparent(D["Mounting_Rail"], rail_rig)
    rail_bolt_grp = rig_at_parent("Rail_Bolts", rail_rig, 'PLAIN_AXES', 0.06)
    for b in rail_bolts:
        reparent(b, rail_bolt_grp)
    rigs["Rail_Install_Rig"] = rail_rig

    # Pivot install sits under Height_Rig so height still carries everything.
    hy = pole_radius_at(zc) + 0.006 + 0.32 * 0.86
    pivot_rig = rig_at_parent("Pivot_Install_Rig", height_rig, 'CIRCLE')
    for n in ("Pivot_Fixed",):
        if n in D:
            reparent(D[n], pivot_rig)
    pivot_bolt_grp = rig_at_parent("Pivot_Bolts", pivot_rig, 'PLAIN_AXES', 0.06)
    for b in pivot_bolts:
        reparent(b, pivot_bolt_grp)
    rigs["Pivot_Install_Rig"] = pivot_rig

    # Antenna install wrapper lives under Tilt_Rig, so the mount clip cannot
    # fight runtime downtilt (spec 7 "Antenna").
    acy = hy + 0.207
    ant_rig = rig_at_parent("Antenna_Install_Rig", tilt_rig, 'CUBE', 0.14)
    for n in ("Antenna_Body", "Cooling_Fins", "Connector_Bank",
              "Pivot_Bracket", "Pivot_Hardware"):
        if n in D:
            reparent(D[n], ant_rig)
    fast_grp = rig_at_parent("Antenna_Fasteners", ant_rig, 'PLAIN_AXES', 0.06)
    for b in fasteners:
        reparent(b, fast_grp)
    rigs["Antenna_Install_Rig"] = ant_rig

    conn_rig = rig_at_parent("Connector_Install_Rig", ant_rig, 'PLAIN_AXES', 0.10)
    if "Antenna_Cables" in D:
        reparent(D["Antenna_Cables"], conn_rig)
    rigs["Connector_Install_Rig"] = conn_rig

    # focus nodes for camera framing
    targets = new_empty("Interaction_Targets", (0, 0, 0), 'PLAIN_AXES', 0.2)
    reparent(targets, root)
    focus = {
        "Focus_LP12":       (0, acy * 0.5, zc),
        "Focus_Bands":      (0, 0.0, zc),
        "Focus_Rail":       (0, y_front_of(zc), zc),
        "Focus_Pivot":      (0, hy, zc),
        "Focus_Antenna":    (0, acy, zc),
        "Focus_Connectors": (0, acy, zc - 0.62),
        "Focus_Height":     (0, y_front_of(zc), zc),
        "Focus_Downtilt":   (0, hy, zc),
        "Focus_Coverage":   (0, acy + 1.2, zc - 0.2),
    }
    for n, loc in focus.items():
        if n not in D:
            reparent(new_empty(n, loc, 'SPHERE', 0.07), targets)
    return rigs, mount


def y_front_of(zc):
    return pole_radius_at(zc) + 0.006 + 0.095


# ---------------------------------------------------------------- animation
def action_fcurves(action):
    """Blender 5.x replaced Action.fcurves with slotted layers/channelbags."""
    if action is None:
        return []
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            for cb in getattr(strip, "channelbags", []):
                out.extend(cb.fcurves)
    return out


def start_action(obj, clip):
    obj.animation_data_create()
    act = bpy.data.actions.new(f"{clip}__{obj.name}")
    act.use_fake_user = True
    obj.animation_data.action = act
    return act


def push_to_nla(obj, clip, act):
    """One NLA track per clip name; the glTF exporter groups same-named tracks
    across objects into a single animation (spec 19)."""
    ad = obj.animation_data
    ad.action = None
    track = ad.nla_tracks.new()
    track.name = clip
    track.strips.new(act.name, 1, act)


def key(obj, frame, loc=None, rot=None, interp='BEZIER', easing=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=frame)
    act = obj.animation_data.action if obj.animation_data else None
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            if abs(kp.co.x - frame) < 0.5:
                kp.interpolation = interp
                if easing:
                    kp.easing = easing


def anim_bands(bands, clip):
    """Halves approach, close, then bolts rotate 900 deg while seating."""
    for idx, label in enumerate(("Top", "Bottom")):
        lag = idx * 3                       # 2-4 frame offset for readability
        front, back, bl, br = bands[label]
        for half, sy in ((front, 1.0), (back, -1.0)):
            z = half.location.z
            act = start_action(half, clip)
            key(half, 1 + lag, loc=(0, sy * 0.26, z), interp='BEZIER')
            key(half, 17 + lag, loc=(0, sy * 0.085, z), interp='BEZIER')
            key(half, 28 + lag, loc=(0, 0, z), interp='BEZIER', easing='EASE_OUT')
            key(half, 65 + lag, loc=(0, 0, z))
            key(half, 70 + lag, loc=(0, sy * 0.0016, z))     # <1% settle
            key(half, 75, loc=(0, 0, z), interp='BEZIER', easing='EASE_OUT')
            push_to_nla(half, clip, act)
        for bolt, sx in ((bl, -1.0), (br, 1.0)):
            base = bolt.location.copy()
            spin = bolt.rotation_euler.z
            act = start_action(bolt, clip)
            key(bolt, 1, loc=(base.x + sx * 0.07, base.y, base.z),
                rot=(0, 0, spin))
            key(bolt, 28, loc=(base.x + sx * 0.07, base.y, base.z),
                rot=(0, 0, spin))
            key(bolt, 65, loc=(base.x, base.y, base.z),
                rot=(math.radians(900) * sx, 0, spin), interp='LINEAR')
            key(bolt, 75, loc=(base.x, base.y, base.z),
                rot=(math.radians(900) * sx, 0, spin),
                interp='BEZIER', easing='EASE_OUT')
            push_to_nla(bolt, clip, act)


def anim_wrapper(rig, clip, rest_loc, frames, settle=None):
    """Approach -> align -> seat, ending exactly at identity (spec 9)."""
    f_in, f_align, f_seat, f_end = frames
    act = start_action(rig, clip)
    key(rig, f_in, loc=rest_loc, interp='BEZIER')
    key(rig, f_align, loc=tuple(v * 0.22 for v in rest_loc), interp='BEZIER')
    key(rig, f_seat, loc=(0, 0, 0), interp='BEZIER', easing='EASE_OUT')
    if settle:
        key(rig, f_seat + max(2, (f_end - f_seat) // 2), loc=settle)
    key(rig, f_end, loc=(0, 0, 0), interp='BEZIER', easing='EASE_OUT')
    push_to_nla(rig, clip, act)


def anim_bolts(bolts, clip, axis, insert, f_start, f_end, turns=900, stagger=3):
    for i, bolt in enumerate(bolts):
        lag = i * stagger
        base = bolt.location.copy()
        rz = bolt.rotation_euler.z
        off = {'X': Vector((insert, 0, 0)), 'Y': Vector((0, insert, 0)),
               'Z': Vector((0, 0, insert))}[axis]
        rot_axis = {'X': lambda a: (a, 0, rz), 'Y': lambda a: (0, a, rz),
                    'Z': lambda a: (0, 0, rz + a)}[axis]
        act = start_action(bolt, clip)
        key(bolt, f_start + lag, loc=tuple(base + off), rot=rot_axis(0))
        key(bolt, f_end - 6 + lag, loc=tuple(base),
            rot=rot_axis(math.radians(turns)), interp='LINEAR')
        key(bolt, f_end, loc=tuple(base), rot=rot_axis(math.radians(turns)),
            interp='BEZIER', easing='EASE_OUT')
        push_to_nla(bolt, clip, act)


# ---------------------------------------------------------------- rest state
def apply_rest_state(rigs, bands):
    """Section 9: the saved/default pose is the UNASSEMBLED start of the task.
    Runtime restores assembled poses by holding each clip's last frame."""
    for label in ("Top", "Bottom"):
        front, back, bl, br = bands[label]
        z = front.location.z
        front.location = (0, 0.26, z)
        back.location = (0, -0.26, z)
        bl.location.x -= 0.07
        br.location.x += 0.07
    for name, offset in REST.items():
        rigs[name].location = offset      # local base is (0,0,0) = assembled


REST = {
    "Rail_Install_Rig":      (0.0, 0.55, 0.16),
    "Pivot_Install_Rig":     (0.0, 0.42, 0.0),
    "Antenna_Install_Rig":   (0.62, 0.46, 0.30),
    "Connector_Install_Rig": (0.0, 0.0, -0.34),
}


def validate(rigs, bands, rail_bolts, pivot_bolts, fasteners):
    problems = []
    D = bpy.data.objects
    required = ["LP12_ROOT", "Pole_Shaft", "Mount_System", "Height_Rig", "Tilt_Rig",
                "Mounting_Rail", "Antenna_Body", "Beam_Origin", "Coverage_Target"]
    required += [f"Band_{l}_{p}" for l in ("Top", "Bottom")
                 for p in ("Front", "Back", "Bolt_L", "Bolt_R")]
    required += [f"Rail_Bolt_{i:02d}" for i in range(1, 5)]
    required += list(rigs.keys())
    for n in required:
        if n not in D:
            problems.append(f"missing node: {n}")
    for ob in D:
        if any(s < 0 for s in ob.scale):
            problems.append(f"negative scale: {ob.name}")
        if "." in ob.name and ob.name.split(".")[-1].isdigit():
            problems.append(f"duplicate-suffixed name: {ob.name}")
    return problems


# Reference look: the hardware is HOT-DIP GALVANISED, not dark steel.
#
# The albedo and roughness correction does NOT live here. glTF materials are
# baseColorTexture x baseColorFactor only, so a node-graph multiply is dropped
# on export and the dark bake ships unchanged; and a roughness value set on the
# BSDF is ignored the moment the ORM map is linked, which it always is. Both
# corrections are therefore made in the texture pixels, by
# deliverables/source/regrade_textures.py, which must be run before this
# script. Metalness is the one channel the exporter does carry as a factor, so
# it is the one thing set here.
METALNESS = {
    "MAT_Steel_Brushed": 0.92, "MAT_Steel_Dark": 0.90,
    "MAT_Connector_Steel": 0.95, "MAT_Connector_Brass": 0.95,
    "MAT_HeatSink_Charcoal": 0.72,
}

# Albedo the graded atlases are authored to present, for the assertion below.
# Kept in step with TARGET in regrade_textures.py.
GRADED_ALBEDO = {
    "steel_brushed": 206, "steel_dark": 150, "connector_steel": 214,
    "connector_brass": 188, "heatsink_charcoal": 146,
    "antenna_offwhite": 232, "concrete_pole": 140, "rubber_black": 52,
}


def set_metalness():
    for name, m in METALNESS.items():
        mat = bpy.data.materials.get(name)
        if not mat or not mat.node_tree:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Metallic"].default_value = m


# --- network coverage dome ---------------------------------------------------
#
# Built at UNIT radius and scaled at runtime, because the radius is not a fixed
# property of the model - it is derived from the mount height and downtilt the
# learner has dialled in:
#
#     radius = height / tan(downtilt)
#
# which is the ground distance at which the beam centre lands. At the correct
# 7.5 m / 5 deg that is ~86 m; at 10 deg it tightens to ~43 m. Baking a radius
# into the mesh would throw that relationship away, so the geometry stays unit
# and both consumers - the installation viewport and the network map - scale
# the same object from the same formula.
#
# It sits on LP12_ROOT rather than under Height_Rig or Tilt_Rig: the dome
# represents coverage on the ground around the site, so it must not inherit the
# mast's height offset or tilt rotation. Hidden by default; the app turns it on.
COVERAGE = {"segments": 64, "rings": 14, "max_radius_m": 250.0}


def rebuild_cables(mats):
    """Route the feeder cables properly: gland -> service loop -> pole -> cleat.

    The originals were three bezier curves that bellied outward under gravity
    and then simply stopped in mid-air, unattached to anything. Real feeders
    leave the connector glands, carry a service loop so the run can be dressed
    and re-terminated, then turn back to the pole and are cleated to it. Ending
    a cable in free space is what made the assembly read as unfinished.

    Rebuilt here rather than in build_lp12.py so the master's baked textures are
    not disturbed - the same reason the bands and fasteners are rebuilt in v2.
    The mesh keeps the name Antenna_Cables and its parent, so ANIM_06 (which
    animates Connector_Install_Rig, not the mesh) is untouched.
    """
    old = bpy.data.objects.get("Antenna_Cables")
    parent = old.parent if old else None
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    bank = bpy.data.objects.get("Connector_Bank")
    bpy.context.view_layer.update()
    bb = [bank.matrix_world @ Vector(c) for c in bank.bound_box]
    x_lo, x_hi = min(v.x for v in bb), max(v.x for v in bb)
    y_c = sum(v.y for v in bb) / 8.0
    z_ports = min(v.z for v in bb)

    curve = bpy.data.curves.new("Antenna_Cables", 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.011
    curve.bevel_resolution = 8
    curve.resolution_u = 12

    n = 3
    z_cleat = z_ports - 1.02

    def on_pole(x, z, standoff):
        """Y of the pole surface at this x, plus a standoff.

        The pole is a tapered cylinder, so the face is at
        sqrt(r(z)^2 - x^2), not at r(z). Using the radius directly floats the
        run off the surface everywhere except dead centre, which is what left
        the cables hanging beside the pole rather than dressed against it.
        """
        r = pole_radius_at(z)
        inner = max(r * r - x * x, 0.0) ** 0.5
        return inner + standoff

    for i in range(n):
        t = (i + 0.5) / n
        x = x_lo + (x_hi - x_lo) * t
        belly = 0.055 + i * 0.012
        # Constant depth: the three runs sit side by side in X, all lying the
        # same small distance off the face. Staggering the standoff instead
        # floated the outer run 6.7 cm proud of the pole, which reads as
        # cable hanging in space rather than dressed against the shaft.
        stand = 0.016

        # Each run stays in its OWN vertical plane: x is held constant from the
        # moment it turns toward the pole. The first attempt scaled x toward the
        # axis at every step, which collapsed all three runs onto the centre
        # line - and with the control points nearly colinear the AUTO handles
        # overshot hard, swinging the curve out to x -0.52 and y -0.35, i.e.
        # round the back of the pole. Holding x makes the descent a straight
        # vertical the handles cannot bend.
        pts = [
            (x, y_c, z_ports - 0.012),                                  # gland
            (x, y_c + 0.020, z_ports - 0.085),                          # strain relief
            (x * 1.06, y_c + belly, z_ports - 0.215),                   # loop, outward
            (x * 1.02, y_c * 0.72, z_ports - 0.360),                    # loop closing
            (x, on_pole(x, z_ports - 0.52, stand + 0.045), z_ports - 0.52),
            (x, on_pole(x, z_ports - 0.66, stand), z_ports - 0.66),     # on the face
            (x, on_pole(x, z_cleat + 0.06, stand), z_cleat + 0.06),     # vertical run
            (x, on_pole(x, z_cleat - 0.18, stand), z_cleat - 0.18),     # past the cleat
        ]
        spl = curve.splines.new('BEZIER')
        spl.bezier_points.add(len(pts) - 1)
        for k, (bp, pt) in enumerate(zip(spl.bezier_points, pts)):
            bp.co = pt
            # Straight below the turn: VECTOR handles keep the descent dead
            # vertical instead of letting AUTO round it back into the pole.
            kind = 'VECTOR' if k >= 5 else 'AUTO'
            bp.handle_left_type = bp.handle_right_type = kind

    ob = bpy.data.objects.new("Antenna_Cables", curve)
    bpy.context.scene.collection.objects.link(ob)
    link(ob)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = "Antenna_Cables"
    if mats.get("MAT_Rubber_Black"):
        ob.data.materials.clear()
        ob.data.materials.append(mats["MAT_Rubber_Black"])
    box_uv(ob, "MAT_Rubber_Black")        # convert() bypasses new_obj
    if parent:
        reparent(ob, parent)

    # Cleat: a bar across the three runs with two bolts into the pole. This is
    # what makes the cable look terminated rather than dangling.
    y_face = on_pole(0.0, z_cleat, 0.0)
    span = abs(x_hi - x_lo) + 0.075        # wide enough to cross all runs
    bm = bmesh.new()
    # Sits just outside the cable envelope (centres at +0.016, radius 0.011,
    # so they occupy +0.005..+0.027) and clamps across it.
    bm_box(bm, (0.0, y_face + 0.042, z_cleat), (span, 0.024, 0.032))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    cleat = new_obj("Cable_Cleat", bm, mats.get("MAT_Steel_Dark"))
    # On Mount_System, not the root: the cleat holds the cable against the pole
    # at a fixed distance below the enclosure, so it has to ride the height rig
    # with the cables it clamps. Left on the root it stays put while the run
    # rises, and the cable pulls straight through it.
    reparent(cleat, bpy.data.objects["Mount_System"])

    bolts = []
    for k, sx in enumerate((-1, 1)):
        b = make_bolt(f"Cable_Cleat_Bolt_{k+1:02d}",
                      (sx * (span * 0.5 - 0.018), y_face + 0.058, z_cleat),
                      0.011, 0.055, 'Y', mats.get("MAT_Connector_Steel"))
        reparent(b, bpy.data.objects["Mount_System"])
        bolts.append(b)

    print(f"[v2] cables rerouted: {n} runs, gland -> loop -> pole -> cleat")
    return ob, cleat, bolts


def build_coverage_dome(mats):
    """Unit hemisphere sitting on the ground, centred on the pole axis."""
    mat = bpy.data.materials.get("MAT_Coverage_Dome")
    if not mat:
        mat = bpy.data.materials.new("MAT_Coverage_Dome")
        if bpy.app.version < (5, 0, 0):
            mat.use_nodes = True
        b = mat.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Base Color"].default_value = (0.129, 0.878, 0.816, 1.0)
            b.inputs["Metallic"].default_value = 0.0
            b.inputs["Roughness"].default_value = 0.55
            b.inputs["Alpha"].default_value = 0.16
            em = b.inputs.get("Emission Color")
            if em:
                em.default_value = (0.129, 0.878, 0.816, 1.0)
            es = b.inputs.get("Emission Strength")
            if es:
                es.default_value = 0.35
        # glTF carries this through as alphaMode BLEND.
        try:
            mat.blend_method = 'BLEND'
        except (AttributeError, TypeError):
            pass
        # Double-sided on purpose. A single-sided shell vanishes the moment the
        # camera is inside it, and at a realistic radius the camera usually IS
        # inside it - the whole point is that coverage extends well past the
        # pole. glTF exports this as doubleSided, which three.js reads as
        # THREE.DoubleSide.
        mat.use_backface_culling = False

    seg, rings = COVERAGE["segments"], COVERAGE["rings"]
    bm = bmesh.new()
    grid = []
    for r in range(rings + 1):                      # equator -> apex
        phi = (math.pi / 2) * r / rings
        z, rad = math.sin(phi), math.cos(phi)
        if r == rings:
            grid.append(None)                       # single apex vertex
            apex = bm.verts.new((0.0, 0.0, 1.0))
            break
        grid.append([bm.verts.new((rad * math.cos(2 * math.pi * i / seg),
                                   rad * math.sin(2 * math.pi * i / seg), z))
                     for i in range(seg)])
    for r in range(len(grid) - 2):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new([grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]])
    for i in range(seg):                            # cap to the apex
        bm.faces.new([grid[-2][i], grid[-2][(i + 1) % seg], apex])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    ob = new_obj("Coverage_Dome", bm, mat)
    ob.location = (0.0, 0.0, 0.0)
    ob["coverage_max_radius_m"] = COVERAGE["max_radius_m"]
    ob["coverage_radius_formula"] = "height_m / tan(downtilt_rad)"
    ob.hide_render = True                           # never in a product render
    reparent(ob, bpy.data.objects["LP12_ROOT"])
    print(f"[v2] coverage dome: unit hemisphere, {seg}x{rings}, hidden by default")
    return ob


def shade_smooth_all(angle_deg=32.0):
    """Angle-based smooth shading on every mesh.

    24 of 33 meshes shipped entirely flat-shaded, so curved surfaces - the
    bands, the bolt shanks, the tapered pole - resolved as facets and gave the
    light nothing continuous to model. Angle-based rather than blanket smooth:
    the hard edges of the enclosure, brackets and lugs must stay hard, and this
    keeps every silhouette exactly where it was.

    Non-destructive. On 4.1+ this is a "Smooth by Angle" modifier; the operator
    is used where available so the file matches what an artist would author by
    hand, with a direct fallback for older builds.
    """
    done = 0
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.data.polygons:
            continue
        for poly in ob.data.polygons:
            poly.use_smooth = True
        try:
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
        except (AttributeError, RuntimeError):
            # Pre-4.1 path: mesh-level auto smooth.
            if hasattr(ob.data, "use_auto_smooth"):
                ob.data.use_auto_smooth = True
                ob.data.auto_smooth_angle = math.radians(angle_deg)
        done += 1
    print(f"[v2] smooth shading applied to {done} meshes at {angle_deg:g} deg")


def check_textures_graded():
    """Refuse to build against ungraded bakes.

    The failure this guards is silent: an ungraded atlas still exports, still
    renders, and simply looks like dark plastic - which is how the black bands
    survived a full build and export unnoticed. A pristine bake reads far below
    its graded target, so one sample tells the two apart.
    """
    stale = []
    for im in bpy.data.images:
        if not im.name.endswith("_base_color"):
            continue
        key = "_".join(im.name.split("_")[:2])
        want = GRADED_ALBEDO.get(key)
        if want is None:
            continue
        try:
            im.reload()
            px = im.pixels[:]
        except (RuntimeError, ReferenceError):
            stale.append(f"{im.name}: unreadable ({im.filepath})")
            continue
        n = len(px) // 4
        if not n:
            stale.append(f"{im.name}: no data ({im.filepath})")
            continue
        step = max(1, n // 8192)
        lit = [px[i * 4] for i in range(0, n, step) if px[i * 4] > 0.02]
        if not lit:
            stale.append(f"{im.name}: fully black")
            continue
        # pixels[] is linear; the targets are sRGB
        mean = sum(lit) / len(lit)
        srgb = (1.055 * mean ** (1 / 2.4) - 0.055) * 255 if mean > 0.0031308 \
            else mean * 12.92 * 255
        if srgb < want * 0.75:
            stale.append(f"{im.name}: island ~{srgb:.0f}, expected ~{want}")
    if stale:
        raise SystemExit(
            "[v2] textures are not graded - run regrade_textures.py first:\n  "
            + "\n  ".join(stale))


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    scn = bpy.context.scene
    scn.render.fps = FPS
    mats = {m.name: m for m in bpy.data.materials if m.name.startswith("MAT_")}
    print(f"[v2] source loaded, {len(mats)} materials")

    check_textures_graded()
    set_metalness()
    print('[v2] textures verified graded; metalness applied')
    pole_parts = enhance_pole(mats)
    print(f"[v2] pole furniture: {[o.name for o in pole_parts]}")
    bands = rebuild_bands(mats)
    rail_bolts, pivot_bolts, fasteners = add_fasteners(mats)
    print("[v2] split bands + independent fasteners built")

    rigs, mount = build_rig(bands, rail_bolts, pivot_bolts, fasteners)

    # Cables are rebuilt HERE, before the clips are authored and before
    # apply_rest_state runs. Every install wrapper's assembled pose is identity
    # by design, so this is the only window in which reparenting the cable to
    # Connector_Install_Rig records the correct assembled transform. Called
    # after apply_rest_state instead, reparent() preserves the world position of
    # a rig sitting at its REST offset and bakes that offset in permanently -
    # which put the whole vertical run at y -0.46, round the back of the pole.
    rebuild_cables(mats)
    for ob in pole_parts:                      # fixed furniture, never rigged
        reparent(ob, bpy.data.objects["LP12_ROOT"])
    bpy.context.view_layer.update()
    print("[v2] install wrappers inserted")

    # --- author the six clips (spec 10). Each keys only its own components. ---
    anim_bands(bands, "ANIM_01_Bands_Attach")

    anim_wrapper(rigs["Rail_Install_Rig"], "ANIM_02_Rail_Attach",
                 REST["Rail_Install_Rig"], (1, 17, 28, 60), settle=(0, 0.0018, 0))
    anim_bolts(rail_bolts, "ANIM_02_Rail_Attach", 'Y', 0.06, 28, 60, turns=720, stagger=3)

    anim_wrapper(rigs["Pivot_Install_Rig"], "ANIM_03_Pivot_Attach",
                 REST["Pivot_Install_Rig"], (1, 14, 25, 54))
    anim_bolts(pivot_bolts, "ANIM_03_Pivot_Attach", 'X', 0.05, 25, 54, turns=720, stagger=3)

    anim_wrapper(rigs["Antenna_Install_Rig"], "ANIM_04_Antenna_Mount",
                 REST["Antenna_Install_Rig"], (1, 20, 47, 81), settle=(0, 0, -0.004))

    anim_bolts(fasteners, "ANIM_05_Antenna_Secure", 'Y', 0.045, 1, 54,
               turns=900, stagger=3)

    anim_wrapper(rigs["Connector_Install_Rig"], "ANIM_06_Connectors_Attach",
                 REST["Connector_Install_Rig"], (1, 19, 38, 60))
    print(f"[v2] authored {len(CLIPS)} clips")

    apply_rest_state(rigs, bands)
    bpy.context.view_layer.update()

    build_coverage_dome(mats)
    shade_smooth_all()

    problems = validate(rigs, bands, rail_bolts, pivot_bolts, fasteners)
    print(f"[v2] validation: {problems if problems else 'clean'}")

    scn.frame_start, scn.frame_end = 1, max(CLIPS.values())
    blend_out = os.path.join(OUT_DIR, "lp12_interactive_assembly_v2.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_out)

    root = bpy.data.objects["LP12_ROOT"]
    sel, stack = [], [root]
    while stack:
        o = stack.pop(); sel.append(o); stack.extend(o.children)
    bpy.ops.object.select_all(action='DESELECT')
    for o in sel:
        if not o.name.startswith(("CAM_", "LGT_")):
            o.select_set(True)
    bpy.context.view_layer.objects.active = root

    glb = os.path.join(OUT_DIR, "lp12_interactive_assembly_v2.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format='GLB', use_selection=True,
        export_apply=False,                       # modifiers already applied
        export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True, export_materials='EXPORT',
        export_image_format='WEBP', export_image_quality=88,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',       # one glTF clip per track name
        export_bake_animation=False,
        export_optimize_animation_size=False,
    )
    print(f"[v2] exported {os.path.basename(glb)} "
          f"({os.path.getsize(glb)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
