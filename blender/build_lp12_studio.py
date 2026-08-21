"""
build_lp12_studio.py — white studio, 9 camera anchors and product lighting
for the LP12 assembly, per the camera/lighting brief.

    blender --background --python build_lp12_studio.py

Starts from lp12_interactive_assembly_v2.blend so the animation clips survive.
Adds one studio, ONE camera moved between named anchor empties, a CAM_TARGET
that tracks the active assembly point, and exports camera_studio_manifest.json
for the runtime.
"""
import bpy, bmesh, math, os, json
from mathutils import Vector

SRC = "/Users/mosesjeremiah/blender/deliverables/lp12_interactive_assembly_v2.blend"
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLE_H, MOUNT_Z = 12.5, 7.5

# Spec section 9 wants the subject slightly LEFT of viewport centre, so the
# component tray never crowds it. CAM_01 and CAM_09 already compose that into
# their targets - the pole is deliberately off-axis in the full-pole framings -
# so their bias is 0. The close-ups aim straight down the assembly and need it
# applied.
#
# It is carried as a fraction of frame width rather than a world offset because
# only the runtime knows the viewport aspect: the same world shift reads as a
# different fraction in Blender's 1400x1000 and in the app's portrait column.
# The runtime resolves it against its own aspect (see CameraDirector).
SUBJECT_BIAS = {
    "CAM_01_FULL_POLE": 0.0, "CAM_09_COMPLETE": 0.0,
}
DEFAULT_SUBJECT_BIAS = 0.08

# (name, position, look-at target, lens mm, note)
CAMERAS = [
    ("CAM_01_FULL_POLE",  (11.2,  29.8,  6.85), (-2.4, 0.00, 6.55), 52.0,
     "Full pole base to top; pole sits left of centre for the component tray"),
    ("CAM_02_BANDS",      ( 2.30,  4.60, 7.95), ( 0.05, 0.10, 7.50), 55.0,
     "Both band locations together"),
    ("CAM_03_WRONG_DROP", ( 3.10,  6.20, 8.30), ( 0.20, 0.35, 7.55), 48.0,
     "Invalid pole target and mis-dragged antenna in one frame"),
    ("CAM_04_RAIL",       ( 2.45,  5.10, 7.95), ( 0.05, 0.22, 7.50), 52.0,
     "Both bands plus the whole vertical rail"),
    # 62mm at 3.0m put the bracket off-centre with the antenna cropped hard on
    # the left. The bracket sits out at y~0.7, not at y~0.4 against the pole,
    # so the aim was short as well as the framing tight.
    ("CAM_05_PIVOT",      ( 2.20,  4.30, 7.85), ( 0.21, 0.62, 7.52), 50.0,
     "Middle rail section and pivot bracket connection"),
    ("CAM_06_ANTENNA",    ( 2.90,  4.30, 7.90), ( 0.05, 0.62, 7.52), 50.0,
     "Complete antenna moving onto the pivot bracket"),
    ("CAM_07_FASTENERS",  ( 1.75,  3.15, 7.80), ( 0.04, 0.68, 7.54), 64.0,
     "Bolts, washers and their fixing points"),
    ("CAM_08_CONNECTORS", ( 1.95,  3.55, 6.98), ( 0.05, 0.74, 6.78), 58.0,
     "Antenna underside ports and the three cables"),
    ("CAM_09_COMPLETE",   (12.4,  33.0,  6.90), (-1.8, 0.20, 6.60), 54.0,
     "Pull back to the complete installed LP12"),
    # Frames the coverage dome, which at the correct 7.5 m / 5 deg reaches
    # ~86 m - so the subject here is ~170 m across and ~86 m tall, not a
    # 12.5 m pole. Distance is set from the runtime's own framing rule rather
    # than by eye: LP12BuildCanvas holds the AUTHORED VERTICAL fov (1400x1000),
    # so a 35 mm lens gives a ~40 deg vertical and needs ~300 m of standoff to
    # fit 220 m of subject. At 200 m the dome's apex projected past the top of
    # the frame. The aim is lifted to z=40 to centre the dome's mass rather
    # than the ground it stands on.
    ("CAM_10_COVERAGE",   (183.0, 183.0, 150.0), (0.0, 0.0, 40.0), 35.0,
     "Network coverage dome around the site"),
]

