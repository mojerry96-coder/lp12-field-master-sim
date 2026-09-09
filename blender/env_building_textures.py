"""
env_building_textures.py — put real surface texture on the environment's
buildings.

`make_env_textures.py` has generated a full tileable PBR set for the buildings
since day one (`env_deliverables/textures/buildings/`) and nothing ever wired it
in: every facade in the scene is a flat palette colour. This module connects it.

Two constraints shape how:

1. **The high-key look is measured, not eyeballed.** `configure_render()` sets
   exposure to -0.15 because that lands diffuse white in the high 230s, and the
   comment there is explicit that -0.65 "made the scene grey again". The
   concrete albedo map averages mid-grey, so multiplying it straight onto a
   #F2F0E9 wall would drop the facades by roughly a third and undo that tuning.
   The albedo is therefore remapped into a narrow band near white
   (`ALBEDO_RANGE`) and used as *modulation*, not as the colour itself.

2. **It has to survive the glTF export.** Shader-node box projection would look
   right in Blender and vanish on export, so this generates a real UV layer by
   cube projection instead. The geometry is axis-aligned boxes, which is the one
   case where cube projection is exactly right and costs nothing.

Runs against whatever scene is already open, and adds nothing it has not been
asked for, so it is safe to call on a live session as well as from the build.
"""

import os
import math

import bpy


# Texture root: sits outside this directory, so walk up and look for it.
_CANDIDATE_ROOTS = (
    os.path.join("env_deliverables", "textures", "buildings"),
    os.path.join("deliverables", "textures", "buildings"),
)


def texture_root(start=None):
    here = start or os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        for rel in _CANDIDATE_ROOTS:
            cand = os.path.join(here, rel)
            if os.path.isdir(cand):
                return cand
        here = os.path.dirname(here)
    raise RuntimeError("could not locate textures/buildings from %r" % (start,))


# Materials that clad a building mass: tile size, albedo band, roughness band.
#
# Two numbers decide whether this looks like concrete or like camouflage, and
# both were set by rendering, not by taste alone:
#
# * `tile` is metres per texture repeat. The map is soft low-frequency noise, so
#   a large tile puts big blotches on a facade that the isometric camera reads
#   as speckle. 4.0 m was visibly noisy at hero framing; 2.2 m puts the grain
#   below the scale the eye tracks at that distance and it settles into surface.
# * `albedo` is the band the map is mapped *to*, over a palette colour of ~0.89.
#   A +/-20% swing (0.72..1.16) read as blotching. These are roughly +/-12%:
#   clearly present up close, quiet at distance.
#
# Read source_range() before touching these -- the band only means what it says
# because the map is sampled Non-Color and stretched from its measured span.
TARGETS = {
    "ENV_Building":        dict(tile=2.2, albedo=(0.84, 1.10), rough=(0.62, 0.88)),
    "ENV_Building_Hi":     dict(tile=2.2, albedo=(0.86, 1.12), rough=(0.58, 0.84)),
    "ENV_Building_Shadow": dict(tile=1.9, albedo=(0.80, 1.06), rough=(0.66, 0.92)),
}

NORMAL_STRENGTH = 0.45     # relief that catches the key light without pebbling
SET_NAME = "concrete"      # concrete_base_color / _roughness / _normal


# ------------------------------------------------------------------- UVs

def add_box_uvs(ob, metres_per_tile, uv_name="UVMap"):
    """Cube-project a UV layer from local coordinates.

    The scene's boxes are axis-aligned and their meshes carry the real metre
    dimensions (box() scales the mesh, not the object), so projecting on the
    dominant normal axis gives a seamless world-scale tile with no distortion
    and no seams anywhere it matters.
    """
    me = ob.data
    if not me.polygons:
        return False

    uv = me.uv_layers.get(uv_name) or me.uv_layers.new(name=uv_name)
    inv = 1.0 / float(metres_per_tile)
    data = uv.data

    for poly in me.polygons:
        nx, ny, nz = (abs(c) for c in poly.normal)
        if nz >= nx and nz >= ny:
            ax, ay = 0, 1          # facing up/down  -> plan
        elif nx >= ny:
            ax, ay = 1, 2          # facing east/west -> section
        else:
            ax, ay = 0, 2          # facing north/south -> elevation
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            data[li].uv = (co[ax] * inv, co[ay] * inv)
    return True


# ------------------------------------------------------------- material

