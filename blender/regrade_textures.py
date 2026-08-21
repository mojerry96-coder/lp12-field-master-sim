"""
regrade_textures.py - grade the baked LP12 atlases to the galvanised reference
look, non-destructively.

Run (no Blender needed):
    python3 deliverables/source/regrade_textures.py

Reads the pristine bakes from deliverables/textures_src/ and writes the graded
set to deliverables/textures/, which is where lp12_interactive_master.blend
points its image datablocks. textures_src/ is never written to, so the grade is
idempotent and re-tunable - the previous pass multiplied the source PNGs in
place by up to 5.6x and clipped them to 1-bit white-on-black, destroying the
bakes; that is what this script exists to prevent.

Three things happen here, and all three matter:

1. GRADE. The bakes are far too dark for hot-dip galvanised hardware, but a
   flat gain clips. Each map instead declares a TARGET island albedo, and the
   gain that lands the island mean on it is solved numerically through a
   Reinhard shoulder, in linear light. Nothing clips, so the brushed noise
   survives.

2. GUTTER. These are UV-island bakes: everything between the islands is
   unbaked background - black in the albedo, and (255, 0, 255) in the ORM,
   i.e. roughness 0 / metallic 1, a perfect mirror. Bilinear filtering and
   mips pull that background across island edges. The graded islands are
   therefore dilated outwards into a gutter.

3. FLOOD. Whatever gutter dilation does not reach is filled with the island
   mean rather than left as background. That makes the atlas safe to sample
   anywhere, including uv (0, 0) - which is what a mesh exported without a
   TEXCOORD_0 attribute samples, and why the pole bands rendered black.
"""

import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "textures_src")
DST = os.path.join(ROOT, "textures")

# Island albedo to land on, sRGB 0-255, and a tint applied after the grade.
# These are destination values, not gains: a gain is meaningless without
# knowing how dark the bake underneath it happens to be.
TARGET = {
    # Destination island albedo, sRGB 0-255, plus a tint applied before the
    # grade. Values follow the render-quality brief: the previous set sat 30-40
    # points higher across the board, which is what left the enclosure, the
    # hardware and the backdrop sharing one narrow bright band.
    "steel_brushed":     (190, (1.00, 0.995, 0.97)),   # bands - galvanised
    "steel_dark":        (142, (0.99, 0.99, 1.00)),    # rail + pivot plates
    "connector_steel":   (196, (1.00, 1.00, 1.00)),    # fasteners
    "connector_brass":   (128, (1.00, 0.767, 0.367)),  # brief #B48A42
    "heatsink_charcoal": (120, (1.00, 1.00, 1.00)),    # extruded aluminium
    "antenna_offwhite":  (200, (1.00, 0.997, 0.99)),   # brief #C7C9C8
    "concrete_pole":     (138, (1.00, 0.995, 0.98)),   # light grey concrete
    "rubber_black":      (24,  (1.00, 1.00, 1.00)),    # brief #16181A
}

# Roughness the material should actually present. The bakes ship a near-flat
# ~0.98 in the ORM green channel, and the exported glTF carries no
# roughnessFactor - so every metal was rendering at roughness 1.0 with
# metalness 0.92, which is dark and dead however bright the albedo is. The
# target is scaled into the channel here rather than fought at runtime.
ROUGHNESS = {
    # Brief Step 5 bands: steel 0.25-0.38, enclosure 0.32-0.42,
    # concrete 0.65-0.82, cable 0.45-0.60, brass 0.22-0.32.
    "steel_brushed": 0.30, "steel_dark": 0.33,
    "connector_steel": 0.28, "connector_brass": 0.27,
    "heatsink_charcoal": 0.42, "antenna_offwhite": 0.37,
    "concrete_pole": 0.74, "rubber_black": 0.52,
}

GUTTER = 8           # px of island dilation before the flood fill
ERODE = 3            # px trimmed off island edges before they seed the gutter
WHITE = 1.6          # Reinhard white point, linear


def to_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * x ** (1 / 2.4) - 0.055)


def shoulder(x):
    """Reinhard with a white point: slope 1 at the toe, asymptotic at the top,
    so a gain that would have clipped rolls off instead."""
    return x * (1.0 + x / (WHITE * WHITE)) / (1.0 + x)


def solve_gain(lin, mask, target_lin):
    """Find g such that mean(shoulder(g * island)) == target. The shoulder is
    monotonic in g, so bisection is exact enough and cannot diverge."""
    isl = lin[mask]
    lo, hi = 0.01, 64.0
    for _ in range(48):
        g = (lo + hi) / 2
        if shoulder(g * isl).mean() < target_lin:
            lo = g
        else:
            hi = g
    return (lo + hi) / 2


