# Blender sources

The scripts that produce the 3D assets this app loads. All of them run headless:

```bash
blender --background --python <script>.py
```

They write nothing to `src/` — each produces a `.blend` and, where relevant, a
`.glb` that is copied into `public/models/` by hand. That copy is deliberate:
an asset should change because someone decided it should, not because a build
step ran.

## What produces what

| Script | Produces |
| --- | --- |
| `build_lp12_v2.py` | the LP12 antenna, its rig and the six assembly clips → `public/models/lp12_v2.glb` |
| `build_lp12_studio.py` | the studio lighting scene and the camera anchors behind `public/models/camera_studio.json` |
| `regrade_textures.py` | non-destructive grade of the baked texture atlases |
| `render_coverage.py` | the coverage-dome reference renders |
| `build_awolowo_env.py` | the low-poly Awolowo Way environment |
| `export_awolowo_env.py` | that environment → `exports/awolowo_lowpoly_env.glb`, plus its two delivery renders |
| `make_hand_alpha.py` | cuts real alpha from the tutorial hand plates in `public/assets/lp12/` |

## Reproducibility, honestly

`build_awolowo_env.py` is self-contained: it builds the whole environment from
the plan constants at the top of the file, so the scene can be regenerated from
nothing. Change `ROAD_LEN`, `LANE`, the `SECONDARY` table or the palette and
rebuild.

The LP12 scripts are **not** self-contained. They read baked texture atlases
that live outside this repo and were produced by a bake pass that is not
scripted here. `build_lp12_v2.py` will abort rather than run without them —
`check_textures_graded()` fails loudly if the albedo island means come in below
target, which is what stops a silently under-graded model reaching the browser.
Treat `public/models/lp12_v2.glb` as the artefact of record for the antenna.

## The environment is not wired in yet

`exports/awolowo_lowpoly_env.glb` (1.5 MB, Draco) is version-controlled here
rather than in `public/`, because everything under `public/` ships to the
browser whether the app loads it or not. Move it into `public/models/` at the
point something actually renders it.

It carries two named empties for the application to read:

- `LP12_INSTALL_ANCHOR` — on the pavement outside the institutional building,
  +Y facing across the carriageway.
- `NETWORK_DOME_ORIGIN` — 7.5 m above it, for centring the spherical coverage
  volume. Spherical, never a cone.

Collections survive the export as parent nodes (`ENV_Roads`, `ENV_Buildings_Main`,
`ENV_Vegetation`, `ENV_Vehicles`, `ENV_StreetFurniture`, …), so groups can be
shown, hidden or highlighted independently.

## One hazard worth knowing

These scripts write `.blend` files that the Blender GUI may also have open. A
GUI save writes its own in-memory scene over whatever the CLI just built, and
it does so silently — `is_dirty` can read `False` while the two have already
diverged. Close the file in the GUI before rebuilding, or snapshot and revert
it first.
