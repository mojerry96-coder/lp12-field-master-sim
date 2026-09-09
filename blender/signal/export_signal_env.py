import bpy, sys, json, re
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--')+1:]
LP12_NAMES, OUT = set(json.loads(argv[0])), argv[1]
sc = bpy.context.scene

# ---- the scale, from two independent measurements against lp12_v2.glb ------
root  = sc.objects['LP12_ROOT']
L     = root.matrix_world.translation.copy()
shaft = sc.objects['Pole_Shaft']
zs    = [(shaft.matrix_world @ v.co).z for v in shaft.data.vertices]
s_shaft = 12.500 / (max(zs) - min(zs))
s_beam  = 7.500 / (sc.objects['Beam_Origin'].matrix_world.translation.z - L.z)
S = (s_shaft + s_beam) / 2
print(f"REF anchor=({L.x:.6f},{L.y:.6f},{L.z:.6f})  S={S:.6f}  "
      f"(shaft {s_shaft:.6f} / beam {s_beam:.6f}, delta {abs(s_shaft-s_beam):.9f})")

# ---- strip the duplicate LP12, the lights and the cameras ------------------
base = lambda n: re.sub(r'\.\d+$', '', n)
doomed = [o for o in sc.objects
          if o.type in ('LIGHT','CAMERA') or base(o.name) in LP12_NAMES]
for o in doomed: bpy.data.objects.remove(o, do_unlink=True)
faces = sum(len(o.data.polygons) for o in sc.objects if o.type=='MESH')
print(f"STRIP {len(doomed)}   KEEP {len(sc.objects)} objects, {faces} faces")

# ---- rebase so the model's own pole lands on the world origin -------------
M = Matrix.Scale(S,4) @ Matrix.Translation(-L)
for o in [o for o in sc.objects if o.parent is None]:
    o.matrix_world = M @ o.matrix_world
bpy.context.view_layer.update()

# ---- the footprint contract the camera director already expects -----------
# frameEnvironment() finds the city by these two node names and fits the
# coverage camera to their box, with the target dropped to box.min.y. They have
# to be the FLAT ground, not the buildings, or the fit includes 50m of tower and
# the camera pulls back that much too far. TABAN and Plane.031 are this scene's
# ground and road slabs; they are held out of the join below so the names
# survive it.
FOOTPRINT = {'TABAN': 'ENV_Ground_merged', 'Plane.031': 'ENV_Roads_merged'}
held = []
for src, dst in FOOTPRINT.items():
    o = sc.objects.get(src)
    if not o: print(f"  !! footprint source {src} missing"); continue
    o.name = dst
    held.append(dst)
    print(f"  footprint {src} -> {dst}")

# ---- one mesh per material; 1286 draw calls is the real cost --------------
for o in sc.objects: o.select_set(False)
groups = {}
for o in [o for o in sc.objects if o.type=='MESH' and o.name not in held]:
    key = tuple(sorted(m.name for m in o.data.materials if m)) or ('__none__',)
    groups.setdefault(key, []).append(o)
merged = 0
for objs in groups.values():
    if len(objs) < 2: continue
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    try:
        bpy.ops.object.join(); merged += len(objs)-1
    except Exception as e: print("  join failed:", e)
for o in sc.objects: o.select_set(False)
print(f"JOIN {merged} merged; meshes now {sum(1 for o in sc.objects if o.type=='MESH')}")

# ---- decimate: a background city seen from ~300 m -------------------------
# Planar dissolve first, which merges coplanar faces and is very nearly free on
# architecture — flat facades, flat roofs, flat roads. Then a collapse pass on
# whatever is still heavy, skipping the two footprint slabs because the camera
# director measures its framing off their bounds.
import math
before = sum(len(o.data.polygons) for o in sc.objects if o.type=='MESH')
for o in [o for o in sc.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active = o
    m = o.modifiers.new('planar','DECIMATE')
    m.decimate_type = 'DISSOLVE'; m.angle_limit = math.radians(4)
    # Delimit, or this is not lossless. Undelimited, dissolve merges coplanar
    # faces ACROSS material boundaries: the road surface and the paint on it are
    # the same plane, so the lane markings and the car-park bays were being
    # swallowed into one ngon and coming back as grass.
    m.delimit = {'MATERIAL', 'UV', 'SEAM', 'SHARP', 'NORMAL'}
    try: bpy.ops.object.modifier_apply(modifier=m.name)
    except Exception: o.modifiers.remove(m)
mid = sum(len(o.data.polygons) for o in sc.objects if o.type=='MESH')
TARGET = 320_000
if mid > TARGET:
    ratio = TARGET / mid
    for o in [o for o in sc.objects if o.type=='MESH' and o.name not in held]:
        if len(o.data.polygons) < 400: continue
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('collapse','DECIMATE')
        m.decimate_type = 'COLLAPSE'; m.ratio = ratio
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception: o.modifiers.remove(m)
after = sum(len(o.data.polygons) for o in sc.objects if o.type=='MESH')
print(f"DECIMATE {before} -> planar {mid} -> collapse {after} faces "
      f"({100*after/before:.1f}% of original)")

anchor = bpy.data.objects.new('LP12_INSTALL_ANCHOR', None)
sc.collection.objects.link(anchor)

for nm in held:
    o = sc.objects[nm]
    pts=[o.matrix_world @ v.co for v in o.data.vertices]
    xs=[p.x for p in pts]; ys=[p.y for p in pts]; zs=[p.z for p in pts]
    print(f"OUT {nm:20s} x[{min(xs):8.2f},{max(xs):8.2f}] y[{min(ys):8.2f},{max(ys):8.2f}] z[{min(zs):6.2f},{max(zs):6.2f}]")

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
    export_cameras=False, export_lights=False, export_yup=True)
print("WROTE", OUT)
