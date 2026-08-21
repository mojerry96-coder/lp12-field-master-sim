"""
make_hand_alpha.py — turn the supplied hand plates into genuinely transparent PNGs.

    python3 deliverables/source/make_hand_alpha.py

The supplied hand-point.png / hand-tap.png are RGBA but their alpha is 255
everywhere: the transparency checkerboard is painted into the RGB pixels. Shipped
as-is, the tutorial hand arrives with a grey grid stamped around it.

Segmentation is a flood fill inward from the image border, not a brightness
threshold. A threshold would also cut out the fingernail and the brightest skin
highlights, which are as light as the checker squares; the background is instead
identified by being *connected to the edge*, which the nail is not.

Edges are feathered from a coverage estimate rather than hard-cut, and the RGB
of partially transparent pixels is pushed back toward skin so no white/grey
fringe survives compositing over the darker tablet scene.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = ("/private/tmp/claude-501/-Users-mosesjeremiah-blender/"
       "a28374a7-4700-4a91-8e41-9d83d18c12fe/scratchpad/tablet_guide/"
       "LP12_Tablet_Tuning_UI_Guide/assets")
DST = "/Users/mosesjeremiah/blender/field-master-sim/public/assets/lp12"

PAIRS = [("hand-point.png", "hand-point-alpha.png"),
         ("hand-tap.png", "hand-tap-alpha.png")]


def flood_from_border(bglike):
    """Iterative dilation flood fill; scipy is not available in this env."""
    h, w = bglike.shape
    reached = np.zeros_like(bglike)
    reached[0, :] |= bglike[0, :]
    reached[-1, :] |= bglike[-1, :]
    reached[:, 0] |= bglike[:, 0]
    reached[:, -1] |= bglike[:, -1]
    while True:
        grown = reached.copy()
        grown[1:, :] |= reached[:-1, :]
        grown[:-1, :] |= reached[1:, :]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        grown &= bglike
        if grown.sum() == reached.sum():
            return reached
        reached = grown


def cut(src_path, dst_path):
    rgb = np.asarray(Image.open(src_path).convert("RGB")).astype(np.float32)
    mx, mn = rgb.max(2), rgb.min(2)
    lum = rgb.mean(2)
    sat = mx - mn                       # cheap saturation: skin is chromatic

    # Checker squares are near-white and near-neutral. Generous thresholds are
    # safe because connectivity, not brightness alone, decides the background.
    bglike = (lum > 225) & (sat < 26)
    bg = flood_from_border(bglike)

    # Coverage: 1 inside the hand, 0 in reached background, soft in between.
    alpha = (~bg).astype(np.float32)
    a_img = Image.fromarray((alpha * 255).astype(np.uint8))
    a_img = a_img.filter(ImageFilter.GaussianBlur(0.8))       # anti-alias
    a = np.asarray(a_img).astype(np.float32) / 255.0
    # Tighten: push mid values apart so the edge is crisp but not aliased.
    a = np.clip((a - 0.35) / 0.45, 0.0, 1.0)

    # Fringe removal. Edge pixels are a blend of skin and checker white; undo it
    # by unpremultiplying against the white the checker contributed, so a
    # half-covered pixel carries skin colour rather than washed-out grey.
    out = rgb.copy()
    edge = (a > 0.02) & (a < 0.98)
    if edge.any():
        k = a[edge][:, None]
        white = np.full_like(out[edge], 250.0)
        out[edge] = np.clip((out[edge] - white * (1.0 - k)) / np.maximum(k, 0.08), 0, 255)

    rgba = np.dstack([out, a * 255.0]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(dst_path)

    op = float((a > 0.99).mean()) * 100
    tr = float((a < 0.01).mean()) * 100
    print(f"  {os.path.basename(dst_path):24s} opaque {op:5.1f}%  clear {tr:5.1f}%  "
          f"soft {100 - op - tr:4.1f}%")


def main():
    os.makedirs(DST, exist_ok=True)
    print(f"cutting hands -> {DST}")
    for s, d in PAIRS:
        cut(os.path.join(SRC, s), os.path.join(DST, d))
    print("done")


if __name__ == "__main__":
    main()