# Anchors that are exported to the manifest but NOT rendered here.
#
# CAM_10_COVERAGE stands 300 m out to frame an ~86 m coverage dome. This
# studio's cove is 60 m, so from there the camera is outside the studio
# altogether and the frame is the cyclorama seen from the back - a grey dish
# against the void, which is what it rendered before this was added. Making it
# work needs the whole studio scaled up around the subject, which is what
# deliverables/source/render_coverage.py does, to its own output directory.
# The anchor still ships in the manifest because the app drives its coverage
# stage from it.
RENDER_SKIP = {"CAM_10_COVERAGE"}

STAGE_CAMERA = {
    "inspectPole": "CAM_01_FULL_POLE", "attachBands": "CAM_02_BANDS",
    "attachRail": "CAM_04_RAIL",       "attachPivot": "CAM_05_PIVOT",
    "mountAntenna": "CAM_06_ANTENNA",  "secureAntenna": "CAM_07_FASTENERS",
    "attachConnectors": "CAM_08_CONNECTORS",
    "height": "CAM_01_FULL_POLE", "downtilt": "CAM_05_PIVOT",
    "coverage": "CAM_10_COVERAGE", "handover": "CAM_10_COVERAGE",
    "complete": "CAM_09_COMPLETE",
}


def rgb(hexstr):
    h = hexstr.lstrip('#')
    srgb = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear, so the authored hex matches on screen
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def clear(prefix):
    for ob in list(bpy.data.objects):
        if ob.name.startswith(prefix):
            bpy.data.objects.remove(ob, do_unlink=True)


def collection(name):
    """Fetch or create a scene collection, so new helpers land somewhere named
    rather than loose in the scene root (brief: work non-destructively)."""
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def put(ob, coll_name):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    collection(coll_name).objects.link(ob)