def _load(path):
    """Load an image once and reuse it; a rebuild must not stack duplicates."""
    name = os.path.splitext(os.path.basename(path))[0]
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.load(path, check_existing=True)
        img.name = name
    return img


_RANGE_CACHE = {}


def source_range(img, lo_pct=2.0, hi_pct=98.0):
    """The span of values the map actually occupies.

    This is the difference between the texture reading as a surface and not
    reading at all. `make_env_textures.py` generates its maps as *subtle* noise
    -- the concrete albedo lives between 0.365 and 0.424, a 6% span, not 0..1.
    Feeding a Map Range node the nominal 0..1 domain therefore compresses the
    whole output band into a few percent, which is exactly why widening the
    output band alone changed almost nothing on screen.

    Mapping *from* the measured span instead lets the output band mean what it
    says. Percentiles rather than min/max so one stray pixel cannot flatten it,
    and measured at runtime because these maps are regenerated from a seed.
    """
    key = img.name
    if key in _RANGE_CACHE:
        return _RANGE_CACHE[key]
    try:
        import numpy as np
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(-1, 4)[:, :3].mean(axis=1)
        lo, hi = float(np.percentile(rgb, lo_pct)), float(np.percentile(rgb, hi_pct))
    except Exception:
        lo, hi = 0.0, 1.0
    if hi - lo < 1e-4:                     # degenerate map: leave it alone
        lo, hi = 0.0, 1.0
    _RANGE_CACHE[key] = (lo, hi)
    return lo, hi


