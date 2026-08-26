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
    # 260 mm at the mount, not 580. Measured against the reference photo:
    # the shaft is appreciably narrower than the radio enclosure bolted to
    # it, where at 580 the two were the same width and the pole read as a
    # concrete column rather than a galvanised street pole. Every part that
    # touches the shaft is placed through pole_radius_at(), so the bands,
    # rail, pivot, cabling and fittings all follow it in.
    "pole_dia_at_mount": 0.26, "pole_taper": 0.055, "pole_height": 12.5,
    "kerb": 0.0,
}

CFG_DOWNTILT = 5.0   # mirrors build_lp12.py CFG["downtilt_correct"]

CLIPS = {
    "ANIM_01_Bands_Attach":      75,
    "ANIM_02_Rail_Attach":       60,
    "ANIM_03_Pivot_Attach":      54,
    "ANIM_04_Antenna_Mount":     81,
    "ANIM_05_Antenna_Secure":    54,
    "ANIM_06_Connectors_Attach": 60,
    # The install does not end when the last connector is torqued. The antenna
    # still has to be pointed, and pointing is two separate adjustments made
    # against two separate scales — the azimuth ring at the bands and the tilt
    # quadrant at the bracket. Both are pure TRS on rigs that already exist,
    # which is the only kind of animation glTF carries reliably.
    "ANIM_07_Azimuth_Set":       54,
    "ANIM_08_Downtilt_Set":      48,
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
    "MAT_Pole_Galvanised":   (0.619, 0.194, 0.139),
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


def make_pole_metal(mats):
    """Swap the pole from cast concrete to galvanised steel.

    The reference is a steel tube — a spun, tapered, hot-dip galvanised column,
    not a cast concrete post. Only Pole_Shaft and Pole_Base ever carried
    MAT_Concrete_Pole, so this is a two-object change.

    The UVs have to be rebuilt, not just the material swapped. box_uv() remaps
    every loop into the atlas patch belonging to a specific material NAME; the
    shaft's existing UVs point at the concrete patch, so leaving them would
    sample the steel atlas at concrete coordinates and pull in whatever happens
    to sit there.
    """
    src = mats.get("MAT_Steel_Brushed")
    if not src:
        return
    steel = bpy.data.materials.get("MAT_Pole_Galvanised")
    if steel is None:
        steel = src.copy()
        steel.name = "MAT_Pole_Galvanised"
        bsdf = next((n for n in steel.node_tree.nodes
                     if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            # Brushed steel is authored at metallic 0.92, and a near-perfect
            # mirror in a scene with no reflection probes and a flat world has
            # nothing to reflect: the pole rendered essentially black, which is
            # the opposite of the galvanised column in the reference. Half
            # metallic keeps the sheen while letting the albedo carry the tone.
            bsdf.inputs["Metallic"].default_value = 0.30
            bsdf.inputs["Roughness"].default_value = 0.45
            # Flat albedo, texture unlinked. At 0.30 metallic the base colour
            # is what carries the tone, and the brushed-steel bake is a dark
            # 0.46 grey — with the sky above and unlit tarmac below, the shaft
            # rendered light at the top and black from about 2.5 m down. A
            # galvanised column is one even tone the whole way up.
            for l in [l for l in steel.node_tree.links
                      if l.to_socket == bsdf.inputs["Base Color"]]:
                steel.node_tree.links.remove(l)
            bsdf.inputs["Base Color"].default_value = (0.545, 0.556, 0.572, 1.0)
    for name in ("Pole_Shaft", "Pole_Base"):
        ob = bpy.data.objects.get(name)
        if not ob or ob.type != 'MESH':
            continue
        ob.data.materials.clear()
        ob.data.materials.append(steel)
        while ob.data.uv_layers:
            ob.data.uv_layers.remove(ob.data.uv_layers[0])
        box_uv(ob, steel.name)
    print("[v2] pole reskinned: concrete -> galvanised steel")


def detail_antenna(mats):
    """Modelling detail on the radome, section 25.

    The antenna was a plain rounded slab: correct in proportion, empty in
    silhouette. Real panel antennas break up along their edges — a proud cap
    at each end where the radome is bonded to its extrusion, a moulding seam
    down both flanks, ribs across the back, and the small hardware an installer
    actually looks for: a grounding lug, a rating plate, and a tilt scale at
    the bracket so the downtilt can be read off the pole.

    Everything is parented to Antenna_Body, so it inherits the mount rigs and
    the install clips without a single extra keyframe.
    """
    body = bpy.data.objects.get("Antenna_Body")
    if not body:
        return
    shell = mats.get("MAT_Antenna_OffWhite")
    dark = mats.get("MAT_Steel_Dark") or mats.get("MAT_Connector_Steel")
    steel = mats.get("MAT_Connector_Steel") or dark

    vs = [body.matrix_world @ v.co for v in body.data.vertices]
    x0, x1 = min(v.x for v in vs), max(v.x for v in vs)
    y0, y1 = min(v.y for v in vs), max(v.y for v in vs)
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = x1 - x0, y1 - y0
    made = []

    # end caps, a touch proud of the radome so they catch a highlight
    bm = bmesh.new()
    for z in (z0 + 0.011, z1 - 0.011):
        bm_box(bm, (cx, cy, z), (w * 1.015, d * 1.02, 0.022))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radome_End_Caps", bm, shell))

    # moulding seam down both flanks
    bm = bmesh.new()
    for sx in (x0 + 0.004, x1 - 0.004):
        bm_box(bm, (sx, cy, (z0 + z1) / 2), (0.008, d * 0.97, (z1 - z0) - 0.05))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radome_Seams", bm, shell))

    # stiffening ribs across the back
    bm = bmesh.new()
    for k in range(5):
        z = z0 + 0.14 + k * ((z1 - z0) - 0.28) / 4.0
        bm_box(bm, (cx, y0 + 0.006, z), (w * 0.90, 0.012, 0.016))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radome_Ribs", bm, shell))

    # grounding lug, low on the back, with its bolt
    bm = bmesh.new()
    bm_box(bm, (x0 + 0.055, y0 - 0.012, z0 + 0.10), (0.046, 0.030, 0.034))
    bm_cyl(bm, (x0 + 0.055, y0 - 0.030, z0 + 0.10), 0.007, 0.020, seg=10, axis='Y')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Antenna_Ground_Lug", bm, steel))

    # Rating plate on the FLANK, not the back.
    #
    # y0 is the face toward the pole. Hardware belongs there on a real antenna,
    # and that is where the ribs and the earth lug stay — but a plate nobody
    # can see is decoration that costs triangles and returns nothing. Every
    # camera in this scene looks at the radome face or the profile, so the
    # plate goes on the profile.
    bm = bmesh.new()
    bm_box(bm, (x1 - 0.003, cy - 0.02, z1 - 0.22), (0.008, 0.135, 0.070))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Antenna_Rating_Plate", bm, steel))

    # Bezel around the radiating face: the radome is bonded into a frame, and
    # the frame is the one piece of relief the front of a panel antenna has.
    # Without it the visible side is a blank white slab from every angle.
    bm = bmesh.new()
    fy = y1 - 0.004
    bm_box(bm, (cx, fy, z1 - 0.030), (w * 0.94, 0.014, 0.026))      # head
    bm_box(bm, (cx, fy, z0 + 0.030), (w * 0.94, 0.014, 0.026))      # sill
    for sx in (cx - w * 0.457, cx + w * 0.457):
        bm_box(bm, (sx, fy, (z0 + z1) / 2), (0.026, 0.014, (z1 - z0) - 0.052))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radome_Bezel", bm, shell))

    # Vent boss on the underside, where a real radome breathes.
    bm = bmesh.new()
    bm_cyl(bm, (cx + w * 0.22, cy, z0 - 0.006), 0.018, 0.018, seg=12, axis='Z')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radome_Vent", bm, steel))

    # tilt scale at the bracket: a quadrant plate with degree ticks
    bm = bmesh.new()
    zc = z0 + 0.30
    bm_cyl(bm, (x0 - 0.010, cy, zc), 0.062, 0.008, seg=24, axis='X')
    for k in range(7):
        a = math.radians(-42 + k * 14)
        bm_box(bm, (x0 - 0.015,
                    cy + math.sin(a) * 0.050,
                    zc + math.cos(a) * 0.050), (0.006, 0.005, 0.016))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Antenna_Tilt_Scale", bm, dark))

    # No per-object smoothing here: shade_smooth_all() runs over the whole
    # scene at the end of the build and would only redo it.
    for ob in made:
        reparent(ob, body)
    print(f"[v2] antenna detailed: {len(made)} parts")


def detail_pole_hardware(mats):
    """Service hardware on the shaft, section 25.

    A pole in the field is not a bare tube. It has a cast access hatch where
    the feeder enters, an earth boss with a strap to the electrode, a warning
    plate at eye height, cable cleats up the run, and nuts and washers on its
    holding-down bolts. None of it is decorative — it is the hardware an
    installer is told to check.

    Everything hugs the shaft through pole_radius_at(z) rather than a constant
    radius. The shaft is tapered, so a fixed offset floats the fittings clear
    at the base and buries them at the top.
    """
    steel = mats.get("MAT_Connector_Steel") or mats.get("MAT_Steel_Brushed")
    dark = mats.get("MAT_Steel_Dark") or steel
    made = []

    # Access hatch: recessed frame, proud door, two captive fasteners.
    zc = 1.25
    r = pole_radius_at(zc)
    bm = bmesh.new()
    bm_box(bm, (0, r + 0.004, zc), (0.145, 0.014, 0.360))          # frame
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Hatch_Frame", bm, dark))
    bm = bmesh.new()
    bm_box(bm, (0, r + 0.013, zc), (0.118, 0.010, 0.330))          # door
    for dz in (-0.125, 0.125):
        bm_cyl(bm, (0, r + 0.021, zc + dz), 0.010, 0.010, seg=8, axis='Y')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Hatch_Door", bm, steel))

    # Earth boss and strap, base of the shaft down to the electrode.
    bm = bmesh.new()
    zb = 0.42
    rb = pole_radius_at(zb)
    bm_cyl(bm, (0.0, -(rb + 0.016), zb), 0.017, 0.032, seg=10, axis='Y')
    bm_box(bm, (0.0, -(rb + 0.030), zb - 0.16), (0.026, 0.005, 0.330))
    bm_box(bm, (0.0, -(rb + 0.030), zb - 0.325), (0.026, 0.048, 0.006))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Earth_Strap", bm, steel))

    # Warning / asset plate at eye height, banded round the shaft.
    bm = bmesh.new()
    zp = 1.72
    rp = pole_radius_at(zp)
    bm_box(bm, (0, rp + 0.006, zp), (0.150, 0.008, 0.092))
    for sx in (-1, 1):
        bm_box(bm, (sx * 0.082, rp - 0.010, zp), (0.030, 0.030, 0.088))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Asset_Plate", bm, dark))

    # Feeder cleats up the shaft, on the same face the cable run uses.
    bm = bmesh.new()
    for k in range(9):
        z = 2.35 + k * 0.58
        rr = pole_radius_at(z)
        bm_box(bm, (0, -(rr + 0.012), z), (0.086, 0.024, 0.020))
        for sx in (-1, 1):
            bm_cyl(bm, (sx * 0.033, -(rr + 0.026), z), 0.006, 0.014,
                   seg=6, axis='Y')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Feeder_Cleats", bm, steel))

    # Nuts and washers on the holding-down bolts.
    bm = bmesh.new()
    for k in range(4):
        a = math.radians(45 + k * 90)
        px, py = math.cos(a) * 0.245, math.sin(a) * 0.245
        bm_cyl(bm, (px, py, 0.062), 0.030, 0.010, seg=16)       # washer
        bm_cyl(bm, (px, py, 0.079), 0.023, 0.026, seg=6)        # nut
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Base_Nuts", bm, steel))

    root = bpy.data.objects.get("LP12_ROOT")
    for ob in made:
        if root:
            reparent(ob, root)
    print(f"[v2] pole hardware: {len(made)} parts")


def detail_radio(mats):
    """The radio unit behind the radome: fin caps, status window, label.

    Cooling_Fins was a bare charcoal comb. Real remote radio units close their
    fin stack with a cast top and bottom, carry a small sealed status window on
    the accessible face, and wear a barcode plate.
    """
    fins = bpy.data.objects.get("Cooling_Fins")
    if not fins:
        return
    dark = mats.get("MAT_Steel_Dark") or mats.get("MAT_Connector_Steel")
    steel = mats.get("MAT_Connector_Steel") or dark
    char = mats.get("MAT_HeatSink_Charcoal") or dark

    vs = [fins.matrix_world @ v.co for v in fins.data.vertices]
    x0, x1 = min(v.x for v in vs), max(v.x for v in vs)
    y0, y1 = min(v.y for v in vs), max(v.y for v in vs)
    z0, z1 = min(v.z for v in vs), max(v.z for v in vs)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    made = []

    bm = bmesh.new()
    for z in (z0 - 0.008, z1 + 0.008):
        bm_box(bm, (cx, cy, z), ((x1 - x0) * 1.03, (y1 - y0) * 1.05, 0.018))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radio_Fin_Caps", bm, char))

    bm = bmesh.new()
    bm_box(bm, (cx - (x1 - x0) * 0.30, y0 - 0.006, z1 - 0.10),
           (0.070, 0.010, 0.030))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radio_Status_Window", bm, steel))

    bm = bmesh.new()
    bm_box(bm, (cx + (x1 - x0) * 0.26, y0 - 0.004, z0 + 0.09),
           (0.084, 0.006, 0.044))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Radio_Label", bm, steel))

    for ob in made:
        reparent(ob, fins)
    print(f"[v2] radio detailed: {len(made)} parts")


FLEX_RANGE_DEG = 10.0      # matches build_lp12.py CFG["downtilt_max"]


def flex_cables(z_cleat, z_top):
    """Let the feeder flex instead of swinging with the antenna.

    Antenna_Cables hangs off Connector_Install_Rig -> Antenna_Install_Rig ->
    Tilt_Rig, so every vertex rotates rigidly about the pivot when downtilt is
    set. The run is cleated to the pole about 1.2 m below that pivot, and 1.2 m
    of radius at 10 degrees is 105 mm of travel — measured, the cable ends up
    68 mm INSIDE the shaft at -10. Real feeder cannot do that: the cleat holds
    the bottom and the service loop absorbs the movement.

    The parenting has to stay, because ANIM_06 slides the whole run up to the
    ports through that same chain. So instead of reparenting, this adds two
    morph targets that CANCEL the inherited rotation wherever the cable is
    supposed to be held still:

        w = 1 at the connector end   -> no correction, follows the antenna
        w = 0 at the cleat and below -> full counter-rotation, stays put

    For a target angle t, the parent will place a vertex at R(t)*(p - P) + P.
    A vertex that should not move needs to start from R(t)^-1*(p - P) + P, so
    the shape key stores exactly that, blended by (1 - w).

    Morph targets are used rather than hooks or an armature because glTF
    carries only TRS and morph weights — a hook modifier would look right in
    Blender and export as nothing at all.
    """
    cab = bpy.data.objects.get("Antenna_Cables")
    tilt = bpy.data.objects.get("Tilt_Rig")
    if not cab or not tilt or cab.type != 'MESH':
        return
    me = cab.data
    if me.shape_keys:
        return

    M = cab.matrix_world.copy()
    Minv = M.inverted()
    P = tilt.matrix_world.translation.copy()

    span = max(z_top - z_cleat, 1e-6)

    def weight(zw):
        """Smoothstep: held at the cleat, free at the ports."""
        t = min(max((zw - z_cleat) / span, 0.0), 1.0)
        return t * t * (3.0 - 2.0 * t)

    basis = cab.shape_key_add(name="Basis", from_mix=False)
    basis.interpolation = 'KEY_LINEAR'

    for name, deg in (("Flex_Tilt_Neg", -FLEX_RANGE_DEG),
                      ("Flex_Tilt_Pos", FLEX_RANGE_DEG)):
        sk = cab.shape_key_add(name=name, from_mix=False)
        sk.interpolation = 'KEY_LINEAR'
        Rinv = Matrix.Rotation(math.radians(-deg), 4, 'X')
        for i, v in enumerate(me.vertices):
            world = M @ v.co
            w = weight(world.z)
            if w >= 0.999:
                continue                       # follows the antenna as built
            corrected = Rinv @ (world - P) + P
            target = world.lerp(corrected, 1.0 - w)
            sk.data[i].co = Minv @ target
        sk.value = 0.0

    print(f"[v2] cable flex: 2 morph targets over z {z_cleat:.2f}..{z_top:.2f}")


def tint_brass(mats):
    """Make the brass material actually look like brass.

    connector_brass_base_color is a neutral grey bake — sampled across the
    whole 512x512 it comes back 0.498/0.492/0.474, and it is wired straight
    into Base Color. So MAT_Connector_Brass and MAT_Connector_Steel render as
    the same grey, which is why the connector's brass band was invisible
    against its steel nut and why the bank's contact pins never read as brass.

    The material already declares the alloy colour it wants — the Principled
    node's own Base Color default is (0.585, 0.448, 0.196). Nothing was using
    it, because the texture link overrides the default. Dropping that link
    hands the shader the colour the material always named. Roughness and normal
    stay connected, so the surface keeps its bake; only the flat, colourless
    albedo goes.
    """
    m = mats.get("MAT_Connector_Brass")
    if not m or not m.use_nodes:
        return
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return
    sock = bsdf.inputs["Base Color"]
    for l in [l for l in nt.links if l.to_socket == sock]:
        nt.links.remove(l)
    sock.default_value = (0.585, 0.448, 0.196, 1.0)
    print("[v2] brass tint applied (albedo bake was neutral grey)")


def rf_port_centres(bank):
    """World (x, y) of every brass RF pin on the connector bank's underside.

    Measured off the mesh, not copied from build_lp12.PORTS. That table lives
    in the other script, and this file has already been burned once by a
    constant duplicated across the two — the pole diameter kept its old value
    through two rebuilds because only one of the copies was edited. Brass is
    material slot 1 and only the pins use it, so the mesh already knows.
    """
    mw = bank.matrix_world
    groups = []
    for poly in bank.data.polygons:
        if poly.material_index != 1:
            continue
        c = mw @ poly.center
        for g in groups:
            if (g[0] - c.x) ** 2 + (g[1] - c.y) ** 2 < 0.030 ** 2:
                g[2].append((c.x, c.y))
                break
        else:
            groups.append([c.x, c.y, [(c.x, c.y)]])
    out = []
    for g in groups:
        pts = g[2]
        out.append((sum(p[0] for p in pts) / len(pts),
                    sum(p[1] for p in pts) / len(pts)))
    return sorted(out)


def bm_knurl_cyl(bm, c, r, d, seg=24, flute=0.93, axis='Z', mi=0):
    """A cylinder with a fluted rim — the grip on a coax coupling nut.

    Every second segment is pulled in, so the silhouette breaks up into ridges
    the way a knurl does, at the cost of nothing: it is still one cylinder with
    no extra faces. Modelling real knurl teeth on a 20 mm nut would add a few
    thousand triangles that vanish at any sane viewing distance.
    """
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r, radius2=r, depth=d)
    step = 2.0 * math.pi / seg
    for vv in g["verts"]:
        if abs(vv.co.x) < 1e-9 and abs(vv.co.y) < 1e-9:
            continue                                   # cap centre, leave it
        idx = int(round(math.atan2(vv.co.y, vv.co.x) / step)) % seg
        if idx % 2:
            vv.co.x *= flute
            vv.co.y *= flute
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
    # The radome is an off-white composite shroud, not bare metal.
    antenna = (mats.get("MAT_Antenna_OffWhite") or mats.get("MAT_Antenna_Offwhite")
               or steel)
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

    # --- top canister antenna ----------------------------------------------
    #
    # The defining feature of the reference photograph and the one thing the
    # model had no equivalent of: a shrouded small-cell canister sitting on the
    # very top of the column, noticeably wider than the pole, reached through a
    # short conical flare.
    #
    # It is deliberately NOT part of the assembly sequence. The six clips drive
    # the mid-pole enclosure the learner installs; this is the radome that comes
    # already fitted on the host pole, exactly as it does in the photograph.
    bm = bmesh.new()
    # Proportions read off the photograph: the radome is only about half again
    # the pole's diameter and roughly a metre tall, so it reads as slender. The
    # first pass made it 2.15x wide and 0.86 tall, which turned it into a squat
    # drum sitting on the pole rather than a continuation of it.
    can_r = rt * 1.52
    flare_z0 = top + 0.14
    flare_z1 = flare_z0 + 0.34
    can_z1 = flare_z1 + 1.06
    segs = 32

    def _ring(z, r):
        return [bm.verts.new((math.cos(2 * math.pi * i / segs) * r,
                              math.sin(2 * math.pi * i / segs) * r, z))
                for i in range(segs)]

    def _skin(a, b):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], a[j], b[j], b[i]))

    r_lo = _ring(flare_z0, rt + 0.02)          # springs from the cap collar
    r_mid = _ring(flare_z1, can_r)             # flared out to full width
    r_hi = _ring(can_z1, can_r)
    r_cap = _ring(can_z1 + 0.07, can_r * 0.94)  # slightly domed crown
    _skin(r_lo, r_mid)
    _skin(r_mid, r_hi)
    _skin(r_hi, r_cap)
    bm.faces.new(list(reversed(r_lo)))
    bm.faces.new(r_cap)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Antenna_Canister", bm, antenna))

    # Joint band where the radome meets its flare, and a small vent strip. Both
    # are in the photograph and both give the canister a scale reference.
    bm = bmesh.new()
    bm_cyl(bm, (0, 0, flare_z1 + 0.05), can_r + 0.012, 0.06, seg=segs, axis='Z')
    bm_cyl(bm, (0, 0, can_z1 - 0.10), can_r + 0.010, 0.05, seg=segs, axis='Z')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Canister_Bands", bm, steel))

    # --- cable conduit, handhole and signage --------------------------------
    #
    # The photograph reads as a real installation largely because of these: a
    # conduit running the length of the pole from the radio down to the base, a
    # bolted handhole where the cable enters, and two small plates at head
    # height. None cost much geometry and all three are what the eye uses to
    # judge that the pole is equipment rather than a post.
    bm = bmesh.new()
    steps = 12
    z0, z1 = 0.55, 6.98
    ang = math.radians(-14.0)                  # sits just off the mounting face
    prev = None
    for i in range(steps + 1):
        z = z0 + (z1 - z0) * i / steps
        r = pole_radius_at(z) + 0.052
        cx, cy = math.cos(ang) * r, math.sin(ang) * r
        ring = []
        for k in range(8):
            a = 2 * math.pi * k / 8
            ring.append(bm.verts.new((cx + math.cos(a) * 0.036 * math.cos(ang)
                                      - math.sin(a) * 0.0,
                                      cy + math.cos(a) * 0.036 * math.sin(ang)
                                      + math.sin(a) * 0.0,
                                      z + math.sin(a) * 0.036)))
        if prev:
            for k in range(8):
                j = (k + 1) % 8
                bm.faces.new((prev[k], prev[j], ring[j], ring[k]))
        prev = ring
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Cable_Conduit", bm, steel))

    bm = bmesh.new()
    hz, hr = 1.35, pole_radius_at(1.35)
    ha = math.radians(-14.0)
    hx, hy = math.cos(ha) * (hr + 0.012), math.sin(ha) * (hr + 0.012)
    bm_cyl(bm, (hx, hy, hz), 0.105, 0.030, seg=18, axis='X')     # handhole cover
    for k in range(4):
        a = math.pi / 2 * k + math.pi / 4
        bm_cyl(bm, (hx + 0.004, hy + math.cos(a) * 0.078, hz + math.sin(a) * 0.078),
               0.012, 0.026, seg=6, axis='X')                    # cover bolts
    # Two identification plates at head height.
    for pz in (2.05, 2.28):
        pr = pole_radius_at(pz) + 0.008
        px, py = math.cos(ha) * pr, math.sin(ha) * pr
        bm_cyl(bm, (px, py, pz), 0.062, 0.010, seg=4, axis='X')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    made.append(new_obj("Pole_Service_Fittings", bm, steel))

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
    # Start the strip where the action's own keys start, not at frame 1.
    # Hardcoding 1 re-bases the action: the coupling nuts are keyed 32-58 so
    # that they thread on AFTER the rig seats at 30, and a strip pinned to 1
    # slid that to 1-27 — the nuts spun during the cable approach and the clip
    # died at 27 while the wrapper ran on to 60. Every earlier clip starts at
    # frame 1, which is why this only ever showed up on ANIM_06.
    track.strips.new(act.name, int(round(act.frame_range[0])), act)


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