def build_studio():
    """Curved cyclorama plus a low World contribution.

    The previous studio drove the whole scene from a near-white World at
    strength 1.15. That is a uniform dome: it lifts every surface by the same
    amount from every direction, which is precisely why enclosure, hardware,
    pole and backdrop collapsed into one brightness band with no modelling.
    The World is dropped to a light-touch ambient and the visible white now
    comes from a real, lit backdrop object instead.
    """
    world = bpy.data.worlds.new("LP12_Studio")
    bpy.context.scene.world = world
    if bpy.app.version < (5, 0, 0):
        world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*rgb("#EFEFEE"), 1.0)   # neutral grey
    bg.inputs["Strength"].default_value = float(
        os.environ.get("LP12_WORLD", 0.18))              # brief: 0.15-0.30

    mat = bpy.data.materials.new("MAT_Studio_Background")
    if bpy.app.version < (5, 0, 0):
        mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb("#EDECE9"), 1.0)
    b.inputs["Roughness"].default_value = 0.78
    b.inputs["Metallic"].default_value = 0.0

    # Cyclorama as a full cylindrical cove, not a flat wall.
    #
    # A flat backdrop only exists behind cameras that happen to face it. The
    # band close-up shoots from behind the pole, looking the opposite way, and
    # landed the subject against empty world - a dark grey field instead of the
    # studio. Sweeping the profile through 360 degrees means every anchor,
    # whatever direction it faces, has backdrop behind it.
    #
    # Radius clears the furthest camera: the full-pole anchors sit ~35m out, so
    # every camera is inside the cove looking at its far wall.
    R, R_FILLET, Z_TOP, SEG = 60.0, 10.0, 45.0, 96
    # Profile runs outwards from the floor, NOT from the rim: the fillet loop
    # below already begins at radius R-R_FILLET, so seeding this with (R, 0)
    # folds the floor back over itself and punches inverted-normal holes
    # through the backdrop.
    prof = []
    steps = 12
    for i in range(steps + 1):              # floor -> fillet -> wall
        a = (math.pi / 2) * i / steps
        prof.append((R - R_FILLET + R_FILLET * math.sin(a),
                     R_FILLET - R_FILLET * math.cos(a)))
    prof.append((R, Z_TOP))

    bm = bmesh.new()
    rings = []
    for radius, z in prof:
        ring = [bm.verts.new((radius * math.cos(2 * math.pi * i / SEG),
                              radius * math.sin(2 * math.pi * i / SEG), z))
                for i in range(SEG)]
        rings.append(ring)
    centre = bm.verts.new((0.0, 0.0, 0.0))
    for i in range(SEG):                    # floor fan
        bm.faces.new([centre, rings[0][i], rings[0][(i + 1) % SEG]])
    for r in range(len(rings) - 1):         # wall quads
        for i in range(SEG):
            j = (i + 1) % SEG
            bm.faces.new([rings[r][i], rings[r][j],
                          rings[r + 1][j], rings[r + 1][i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("Studio_Cyclorama")
    bm.to_mesh(me); bm.free()
    cyc = bpy.data.objects.new("Studio_Cyclorama", me)
    me.materials.append(mat)
    bpy.context.scene.collection.objects.link(cyc)
    put(cyc, "LP12_STUDIO_ENVIRONMENT")
    for poly in me.polygons:
        poly.use_smooth = True

    # Camera-visible, but invisible to diffuse and glossy rays.
    #
    # This is the hinge of the whole correction. A white cyclorama bright
    # enough to read as a studio backdrop is also an enormous bounce card: it
    # floods the subject from every direction and re-creates the exact flat,
    # foggy look being fixed. Measuring the target reference gives backdrop 238
    # against a pole shaft of 152 - an 86-level separation that is unreachable
    # while the two are coupled by bounce.
    #
    # Killing diffuse/glossy visibility decouples them: the backdrop can be
    # driven to near-white by its own wash while the LP12 is lit solely by the
    # key/fill/rim rig. The cyc still shows to camera and still catches the
    # footer's contact shadow, because casting and receiving are unaffected.
    for attr, val in (("visible_diffuse", False), ("visible_glossy", False),
                      ("visible_transmission", False),
                      ("visible_volume_scatter", False),
                      ("visible_camera", True), ("visible_shadow", True)):
        if hasattr(cyc, attr):
            setattr(cyc, attr, val)
    return cyc


def build_lights():
    """Key / fill / rim with a dominant key, per brief Step 4.

    The ratios are the point. The previous rig ran fill at 50% of key, which
    cancels the key's direction and leaves the form unmodelled; the brief calls
    for 15-25%. Absolute wattage is scene-scale dependent and tuned against the
    render - the ratios are held.
    """
    # Absolute power is scene-scale dependent - a 5m softbox ~15m from a 12.5m
    # pole needs far more than the brief's nominal figures, which assume a
    # tabletop setup. The brief allows this so long as the ratios hold.
    #
    # These values are not guesses. The target reference was measured
    # (backdrop 238, pole shaft 152) and key/wash/world were swept in Cycles
    # against those numbers. The wash is large because it lights a 60m-radius
    # cove, not a wall - it is a backdrop control, and light linking keeps it
    # off the model entirely, so it never touches the ratios above.
    # Tuning in EEVEE and delivering in Cycles does NOT work: Cycles transports
    # far more light, and the EEVEE-tuned rig rendered at a range of 44, worse
    # than the washed-out original's 65.
    KEY = float(os.environ.get("LP12_KEY_W", 4600.0))
    specs = [
        # name,              location,            size, share, colour
        ("LP12_Key_Area",   ( 8.5, 10.5, 15.0),   5.0, 1.00,  (1.0, 0.99, 0.972)),
        ("LP12_Fill_Area",  (-9.5,  9.5,  7.5),   4.5, 0.20,  (0.97, 0.98, 1.0)),
        ("LP12_Rim_Area",   (-3.5, -8.5, 14.5),   2.6, 0.30,  (1.0, 1.0, 1.0)),
    ]
    out = []
    for name, loc, size, share, col in specs:
        d = bpy.data.lights.new(name, 'AREA')
        d.shape = 'SQUARE'
        d.size = size
        d.energy = KEY * share
        d.color = col
        o = bpy.data.objects.new(name, d)
        o.location = loc
        bpy.context.scene.collection.objects.link(o)
        aim = Vector((0, 0.4, MOUNT_Z)) - Vector(loc)
        o.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
        put(o, "LP12_STUDIO_LIGHTS")
        out.append(o)
        print(f"  light {name:16s} {d.energy:7.1f}W  size {size}m  "
              f"({share * 100:.0f}% of key)")

    # Backdrop wash. A cyclorama will not reach off-white off the key alone -
    # raising the key to get it there blows the subject out first, which the
    # power sweep confirmed at every level. Studio practice is a separate cyc
    # wash, and light linking keeps it strictly off the model, so the key/fill/
    # rim ratios that shape the LP12 stay exactly as set above.
    cyc = bpy.data.objects.get("Studio_Cyclorama")
    if cyc:
        d = bpy.data.lights.new("LP12_Backdrop_Wash", 'AREA')
        d.shape = 'RECTANGLE'
        d.size, d.size_y = 90.0, 90.0
        d.energy = float(os.environ.get("LP12_WASH_W", 500000.0))
        d.color = (1.0, 1.0, 1.0)
        o = bpy.data.objects.new("LP12_Backdrop_Wash", d)
        o.location = (0.0, 0.0, 40.0)
        aim = Vector((0.0, 0.0, 0.0)) - Vector(o.location)
        o.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(o)
        put(o, "LP12_STUDIO_LIGHTS")

        linked = False
        try:
            recv = bpy.data.collections.get("LP12_BACKDROP_RECEIVER")
            if not recv:
                recv = bpy.data.collections.new("LP12_BACKDROP_RECEIVER")
            if cyc.name not in recv.objects:
                recv.objects.link(cyc)
            o.light_linking.receiver_collection = recv
            linked = True
        except (AttributeError, TypeError):
            pass
        print(f"  light {'LP12_Backdrop_Wash':16s} {d.energy:7.1f}W  "
              f"cyc-only={linked}")
        out.append(o)
    return out


def build_cameras():
    """One camera plus named anchor empties. The runtime moves the camera
    between anchors — the pole never moves (s2)."""
    target = bpy.data.objects.new("CAM_TARGET", None)
    target.empty_display_type = 'SPHERE'
    target.empty_display_size = 0.25
    target.location = (0, 0.4, MOUNT_Z)
    bpy.context.scene.collection.objects.link(target)

    cd = bpy.data.cameras.new("CAM_MAIN")
    cd.lens = 52.0
    cd.clip_start, cd.clip_end = 0.05, 500.0
    cam = bpy.data.objects.new("CAM_MAIN", cd)
    cam.location = CAMERAS[0][1]
    bpy.context.scene.collection.objects.link(cam)
    con = cam.constraints.new('TRACK_TO')
    con.target = target
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'

    anchors = []
    for name, pos, tgt, lens, note in CAMERAS:
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'CUBE'
        e.empty_display_size = 0.18
        e.location = pos
        e["lens_mm"] = lens
        e["target"] = list(tgt)
        e["note"] = note
        bpy.context.scene.collection.objects.link(e)
        anchors.append(e)
    return cam, target, anchors


def setup_render(engine="CYCLES"):
    """Cycles for validation renders (brief Step 8); EEVEE stays available for
    quick iteration. Colour management is the brief's, and it is half the fix:
    exposure was +0.2, lifting an already-flat image."""
    scn = bpy.context.scene
    # Do not probe the engine enum to decide: this build accepts 'CYCLES' but
    # does not list it in RenderSettings.engine's dynamic enum, so checking the
    # enum silently downgraded every validation render to EEVEE. Assign and
    # catch instead.
    ids = {i.identifier for i in
           bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
    ok = False
    if engine == "CYCLES":
        try:
            scn.render.engine = 'CYCLES'
            ok = scn.render.engine == 'CYCLES'
        except (TypeError, AttributeError):
            ok = False
    if ok:
        cy = scn.cycles
        cy.samples = 256
        cy.use_denoising = True
        try:
            cy.denoiser = 'OPENIMAGEDENOISE'
        except TypeError:
            pass
        cy.max_bounces = 6
        cy.transparent_max_bounces = 4
        cy.diffuse_bounces = 4
        cy.glossy_bounces = 4
        try:
            cp = bpy.context.preferences.addons['cycles'].preferences
            for backend in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
                try:
                    devs = cp.get_devices_for_type(backend)
                except (TypeError, RuntimeError):
                    continue
                if devs:
                    cp.compute_device_type = backend
                    for d in devs:
                        d.use = True
                    cy.device = 'GPU'
                    print(f"  gpu    {backend}: {[d.name for d in devs][:2]}")
                    break
            else:
                cy.device = 'CPU'
        except (TypeError, KeyError, AttributeError) as e:
            print(f"  gpu    unavailable ({type(e).__name__}), CPU")
            cy.device = 'CPU'
        print(f"  engine CYCLES  samples={cy.samples} device={cy.device} "
              f"bounces={cy.max_bounces}")
    else:
        scn.render.engine = ('BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in ids
                             else 'BLENDER_EEVEE')
        try:
            scn.eevee.taa_render_samples = 128
            scn.eevee.use_raytracing = True
            scn.eevee.use_shadows = True
        except AttributeError:
            pass
        print(f"  engine {scn.render.engine}")

    scn.render.resolution_x, scn.render.resolution_y = 1400, 1000
    scn.render.image_settings.file_format = 'PNG'
    scn.render.film_transparent = False

    # Brief Step 2. Exposure is the single largest tonal correction here.
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
        scn.view_settings.exposure = -0.7
        scn.view_settings.gamma = 1.0
        scn.display_settings.display_device = 'sRGB'
    except TypeError:
        pass
    print(f"  colour AgX / Medium High Contrast / exposure "
          f"{scn.view_settings.exposure} / gamma {scn.view_settings.gamma}")


def tune_materials():
    """Section 6 material response.

    Only metalness and the one untextured base colour are set here. Roughness
    is NOT: every material has the ORM map linked, and a value on the BSDF's
    Roughness input is ignored the moment it is - so the old guarded assignment
    could never fire. The authored roughness lives in the map's green channel
    (regrade_textures.py), which is what both this render and the glTF export
    read. Metalness is kept in step with METALNESS in build_lp12_v2.py so the
    studio renders and the app agree.
    """
    metal = {
        "MAT_Steel_Brushed": 0.92, "MAT_Steel_Dark": 0.90,
        "MAT_Connector_Steel": 0.95, "MAT_Connector_Brass": 0.95,
        "MAT_HeatSink_Charcoal": 0.72,
        "MAT_Concrete_Pole": 0.0, "MAT_Antenna_OffWhite": 0.0,
        "MAT_Rubber_Black": 0.0,
    }
    for name, m in metal.items():
        mat = bpy.data.materials.get(name)
        if not mat or not mat.node_tree:
            continue
        b = mat.node_tree.nodes.get("Principled BSDF")
        if not b:
            continue
        b.inputs["Metallic"].default_value = m
        if name == "MAT_Antenna_OffWhite" and not b.inputs["Base Color"].is_linked:
            b.inputs["Base Color"].default_value = (0.86, 0.86, 0.84, 1.0)


def check_source_rebuilt():
    """Refuse to render against a stale source blend.

    SRC is written by build_lp12_v2.py, but an open Blender GUI session writes
    it too - and a GUI opened before the last CLI build holds the pre-build
    scene, with bpy.data.is_dirty reading False the whole time. Saving from it
    silently rolls SRC back. That happened on 2026-08-19 and cost an hour.

    The regression it causes is no longer visible by eye. Bands without UVs
    sample the atlas at uv (0, 0), and regrade_textures.py now floods that
    background with the island mean - so they render as flat galvanised rather
    than the black that made the original bug findable. A render from a rolled
    back SRC looks plausible. Hence a hard check rather than a visual one.

    UV layers are the marker: build_lp12_v2.py gives every procedural mesh one,
    and the pre-build file has none on the bands, bolts or pole furniture.
    """
    stale = []

    no_uv = sorted(o.name for o in bpy.data.objects
                   if o.type == 'MESH' and not o.data.uv_layers)
    if no_uv:
        stale.append(f"{len(no_uv)} mesh(es) carry no UV layer: "
                     f"{', '.join(no_uv[:6])}{' ...' if len(no_uv) > 6 else ''}")

    furniture = [n for n in ("Pole_Base", "Pole_Anchor_Bolts", "Pole_Cap",
                             "Pole_Step_Studs") if not bpy.data.objects.get(n)]
    if furniture:
        stale.append(f"pole furniture missing: {', '.join(furniture)}")

    clips = {a.name.split("__")[0] for a in bpy.data.actions
             if a.name.startswith("ANIM_")}
    if len(clips) != 6:
        stale.append(f"expected 6 assembly clips, found {len(clips)}: "
                     f"{sorted(clips)}")

    if stale:
        raise SystemExit(
            f"[studio] source blend is stale - re-run build_lp12_v2.py, and do "
            f"not save over it from an open GUI session:\n  {SRC}\n  "
            + "\n  ".join(stale))


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    check_source_rebuilt()
    print("[studio] source blend verified rebuilt")
    # Prefix-clear the studio helpers only. NOT "LP12_" - that prefix also
    # matches LP12_ROOT, the model root every component is parented to, so the
    # new light names are cleared by exact name instead.
    for p in ("KEY_", "FILL_", "RIM_", "GROUND_", "CAM_", "Studio_", "LGT_"):
        clear(p)
    for n in ("LP12_Key_Area", "LP12_Fill_Area", "LP12_Rim_Area"):
        ob = bpy.data.objects.get(n)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)
    build_studio()
    build_lights()
    cam, target, anchors = build_cameras()
    bpy.context.scene.camera = cam
    tune_materials()
    # LP12_ENGINE=EEVEE gives a fast pass for tuning light levels; the
    # delivered validation renders are Cycles.
    setup_render(os.environ.get("LP12_ENGINE", "CYCLES"))
    bpy.context.view_layer.update()

    manifest = {
        "studio": {"world": "#F7F8FA", "floor": "#F1F3F5", "floorRoughness": 0.75},
        "transition": {"durationSeconds": 1.0, "easing": "easeInOut",
                       "holdBeforeAssemblySeconds": 0.25},
        "targetNode": "CAM_TARGET",
        "stageCamera": STAGE_CAMERA,
        "cameras": {},
    }
    for name, pos, tgt, lens, note in CAMERAS:
        sensor = cam.data.sensor_width
        manifest["cameras"][name] = {
            "position": list(pos), "target": list(tgt), "lensMM": lens,
            "fovDegreesHorizontal": round(
                math.degrees(2 * math.atan(sensor / (2 * lens))), 3),
            "sensorWidthMM": sensor, "note": note,
            "subjectBias": SUBJECT_BIAS.get(name, DEFAULT_SUBJECT_BIAS),
        }
    with open(os.path.join(OUT, "camera_studio_manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    scn = bpy.context.scene

    # Render the ASSEMBLED product, not the rest pose.
    #
    # The source blend is saved in its unassembled rest state - that is what
    # the app animates away from - so rendering it as loaded leaves the antenna
    # and cables floating clear of the pole. The three-quarter view happens to
    # hide this because the offsets run toward camera; the side view shows the
    # enclosure detached in mid-air.
    #
    # Every clip ends assembled and NLA strips hold their final value past
    # their own end, so stepping to the scene's last frame settles all six
    # installs at once, with no transform edited by hand.
    scn.frame_set(scn.frame_end)
    bpy.context.view_layer.update()
    print(f"  posed at frame {scn.frame_end} (fully assembled)")

    # Stage anchors, used by the app. Rendered at whatever engine setup_render
    # selected, so they always agree with the validation set.
    rdir = os.path.join(OUT, "studio_renders")
    os.makedirs(rdir, exist_ok=True)
    for i, (name, pos, tgt, lens, note) in enumerate(CAMERAS):
        if name in RENDER_SKIP:
            print(f"  skipped {name} (see render_coverage.py)")
            continue
        cam.location = pos
        target.location = tgt
        cam.data.lens = lens
        bpy.context.view_layer.update()
        scn.render.filepath = os.path.join(rdir, f"{i+1:02d}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  rendered {name}")

    # The brief's required comparison set. Identical colour management and
    # lighting to the above - only the camera moves.
    vdir = os.path.join(OUT, "validation_quality")
    os.makedirs(vdir, exist_ok=True)
    VALIDATION = [
        # Centred and sized for a product plate. The app's CAM_01 deliberately
        # sits the pole left of centre to clear the component tray; that is a UI
        # composition, not a validation one, so these use their own framing.
        ("01_full_three_quarter", (12.0, 32.0, 6.60), ( 0.0, 0.00, 6.40), 55.0,
         "Complete pole and footer, three-quarter"),
        ("02_full_side",          (33.0,  1.5, 6.60), ( 0.0, 0.10, 6.40), 55.0,
         "Complete installation profile, side"),
        ("03_closeup_assembly",   ( 2.20,  4.30, 7.85), (0.21, 0.62, 7.52), 50.0,
         "Antenna, rail, bracket, fasteners and cable exits"),
        # Shot from BEHIND the pole. The bands wrap the shaft at z 7.15/7.85
        # while the rail and enclosure sit on the +Y face, so any camera on the
        # assembly side has the bands fully occluded - the previous position
        # framed the enclosure again and showed no band at all.
        ("04_closeup_bands",      (-1.70, -3.30, 7.70), (0.00, 0.00, 7.50), 62.0,
         "Pole bands and concrete texture"),
    ]
    for name, pos, tgt, lens, note in VALIDATION:
        cam.location = pos
        target.location = tgt
        cam.data.lens = lens
        bpy.context.view_layer.update()
        scn.render.filepath = os.path.join(vdir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  validation {name}")

    cam.location = CAMERAS[0][1]
    target.location = CAMERAS[0][2]
    cam.data.lens = CAMERAS[0][3]
    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(OUT, "lp12_studio.blend"))
    print(f"[studio] {len(CAMERAS)} camera anchors, manifest + renders written")


if __name__ == "__main__":
    main()