def erode(mask, rounds):
    """Trim the island edges back. A bake antialiases its islands against the
    black background, so the outermost ring of "island" pixels is part
    background - seeding the gutter or the mean colour from those drags both
    dark. Everything downstream works off the eroded core instead."""
    m = mask.copy()
    for _ in range(rounds):
        keep = m.copy()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            keep &= np.roll(np.roll(m, dy, 0), dx, 1)
        m = keep
    return m if m.any() else mask


def dilate(rgb, mask, rounds):
    """Push island colour outwards one ring at a time. Each unfilled pixel
    touching filled ones takes their mean, which keeps the gutter continuous
    with the island edge instead of banding."""
    out = rgb.copy()
    filled = mask.copy()
    for _ in range(rounds):
        if filled.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s = np.roll(np.roll(filled, dy, 0), dx, 1).astype(np.float32)
            c = np.roll(np.roll(out, dy, 0), dx, 1)
            acc += c * s[..., None]
            cnt += s
        grow = (~filled) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][..., None]
        filled |= grow
    return out, filled


def load(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float32) / 255.0


def save(path, rgb):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def grade_albedo(path_in, path_out, key):
    srgb = load(path_in)
    lin = to_linear(srgb)
    mask = srgb.mean(2) > (8 / 255)          # baked island vs unbaked black

    tgt, tint = TARGET[key]
    tgt_lin = to_linear(np.array([tgt / 255.0]))[0]
    # Tint first, then solve: otherwise a saturated tint like brass pulls the
    # graded mean back off the target it was just landed on.
    lin = lin * np.array(tint, np.float32)
    g = solve_gain(lin, mask, tgt_lin)
    out = to_srgb(shoulder(lin * g))

    core = erode(mask, ERODE)
    out, filled = dilate(out, core, GUTTER)
    fill = out[core].reshape(-1, 3).mean(0)
    out[~filled] = fill

    save(path_out, out)
    before = srgb[mask].mean() * 255
    print(f"  albedo {key:18s} cover {mask.mean()*100:5.1f}%  "
          f"island {before:6.1f} -> {out[mask].mean()*255:6.1f}  "
          f"gain {g:5.2f}  bg {tuple((fill*255).round().astype(int))}")


def grade_orm(path_in, path_out, key):
    """Occlusion / roughness / metallic. Occlusion and metallic pass through -
    metalness is already carried by the material's metallicFactor. The green
    channel is rescaled so its island mean lands on the material's target
    roughness, keeping the (small) baked variation around it, and the unbaked
    (255, 0, 255) background - roughness 0, metallic 1, a perfect mirror - is
    replaced so it stops reading as a hole."""
    rgb = load(path_in)
    mask = ~((rgb[..., 0] > 0.96) & (rgb[..., 1] < 0.04) & (rgb[..., 2] > 0.96))

    out = rgb.copy()
    tgt = ROUGHNESS[key]
    g = out[..., 1]
    before = g[mask].mean()
    out[..., 1] = np.clip(g * (tgt / max(before, 1e-6)), 0.0, 1.0)

    core = erode(mask, ERODE)
    if mask.all():
        filled = mask
    else:
        out, filled = dilate(out, core, GUTTER)
    fill = out[core].reshape(-1, 3).mean(0)
    out[~filled] = fill

    save(path_out, out)
    print(f"  orm    {key:18s} cover {mask.mean()*100:5.1f}%  "
          f"rough {before:.2f} -> {out[..., 1][mask].mean():.2f}  "
          f"bg rough {fill[1]:.2f} metal {fill[2]:.2f}")


def main():
    if not os.path.isdir(SRC):
        raise SystemExit(f"missing pristine bakes: {SRC}")
    print(f"grading {SRC} -> {DST}")
    for sub in sorted(os.listdir(SRC)):
        d = os.path.join(SRC, sub)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".png"):
                continue
            key = "_".join(fn.split("_")[:2])
            src, dst = os.path.join(d, fn), os.path.join(DST, sub, fn)
            if fn.endswith("_base_color.png"):
                grade_albedo(src, dst, key)
            elif fn.endswith("_roughness.png"):
                grade_orm(src, dst, key)
            else:                              # normal maps: flat background
                save(dst, load(src))
                print(f"  normal {key:18s} copied")
    print("done")


if __name__ == "__main__":
    main()
