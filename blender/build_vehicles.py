"""
Detailed low-poly vehicle library for the Awolowo Way environment.

The vehicles this replaces were a profiled body, a glass wedge and four
cylinders — about 185 triangles each. They read acceptably at the isometric
camera and fell apart the moment anything moved closer, which is the whole
reason for this rebuild.

Everything here is composed from a shared part library rather than modelled per
vehicle. A grille is a grille whether it is on a van or a bus; writing it once
and calling it eleven times is the only way ten detailed vehicles stay
maintainable, and it keeps the detail consistent across the family, which is
what makes them look like one designed set rather than ten separate attempts.

CONVENTION, from the brief: +Y is forward, +Z is up, +X is the vehicle's left.
Root origin sits on the ground at the centre of the footprint, so the lowest
tyre contact is exactly Z = 0 and a vehicle can be dropped straight onto a road
surface with no vertical fudge.

Note that the environment's road runs along X, so placement rotates these by
-90 degrees. That is deliberate: the brief fixes the vehicle-local convention
and the scene adapts, rather than every vehicle being authored to one road.
"""

import math

import bmesh
from mathutils import Vector

# Material slots, in a fixed order every vehicle shares. Faces carry an index
# into this list, so one mesh needs no per-part objects and the exporter splits
# it into one primitive per material.
SLOTS = [
    "MAT_VEHICLE_OFFWHITE",   # 0
    "MAT_VEHICLE_BLUE",       # 1
    "MAT_VEHICLE_BLUE_DARK",  # 2
    "MAT_GLASS_DARK",         # 3
    "MAT_TYRE",               # 4
    "MAT_WHEEL_HUB",          # 5
    "MAT_CHASSIS",            # 6
    "MAT_LIGHT_HEAD",         # 7
    "MAT_LIGHT_BRAKE",        # 8
    "MAT_LIGHT_INDICATOR",    # 9
    "MAT_TRIM",               # 10
]
BODY, BLUE, BLUE_DK, GLASS, TYRE, HUB, CHASSIS, HEAD, BRAKE, INDIC, TRIM = range(11)

VEHICLE_COLOURS = {
    "MAT_VEHICLE_OFFWHITE":  ("#F2F1EC", 0.44, 0.08),
    "MAT_VEHICLE_BLUE":      ("#4C6FDC", 0.42, 0.08),
    "MAT_VEHICLE_BLUE_DARK": ("#274EA8", 0.44, 0.08),
    "MAT_GLASS_DARK":        ("#1D2A3A", 0.20, 0.00),
    "MAT_TYRE":              ("#1C2026", 0.85, 0.00),
    "MAT_WHEEL_HUB":         ("#D8DDE5", 0.40, 0.35),
    "MAT_CHASSIS":           ("#283343", 0.60, 0.20),
    "MAT_LIGHT_HEAD":        ("#EAF4FF", 0.18, 0.00),
    "MAT_LIGHT_BRAKE":       ("#E64A4A", 0.30, 0.00),
    "MAT_LIGHT_INDICATOR":   ("#F2B84B", 0.30, 0.00),
    "MAT_TRIM":              ("#283343", 0.62, 0.10),
}


# ------------------------------------------------------------ part library

def box(bm, x0, x1, y0, y1, z0, z1, mat):
    """Axis-aligned box. The workhorse — almost every part is one of these."""
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    z0, z1 = sorted((z0, z1))
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    out = []
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        f = bm.faces.new([v[i] for i in idx])
        f.material_index = mat
        out.append(f)
    return out


def wedge(bm, pts_yz, x0, x1, mat):
    """A Y-Z profile extruded across the vehicle's width.

    Bonnets, windscreen rakes, roof deflectors and cab fronts are all this: a
    silhouette drawn in side view and swept sideways. It is the difference
    between a car and a shoebox.
    """
    a = [bm.verts.new((x0, y, z)) for y, z in pts_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in pts_yz]
    fa = bm.faces.new(a)
    fb = bm.faces.new(list(reversed(b)))
    fa.material_index = fb.material_index = mat
    n = len(pts_yz)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((a[i], b[i], b[j], a[j]))
        f.material_index = mat
    return [fa, fb]


def cyl_x(bm, cy, cz, x0, x1, r, sides, mat, caps=True):
    """Cylinder whose axis runs across the vehicle — i.e. an axle."""
    rings = []
    for x in (x0, x1):
        rings.append([bm.verts.new((x, cy + r * math.cos(a), cz + r * math.sin(a)))
                      for a in (i / sides * math.tau for i in range(sides))])
    for i in range(sides):
        j = (i + 1) % sides
        f = bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
        f.material_index = mat
    if caps:
        for ring, flip in ((rings[0], False), (rings[1], True)):
            f = bm.faces.new(list(reversed(ring)) if flip else ring)
            f.material_index = mat