def anim_shapekey(ob, clip, key_name, keys):
    """Key a morph weight and push it to a same-named NLA track.

    Shape key animation lives on the shape_keys datablock, not the object, so
    it needs its own action and its own track. The glTF exporter matches tracks
    by name, so a track called ANIM_08_Downtilt_Set here is folded into the
    same glTF animation as the Tilt_Rig rotation — which is the point: the
    cable has to flex on exactly the frames the antenna is pitching.
    """
    sk = ob.data.shape_keys
    if not sk or key_name not in sk.key_blocks:
        return
    kb = sk.key_blocks[key_name]
    if sk.animation_data is None:
        sk.animation_data_create()
    act = bpy.data.actions.new(f"{clip}__{ob.name}_{key_name}")
    sk.animation_data.action = act
    for frame, value in keys:
        kb.value = value
        kb.keyframe_insert("value", frame=frame)
    sk.animation_data.action = None
    track = sk.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(act.name, int(round(act.frame_range[0])), act)
    kb.value = 0.0


def anim_rotate(obj, clip, axis, deg_from, deg_to, frames, overshoot=1.18):
    """Swing a rig from one angle to another and let it settle.

    frames is (start, arrive, settle). The overshoot is not decoration: these
    are hand adjustments against a scale, and a hand always goes slightly past
    the mark and comes back. Landing dead on the value reads as a servo.
    """
    f0, f1, f2 = frames
    idx = {'X': 0, 'Y': 1, 'Z': 2}[axis]

    def euler(deg):
        e = [0.0, 0.0, 0.0]
        e[idx] = math.radians(deg)
        return tuple(e)

    act = start_action(obj, clip)
    base = tuple(obj.location)
    over = deg_from + (deg_to - deg_from) * overshoot
    key(obj, f0, loc=base, rot=euler(deg_from))
    key(obj, f1, loc=base, rot=euler(over), interp='BEZIER', easing='EASE_OUT')
    key(obj, f2, loc=base, rot=euler(deg_to), interp='BEZIER', easing='EASE_IN_OUT')
    push_to_nla(obj, clip, act)


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

    # Land each run on an actual port instead of on its own even third of the
    # bank. The bank carries four RF ports in two pairs either side of the
    # centre gland, so thirds put every connector in the gap between two ports
    # — and the ports also sit 30 mm forward of the bank centre in Y, which the
    # old spacing ignored entirely. Three runs, so the outermost port is left
    # capped as the spare, which is how these are actually installed.
    ports_xy = rf_port_centres(bank)[:n]
    if len(ports_xy) < n:
        raise RuntimeError(f"only {len(ports_xy)} RF ports found, need {n}")
    for i in range(n):
        x, y_port = ports_xy[i]
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
            (x, y_port, z_ports - 0.012),                               # gland
            (x, y_port + 0.020, z_ports - 0.085),                       # strain relief
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

    # Flex has to be built after reparenting: the shape keys are computed from
    # the cable's world matrix, and reparent() changes it.
    flex_cables(z_cleat, z_ports)

    bolts = []
    for k, sx in enumerate((-1, 1)):
        b = make_bolt(f"Cable_Cleat_Bolt_{k+1:02d}",
                      (sx * (span * 0.5 - 0.018), y_face + 0.058, z_cleat),
                      0.011, 0.055, 'Y', mats.get("MAT_Connector_Steel"))
        reparent(b, bpy.data.objects["Mount_System"])
        bolts.append(b)

    # Coax connectors, one per run, at the port each cable threads into.
    #
    # These were make_bolt() — a hex head on a shaft. That is a bolt, and it
    # read as one: the reference shows an N-type coax connector, which is a
    # knurled coupling nut with a brass band that CUPS DOWN OVER the port body
    # and is turned to draw the plug home. Nothing about a hex head does that.
    #
    # Three objects per run, because they behave differently:
    #   Connector_Coupling  the cup collar + knurled nut. Turns.
    #   Connector_Ferrule   the brass band. Parented to the nut, so it turns
    #                       with it without needing its own keys.
    #   Connector_Plug      the body below the nut. Rises, never turns — a
    #                       coupling nut spins on a plug that stays put.
    #
    # Origins sit at the TOP of each piece so seating is one subtraction from
    # the port plane instead of a half-length correction per part.
    steel = mats.get("MAT_Connector_Steel")
    brass = mats.get("MAT_Connector_Brass") or steel
    dark = mats.get("MAT_Steel_Dark") or steel
    couplings, plugs = [], []
    for i in range(n):
        x, y_port = ports_xy[i]
        # z_ports is the bank's bound-box floor as it stands at BUILD time; the
        # rest-pose transforms carry the bank 32 mm higher before ANIM_06 ever
        # resolves, so measuring against the raw value left the old nut 48 mm
        # short of the port and it never touched.
        # z_ports is the bank's bound-box FLOOR, and that floor belongs to the
        # centre gland's rubber boot (z_plate - 0.084), not to an RF port. The
        # RF brass pin only reaches z_plate - 0.065, so seating the cup on the
        # bbox floor parked it 37 mm below the pin it was supposed to close
        # over — the gold pin stayed visible and nothing was "cupped" at all.
        # +0.032 carries build-time z_ports to the assembled bank floor, +0.036
        # then lifts from that floor to just under the pin's retaining ring.
        z_face = z_ports + 0.032 + 0.036

        # Stack, top down, matching the reference: a DARK knurled cup that
        # closes over the port body, a proud brass band, the bright knurled nut
        # that is actually gripped and turned, then the plug body. The bands
        # have to differ in both diameter and material or the whole connector
        # reads as one grey tube — the first attempt recessed the brass inside
        # the cup and the nut, and it disappeared completely.
        bm = bmesh.new()
        bm_knurl_cyl(bm, (0, 0, -0.051), 0.021, 0.030, seg=32, flute=0.90)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        c = new_obj(f"Connector_Coupling_{i+1:02d}", bm, steel)
        c.location = (x, y_port, z_face)

        bm = bmesh.new()
        bm_knurl_cyl(bm, (0, 0, 0), 0.018, 0.024, seg=20, flute=0.95)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        cup = new_obj(f"Connector_Cup_{i+1:02d}", bm, dark)
        cup.location = (x, y_port, z_face - 0.012)

        bm = bmesh.new()
        bm_cyl(bm, (0, 0, 0), 0.019, 0.012, seg=20)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        f_ = new_obj(f"Connector_Ferrule_{i+1:02d}", bm, brass)
        f_.location = (x, y_port, z_face - 0.030)

        bm = bmesh.new()
        bm_cyl(bm, (0, 0, -0.010), 0.016, 0.020, seg=20)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        pl = new_obj(f"Connector_Plug_{i+1:02d}", bm, dark)
        pl.location = (x, y_port, z_face - 0.066)

        reparent(cup, c)                # cup and brass ride the nut
        reparent(f_, c)
        if parent:
            reparent(c, parent)
            reparent(pl, parent)
        couplings.append(c)
        plugs.append(pl)

    print(f"[v2] cables rerouted: {n} runs, gland -> loop -> pole -> cleat, "
          f"{len(couplings)} couplings")
    return ob, cleat, bolts, couplings, plugs


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
    tint_brass(mats)
    detail_pole_hardware(mats)
    detail_radio(mats)
    make_pole_metal(mats)
    detail_antenna(mats)
    _cables, _cleat, _cleat_bolts, couplings, plugs = rebuild_cables(mats)
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

    # ANIM_06 previously ended when the connector rig reached the enclosure —
    # the cables travelled up, touched the ports and the clip stopped. The stage
    # is called "Connect Signal Cables" and the interface draws rotation arrows
    # on the couplings, so the tightening was the half that was missing.
    #
    # The rig now seats earlier, at frame 30 instead of 38, and the remaining
    # 30 frames are spent threading each coupling onto its port: a short axial
    # travel plus two and a half turns, staggered so the three do not move as
    # one block. anim_bolts already does exactly this for every other fastener
    # in the model, which is why the motion reads as the same action.
    anim_wrapper(rigs["Connector_Install_Rig"], "ANIM_06_Connectors_Attach",
                 REST["Connector_Install_Rig"], (1, 16, 30, 60))
    # The rig has already carried the whole run up to the ports by frame 30.
    # What is left is the threading: 14 mm of engagement — the depth a coupling
    # nut actually draws down as it cups over the port body — plus two and a
    # half turns. The plug follows the same travel with turns=0, because the
    # nut spins and the plug it is pulling home does not.
    anim_bolts(couplings, "ANIM_06_Connectors_Attach", 'Z', -0.018,
               32, 58, turns=900, stagger=4)
    anim_bolts(plugs, "ANIM_06_Connectors_Attach", 'Z', -0.018,
               32, 58, turns=0, stagger=4)
    # Azimuth swings the whole mount around the pole; downtilt pitches only
    # the antenna at the bracket. Two different rigs, deliberately, because on
    # the real thing they are two different sets of bolts.
    height_rig = bpy.data.objects.get("Height_Rig")
    tilt_rig = bpy.data.objects.get("Tilt_Rig")
    if height_rig:
        anim_rotate(height_rig, "ANIM_07_Azimuth_Set", 'Z',
                    0.0, -22.0, (1, 34, 54))
    if tilt_rig:
        anim_rotate(tilt_rig, "ANIM_08_Downtilt_Set", 'X',
                    0.0, CFG_DOWNTILT, (1, 30, 48))
        # Flex the feeder on the same frames. CFG_DOWNTILT is 5 degrees out of
        # the +/-10 the morph targets are built for, so the weight tops out at
        # half, and it tracks the rotation's overshoot rather than ramping
        # straight — the cable is being dragged by the antenna, not driven.
        cab = bpy.data.objects.get("Antenna_Cables")
        if cab and cab.data.shape_keys:
            peak = CFG_DOWNTILT / FLEX_RANGE_DEG
            anim_shapekey(cab, "ANIM_08_Downtilt_Set", "Flex_Tilt_Pos",
                          [(1, 0.0), (30, peak * 1.18), (48, peak)])

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

    # A second, static export for the environment.
    #
    # The environment needs an LP12 that is already built; the application needs
    # one that can be built, step by step. They cannot be the same file. The
    # rest pose in the animated GLB is the UNASSEMBLED state — the antenna sits
    # 0.62 m off the bracket waiting for ANIM_04 — and there is no way to undo
    # that after import, because glTF bakes each node's transform into the
    # hierarchy: zeroing an install rig in the imported file does not subtract
    # an offset, it teleports the part to its parent's origin. Measured that
    # way, the antenna ended up at z 14.9, two metres clear of the pole top.
    #
    # Here in the master the rigs are real offsets, so zeroing them IS the
    # assembled pose. Do it, export, and put them back.
    saved = {}
    for name in ("Rail_Install_Rig", "Pivot_Install_Rig", "Antenna_Install_Rig",
                 "Connector_Install_Rig", "Band_Top_Rig", "Band_Bottom_Rig"):
        o = bpy.data.objects.get(name)
        if o:
            saved[name] = tuple(o.location)
            o.location = (0.0, 0.0, 0.0)

    # And point it. The animated model rests unpointed so ANIM_07 and ANIM_08
    # have somewhere to travel from; the backdrop copy is a commissioned site,
    # where the azimuth and downtilt have already been set and signed off.
    saved_rot = {}
    for name, axis, deg in (("Height_Rig", 2, -22.0), ("Tilt_Rig", 0, CFG_DOWNTILT)):
        o = bpy.data.objects.get(name)
        if o:
            saved_rot[name] = tuple(o.rotation_euler)
            e = list(o.rotation_euler)
            e[axis] = math.radians(deg)
            o.rotation_euler = e
    bpy.context.view_layer.update()

    asm = os.path.join(OUT_DIR, "lp12_v2_assembled.glb")
    bpy.ops.export_scene.gltf(
        filepath=asm, export_format='GLB', use_selection=True,
        export_apply=False, export_yup=True,
        export_cameras=False, export_lights=False,
        export_extras=True, export_materials='EXPORT',
        export_image_format='WEBP', export_image_quality=88,
        export_animations=False,                  # a backdrop does not animate
    )
    for name, loc in saved.items():
        bpy.data.objects[name].location = loc
    for name, rot in saved_rot.items():
        bpy.data.objects[name].rotation_euler = rot
    bpy.context.view_layer.update()
    print(f"[v2] exported {os.path.basename(asm)} "
          f"({os.path.getsize(asm)/1e6:.2f} MB, assembled, no clips)")


if __name__ == "__main__":
    main()
