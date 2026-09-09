import bpy,sys,json
path=sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
names=sorted({o.name.split('.')[0] for o in bpy.context.scene.objects})
print("LP12_NAMES_JSON:"+json.dumps(names))