def upgrade_material(mat, root, tile, albedo_range, rough_range,
                     set_name=SET_NAME):
    """Insert texture modulation into an existing flat-colour material.

    The palette colour is kept as the material's identity — the map multiplies
    over it — so the scene's art direction still comes from PALETTE and this can
    be reverted by deleting the added nodes.
    """
    if mat is None or not mat.use_nodes:
        return False
    nt = mat.node_tree
    if nt.nodes.get("EnvTex_Albedo"):      # already upgraded
        return False

    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf is None:
        return False

    base_rgba = tuple(bsdf.inputs["Base Color"].default_value)
    base_rough = float(bsdf.inputs["Roughness"].default_value)

    x0, y0 = bsdf.location.x - 900, bsdf.location.y

    coord = nt.nodes.new("ShaderNodeTexCoord")
    coord.name = "EnvTex_Coord"
    coord.location = (x0 - 250, y0)

    def image_node(kind, label, dy, non_color):
        path = os.path.join(root, "%s_%s.png" % (set_name, kind))
        node = nt.nodes.new("ShaderNodeTexImage")
        node.name = label
        node.image = _load(path)
        node.projection = "FLAT"
        node.extension = "REPEAT"
        if non_color:
            node.image.colorspace_settings.name = "Non-Color"
        node.location = (x0, y0 + dy)
        nt.links.new(coord.outputs["UV"], node.inputs["Vector"])
        return node

    # -- albedo: remapped near white, then multiplied over the palette colour
    #
    # Loaded as Non-Color deliberately. This map is a *modulation signal*, not a
    # colour: it is measured by source_range() and fed to a Map Range whose
    # bounds are in stored-value space. Left as sRGB the shader samples it
    # linearised -- 0.395 stored arrives as 0.128 -- so every sample falls below
    # From Min, clamps, and the wall comes out uniformly darker with no
    # variation at all. That is the failure this argument exists to prevent.
    alb = image_node("base_color", "EnvTex_Albedo", 300, True)
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.name = "EnvTex_AlbedoRange"
    rng.location = (x0 + 300, y0 + 300)
    a_lo, a_hi = source_range(alb.image)
    rng.inputs["From Min"].default_value = a_lo
    rng.inputs["From Max"].default_value = a_hi
    rng.inputs["To Min"].default_value = albedo_range[0]
    rng.inputs["To Max"].default_value = albedo_range[1]
    rng.clamp = True
    nt.links.new(alb.outputs["Color"], rng.inputs["Value"])

    mix = nt.nodes.new("ShaderNodeMix")
    mix.name = "EnvTex_AlbedoMix"
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.location = (x0 + 520, y0 + 300)
    mix.inputs["Factor"].default_value = 1.0
    # socket names collide across versions; address the RGBA pair by index
    a_in, b_in = [s for s in mix.inputs if s.type == "RGBA"][:2]
    a_in.default_value = base_rgba
    nt.links.new(rng.outputs["Result"], b_in)
    rgba_out = [s for s in mix.outputs if s.type == "RGBA"][0]
    nt.links.new(rgba_out, bsdf.inputs["Base Color"])

    # -- roughness: breaks up the uniform sheen the flat materials all share
    rgh = image_node("roughness", "EnvTex_Rough", 0, True)
    rr = nt.nodes.new("ShaderNodeMapRange")
    rr.name = "EnvTex_RoughRange"
    rr.location = (x0 + 300, y0)
    r_lo, r_hi = source_range(rgh.image)
    rr.inputs["From Min"].default_value = r_lo
    rr.inputs["From Max"].default_value = r_hi
    rr.inputs["To Min"].default_value = rough_range[0]
    rr.inputs["To Max"].default_value = rough_range[1]
    rr.clamp = True
    nt.links.new(rgh.outputs["Color"], rr.inputs["Value"])
    nt.links.new(rr.outputs["Result"], bsdf.inputs["Roughness"])

    # -- normal
    nrm = image_node("normal", "EnvTex_Normal", -320, True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.name = "EnvTex_NormalMap"
    nmap.location = (x0 + 300, y0 - 320)
    nmap.inputs["Strength"].default_value = NORMAL_STRENGTH
    nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    mat["env_tex_base_roughness"] = base_rough
    mat["env_tex_tile_m"] = tile
    return True


# --------------------------------------------------------------- driver

BUILDING_COLLECTIONS = ("ENV_Buildings_Main", "ENV_Buildings_Secondary")


def retune(verbose=True):
    """Re-push TARGETS onto materials already wired, without rebuilding nodes.

    Tuning texture strength is iterative and the node graph does not need to be
    torn down to change a band.
    """
    for name, cfg in TARGETS.items():
        mat = bpy.data.materials.get(name)
        if mat is None or not mat.use_nodes:
            continue
        nt = mat.node_tree
        a = nt.nodes.get("EnvTex_AlbedoRange")
        r = nt.nodes.get("EnvTex_RoughRange")
        n = nt.nodes.get("EnvTex_NormalMap")
        if a:
            alb_img = nt.nodes["EnvTex_Albedo"].image
            alb_img.colorspace_settings.name = "Non-Color"
            _RANGE_CACHE.pop(alb_img.name, None)
            lo, hi = source_range(alb_img)
            a.inputs["From Min"].default_value = lo
            a.inputs["From Max"].default_value = hi
            a.inputs["To Min"].default_value = cfg["albedo"][0]
            a.inputs["To Max"].default_value = cfg["albedo"][1]
            a.clamp = True
        if r:
            lo, hi = source_range(nt.nodes["EnvTex_Rough"].image)
            r.inputs["From Min"].default_value = lo
            r.inputs["From Max"].default_value = hi
            r.inputs["To Min"].default_value = cfg["rough"][0]
            r.inputs["To Max"].default_value = cfg["rough"][1]
            r.clamp = True
        if n:
            n.inputs["Strength"].default_value = NORMAL_STRENGTH
        if verbose:
            print("  retuned %-20s albedo %.2f..%.2f from source %.3f..%.3f"
                  % (name, cfg["albedo"][0], cfg["albedo"][1],
                     a.inputs["From Min"].default_value,
                     a.inputs["From Max"].default_value))


def apply(collections=BUILDING_COLLECTIONS, verbose=True):
    """Texture every building mesh. Returns (objects_uv'd, materials_upgraded)."""
    root = texture_root()

    upgraded = 0
    for mat_name, cfg in TARGETS.items():
        mat = bpy.data.materials.get(mat_name)
        if upgrade_material(mat, root, cfg["tile"], cfg["albedo"], cfg["rough"]):
            upgraded += 1
            if verbose:
                print("  material textured: %s (tile %.1f m)" % (mat_name, cfg["tile"]))

    # One UV layer per mesh, at the tile size of the material it wears. A mesh
    # shared by instances is only projected once, which is the point of the seen
    # set — without it a linked copy gets re-projected for every instance.
    seen = set()
    uvd = 0
    for coll_name in collections:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            continue
        for ob in coll.objects:
            if ob.type != "MESH" or ob.data.name in seen:
                continue
            names = [m.name for m in ob.data.materials if m]
            cfg = next((TARGETS[n] for n in names if n in TARGETS), None)
            if cfg is None:
                continue
            if add_box_uvs(ob, cfg["tile"]):
                seen.add(ob.data.name)
                uvd += 1

    if verbose:
        print("  building meshes UV-projected: %d" % uvd)
    return uvd, upgraded


if __name__ == "__main__":
    apply()
