"""
render_coverage.py — coverage-dome views.

    blender --background --python deliverables/source/render_coverage.py

Separate from build_lp12_studio.py because the coverage view is a different
kind of picture. The studio is built around a 12.5 m pole: a 60 m cyclorama, a
camera 30 m out, lights sized for hardware. The dome at the correct rig
settings reaches ~86 m and is framed from ~300 m, which puts the camera outside
the cove entirely and the pole beyond the far wall.

So the studio is scaled up around the same subject rather than rebuilt: the
cove, its wash and the light rig all grow by one factor, which keeps the
established look (off-white backdrop, key/fill/rim ratios, AgX at -0.7) while
enclosing a scene two orders of magnitude larger.

Renders a downtilt series, because the dome's whole point is that its radius is
NOT fixed - it is height / tan(downtilt), so each frame is a different rig
setting and the series shows the relationship the simulation teaches.
"""
import bpy, math, os

SRC = "/Users/mosesjeremiah/blender/deliverables/lp12_studio.blend"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "coverage_renders")

MOUNT_HEIGHT_M = 7.5          # manifest height.idealMetres
MAX_RADIUS_M = 250.0          # matches COVERAGE["max_radius_m"]
STUDIO_SCALE = 8.0            # cove 60 m -> 480 m, encloses a 300 m camera
BACKDROP_EMISSION = 2.4       # lands the cove near the product renders' 237
WORLD_STRENGTH = 2.0          # background for the coverage frames
DOME_ALPHA = 0.34             # authored 0.16 is for a photo, not a light field
DOME_EMISSION = 1.1

# (label, downtilt degrees). 5 deg is the correct answer the sim teaches.
SERIES = [("02deg", 2.0), ("05deg_correct", 5.0), ("10deg", 10.0)]


def rgb_lin(hexstr):
    h = hexstr.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def coverage_radius(height_m, downtilt_deg):
    if downtilt_deg <= 0.25:
        return MAX_RADIUS_M
    return min(MAX_RADIUS_M, height_m / math.tan(math.radians(downtilt_deg)))


def main():
    bpy.ops.wm.open_mainfile(filepath=SRC)
    scn = bpy.context.scene
    scn.frame_set(scn.frame_end)                 # assembled
    bpy.context.view_layer.update()

    dome = bpy.data.objects.get("Coverage_Dome")
    if not dome:
        raise SystemExit("[coverage] Coverage_Dome missing - re-run build_lp12_v2.py")
    dome.hide_render = False                     # hidden for product renders only

    # The model's authored alpha (0.16) and emission (0.35) were set to sit
    # over the network map's aerial photograph. Against this near-white light
    # field the same values leave the shell almost invisible, so the dome is
    # pushed harder for these frames only. Same mesh, same radius - only how
    # hard it is pushed against its background differs, exactly as the app does
    # for its own two surfaces.
    dmat = bpy.data.materials.get("MAT_Coverage_Dome")
    if dmat and dmat.node_tree:
        db = dmat.node_tree.nodes.get("Principled BSDF")
        if db:
            db.inputs["Alpha"].default_value = DOME_ALPHA
            des = db.inputs.get("Emission Strength")
            if des:
                des.default_value = DOME_EMISSION

    # Grow the studio around the subject. The cove is the backdrop, so it has
    # to enclose both the dome and the camera; the wash that lights it and the
    # key/fill/rim that light the hardware move out with it. Area light power
    # goes as the square of size, so intensity per unit area is preserved.
    cyc = bpy.data.objects.get("Studio_Cyclorama")
    if cyc:
        cyc.scale = (STUDIO_SCALE,) * 3
        # Self-lit backdrop for this render only.
        #
        # The cove is invisible to diffuse rays, so the ONLY light it receives
        # is its dedicated wash - and once the studio is scaled up, the wash no
        # longer reaches the upper wall, which renders as a black band across
        # the top of the frame. Rather than chase the wash's size and power up
        # after it, the backdrop is made emissive: it then reads as a uniform
        # off-white at any scale, and the wash becomes irrelevant here.
        mat = bpy.data.materials.get("MAT_Studio_Background")
        if mat and mat.node_tree:
            b = mat.node_tree.nodes.get("Principled BSDF")
            if b:
                b.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
                em = b.inputs.get("Emission Color")
                if em:
                    em.default_value = (*rgb_lin("#EDECE9"), 1.0)
                es = b.inputs.get("Emission Strength")
                if es:
                    es.default_value = BACKDROP_EMISSION
    for ob in bpy.data.objects:
        if ob.type != 'LIGHT':
            continue
        ob.location = [c * STUDIO_SCALE for c in ob.location]
        ob.data.size = getattr(ob.data, "size", 1.0) * STUDIO_SCALE
        if hasattr(ob.data, "size_y"):
            ob.data.size_y *= STUDIO_SCALE
        ob.data.energy *= STUDIO_SCALE ** 2
    bpy.context.view_layer.update()

    # The product studio runs the World at 0.18 because its cove fills every
    # frame. From 300 m out it does not - the frame sees past the rim, and the
    # World shows through as a dark band across the top. For a coverage
    # diagram the surround should read as light anyway, so the World is raised
    # to carry the background instead of fighting the cove's silhouette.
    # It cannot wash the subject out: the cove is invisible to diffuse rays and
    # the dome is translucent and emissive.
    bg = scn.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*rgb_lin("#EDECE9"), 1.0)
    bg.inputs["Strength"].default_value = WORLD_STRENGTH

    cam = bpy.data.objects["CAM_MAIN"]
    tgt = bpy.data.objects["CAM_TARGET"]
    anchor = bpy.data.objects.get("CAM_10_COVERAGE")
    if anchor:
        cam.location = anchor.location
        tgt.location = anchor["target"]
        cam.data.lens = anchor["lens_mm"]

    scn.render.resolution_x, scn.render.resolution_y = 1400, 1000
    os.makedirs(OUT, exist_ok=True)

    for label, tilt in SERIES:
        r = coverage_radius(MOUNT_HEIGHT_M, tilt)
        dome.scale = (r, r, r)
        bpy.context.view_layer.update()
        scn.render.filepath = os.path.join(OUT, f"coverage_{label}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[coverage] {label}: downtilt {tilt} deg -> radius {r:.1f} m")

    # One three-quarter view close enough to read pole and dome together.
    #
    # Uses the 10 deg dome (42.5 m), not the 5 deg one. An 86 m dome and a
    # 12.5 m pole cannot both be prominent in one frame: at any standoff that
    # fits the dome the pole is a few pixels, and at any standoff that reads the
    # pole the camera is inside the dome and the frame fills with its interior -
    # which is exactly what the first attempt produced. The tightest dome in the
    # series is the one where both fit.
    dome.scale = (coverage_radius(MOUNT_HEIGHT_M, 10.0),) * 3
    cam.location = (110.0, 110.0, 38.0)
    tgt.location = (0.0, 0.0, 18.0)
    cam.data.lens = 42.0
    bpy.context.view_layer.update()
    scn.render.filepath = os.path.join(OUT, "coverage_with_pole.png")
    bpy.ops.render.render(write_still=True)
    print("[coverage] with_pole")
    print(f"[coverage] {len(SERIES) + 1} renders -> {OUT}")


if __name__ == "__main__":
    main()