def wheel(bm, cy, cz, x_in, x_out, r, sides=16):
    """A wheel with a readable tyre, a proud hub and a recessed centre.

    Three concentric pieces rather than one cylinder: at the isometric camera
    the value break between dark tyre and light hub is what makes it register
    as a wheel at all, and the recess gives it depth when the camera comes in.
    """
    w = abs(x_out - x_in)
    sgn = 1.0 if x_out > x_in else -1.0
    cyl_x(bm, cy, cz, x_in, x_out, r, sides, TYRE)
    # Hub, set slightly proud of the tyre's outboard face.
    cyl_x(bm, cy, cz, x_out - sgn * w * 0.22, x_out + sgn * 0.012,
          r * 0.62, sides, HUB)
    # Dished centre, so the hub is not a flat disc.
    cyl_x(bm, cy, cz, x_out - sgn * w * 0.30, x_out - sgn * w * 0.06,
          r * 0.30, max(8, sides // 2), CHASSIS)


def light(bm, x0, x1, y_face, z0, z1, mat, depth=0.09, out=1.0):
    """A lamp in a recessed housing.

    The lens sits proud of a darker surround, so it catches the key light and
    carries a shadow line. A flat coloured rectangle on the bodywork reads as a
    sticker.
    """
    box(bm, x0 - 0.03, x1 + 0.03, y_face - out * depth * 0.4,
        y_face + out * depth * 0.25, z0 - 0.03, z1 + 0.03, TRIM)
    box(bm, x0, x1, y_face, y_face + out * depth, z0, z1, mat)


def grille(bm, x0, x1, y_face, z0, z1, slats, out=1.0, mat=CHASSIS):
    """Horizontal slats in a recessed surround."""
    box(bm, x0, x1, y_face - out * 0.05, y_face + out * 0.01, z0, z1, CHASSIS)
    if slats < 1:
        return
    pitch = (z1 - z0) / slats
    for i in range(slats):
        z = z0 + pitch * (i + 0.22)
        box(bm, x0 + 0.03, x1 - 0.03, y_face - out * 0.02, y_face + out * 0.03,
            z, z + pitch * 0.45, mat)


def seam(bm, x_face, y0, y1, z0, z1, out=1.0, mat=TRIM, t=0.018):
    """A panel or door line, proud by a few millimetres.

    Modelled rather than textured because at this scale the line has to survive
    Draco compression and read from a moving camera, and because a coplanar
    decal on a flat panel z-fights.
    """
    box(bm, x_face, x_face + out * t, y0, y1, z0, z1, mat)


def handle(bm, x_face, y0, y1, z, out=1.0):
    box(bm, x_face, x_face + out * 0.05, y0, y1, z, z + 0.055, TRIM)


def mirror(bm, x_face, y, z_low, z_high, out=1.0, arm=0.20):
    """Mirror on a real arm, with thickness. Paper-thin mirrors were called out
    in the brief and they are the classic low-poly vehicle tell."""
    box(bm, x_face, x_face + out * arm, y - 0.035, y + 0.035,
        z_high - 0.06, z_high - 0.02, TRIM)
    box(bm, x_face + out * (arm - 0.05), x_face + out * (arm + 0.055),
        y - 0.055, y + 0.055, z_low, z_high, TRIM)
    box(bm, x_face + out * (arm - 0.03), x_face + out * (arm + 0.04),
        y - 0.04, y + 0.04, z_low + 0.02, z_high - 0.02, GLASS)


def wheel_arch(bm, x0, x1, cy, r, z_base, mat=TRIM, segs=7, t=0.085):
    """A continuous arch ring over a wheel opening.

    Built as an arc-shaped Y-Z profile swept across the flank. The first
    version fanned a row of small boxes around the arc, which from any distance
    read as a dotted line rather than an arch — the gaps between boxes were
    wider than the boxes. A single ring profile has no gaps and stays quad-only,
    which matters because cutting a true opening needs a boolean and leaves
    n-gons that bevel badly.
    """
    pts = []
    for i in range(segs + 1):                       # outer edge, up and over
        a = math.pi * (i / segs)
        pts.append((cy + (r + t) * math.cos(a), z_base + (r + t) * math.sin(a)))
    for i in range(segs, -1, -1):                   # inner edge, back again
        a = math.pi * (i / segs)
        pts.append((cy + r * math.cos(a), z_base + r * math.sin(a)))
    wedge(bm, pts, x0, x1, mat)


def step(bm, x_face, y0, y1, z, out=1.0, depth=0.22):
    box(bm, x_face, x_face + out * depth, y0, y1, z, z + 0.045, CHASSIS)


# --------------------------------------------------------------- finishing

def to_object(bpy, bm, name, mats, coll_link):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(f"{name}_mesh")
    bm.to_mesh(me)
    bm.free()
    for slot in SLOTS:
        me.materials.append(mats[slot])
    ob = bpy.data.objects.new(name, me)
    coll_link(ob)
    return ob


def seat_on_ground(bpy, ob):
    """Drop the mesh so its lowest evaluated point is exactly Z = 0.

    The bevel rounds the tyre's outer edge, which pulls the contact patch up by
    roughly the bevel width — about 8 mm on a car. Small, but it is a floating
    vehicle, and the brief makes ground contact an acceptance criterion. Fixing
    it by eye per vehicle would not survive the next bevel change; measuring the
    evaluated mesh does.
    """
    deps = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(deps)
    me = ev.to_mesh()
    if not me.vertices:
        ev.to_mesh_clear()
        return 0.0
    drop = min(v.co.z for v in me.vertices)
    ev.to_mesh_clear()
    if abs(drop) > 1e-6:
        for v in ob.data.vertices:
            v.co.z -= drop
    return drop


def add_bevel(ob, width, segments=2, angle=40.0):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = True
    ob.data.shade_smooth()
    return mod


# ------------------------------------------------------------- semi-truck

def build_semi(bm, half_w=1.25):
    """Tractor unit plus box trailer, following the blue-cab references.

    Laid out nose-forward along +Y: tractor from y 1.9 to 8.2, trailer behind
    it from -8.0 to 2.5. The two overlap slightly at the fifth wheel, which is
    where a real trailer sits.
    """
    hw = half_w

    # ---- trailer box -----------------------------------------------------
    t_y0, t_y1 = -8.0, 2.45
    t_z0, t_z1 = 1.28, 3.95
    box(bm, -hw, hw, t_y0, t_y1, t_z0, t_z1, BODY)
    # Roof and lower trim divisions, so the box is not a featureless cube.
    for x in (-hw, hw):
        o = 1.0 if x > 0 else -1.0
        seam(bm, x, t_y0 + 0.1, t_y1 - 0.1, t_z1 - 0.34, t_z1 - 0.30, o, TRIM, 0.02)
        seam(bm, x, t_y0 + 0.1, t_y1 - 0.1, t_z0 + 0.26, t_z0 + 0.30, o, TRIM, 0.02)
        # Vertical panel breaks along the flank.
        for k in range(6):
            y = t_y0 + 1.0 + k * 1.7
            seam(bm, x, y, y + 0.03, t_z0 + 0.34, t_z1 - 0.38, o, TRIM, 0.014)
        # Side marker lights.
        for y, m in ((t_y0 + 0.5, BRAKE), (t_y1 - 0.5, INDIC)):
            box(bm, x, x + o * 0.03, y, y + 0.16, t_z0 + 0.12, t_z0 + 0.20, m)

    # Rear doors, hinges and locking bars.
    box(bm, -hw + 0.03, hw - 0.03, t_y0 - 0.05, t_y0 + 0.02, t_z0 + 0.06, t_z1 - 0.06, BLUE_DK)
    seam_y = t_y0 - 0.05
    box(bm, -0.02, 0.02, seam_y - 0.02, seam_y + 0.06, t_z0 + 0.08, t_z1 - 0.08, TRIM)
    for sx in (-1, 1):
        for k in range(2):
            bx = sx * (0.38 + k * 0.36)
            box(bm, bx - 0.035, bx + 0.035, seam_y - 0.05, seam_y - 0.01,
                t_z0 + 0.12, t_z1 - 0.12, TRIM)          # locking bar
        for hz in (t_z0 + 0.25, (t_z0 + t_z1) / 2, t_z1 - 0.25):
            box(bm, sx * (hw - 0.10), sx * (hw - 0.02), seam_y - 0.04, seam_y + 0.02,
                hz - 0.05, hz + 0.05, TRIM)              # hinge
    # Rear lights and underride bar.
    for sx in (-1, 1):
        light(bm, sx * 0.72 - 0.16, sx * 0.72 + 0.16, t_y0 - 0.06,
              t_z0 + 0.30, t_z0 + 0.50, BRAKE, 0.07, -1.0)
        light(bm, sx * 0.72 - 0.13, sx * 0.72 + 0.13, t_y0 - 0.06,
              t_z0 + 0.10, t_z0 + 0.26, INDIC, 0.06, -1.0)
    box(bm, -hw + 0.12, hw - 0.12, t_y0 - 0.12, t_y0 + 0.02, 0.62, 0.80, CHASSIS)

    # ---- trailer chassis, legs and side rails ----------------------------
    box(bm, -hw + 0.22, hw - 0.22, t_y0 + 0.1, t_y1 - 0.2, 1.06, 1.28, CHASSIS)
    for sx in (-1, 1):
        box(bm, sx * 0.78 - 0.07, sx * 0.78 + 0.07, -1.3, -0.9, 0.34, 1.10, CHASSIS)
        box(bm, sx * 0.78 - 0.13, sx * 0.78 + 0.13, -1.36, -0.84, 0.28, 0.36, CHASSIS)
        box(bm, sx * (hw - 0.04), sx * (hw + 0.02), t_y0 + 0.5, -1.6, 0.62, 0.72, CHASSIS)
        for wy in (-5.55, -6.95):
            wheel_arch(bm, sx * (hw - 0.02), sx * (hw + 0.02), wy, 0.64, 0.50)

    # ---- tractor ---------------------------------------------------------
    c_y0, c_y1 = 1.90, 8.20
    # Chassis rails running the length of the unit.
    for sx in (-1, 1):
        box(bm, sx * 0.62 - 0.09, sx * 0.62 + 0.09, 1.0, c_y1 - 0.55, 0.72, 1.02, CHASSIS)
    # Fifth-wheel coupling.
    box(bm, -0.62, 0.62, 1.85, 3.05, 1.02, 1.16, CHASSIS)

    # Cab: a stepped side profile swept across the width, not a plain block.
    cab = [
        (c_y0, 1.02), (c_y1 - 1.55, 1.02), (c_y1 - 0.75, 1.16),
        (c_y1 - 0.12, 1.30), (c_y1, 1.72),
        (c_y1 - 0.10, 2.62), (c_y1 - 0.62, 3.34), (c_y1 - 1.62, 3.52),
        (c_y0 + 0.10, 3.50), (c_y0, 3.10),
    ]
    wedge(bm, cab, -hw + 0.02, hw - 0.02, BLUE)
    # Roof deflector, angled back toward the trailer.
    wedge(bm, [(c_y0 + 0.05, 3.50), (c_y1 - 1.60, 3.52),
               (c_y1 - 1.75, 3.88), (c_y0 + 0.05, 3.92)],
          -hw + 0.10, hw - 0.10, BLUE)

    # Windscreen, raked, set into the cab face.
    wedge(bm, [(c_y1 - 0.16, 2.64), (c_y1 - 0.66, 3.30),
               (c_y1 - 0.74, 3.26), (c_y1 - 0.24, 2.58)],
          -hw + 0.09, hw - 0.09, GLASS)
    # A-pillars either side of it.
    for sx in (-1, 1):
        wedge(bm, [(c_y1 - 0.14, 2.60), (c_y1 - 0.64, 3.32),
                   (c_y1 - 0.76, 3.28), (c_y1 - 0.26, 2.54)],
              sx * (hw - 0.09), sx * (hw - 0.02), BLUE)

    # Side windows, doors, handles, steps, mirrors.
    for sx in (-1, 1):
        x = sx * (hw - 0.02)
        o = float(sx)
        # Door window, held well back from the screen so a body-coloured
        # A-pillar survives between them. Run them together and the glazing
        # becomes one dark band wrapping the corner, which reads as a slot cut
        # in a block rather than a cab with windows in it.
        box(bm, x, x + o * 0.02, c_y0 + 0.62, c_y1 - 1.34, 2.46, 3.12, GLASS)
        seam(bm, x, c_y0 + 0.40, c_y0 + 0.44, 1.16, 3.30, o)
        seam(bm, x, c_y1 - 0.72, c_y1 - 0.68, 1.20, 3.28, o)
        seam(bm, x, c_y0 + 0.44, c_y1 - 0.72, 2.34, 2.38, o)
        handle(bm, x, c_y0 + 0.62, c_y0 + 0.92, 2.16, o)
        step(bm, x - o * 0.06, c_y0 + 0.55, c_y0 + 1.35, 1.02, o, 0.26)
        step(bm, x - o * 0.06, c_y0 + 0.60, c_y0 + 1.30, 0.60, o, 0.22)
        mirror(bm, x, c_y1 - 0.80, 2.62, 3.30, o, 0.22)
        # Fuel or battery box slung under the doors.
        box(bm, x - o * 0.30, x - o * 0.02, c_y0 + 1.55, c_y0 + 2.75, 0.74, 1.22, TRIM)
        wheel_arch(bm, x, x + o * 0.04, c_y1 - 1.62, 0.70, 0.55)
        wheel_arch(bm, x, x + o * 0.04, 2.95, 0.66, 0.52)
        wheel_arch(bm, x, x + o * 0.04, 1.62, 0.66, 0.52)

    # Front: grille, bumper, lights, plate recess.
    grille(bm, -hw + 0.20, hw - 0.20, c_y1 + 0.005, 1.86, 2.52, 5, 1.0, BLUE_DK)
    box(bm, -hw + 0.04, hw - 0.04, c_y1 - 0.02, c_y1 + 0.16, 1.28, 1.80, CHASSIS)
    box(bm, -0.30, 0.30, c_y1 + 0.15, c_y1 + 0.19, 1.38, 1.62, TRIM)
    for sx in (-1, 1):
        light(bm, sx * 0.78 - 0.26, sx * 0.78 + 0.26, c_y1 + 0.01, 1.88, 2.14, HEAD)
        light(bm, sx * 0.78 - 0.20, sx * 0.78 + 0.20, c_y1 + 0.16, 1.36, 1.52, INDIC, 0.05)
    # Sun visor over the screen.
    box(bm, -hw + 0.08, hw - 0.08, c_y1 - 0.70, c_y1 - 0.50, 3.30, 3.40, BLUE_DK)

    # ---- wheels ----------------------------------------------------------
    steer_r, drive_r, trl_r = 0.55, 0.52, 0.50
    for sx in (-1, 1):
        x_out = sx * hw
        x_in = sx * (hw - 0.30)
        wheel(bm, c_y1 - 1.62, steer_r, x_in, x_out, steer_r)
        for y in (2.95, 1.62):                      # tandem drive axles
            wheel(bm, y, drive_r, x_in, x_out, drive_r)
        for y in (-5.55, -6.95):                    # tandem trailer axles
            wheel(bm, y, trl_r, x_in, x_out, trl_r)
    return {"length": 16.2, "width": 2 * hw, "height": 3.95}


# ------------------------------------------------------------------- cars

def _car_common(bm, hw, L, wheelbase, wheel_r, body_mat, roof_z, belt_z,
                bonnet_z, boot_z, glass_pts, doors, arch_z=None):
    """Shared construction for every car.

    The three cars differ in profile and proportion, not in what they are made
    of. Sharing the fittings is what keeps them a family; giving them their own
    silhouettes is what stops them being one mesh at three scales, which the
    brief calls out explicitly.
    """
    fy, ry = L / 2, -L / 2
    ax_f, ax_r = wheelbase / 2, -wheelbase / 2
    arch_z = arch_z if arch_z is not None else wheel_r * 0.95

    wedge(bm, glass_pts, -hw + 0.01, hw - 0.01, body_mat)
    box(bm, -hw + 0.06, hw - 0.06, ry + 0.12, fy - 0.12, 0.18, belt_z - 0.02, body_mat)

    # Glasshouse: screen, backlight and side glass with a real B-pillar.
    wedge(bm, [(glass_pts[2][0], belt_z + 0.02), (glass_pts[3][0], roof_z - 0.02),
               (glass_pts[3][0] - 0.06, roof_z - 0.03), (glass_pts[2][0] - 0.06, belt_z + 0.01)],
          -hw + 0.10, hw - 0.10, GLASS)
    wedge(bm, [(glass_pts[4][0], roof_z - 0.02), (glass_pts[5][0], belt_z + 0.02),
               (glass_pts[5][0] + 0.06, belt_z + 0.01), (glass_pts[4][0] + 0.06, roof_z - 0.03)],
          -hw + 0.10, hw - 0.10, GLASS)
    mid = (glass_pts[3][0] + glass_pts[4][0]) / 2
    for sx in (-1, 1):
        x, o = sx * (hw - 0.02), float(sx)
        box(bm, x, x + o * 0.02, glass_pts[3][0] - 0.10, mid + 0.03,
            belt_z + 0.03, roof_z - 0.05, GLASS)
        if doors == 4:
            box(bm, x, x + o * 0.02, mid + 0.10, glass_pts[4][0] + 0.10,
                belt_z + 0.03, roof_z - 0.06, GLASS)
            box(bm, x, x + o * 0.03, mid + 0.03, mid + 0.10,
                belt_z, roof_z - 0.02, body_mat)          # B-pillar
        # Door seams, handles, sill.
        seams = ([glass_pts[3][0] - 0.14, mid + 0.06, glass_pts[4][0] + 0.16]
                 if doors == 4 else [glass_pts[3][0] - 0.14, glass_pts[4][0] + 0.16])
        for sy in seams:
            seam(bm, x, sy, sy + 0.025, 0.30, belt_z + 0.02, o, TRIM, 0.014)
        handle(bm, x, mid - 0.28, mid - 0.06, belt_z - 0.14, o)
        if doors == 4:
            handle(bm, x, mid + 0.30, mid + 0.52, belt_z - 0.14, o)
        mirror(bm, x, glass_pts[3][0] - 0.18, belt_z - 0.02, belt_z + 0.14, o, 0.10)
        wheel_arch(bm, x, x + o * 0.03, ax_f, wheel_r + 0.10, arch_z, segs=5)
        wheel_arch(bm, x, x + o * 0.03, ax_r, wheel_r + 0.10, arch_z, segs=5)

    # Front and rear fittings.
    grille(bm, -hw + 0.26, hw - 0.26, fy - 0.01, bonnet_z - 0.30, bonnet_z - 0.10, 3, 1.0, TRIM)
    box(bm, -hw + 0.04, hw - 0.04, fy - 0.10, fy + 0.02, 0.22, bonnet_z - 0.34, TRIM)
    box(bm, -hw + 0.04, hw - 0.04, ry - 0.02, ry + 0.10, 0.22, boot_z - 0.30, TRIM)
    for sx in (-1, 1):
        light(bm, sx * (hw - 0.44) - 0.22, sx * (hw - 0.44) + 0.22, fy - 0.02,
              bonnet_z - 0.24, bonnet_z - 0.06, HEAD, 0.07)
        light(bm, sx * (hw - 0.44) - 0.18, sx * (hw - 0.44) + 0.18, ry + 0.02,
              boot_z - 0.26, boot_z - 0.08, BRAKE, 0.06, -1.0)
        wheel(bm, ax_f, wheel_r, sx * (hw - 0.20), sx * (hw - 0.02), wheel_r, 10)
        wheel(bm, ax_r, wheel_r, sx * (hw - 0.20), sx * (hw - 0.02), wheel_r, 10)


def build_sedan(bm, body_mat=BODY):
    """Three-box saloon: bonnet, cabin, boot."""
    hw, L, wb, r = 0.90, 4.62, 2.72, 0.32
    belt, roof, bonnet, boot = 0.94, 1.46, 0.92, 0.98
    pts = [(-L/2, 0.20), (L/2, 0.20), (L/2, bonnet), (0.86, roof),
           (-0.98, roof), (-L/2 + 0.10, boot), (-L/2, boot - 0.06)]
    _car_common(bm, hw, L, wb, r, body_mat, roof, belt, bonnet, boot, pts, 4)
    return {"length": L, "width": 2*hw, "height": roof}


def build_compact(bm, body_mat=BODY):
    """Hatchback/crossover: shorter, taller cabin, cut-off tail."""
    hw, L, wb, r = 0.88, 4.06, 2.52, 0.33
    belt, roof, bonnet, boot = 0.98, 1.62, 0.94, 1.30
    pts = [(-L/2, 0.22), (L/2, 0.22), (L/2, bonnet), (0.72, roof),
           (-1.28, roof), (-L/2 + 0.06, boot), (-L/2, boot - 0.30)]
    _car_common(bm, hw, L, wb, r, body_mat, roof, belt, bonnet, boot, pts, 4,
                arch_z=r * 1.05)
    return {"length": L, "width": 2*hw, "height": roof}


def build_coupe(bm, body_mat=BODY):
    """Low, raked two-door."""
    hw, L, wb, r = 0.92, 4.52, 2.68, 0.32
    belt, roof, bonnet, boot = 0.88, 1.34, 0.84, 0.92
    pts = [(-L/2, 0.18), (L/2, 0.18), (L/2, bonnet), (0.58, roof),
           (-0.72, roof), (-L/2 + 0.28, boot), (-L/2, boot - 0.10)]
    _car_common(bm, hw, L, wb, r, body_mat, roof, belt, bonnet, boot, pts, 2)
    return {"length": L, "width": 2*hw, "height": roof}


# ------------------------------------------------------------------- vans

def build_cargo_van(bm, body_mat=BODY):
    """Small panel van: short bonnet, tall box behind it."""
    hw, L, wb, r = 0.98, 5.20, 3.10, 0.34
    roof, belt = 2.24, 1.16
    fy, ry = L/2, -L/2
    wedge(bm, [(ry, 0.24), (fy, 0.24), (fy, 0.92), (fy - 0.52, 1.30),
               (fy - 1.05, roof), (ry, roof), (ry, 0.24)],
          -hw + 0.01, hw - 0.01, body_mat)
    wedge(bm, [(fy - 0.54, 1.34), (fy - 1.02, roof - 0.06),
               (fy - 1.12, roof - 0.08), (fy - 0.64, 1.30)],
          -hw + 0.09, hw - 0.09, GLASS)
    for sx in (-1, 1):
        x, o = sx * (hw - 0.02), float(sx)
        box(bm, x, x + o * 0.02, fy - 1.90, fy - 1.24, 1.42, roof - 0.30, GLASS)
        seam(bm, x, fy - 2.00, fy - 1.97, 0.36, roof - 0.16, o)     # door
        seam(bm, x, fy - 3.30, fy - 3.27, 0.36, roof - 0.16, o)     # sliding door
        seam(bm, x, ry + 0.14, fy - 1.10, 0.86, 0.90, o, TRIM, 0.026)
        handle(bm, x, fy - 2.24, fy - 2.02, 1.24, o)
        mirror(bm, x, fy - 1.16, 1.42, 1.74, o, 0.14)
        wheel_arch(bm, x, x + o * 0.03, wb/2, r + 0.11, r * 0.98)
        wheel_arch(bm, x, x + o * 0.03, -wb/2, r + 0.11, r * 0.98)
        for k in range(4):                                          # roof ribs
            y = ry + 0.7 + k * 1.0
            box(bm, -hw + 0.10, hw - 0.10, y, y + 0.06, roof, roof + 0.025, TRIM)
    grille(bm, -hw + 0.24, hw - 0.24, fy - 0.01, 0.60, 0.84, 3, 1.0, TRIM)
    box(bm, -hw + 0.04, hw - 0.04, fy - 0.10, fy + 0.03, 0.24, 0.58, TRIM)
    box(bm, -hw + 0.04, hw - 0.04, ry - 0.03, ry + 0.10, 0.24, 0.52, TRIM)
    box(bm, -0.03, 0.03, ry - 0.04, ry + 0.02, 0.52, roof - 0.14, TRIM)   # door split
    for sx in (-1, 1):
        light(bm, sx * (hw - 0.36) - 0.20, sx * (hw - 0.36) + 0.20, fy - 0.02,
              0.62, 0.84, HEAD, 0.07)
        light(bm, sx * (hw - 0.26) - 0.12, sx * (hw - 0.26) + 0.12, ry + 0.02,
              0.90, 1.42, BRAKE, 0.06, -1.0)
        wheel(bm, wb/2, r, sx * (hw - 0.22), sx * (hw - 0.02), r, 14)
        wheel(bm, -wb/2, r, sx * (hw - 0.22), sx * (hw - 0.02), r, 14)
    return {"length": L, "width": 2*hw, "height": roof}


def build_panel_truck(bm, body_mat=BODY):
    """Larger panel truck — one continuous body, cab integrated."""
    hw, L, wb, r = 1.15, 6.60, 4.00, 0.42
    roof, belt = 2.90, 1.30
    fy, ry = L/2, -L/2
    wedge(bm, [(ry, 0.30), (fy, 0.30), (fy, 1.04), (fy - 0.42, 1.48),
               (fy - 0.92, roof), (ry, roof), (ry, 0.30)],
          -hw + 0.01, hw - 0.01, body_mat)
    wedge(bm, [(fy - 0.44, 1.52), (fy - 0.90, roof - 0.08),
               (fy - 1.00, roof - 0.10), (fy - 0.54, 1.48)],
          -hw + 0.10, hw - 0.10, GLASS)
    for sx in (-1, 1):
        x, o = sx * (hw - 0.02), float(sx)
        box(bm, x, x + o * 0.02, fy - 2.10, fy - 1.06, 1.62, roof - 0.42, GLASS)
        seam(bm, x, fy - 2.22, fy - 2.18, 0.44, roof - 0.20, o)
        seam(bm, x, fy - 3.90, fy - 3.86, 0.44, roof - 0.20, o)
        seam(bm, x, ry + 0.16, fy - 0.96, 0.98, 1.04, o, TRIM, 0.030)
        handle(bm, x, fy - 2.48, fy - 2.24, 1.42, o)
        mirror(bm, x, fy - 0.98, 1.64, 2.06, o, 0.18)
        step(bm, x - o * 0.05, fy - 2.20, fy - 1.60, 0.56, o, 0.22)
        wheel_arch(bm, x, x + o * 0.04, wb/2, r + 0.13, r * 0.96)
        wheel_arch(bm, x, x + o * 0.04, -wb/2, r + 0.13, r * 0.96)
        for k in range(5):
            y = ry + 0.8 + k * 1.05
            box(bm, -hw + 0.12, hw - 0.12, y, y + 0.07, roof, roof + 0.03, TRIM)
    grille(bm, -hw + 0.28, hw - 0.28, fy - 0.01, 0.66, 0.98, 4, 1.0, TRIM)
    box(bm, -hw + 0.05, hw - 0.05, fy - 0.12, fy + 0.04, 0.28, 0.64, TRIM)
    box(bm, -hw + 0.05, hw - 0.05, ry - 0.04, ry + 0.12, 0.28, 0.60, TRIM)
    box(bm, -0.035, 0.035, ry - 0.05, ry + 0.02, 0.60, roof - 0.16, TRIM)
    for sx in (-1, 1):
        light(bm, sx * (hw - 0.40) - 0.24, sx * (hw - 0.40) + 0.24, fy - 0.02,
              0.68, 0.94, HEAD, 0.08)
        light(bm, sx * (hw - 0.30) - 0.14, sx * (hw - 0.30) + 0.14, ry + 0.02,
              1.00, 1.60, BRAKE, 0.07, -1.0)
        wheel(bm, wb/2, r, sx * (hw - 0.26), sx * (hw - 0.02), r, 16)
        wheel(bm, -wb/2, r, sx * (hw - 0.26), sx * (hw - 0.02), r, 16)
    return {"length": L, "width": 2*hw, "height": roof}


def build_box_truck(bm, body_mat=BODY, cab_mat=BLUE):
    """Cab-over tractor with a separate cargo box and a visible chassis gap."""
    hw, L, r = 1.18, 7.40, 0.46
    fy, ry = L/2, -L/2
    cab_y0 = fy - 2.10
    roof_cab, roof_box = 2.78, 3.32
    for sx in (-1, 1):
        box(bm, sx*0.72 - 0.09, sx*0.72 + 0.09, ry + 0.2, fy - 0.6, 0.66, 0.94, CHASSIS)
    wedge(bm, [(cab_y0, 0.94), (fy - 0.12, 0.94), (fy, 1.34),
               (fy - 0.08, 2.10), (fy - 0.66, roof_cab), (cab_y0, roof_cab)],
          -hw + 0.02, hw - 0.02, cab_mat)
    wedge(bm, [(fy - 0.14, 2.12), (fy - 0.62, roof_cab - 0.06),
               (fy - 0.72, roof_cab - 0.08), (fy - 0.24, 2.06)],
          -hw + 0.09, hw - 0.09, GLASS)
    box(bm, -hw + 0.01, hw - 0.01, ry + 0.10, cab_y0 - 0.22, 0.94, roof_box, body_mat)
    box(bm, -hw + 0.16, hw - 0.16, cab_y0 - 0.30, cab_y0 - 0.10,
        roof_box - 0.55, roof_box + 0.30, TRIM)          # fridge unit
    for sx in (-1, 1):
        x, o = sx * (hw - 0.02), float(sx)
        box(bm, x, x + o * 0.02, cab_y0 + 0.22, fy - 0.92, 2.06, roof_cab - 0.20, GLASS)
        seam(bm, x, cab_y0 + 0.10, cab_y0 + 0.14, 1.02, roof_cab - 0.10, o)
        handle(bm, x, cab_y0 + 0.32, cab_y0 + 0.54, 1.82, o)
        mirror(bm, x, fy - 0.86, 2.16, 2.72, o, 0.20)
        step(bm, x - o * 0.05, cab_y0 + 0.20, cab_y0 + 0.86, 0.62, o, 0.24)
        seam(bm, x, ry + 0.2, cab_y0 - 0.3, roof_box - 0.30, roof_box - 0.26, o, TRIM, 0.02)
        seam(bm, x, ry + 0.2, cab_y0 - 0.3, 1.20, 1.24, o, TRIM, 0.02)
        for k in range(4):
            y = ry + 0.8 + k * 1.05
            seam(bm, x, y, y + 0.03, 1.28, roof_box - 0.34, o, TRIM, 0.014)
        wheel_arch(bm, x, x + o * 0.04, fy - 1.42, r + 0.13, r * 0.96)
        wheel_arch(bm, x, x + o * 0.04, ry + 1.70, r + 0.13, r * 0.96)
    grille(bm, -hw + 0.26, hw - 0.26, fy - 0.005, 1.42, 1.94, 4, 1.0, BLUE_DK)
    box(bm, -hw + 0.05, hw - 0.05, fy - 0.10, fy + 0.10, 0.92, 1.38, CHASSIS)
    for sx in (-1, 1):
        light(bm, sx*0.70 - 0.24, sx*0.70 + 0.24, fy + 0.01, 1.44, 1.68, HEAD, 0.07)
        light(bm, sx*0.70 - 0.18, sx*0.70 + 0.18, fy + 0.10, 1.00, 1.16, INDIC, 0.05)
        light(bm, sx*0.66 - 0.16, sx*0.66 + 0.16, ry + 0.09, 1.06, 1.34, BRAKE, 0.06, -1.0)
        wheel(bm, fy - 1.42, r, sx*(hw - 0.26), sx*(hw - 0.02), r, 16)
        wheel(bm, ry + 1.70, r, sx*(hw - 0.26), sx*(hw - 0.02), r, 16)
    box(bm, -hw + 0.02, hw - 0.02, ry + 0.02, ry + 0.12, 1.00, roof_box - 0.10, BLUE_DK)
    box(bm, -0.035, 0.035, ry + 0.01, ry + 0.08, 1.04, roof_box - 0.16, TRIM)
    box(bm, -hw + 0.12, hw - 0.12, ry - 0.06, ry + 0.06, 0.56, 0.72, CHASSIS)
    return {"length": L, "width": 2*hw, "height": roof_box}


# -------------------------------------------------------------------- bus

def build_bus(bm, body_mat=BODY, accent=BLUE):
    """Low-floor city bus."""
    hw, L, r = 1.26, 11.40, 0.50
    fy, ry = L/2, -L/2
    roof, sill, head = 3.18, 1.10, 2.46
    wedge(bm, [(ry, 0.34), (ry + 0.18, 0.30), (fy - 0.18, 0.30), (fy, 0.46),
               (fy, 2.28), (fy - 0.22, roof), (ry + 0.22, roof), (ry, 2.20)],
          -hw + 0.01, hw - 0.01, body_mat)
    # Proud of the flank, not buried in it: an accent panel sharing the body's
    # own surface is two coplanar faces and z-fights into diagonal striping.
    box(bm, -hw - 0.012, hw + 0.012, ry + 0.16, fy - 0.16, 0.36, sill - 0.02, accent)
    wedge(bm, [(fy - 0.04, 2.30), (fy - 0.24, roof - 0.06),
               (fy - 0.34, roof - 0.08), (fy - 0.14, 2.24)],
          -hw + 0.10, hw - 0.10, GLASS)
    box(bm, -hw + 0.10, hw - 0.10, ry + 0.02, ry + 0.10, 2.20, roof - 0.14, GLASS)
    for sx in (-1, 1):
        x, o = sx * (hw - 0.02), float(sx)
        for k in range(6):                       # individual side windows
            y = ry + 0.85 + k * 1.62
            box(bm, x, x + o * 0.02, y, y + 1.44, sill + 0.34, head, GLASS)
        seam(bm, x, ry + 0.3, fy - 0.3, sill + 0.26, sill + 0.32, o, TRIM, 0.024)
        seam(bm, x, ry + 0.3, fy - 0.3, head + 0.02, head + 0.08, o, TRIM, 0.024)
        for dy in (fy - 1.55, -0.35):            # passenger doors
            box(bm, x, x + o * 0.03, dy, dy + 1.16, 0.40, head + 0.02, GLASS)
            box(bm, x, x + o * 0.045, dy + 0.56, dy + 0.60, 0.40, head + 0.02, TRIM)
            seam(bm, x, dy - 0.04, dy, 0.40, head + 0.06, o)
            seam(bm, x, dy + 1.16, dy + 1.20, 0.40, head + 0.06, o)
        wheel_arch(bm, x, x + o * 0.04, fy - 2.05, r + 0.14, r * 0.94)
        wheel_arch(bm, x, x + o * 0.04, ry + 2.65, r + 0.14, r * 0.94)
        mirror(bm, x, fy - 0.42, 2.34, 2.80, o, 0.24)
    box(bm, -hw + 0.22, hw - 0.22, fy - 0.30, fy - 0.06, roof - 0.42, roof - 0.12, TRIM)
    for k, (y, w) in enumerate(((ry + 2.2, 1.5), (-0.6, 1.9), (fy - 3.4, 1.4))):
        box(bm, -hw + 0.30, hw - 0.30, y, y + w, roof, roof + 0.16, TRIM)   # roof units
    grille(bm, -hw + 0.34, hw - 0.34, fy - 0.005, 0.58, 0.92, 3, 1.0, TRIM)
    box(bm, -hw + 0.06, hw - 0.06, fy - 0.12, fy + 0.06, 0.32, 0.54, CHASSIS)
    box(bm, -hw + 0.06, hw - 0.06, ry - 0.04, ry + 0.12, 0.32, 0.52, CHASSIS)
    for sx in (-1, 1):
        light(bm, sx*(hw - 0.40) - 0.24, sx*(hw - 0.40) + 0.24, fy + 0.01, 0.60, 0.86, HEAD, 0.07)
        light(bm, sx*(hw - 0.36) - 0.16, sx*(hw - 0.36) + 0.16, ry + 0.02, 0.62, 1.02, BRAKE, 0.06, -1.0)
        wheel(bm, fy - 2.05, r, sx*(hw - 0.28), sx*(hw - 0.02), r, 16)
        wheel(bm, ry + 2.65, r, sx*(hw - 0.28), sx*(hw - 0.02), r, 16)
    return {"length": L, "width": 2*hw, "height": roof}


# --------------------------------------------------------- two-wheelers

def build_scooter(bm):
    """Seated scooter — simplified, but the silhouette has to be unmistakable."""
    r = 0.26
    for cy in (0.62, -0.62):
        cyl_x(bm, cy, r, -0.07, 0.07, r, 12, TYRE)
        cyl_x(bm, cy, r, -0.045, 0.075, r * 0.52, 10, HUB)
    box(bm, -0.05, 0.05, 0.50, 0.74, r + 0.10, 1.00, TRIM)          # fork
    box(bm, -0.30, 0.30, 0.60, 0.68, 1.00, 1.06, TRIM)              # handlebar
    wedge(bm, [(0.78, 0.62), (0.52, 0.62), (0.44, 1.02), (0.72, 1.00)],
          -0.16, 0.16, BLUE)                                        # front fairing
    light(bm, -0.09, 0.09, 0.78, 0.80, 0.94, HEAD, 0.05)
    box(bm, -0.17, 0.17, -0.16, 0.50, 0.30, 0.40, TRIM)             # footboard
    wedge(bm, [(0.10, 0.42), (-0.62, 0.42), (-0.70, 0.74), (0.04, 0.80)],
          -0.17, 0.17, BLUE)                                        # rear body
    box(bm, -0.16, 0.16, -0.44, 0.10, 0.80, 0.90, TRIM)             # seat
    light(bm, -0.07, 0.07, -0.70, 0.72, 0.82, BRAKE, 0.04, -1.0)
    return {"length": 1.85, "width": 0.62, "height": 1.06}


def build_e_scooter(bm):
    """Standing scooter. The most aggressively simplified thing here, but its
    outline still has to be legible at environment scale."""
    r = 0.14
    for cy in (0.44, -0.44):
        cyl_x(bm, cy, r, -0.035, 0.035, r, 10, TYRE)
    box(bm, -0.09, 0.09, -0.46, 0.46, r + 0.02, r + 0.08, TRIM)     # deck
    box(bm, -0.035, 0.035, 0.40, 0.47, r + 0.06, 1.06, TRIM)        # column
    box(bm, -0.24, 0.24, 0.41, 0.46, 1.02, 1.07, TRIM)              # handlebar
    box(bm, -0.05, 0.05, 0.46, 0.52, 0.94, 1.00, HEAD)              # light
    box(bm, -0.06, 0.06, -0.56, -0.40, r + 0.06, r + 0.20, BLUE)    # rear guard
    return {"length": 1.10, "width": 0.48, "height": 1.07}
