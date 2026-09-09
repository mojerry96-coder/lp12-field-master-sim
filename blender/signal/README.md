# The Network Coverage city (`public/models/signal_env.glb`)

Built from `signal.blend` — the "signal" model — and used by ONE page: Network
Coverage. Every other screen keeps `awolowo_lowpoly_env.glb`.

## Rebuilding

    NAMES=$(blender -b --factory-startup -P names.py -- ../../public/models/lp12_v2.glb \
            | grep LP12_NAMES_JSON | sed 's/LP12_NAMES_JSON://')
    blender -b signal.blend --factory-startup -P export_signal_env.py -- "$NAMES" out.glb
    python3 glb_shrink.py out.glb ../../public/models/signal_env.glb 256

`signal.blend` is not in the repository — it is 31 MB. It is opened read-only
and never written to.

## Why the export is not a straight "export as GLB"

**Scale.** signal.blend is authored about 8.75x smaller than the app's world.
The factor is not guessed: the blend contains its own copy of the LP12, so the
export measures its pole against `lp12_v2.glb` two independent ways — shaft
height 1.428447 -> 12.500, and Beam_Origin 0.857068 -> 7.500 above the root.
Both give 8.750762, agreeing to 1.8e-7. If a future export disagrees between
those two, the model has been rescaled non-uniformly and the number is wrong.

**Position.** The world is rebased so the blend's own `LP12_ROOT`
(9.009554, -3.402561, 0.185034) lands on the origin, which is the same
convention `awolowo_lowpoly_env.glb` uses with `LP12_INSTALL_ANCHOR`. That is
what puts the new city's pole exactly where the old one's was — the app's LP12
stands at the origin and the street assembles around it.

**The duplicate LP12 is stripped.** The blend ships a pole and antenna of its
own; the page already renders `lp12_v2.glb` at the origin, so keeping both would
put two poles in the same space. Parts are identified by matching object names
against `lp12_v2.glb` rather than by guessing at prefixes.

**Two nodes are named, and the camera depends on it.** `frameEnvironment()` in
LP12BuildCanvas finds the city by `ENV_Ground_merged` and `ENV_Roads_merged` and
fits the coverage framing to their bounds. This scene's ground and road slabs
are `TABAN` and `Plane.031`; they are renamed and held out of the join so the
names survive. They must stay the FLAT slabs — fitting to the buildings would
add 50 m of tower to the box and push the camera back by that much.

## Weight

Two safe passes, no lossy geometry reduction:

- textures 15.2 MB -> 138 KB (a 2K wood PBR set alone was 14.5 MB, on props
  invisible from 300 m). Done in `glb_shrink.py` rather than in Blender,
  because the exporter writes the ORIGINAL packed bytes back out for an image
  it thinks is unmodified, so scaling in Blender does not survive the export.
- planar dissolve, delimited by material/UV/seam/sharp/normal:
  1,012,960 -> 844,976 triangles. The delimit is not optional. Without it the
  dissolve merges coplanar faces across material boundaries, and the road
  markings and car-park bays get swallowed into the tarmac and come back as
  grass.
- joined by material: 1286 -> 345 draw calls.

It still ships at 5.4 MB against the old model's 825 KB, and 845k triangles
against roughly 250k. It is fetched at P3 — during the install, not before the
first scene — and only by the page that uses it. If it needs to come down
further the honest lever is a COLLAPSE decimate pass, which is lossy on
architecture and should be looked at rather than trusted.
